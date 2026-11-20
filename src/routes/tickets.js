import { Router } from "express";

import { createApiKeyMiddleware } from "../middleware/apiKey.js";
import { notImplemented } from "../utils/http.js";

// routes/tickets.js — the panel surface (GET list, PATCH status, POST reply).
// Mounted by app.js at "/api/tickets". Every request passes the x-api-key middleware
// BEFORE any handler runs, hence before any DynamoDB access (I4).

/**
 * @param {{ config: object }} deps injected by createApp (D-17: config arrives by DI).
 */
export function createTicketsRouter({ config }) {
  const router = Router();

  router.use(createApiKeyMiddleware({ adminApiKey: config.adminApiKey }));

  // Scaffold stubs: real handlers arrive in phases 05, 06 and 07 (registry.js is the source).
  router.get("/", notImplemented(5));
  router.patch("/:id", notImplemented(6));
  router.post("/:id/reply", notImplemented(7));

  return router;
}
