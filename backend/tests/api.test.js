import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import request from "supertest";

process.env.NODE_ENV = "test";

let mockMlServer;
let mockMlPort;
let mockMlBehavior = "healthy";

function startMockMlService() {
  return new Promise((resolve) => {
    mockMlServer = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/api/health") {
        res.writeHead(200);
        return res.end(JSON.stringify({ status: "ok", model_loaded: true, knowledge_base_ready: true, llm_reachable: true }));
      }

      if (req.url === "/api/model-status") {
        res.writeHead(200);
        return res.end(JSON.stringify({ model_loaded: true, error: null, backbone: "mobilenet_v2", num_classes: 3, model_version: "1.0.0" }));
      }

      if (req.url === "/api/knowledge-base-status") {
        res.writeHead(200);
        return res.end(JSON.stringify({ ready: true, num_chunks: 42 }));
      }

      if (req.url.startsWith("/api/analytics/history")) {
        res.writeHead(200);
        return res.end(JSON.stringify({ predictions: [], count: 0 }));
      }

      if (req.url === "/api/predict" && req.method === "POST") {
        if (mockMlBehavior === "unreliable") {
          res.writeHead(200);
          return res.end(
            JSON.stringify({
              diagnosis: "healthy",
              crop: "Tomato",
              confidence: 0.4,
              confidence_level: "unreliable",
              is_reliable: false,
              confidence_message: "Unable to provide a reliable diagnosis from this image.",
              alternatives: [],
              retrieval_status: "skipped_low_confidence",
              sources: [],
            })
          );
        }
        if (mockMlBehavior === "invalid_image") {
          res.writeHead(422);
          return res.end(JSON.stringify({ detail: "The uploaded image is unclear." }));
        }
        // Drain the body then respond success
        let chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              diagnosis: "Late blight",
              crop: "Tomato",
              confidence: 0.91,
              confidence_level: "high",
              is_reliable: true,
              confidence_message: "High-confidence prediction.",
              alternatives: [],
              retrieval_status: "success",
              sources: [],
            })
          );
        });
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    });

    mockMlServer.listen(0, () => {
      mockMlPort = mockMlServer.address().port;
      resolve();
    });
  });
}

let app;

before(async () => {
  await startMockMlService();
  process.env.ML_SERVICE_URL = `http://localhost:${mockMlPort}`;
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

beforeEach(() => {
  mockMlBehavior = "healthy";
});

after(() => {
  mockMlServer.close();
});

test("GET /api/health proxies the ML service health check", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.backend, "ok");
  assert.equal(res.body.ml_service.model_loaded, true);
});

test("GET /api/model-status proxies model status", async () => {
  const res = await request(app).get("/api/model-status");
  assert.equal(res.status, 200);
  assert.equal(res.body.model_loaded, true);
  assert.equal(res.body.backbone, "mobilenet_v2");
});

test("GET /api/knowledge-base-status proxies KB status", async () => {
  const res = await request(app).get("/api/knowledge-base-status");
  assert.equal(res.status, 200);
  assert.equal(res.body.ready, true);
  assert.equal(res.body.num_chunks, 42);
});

test("POST /api/predict with a valid JPEG succeeds and returns the ML service's response", async () => {
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const res = await request(app)
    .post("/api/predict")
    .attach("file", fakeJpeg, { filename: "leaf.jpg", contentType: "image/jpeg" });

  assert.equal(res.status, 200);
  assert.equal(res.body.diagnosis, "Late blight");
  assert.equal(res.body.confidence_level, "high");
});

test("POST /api/predict rejects unsupported file types before reaching the ML service", async () => {
  const res = await request(app)
    .post("/api/predict")
    .attach("file", Buffer.from("just text"), { filename: "notes.txt", contentType: "text/plain" });

  assert.equal(res.status, 422);
  assert.equal(res.body.error, "invalid_file_type");
});

test("POST /api/predict with no file returns 400", async () => {
  const res = await request(app).post("/api/predict");
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "no_file");
});

test("POST /api/predict surfaces the ML service's low-confidence response unchanged", async () => {
  mockMlBehavior = "unreliable";
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const res = await request(app)
    .post("/api/predict")
    .attach("file", fakeJpeg, { filename: "leaf.jpg", contentType: "image/jpeg" });

  assert.equal(res.status, 200);
  assert.equal(res.body.confidence_level, "unreliable");
  assert.equal(res.body.is_reliable, false);
});

test("POST /api/predict propagates ML service 422 (invalid/blurry image) as-is", async () => {
  mockMlBehavior = "invalid_image";
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const res = await request(app)
    .post("/api/predict")
    .attach("file", fakeJpeg, { filename: "leaf.jpg", contentType: "image/jpeg" });

  assert.equal(res.status, 422);
  assert.equal(res.body.error, "prediction_failed");
});

test("GET /api/nonexistent-route returns a clean 404", async () => {
  const res = await request(app).get("/api/nonexistent-route");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "not_found");
});

test("ML service connection errors are translated to a clean 503 (not a raw stack trace)", async () => {
  const { errorHandler } = await import("../src/middleware/errorHandler.js");

  const err = new Error("connect ECONNREFUSED 127.0.0.1:9999");
  err.code = "ECONNREFUSED";

  let statusCode, jsonBody;
  const fakeRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };
  const fakeReq = { method: "GET", originalUrl: "/api/model-status" };

  errorHandler(err, fakeReq, fakeRes, () => {});

  assert.equal(statusCode, 503);
  assert.equal(jsonBody.error, "ml_service_unavailable");
  assert.ok(!jsonBody.detail.includes("at ")); // no stack trace leaked
});
