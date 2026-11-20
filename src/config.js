// config.js — the single reader of process.env in the project (D-17).
// Every other module receives its configuration through dependency injection, so ESLint
// only allows process.env here (see eslint.config.js).
//
// I4: failure paths must never echo secret VALUES. A ConfigError message lists only the
// NAMES of the offending variables.

const REQUIRED_NAMES = ["TABLE_NAME", "TELEGRAM_BOT_TOKEN", "ADMIN_API_KEY", "TELEGRAM_WEBHOOK_SECRET"];

const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function isFilled(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validate the environment and return a frozen config object.
 * @param {Record<string, string | undefined>} env source of variables (D-17 contract);
 *        defaults to process.env so tests can pass a plain fake object (D-23).
 * @returns {Readonly<{
 *   tableName: string, telegramBotToken: string, adminApiKey: string,
 *   telegramWebhookSecret: string, logLevel: string, stage: string, port: number
 * }>}
 * @throws {ConfigError} listing variable NAMES only, never values (I4).
 */
export function loadConfig(env = process.env) {
  const missing = REQUIRED_NAMES.filter((name) => !isFilled(env[name]));
  if (missing.length > 0) {
    throw new ConfigError(`missing required environment variables: ${missing.join(", ")}`);
  }

  const logLevel = isFilled(env.LOG_LEVEL) ? env.LOG_LEVEL.trim() : "info";
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}`);
  }

  const stage = isFilled(env.STAGE) ? env.STAGE.trim() : "dev";

  // PORT only makes sense locally (src/local.js); the Function URL runtime never reads it.
  let port = 3000;
  if (isFilled(env.PORT)) {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError("PORT must be an integer between 1 and 65535");
    }
  }

  return Object.freeze({
    tableName: env.TABLE_NAME,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    adminApiKey: env.ADMIN_API_KEY,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    logLevel,
    stage,
    port,
  });
}
