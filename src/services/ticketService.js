// services/ticketService.js — the intake decision tree of POST /webhook/telegram
// (spec 05 §5.1, frozen precedence: first matching rule wins). Rules 0 (secret gate) and
// 1 (body parsing) live in the router/guard — this service receives an already-
// authenticated, already-parsed body and applies the remaining rules:
//   * shape checks -> the closed WebhookIgnored reasons of the contract (I3: the enum of
//     6 is frozen; adding a reason is a contract amendment, not a refactor);
//   * valid text message -> the exact 9-attribute item of spec 05 §5.2, persisted with
//     the conditional Put of the repository (D-19 idempotency, zero reads);
//   * repository errors PROPAGATE untouched: webhookGuard owns the translation to
//     {"ignored":"internal_error"} (I5). This service never try/catches them.
// Logging (D-18, spec 05 §5.6): exactly one line per ingestion, allowlisted fields only
// (msg, updateId, ticketId, ignoredReason, statusCode, durationMs) — NEVER the message
// text, headers or secrets. No AWS SDK here (D-16: services stay SDK-free).

import { ticketIdFor } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import {
  isBlankText,
  isMessageText,
  isPositiveInteger,
  isTelegramChatId,
} from "../utils/validation.js";

/** JSON object in the Telegram-payload sense: arrays and null are NOT usable objects. */
function isUsableObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * spec 05 §5.2: username = from.username, else from.first_name, else the ATTRIBUTE IS
 * OMITTED (never an empty string, never null — data-model.md strict schema).
 */
function pickUsername(from) {
  if (!isUsableObject(from)) {
    return undefined;
  }
  if (typeof from.username === "string" && from.username !== "") {
    return from.username;
  }
  if (typeof from.first_name === "string" && from.first_name !== "") {
    return from.first_name;
  }
  return undefined;
}

/**
 * @param {{
 *   repository: { createTicketIfAbsent(item: object): Promise<{created: boolean}> },
 *   logger: { info(fields: object): void, warn(fields: object): void },
 *   clock?: () => string
 * }} deps repository: the ticket repository (real or fake, D-23 — injected, never built
 * here); logger: D-18 logger; clock: timestamp source, injectable for deterministic
 * tests (defaults to nowIso).
 * @returns {{ ingestUpdate(update: unknown): Promise<{received: true} | {ignored: string}> }}
 * @throws {TypeError} when repository or logger are missing/malformed — a wiring mistake
 *         must break startup loudly, never ship a webhook that acks without persisting.
 */
export function createTicketService({ repository, logger, clock = nowIso }) {
  if (repository === null || typeof repository !== "object" || typeof repository.createTicketIfAbsent !== "function") {
    throw new TypeError("createTicketService: repository must expose a createTicketIfAbsent() method");
  }
  if (logger === null || typeof logger !== "object" || typeof logger.info !== "function" || typeof logger.warn !== "function") {
    throw new TypeError("createTicketService: logger must expose info() and warn() methods");
  }
  if (typeof clock !== "function") {
    throw new TypeError("createTicketService: clock must be a function returning an ISO timestamp");
  }

  /** The single log line of one ingestion (spec 05 §5.6): allowlisted fields only. */
  function logIngest(level, { updateId, ticketId, ignoredReason }, startedAt) {
    const fields = { msg: "webhook_ingest", statusCode: 200, durationMs: Date.now() - startedAt };
    if (updateId !== undefined) {
      fields.updateId = updateId;
    }
    if (ticketId !== undefined) {
      fields.ticketId = ticketId;
    }
    if (ignoredReason !== undefined) {
      fields.ignoredReason = ignoredReason;
    }
    logger[level](fields);
  }

  function ignore(reason, context, startedAt, level = "info") {
    logIngest(level, { ...context, ignoredReason: reason }, startedAt);
    return { ignored: reason };
  }

  /**
   * Apply the frozen precedence of spec 05 §5.1 to one parsed update.
   * Resolves { received: true } when the ticket was created, { ignored: "<reason>" } for
   * every discard; repository failures REJECT (propagated to webhookGuard, rule 10).
   */
  async function ingestUpdate(update) {
    const startedAt = Date.now();

    // Rule 2 (shape): the payload itself must be a JSON object.
    if (!isUsableObject(update)) {
      return ignore("unsupported_update", {}, startedAt);
    }
    // Rule 2: update_id must be an integer >= 1 (no updateId is logged for garbage).
    if (!isPositiveInteger(update.update_id)) {
      return ignore("unsupported_update", {}, startedAt);
    }
    const updateId = update.update_id;

    // Rule 3: only plain `message` updates are usable (callback_query, channel_post,
    // edited_message, poll, inline_query, ... are ignored; D-71 will reduce their flow).
    const message = update.message;
    if (!isUsableObject(message)) {
      return ignore("unsupported_update", { updateId }, startedAt);
    }

    // Rule 4: a usable chat id is what makes the ticket addressable (F08 replies to it).
    if (!isTelegramChatId(message.chat?.id)) {
      return ignore("chat_not_found", { updateId }, startedAt);
    }

    // Rule 5: text messages only (photos, voice, stickers, ... are out of scope, I1).
    if (typeof message.text !== "string") {
      return ignore("no_text", { updateId }, startedAt);
    }

    // Rule 6: whitespace-only text carries no request.
    if (isBlankText(message.text)) {
      return ignore("empty_message", { updateId }, startedAt);
    }

    // Rule 7 (defensive; Telegram never exceeds 4096): over-long text is NEVER truncated
    // — truncation would corrupt message_content ("texto íntegro", data-model.md).
    if (!isMessageText(message.text)) {
      return ignore("unsupported_update", { updateId }, startedAt, "warn");
    }

    // Rules 8-9: build the exact item of spec 05 §5.2 and let the conditional Put decide.
    const timestamp = clock();
    const item = {
      id: ticketIdFor(updateId),
      telegram_chat_id: String(message.chat.id),
      message_content: message.text, // verbatim: no trim, no normalization (§5.2)
      status: "PENDING",
      created_at: timestamp,
      updated_at: timestamp,
      telegram_update_id: updateId, // NUMBER, not string (strict schema)
    };
    const username = pickUsername(message.from);
    if (username !== undefined) {
      item.username = username;
    }

    // Rule 10: any repository error propagates UNCHANGED — webhookGuard translates it to
    // {"ignored":"internal_error"} and logs the error NAME only (I5, D-18). No try/catch.
    const outcome = await repository.createTicketIfAbsent(item);

    if (outcome?.created === true) {
      // Rule 8.
      logIngest("info", { updateId, ticketId: item.id }, startedAt);
      return { received: true };
    }
    // Rule 9: the conditional Put lost (sequential retry or concurrent race). A
    // duplicate is an expected, benign outcome: logged at info like a success.
    logIngest("info", { updateId, ticketId: item.id, ignoredReason: "duplicate" }, startedAt);
    return { ignored: "duplicate" };
  }

  return { ingestUpdate };
}
