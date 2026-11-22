# SubDesk API

Actualizado: fase 04 · 2026-11-22

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
| 03 | Infraestructura como código (`template.yaml`: tabla + Lambda + URL + IAM), validada sin desplegar | ✅ (cerrada 2026-11-20; el deploy nunca es local — es la pipeline, Fase 04, D-42) |
| 04 | **Pipeline de despliegue** (`deploy.yml`/`prune.yml`, OIDC, primer apilado stub, evidencias de coste) — **solo la pipeline toca AWS** (D-42); el visto es el push autorizado, no una aprobación en Actions (D-48) | 🟡 en vuelo — **stack vivo**: `verify`/`package` verdes en runner real (runs #2–**#7** — evidencia C1); **stack `subdesk-api-dev` `UPDATE_COMPLETE` en `eu-west-1`** — run **#6** (`45065067527`, primer `CREATE_COMPLETE`, Function URL viva) y run **#7** (`45068970666`, update en caliente con D-60/D-61); smoke **14/15**, pendiente el run que cierra **D-62** (`serverless-http@4.0.0` ⇒ 15/15); coste atribuible **$0** con la evidencia corregida (D-63/D-64, §5 del runbook). **Run #4 (`45031395062`, push `7f20628`): el candado de identidad quedó cerrado en producción** — OIDC ✓ (trust inmutable de **D-50/D-51** funcionando), bucket SAM creado por la pipeline ✓, tagging ✓ (`s3:PutBucketTagging` visto succeed), `sam package` ✓; y `deploy` ✗ **un escalón más allá**, en `sam deploy`: `ValidationError (CreateChangeSet): Parameter 'WebhookSecretParam' must match pattern ^\S{16,}$`. **Cero recursos de app creados** (verificado por API) y coste $0 intacto. El bloqueante que reveló **no era infraestructura, era un dato de contrato**: `TELEGRAM_WEBHOOK_SECRET` del environment `dev` incumplía el `AllowedPattern` del template — resuelto después por el usuario vía UI (**T-15 `done`**). Como respuesta nació el **pre-vuelo `preflight-parameters` (D-52)**, que corre antes de mintear credenciales y aborta sin tocar AWS. **Tanda D-54 (2026-11-22): la región destino pasa a `eu-west-1` y se declara una sola vez en `infra/deployment.env`** (los workflows la cargan en `load-deploy-config`, tras el pre-vuelo y antes del OIDC); el bucket de artefactos se renombra con sufijo `-euwest1` porque **el namespace S3 es global** (el del run #4 en la región legada queda huérfano — residuo knowingly accepted, §5.1 del runbook); free tier antiguo re-confirmado por solo lectura (cuenta 2018-11-26 ⇒ `PROVISIONED` 25/25 sigue dentro de franquicia, I2 intacto); **T-15 `done`** — secreto re-pegado por el usuario (`updated_at = 2026-11-22T14:42:14Z`); **T-17 `done`** — policy del rol **re-emitida con los ARNs `eu-west-1`** (registrada como **D-55** con visto propio: diff pre-write de solo 5 tokens de región, re-lectura con diff vacío, `simulate-principal-policy` 33/33 `allowed` en la región nueva; el trust no se tocó y `simulate-*` no valida trusts). **Run #5 ejecutado (`45044899842`, push `6cbb738`, 2026-11-22T16:37:42Z): `verify` ✓ (cinco compuertas en runner real, ya con el gate D-57 dentro del `pnpm test` del CI) · `package` ✓ · `deploy` ✗ en su primer paso ejecutable, `preflight-parameters` — `AdminApiKeyParam (ADMIN_API_KEY) BAD - must match ^[A-Za-z0-9._-]{16,}$`, con todo el resto de pasos `skipped` ⇒ cero credenciales minteadas y cero llamadas AWS (el pre-vuelo de D-52 rindió lo prometido: sin él, CFN habría rechazado parámetros de uno en uno, un run por secreto) · `smoke` skipped.** Cuenta verificada limpia en `eu-west-1` (sin stack, sin Lambda, cero tablas `subdesk-*`, bucket `-euwest1` ⇒ 404) y **coste $0 con números**: `aws ce get-cost-and-usage` por `Project=subdesk-api` ⇒ `groups: []` = $0 atribuidos (total de la cuenta en noviembre fuera del tag: $0.0432, proyectos ajenos). `ADMIN_API_KEY` re-pegado después por el usuario (**T-15 cerrado del todo**, `updated_at = 2026-11-22T16:41:36Z`) e incidente **D-58** registrado: el valor salió al transcript del chat (0 coincidencias en repo e historial, verificado) ⇒ se trata como comprometido y **se rota obligatoriamente antes de F06 (T-18)**; suite vigente **37/37**. **Único pendiente: el push del run #6 — visto ya dado por el usuario para esta sesión** |
| 05 | Ingesta `POST /webhook/telegram` | ⏳ |
| 06 | Lectura `GET /api/tickets` + auth | ⏳ |
| 07 | Mutación `PATCH /api/tickets/{id}` | ⏳ |
| 08 | Respuesta `POST /api/tickets/{id}/reply` | ⏳ |
| 09 | `setWebhook` + E2E con bot + hardening + entrega final | ⏳ |

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
src/ tests/                scaffold vivo desde Fase 02 (capas + seguridad + tests; stubs 501)
template.yaml              IaC SAM (Fase 03): validada en seco; el deploy lo ejecuta SOLO la
                           pipeline de Fase 04 (D-42) — nunca un comando local
infra/deployment.env       única fuente del destino de despliegue (D-54): AWS_REGION=eu-west-1,
                           stack, bucket de artefactos, cuenta, environment — cero literales
                           de región repartidos; los workflows la cargan en load-deploy-config
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

Desde la Fase 03 se añade `pnpm run validate:iac` (`cfn-lint template.yaml`, offline y sin credenciales); la herramienta vive fuera de pnpm (pip --user, documentado en `docs/human/technical/operations.md`) y el `template.yaml` existe desde el 2026-11-20 — validado, aún sin desplegar.

Qué prueba cada compuerta, el smoke manual con `curl` y la política de logs: `docs/human/technical/operations.md`.

### Despliegue (Fase 04): cómo se autoriza

No hay comando `deploy` en este repo y **ningún comando de AWS se teclea en local**: la pipeline es la única que toca AWS (D-42). El visto no es una aprobación dentro de GitHub Actions — el environment `dev` **no tiene *required reviewers***, así que no existe el estado *Waiting* (**D-48**, 2026-11-22): **el visto es la acción que arranca el workflow**, es decir el **push a `main`** que el orquestador solo ejecuta con tu autorización explícita. Consecuencia asumida: **todo push a `main` despliega**, incluidos los commits de solo documentación. El `prune` (`prune.yml`) sí tiene dos capas visibles en el run: el `workflow_dispatch` manual y el literal exacto `BORRO-SUBDESK-API-DEV`. Estado a 2026-11-22, tras los runs **#4** y **#5**: la identidad de la pipeline está **confirmada en producción** (trust corregido en AWS — causa **D-50**, aplicación **D-51** — y OIDC ✓ en el run #4, igual que el bucket de artefactos, su tagging y `sam package`). El run #4 murió después, en `sam deploy`, por un secreto fuera de contrato (`WebhookSecretParam`); el **run #5** (`45044899842`, push `6cbb738`) murió **antes y más barato**, en el nuevo pre-vuelo `preflight-parameters`: `AdminApiKeyParam (ADMIN_API_KEY) BAD - must match ^[A-Za-z0-9._-]{16,}$`, con todo el resto del job `skipped` ⇒ **cero credenciales minteadas y cero llamadas AWS** — el gate de **D-52** funcionando tal como promete (sin él, CloudFormation habría rechazado parámetros de uno en uno: un run por secreto). **Cero recursos de app creados** en los cinco runs (verificado por API en `eu-west-1`) y coste $0 — ojo: la lectura de entonces (`ce get-cost-and-usage` por `Project=subdesk-api` ⇒ `groups: []`) **no era evidencia**: el tag estaba `Inactive` (**D-63**); los números que sí valen están en «Stack vivo» abajo y en runbook §5. Lo que quedaba, y su estado: (1) los secretos conformes **desde la UI de GitHub** — **hecho, T-15 cerrado del todo**: el pre-vuelo del run #5 ratificó `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` en `OK`, y `ADMIN_API_KEY` fue re-pegado tras señalarlo el gate (`updated_at = 2026-11-22T16:41:36Z`; los secretos del environment son de solo escritura: aquí nadie pide, pega ni genera valores en claro — I4); (2) la comprobación por API es **solo** el `updated_at` — **hecha** (el patrón lo ratifica el pre-vuelo en el runner: el de la clave API, en el run #6); (2b) la re-emisión de la policy del rol con los ARNs `eu-west-1` exigida por la migración D-54 — **hecha, T-17 `done`/D-55**, con visto propio; y (3) **el push del run #6 — visto ya dado por el usuario para esta sesión; queda solo que el orquestador lo ejecute —**, que bajo D-48 *es* el visto I6. Como respuesta al fallo del run #4 la pipeline añadió el paso **`preflight-parameters` (D-52)**: valida los secretos contra el propio `template.yaml` **antes** de mintear credenciales, así que un valor fuera de contrato aborta con cero contacto con AWS — **evidencia real desde el run #5**. **Incidente D-58:** el valor de `ADMIN_API_KEY` salió al transcript del chat (verificado: 0 coincidencias en el repo y en el historial git); se trata como comprometido — hoy no protege nada (la app es stub; `x-api-key` nace en F06) y **se rota obligatoriamente antes de F06** (T-18). Regla reforzada: **nadie pega valores de secreto en el chat**. La regla «cero pushes con el trust legado sin corregir» queda escrita para réplicas en otras cuentas. Comandos, cadena de pasos del job `deploy`, secretos, historial de runs, verificación del environment por API, diagnóstico OIDC y diagnóstico del pre-vuelo: `docs/human/runbook.md` §2, §2.3.1, §2.4, §2.7-E y §4.1; `docs/human/technical/operations.md`.

### Stack vivo (2026-11-22): URL pública real y runtime

El estado descrito arriba es el histórico de los runs #1–#5. La tanda siguiente **apiló por fin**: el stack `subdesk-api-dev` está **`UPDATE_COMPLETE`** en `eu-west-1` (creado por el run `45065067527`; actualizado en caliente por el run `45068970666`; verificado con `aws cloudformation describe-stacks`), creado exclusivamente por la pipeline (D-42). La **URL pública real** es:

```
https://ddndau6zrzk24hgglvag6435640jdxro.lambda-url.eu-west-1.on.aws/
```

- **Runtime vivo: `nodejs26.x` + `arm64` (Graviton)** — decisión **D-61** del usuario, que supersede el valor de D-40 (`nodejs22.x` + `x86_64`). `nodejs26.x` está en **public preview** en Lambda: AWS dice que los runtimes en preview *«not covered by the Lambda SLA or Technical Support, and should not be used for production workloads»* — riesgo asumido explícitamente. Rollback si algo se rompe: `Runtime: nodejs24.x` + push (update **sin interrupción**, sin reemplazo ni *prune*). `MemorySize: 256` y `Timeout: 30` no cambian. El motor Node local es **v26.13.1** (medido) ⇒ la paridad dev/prod sigue intacta.
- **La Function URL necesita DOS statements de resource policy (D-60):** `TicketApiUrlInvokePermission` (`lambda:InvokeFunctionUrl`) y `TicketApiUrlInvokePermissionViaUrl` (`lambda:InvokeFunction`, `Principal: '*'`, condición `InvokedViaFunctionUrl: true`); con uno solo, toda petición responde `403`. Verificación de solo lectura: `aws lambda get-policy --function-name TicketApiFunction --region eu-west-1` (runbook §4.2).
- **Adaptador Express↔Lambda: `serverless-http@4.0.0` exacta (D-62)** — la 3.2.0 rompía en silencio el parseo de todos los cuerpos bajo Lambda.
- Recursos: tabla `subdesk-api-dev-TicketsTable-1E0OT8H5KCQKO`, log group `/aws/lambda/TicketApiFunction` (retención 30 días); función y tabla etiquetadas `Project: subdesk-api` + `Stack: subdesk-api-dev`. **Coste atribuible: $0** (I2 intacto) — y la base de la medida importa: **no** es el filtro de Cost Explorer por tag, que resultó ser un falso verde corregido por **D-63/D-64** (el tag `Project` estaba `Inactive` y el filtro del budget usaba la clave `project` en minúscula, que no casaba con ningún recurso; hoy ambos corregidos, con corroboración por tag en verificación diferida ~24 h). La evidencia que vale es el **desglose por servicio sin filtro de tag**: Lambda 0, DynamoDB 0, CloudWatch 0 y CloudFormation 0 en octubre (antes del proyecto) y noviembre (con stack vivo), y un S3 de noviembre **menor** que el de octubre; nuestros tres buckets suman **3,4 MiB medidos** ⇒ ~0,00008 USD/mes a 0,023 USD/GB-mes. La guarda es el budget **`subdesk-api-cent-detect`**: límite real **0,01 USD/mes** (no «$0»), `NotificationState OK`. Números, comandos y trampas: `docs/human/runbook.md` §5/§5.1.

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

El registro real del webhook llega con la **Fase 09** (con bot existente) y su comando exacto, con valores reales de tu entorno, vivirá en `docs/human/runbook.md`. La forma es:

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
| importar la API en Postman | `docs/api/SubDesk.postman_collection.json` (15 requests con scripts; derivada del contrato) |
| la tabla y por qué el `id` deduplica sin índices | `docs/human/technical/data-model.md` |
| cómo encajará el bot (proyecto-hijo: botones, suscripciones, catálogo) | `docs/human/technical/bot-plan.md` (D-38) |
| la topología y las reglas de capas | `docs/human/technical/architecture.md` |
| desplegar por pipeline, hacer *prune*, rotar claves y revisar el coste | `docs/human/runbook.md` (§2 despliegue · §4.1 prune · §5 premisas I2) |
| las reglas inquebrantables (coste $0, secretos, CORS, ack) | `docs/specs/constitution.md` |
| en qué está el proyecto y qué queda | `docs/specs/INDEX.md` |
| por qué se decidió cada cosa | `DECISIONS.md` (append-only, IDs `D-xx`) |

## Las tres reglas que explican casi todo el diseño

1. **Coste $0, siempre (I2/D-26):** DynamoDB `PROVISIONED` 25/25 sin auto scaling (el exceso es `ThrottlingException`, nunca factura), Function URL en vez de API Gateway (franquicia permanente), Lambda 256 MB, CloudWatch ≤ 30 días. Techo conocido: $14,24/mes en el peor caso teórico.
2. **Sin secretos en el repo, nunca (I4/D-13):** placeholders siempre; los valores reales viajan como secretos de GitHub → `Parameters NoEcho` → variables de Lambda. El log no admite token, clave, secreto ni el texto del usuario (D-18).
3. **El webhook nunca hace reintentar a Telegram (I5):** cualquier update con secreto válido recibe `200` (creado o ignorado con motivo de un enum cerrado); la única excepción de código es el secreto inválido → `403` (D-21/D-36).

## Aviso de proceso

Este repo se construye con un ciclo Spec-Driven (spec → tasks → tu visto por tarea → implementación → compuertas → revisión fresh-eyes → decisión registrada). Si llegas buscando el código: el **scaffold ya existe** (Fase 02: capas, middleware de seguridad completo, tests y contrato superficie en verde); la **infraestructura** se escribió en la Fase 03 (validada en seco), la **pipeline** es la Fase 04 (en vuelo) y los endpoints se llenan en las **Fases 05–08** (numeración post-D-42: ingesta 05, lectura 06, mutación 07, `reply` 08; `setWebhook` + E2E en la 09). Todo verificado por `pnpm test`, `pnpm run lint`, `pnpm run validate:api` y `scripts/check.ps1`.
