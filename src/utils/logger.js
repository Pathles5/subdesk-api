// utils/logger.js — D-18 logging policy enforced BY CONSTRUCTION.
// One JSON line per event: { level, ts, msg, ...event fields }.
// Expected event fields (D-18 allowlist): ticketId, updateId, statusCode, durationMs.
// Any field whose name is known to carry a secret or user content is replaced with
// "[redacted]" before serialization; for strings the length is exposed as "<field>Length"
// instead of the value (I4: tokens, api keys, webhook secrets and message text never log).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// D-18 / I4: names blocked from appearing with their value in any log line.
const REDACTED_FIELDS = new Set([
  "botToken",
  "telegramBotToken",
  "adminApiKey",
  "apiKey",
  "webhookSecret",
  "messageContent",
  "text",
  "x-api-key",
]);

/**
 * Create a severity-filtered JSON logger (debug < info < warn < error; "silent" emits nothing).
 * @param {"debug"|"info"|"warn"|"error"|"silent"} level threshold from config.logLevel
 */
export function createLogger(level = "info") {
  const threshold = Object.hasOwn(LEVELS, level) ? LEVELS[level] : LEVELS.info;

  function emit(eventLevel, fields) {
    if (LEVELS[eventLevel] < threshold) {
      return;
    }
    const entry = { level: eventLevel, ts: Date.now() };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (REDACTED_FIELDS.has(key)) {
        entry[key] = "[redacted]";
        if (typeof value === "string") {
          entry[`${key}Length`] = value.length;
        }
      } else {
        entry[key] = value;
      }
    }
    // JSON.stringify of a plain object cannot leak prototypes or functions; circular
    // structures are prevented by keeping events flat (documented constraint, D-18).
    console.log(JSON.stringify(entry));
  }

  return {
    debug: (fields) => emit("debug", fields),
    info: (fields) => emit("info", fields),
    warn: (fields) => emit("warn", fields),
    error: (fields) => emit("error", fields),
  };
}
