import multer from "multer";

/**
 * Global error handler. Never leaks raw stack traces to the client
 * (Section 26). Logs full detail server-side only.
 */
export function errorHandler(err, req, res, next) {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", detail: "The uploaded file exceeds the maximum allowed size." });
    }
    return res.status(400).json({ error: "upload_error", detail: err.message });
  }

  if (err.message && err.message.startsWith("Unsupported file type")) {
    return res.status(422).json({ error: "invalid_file_type", detail: err.message });
  }

  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.name === "AbortError") {
    return res.status(503).json({
      error: "ml_service_unavailable",
      detail: "The ML/RAG service is unreachable or timed out. Ensure it is running (see docs/setup.md).",
    });
  }

  const status = err.status || 500;
  return res.status(status).json({
    error: "internal_server_error",
    detail: status === 500 ? "An unexpected error occurred." : err.message,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "not_found", detail: `No route for ${req.method} ${req.originalUrl}` });
}
