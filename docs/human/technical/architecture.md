# Arquitectura técnica — SubDesk API

Actualizado: fase 03 · 2026-11-20

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
Panel ──x-api-key─▶│  1× Lambda · Node ≥20 ESM │  ← 256 MB, 30 s máx de invocación HTTP (runtime exacto: Fase 03)
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

## Estructura de carpetas y reglas de dependencia (D-16)

```
src/
  lambda.js         # UNICA entrada Lambda: serverlessHttp(app) (D-28; antes anunciado como vendia/serverless-express). Nada de lógica aquí.
  local.js          # app.listen(PORT) para `pnpm run dev`: mismo árbol, sin adaptador.
  app.js            # createApp(deps): middlewares globales, montaje de routers, error handler final.
  routes/
    telegram.js     # POST /webhook/telegram   → público, ack 2xx garantizada
    tickets.js      # GET /api/tickets · PATCH /api/tickets/:id · POST /api/tickets/:id/reply
  middleware/
    apiKey.js       # x-api-key vs ADMIN_API_KEY → 401/403 antes de tocar DynamoDB (I4)
    webhookGuard.js # cualquier excepción → 200 con cuerpo de descarte (I5)
  services/
    ticketService.js    # reglas de negocio: enum, idempotencia por update_id, transición a RESOLVED
    telegramService.js  # único sitio que habla con la Bot API (fetch nativo)
  repositories/
    ticketRepository.js # único sitio que conoce DynamoDB y la tabla
  utils/            # http.js (responses), validation.js, ids.js (UUID v5 determinista con node:crypto, D-19), time.js, logger.js
  config.js         # única lectura de process.env
tests/              # unitarios de services + supertest sobre createApp() + test de contrato OpenAPI
template.yaml       # SAM: 1 tabla PROVISIONED + 1 Function + FunctionUrlConfig + 1 rol
docs/human/         # esta documentación (I8)
```

Dirección única de dependencias: `lambda|local → app → routes → middleware|services → repositories|utils → config`.

- Nada importa la SDK de AWS fuera de `repositories/`; `telegramService.js` habla con la Bot API con `fetch` nativo (regla exacta: spec §5 + A-08).
- `createApp()` recibe dependencias inyectadas → los tests levantan la app real sin Lambda, sin DynamoDB y sin Telegram.
- **CORS: cero líneas en código.** Se declara solo en `FunctionUrlConfig.Cors` del IaC; si Express emitiera también cabeceras CORS, Lambda las duplica y el preflight se rompe (I4).

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

## Decisiones pendientes (revisado al cerrar Fase 01 · 2026-11-19)

- **Fase 01:** D-19/D-20/D-21/D-22 **resueltas el 2026-11-19** (visto del usuario; registro en `DECISIONS.md`): esquema estricto de 9 atributos, `id` UUID v5 determinista + `Put` condicional (dedup exacta sin GSI), contrato de 4 endpoints con envelope único (7 códigos), seguridad de superficie (`timingSafeEqual`; secreto del webhook → 403) y guards manuales sin librerías. Detalle: `docs/human/technical/data-model.md` + `docs/api/openapi.yaml`.
- **Fase 02 (cerrándose hoy):** ✅ fijada la versión exacta de pnpm (`10.18.1`) y el adaptador definitivo (**D-28**: `serverless-http@3.2.0`, la premisa vendia-v5 de la Fase 00 era falsa); ✅ framework de tests (**D-23**: `node:test` + `supertest` + inyección); ✅ instalado `@redocly/cli@2.81.0` para `validate:api` (**D-33**). Pendientes que sobreviven a la fase: constante `TG_UPDATE_NS` en `src/utils/ids.js` (nace con la ingesta, **Fase 04** — en Fase 02 no hay consumidor); `@mermaid-js/mermaid-cli` + diagramas (**Fase 03**); deuda del harness: huecos de mecanización de `check.ps1` (ver fila 00 en `INDEX.md`).
- **Fase 03:** rol IAM exacto de menor privilegio (**D-24**, el gate cfn-lint ya lo fijó D-31); spike de empaquetado con pnpm árbol plano (**D-31**).
- **Fase 08:** estrategia de CI/CD, secretos y momento del `setWebhook` (**D-25**).
- **Futura:** migración a `PAY_PER_REQUEST` (**D-29**, exige OK explícito del usuario).
- Estado del registro: entradas **registradas** = D-01–D-28, D-30–D-38 (desde hoy también **D-23** y **D-28**); **solo filas de pendientes** (sin entrada todavía) = D-24, D-25, D-29; decisión **vía de escape** futura con OK obligatorio = D-29. Próximo ID libre: **D-39** (la tabla de `DECISIONS.md` es la fuente).
