# Tasks — Fase 00 Arquitectura, IaC y estructura de capas

Estado de fase: spec (espejo de `docs/specs/INDEX.md`)

| ID | Tarea | Estado | Responsable | Solución validada | Evidencia |
|---|---|---|---|---|---|
| T-01 | Elegir IaC: Serverless Framework v4 vs AWS SAM vs CloudFormation nativo, y registrar D-15 | propuesta | orquestador | — (pendiente visto: **B — AWS SAM**, evidencia y comparativa en spec §4 + §8b) | Informe del explorador (18-nov-2026) + doc oficial de upgrade a v4 |
| T-02 | Congelar árbol de capas y reglas de dependencia (D-16) | propuesta | orquestador | — (pendiente visto: spec §5) | — |
| T-03 | Fijar contrato de variables de entorno y stage (D-17) | propuesta | orquestador | — (pendiente visto: spec §6) | — |
| T-04 | Fijar política de logs y retención (D-18) | propuesta | orquestador | — (pendiente visto: spec §7) | — |
| T-05 | Registrar D-15–D-18 en `DECISIONS.md` tras el visto | pendiente | documentador | — | — |
| T-06 | Correr compuerta (`scripts/check.ps1`) y cerrar fase en `INDEX.md` | pendiente | orquestador → documentador | — | — |
| T-07 | Elegir modelo de capacidad/coste: (i) $0 estricto con Function URL, (ii) híbrida provisioned + HTTP API, (iii) brief tal cual → enmienda de I2 + D-26 | propuesta | orquestador | — (pendiente visto: comparativa con cifras citadas en spec §10a/§10b) | Cita literal de `dynamodb/pricing` ("It uses provisioned capacity", "reducing your monthly bill by $14.04") |

Convenciones: formato y reglas de llenado en `docs/harness/tasks-format.md`. Ninguna tarea pasa a `validada (en-flight)` sin el visto del usuario (D-07).
