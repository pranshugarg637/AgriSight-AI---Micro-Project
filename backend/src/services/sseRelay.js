import { buildImageForm, mlFetch } from "./mlClient.js";

/** Parse one SSE block ("event: x\ndata: {...}") -> { event, data } */
export function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

const writeEvent = (res, event, obj) => res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);

/**
 * Relays the ML service's Server-Sent Events to the browser. Stage events
 * pass through unchanged (they are emitted by the pipeline as work happens);
 * the final `result` event is handed to `onResult` (e.g. to save the scan)
 * and re-emitted with whatever it returns.
 */
export async function relayPredictionStream(req, res, { file, fields, onResult }) {
  const controller = new AbortController();
  // Abort the upstream work if the browser goes away before we finish.
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const form = buildImageForm(file, fields);
  const upstream = await mlFetch("/api/predict/stream", {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
    signal: controller.signal,
  });
  if (!upstream.ok) {
    let data = null;
    try {
      data = await upstream.json();
    } catch {
      /* ignore */
    }
    return res.status(upstream.status).json({ error: "prediction_failed", detail: data?.detail || "The ML service could not process this image." });
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let buffer = "";
  const handleBlock = async (block) => {
    if (!block.trim()) return;
    const { event, data } = parseSseBlock(block);
    if (event === "result") {
      try {
        const out = await onResult(JSON.parse(data));
        writeEvent(res, "result", out);
      } catch (err) {
        console.error("[stream] post-processing failed:", err);
        writeEvent(res, "error", { status_code: 500, detail: "Could not save the result." });
      }
    } else {
      res.write(`${block}\n\n`);
    }
  };

  try {
    for await (const chunk of upstream.body) {
      buffer += chunk.toString("utf-8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        await handleBlock(block);
      }
    }
    if (buffer.trim()) await handleBlock(buffer);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("[stream] upstream error:", err.message);
      writeEvent(res, "error", { status_code: 503, detail: "The ML service stream was interrupted." });
    }
  }
  res.end();
}
