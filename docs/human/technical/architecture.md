# Arquitectura técnica — SubDesk API

Actualizado: fase 04 · 2026-11-23

> Documento para quien va a mantener el código. Las decisiones con su historia están en `DECISIONS.md` (se enlazan por ID); los criterios por fase están en `docs/specs/`. El contrato de la API se publica en `docs/api/openapi.yaml` (nace en Fase 01).

## Qué es este sistema

**Una API backend, y nada más.** Este repo entrega una API REST serverless en AWS para gestionar tickets. **El bot de Telegram no está en este repo**: es un consumidor externo que se creará después (BotFather, identidad y conversación fuera de aquí). La API solo conoce a Telegram por dos cosas: recibe sus webhooks y, cuando el panel responde, llama a `sendMessage` de la Bot API con el token que se le configure.

Flujo completo del sistema (la parte de este repo es el punto 2 y la API de los puntos 3–4):

1. Un usuario escribe **al bot** (externo, futuro) → Telegram llama a nuestro webhook.
2. La API guarda el mensaje como **ticket** en DynamoDB con estado `PENDING`.
3. El **panel** (frontend aparte, tampoco está en este repo) consulta la API: lista tickets, cambia estados y redacta respuestas.
4. La API envía la respuesta al chat vía Bot API y marca el ticket `RESOLVED` **solo si Telegram devolvió OK**.

Volumen previsto: bajo (una persona y sus agentes). Todas las decisiones optimizan coste $0, claridad y rapidez de arranque, no escala (constitución I1, I2).

## Topología (D-15, D-26, D-27)

```
Telegram ──POST──▶ ┌─────────────────────────────┐
                   │  Lambda Function URL (NONE) │  ← único endpoint público; sin cargo por petición
Panel ──x-api-key─▶│ 1× Lambda · nodejs26.x ESM │  ← 256 MB, 30 s máx de invocación HTTP · arm64 (D-61)
                   │  Express app (router interno)│
                   └───────┬─────────────┬───────┘
                           │             │
                  ticketRepository   telegramService
                     (DynamoDB)      (fetch → Bot API)
                           │
                 TicketsTable · PROVISIONED 25/25 · 1 región · Standard
```

- **Una sola función Lambda**, no una por endpoint: el enrutado lo hace Express dentro del proceso (D-27). Consecuencia: un error no capturado afecta a todas las rutas → por eso el router del webhook va aislado con su propio guard (I5).
- **IaC: AWS SAM** (`template.yaml`, `Transform: AWS::Serverless-2016-10-31`), que se traduce a CloudFormation (D-15).
- **DynamoDB en capacidad provisionada 25/25 sin auto scaling** (D-26): el exceso de carga produce `ThrottlingException`, **no** factura. Si algún día se migra a `PAY_PER_REQUEST`, hace falta decisión nueva + OK del usuario (D-29).
- **Runtime `nodejs26.x` sobre `arm64` (Graviton) — D-61**, supersede el valor de D-40 (`nodejs22.x` + `x86_64`). `nodejs26.x` está en **public preview** en Lambda: AWS dice que los runtimes en preview *«not covered by the Lambda SLA or Technical Support, and should not be used for production workloads»* — el usuario asume ese riesgo de forma explícita. Rollback si algo se rompe: `Runtime: nodejs24.x` + push — update **sin interrupción**, sin reemplazo y sin *prune*. `MemorySize: 256` y `Timeout: 30` no cambian. El motor Node local es **v26.13.1** (medido) ⇒ la paridad dev/prod **sigue intacta** (no hay «deriva aceptada»).

## Estructura de carpetas y reglas de dependencia (D-16)

Convención del árbol: **[VIVO]** = existe hoy en el repo (verificado contra `src/` y `tests/` el 2026-11-23); **[OBJETIVO]** = objetivo de fases futuras, **aún no existe**.

```
src/
  lambda.js         # [VIVO] UNICA entrada Lambda: serverlessHttp(app) (D-28; versión viva: serverless-http@4.0.0, D-62). Nada de lógica aquí.
  local.js          # [VIVO] app.listen(PORT) para `pnpm run dev`: mismo árbol, sin adaptador.
  app.js            # [VIVO] createApp(deps): middlewares globales, montaje de routers, rechazos del parser de cuerpo → 400 VALIDATION_ERROR (D-62), error handler final.
  routes/
    telegram.js     # [VIVO, stub 501] POST /webhook/telegram → público, ack 2xx garantizada (handler real: Fase 05)
    tickets.js      # [VIVO, stub 501] GET /api/tickets · PATCH /api/tickets/:id · POST /api/tickets/:id/reply (handlers reales: Fases 06–08)
    registry.js     # [VIVO] fuente única de la superficie HTTP: la compara contra openapi.yaml el test de contrato (I8b.4)
  middleware/
    apiKey.js       # [VIVO] x-api-key vs ADMIN_API_KEY → 401/403 antes de tocar DynamoDB (I4)
    webhookGuard.js # [VIVO] cualquier excepción → 200 con cuerpo de descarte (I5)
  services/         # [OBJETIVO Fases 05–08 — aún no existe]
    ticketService.js    # [OBJETIVO] reglas de negocio: enum, idempotencia por update_id, transición a RESOLVED
    telegramService.js  # [OBJETIVO] único sitio que habla con la Bot API (fetch nativo)
  repositories/     # [OBJETIVO Fase 05+ — aún no existe]
    ticketRepository.js # [OBJETIVO] único sitio que conoce DynamoDB y la tabla
  utils/
    http.js         # [VIVO] respuestas con el envelope del contrato
    logger.js       # [VIVO] log JSON por invocación (D-18)
    validation.js   # [OBJETIVO Fase 05 — aún no existe] guards manuales (D-22)
    ids.js          # [OBJETIVO Fase 05 — aún no existe] UUID v5 determinista con node:crypto (D-19) + TG_UPDATE_NS
    time.js         # [OBJETIVO Fase 05 — aún no existe] created_at/updated_at ISO 8601 UTC
  config.js         # [VIVO] única lectura de process.env
tests/              # [VIVO] unitarios de middleware/config + supertest sobre createApp() + tests a nivel de ADAPTADOR (lambda.adapter.test.js, D-62) + test de contrato OpenAPI + tests de pipeline (pre-vuelo, workflows, $GITHUB_ENV)
template.yaml       # [VIVO] SAM: 1 tabla PROVISIONED + 1 Function + 1 AWS::Lambda::Url + 2 AWS::Lambda::Permission (D-60) + 1 rol + 1 AWS::Logs::LogGroup (spec 03 A-01/A-04)
docs/human/         # esta documentación (I8)
```

Dirección única de dependencias: `lambda|local → app → routes → middleware|services → repositories|utils → config`.

- Nada importa la SDK de AWS fuera de `repositories/`; `telegramService.js` habla con la Bot API con `fetch` nativo (regla exacta: spec §5 + A-08).
- `createApp()` recibe dependencias inyectadas → los tests levantan la app real sin Lambda, sin DynamoDB y sin Telegram.
- **CORS: cero líneas en código.** Se declara solo en la propiedad `Cors` del recurso nativo `AWS::Lambda::Url` (`TicketApiUrlConfig`) del IaC — no existe un «FunctionUrlConfig» SAM: la URL es CFN-nativa desde la spec 03 A-01, y por eso los dos `AWS::Lambda::Permission` de D-60 hay que declararlos a mano; si Express emitiera también cabeceras CORS, Lambda las duplica y el preflight se rompe (I4).

### Adaptador Express↔Lambda: `serverless-http@4.0.0` exacta (D-28 → D-62)

La versión fijada en D-28 (`3.2.0`) resultó incompatible con `body-parser@2` (el que trae Express 5): construía la petición con un socket falso no legible que el parser interpretaba como «cuerpo ya parseado», y **`express.json()` no parseaba ningún cuerpo bajo Lambda** — `req.body` quedaba en un Buffer crudo y el `400 VALIDATION_ERROR` del contrato era inalcanzable. `4.0.0` usa un stream real y resuelve el defecto; la versión se mantiene **exacta** (`--save-exact`): bajar a 3.2.0 lo reintroduce **en silencio**. Consecuencia de contrato: los errores del parser de cuerpo (JSON inválido, cuerpo que supera el límite de **64 KB**, charset o content-encoding no soportados) responden siempre `400 VALIDATION_ERROR`, nunca un 5xx.

**Por qué `supertest` no lo detectó:** `supertest` ejercita `createApp()` directamente, sin pasar por el adaptador — el defecto solo existe dentro de Lambda. Por eso la capa de tests incluye ahora **tests a nivel de adaptador** (`tests/lambda.adapter.test.js`), que invocan el handler con **eventos Function URL v2.0 sintéticos** y cubren ese punto ciego.

## Contrato de configuración

Siete variables, todas a través de `src/config.js` (nunca `process.env` suelto en el código): `TABLE_NAME`, `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `LOG_LEVEL`, `STAGE`, y `PORT` **solo local**. Los secretos llegan al stack como `Parameters` con `NoEcho: true` desde secretos de GitHub Actions; jamás un valor literal en `template.yaml` ni en el repo (I4, D-13).

## Política de logs (D-18)

**Un evento JSON por invocación** —nunca `console.log` de texto plano— con los campos `level`, `msg`, `ticketId`, `updateId`, `statusCode` y `durationMs`. Así el log queda buscable en CloudWatch Insights sin sumar vendors ni coste (descartada la observabilidad externa por I2).

- **Prohibido loguear (I4):** `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, la cabecera `x-api-key` y el `text` íntegro del usuario — de este solo se registra su **longitud**. El revisor lo verifica en cada fase; si algún día hiciera falta el contenido, es enmienda explícita de I4, no excepción silenciosa.
- **Retención CloudWatch ≤ 30 días**, declarada en el IaC (I2): CloudWatch es el único destino de logs del stack y su ingesta puede sumar.

## Compuertas del proyecto (I7, D-31)

| Comando | Qué prueba |
|---|---|
| `pnpm install --frozen-lockfile` | dependencias reproducibles y bloqueadas (único gestor: **pnpm**, I4b/D-30) |
| `pnpm run lint` | estilo y errores estáticos |
| `pnpm test` | reglas de negocio + test de contrato `código ↔ openapi.yaml` |
| `pnpm run validate:api` | `docs/api/openapi.yaml` es un OpenAPI 3.1 válido |
| `pnpm run validate:iac` | `cfn-lint template.yaml` (offline, sin credenciales, **sin ejecutar scripts**) |
| `pnpm run check` | `scripts/check.ps1`: constitución, spec de la fase, asserts de IaC, asserts de cadena de suministro, **frescura de esta documentación** e higiene de secretos |

`sam build` **no** es compuerta: AWS documenta que ejecuta *package manager scripts* y build tools del proyecto, lo que rompería el bloqueo de scripts de dependencias (D-31). El artefacto Lambda se construye con árbol plano (`nodeLinker: hoisted` o `pnpm deploy`) porque un ZIP de Lambda no conserva symlinks (D-30, riesgo 1).

## Límites heredados de la plataforma (hay que respetarlos, no luchar contra ellos)

| Límite | Valor | Consecuencia en el diseño |
|---|---|---|
| Invocación HTTP por Function URL | 30 s | nada de trabajo largo en la request; el `sendMessage` de Telegram entra, un lote no |
| Payload | 6 MB | irrelevante para mensajes de Telegram (≤ 4.096 caracteres) |
| Capacidad de la tabla | 25 WCU / 25 RCU | ~12,5 escrituras/s y ~50 lecturas/s eventuales con items de 2 KB |
| `Scan` | cobra lo **evaluado**, no lo devuelto | el filtro `?status=` no ahorra capacidad; umbral de revisión a `Query`: ~1.000–2.000 items leídos (I5) |
| Conciencia de coste | sin `provisioned concurrency`, sin auto scaling, sin Web Functions | el techo de gasto es fijo y conocido ($14,24/mes en el peor caso de D-26) |

## Decisiones pendientes (snapshot histórico: revisión del cierre de Fase 01 · 2026-11-19 con viñetas añadidas al cerrar Fase 02 · 2026-11-20 — **no es estado vigente**; el estado vigente es el último punto, y su fuente es `DECISIONS.md`/`INDEX.md`)

- **Fase 01:** D-19/D-20/D-21/D-22 **resueltas el 2026-11-19** (visto del usuario; registro en `DECISIONS.md`): esquema estricto de 9 atributos, `id` UUID v5 determinista + `Put` condicional (dedup exacta sin GSI), contrato de 4 endpoints con envelope único (7 códigos), seguridad de superficie (`timingSafeEqual`; secreto del webhook → 403) y guards manuales sin librerías. Detalle: `docs/human/technical/data-model.md` + `docs/api/openapi.yaml`.
- **Fase 02 (cerrándose hoy):** ✅ fijada la versión exacta de pnpm (`10.18.1`) y el adaptador definitivo (**D-28**: `serverless-http@3.2.0` —sustituida por **`4.0.0`** en Fase 04, **D-62**: incompatibilidad con `body-parser@2`—, la premisa vendia-v5 de la Fase 00 era falsa); ✅ framework de tests (**D-23**: `node:test` + `supertest` + inyección); ✅ instalado `@redocly/cli@2.81.0` para `validate:api` (**D-33**). Pendientes que sobreviven a la fase: constante `TG_UPDATE_NS` en `src/utils/ids.js` (nace con la ingesta, **Fase 05** — la renumeración *pipelines-first* D-42 movió la ingesta de la antigua Fase 04 a la 05; en Fase 02 no hay consumidor); `@mermaid-js/mermaid-cli` + diagramas (**Fase 03**, entregado); deuda del harness: huecos de mecanización de `check.ps1` (ver fila 00 en `INDEX.md`).
- **Fase 03:** rol IAM exacto de menor privilegio (**D-24**, el gate cfn-lint ya lo fijó D-31); spike de empaquetado con pnpm árbol plano (**D-31**).
- **Fase 04 (pipeline, D-42):** estrategia de CI/CD y secretos (**D-25**, se resuelve ahí). El `setWebhook` y su momento viven en la **Fase 09**.
- **Futura:** migración a `PAY_PER_REQUEST` (**D-29**, exige OK explícito del usuario).
- **Estado del registro — SNAPSHOT histórico fechado de la ola de cierre de la Fase 04 (2026-11-22), superado por el punto siguiente:** entradas registradas hasta **D-64** (las últimas: D-59 Sid del macro SAM, D-60 los dos statements de la Function URL — cerrado en producción, D-61 `nodejs26.x`/`arm64`, D-62 `serverless-http@4.0.0`, D-63/D-64 evidencia de coste I2); las «filas de pendientes» del snapshot anterior quedaron resueltas en sus fases (D-24 en F03, D-25 en F04). Próximo ID libre: **D-65**. La fuente es la tabla de `DECISIONS.md` y el punto de retomada de `INDEX.md`.

**Registro vigente al 2026-11-23: hasta D-72 (D-68 SDK empaquetado, D-69 `TG_UPDATE_NS`, D-70 gate antes del parser, D-71 `allowed_updates`, D-72 smoke vivo con ticket sintético); próximo ID libre D-73.** La línea anterior («hasta D-64, próximo D-65») queda como *snapshot* fechado de la ola de cierre de la Fase 04; lo vinculante es este registro y su fuente, `DECISIONS.md`/`INDEX.md`.
