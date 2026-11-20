# INDEX — Specs por fase

Fuente de verdad del progreso. Una fila por fase: título, estado y pendientes.
Estados: `draft` → `spec` → `implement` → `verified` (+ `approved` si requiere visto del usuario).

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 00 | Arquitectura, IaC y estructura de capas | approved | Cerrada 2026-11-19 con visto explícito del usuario (verify + approve; nota: la columna Estado usa un único token legible por `check.ps1`, y `approved` implica `verified`). Compuerta `check.ps1` en PASS (bis) y revisión fresh-eyes APTA CON OBSERVACIONES (C1–C11). Decisiones de fase: D-15…D-18, D-26…D-27, D-30…D-32 y enmienda D-34 (mapa I8a). Deuda transferida a Fase 02: huecos de mecanización de `check.ps1` (`engines.node`, `patchedDependencies`, `verifyStoreIntegrity`/`verifyDepsBeforeRun`/`enablePrePostScripts`, región única, `allowBuilds` como fallo) |
| 01 | Modelo de datos y contratos de API | approved | Cerrada 2026-11-19: visto D-07 por tarea (T-02/T-03/T-04), enmienda I3 con OK del usuario (D-35), compuerta `check.ps1` PASS (terciada: pre-fixes, post-fixes y cierre), revisión fresh-eyes **APTA CON OBSERVACIONES** sin bloqueantes — desviaciones D1–D6 corregidas ANTES del cierre y D7 resuelta con enmienda literal de I5 + OK del usuario (**D-36**). Decisiones: D-19/D-20/D-21-cierre/D-22 + D-33/D-34/D-35/D-36. Contratos **congelados** para el panel (I3) |
| 02 | Scaffold del proyecto (ESM, lint, scripts) | verified | Cerrada 2026-11-20: compuertas ✓✓✓✓✓ (`install --frozen-lockfile`, `lint`, `test` 27/27, `validate:api`, `check.ps1`) + smoke HTTP 5/5 + revisión fresh-eyes **APTA CON OBSERVACIONES** (desv. 1–7 corregidas antes del cierre: BOM en 6 archivos, `TG_UPDATE_NS`→Fase 04 por **D-39**, tabla de frescura, regla-4 en dos tiempos, prosas pre-F02, asserts nuevos en `check.ps1`). Decisiones: D-23/D-28 (+D-39). **Deudas que viajan**: Fase 03 — runtime Lambda exacto (ojo engines de devDeps: redocly pide Node ≥22.12 en CI), `@mermaid-js/mermaid-cli`, spike D-31; Fase 04 — congelar `TG_UPDATE_NS` + regenerar ejemplos, tests del logger por campo / malformed-JSON→200 `unsupported_update` / mounting↔registry (obs. 8 del revisor) |
| 03 | Infraestructura como código (1 tabla + 1 Lambda + Function URL + IAM) | verified | Cerrada 2026-11-20: 6 compuertas ✓ (lint · test 27/27 · validate:api · **validate:iac exit 0** · docs:diagrams · check.ps1 PASS), spike D-31 resuelta (0 symlinks, zip 856 KB), diagramas sobre los 7 recursos reales, runbook en seco, D-24/D-40/D-41 registradas con visto. Revisión fresh-eyes **APTA CON OBSERVACIONES**: desv. mayores D3 (hazard del ZIP sin `node_modules` por `.gitignore` → receta de empaquetado en runbook §2.5, precondición del workflow F08) y D4 (colisión del `FunctionName` fijo → runbook §2.6 + spec §8.5) corregidas en el cierre; menores D1 (fila D-31 cerrada), D2 (tabla de frescura), D5 (alcance del assert de región), D6 (prosas), D7 (statement-id) resueltas. **Premisas I2/C8: pospuestas a F08 con visto explícito del usuario** (runbook §5) — bloqueantes del deploy, no del cierre |
| 04 | **Pipeline de despliegue + primer apilado (stub) + prune** (D-42) | spec | Nueva fase al frente tras el reorder pipelines-first: `deploy.yml`/`prune.yml` + OIDC (D-43) + evidencias C8 (Function URL us-east-1, `nodejs22.x`, franquicia 25/25, alerta $0, Paid — aquí se aportan, visto del usuario 2026-11-20). Regla I6 ampliada: **solo la pipeline toca AWS**. Pendiente de visto por tarea |
| 05 | Ingesta: `POST /webhook/telegram` (antes 04) | — | Hereda deudas: `TG_UPDATE_NS` + ejemplos, parseo→`unsupported_update`, tests logger/mounting (INDEX retomada F02/F03) |
| 06 | Lectura: `GET /api/tickets` + auth `x-api-key` (antes 05) | — | |
| 07 | Mutación: `PATCH /api/tickets/{id}` (antes 06) | — | |
| 08 | Respuesta: `POST /api/tickets/{id}/reply` (antes 07) | — | |
| 09 | `setWebhook` + E2E con bot + hardening + entrega (restos 08+09) | — | Requiere bot existente (proyecto-hijo D-38) o bot de prueba; visto externo I6 = aprobación del environment Production |

Convenciones:
- Cada fase vive en `docs/specs/NN-<nombre>/` con `spec.md` y `tasks.md` (formato: `docs/harness/tasks-format.md`).
- El estado de esta tabla es el único estado válido del proyecto; la spec no lo duplica.
- Al terminar una fase: actualizar esta tabla (por orden del orquestador, lo ejecuta el documentador) y registrar decisiones en `DECISIONS.md`.
- Fases que tocan el mundo real (crear/recursos, `deploy`, `setWebhook`): no pasan a `verified` sin `approved` del usuario.

Fases futuras (fuera de la v1 del brief, para memoria):

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 10 | Query por estado con GSI si el volumen justifica abandonar el `Scan` (I5) | waiting | Decidir umbral de revisión de volumen en Fase 09 |
| 11 | Panel frontend consumidor (fuera de este repo) | waiting | Solo cuando los contratos de Fase 01 estén congelados (✅ congelados el 2026-11-19) |
| 12 | Bot de Telegram `subdesk-bot` (proyecto-hijo, fuera de este repo): comandos, botones de suscripción, catálogo | waiting | Diseño registrado en D-38 + `docs/human/technical/bot-plan.md`; aterrizaje tras la Fase 08 de esta API (§6 de bot-plan) |

## Punto de retomada (2026-11-20, cierre de Fase 03)

Fases 00–01 `approved`, **Fases 02–03 `verified`**. El repo es código ejecutable + infraestructura validada **sin desplegar nada**: 6/6 compuertas en verde, `template.yaml` lint-clean sin supresiones, spike D-31 resuelta (0 symlinks, zip 856 KB), runbook y diagramas sobre los recursos reales. Decisiones de la fase: **D-24, D-40, D-41** (+ fila D-31 cerrada). Próximo ID libre: **D-42**.

- **Siguiente acción del orquestador:** spec + tasks de la **Fase 04 (ingesta `POST /webhook/telegram`)** en `docs/specs/04-ingesta/`: `src/utils/ids.js` con `TG_UPDATE_NS` **congelado** + test de determinismo + regeneración de los ejemplos `id`/cursor del contrato y docs (D-39/D-35); `ticketRepository` — primer consumidor del SDK (`PutItem` con `attribute_not_exists(id)`; añadir `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` al `package.json` exige decisión registrada, I4b) con fake en memoria para tests (D-23); `ticketService` aplicando las definiciones cerradas de los **6 motivos** (A-01 de la spec 01); extracción de `chat.id`/`from`/`text`; **mapear el parseo fallido del webhook a `200 unsupported_update`** (hoy caería en `internal_error`; el contrato congelado pide `unsupported_update` — deuda F02→F04); alta con `created_at` = `updated_at`. Tests nuevos exigidos por el revisor de F02: logger redactando por nombre de campo, mounting↔registry, y el **test de contrato pasa a la segunda mitad** para este endpoint (códigos/schemas reales ↔ openapi). Compuerta: las 6 de F03 + criterio §4-F04 (2xx garantizado en ignores, campos extraídos, ticket `PENDING`, cero duplicados por `update_id`, api-flow.mmd del endpoint). Cero mundo real: fetch y SDK inyectados, sin DynamoDB ni Telegram vivos (I6).
- **Deudas que viajan:** Fase 04 — lo anterior; Fase 08 — **premisas C8 bloqueantes del deploy** (fila 08 del INDEX), instalación de `sam`/`aws` con visto, receta de ZIP del runbook §2.5 con verificación de contenido antes de proponer el deploy, comprobar colisión de `FunctionName` en la cuenta (§2.6), y en CI: `pip install cfn-lint` como paso explícito + Node ≥22.12 en `setup-node`.
- **Recordatorios:** nada se implementa sin visto por tarea (D-07); Estado INDEX = token único de la lista blanca; el bump masivo de frescuras de este cierre dejó los 11 artefactos requeridos en `fase 03 · 2026-11-20` (reescritos con `WriteAllText` UTF-8 **sin BOM** — regla operativa desde F02); `api-flow.mmd` nace con Fase 04.
