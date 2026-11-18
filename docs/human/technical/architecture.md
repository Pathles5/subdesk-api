# Arquitectura técnica — SubDesk API

Actualizado: fase 00 · 2026-11-18

> Documento para quien va a mantener el código. Las decisiones con su historia están en `DECISIONS.md` (se enlazan por ID); los criterios por fase están en `docs/specs/`. El contrato de la API se publica en `docs/human/api/openapi.yaml` (nace en Fase 01).

## Qué es este sistema

Un backend serverless en AWS que hace de puente entre **Telegram** y un **panel de atención**:

1. Un usuario escribe a un bot de Telegram → Telegram llama a nuestro webhook.
2. El mensaje se guarda como **ticket** en DynamoDB con estado `PENDING`.
3. El panel (frontend aparte, no está en este repo) lista los tickets, cambia su estado y responde.
4. La respuesta se envía al chat de Telegram y el ticket pasa a `RESOLVED`.

Volumen previsto: bajo (una persona y sus agentes). Todas las decisiones optimizan coste $0, claridad y rapidez de arranque, no escala (constitución I1, I2).

## Topología (D-15, D-26, D-27)

```
Telegram ──POST──▶ ┌─────────────────────────────┐
                   │  Lambda Function URL (NONE) │  ← único endpoint público; sin cargo por petición
Panel ──x-api-key─▶│  1× Lambda · Node.js 20 ESM │  ← 256 MB, 30 s máx de invocación HTTP
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
  lambda.js         # UNICA entrada Lambda: serverlessExpress({ app }). Nada de lógica aquí.
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
  utils/            # http.js (responses), validation.js, ids.js (crypto.randomUUID), time.js, logger.js
  config.js         # única lectura de process.env
tests/              # unitarios de services + supertest sobre createApp() + test de contrato OpenAPI
template.yaml       # SAM: 1 tabla PROVISIONED + 1 Function + FunctionUrlConfig + 1 rol
docs/human/         # esta documentación (I8)
```

Dirección única de dependencias: `lambda|local → app → routes → middleware|services → repositories|utils → config`.

- Nada importa la SDK de AWS fuera de `repositories/` (y en su caso `telegramService.js` para HTTP saliente).
- `createApp()` recibe dependencias inyectadas → los tests levantan la app real sin Lambda, sin DynamoDB y sin Telegram.
- **CORS: cero líneas en código.** Se declara solo en `FunctionUrlConfig.Cors` del IaC; si Express emitiera también cabeceras CORS, Lambda las duplica y el preflight se rompe (I4).

## Contrato de configuración

Siete variables, todas a través de `src/config.js` (nunca `process.env` suelto en el código): `TABLE_NAME`, `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `LOG_LEVEL`, `STAGE`, y `PORT` **solo local**. Los secretos llegan al stack como `Parameters` con `NoEcho: true` desde secretos de GitHub Actions; jamás un valor literal en `template.yaml` ni en el repo (I4, D-13).

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

## Qué falta por decidir (documentar aquí cuando se cierre)

- **D-19/D-20/D-21** (Fase 01): tipos exactos e índices, formato de errores y paginación, y modo de validar `X-Telegram-Bot-Api-Secret-Token` (Function URL no admite authorizer → middleware en código).
- **D-22/D-23** (Fase 01–02): validación de entrada (guards manuales frente a librería mínima) y framework de tests.
- **D-28** (Fase 02): versión exacta de pnpm y del adaptador Express↔Function URL.
- **D-31** (Fase 03): spike del empaquetado con pnpm (árbol plano, sin symlinks) sin `sam build`.
