# INDEX — Specs por fase

Fuente de verdad del progreso. Una fila por fase: título, estado y pendientes.
Estados: `draft` → `spec` → `implement` → `verified` (+ `approved` si requiere visto del usuario).

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 00 | Arquitectura, IaC y estructura de capas | approved | Cerrada 2026-11-19 con visto explícito del usuario (verify + approve; nota: la columna Estado usa un único token legible por `check.ps1`, y `approved` implica `verified`). Compuerta `check.ps1` en PASS (bis) y revisión fresh-eyes APTA CON OBSERVACIONES (C1–C11). Decisiones de fase: D-15…D-18, D-26…D-27, D-30…D-32 y enmienda D-34 (mapa I8a). Deuda transferida a Fase 02: huecos de mecanización de `check.ps1` (`engines.node`, `patchedDependencies`, `verifyStoreIntegrity`/`verifyDepsBeforeRun`/`enablePrePostScripts`, región única, `allowBuilds` como fallo) |
| 01 | Modelo de datos y contratos de API | approved | Cerrada 2026-11-19: visto D-07 por tarea (T-02/T-03/T-04), enmienda I3 con OK del usuario (D-35), compuerta `check.ps1` PASS (terciada: pre-fixes, post-fixes y cierre), revisión fresh-eyes **APTA CON OBSERVACIONES** sin bloqueantes — desviaciones D1–D6 corregidas ANTES del cierre y D7 resuelta con enmienda literal de I5 + OK del usuario (**D-36**). Decisiones: D-19/D-20/D-21-cierre/D-22 + D-33/D-34/D-35/D-36. Contratos **congelados** para el panel (I3) |
| 02 | Scaffold del proyecto (ESM, lint, scripts) | verified | Cerrada 2026-11-20: compuertas ✓✓✓✓✓ (`install --frozen-lockfile`, `lint`, `test` 27/27, `validate:api`, `check.ps1`) + smoke HTTP 5/5 + revisión fresh-eyes **APTA CON OBSERVACIONES** (desv. 1–7 corregidas antes del cierre: BOM en 6 archivos, `TG_UPDATE_NS`→Fase 04 por **D-39**, tabla de frescura, regla-4 en dos tiempos, prosas pre-F02, asserts nuevos en `check.ps1`). Decisiones: D-23/D-28 (+D-39). **Deudas que viajan**: Fase 03 — runtime Lambda exacto (ojo engines de devDeps: redocly pide Node ≥22.12 en CI), `@mermaid-js/mermaid-cli`, spike D-31; Fase 04 — congelar `TG_UPDATE_NS` + regenerar ejemplos, tests del logger por campo / malformed-JSON→200 `unsupported_update` / mounting↔registry (obs. 8 del revisor) |
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
| 11 | Panel frontend consumidor (fuera de este repo) | waiting | Solo cuando los contratos de Fase 01 estén congelados (✅ congelados el 2026-11-19) |
| 12 | Bot de Telegram `subdesk-bot` (proyecto-hijo, fuera de este repo): comandos, botones de suscripción, catálogo | waiting | Diseño registrado en D-38 + `docs/human/technical/bot-plan.md`; aterrizaje tras la Fase 08 de esta API (§6 de bot-plan) |

## Punto de retomada (2026-11-20, cierre de Fase 02)

Fases 00–01 **`approved`**; **Fase 02 `verified`** — el repo ya es código: `src/` con seguridad completa (`apiKey`, `webhookGuard`), andamiaje I4b y 5 compuertas en verde (`check.ps1`, `lint`, `test` 27/27, `validate:api`, smoke HTTP 5/5). Revisión fresh-eyes APTA CON OBSERVACIONES: desviaciones 1–7 corregidas **antes** del cierre (BOM de PowerShell en 6 archivos —lesson: reescribir con `[IO.File]::WriteAllBytes`—, `TG_UPDATE_NS`→Fase 04 por **D-39**, frescuras y prosas sincronizadas, asserts nuevos en `check.ps1`). Decisiones de la fase: **D-23, D-28, D-39**. Próximo ID libre: **D-40**.

- **Siguiente acción del orquestador:** spec + tasks de la **Fase 03 (IaC)** en `docs/specs/03-iac/`: `template.yaml` SAM (1 tabla `PROVISIONED` 25/25 sin índices, 1 Lambda con el runtime **exacto** — decidir nodejs20/22 con en mente que las devDeps de CI piden Node ≥22.12, 256 MB, 30 s—, `FunctionUrlConfig` con `Cors` como única fuente y `AuthType: NONE`, rol IAM de menor privilegio D-24, `Parameters NoEcho`, retención CloudWatch ≤30 días); scripts `validate:iac` = `cfn-lint` + `docs:diagrams` con `@mermaid-js/mermaid-cli` (⚠️ posible necesidad de `allowBuilds` para Puppeteer: decisión + OK del usuario antes de instalar); spike D-31 del empaquetado con `nodeLinker: hoisted` sin `sam build`; `deployment.mmd`+`component.mmd` con `.svg`; `runbook.md` (sección en seco); premisas de §10c de la Fase 00 (Function URL en us-east-1, alerta $0, cuenta Paid — consultas de solo lectura, se reportan, no se despliega). Compuerta Fase 03: las 5 de antes + `pnpm run validate:iac` + asserts de IaC de `check.ps1` en verde.
- **Deudas que viajan:** Fase 03 — assert «región única» de `check.ps1` (necesita template), vocabulario único de placeholders en docs, spike D-31, decisión Puppeteer/`allowBuilds`; Fase 04 — congelar `TG_UPDATE_NS` + regenerar ejemplos de `id`/cursor (D-39), y los tests que el revisor de 02 exigió entonces: logger redactando por nombre de campo, malformed-JSON del webhook → `200 unsupported_update` sobre la app real (ojo: hoy caería en `internal_error`; el contrato pide `unsupported_update` — cerrar en 04), mounting↔registry.
- **Recordatorios:** despliegues y `setWebhook` prohibidos sin visto explícito (I6); `npm`/`npx`/`yarn` proscritos (I4b/D-30); Estado de INDEX = token único de la lista blanca; congelación de marcadores al cerrar fase = convención «revisado-vigente» (docs/human/README regla 1).
