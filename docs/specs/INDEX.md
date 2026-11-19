# INDEX — Specs por fase

Fuente de verdad del progreso. Una fila por fase: título, estado y pendientes.
Estados: `draft` → `spec` → `implement` → `verified` (+ `approved` si requiere visto del usuario).

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 00 | Arquitectura, IaC y estructura de capas | approved | Cerrada 2026-11-19 con visto explícito del usuario (verify + approve; nota: la columna Estado usa un único token legible por `check.ps1`, y `approved` implica `verified`). Compuerta `check.ps1` en PASS (bis) y revisión fresh-eyes APTA CON OBSERVACIONES (C1–C11). Decisiones de fase: D-15…D-18, D-26…D-27, D-30…D-32 y enmienda D-34 (mapa I8a). Deuda transferida a Fase 02: huecos de mecanización de `check.ps1` (`engines.node`, `patchedDependencies`, `verifyStoreIntegrity`/`verifyDepsBeforeRun`/`enablePrePostScripts`, región única, `allowBuilds` como fallo) |
| 01 | Modelo de datos y contratos de API | approved | Cerrada 2026-11-19: visto D-07 por tarea (T-02/T-03/T-04), enmienda I3 con OK del usuario (D-35), compuerta `check.ps1` PASS (terciada: pre-fixes, post-fixes y cierre), revisión fresh-eyes **APTA CON OBSERVACIONES** sin bloqueantes — desviaciones D1–D6 corregidas ANTES del cierre y D7 resuelta con enmienda literal de I5 + OK del usuario (**D-36**). Decisiones: D-19/D-20/D-21-cierre/D-22 + D-33/D-34/D-35/D-36. Contratos **congelados** para el panel (I3) |
| 02 | Scaffold del proyecto (ESM, lint, scripts) | — | |
| 03 | Infraestructura como código (tabla + HTTP API + Lambdas + IAM) | — | |
| 04 | Ingesta: `POST /webhook/telegram` | — | |
| 05 | Lectura: `GET /api/tickets` + auth `x-api-key` | — | |
| 06 | Mutación: `PATCH /api/tickets/{id}` | — | |
| 07 | Respuesta: `POST /api/tickets/{id}/reply` | — | |
| 08 | CI/CD + despliegue + registro del webhook (**acción externa: requiere visto**) | — | |
| 09 | Hardening, coste y entrega (`README.md`, informe final) | — | |

Convenciones:
- Cada fase vive en `docs/specs/NN-<nombre>/` con `spec.md` y `tasks.md` (formato: `docs/harness/tasks-format.md`).
- El estado de esta tabla es el único estado válido del proyecto; la spec no lo duplica.
- Al terminar una fase: actualizar esta tabla (por orden del orquestador, lo ejecuta el documentador) y registrar decisiones en `DECISIONS.md`.
- Fases que tocan el mundo real (crear/recursos, `deploy`, `setWebhook`): no pasan a `verified` sin `approved` del usuario.

Fases futuras (fuera de la v1 del brief, para memoria):

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 10 | Query por estado con GSI si el volumen justifica abandonar el `Scan` (I5) | waiting | Decidir umbral de revisión de volumen en Fase 09 |
| 11 | Panel frontend consumidor (fuera de este repo) | waiting | Solo cuando los contratos de Fase 01 estén congelados |

## Punto de retomada (2026-11-19, cierre de Fase 01)

Fases 00 y 01 **CERRADAS `approved`** (congelación I3 de contratos firmada por el usuario). **Código de producto: sigue sin escribirse nada a propósito** — nace en Fase 02.

- **Estado:** compuerta `check.ps1` **PASS** (exit 0; tres corridas: pre-fixes, post-fixes, cierre). Revisión fresh-eyes Fase 01: **APTA CON OBSERVACIONES**, sin bloqueantes; desviaciones D1–D6 corregidas **antes** del congelado (cursor de ejemplo opaco, ejemplo PENDING coherente, nota de `id` ilustrativo + `TG_UPDATE_NS`, estado real del registro en `architecture.md`, aritmética RCU por modo de consistencia, spec **A-03**: `FilterExpression` + consistencia eventual + caracteres vs bytes). D7 resuelta como **enmienda I5 con OK del usuario → D-36**. Decisiones de la fase: D-19/D-20/D-21-cierre/D-22 + D-33 (herramientas doc: `@redocly/cli` + `@mermaid-js/mermaid-cli`), D-34 (ruta única del contrato), D-35 (coherencias I3↔v5, A-01/A-02). Próximo ID libre: **D-37**.
- **Siguiente acción del orquestador:** spec + tasks de la **Fase 02 (scaffold)** en `docs/specs/02-scaffold/`: `package.json` ESM con `packageManager` pnpm versión exacta (**D-28**), `pnpm-workspace.yaml` con la política I4b completa, ESLint flat config, framework de tests (**D-23**; `supertest` contra `createApp()`), `docs/api/openapi.yaml` lintreado con `validate:api` (**D-33**, decidir `--fail-severity` para no fallar por avisos: `info.license` ausente, `security: []` global), `tests/contract/` (test de deriva código↔contrato, I8b.4), `.env.example` con placeholders **en ángulos** (ojo: el escáner de secretos casa `ADMIN_API_KEY=<≥16 chars>` — riesgo reportado por el revisor), y el esqueleto `src/` mínimo sin lógica de negocio (config.js, app.js, lambda.js/local.js). Compuerta de Fase 02: `pnpm install --frozen-lockfile` + `lint` + `test` + `validate:api` + `check.ps1`. **Nada de `implement` sin visto por tarea (D-07).**
- **Deudas heredadas asignadas a Fase 02:** (1) huecos de mecanización de `check.ps1` (`engines.node`, `patchedDependencies`, `verifyStoreIntegrity`/`verifyDepsBeforeRun`/`enablePrePostScripts`, región única, `allowBuilds` como fallo); (2) congelar `TG_UPDATE_NS` en `utils/ids.js` y **regenerar los ejemplos** de `id`/cursor del contrato y docs; (3) vocabulario único de placeholders; (4) posible entrada en `allowBuilds` para Puppeteer de mermaid-cli (decisión I4b con nota, D-33).
- **Recordatorios:** no existe `template.yaml` (Fase 03); despliegues y `setWebhook` prohibidos sin visto explícito (I6); `npm`/`npx`/`yarn` proscritos (I4b/D-30); la columna Estado de este INDEX es token único de la lista blanca de `check.ps1` (`approved` implica `verified`).
