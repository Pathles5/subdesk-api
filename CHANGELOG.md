# CHANGELOG — SubDesk API

Actualizado: fase 04 · 2026-11-22

Cambios por versión, la más nueva primero. Aquí se cuenta **lo que nota una persona**: endpoints que empiezan a responder, comandos que aparecen, variables nuevas, rupturas y migraciones. El contrato vinculante es `docs/api/openapi.yaml`; el proceso interno vive en `docs/specs/**` y `DECISIONS.md`.

## Proceso — Fase 04: modelo de visto de la pipeline y endurecimiento (2026-11-22, sin versión nueva)

Cero cambios en endpoints, en el contrato y en el `template.yaml`. Lo que cambia es **cómo se autoriza un despliegue**, y afecta a cualquiera que opere el repo:

- **No hay aprobación manual en GitHub Actions (D-48).** El environment `dev` se queda **sin *required reviewers*, deliberadamente**: un run nunca queda en *Waiting*. El visto I6 es **la acción que arranca el workflow** — el push a `main` que el orquestador solo hace con tu autorización (deploy) y el `workflow_dispatch` con el literal exacto (prune). `environment: dev` se sigue declarando en todo job que mute AWS, pero por lo que aporta: scope de secretos y el claim OIDC `sub = repo:…:environment:dev` que exige el trust del rol (D-43, fail-closed). **Consecuencia asumida: todo push a `main` despliega, incluidos los commits de solo docs** (spec 04, enmienda A-03; enmiendas a constitución I6 y `AGENTS.md` §4 F04).
- **El hueco que eso abrió está cerrado por rama, no por reviewers:** política de *deployment branches* con **una única regla `main`** (id 67773148) y **`can_admins_bypass: false`**; estado vivo `protection_rules: ["branch_policy"]`. Aplicado y **verificado por API**, no por pantalla: comandos y las dos trampas del esquema en `docs/specs/04-pipeline/bootstrap-oidc.md` §7b.
- **Drift de permisos corregido (A-03.3 → D-49).** La policy inline viva del rol de CI era de un borrador anterior y no bastaba para que CloudFormation opere contra la sesión del rol (`sam deploy` no pasa `--role-arn`): añadidos `logs:CreateLogGroup|PutRetentionPolicy|TagResource|DeleteLogGroup`, `lambda:TagResource|ListTags`, `s3:PutBucketTagging`; fuera `cloudformation:ListStacks`; `iam:PassRole` con su condición `iam:PassedToService`. **Aplicada el 2026-11-22** con visto puntual del usuario y payload comparado programáticamente contra `bootstrap-oidc-cli.sh`; evidencia re-leída con `get-role-policy` y pre-Flight `simulate-principal-policy` (**22/22 `allowed`**, dos negativos de `PassRole` en `implicitDeny`). Es la **única** escritura AWS local autorizada y no abre precedente (D-49).
- **Compuerta nueva, mecanizada (A-03):** `pnpm run check` exige ahora `environment:` **a nivel de job** en todo job que contenga `sam deploy|package|delete`, `create-change-set`, `execute-change-set`, `delete-stack` o `cloudformation deploy`, descartando líneas de comentario. Probado no-vacío con dos workflows sintéticos (`[FAIL]` ambos; los reales `[PASS]`).
- **Dos realidades que iban contradichas por los docs:** `prune.yml` **no** ejecuta `sam delete` (hace `aws cloudformation delete-stack` + sondeo `describe-stacks`, la opción menos privilegiada) y su literal de confirmación es **`BORRO-SUBDESK-API-DEV`**, no el del diseño original.
- **Estado del pipeline:** run #2 (push `2efcd31`) dejó la evidencia C1 — `verify` ✓ 32 s y `package` ✓ 11 s en runner real — y `deploy` ✗ en OIDC con **cero recursos AWS creados** (0 tablas, sin stack, sin roles `subdesk-api-dev-*`, bucket SAM inexistente; confirmado por API el 2026-11-22). Causa raíz corregida (secreto `AWS_ROLE_ARN` re-pegado con el ARN exacto). **El run #3 espera solo el push autorizado.**
- **Documentación tocada por esta tanda:** `docs/human/runbook.md` (§1 regla de oro, §2 completo con el modelo D-48, §2.7 checklist de bootstrap, §4.1 prune, §6 rollback), `docs/human/technical/operations.md` (tabla de compuertas + sección de despliegue/verificación por API + nota del esquema real de `simulate-principal-policy`), `README.md` (flujo de despliegue), `docs/human/diagrams/deployment.mmd`/`.svg` (el paso de aprobación humana ya no existe en el diagrama).

## 0.1.0 — Fase 03: infraestructura como código, validada en seco (2026-11-20)

Sin endpoints nuevos todavía (los stubs `501` siguen esperando a las Fases 04–07) y **sin ningún recurso real creado** — todo estático, con el despliegue pendiente de tu visto (I6). Lo que cambia para quien mira el repo:

- **`template.yaml`** (SAM, D-15): la topología $0 completa declarada como código y validada con `cfn-lint` exit 0 sin credenciales ni supresiones — 1 tabla `PROVISIONED` 25/25 sin índices/Streams/PITR, 1 Lambda `nodejs22.x`/x86_64/256 MB/30 s, 1 Function URL pública (`AuthType: NONE`) con el CORS como única fuente, 1 rol IAM de exactamente dos statements (D-24) y 1 grupo de logs con retención 30 días. Los tres secretos son parámetros `NoEcho`: ni un valor en el repo (I4).
- **Comandos que aparecen**: `pnpm run validate:iac` (necesita `cfn-lint` en PATH — instalado con visto vía `pip --user`) y `pnpm run docs:diagrams` (exporta los SVG locales). Primera excepción registrada de scripts de dependencia: `allowBuilds: [puppeteer, @puppeteer/browsers]` (**D-41**, tu OK explícito) — cualquier otra entrada falla el gate.
- **Documentación nueva**: `docs/human/runbook.md` (validación en seco, receta de empaquetado determinista para F08 con su hazard de `.gitignore` documentado, limpieza de la resource policy, premisas I2) y los diagramas `deployment`/`component` (`.mmd` + `.svg`) dibujados sobre los recursos reales del template.
- **Decisiones**: D-24 (IAM exacto), D-40 (`nodejs22.x` + x86_64), D-41 (excepción Puppeteer), cierre de la fila D-31 (spike del árbol plano: 0 symlinks, zip 856 KB) y premisas de coste pospuestas formalmente a Fase 08 con tu visto (runbook §5).
- **Riesgos nuevos anotados para F08**: colisión del `FunctionName` físico fijo con un segundo stack (runbook §2.6) y el hazard del ZIP sin dependencias si el empaquetado no usa staging/`.samignore` (§2.5).

## 0.1.0 — Scaffold del proyecto (Fase 02 · 2026-11-20)

> Nota de versionado: 0.1.0 se alinea con `info.version` del contrato (`docs/api/openapi.yaml`, congelado en Fase 01). El andamiaje de código de esta fase se considera la primera materialización de esa versión; los endpoints siguen siendo stubs `501` hasta las Fases 04–07, que irán subiendo el version.

Primera entrega ejecutable del repo. Hasta hoy solo existían la arquitectura, el modelo de datos y los contratos. **Ningún endpoint devuelve todavía datos**: los cuatro responden `501` de andamiaje mientras se llenan las capas en las Fases 04–07.

### Proyecto y cadena de suministro

- Proyecto Node **ESM** (`"type": "module"`) gestionado con **pnpm**, versión fijada en `packageManager: pnpm@10.18.1` y `engines.node: ">=20 <23"` (`npm`/`npx`/`yarn` siguen prohibidos, I4b/D-30).
- Política de cadena de suministro completa en `pnpm-workspace.yaml`: `ignoreScripts`, `strictDepBuilds`, `allowBuilds: []`, `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade` y `nodeLinker: hoisted` — este último para que el futuro artefacto Lambda lleve un `node_modules` plano, sin symlinks (D-30/D-31; se valida en la spike de Fase 03).
- Dependencias fijadas con evidencia del registro del **2026-11-20**: runtime `express@5.3.0` y `serverless-http@3.2.0` (D-28); dev `eslint@10.15.0`, `@eslint/js@10.0.1`, `globals@17.14.0`, `supertest@7.3.2`, `js-yaml@5.5.0`, `@redocly/cli@2.81.0`.
  - `@redocly/cli` **2.82.0** (publicada el día anterior) quedó **bloqueada por la cuarentena de 24 h**: la política hizo exactamente lo que D-30 diseñó. Se fijó `2.81.0`, ya cuarentenada, y **la política no se tocó** — ex reducirla exige decisión + OK del usuario.
  - `allowBuilds` sigue `[]` tras `pnpm install --frozen-lockfile`: cero paquetes con scripts de build.

### Esqueleto de capas (D-16), sin lógica de negocio

- `src/app.js` (`createApp(deps)`), `src/lambda.js` (único importador del adaptador), `src/local.js`, `src/routes/`, `src/middleware/`, `src/utils/`, `src/config.js`.
- Los **dos middlewares de seguridad salen completos** de esta fase, no como esqueleto, porque son superficie de seguridad (I4) y no lógica de negocio:
  - `apiKey.js`: `x-api-key` ausente o vacía → `401 UNAUTHORIZED`; presente y distinta de `ADMIN_API_KEY` → `403 FORBIDDEN`. Comparación con `crypto.timingSafeEqual` sobre digestos **SHA-256** de ambos lados, y siempre antes de tocar DynamoDB (D-21).
  - `webhookGuard.js`: gate del secreto (`X-Telegram-Bot-Api-Secret-Token` ausente o inválido → `403`) **más** el error handler del sub-árbol, que convierte cualquier excepción —incluido un cuerpo que no parsea— en `200 {"ignored":"internal_error"}` para que Telegram nunca reintente (I5).
- `src/config.js` es el **único** lector de `process.env` (D-17); los errores de config nombran variables, nunca valores (I4).
- `src/utils/logger.js`: un JSON por evento con la redacción D-18 **por construcción** (los campos que llevan secreto o texto del usuario se reemplazan por `"[redacted]"`).
- Los 4 endpoints quedan montados como **stubs `501`** con envelope de error (`{"error":{"code":"INTERNAL","message":"not implemented yet — Fase N"}}`); `src/routes/registry.js` es la fuente única de la superficie que compara el test de contrato.

### Comandos reales (dejan de ser "desde Fase 02")

`pnpm run dev` · `pnpm run lint` · `pnpm test` · `pnpm run check` · `pnpm run validate:api`.
Cómo se usan y qué prueba cada uno: `docs/human/technical/operations.md`.

### Tests

- Runner `node:test` + `assert/strict`, HTTP con `supertest` contra la app real y mocks por inyección, sin librerías de mock (D-23). **27/27 ✓**: unidades de `apiKey`, `webhookGuard` y `config`, smoke de la app con `supertest` (los 4 endpoints como stub `501`, `404`, `403` de secreto y `400` de JSON malformado) y **test de contrato de superficie** (`src/routes/registry.js` ↔ `docs/api/openapi.yaml`, parseado con `js-yaml`).
- Alcance del contrato verificado hoy: paths, métodos y exigencia de `x-api-key`/secreto por ruta. Los **códigos por endpoint** entran en las Fases 04–07 al sustituir cada stub (D-23).

### Reparación del contrato (forma invariable)

- El primer parseo real del YAML (Fase 02) destapó **3 escalares inválidos** heredados de Fase 01: dos descripciones que empiezan con backtick (líneas 290 y 426) y un `: ` interior sin comillas (línea 447). Se corrigió entrecomillando los tres escalares — **cero cambios en paths, schemas, códigos ni ejemplos** (spec de Fase 02, *Amendments* A-01).
