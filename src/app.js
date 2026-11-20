import express from "express";

import { webhookGuard } from "./middleware/webhookGuard.js";
import { createLogger } from "./utils/logger.js";
import { createTelegramRouter } from "./routes/telegram.js";
import { createTicketsRouter } from "./routes/tickets.js";
import { sendError } from "./utils/http.js";

// app.js — the entire HTTP surface behind one factory (D-16/D-27): the same Express tree
// runs under the Lambda adapter (lambda.js), under `pnpm run dev` (local.js) and under
// supertest in the tests (D-23), without AWS, Telegram or network.
//
// CORS: ZERO code here (I4). Headers are declared ONLY in the Function URL Cors config in
// IaC; emitting them in Express duplicates Access-Control-Allow-Origin and breaks
// preflight. The `cors` package must never enter this project.

/**
 * @param {{ config: object, logger?: object }} deps — config arrives by DI (D-17);
 *        the logger defaults to config.logLevel. Never calls app.listen(): the two
 *        entrypoints (lambda.js / local.js) own that.
 * @returns Express app
 */
export function createApp({ config, logger = createLogger(config.logLevel) }) {
  const app = express();

  // --- Webhook sub-tree (mounted BEFORE the global JSON parser on purpose): the router
  // parses its own body, so a malformed Telegram payload throws INSIDE the sub-tree and
  // lands on webhookGuard — the contract requires a 2xx ack for parse failures too.
  // app.js attaches the guard at the END of the router (4-argument error middleware),
  // so any exception thrown by the secret gate or the route handlers is answered 200
  // { ignored: "internal_error" } here and never reaches the global handler (I5).
  const telegramRouter = createTelegramRouter({ config });
  telegramRouter.use(webhookGuard);
  app.use("/webhook/telegram", telegramRouter);

  // --- Global JSON body parser for the rest of the surface (64 KB limit, well under the
  // Function URL payload cap).
  app.use(express.json({ limit: "64kb" }));

  // --- Panel sub-tree: x-api-key is enforced by createApiKeyMiddleware inside the
  // router, before any handler and therefore before any DynamoDB access (I4).
  app.use("/api/tickets", createTicketsRouter({ config }));

  // --- JSON parse failures on the remaining routes -> 400 VALIDATION_ERROR envelope
  // (body-parser reports them as err.type === "entity.parse.failed").
  app.use(function jsonParseErrorHandler(err, req, res, next) {
    if (err && err.type === "entity.parse.failed") {
      sendError(res, 400, "VALIDATION_ERROR", "invalid JSON body");
      return;
    }
    next(err);
  });

  // --- 404: closed envelope for any unmatched route (never the Express HTML default).
  app.use(function notFoundHandler(req, res) {
    sendError(res, 404, "NOT_FOUND", `no route for ${req.method} ${req.path}`);
  });

  // --- Last-resort error handler (the /api tree may answer 5xx by design; the webhook
  // never reaches here because webhookGuard answers inside its own sub-tree, I5).
  // Only the error NAME is logged: never req.body, never headers (D-18).
  app.use(function globalErrorHandler(err, req, res, _next) {
    logger.error({
      msg: "http_unhandled",
      errName: (err && err.name) || "Error",
      statusCode: 500,
    });
    sendError(res, 500, "INTERNAL", "internal error");
  });

  return app;
}
