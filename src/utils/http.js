// utils/http.js — pure HTTP helpers (D-16: utils layer, no I/O, no config) plus the
// SINGLE enumeration of the body-parser rejection vocabulary (D-62), consumed by the two
// surfaces that must translate it:
//   * /api/*     -> 400 VALIDATION_ERROR envelope (app.js bodyParserErrorHandler)
//   * /webhook/* -> 200 {"ignored":"unsupported_update"} (webhookGuard, spec 05 §5.1 rule 1)
// Every error payload uses the single ApiError envelope of the contract (D-20):
// { "error": { "code", "message" } }.

/**
 * Build the closed ApiError envelope (docs/api/openapi.yaml components.schemas.ApiError).
 */
export function errorBody(code, message) {
  return { error: { code, message } };
}

/**
 * Send a JSON body with an explicit status code.
 */
export function sendJson(res, status, body) {
  res.status(status).json(body);
}

/**
 * Send the ApiError envelope.
 */
export function sendError(res, status, code, message) {
  sendJson(res, status, errorBody(code, message));
}

// The FIVE body-parser rejections of D-62, enumerated exactly ONCE here (spec 05 §2).
// Four carry the err.type they are keyed by: malformed JSON, oversized body (> the 64 KB
// limit), unsupported charset and unsupported content-encoding. The FIFTH — a failed
// decompression of the declared Content-Encoding (gzip/br/deflate/zstd) — arrives with
// err.type === null, name "Error", expose true and status 400 set by http-errors, so it
// is covered by the bounded status fallback inside isBodyParserRejection. ALL of them
// are client-triggerable: on /api/* the frozen contract documents exactly one status for
// a bad request body — 400 VALIDATION_ERROR (413 & co. do NOT exist in openapi.yaml);
// on the webhook they are absorbed into the 2xx ack (I5).
export const BODY_PARSER_ERROR_MESSAGES = Object.freeze({
  "entity.parse.failed": "invalid JSON body",
  "entity.too.large": "request body too large",
  "charset.unsupported": "unsupported charset",
  "encoding.unsupported": "unsupported content encoding",
});

// Message of the fifth rejection (failed decompression, err.type === null).
export const BODY_PARSER_FALLBACK_MESSAGE = "invalid request body";

/**
 * True when err is one of the five body-parser rejections of D-62: the four typed ones
 * (BODY_PARSER_ERROR_MESSAGES) or the bounded fallback err.status === 400. The fallback
 * is deliberately scoped to 400 ONLY: 401/403/404/409 belong to other contract codes and
 * are answered by sendError inside their own middleware, never by falling through here.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isBodyParserRejection(err) {
  if (err === null || typeof err !== "object") {
    return false;
  }
  if (typeof err.type === "string" && Object.hasOwn(BODY_PARSER_ERROR_MESSAGES, err.type)) {
    return true;
  }
  return err.status === 400;
}

/**
 * The frozen /api/* message for a body-parser rejection (D-62): the mapped literal for
 * the four typed rejections, the fallback message for the untyped fifth one. Call only
 * with errors for which isBodyParserRejection(err) is true.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function bodyParserRejectionMessage(err) {
  const mapped =
    err !== null && typeof err === "object" && typeof err.type === "string"
      ? BODY_PARSER_ERROR_MESSAGES[err.type]
      : undefined;
  return typeof mapped === "string" ? mapped : BODY_PARSER_FALLBACK_MESSAGE;
}

/**
 * Scaffold stub handler (spec §4b): routes implemented by a later phase answer
 * 501 with {"error":{"code":"INTERNAL","message":"not implemented yet — Fase N"}}.
 * 501 is scaffold state, NOT contract: phases 05-08 replace each stub with the real
 * handler and freeze that endpoint's codes in the same commit as its contract test
 * (post-D-42 numbering: 05 intake, 06 read, 07 mutate, 08 reply). After phase 05 the
 * webhook no longer uses this helper; only the three /api/tickets stubs remain.
 */
export function notImplemented(fase) {
  return (req, res) => {
    sendError(res, 501, "INTERNAL", `not implemented yet — Fase ${fase}`);
  };
}
