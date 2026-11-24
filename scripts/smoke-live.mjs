// smoke-live — run the 15 scenarios of docs/api/SubDesk.postman_collection.json against a LIVE URL.
// Used by deploy.yml `smoke` job after a real deploy (and runnable manually against the dev server).
// Era table: scenario NAMES describe the CONTRACTUAL outcome and are meant to never change again;
// the era lives only in the allowed-status arrays below, which each phase tightens as it replaces a
// stub (that was the point of doing the renumbering in ONE pass, spec 04 A-12(a)).
// Today (F05): the webhook is LIVE (200 only, 501 no longer allowed) while GET/PATCH/reply still
// answer 501 scaffolding until F06/F07/F08.
// Secrets come ONLY from env (never printed); error bodies are safe to print (openapi ApiError says
// the message never contains secrets). Drift guard: collection names and this table must match 1:1.
import fs from "node:fs";

const env = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`FAIL missing env ${name}`);
    process.exit(2);
  }
  return v;
};
const baseUrl = env("FUNCTION_URL").replace(/\/+$/, "");
const adminApiKey = env("ADMIN_API_KEY");
const webhookSecret = env("TELEGRAM_WEBHOOK_SECRET");
// Default id = the contract example, which since D-69/D-75 IS a real uuidv5(TG_UPDATE_NS,
// "tg:482391756"). The value dictated before D-75 was miscalculated and must not resurface.
const ticketId = process.env.TICKET_ID || "f53dea7a-383f-510d-b6ff-eddd5270f4b6";

const collection = JSON.parse(fs.readFileSync("docs/api/SubDesk.postman_collection.json", "utf8"));
const vars = { baseUrl, adminApiKey, webhookSecret, ticketId };
const expand = (s) => String(s).replaceAll(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

// Allowed statuses per scenario. The NAMES are era-independent — they state the contractual outcome
// and are meant to stop changing — while the arrays encode the CURRENT era and get tightened phase
// by phase (F05 dropped 501 for the webhook; F06 will drop it for GET; F07 PATCH; F08 reply).
const EXPECTED = {
  "Mensaje de texto valido → 200 received": [200],
  "SIN cabecera de secreto → 403": [403],
  "Secreto ERRONEO → 403": [403],
  "callback_query (no-mensaje) → 200 ignored unsupported_update": [200],
  "GET /api/tickets SIN clave → 401": [401],
  "GET /api/tickets clave INVALIDA → 403": [403],
  "GET /api/tickets clave OK → 200 tickets": [200, 501],
  "GET /api/tickets?status=PENDING → 200 filtrado": [200, 501],
  "GET /api/tickets?status=BOGUS → 400 VALIDATION_ERROR": [400, 501],
  "PATCH a IN_PROGRESS → 200": [200, 400, 404, 501],
  "PATCH → reabrir a PENDING → 400": [400, 501],
  "POST reply con texto valido → 200": [200, 400, 404, 409, 502, 501],
  "POST reply con text vacio → 400": [400, 501],
  "GET ruta inexistente → 404 envelope": [404],
  "PATCH con JSON roto → 400": [400],
};

// literal error messages frozen by the contract (openapi.yaml:288/298/309 + app 404)
const LITERALS = { 401: "missing x-api-key header", 403: null, 404: "no route for" };
const ERROR_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "ALREADY_RESOLVED", "TELEGRAM_SEND_FAILED", "INTERNAL"];

// webhook 200 bodies are the frozen oneOf of the contract (WebhookReceived | WebhookIgnored).
// Both schemas are strict (additionalProperties: false), so exactly one key is allowed; `ignored`
// is a closed enum of six reasons (spec 05 §5.1). Checking the shape here is what turns the smoke
// from "something answered 200" into "the ingestion contract holds against the live URL".
const IGNORED_REASONS = ["no_text", "empty_message", "chat_not_found", "unsupported_update", "duplicate", "internal_error"];
const isWebhookAck = (b) => {
  if (b === null || typeof b !== "object") return false;
  if (Object.keys(b).length !== 1) return false;
  return b.received === true || (typeof b.ignored === "string" && IGNORED_REASONS.includes(b.ignored));
};

const requests = [];
for (const folder of collection.item) for (const sub of folder.item) requests.push(sub);

// drift guard: every collection request must have exactly one table row and vice versa.
// The abort MUST trigger on any mismatched name, not only on a count difference: renaming a
// scenario 1:1 keeps both sizes equal, and the old count-only check let that through — the run then
// died later on `EXPECTED[sub.name]` being undefined (demonstrated 2026-11-23: 30 DRIFT lines
// printed, exit 1, 15 requests already fired). Drift is a build error, so it aborts before any HTTP.
const names = new Set(requests.map((r) => r.name));
let drift = 0;
for (const n of names) if (!EXPECTED[n]) { drift++; console.error(`DRIFT: collection request with no expectation row: ${n}`); }
for (const n of Object.keys(EXPECTED)) if (!names.has(n)) { drift++; console.error(`DRIFT: expectation row with no collection request: ${n}`); }
if (drift > 0 || names.size !== Object.keys(EXPECTED).length) {
  console.error(`smoke-live: collection/table drift (${drift} mismatched name(s)) - update BOTH in the same commit (see era note at top).`);
  process.exit(2);
}

let pass = 0;
let failCount = 0;
for (const sub of requests) {
  const r = sub.request;
  const url = expand(r.url.raw);
  const headers = Object.fromEntries((r.header ?? []).map((h) => [h.key, expand(h.value)]));
  let res, body;
  try {
    res = await fetch(url, { method: r.method, headers, body: r.body ? expand(r.body.raw) : undefined });
    body = await res.json().catch(() => null);
  } catch (e) {
    console.error(`FAIL ${sub.name} -> network error: ${e.message}`);
    failCount++;
    continue;
  }
  const allowed = EXPECTED[sub.name];
  let ok = allowed.includes(res.status);
  if (ok && body?.error) {
    if (!ERROR_CODES.includes(body.error.code)) { ok = false; console.error(`FAIL ${sub.name} -> error.code not in contract enum: ${JSON.stringify(body.error.code)}`); }
    else if (LITERALS[res.status] && !String(body.error.message ?? "").includes(LITERALS[res.status])) { ok = false; console.error(`FAIL ${sub.name} -> message "${body.error.message}" != contract literal "${LITERALS[res.status]}"`); }
  }
  if (ok && res.status === 200 && url.includes("/webhook/telegram") && !isWebhookAck(body)) {
    ok = false;
    console.error(`FAIL ${sub.name} -> webhook 200 body is neither WebhookReceived nor WebhookIgnored: ${JSON.stringify(body).slice(0, 200)}`);
  }
  if (ok) { pass++; console.log(`OK   ${sub.name} -> ${res.status}`); }
  else { failCount++; console.error(`FAIL ${sub.name} -> ${res.status} (allowed ${allowed.join("/")})`); }
}

console.log(`\nsmoke-live: ${pass}/${requests.length} ok contra ${baseUrl} (fallos ${failCount})`);
process.exit(failCount ? 1 : 0);
