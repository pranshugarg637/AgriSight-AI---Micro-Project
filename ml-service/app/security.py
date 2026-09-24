"""
Service boundary: the ML service is internal-only. Every /api/* request must
carry the shared secret in `X-Internal-Token` (sent only by the Node
backend). Requests without it are rejected before any ML work happens.
"""
from __future__ import annotations

import hmac
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "X-Internal-Token"
# Paths that never require the token (no data, used by container health checks).
PUBLIC_PATHS = {"/", "/healthz"}


class ConfigurationError(RuntimeError):
    pass


def assert_secure_configuration() -> None:
    """Fail fast at startup in production if the internal token is missing/weak."""
    settings = get_settings()
    if settings.ENV == "production" and len(settings.ML_INTERNAL_TOKEN or "") < 24:
        raise ConfigurationError(
            "ML_INTERNAL_TOKEN must be set (>= 24 chars) when ENV=production. Refusing to start."
        )
    if not settings.ML_INTERNAL_TOKEN:
        logger.warning(
            "ML_INTERNAL_TOKEN is not set: every /api request will be rejected with 503. "
            "Set the same value for the backend and the ML service in .env."
        )


class InternalTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in PUBLIC_PATHS or not path.startswith("/api"):
            return await call_next(request)

        expected = get_settings().ML_INTERNAL_TOKEN
        if not expected:
            return JSONResponse(
                status_code=503,
                content={
                    "error": "internal_token_not_configured",
                    "detail": "ML_INTERNAL_TOKEN is not configured on the ML service.",
                },
            )
        provided = request.headers.get(INTERNAL_TOKEN_HEADER, "")
        if not hmac.compare_digest(provided.encode(), expected.encode()):
            return JSONResponse(
                status_code=401,
                content={"error": "unauthorized", "detail": "This service only accepts requests from the AgriSight backend."},
            )
        return await call_next(request)
