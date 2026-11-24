import express from "express";

import { webhookGuard } from "./middleware/webhookGuard.js";
import { createTicketService } from "./services/ticketService.js";
import { createLogger } from "./utils/logger.js";
import { createTelegramRouter } from "./routes/telegram.js";
import { createTicketsRouter } from "./routes/tickets.js";
import { bodyParserRejectionMessage, isBodyParserRejection, sendError } from "./utils/http.js";

// app.js — the entire HTTP surface behind one factory (D-16/D-27): the same Express tree
// runs under the Lambda adapter (lambda.js), under `pnpm run dev` (local.js) and under
// supertest in the tests (D-23), without AWS, Telegram or network.
//
// CORS: ZERO code here (I4). Headers are declared ONLY in the Function URL Cors config in
// IaC; emitting them in Express duplicates Access-Control-Allow-Origin and breaks
// preflight. The `cors` package must never enter this project.

/**
 * @param {{ config: object, logger?: object, ticketRepository: object }} deps — config
 *        arrives by DI (D-17); the logger defaults to config.logLevel; ticketRepository
 *        is MANDATORY with no default on purpose (validated user decision, phase 05):
 *        a wiring mistake must break startup loudly instead of shipping a webhook that
 *        acks without persisting. lambda.js injects the real repository; local.js and
 *        the tests inject the in-memory fake. Never calls app.listen(): the two
 *        entrypoints (lambda.js / local.js) own that.
 * @returns Express app
 * @throws {TypeError} when ticketRepository is missing or malformed.
 */
export function createApp({ config, logger = createLogger(config.logLevel), ticketRepository }) {
  if (
    ticketRepository === null ||
    typeof ticketRepository !== "object" ||
    typeof ticketRepository.createTicketIfAbsent !== "function"
  ) {
    throw new TypeError(
      "createApp: ticketRepository is required and must expose createTicketIfAbsent() — " +
        "inject the real repository (lambda.js) or the in-memory fake (local.js / tests)"
    );
  }

  const app = express();

  // Intake service of the webhook (spec 05 §5.1): built here with the injected
  // repository and logger, then handed to the router. No AWS SDK above repositories (D-16).
  const ticketService = createTicketService({ repository: ticketRepository, logger });

  // --- Webhook sub-tree (mounted BEFORE the global JSON parser on purpose): the router
  // runs the secret gate FIRST (D-70) and then parses its own body, so a malformed
  // Telegram payload throws INSIDE the sub-tree and lands on webhookGuard — the contract
  // requires 200 {"ignored":"unsupported_update"} for parse failures and 200
  // {"ignored":"internal_error"} for any other exception (I5). app.js attaches the guard
  // at the END of the router (4-argument error middleware), so nothing escapes to the
  // global handler.
  const telegramRouter = createTelegramRouter({ config, ticketService });
  telegramRouter.use(webhookGuard);
  app.use("/webhook/telegram", telegramRouter);

  // --- Global JSON body parser for the rest of the surface (64 KB limit, well under the
  // Function URL payload cap).
  app.use(express.json({ limit: "64kb" }));

  // --- Panel sub-tree: x-api-key is enforced by createApiKeyMiddleware inside the
  // router, before any handler and therefore before any DynamoDB access (I4).
  app.use("/api/tickets", createTicketsRouter({ config }));

  // --- Bad request bodies on the remaining routes -> 400 VALIDATION_ERROR envelope.
  // The five body-parser rejections of D-62 are recognized and messaged by the shared
  // helpers of utils/http.js (single enumeration; the webhook sub-tree consumes the same
  // predicate to answer 200 unsupported_update instead). No client error may surface as
  // a 500 INTERNAL from globalErrorHandler.
  app.use(function bodyParserErrorHandler(err, req, res, next) {
    if (isBodyParserRejection(err)) {
      sendError(res, 400, "VALIDATION_ERROR", bodyParserRejectionMessage(err));
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
