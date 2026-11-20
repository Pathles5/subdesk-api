# CHANGELOG — SubDesk API

Actualizado: fase 02 · 2026-11-20

Cambios por versión, la más nueva primero. Aquí se cuenta **lo que nota una persona**: endpoints que empiezan a responder, comandos que aparecen, variables nuevas, rupturas y migraciones. El contrato vinculante es `docs/api/openapi.yaml`; el proceso interno vive en `docs/specs/**` y `DECISIONS.md`.

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
