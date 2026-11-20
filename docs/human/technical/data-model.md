# Modelo de datos — `TicketsTable`

Actualizado: fase 02 · 2026-11-20

> Documento para quien mantiene el código. Aquí se cuenta **la tabla** en lenguaje humano: qué guarda cada atributo, cómo se deduplica un `update_id` con una sola tabla y sin índices, cómo cambian los estados y qué cuesta cada operación. El contrato vinculante de formas y errores es `docs/api/openapi.yaml`; las reglas con su justificación completa están en la spec de Fase 01 y en `DECISIONS.md` (D-19, D-20, D-21, D-22, D-26).

## La tabla, en una página

Una sola entidad (el ticket), una sola tabla (`TicketsTable`, DynamoDB Standard, `PROVISIONED` 25/25, una región — I1/I2/D-26). **Esquema estricto:** los atributos no listados se ignoran a la lectura y nunca se escriben. Sin índices de ningún tipo (ni GSI ni LSI): prohibidos por I2/D-26 hasta la fase futura 10.

| Atributo | Tipo DynamoDB | Obligatorio | Regla de longitud / formato | De dónde sale |
|---|---|---|---|---|
| `id` | `S` | sí | UUID RFC 4122 **v5**, determinista (patrón del contrato: `^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`) | `uuidv5(TG_UPDATE_NS, "tg:" + update_id)` en el alta del webhook — ver la sección siguiente. El panel lo trata como opaco |
| `telegram_chat_id` | `S` | sí | 1–20 dígitos, con `-` inicial opcional para grupos (patrón del contrato: `^-?[0-9]{1,20}$`) | `update.message.chat.id`; se guarda **como string** para evitar trampas de precisión numérica y porque la Bot API lo acepta así |
| `username` | `S` | no (puede faltar) | 1–64 caracteres | `update.message.from.username`; si no tiene, fallback `from.first_name`; si tampoco existe, el atributo simplemente no se escribe |
| `message_content` | `S` | sí | 1–4096 caracteres | `update.message.text` íntegro. Es el contenido del ticket; **prohibido loguearlo** (D-18: en el log solo va su longitud) |
| `response_text` | `S` | no (puede faltar) | 1–4096 caracteres | Solo lo escribe `reply` (Fase 07), y **después** del OK de Telegram. Hasta la primera respuesta exitosa el atributo no existe |
| `status` | `S` | sí | enum cerrado: `PENDING` \| `IN_PROGRESS` \| `RESOLVED`; cualquier otro valor → `400`, nunca escritura | nace en `PENDING` con el webhook; lo cambian `PATCH` y `reply` |
| `created_at` | `S` | sí | ISO 8601 UTC con `Z` | `utils/time.js` en el alta; **inmutable** después |
| `updated_at` | `S` | sí | ISO 8601 UTC con `Z` | se refresca en **toda** mutación (`PATCH`, `reply`) — regla I5: ninguna escritura silenciosa |
| `telegram_update_id` | `N` | sí | entero positivo | `update.update_id` de Telegram; se guarda para trazabilidad y correlación con sus logs. **La deduplicación no usa este atributo**: usa el `id` (abajo) |

Tamaño de un ítem: **objetivo típico ~2 KB** (mensajes normales); 8 KB como cota de diseño cómoda; **peor caso UTF-8 ~33 KB** (dos campos de 4096 *caracteres* × hasta 4 *bytes* — ver "caracteres vs bytes" en la sección de coste). El cálculo de capacidad se hace con los bytes reales del ítem, no con la cota.

## El `id` determinista: deduplicación exacta con una sola tabla

Telegram reenvía el mismo `update.update_id` si no recibe `2xx` a tiempo. Sin GSI, lo único consultable barato es la clave primaria; por eso el `id` no es aleatorio:

```
id = uuidv5(TG_UPDATE_NS, "tg:" + update_id)
```

- **UUID v5** (nombre-space + SHA-1), no v4: el mismo `update_id` produce **siempre** el mismo `id`, sea cual sea el proceso o el momento que lo reciba. Implementación en `utils/ids.js` con `crypto.createHash('sha1')` (~25 líneas, cero dependencias — I4b), sin paquete `uuid`.
- **Alta = un `PutItem` con condición** `attribute_not_exists(id)`. Si la condición falla, es que el update ya estaba: se responde `200 { "ignored": "duplicate" }` sin escribir nada. Cero lecturas extra, exactitud garantizada, sin carrera entre reintentos concurrentes (si dos llegan a la vez, uno gana y el otro cae en `duplicate`: exactamente lo deseado).
- **Por qué así (D-19):** la alternativa era un `id` v4 aleatorio + buscar el duplicado antes de escribir — con una sola tabla y sin índices eso obliga a `Scan`, caro y aproximado (carreras) — o una segunda tabla de deduplicación, prohibida por I2. Es el problema caro de la fase, resuelto con una escritura.
- **La constante de namespace `TG_UPDATE_NS` se fija en Fase 02** en `utils/ids.js` y se documenta (y congela) en este documento. Cambiarla en el futuro rompería la correspondencia `update_id → id` histórica: los reintentos viejos dejarían de deduplicarse. Por eso **modificarla exige enmienda** a la spec de Fase 01 + `DECISIONS.md`, no un refactor.
- Desviación deliberada anotada en la spec (§9.1): el brief hablaba de "UUID v4". Un `id` v4 impediría la deduplicación exacta sin índices; es reversible solo con un GSI, que I2 no autoriza hasta la fase 10.

## Estados y transiciones (spec §4.3)

```
(alta por webhook) ──▶ PENDING ──PATCH──▶ IN_PROGRESS ──reply──▶ RESOLVED
     │                    │                                        ▲
     └────────────────────┴────────── reply (directo) ─────────────┘
```

- El webhook solo **crea** (`PENDING`).
- `PATCH` solo muta `status`, y solo hacia adelante: `IN_PROGRESS` o `RESOLVED`. Reabrir a `PENDING` → `400`. `RESOLVED` por `PATCH` es un cierre administrativo **sin** mensaje al usuario.
- `reply` funciona sobre `PENDING` o `IN_PROGRESS`; sobre `RESOLVED` devuelve `409 ALREADY_RESOLVED`. **Nada se reabre en la v1**; reabrir sería enmienda/fase futura.
- **`RESOLVED` con respuesta solo se persiste si Telegram devolvió `ok: true`** (I5, brief §5.7). Si el envío falla, el ítem no cambia en absoluto: ni `status`, ni `response_text`, ni `updated_at`, y la API responde `502 TELEGRAM_SEND_FAILED`.
- Concurrencia de escritura en v1: último-que-escribe gana. No hay control optimista: `PATCH` usa la condición `attribute_exists(id)` (que el ticket exista), no una versión.

## Qué cuesta cada operación (I2/D-26: 25 WCU / 25 RCU fijas)

Con items de ~2 KB: 1 escritura = 2 unidades WCU; el techo de 25 WCU admite ~12,5 escrituras/s (la carga típica estimada en D-26 era ~0,002/s: tres órdenes de margen). El exceso se responde con `ThrottlingException`, **nunca con factura**.

| Operación | Lecturas | Escrituras |
|---|---|---|
| `POST /webhook/telegram` (update nuevo) | 0 | 1 `Put` condicional (≈2 WCU) |
| `POST /webhook/telegram` (duplicado) | 0 | 0 — la condición falla y no se escribe |
| `GET /api/tickets` | 1 `Scan` de página: se cobra lo **evaluado**, no lo devuelto; con 1.000 items de 2 KB (2 MB evaluados): **256 RCU en lectura eventual** (el modo de v1) o 512 si algún día se pidiera fuertemente consistente (1 RCU = 8 KB eventual / 4 KB fuerte). Cifra de referencia D-26, orden de magnitud | 0 |
| `PATCH /api/tickets/{id}` | 1 `GetItem` (≈1 unidad de lectura con 2 KB) | 1 `UpdateItem` (≈2 WCU) |
| `POST /api/tickets/{id}/reply` | 1 `GetItem` + la llamada HTTP a la Bot API (no consume DynamoDB) | 1 `UpdateItem`, **solo** si Telegram OK |

Dos consecuencias que hay que tener presentes al mantener el código:

- El filtro `?status=` se aplica como `FilterExpression` del `Scan`: ahorra bytes devueltos, **no** capacidad evaluada (I5). Nunca "optimices" el filtro esperando reducir RCU.
- El guard valida **caracteres** (1–4096); DynamoDB cobra **bytes** UTF-8 (hasta 4 B/carácter). Peor caso teórico de un ítem: `message_content` + `response_text` a 4096 caracteres multibyte ≈ 33 KB; el objetivo típico sigue siendo ~2 KB. La aritmética de WCU/RCU de la tabla se hace con el tamaño real en bytes del ítem, no con la cuenta de caracteres.
- **Umbral I5:** sobre **~1.000–2.000 items leídos** por listado el `Scan` deja de ser razonable. La respuesta al cruzarlo es **migrar a `Query` con un GSI** (fase 10, exige decisión + OK del usuario porque el GSI come de los mismos 25/25), **nunca** subir la capacidad provisionada (rompería I2). El cursor opaco del contrato existe precisamente para que esa migración no cambie la API.

## Qué NO se guarda, y por qué

| Campo tentador | Decisión | Motivo |
|---|---|---|
| `message_id` de Telegram | no se guarda | para responder basta el `chat_id` (mensajes nuevos); nada en v1 opera sobre el mensaje original |
| `date` del update | no se guarda | la fuente de verdad temporal del ticket es nuestro `created_at`; la hora de Telegram no se consume |
| flags del chat/bot (`is_bot`, `type`, canal…) | no se guarda | un solo bot y chats 1-a-1 o grupos como origen: I1 no prevé multi-bot ni diferenciación por tipo |
| `version` o contador optimista | no se guarda | no hay concurrencia real en v1 (una persona y sus agentes); último-que-escribe gana, anotado en spec §5.3 |
| cualquier otro campo del payload de Telegram | se ignora | esquema estricto: ni se valida más allá de las reglas de la tabla, ni se persiste, ni se loguea |

## Dónde manda cada documento

- Formas JSON exactas, enum `ignored`, códigos y ejemplos: `docs/api/openapi.yaml` (contrato, propiedad del orquestador; cambiarlo = enmienda — I3).
- Reglas de implementación (guards en `utils/validation.js`, D-22; middleware `apiKey` y validación del secreto con `crypto.timingSafeEqual`, cierre D-21): spec de Fase 01 §5–§6; la narración para integradores está en `docs/human/functional/api.md`.
- Capacidad, región y clase de la tabla materializadas: `template.yaml` (Fase 03), vigiladas por los asserts de `check.ps1` (1 tabla, `PROVISIONED` ≤ 25/25, sin GSI/Streams/PITR/auto scaling).
