// utils/http.js — pure HTTP response helpers (D-16: utils layer, no I/O, no config).
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

/**
 * Scaffold stub handler (spec §4b): routes implemented by a later phase answer
 * 501 with {"error":{"code":"INTERNAL","message":"not implemented yet — Fase N"}}.
 * 501 is scaffold state, NOT contract: phases 04-07 replace each stub with the real
 * handler and freeze that endpoint's codes in the same commit as its contract test.
 */
export function notImplemented(fase) {
  return (req, res) => {
    sendError(res, 501, "INTERNAL", `not implemented yet — Fase ${fase}`);
  };
}
