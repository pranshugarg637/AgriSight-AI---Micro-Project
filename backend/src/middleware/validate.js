/**
 * zod-based validation. On failure returns 400 with field-level messages
 * (never echoes submitted values back, e.g. passwords).
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
      return res.status(400).json({ error: "validation_error", detail: "Invalid request.", issues });
    }
    req.validated = { ...(req.validated || {}), [source]: result.data };
    next();
  };
}
