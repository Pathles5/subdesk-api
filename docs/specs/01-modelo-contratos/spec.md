# Spec — Fase 01 · Modelo de datos y contratos de API

Estado de fase: **spec** (ver `docs/specs/INDEX.md`; el estado no vive aquí)
Dependencias: Fase 00 (`verified · approved`) — topología D-27, capas D-16, config D-17, logs D-18.
Compuerta: `powershell -File scripts/check.ps1` en verde; esquema estricto de `TicketsTable`, enum de estado, errores y códigos HTTP documentados; idempotencia del webhook decidida; `docs/api/openapi.yaml` + `docs/human/functional/api.md` existentes y **sin ejemplos con secretos** (AGENTS §4). Contrato de referencia vinculante para el panel frontend (I3): cambiarlo después es enmienda, no refactor.

## 1. Objetivo

Congelar las dos superficies que consume todo lo demás:

1. **Modelo de datos** de `TicketsTable` (D-19): atributos, tipos DynamoDB, enum `status`, política de idempotencia por `update_id` sin índices (I2/D-26).
2. **Contratos de los 4 endpoints** (D-20): formas exactas de éxito y error, códigos HTTP, paginación, filtro y orden; más el cierre de la validación del secret del webhook (D-21) y la política de validación de entrada (D-22).

Entregables documentales de la fase (I8c): `docs/api/openapi.yaml` (contrato machine-readable, **propiedad del orquestador**, ruta única tras D-34), `docs/human/functional/api.md` (API en lenguaje humano) y `docs/human/technical/data-model.md` (la tabla contada a una persona).

## 2. Alcance

- Esquema estricto del ítem DynamoDB con tipos (`S`/`N`), atributos opcionales y qué campos del update de Telegram se guardan y cuáles no.
- Decisiones D-19, D-20, D-21 (cierre), D-22 propuestas con opciones, elección, motivo y riesgo.
- El documento `openapi.yaml` completo (OpenAPI 3.1): 4 paths, schemas, respuestas de error con envelope cerrado, ejemplos sin secretos.
- Errores y códigos HTTP: enum cerrado de `error.code`.
- Paginación del `Scan` y su representación en el contrato (opaco para el cliente).
- Reglas de entrada por campo (límites, patrones) que la Fase 04–07 implementará como guards manuales.

## 3. Fuera de alcance

- Handlers, servicios, repos ni tests de código (Fases 02+). `src/` no nace aquí.
- El `template.yaml` (Fase 03): esta fase fija el **esquema lógico**; el IaC lo materializa.
- Cualquier despliegue o llamada real a Telegram (I6).
- Autorización granular, multi-bot, adjuntos, callbacks de Telegram (fuera de v1, brief §10).

## 4. D-19 — Modelo de datos `TicketsTable` (propuesta)

### 4.1 Ítem (esquema estricto: atributos no listados se ignoran a la lectura y nunca se escriben)

| Atributo | Tipo DynamoDB | ¿Obligatorio? | Origen / regla |
|---|---|---|---|
| `id` | `S` (UUID RFC 4122 **v5**, determinista) | sí | `uuidv5(NS, "tg:" + update_id)` — ver 4.2. Sale de `utils/ids.js`; el panel lo trata como opaco |
| `telegram_chat_id` | `S` (dígitos 1–20, puede ir en negativo para grupos) | sí | `update.message.chat.id`; **string** para evitar trampas de precisión y porque `sendMessage` lo acepta como string |
| `username` | `S` (1–64) o ausente | no | `from.username`; si falta, se guarda `from.first_name` (fallback de display). Si falta también el nombre, atributo ausente |
| `message_content` | `S` (1–4096) | sí | `update.message.text` íntegro (es el contenido del ticket; lo prohibido es **loguearlo**, D-18) |
| `response_text` | `S` (1–4096) o ausente | no | Solo lo escribe `reply` (Fase 07) **tras** OK de Telegram; ausente hasta entonces |
| `status` | `S` enum cerrado: `PENDING` \| `IN_PROGRESS` \| `RESOLVED` | sí | Nace en `PENDING` (brief §5.4). Sin otros valores; se rechazan con `400` |
| `created_at` | `S` ISO 8601 UTC con `Z` | sí | `utils/time.js`; inmutable tras el alta |
| `updated_at` | `S` ISO 8601 UTC con `Z` | sí | Se refresca en toda mutación (PATCH, reply) |
| `telegram_update_id` | `N` (entero positivo de Telegram) | sí | Se guarda para trazabilidad/depuración; la deduplicación real es la del 4.2 (no necesita este atributo) |

- **Sin atributos extra**: nada de `message_id`, `date` del update, flags bot/channel, ni `version` (no hay concurrencia real en v1; PATCH usa `condition: attribute_exists(id)`).
- Índices: **ninguno** (ni GSI ni LSI) — prohibidos por I2/D-26 hasta la fase 10.
- Clase Standard, `PROVISIONED` 25/25, 1 región; tamaño de ítem: objetivo típico ~2 KB; **peor caso** ~33 KB (los guards miden 1–4096 **caracteres**, DynamoDB cobra **bytes** UTF-8 hasta 4 B/carácter, dos campos de texto — A-03).

### 4.2 Idempotencia por `update_id` sin índices ni lecturas extra (el problema caro de la fase)

Telegram reenvía el mismo `update.update_id` si no recibe 2xx a tiempo (reintentos). Con 1 sola tabla y sin GSI, la única clave consultable es el PK. Opciones:

| | **(a) `id` determinista v5 + `Put` condicional — ELEGIDA** | (b) UUID v4 aleatorio + `Get`/`Query` previo | (c) Tabla auxiliar de deduplicación |
|---|---|---|---|
| Mecanismo | `id = uuidv5(namespace_fijo, "tg:" + update_id)`; `PutItem` con `condition_expression: attribute_not_exists(id)` | `id = crypto.randomUUID()`; buscar duplicado antes de escribir | PK alterno = `update_id` en 2ª tabla |
| Cumples I2 (1 tabla, sin GSI) | **sí** | solo con Scan completo → caro (I5) | **no** (2ª tabla = más WCU base, roza I2) |
| Coste por update nuevo | 1 escritura (0,02 WCU) | 1 Scan + 1 escritura | 2 escrituras |
| Garantía | **exacta**: la condicional falla → ya existía → se responde 200 `{ "ignored": "duplicate" }` | aproximada (carrera entre reintentos simultáneos) | exacta |
| Desvío del brief | `id` es UUID **v5**, no v4 (el brief es histórico; A-02) | v4 intacto | v4 intacto |

Implementación: `utils/ids.js` resuelve UUID v5 con `crypto.createHash('sha1')` (~25 líneas, cero dependencias — I4b). Namespace fijo documentado y congelado (constante `TG_UPDATE_NS` en el código y en `data-model.md`: cambiarlo rompería la deduplicación histórica → enmienda obligatoria). Riesgo residual: reintentos del mismo update concurrentes (mismo segundo) → el `Put` condicional pierde uno y responde 200; es exactamente el comportamiento deseado.

### 4.3 Enum de estado y transiciones (contractuales)

```
(alta por webhook) ──▶ PENDING ──PATCH──▶ IN_PROGRESS ──reply──▶ RESOLVED
     │                    │                                        ▲
     └────────────────────┴────────── reply (directo) ─────────────┘
```

- `reply` solo sobre `PENDING` o `IN_PROGRESS`; sobre `RESOLVED` → `409 ALREADY_RESOLVED` (nada se reabre en v1; reabrir es enmienda/fase futura).
- `PATCH` solo muta `status` (a `IN_PROGRESS` o `RESOLVED`; **no** reabre a `PENDING` → `400`).
- `RESOLVED` solo se persiste por `reply` **con OK real de Telegram** (brief §5.7/Fase 07); si Telegram falla, el ítem no cambia en absoluto (ni `status` ni `response_text`).

## 5. D-20 — Contratos de los 4 endpoints (propuesta)

Vinculante: lo de esta sección + `docs/api/openapi.yaml` (que escribo yo como orquestador; el documentador redacta prosa alrededor). JSON siempre `snake_case`. Todo error usa **un único envelope**:

```json
{ "error": { "code": "MACHINE_CODE", "message": "texto legible" } }
```

`error.code` es enum cerrado: `VALIDATION_ERROR` (400) · `UNAUTHORIZED` (401) · `FORBIDDEN` (403) · `NOT_FOUND` (404) · `ALREADY_RESOLVED` (409) · `TELEGRAM_SEND_FAILED` (502) · `INTERNAL` (500). Sin `requestId` en la respuesta v1 (el `update_id`/`id` ya correlacionan en logs; añadirlo es enmienda trivial).

### 5.1 `POST /webhook/telegram` (público — la superficie que nunca debe provocar reintento)

- Entra **cualquier** payload: responde `200` siempre que el secreto sea válido, con `{"received": true}` (ticket creado) o `{"ignored": "<motivo>"}` con motivo de un conjunto cerrado de **seis** (A-01), definidos aquí porque la Fase 04 los implementa tal cual:

  | Motivo | cuándo |
  |---|---|
  | `no_text` | update con `message` pero sin campo `text` (foto, voz, sticker, documento…) |
  | `empty_message` | `text` presente pero vacío o de solo espacios tras `trim` |
  | `chat_not_found` | update sin `message.chat.id` utilizable (no se puede responder sin destino) |
  | `unsupported_update` | update sin `message` en absoluto (callback_query, channel_post, edits, join…) o payload no parseable / superior al límite de 64 KB |
  | `duplicate` | `update_id` ya procesado (condicional `attribute_not_exists(id)` perdido, D-19) |
  | `internal_error` | excepción no prevista absorbida por el `webhookGuard` (I5/D-16); se loguea en JSON **sin** el contenido (D-18) |
- **Nunca** 4xx por payload raro (eso haría reintentar a Telegram — brief §5.3): los errores internos también se convierten en `200 {"ignored":"internal_error"}` por el `webhookGuard` (D-16/I5). Única excepción de código de estado: secreto inválido → `403` (ver 5.5: quien falla el secreto no es Telegram reintentando, es un tercero).
- Body ≤ **64 KB** declarado (un update real de texto no pasa de ~2 KB); `express.json({ limit: '64kb' })`.
- Ejemplos del contrato: update con texto → 200 `received`; callback_query → 200 `ignored/unsupported_update`; reenvío duplicado → 200 `ignored/duplicate`.

### 5.2 `GET /api/tickets` (x-api-key)

- Query: `status` (opcional, enum; valor fuera del enum → `400 VALIDATION_ERROR`) · `limit` (opcional, 1–100, default **50**) · `cursor` (opcional, opaco).
- Orden: `created_at` **desc**.
- Paginación: el `Scan` devuelve su página + `LastEvaluatedKey`; la API la codifica como `cursor` **opaco** (`base64url(JSON)`) y el filtro `status` se aplica **dentro del `Scan`** como `FilterExpression` (no ahorra capacidad evaluada — §10a de la Fase 00— pero sí bytes; A-03 unifica la redacción con el contrato). El contrato no expone nada de DynamoDB. El `Scan` de v1 usa **consistencia eventual** (el modo barato: 1 RCU = 8 KB evaluados; A-03).
- Respuesta 200: `{ "tickets": [ <Ticket>... ], "next_cursor": "<opaco>" | null }`.
- Sin auth → `401 UNAUTHORIZED`; clave inválida → `403 FORBIDDEN` (D-21 middleware `apiKey`).
- Nota de honestidad en la doc funcional: con `cursor`, el orden `desc` es **por página escaneada** (el Scan recorre la tabla en orden de PK, no de fecha); con ≤ ~1.000–2.000 items (umbral I5) y una pasada `limit` alto es el caso normal. La fase 10 (GSI) lo arregla si el volumen lo exige.

### 5.3 `PATCH /api/tickets/{id}` (x-api-key)

- Body: exactamente `{ "status": "IN_PROGRESS" | "RESOLVED" }`; cualquier otro campo o forma → `400`.
- 200 → el ticket completo actualizado (`updated_at` refrescado). `404 NOT_FOUND` si el `id` no existe. `400` si `status` no está en el enum **o** intenta reabrir a `PENDING` (4.3).
- Concurrencia v1: último-que-escribe gana (sin `version`); aceptado y anotado.

### 5.4 `POST /api/tickets/{id}/reply` (x-api-key)

- Body: exactamente `{ "response_text": "..." }` (1–4096 chars tras `trim`; vacío → `400`).
- Flujo: cargar ticket → si `RESOLVED`, `409 ALREADY_RESOLVED`; `sendMessage(chat_id, text)` **antes** de escribir; si Telegram no devuelve `ok: true` → `502 TELEGRAM_SEND_FAILED` y **cero cambios** en el ítem (brief §8.5).
- 200 → ticket con `status: "RESOLVED"`, `response_text` y `updated_at`.
- El contrato **no** documenta reintentos de envío: un `502` se contesta reintentando la llamada (con la misma semántica: si el primer `sendMessage` llegó pero el response se perdió, el reintento puede duplicar el mensaje al usuario → riesgo anotado en §9).

### 5.5 Seguridad de superficie (cierre de D-21)

- `/api/*`: middleware `apiKey` (D-16) — cabecera `x-api-key` ausente o vacía → `401`; presente y ≠ `ADMIN_API_KEY` → `403`. Comparación con `crypto.timingSafeEqual` (normalizadas a bytes UTF-8, longitudes desiguales = no válido). Ocurre **antes** de tocar DynamoDB (I4).
- `/webhook/telegram`: si `TELEGRAM_WEBHOOK_SECRET` está definido (siempre en nuestro deploy), exigir cabecera `X-Telegram-Bot-Api-Secret-Token` estrictamente igual (mismo `timingSafeEqual`); ausente o distinto → `403 {"error":{"code":"FORBIDDEN",...}}`. Justificación de que NO sea 2xx: el reintento de Telegram solo importa para updates legítimos, que **siempre** llevan el secreto; responder 403 a quien no lo tiene es gratis y no rompe I5 (que protege el flujo de updates reales).
- Rotación de `ADMIN_API_KEY` y del secreto: procedimiento en `runbook.md` (Fase 08); el contrato solo fija los nombres de variable (D-17).

## 6. D-22 — Validación de entrada (propuesta)

**Guards manuales en `utils/validation.js`, cero librerías.** Opciones: (a) manual; (b) librería ligera (`zod`/`kleur`-style) — I4b exige decisión + superficie de supply chain nueva para ~8 comprobaciones. Motivo: el contrato de esta fase es pequeño y cerrado; las reglas de la tabla 4.1 y de los §5.1–5.4 se implementan como funciones puras testeables campo a campo. Riesgo: redundancia con `openapi.yaml` → se mitiga con el **test de contrato** (Fase 02) y los ejemplos de ambos documentos, que en Fase 01 se escriben a mano una sola vez y luego fija la compuerta.

## 7. Mapeo de entregables y responsable (I8)

| Artefacto | Qué contiene | Quién |
|---|---|---|
| `docs/api/openapi.yaml` | El contrato completo de §4–§5 (paths, schemas, ejemplos sin secretos) | **orquestador** (contrato, no prosa) |
| `docs/human/functional/api.md` | Los 4 endpoints en lenguaje humano: para qué son, ejemplos `curl` con placeholders, errores | documentador |
| `docs/human/technical/data-model.md` | La tabla 4.1 narrada, v5 + condicional (4.2), transiciones 4.3, consumo RCU/WCU y umbral I5 | documentador |
| `docs/human/README.md` | Tabla de frescura: `openapi.yaml`, `api.md` y `data-model.md` pasan de `pendiente (Fase 01)` a creados + marcador | documentador |
| `docs/specs/01-modelo-contratos/tasks.md` | Estado por tarea con columna *Docs* | documentador (por orden) |

## 8. Criterios de aceptación

- **C1** — D-19, D-20, D-22 registrados en `DECISIONS.md` (con opciones/motivo/riesgo) y D-21 cerrado con la regla 5.5, todo tras el visto del usuario (D-07).
- **C2** — `docs/api/openapi.yaml` (OpenAPI 3.1) define los **4 paths** con los códigos: 200/403 (webhook), 200/400/401/403 (GET), 200/400/401/403/404 (PATCH), 200/400/401/403/404/409/502 (reply); schemas con `additionalProperties: false` donde el esquema es estricto; y el enum `error.code` cerrado.
- **C3** — Ningún ejemplo del contrato ni de `api.md` contiene secretos: solo placeholders en forma con ángulos (`<ADMIN_API_KEY>`, `<TELEGRAM_BOT_TOKEN>`, `SU_CLAVE`, `REPLACE_ME…`; el vocabulario único se fija en Fase 02). Higiene verificada por `check.ps1`.
- **C4** — El contrato de estado es exacto: `PENDING|IN_PROGRESS|RESOLVED` en el schema; `RESOLVED` no reabrible; idempotencia por `update_id` descrita en `data-model.md` con la constante de namespace fijada.
- **C5** — `docs/human/functional/api.md` y `docs/human/technical/data-model.md` existen, son útiles (no esqueletos) y llevan `Actualizado: fase 01 · fecha`; `docs/human/README.md` refleja la frescura.
- **C6** — `scripts/check.ps1` en PASS con Fase 01 como fase en curso (activa el aserto del contrato I8b: forma OpenAPI 3.x).
- **C7** — `INDEX.md`: Fase 01 → `verified` **con el visto explícito del usuario** (los contratos de Fase 01 condicionan el panel: congelación I3).

## 9. Riesgos / desviaciones

1. **`id` UUID v5 ≠ "UUID v4" del brief §12**: desviación deliberada y documentada (la deduplicación exacta con 1 tabla lo exige). Reversible solo con GSI (prohibido por I2 hasta fase 10).
2. **Doble `sendMessage` en reintento humano** (5.4): si el agente reintenta tras un `502` ambiguo, el usuario puede recibir dos respuestas. Aceptado en v1 (volumen bajo, el `409` cubre el caso cerrado); mitigación futura: idempotency-key en el reply (fase 10+).
3. **Orden `created_at desc` con `cursor` es por página** (5.2): anotado en la doc funcional; solo muerde por encima del umbral I5, que es exactamente el disparador de la fase 10.
4. **Superficie del webhook con secreto**: si el `setWebhook` (Fase 08) se registra con un secreto distinto al de la variable de entorno, **todo** falla con 403 en silencio. Mitigación: el runbook fija el comando exacto y la prueba E2E de la Fase 08 lo detecta; el contrato documenta el 403 explícitamente.
5. El enum de ignore-motivos (5.1) puede necesitar un valor nuevo en Fase 04 (p. ej. `forward_from`); eso es enmienda del contrato, no bug — la lista vive en un solo sitio (`openapi.yaml` + tabla de `api.md`).

## 10. Amendments

- **A-01 · 2026-11-19 (pre-`implement`, corrección de precisión)** — §5.1: el conjunto de motivos de ignoro pasa de 5 a los **6** reales del enum del contrato (`internal_error` estaba implícito en el párrafo del guard pero ausente de la lista) y cada motivo queda **definido**, porque la Fase 04 tiene que implementar esa semántica exacta y hasta ahora solo `duplicate` estaba definida. Sin cambio de diseño: D-20 sigue vigente.
- **A-02 · 2026-11-19** — §4.2/§9.1: la constitución **I3** decía literalmente «`id` UUID v4» + `crypto.randomUUID()`, en contradicción viva con D-19 (v5 determinista). **Enmendada con OK explícito del usuario el 2026-11-19 y registrada como D-35**: I3 ya describe el id v5 determinista de `utils/ids.js`. §9.1 queda superado: la desviación ya no es solo frente al brief histórico, sino que la constitución la ha absorbido.
- **A-03 · 2026-11-19 (pre-`implement`, precisiones de la revisión fresh-eyes)** — tres afilamientos sin cambio de diseño, aplicados también en contrato/docs: (§4.1) el tamaño de ítem se reexpresa en caracteres vs bytes UTF-8 (peor caso ~33 KB, no «≤ 8 KB»), porque el guard mide caracteres y DynamoDB cobra bytes; (§5.2) el filtro `status` se describe «dentro del `Scan`» (la redacción «post-Scan» sugería un filtro en aplicación, y el contrato decía lo correcto) y se fija la **consistencia eventual** del `Scan` de v1 (1 RCU = 8 KB evaluados → 256 RCU/1.000 items de 2 KB); (§9 C3) el vocabulario de placeholders se unifica en forma con ángulos — `YOUR_KEY_HERE` quedaba fuera del estándar real de los artefactos y choca con el escáner de secretos si se usara largo en `.env.example` (deuda anotada para Fase 02).
