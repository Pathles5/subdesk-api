import { createHash, timingSafeEqual } from "node:crypto";

import { sendError } from "../utils/http.js";
import { createLogger } from "../utils/logger.js";

// middleware/webhookGuard.js — the two halves of the webhook contract (D-21 / I5):
// (a) createWebhookSecretMiddleware: the single non-2xx case of POST /webhook/telegram
//     (missing or wrong X-Telegram-Bot-Api-Secret-Token -> 403);
// (b) webhookGuard: an error handler that turns ANY failure inside the webhook sub-tree
//     into a 200 ack, because a 5xx or an uncaught exception makes Telegram treat the
//     update as undelivered and retry in a loop (I5).

// The guard logs with its own info-level logger: webhook failures must always be
// visible regardless of LOG_LEVEL=error in production. Only names and status codes are
// logged — never req.body and never headers (D-18).
const logger = createLogger("info");

/**
 * Constant-time comparison of two arbitrary-length strings (see the same helper in
 * middleware/apiKey.js): SHA-256 digests normalize lengths so timingSafeEqual never
 * throws and the configured secret's length is not leaked by an early size check.
 */
function constantTimeEquals(a, b) {
  const digestA = createHash("sha256").update(String(a)).digest();
  const digestB = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * @param {{ expectedSecret: string }} deps injected from config (D-17).
 * @returns Express middleware enforcing the Telegram webhook secret header (D-21).
 */
export function createWebhookSecretMiddleware({ expectedSecret }) {
  return function webhookSecret(req, res, next) {
    const provided = req.get("X-Telegram-Bot-Api-Secret-Token");
    if (!provided || !constantTimeEquals(provided, expectedSecret)) {
      sendError(res, 403, "FORBIDDEN", "invalid webhook secret");
      return;
    }
    next();
  };
}

/**
 * Express error handler (4 arguments) for the /webhook/telegram sub-tree only.
 * Always answers 200 {"ignored":"internal_error"} — a body value admitted by the
 * WebhookIgnored enum of the frozen contract — so Telegram never retries (I5).
 */
export function webhookGuard(err, req, res, _next) {
  logger.error({
    msg: "webhook_unhandled",
    errName: (err && err.name) || "Error",
    statusCode: 200,
  });
  res.status(200).json({ ignored: "internal_error" });
}
