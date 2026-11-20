# SubDesk API

Actualizado: fase 02 · 2026-11-20

> **Qué es:** una **API backend** de gestión de tickets, serverless en AWS, con coste previsto $0 (invariante I2). Recibe mensajes vía webhook, los guarda como tickets en DynamoDB y expone una REST API para un panel de atención.
>
> **Qué NO es:** este repo **no contiene el bot de Telegram**. El bot es un **consumidor externo que se creará después** (BotFather, identidad, conversación y UX viven fuera de aquí). El único contacto con Telegram son dos piezas de esta API: *recibir* sus webhooks (autenticados con un secreto) y *enviar* respuestas con `sendMessage` usando un token que tú configuras. Cuando el bot exista, conectarlo es un `curl` de `setWebhook`. Tampoco contiene el frontend del panel: aquí se entregan sus **contratos**, congelados en `docs/api/openapi.yaml`.

## Así encaja el todo

```
 [usuario Telegram] ──▶ [BOT (externo, se hará después)]
                              │  Telegram llama por webhook a:
                              ▼
                    ┌──────────────────────────┐
                    │   ESTA API (este repo)   │   POST /webhook/telegram   (ingesta)
                    │  Lambda + Express (1 fn) │   GET  /api/tickets        (cola)
                    │  DynamoDB TicketsTable   │   PATCH /api/tickets/{id}  (estado)
                    └──────────▲───────────────┘   POST /api/tickets/{id}/reply (respuesta → Bot API)
                               │ x-api-key
                        [panel frontend (externo, consume docs/api/openapi.yaml)]
```

## Estado del proyecto (fases)

| Fase | Qué entrega | Estado |
|---|---|---|
| 00 | Arquitectura: AWS SAM, 1 Lambda + Express + Function URL, pnpm, contrato de variables, política de logs | ✅ `approved` |
| 01 | Modelo de datos (`TicketsTable`) y contratos de los 4 endpoints congelados (OpenAPI 3.1) | ✅ `approved` |
| 02 | Scaffold del proyecto (ESM, lint, scripts, tests, `.env.example`) — **los comandos `pnpm` y el código `src/` ya existen** | ✅ entregado (cierre: compuertas + revisión fresh-eyes) |
| 03 | Infraestructura como código (`template.yaml`: tabla + Lambda + URL + IAM), validada sin desplegar | ⏳ |
| 04 | Ingesta `POST /webhook/telegram` | ⏳ |
| 05 | Lectura `GET /api/tickets` + auth | ⏳ |
| 06 | Mutación `PATCH /api/tickets/{id}` | ⏳ |
| 07 | Respuesta `POST /api/tickets/{id}/reply` | ⏳ |
| 08 | CI/CD + despliegue + registro del webhook (**siempre con tu visto previo**: acciones externas) | ⏳ |
| 09 | Hardening, revisión de coste y entrega final | ⏳ |

Progreso real y pendientes: `docs/specs/INDEX.md` (única fuente de verdad). Decisiones con su historia: `DECISIONS.md`.

## Estructura del repo

```
PROMPT.md                      brief de producto (histórico; la constitución manda)
AGENTS.md                      harness del proceso (SDD + subagentes + compuertas)
DECISIONS.md                   registro append-only de decisiones (D-01…)
README.md / CHANGELOG.md       este manual (CHANGELOG nace en Fase 02)
docs/
  api/openapi.yaml             CONTRATO machine-readable — ruta única del contrato (D-34)
  specs/                       proceso: constitución, INDEX, spec+tasks por fase
  human/                       documentación para personas (índice en docs/human/README.md)
    functional/api.md          los 4 endpoints en lenguaje humano + curl de ejemplo
    technical/architecture.md  topología y capas reales
    technical/data-model.md    la tabla, el id determinista, costes por operación
scripts/check.ps1              compuerta mecánica (docs, higiene de secretos, asserts IaC)
src/ tests/ template.yaml      nacen en Fases 02–03 (todavía no existen, a propósito)
```

## Comandos

Todos son ya reales (Fase 02 entregada: `package.json`, `pnpm-workspace.yaml`, `src/`, `tests/`). El gestor es **pnpm** con la versión exacta fijada en `packageManager` (`pnpm@10.18.1`); `npm`/`npx`/`yarn` están prohibidos por la constitución (I4b/D-30):

```bash
cp .env.example .env               # variables locales (nunca se commitea .env)
pnpm install --frozen-lockfile     # instalar dependencias de forma reproducible, sin scripts de terceros
pnpm run dev                       # node --env-file=.env src/local.js → app Express en http://localhost:3000, sin AWS
pnpm run lint                      # ESLint flat config sobre src/ y tests/ (incluye las reglas que mecanizan las capas)
pnpm test                          # node:test + supertest: seguridad, smoke y test de contrato contra openapi.yaml
pnpm run validate:api              # lint de docs/api/openapi.yaml (@redocly/cli 2.81.0, D-33)
pnpm run check                     # compuerta del harness (equivale a: powershell -File scripts/check.ps1)
```

Desde la Fase 03 se añade `pnpm run validate:iac` (`cfn-lint template.yaml`, offline y sin credenciales); el `template.yaml` todavía no existe.

Qué prueba cada compuerta, el smoke manual con `curl` y la política de logs: `docs/human/technical/operations.md`.

No hay comando `deploy`: ningún despliegue ocurre sin propuesta explícita y **visto del usuario** (I6).

## Variables de entorno (contrato cerrado, D-17)

Siete nombres, leídos solo por `src/config.js`. **Ningún valor real va al repo**: `.env.example` (ya en el repo) lista los siete — los cuatro obligatorios con placeholder en ángulos (`<TABLE_NAME>`, `<TELEGRAM_BOT_TOKEN>`, `<ADMIN_API_KEY>`, `<TELEGRAM_WEBHOOK_SECRET>`) y `LOG_LEVEL`/`STAGE`/`PORT` con su valor por defecto de desarrollo; se copia a `.env` con tus valores (`cp .env.example .env`) y `.env` queda fuera de git. En el stack, los secretos entran como `Parameters NoEcho` del template y se inyectan desde secretos de GitHub.

| Variable | Para qué |
|---|---|
| `TABLE_NAME` | tabla DynamoDB (sale del stack, nunca hardcode) |
| `TELEGRAM_BOT_TOKEN` | token del bot **externo** — la API lo usa solo para `sendMessage` |
| `ADMIN_API_KEY` | clave que compara la cabecera `x-api-key` de los `/api/*` |
| `TELEGRAM_WEBHOOK_SECRET` | valor de `X-Telegram-Bot-Api-Secret-Token` que la API exige al webhook |
| `LOG_LEVEL` | `info` (debug solo en dev) |
| `STAGE` | `dev` en la v1 (single-stage) |
| `PORT` | solo local (`pnpm run dev`) |

## Cómo se conecta el bot (cuando exista)

El registro real del webhook llega con el despliegue (Fase 08) y su comando exacto, con valores reales de tu entorno, vivirá en `docs/human/runbook.md`. La forma es:

```bash
curl -s "https://api.telegram.org/bot<TU_BOT_TOKEN>/setWebhook" \
  -d "url=https://<TU_FUNCTION_URL>/webhook/telegram" \
  -d "secret_token=<TU_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message"]'
```

Nada más: ni SDKs ni librerías de bot en este repo. Los reintentos, los formatos de update y el ack se resuelven en la API (contrato: `POST /webhook/telegram` responde `200` a todo update con secreto válido).

## Documentación

| Quiero… | Leo |
|---|---|
| los endpoints sin jerga AWS (mi panel los va a llamar) | `docs/human/functional/api.md` |
| el contrato exacto (schemas, códigos, ejemplos) | `docs/api/openapi.yaml` |
| la tabla y por qué el `id` deduplica sin índices | `docs/human/technical/data-model.md` |
| cómo encajará el bot (proyecto-hijo: botones, suscripciones, catálogo) | `docs/human/technical/bot-plan.md` (D-38) |
| la topología y las reglas de capas | `docs/human/technical/architecture.md` |
| las reglas inquebrantables (coste $0, secretos, CORS, ack) | `docs/specs/constitution.md` |
| en qué está el proyecto y qué queda | `docs/specs/INDEX.md` |
| por qué se decidió cada cosa | `DECISIONS.md` (append-only, IDs `D-xx`) |

## Las tres reglas que explican casi todo el diseño

1. **Coste $0, siempre (I2/D-26):** DynamoDB `PROVISIONED` 25/25 sin auto scaling (el exceso es `ThrottlingException`, nunca factura), Function URL en vez de API Gateway (franquicia permanente), Lambda 256 MB, CloudWatch ≤ 30 días. Techo conocido: $14,24/mes en el peor caso teórico.
2. **Sin secretos en el repo, nunca (I4/D-13):** placeholders siempre; los valores reales viajan como secretos de GitHub → `Parameters NoEcho` → variables de Lambda. El log no admite token, clave, secreto ni el texto del usuario (D-18).
3. **El webhook nunca hace reintentar a Telegram (I5):** cualquier update con secreto válido recibe `200` (creado o ignorado con motivo de un enum cerrado); la única excepción de código es el secreto inválido → `403` (D-21/D-36).

## Aviso de proceso

Este repo se construye con un ciclo Spec-Driven (spec → tasks → tu visto por tarea → implementación → compuertas → revisión fresh-eyes → decisión registrada). Si llegas buscando el código: está **planificado para empezar en la Fase 02**; hoy existen la arquitectura, el modelo de datos y los contratos, todos verificados por `scripts/check.ps1`.
