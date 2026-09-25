import { ApiError, parseResponse } from "./http";

/** Parses a text/event-stream fetch Response, calling onEvent({event, data}) per event. */
export async function readEventStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block) => {
    if (!block.trim()) return;
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    let parsed = data.join("\n");
    try {
      parsed = JSON.parse(parsed);
    } catch {
      /* plain text */
    }
    onEvent({ event, data: parsed });
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      flush(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  flush(buffer);
}

/**
 * Runs a streamed prediction: `onStage` gets each real pipeline event
 * ({stage, status}); resolves with the final result, rejects with ApiError.
 */
export async function streamPrediction(response, onStage) {
  if (!response.ok || !(response.headers.get("content-type") || "").includes("text/event-stream")) {
    return parseResponse(response); // JSON error (400/401/413/422/429/503) or unexpected body
  }
  let result = null;
  let error = null;
  await readEventStream(response, ({ event, data }) => {
    if (event === "stage") onStage?.(data);
    else if (event === "result") result = data;
    else if (event === "error") error = data;
  });
  if (error) throw new ApiError(error.detail || "Prediction failed.", error.status_code || 500, error);
  if (!result) throw new ApiError("The prediction stream ended without a result.", 502);
  return result;
}
