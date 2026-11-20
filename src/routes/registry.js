// routes/registry.js — the SINGLE source of truth for the public HTTP surface.
// tests/contract/openapi.test.js compares this list against docs/api/openapi.yaml
// (I8b.4): paths + methods must match, and the security expectation declared here must
// agree with the contract (api-key routes -> ApiKeyAuth security; webhook-secret route ->
// the X-Telegram-Bot-Api-Secret-Token parameter and no operation security).
// Adding, removing or re-securing a route requires updating registry, routers and the
// contract together — contract drift fails the gate.

export const ROUTES = [
  { method: "POST", path: "/webhook/telegram", security: "webhook-secret", phase: 4 },
  { method: "GET", path: "/api/tickets", security: "api-key", phase: 5 },
  { method: "PATCH", path: "/api/tickets/:id", security: "api-key", phase: 6 },
  { method: "POST", path: "/api/tickets/:id/reply", security: "api-key", phase: 7 },
];

// Methods an OpenAPI path item may carry; reused by the contract test to walk doc.paths.
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

/**
 * Convert an Express path to its OpenAPI templating equivalent (":id" -> "{id}").
 */
export function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}
