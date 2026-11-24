import express from "express";

import { createWebhookSecretMiddleware } from "../middleware/webhookGuard.js";
import { sendJson } from "../utils/http.js";

// routes/telegram.js — POST /webhook/telegram, the public intake (phase 05: real
// handler, no longer a 501 stub). Mounted by app.js at "/webhook/telegram" where the
// sub-tree also receives its local error guard (webhookGuard, I5): exceptions raised
// inside THIS router — body-parser rejections and service/repository failures included —
// land there and never reach the global handler.

/**
 * @param {{ config: object, ticketService: { ingestUpdate(update: unknown): Promise<object> } }} deps
 *        injected by createApp (D-17: config arrives by DI; the service is built there
 *        with the repository and the logger).
 */
export function createTelegramRouter({ config, ticketService }) {
  const router = express.Router();

  // D-70: the secret gate runs BEFORE the body parser — the 403 must never depend on the
  // body content, and JSON from unauthenticated senders is never parsed. Wrong secret
  // plus broken body answers 403, exactly as openapi.yaml prescribes.
  router.use(createWebhookSecretMiddleware({ expectedSecret: config.telegramWebhookSecret }));

  // Parsing lives INSIDE the guarded sub-tree (mounted before the global parser in
  // app.js): a Telegram body that fails to parse throws here and webhookGuard absorbs it
  // into the contractual 200 {"ignored":"unsupported_update"} (spec 05 §5.1 rule 1).
  router.use(express.json({ limit: "64kb" }));

  // Handler with NO try/catch on purpose: every exception must bubble to webhookGuard,
  // which owns the 2xx ack for internal errors (I5). Express 5 forwards rejected async
  // handlers to the error middleware automatically. The outcome object is answered
  // verbatim: {received:true} or {ignored:"<reason>"}, always 200.
  router.post("/", async (req, res) => {
    const outcome = await ticketService.ingestUpdate(req.body);
    sendJson(res, 200, outcome);
  });

  return router;
}
