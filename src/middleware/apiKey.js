import { createHash, timingSafeEqual } from "node:crypto";

import { sendError } from "../utils/http.js";

// middleware/apiKey.js — the in-code authentication of /api/* required by I4 (D-21):
// the Function URL is AuthType NONE, so the x-api-key check lives here and runs
// BEFORE any DynamoDB access. Never log the header value anywhere (I4 / D-18).

/**
 * Constant-time comparison of two arbitrary-length strings.
 *
 * crypto.timingSafeEqual throws when the buffers have different lengths, so both sides
 * are hashed to fixed-size SHA-256 digests first: the comparison is a single
 * constant-time path that never throws, and it does not leak the configured key's
 * length through an early size check.
 */
function constantTimeEquals(a, b) {
  const digestA = createHash("sha256").update(String(a)).digest();
  const digestB = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * @param {{ adminApiKey: string }} deps injected from config (D-17); never read from env here.
 * @returns Express middleware enforcing the x-api-key header (401 missing/empty, 403 mismatch).
 */
export function createApiKeyMiddleware({ adminApiKey }) {
  return function apiKeyAuth(req, res, next) {
    const provided = req.get("x-api-key");
    if (!provided) {
      sendError(res, 401, "UNAUTHORIZED", "missing x-api-key header");
      return;
    }
    if (!constantTimeEquals(provided, adminApiKey)) {
      sendError(res, 403, "FORBIDDEN", "invalid api key");
      return;
    }
    next();
  };
}
