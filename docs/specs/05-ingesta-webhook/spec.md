# Spec — Fase 05 · Ingesta `POST /webhook/telegram`

Creada: 2026-11-23 · Estado: `spec` (espejo de `docs/specs/INDEX.md`, única fuente de verdad)
Orden de mando: `PROMPT.md` → `docs/specs/constitution.md` → `AGENTS.md` → esta spec.
Contrato vinculante: `docs/api/openapi.yaml` (congelado en Fase 01, I3). Cambiarlo es enmienda, no refactor.

## 1. Objetivo

Que un update de Telegram entrante cree un **ticket `PENDING`** de forma **idempotente** en `TicketsTable`, con **ack `2xx` garantizado** en todos los caminos salvo el secreto inválido, y que la superficie webhook deje de ser un stub `501`. Es la primera fase que **escribe datos reales** y la primera que introduce el AWS SDK en el código (I4b/D-30).

Objetivos derivados que esta fase cierra por arrastre (deudas heredadas de F02/F03/F04):

- Congelar `TG_UPDATE_NS` en `src/utils/ids.js` y regenerar los ejemplos de `id`/`cursor` del contrato (D-39 → D-42 → aquí).
- Alinear el webhook con el contrato en el caso de **payload no parseable**: `200 {"ignored":"unsupported_update"}` en vez de `internal_error` (ejecutable ya gracias a **D-62**: con `serverless-http@4.0.0` el cuerpo sí se parsea bajo Lambda).
- Tests del logger por campo, coherencia `mounting ↔ registry`, y **segunda mitad del test de contrato** (códigos y cuerpos por endpoint) para el webhook.
- **Renumerado único de fases (spec 04 A-12(a))**: código, mensajes `501`, colección Postman + tabla `EXPECTED` de `scripts/smoke-live.mjs` en el mismo commit, y los comentarios de `template.yaml` que citan fases (con visto, por estar blindado).

## 2. Alcance

**Código nuevo** (`src/**`, todo con tests; el implementador recibe lista cerrada de ficheros por tarea):

| Fichero | Contenido |
|---|---|
| `src/utils/ids.js` | `TG_UPDATE_NS` congelado (D-69) + `ticketIdFor(updateId)` = `uuidv5(TG_UPDATE_NS, "tg:" + updateId)` |
| `src/utils/time.js` | `nowIso()` → ISO 8601 UTC con `Z` (milisegundos), única fuente de timestamps |
| `src/utils/validation.js` | Guards D-22 reutilizables: `isPositiveInteger`, `isTelegramChatId`, `isMessageText` |
| `src/repositories/ticketRepository.js` | **Único** sitio con AWS SDK (`eslint.config.js` ya lo impone). `createTicketIfAbsent(item)` = un `PutItem` con `ConditionExpression: attribute_not_exists(id)` |
| `src/repositories/ticketRepository.fake.js` | Fake en memoria con la misma interfaz (D-23: mocks por inyección; cero AWS en tests) |
| `src/services/ticketService.js` | Orquesta: validar forma del update → decidir motivo `ignored` → persistir. Devuelve `{received:true}` o `{ignored:<motivo>}` |
| `src/routes/telegram.js` | Sustituye `notImplemented(4)` por el handler real |

**Código modificado:**

- `src/middleware/webhookGuard.js` — discrimina los rechazos del parser de cuerpo → `unsupported_update`; el resto de errores sigue en `internal_error`.
- `src/routes/telegram.js` — **el gate de secreto pasa delante del parser** (D-70).
- `src/utils/http.js` — helper compartido `isBodyParserRejection(err)` (los cinco rechazos de D-62 enumerados **una sola vez**, consumido por `/api/*` → `400` y por el webhook → `200 unsupported_update`) + mensajes `501` renumerados.
- `src/routes/registry.js` — campo `phase` renumerado 4/5/6/7 → **5/6/7/8** (D-42).
- `src/app.js` — solo si hace falta para reutilizar el helper; el mapeo `400 VALIDATION_ERROR` de `/api/*` no cambia.

**Dependencias:** `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, pin exacto, como `dependencies` (D-68). La instalación la ordena y ejecuta el **orquestador** (AGENTS §2: el implementador tiene `pnpm add` denegado).

**Contrato y docs:** regenerar ejemplos de `id`/`cursor` en `docs/api/openapi.yaml` + `docs/human/functional/api.md`; documentar `TG_UPDATE_NS` y la **precedencia congelada de motivos** en `api.md` y `data-model.md`; corregir en `data-model.md` el coste del duplicado (AWS documenta que un `PutItem` condicional fallido **sí** consume WCU); `docs/human/diagrams/api-flow.mmd` + `.svg` (nuevo, exigible desde esta fase); runbook, README, CHANGELOG, INDEX, tasks.

**Pipeline:** actualizar la tabla de era de `scripts/smoke-live.mjs` (los casos webhook dejan de admitir `501`) **en el mismo commit** que el renumerado de los nombres de la colección Postman (guardia de drift 1:1).

## 3. Fuera de alcance

- `GET /api/tickets` (F06), `PATCH /api/tickets/{id}` (F07), `POST /api/tickets/{id}/reply` y `sendMessage` (F08). Siguen en `501`.
- `setWebhook`, E2E con bot real, hardening y entrega (F09). Esta fase se prueba con **peticiones sintéticas**, nunca con un bot real.
- `allowed_updates` del `setWebhook`: la decisión queda **fijada** aquí (D-71: `["message"]`) pero se ejecuta en F09.
- TTL, tabla auxiliar de dedupe, GSI, Streams, PITR: prohibidos o no justificables (I2/D-26). La tabla sigue sin TTL.
- El bot-hijo `subdesk-bot` (D-38, fase 12) y el panel (fase 11).
- Cualquier cambio de rutas, métodos, schemas o códigos de estado del contrato. Si algo de esto hiciera falta, es enmienda constitucional/I3 con visto del usuario, no tarea.

## 4. Decisiones de la fase

| ID | Decisión | Estado |
|---|---|---|
| **D-68** | AWS SDK **empaquetado** con la función: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, misma versión, pin exacto, como `dependencies`. Sigue la recomendación oficial de AWS («we strongly recommend that you include the AWS SDK clients that you need in your deployment package» — `lambda-runtimes.html`, `nodejs-handler.html`): el SDK del runtime existe pero su versión **no es pineable** y varía por runtime y región. Coste $0 (I2): el ZIP pasa de ~856 KB a varios MB, muy por debajo del guard de 45 MB de `package-lambda.mjs`; el S3 extra es de la clase $0,000x/mes. **Versión fijada: `3.1175.0` en los dos paquetes** — publicada 2026-11-21T01:13Z (60,7 h de antigüedad ⇒ cumple `minimumReleaseAge: 1440`), misma versión en ambos, y sus `scripts` son sólo `test`/`build`/`clean`, sin ningún hook de ciclo de vida ⇒ `allowBuilds` no crece (I4b intacto). | **validada por el usuario 2026-11-23** |
| **D-69** | `TG_UPDATE_NS` = **`57ef65e4-85f4-5f1d-a5c3-e55bd593494d`**, obtenido como `uuidv5(NAMESPACE_URL, "https://github.com/Pathles5/subdesk-api#tg-update-ns")`. **Lo vinculante es el literal**, no la receta: la receta documenta la procedencia y hace el valor reproducible, pero el UUID queda escrito en `src/utils/ids.js` y en `data-model.md` porque un identificador derivado de una URL cambia si el repo se renombra o se transfiere — lección ya pagada en **D-50** con el *subject claim* de OIDC. La implementación de UUID v5 se verifica contra el vector canónico `uuidv5(NAMESPACE_DNS, "python.org") = 886313e1-3b8a-5372-9b90-0c9aee199e5d`. Cambiar el namespace = enmienda + pérdida de la dedupe histórica. | **validada por el usuario 2026-11-23** |
| **D-70** | **El gate de secreto va delante del parseo del cuerpo.** Hoy `telegram.js` parsea (L20) antes de comprobar el secreto (L23), de modo que un remitente con secreto inválido *y* cuerpo roto recibe `200` donde el contrato prescribe `403` (`openapi.yaml:54`). Reordenar es más fiel al contrato y evita parsear cuerpos de remitentes no autenticados. Cambio observable: ese caso pasa de `200 internal_error` a `403`. Telegram nunca lo produce (siempre envía su secreto correcto), y la colección Postman ya tiene el caso «Secreto ERRONEO → 403» con cuerpo válido, así que la guardia de drift no se resiente. | **validada por el usuario 2026-11-23** |
| **D-71** | `setWebhook` se registrará con **`allowed_updates: ["message"]`** (se ejecuta en F09). Reduce invocaciones Lambda y ruido: todo lo que no sea `message` deja de llegar, en vez de llegar para ser ackeado como `unsupported_update`. Coherente con D-38/`bot-plan.md`: los `callback_query` los resuelve el bot-hijo con su propio webhook. Consecuencia aceptada: si el reparto bot↔API cambiara, haría falta un re-registro (acción externa con visto, F09). | **validada por el usuario 2026-11-23** |
| **D-72** | **El smoke vivo escribe un ticket sintético en la tabla de `dev`.** Al dejar de ser stub, el caso «Mensaje de texto valido» de la colección crea un ítem real con `update_id 482391756` ⇒ `id 1dfaeb46-5641-5c6f-99d2-53c184206877` (el mismo que pasa a ser el ejemplo del contrato). Es **idempotente por construcción**: el primer run lo crea, todos los siguientes reciben `{"ignored":"duplicate"}` y el caso sigue en verde porque admite `200`. Alternativas descartadas: (a) cambiar el smoke a un payload no persistido (`callback_query`) — perdería la prueba viva de la escritura, que es justo lo que la estrategia *pipelines-first* (D-42) vino a garantizar; (b) que el smoke borre el ítem — exigiría `DeleteItem` en el rol de CI, hoy de solo lectura, o sea más privilegio permanente por una limpieza puntual. Se acepta **un** ticket sintético en el stack de `dev`, documentado como dato de prueba en runbook y `data-model.md`. | **validada por el usuario 2026-11-23** |

## 5. Diseño

### 5.1 Orden de evaluación congelado (precedencia de motivos)

El contrato fija el enum de 6 motivos pero no su precedencia; esta spec la congela (comportamiento observable ⇒ va también a `functional/api.md`). Primera regla que casa, gana:

| # | Condición | Respuesta |
|---|---|---|
| 0 | Cabecera `X-Telegram-Bot-Api-Secret-Token` ausente o distinta de `TELEGRAM_WEBHOOK_SECRET` (comparación en tiempo constante sobre digests SHA-256, como hoy) | **`403`** `{"error":{"code":"FORBIDDEN","message":"invalid webhook secret"}}` |
| 1 | Cuerpo no parseable, > 64 KB, charset no soportado o content-encoding no soportado | `200 {"ignored":"unsupported_update"}` |
| 2 | `update_id` ausente o no entero ≥ 1 | `200 {"ignored":"unsupported_update"}` |
| 3 | `message` ausente o no objeto (`callback_query`, `channel_post`, `edited_message`, `poll`, `inline_query`, …) | `200 {"ignored":"unsupported_update"}` |
| 4 | `message.chat.id` ausente o no utilizable (no entero, o fuera de `^-?[0-9]{1,20}$`) | `200 {"ignored":"chat_not_found"}` |
| 5 | `message.text` ausente o no string | `200 {"ignored":"no_text"}` |
| 6 | `message.text.trim()` vacío | `200 {"ignored":"empty_message"}` |
| 7 | `message.text.length > 4096` (defensivo: Telegram no lo excede) | `200 {"ignored":"unsupported_update"}` + log |
| 8 | `PutItem` condicional OK | `200 {"received":true}` |
| 9 | `ConditionalCheckFailedException` | `200 {"ignored":"duplicate"}` |
| 10 | Cualquier otra excepción | `200 {"ignored":"internal_error"}` (la absorbe `webhookGuard`) + log **sin contenido** |

Interpretaciones registradas (no cambian el enum, sólo lo aplican): los casos 2 y 7 caen en `unsupported_update` porque el enum cerrado del contrato no tiene un motivo para «update inutilizable», y `unsupported_update` es literalmente «update que este backend no puede convertir en ticket». **Nunca se trunca el texto**: ante > 4096 se ignora el update y se loguea, porque truncar corrompería `message_content` («texto íntegro», `data-model.md`).

### 5.2 Ítem escrito (esquema estricto de 9 atributos, Fase 01)

`id` (S, PK) = `ticketIdFor(update_id)` · `telegram_chat_id` (S) = `String(message.chat.id)` · `username` (S, opcional) = `message.from.username ?? message.from.first_name`, **atributo ausente** si no hay ninguno (nunca cadena vacía) · `message_content` (S) = `message.text` **íntegro, sin `trim`** · `status` (S) = `PENDING` · `created_at` = `updated_at` = `nowIso()` · `telegram_update_id` (N) = `update_id` como número. Sin `response_text` (lo escribe F08). Cero atributos extra.

### 5.3 Idempotencia y capacidad

Un solo `PutItem` con `ConditionExpression: attribute_not_exists(id)` — patrón canónico confirmado por la documentación oficial de DynamoDB (`API_PutItem.html`). **Cero lecturas.** Carreras entre reintentos concurrentes: uno gana y el otro cae en `duplicate`, que es el comportamiento deseado (spec 01 §4). Coste: 1 escritura por update nuevo (~2 WCU con ítem de ~2 KB) y **~2 WCU también en el duplicado** — AWS documenta que la condición fallida consume capacidad igualmente; `data-model.md:62` dice «0» y se corrige en esta fase. Con 25 WCU provisionados y ~0,002 req/s el impacto es nulo (I2 intacto).

`ProvisionedThroughputExceededException`/`ThrottlingException`: el SDK reintenta con backoff exponencial. Si aun así falla, la excepción llega al guard ⇒ `200 {"ignored":"internal_error"}` + log. **Riesgo aceptado (v1):** como ya hemos ackeado `200`, Telegram no reentrega y ese update se pierde. Al volumen de D-26 es despreciable; mitigarlo exigiría una cola (coste y complejidad, I2) y se revisa en F09 si el volumen cambia.

### 5.4 `TG_UPDATE_NS` y ejemplos del contrato

`uuidv5` se implementa en `src/utils/ids.js` con `node:crypto` (SHA-1 + bits de versión/variante), **sin dependencia nueva**: `uuid` no entra en `package.json`. El test fija el vector canónico de la RFC y el determinismo (`mismo update_id ⇒ mismo id`, dos veces y en dos procesos). Con el namespace congelado se **regeneran** los ejemplos de `id` y `next_cursor` en `openapi.yaml:347` y `api.md`, sustituyendo el `2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7` ilustrativo (que también está en la variable `ticketId` de la colección Postman y en el default de `smoke-live.mjs`: se actualizan los tres en la misma pasada).

### 5.5 Tests (D-23: `node:test` + `supertest`, inyección, cero AWS y cero red)

1. `tests/utils/ids.test.js` — vector canónico v5, determinismo, formato UUID, distinto `update_id` ⇒ distinto `id`.
2. `tests/utils/logger.test.js` — **deuda (c)**: cada campo de `REDACTED_FIELDS` → `"[redacted]"` + `<field>Length`; los de la allowlist pasan intactos; umbrales de nivel.
3. `tests/utils/validation.test.js` — guardas con frontera (chat_id de 20 dígitos, negativo, texto de 4096 y de 4097).
4. `tests/repositories/ticketRepository.test.js` — cliente DynamoDB **inyectado/stub**: construye el `PutItem` exacto (tabla, item, `ConditionExpression`), traduce `ConditionalCheckFailedException` a `duplicate` y propaga cualquier otro error por `name` (no por mensaje).
5. `tests/services/ticketService.test.js` — la tabla de precedencia §5.1 **completa**, caso por caso, con el repositorio fake; dos llamadas con el mismo `update_id` ⇒ una `received` y una `duplicate`, y **un solo ítem** en el fake; concurso de dos llamadas paralelas ⇒ mismo resultado.
6. `tests/routes/telegram.test.js` (supertest) — `200 {"received":true}`, los seis motivos, `403` con secreto ausente/erróneo, y **`403` con secreto erróneo + cuerpo roto** (D-70, el caso que antes daba 200).
7. `tests/lambda.adapter.test.js` — se amplía: los cinco rechazos del parser contra `/webhook/telegram` dan `200 unsupported_update` (no `400`, no `501`), porque bajo Lambda sólo el adaptador ejercita el parseo real.
8. `tests/contract/openapi.test.js` — **segunda mitad** para el webhook: el endpoint responde exactamente `{200,403}`; el cuerpo del `200` casa con `WebhookReceived` **o** `WebhookIgnored` (objetos estrictos, `received === true` o `ignored ∈` el enum de 6); el `403` lleva el literal `invalid webhook secret`.
9. `tests/contract/mounting.test.js` — **deuda (d)**: por cada entrada de `ROUTES`, `createApp()` responde algo distinto del envelope `404` con el método declarado (prueba que el registry y el montaje real coinciden).

### 5.6 Logging (D-18)

Una línea JSON por evento. Del webhook **nunca** salen `text`, `message_content`, tokens ni claves (el logger ya los redacta y añade `<field>Length`). Campos permitidos: `updateId`, `ticketId`, `ignoredReason`, `statusCode`, `durationMs`, `stage`. En `internal_error` se loguea el `name` y el `message` de la excepción, **nunca** el cuerpo ni el stack con datos de usuario.

## 6. Renumerado único (spec 04 A-12(a))

Una sola pasada, en un solo commit, porque los nombres de la colección son las claves de la guardia de drift:

- `src/routes/registry.js` (`phase` 4/5/6/7 → 5/6/7/8) y `src/utils/http.js` (mensajes `501 … Fase N`).
- Comentarios de `src/routes/telegram.js` y de `src/utils/http.js`.
- `docs/api/SubDesk.postman_collection.json`: nombres de las 15 requests + descripciones con la numeración vigente, **y** tabla `EXPECTED` de `scripts/smoke-live.mjs` con las mismas claves nuevas y la era actualizada (webhook: `[200]` en los dos casos de ack; `403` en los dos de secreto; el resto sigue admitiendo `501` hasta su fase).
- `template.yaml` L8 y L373 citan «Fase 08» donde hoy es 04/09, y L113-117 llama «PUBLIC PREVIEW» a `nodejs26.x` cuando la documentación oficial de runtimes ya lo lista como soportado con fecha de deprecación: **fichero blindado** ⇒ requiere enmienda de la spec 03 + edición por `devops` + visto explícito del usuario. **Visto concedido por el usuario el 2026-11-23**, con el alcance exacto: sólo comentarios, cero cambios de recursos, enmienda en spec 03 §9, y comprobación posterior con `pnpm run validate:iac` + los asserts de región/IaC de `check.ps1` + diff limitado a comentarios. Riesgo de despliegue nulo: los comentarios no alteran la plantilla para CloudFormation y `deploy.yml` lleva `--no-fail-on-empty-changeset` (L406), así que un changeset vacío no pone rojo el run.

## 7. Compuerta de fase (AGENTS §4, fila 05)

Las seis compuertas base (`pnpm install --frozen-lockfile`, `lint`, `test`, `validate:api`, `validate:iac`, `check.ps1`) + los tests de la §5.5 + `functional/api.md`, `openapi.yaml` y `diagrams/api-flow.mmd` del endpoint al día + **entrega por la pipeline viva** (push con visto → run verde → smoke contra la URL real).

## 8. Criterios de aceptación

- **C1** — `pnpm install --frozen-lockfile` en verde con `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb` en `dependencies`, **pin exacto** las dos y misma versión; `pnpm-lock.yaml` actualizado; `allowBuilds` sin cambios (cero lifecycle scripts nuevos); `pnpm-workspace.yaml` intacto.
- **C2** — `pnpm run lint` en verde, incluida la regla que reserva `@aws-sdk/*` a `src/repositories/**`: se demuestra el negativo (un import del SDK fuera de `repositories/` falla) con fixture temporal borrado después.
- **C3** — `pnpm test` en verde con la suite ampliada (47 → **≥ 80** tests) y los nueve bloques de §5.5 presentes. Cada test nuevo se demuestra **no vaciado**: con el defecto correspondiente presente, falla (se prueba al menos en `ids`, `ticketService` precedencia, `ticketRepository` condicional y el `403` de D-70).
- **C4** — **`2xx` garantizado en ignores**: ninguna entrada por el webhook —salvo secreto inválido— produce un código distinto de `200`. Probado con supertest **y** a nivel de adaptador (eventos Function URL v2.0), incluyendo los cinco rechazos del parser de cuerpo.
- **C5** — **Campos extraídos**: el ítem persistido tiene exactamente los 9 atributos de §5.2 con sus tipos (`telegram_update_id` numérico, `telegram_chat_id` string, timestamps ISO con `Z`), `status = PENDING`, `message_content` íntegro sin `trim`, y `username` **ausente** (no vacío) cuando el update no trae ni `username` ni `first_name`.
- **C6** — **Ticket en `PENDING` y cero duplicados por `update_id`**: el mismo update dos veces ⇒ `{"received":true}` y luego `{"ignored":"duplicate"}`, con **un solo** ítem escrito; y en concurso (dos peticiones paralelas) exactamente una gana. Se prueba contra el fake **y** contra el repositorio real con cliente stub (que la `ConditionExpression` es literalmente `attribute_not_exists(id)`).
- **C7** — **Contrato**: `pnpm run validate:api` en verde y la segunda mitad del test de contrato activa para el webhook (códigos `{200,403}`, cuerpos `oneOf` estrictos, enum de 6, literal del `403`). `openapi.yaml` **sin cambios de rutas, métodos, schemas ni códigos** — sólo ejemplos regenerados; si el diff tocara algo más, es enmienda y se para.
- **C8** — **D-70 demostrado**: secreto erróneo + cuerpo roto ⇒ `403` (antes `200`). Test explícito con nombre que cita la decisión.
- **C9** — **`TG_UPDATE_NS` congelado y coherente**: el literal `57ef65e4-85f4-5f1d-a5c3-e55bd593494d` aparece en `src/utils/ids.js`, `data-model.md` y los ejemplos de `openapi.yaml`/`api.md`; el ejemplo de `id` del contrato es **realmente** `uuidv5(TG_UPDATE_NS, "tg:482391756")`, verificado por un test que recalcula el valor del ejemplo del contrato (no una copia a mano).
- **C10** — **Renumerado completo y sin drift**: ningún literal «Fase 4/5/6/7» obsoleto en `src/**`; los 15 nombres de la colección y las 15 claves de `EXPECTED` coinciden 1:1 (`smoke-live.mjs` no aborta con `exit 2`); el smoke local contra `pnpm run dev` da **15/15** con la era nueva.
- **C11** — **`check.ps1` `[PASS]`** con la fase 05 en curso: `api-flow.mmd` presente y con marcador `Actualizado: fase 05 · <fecha>`, `.svg` exportado con `pnpm run docs:diagrams` (local, sin CDN — I8d), los 11 artefactos humanos requeridos frescos, escáner de secretos limpio y asserts de región/IaC/cadena de suministro en verde.
- **C12** — **Entrega por la pipeline viva**: push con visto explícito del usuario (D-48) → run con los cuatro jobs en verde → salida literal `smoke-live: 15/15 ok contra https://…` → `describe-stacks` en `UPDATE_COMPLETE` → y verificación de solo lectura de que la tabla contiene **exactamente un** ítem, el sintético de D-72 (si el usuario lo valida), con `status PENDING`. Coste atribuible **$0** (I2): sin recursos nuevos, 25/25 provisionados dentro de la franquicia.
- **C13** — Revisión **fresh-eyes** con veredicto y cero desviaciones bloqueantes o mayores abiertas (bucle máx. 2, D-08), y `DECISIONS.md` con D-68…D-72 registradas (más las que nazcan), `INDEX.md` volcado y `tasks.md` con la columna *Docs* rellena en cada fila.

## 9. Riesgos / desviaciones

1. **`update_id` aleatorio tras inactividad** — Telegram documenta que, sin updates durante ≥1 semana, el siguiente `update_id` se elige **aleatoriamente** en vez de secuencialmente (`core.telegram.org/bots/api/types/update`). Si colisionara con uno antiguo, la dedupe perpetua descartaría un mensaje legítimo como `duplicate`. No mitigable sin TTL ni tabla auxiliar (ambos descartados por I2/D-26: la marca de dedupe **es** el ticket, y expirarla borraría datos de producto). **Riesgo aceptado**, probabilidad despreciable; se revisa en F09 si el volumen lo aconseja.
2. **Update perdido por throttle terminal** (§5.3): ackeado `200 internal_error`, Telegram no reentrega. Aceptado en v1 con log; alternativa (cola) descartada por coste.
3. **Crecimiento del ZIP** (D-68): de ~856 KB a varios MB. Vigilar el guard de 45 MB de `package-lambda.mjs` y el límite CFN de 50 MB; si el staging real se acercara, se replantea (sólo `client-dynamodb`, sin `lib-dynamodb`).
4. **Dato sintético en la tabla de `dev`** (D-72): un ticket de prueba visible para el panel en F06. Si el usuario lo rechaza, el plan B es que el smoke vivo sólo ejercite caminos no persistidos y la escritura se pruebe únicamente en tests — se perdería la evidencia viva de la ruta de escritura.
5. **`TELEGRAM_WEBHOOK_SECRET` y el charset de Telegram**: el `AllowedPattern` del template (`^\S{16,}$`) es más laxo que el charset que Telegram acepta en `secret_token` (`[A-Za-z0-9_-]{1,256}`). Si el valor pegado en GitHub contiene otros caracteres, `setWebhook` fallará en **F09** y habrá que re-pegarlo (acción del usuario, I4/I6). No verificable leyendo (los secretos son de solo escritura); se anota aquí como riesgo de F09 y se propone al usuario comprobarlo en su gestor de claves **sin exponer el valor**.
6. **`template.yaml` blindado**: el renumerado de los comentarios L8/L373 y la prosa «PUBLIC PREVIEW» de `nodejs26.x` (que la doc oficial ya no sostiene: el runtime aparece como soportado con fecha de deprecación) necesitan enmienda + `devops` + visto. Si no se concede, quedan como desvío documentado y la fase cierra igual: son comentarios, no recursos.
7. **Superficie de contrato congelada**: cualquier tentación de añadir un motivo `ignored`, un código o un campo es enmienda I3 con visto del usuario. El enum de 6 y los códigos `{200,403}` no se tocan.

## 10. Amendments

*(vacía: la spec se congela en cuanto entra en `implement`; los cambios posteriores se registran aquí como `A-xx` con motivo y reflejo en `DECISIONS.md`.)*
