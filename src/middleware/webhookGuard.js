import { createHash, timingSafeEqual } from "node:crypto";

import { isBodyParserRejection, sendError } from "../utils/http.js";
import { createLogger } from "../utils/logger.js";

// middleware/webhookGuard.js — the two halves of the webhook contract (D-21 / I5):
// (a) createWebhookSecretMiddleware: the single non-2xx case of POST /webhook/telegram
//     (missing or wrong X-Telegram-Bot-Api-Secret-Token -> 403); since D-70 it runs
//     BEFORE the body parser inside the router;
// (b) webhookGuard: an error handler that turns ANY failure inside the webhook sub-tree
//     into a 200 ack, because a 5xx or an uncaught exception makes Telegram treat the
//     update as undelivered and retry in a loop (I5). Body-parser rejections (the five
//     of D-62, via the shared isBodyParserRejection) answer the contractual
//     {"ignored":"unsupported_update"}; every other error answers {"ignored":"internal_error"}.

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
 * Discriminates the two 200 acks of spec 05 §5.1 (I5):
 *   * rule 1 — a body-parser rejection (unparseable, oversized, bad charset/encoding or
 *     failed decompression) -> 200 {"ignored":"unsupported_update"}, the value the
 *     frozen contract prescribes (openapi.yaml, /webhook/telegram description). Logged
 *     at info with the error NAME only; the gate of D-70 guarantees this path is only
 *     reachable with a valid secret, so it is not an unauthenticated log-spam vector.
 *   * rule 10 — ANY other error (service/repository failures included) ->
 *     200 {"ignored":"internal_error"}, logged at error with the error NAME only.
 * Never logged: the body, headers or any user content (D-18).
 */
export function webhookGuard(err, req, res, _next) {
  if (isBodyParserRejection(err)) {
    logger.info({
      msg: "webhook_body_rejected",
      errName: (err && err.name) || "Error",
      statusCode: 200,
    });
    res.status(200).json({ ignored: "unsupported_update" });
    return;
  }
  logger.error({
    msg: "webhook_unhandled",
    errName: (err && err.name) || "Error",
    statusCode: 200,
  });
  res.status(200).json({ ignored: "internal_error" });
}
