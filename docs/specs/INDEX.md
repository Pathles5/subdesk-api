# INDEX — Specs por fase

Fuente de verdad del progreso. Una fila por fase: título, estado y pendientes.
Estados: `draft` → `spec` → `implement` → `verified` (+ `approved` si requiere visto del usuario).

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 00 | Arquitectura, IaC y estructura de capas | spec | D-15…D-32 registradas; constitución al día (I1–I8, incl. I4b); `check.ps1` con asserts de IaC, cadena de suministro y frescura de docs en PASS; docs/human/README.md + technical/architecture.md creados. Pendiente de visto: T-02 capas · T-03 env · T-04 logs |
| 01 | Modelo de datos y contratos de API | — | |
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

## Punto de retomada (2026-11-18, cierre de sesión)

Harness y decisiones de arquitectura **cerrados y coherentes**; **código de producto: todavía no se ha escrito nada a propósito** (el usuario pidió no empezar las tareas).

- **Estado:** Fase 00 en `spec`. Registradas D-01…D-32. Compuerta `powershell -File scripts/check.ps1` en **PASS**.
- **Decisiones vigentes del usuario:** AWS SAM (D-15) · DynamoDB `PROVISIONED` 25/25 sin auto scaling con vía de escape a `PAY_PER_REQUEST` solo con OK (D-26) · **1 Lambda + Express detrás de una Lambda Function URL** (D-27) · **pnpm único gestor**, npm prohibido (D-30) · compuerta de IaC = `cfn-lint`, `sam build` fuera de compuertas (D-31) · **documentación para humanos obligatoria y con frescura computable** (D-32 / I8).
- **Siguiente acción del orquestador en la nueva sesión:** pedir el visto de **T-02** (árbol de capas de `docs/specs/00-arquitectura/spec.md` §5), **T-03** (§6, siete variables) y **T-04** (§7, política de logs). Con ese visto: registrar D-16/D-17/D-18, ejecutar T-05, correr compuertas (T-06) y cerrar Fase 00 como `verified`/`approved` en este INDEX.
- **Después:** escribir la spec de la **Fase 01** (`docs/specs/01-modelo-contratos/spec.md`) con `docs/api/openapi.yaml` y `docs/human/functional/api.md` + `technical/data-model.md` como entregables (I8c). **Nada de `implement` sin el visto por tarea (D-07).**
- **Bloqueos / recordatorios:** no existe `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `README.md`, `CHANGELOG.md` ni `template.yaml` todavía → los asserts de I4b e I8 se activan solos al crear cada artefacto en su fase. Los despliegues y `setWebhook` siguen prohibidos sin visto explícito (I6). Si se reanuda con cambios de permiso en los agentes, volver a leer `.opencode/agents/*.md`: se editaron en esta sesión.
- **Estado de git:** todo el andamiaje y los cambios de las sesiones 1 y 2 quedan commiteados juntos (ver `git log -1`): SAM, `PROVISIONED` 25/25, Function URL + Express, pnpm/I4b, compuerta `cfn-lint`, la documentación I8 y los archivos de `docs/human/`. Working tree limpio al cerrar la sesión: cualquier cambio nuevo que veas `git status` después de este punto es trabajo de la siguiente fase.
