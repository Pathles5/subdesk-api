# Tasks — Fase 00 Arquitectura, IaC y estructura de capas

Estado de fase: spec (espejo de `docs/specs/INDEX.md`)

| ID | Tarea | Estado | Responsable | Solución validada | Docs (I8) | Evidencia |
|---|---|---|---|---|---|---|
| T-01 | Elegir IaC: Serverless Framework v4 vs AWS SAM vs CloudFormation nativo, y registrar D-15 | done | orquestador | OK usuario 2026-11-18 ("vamos con SAM") | `docs/human/technical/architecture.md` (topología + compuertas) | D-15 en `DECISIONS.md` · spec §4 elección registrada · compuerta ajustada por D-31 |
| T-02 | Congelar árbol de capas y reglas de dependencia (D-16) | propuesta | orquestador | — (pendiente visto: spec §5, reescrita por D-27: 1 Lambda + Express, `routes/` en vez de `handlers/`) | `docs/human/technical/architecture.md` (ya redactado sobre la propuesta) | — |
| T-03 | Fijar contrato de variables de entorno y stage (D-17) | propuesta | orquestador | — (pendiente visto: spec §6, siete variables con `PORT` solo local) | `docs/human/technical/architecture.md` (apartado "Contrato de configuración") | — |
| T-04 | Fijar política de logs y retención (D-18) | propuesta | orquestador | — (pendiente visto: spec §7) | `docs/human/technical/operations.md` (nace en Fase 02) | — |
| T-05 | Registrar D-16/D-17/D-18 en `DECISIONS.md` tras el visto | pendiente | documentador | — | `docs/human/technical/decisions-summary.md` (Fase 09) | — |
| T-06 | Correr compuerta (`scripts/check.ps1`) y cerrar fase en `INDEX.md` | pendiente | orquestador → documentador | — | pase de frescura de `docs/human/**` | — |
| T-07 | Elegir modelo de capacidad/coste: (i) $0 estricto con Function URL, (ii) híbrida, (iii) brief tal cual → enmienda de I2 + D-26/D-27 | done | orquestador | OK usuario 2026-11-18 ("vamos con la provisionada… Function URL con una API express dentro") | `docs/human/technical/architecture.md` (DynamoDB provisioned, Function URL, límites de plataforma) | D-26 y D-27 · constitución I1/I2/I4/I5/I7 · `check.ps1` asserts de IaC verificados en verde y en rojo |
| T-08 | Fijar pnpm como único gestor con política de cadena de suministro (D-30, constitución I4b) | done | orquestador | OK usuario 2026-11-18 ("no quiero usar npm… prefiero usar PNPM") | `docs/human/technical/architecture.md` (tabla de compuertas con pnpm) | D-30 · I4b/I7 · asserts verificados en verde y en rojo (2026-11-18) |
| T-09 | Ajustar la compuerta de IaC a `cfn-lint` y sacar `sam build` de las compuertas (D-31) | done | orquestador | — (consecuencia técnica de D-30, sin alternativa distinta) | `docs/human/technical/architecture.md` (sección "Compuertas del proyecto") | D-31 · AGENTS §1.5/§6 · spec §8/§9 C5 · permisos de devops, implementer y reviewer |
| T-10 | Definir y mechanizar la documentación para humanos (I8: mapa, frescura, contrato, diagramas) | done | orquestador | OK usuario 2026-11-18 ("incluir la obligación de generar documentación para humanos… donde colocariamos esto… que se mantenga actualizada") | `docs/human/README.md` (índice + tabla de frescura) · `docs/human/technical/architecture.md` | D-32 · constitución I8 (I8a–I8d) · AGENTS §1.8/§3/§3a/§4/§6 · asserts I8 de `check.ps1` verificados en verde y en rojo |

Convenciones: formato y reglas de llenado en `docs/harness/tasks-format.md` (incluida la columna *Docs* de I8). Ninguna tarea pasa a `validada (en-flight)` sin el visto del usuario (D-07), ni a `done` sin su fila *Docs* resuelta (I8).
