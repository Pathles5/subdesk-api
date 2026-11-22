// smoke-live — run the 15 scenarios of docs/api/SubDesk.postman_collection.json against a LIVE URL.
// Used by deploy.yml `smoke` job after a real deploy (and runnable manually against the dev server).
// Era table: today (F04) the four endpoints answer 501 scaffolding; each phase that replaces a stub
// updates EXPECTED below (F05: webhook/GET drop 501; F06: PATCH; F07: reply; F08: reply full).
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
const ticketId = process.env.TICKET_ID || "2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7";

const collection = JSON.parse(fs.readFileSync("docs/api/SubDesk.postman_collection.json", "utf8"));
const vars = { baseUrl, adminApiKey, webhookSecret, ticketId };
const expand = (s) => String(s).replaceAll(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

// allowed statuses per scenario name, era-stub (F04). [200,501] means: 501 today, 200 once implemented.
const EXPECTED = {
  "Mensaje de texto valido → hoy 501 · Fase 04: 200 {received}": [200, 501],
  "SIN cabecera de secreto → 403 (definitivo)": [403],
  "Secreto ERRONEO → 403 (definitivo)": [403],
  "callback_query (no-mensaje) → hoy 501 · Fase 04: 200 {ignored:unsupported_update}": [200, 501],
  "GET /api/tickets SIN clave → 401 (definitivo)": [401],
  "GET /api/tickets clave INVALIDA → 403 (definitivo)": [403],
  "GET /api/tickets clave OK → hoy 501 · Fase 05: 200 {tickets,next_cursor}": [200, 501],
  "GET /api/tickets?status=PENDING → hoy 501 · Fase 05: 200 filtrado": [200, 501],
  "GET /api/tickets?status=BOGUS → hoy 501 · Fase 05: 400 VALIDATION_ERROR": [400, 501],
  "PATCH /api/tickets/{id} → IN_PROGRESS · hoy 501 · Fase 06: 200/404": [200, 400, 404, 501],
  "PATCH → reabrir a PENDING → hoy 501 · Fase 06: 400": [400, 501],
  "POST /api/tickets/{id}/reply → hoy 501 · Fase 07: 200/404/409/502": [200, 400, 404, 409, 502, 501],
  "POST reply con text vacio → hoy 501 · Fase 07: 400": [400, 501],
  "GET ruta inexistente → 404 envelope (definitivo)": [404],
  "GET /api/tickets clave OK con JSON roto en PATCH → 400 (definitivo)": [400],
};

// literal error messages frozen by the contract (openapi.yaml:288/298/309 + app 404)
const LITERALS = { 401: "missing x-api-key header", 403: null, 404: "no route for" };
const ERROR_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "ALREADY_RESOLVED", "TELEGRAM_SEND_FAILED", "INTERNAL"];

const requests = [];
for (const folder of collection.item) for (const sub of folder.item) requests.push(sub);

// drift guard: every collection request must have exactly one table row and vice versa
const names = new Set(requests.map((r) => r.name));
for (const n of names) if (!EXPECTED[n]) console.error(`DRIFT: collection request with no expectation row: ${n}`);
for (const n of Object.keys(EXPECTED)) if (!names.has(n)) console.error(`DRIFT: expectation row with no collection request: ${n}`);
if (names.size !== Object.keys(EXPECTED).length) {
  console.error("smoke-live: collection/table drift — update BOTH in the same commit (see era note at top).");
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
  if (ok) { pass++; console.log(`OK   ${sub.name} -> ${res.status}`); }
  else { failCount++; console.error(`FAIL ${sub.name} -> ${res.status} (allowed ${allowed.join("/")})`); }
}

console.log(`\nsmoke-live: ${pass}/${requests.length} ok contra ${baseUrl} (fallos ${failCount})`);
process.exit(failCount ? 1 : 0);
