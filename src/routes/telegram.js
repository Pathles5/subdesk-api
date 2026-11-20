import express from "express";

import { createWebhookSecretMiddleware } from "../middleware/webhookGuard.js";
import { notImplemented } from "../utils/http.js";

// routes/telegram.js — POST /webhook/telegram (public intake, phase 04 implements it).
// Mounted by app.js at "/webhook/telegram" where the sub-tree also receives its local
// error guard (webhookGuard, I5): exceptions raised inside THIS router must land there
// and never reach the global handler.

/**
 * @param {{ config: object }} deps injected by createApp (D-17: config arrives by DI).
 */
export function createTelegramRouter({ config }) {
  const router = express.Router();

  // Parsing lives INSIDE the guarded sub-tree (mounted before the global parser in
  // app.js): a Telegram body that fails to parse throws here, webhookGuard absorbs it
  // into the 2xx ack, and the frozen contract is honored from day one.
  router.use(express.json({ limit: "64kb" }));

  // D-21 / I5: the only non-2xx case of the webhook is a missing or wrong secret token.
  router.use(createWebhookSecretMiddleware({ expectedSecret: config.telegramWebhookSecret }));

  // Scaffold stub: body extraction, dedup by update_id and ticket creation arrive in phase 04.
  router.post("/", notImplemented(4));

  return router;
}
