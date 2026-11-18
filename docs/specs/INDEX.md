# INDEX — Specs por fase

Fuente de verdad del progreso. Una fila por fase: título, estado y pendientes.
Estados: `draft` → `spec` → `implement` → `verified` (+ `approved` si requiere visto del usuario).

| Fase | Título | Estado | Pendientes |
|---|---|---|---|
| 00 | Arquitectura, IaC y estructura de capas | spec | Spec escrita; pendiente propose·validate de T-01–T-04 + **T-07 (capacidad/coste: enmienda de I2, cifras en spec §10a-§10b)** |
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
