# Documentación para humanos — índice

Actualizado: fase 03 · 2026-11-20

Este es el mapa vinculante de la documentación que **una persona** lee: para usar el sistema, para mantenerlo y para operarlo. El proceso SDD (specs, tasks, decisiones) vive en `docs/specs/**` y `docs/harness/**`; aquí no se duplica, se **explica**. Regla general: constitución **I8**.

Idioma: prosa en español. Rutas, campos JSON, `operationId`, comandos y nombres de recursos en inglés. Secretos: solo placeholders (`<ADMIN_API_KEY>`, `<TELEGRAM_BOT_TOKEN>`).

## Qué hay dónde

| Artefacto | Para quién | Qué contiene | Dueño | Nace en | Estado |
|---|---|---|---|---|---|
| `README.md` (raíz) | quien clona el repo | qué es (API — sin bot, D-37), estado por fases, comandos, variables, conexión del bot, límites | documentador (por orden) | v1 creada 2026-11-19 a petición del usuario (orquestador); **completada en Fase 02** con los comandos `pnpm` ya ejecutables y `.env.example` referenciado | **actualizado (Actualizado: fase 02 · 2026-11-20)** |
| `CHANGELOG.md` (raíz) | quien consume la API | cambios por versión: endpoints añadidos/modificados, rupturas, migraciones | documentador | Fase 02 | **creado (Actualizado: fase 02 · 2026-11-20)** — entrada `0.1.0` (scaffold, alineada con `info.version` del contrato) |
| `functional/product.md` | producto / agente del panel | flujos de uso: usuario escribe al bot → ticket → agente responde → llega al chat | documentador | Fase 09 | pendiente (Fase 09) |
| `functional/api.md` | frontend del panel | los 4 endpoints en lenguaje humano: ejemplos reales de petición/respuesta, errores, auth, límites (30 s / 6 MB) | documentador | **Fase 01** | **creado (Actualizado: fase 02 · 2026-11-20)** |
| `technical/architecture.md` | quien mantiene el código | topología real (Function URL → Express → services → repositories → DynamoDB), capas y reglas de dependencia, dónde entra cada cosa | documentador | **Fase 00** | **creado (Actualizado: fase 02 · 2026-11-20)** |
| `technical/data-model.md` | quien mantiene el código | la tabla, el enum cerrado, capacidad provisioned 25/25 y su franquicia, consumo de RCU/WCU del `Scan`, cuándo migrar a `Query` | documentador | **Fase 01** | **creado (Actualizado: fase 02 · 2026-11-20)** |
| `technical/operations.md` | quien opera | arranque local (`pnpm run dev`), compuertas y qué prueba cada una (incluida la nueva `validate:iac` y su herramienta `cfn-lint`), smoke manual con `curl`, estado real del servicio (stubs `501`), seguridad en local (`x-api-key` 401/403 y secreto del webhook), política de logs D-18, cuarentena de dependencias y su única excepción registrada (D-41). Despliegue, IAM del rol, retención de logs y límites de plataforma: se leen en `runbook.md` (Fase 03); el objetivo de cold start lo fijan D-27/D-40 | documentador | Fase 02 | **creado (Actualizado: fase 03 · 2026-11-20)** |
| `technical/bot-plan.md` | quien diseñe el bot (proyecto-hijo, fase futura 12) | reparto bot↔API, topología de dos Function URLs, protocolo (update-format, `update_id` sintéticos, ack encadenado), reglas del catálogo y aterrizaje | orquestador | **Fase 01+ (D-38)** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `technical/decisions-summary.md` | cualquiera | resumen legible de `DECISIONS.md` con enlaces a las IDs (no lo reescribe) | documentador | Fase 09 | pendiente (Fase 09) |
| `docs/api/openapi.yaml` | **contrato** machine-readable | OpenAPI 3.1 de los 4 endpoints: schemas, códigos, ejemplos, seguridad. **Propiedad del orquestador**: es contrato, no prosa | orquestador | **Fase 01** | **creado (Actualizado: fase 02 · 2026-11-20; A-01 reparación YAML + D-39 prosa)** |
| `docs/api/api.html` | lector ocasional | documento navegable generado **en local** desde `openapi.yaml` (devDependency; sin CDN) | documentador | opcional | opcional |
| `docs/human/diagrams/api-flow.mmd` (+ `.svg`) | todos | por endpoint: cliente → Function URL → router → middleware → service → repository/Telegram, con los caminos de error | documentador | Fase 04 | pendiente (Fase 04) |
| `docs/human/diagrams/deployment.mmd` (+ `.svg`) | todos | repo → compuertas → (Actions, futuro F08) → stack SAM/CFN con los **7 recursos reales** del template (tabla, función, URL nativa + Permission, rol, log group) + actores Telegram/panel | orquestador (mmd) + mmdc (svg) | **Fase 03** | **creado (Actualizado: fase 03 · 2026-11-20)** |
| `docs/human/diagrams/component.mmd` (+ `.svg`) | mantenimiento | capas internas y dirección única de dependencias, actualizado a D-28 (`serverless-http`) y al registry como fuente de superficie | orquestador (mmd) + mmdc (svg) | **Fase 03** | **creado (Actualizado: fase 03 · 2026-11-20)** |
| `docs/human/runbook.md` | quien despliega | desplegar, registrar/cambiar el webhook, rotar `ADMIN_API_KEY`, revisar coste y cuotas, rollback, limpieza de resource policy | documentador | Fase 03 (sección en seco) → Fase 08 (completo) | **creado (Actualizado: fase 03 · 2026-11-20)** — §1 despliegue **en seco** (`validate:iac` + asserts de `check.ps1` + spike D-31) con sus herramientas; §2 forma del deploy real con `--parameter-overrides` desde los **nombres** de los secretos de GitHub; §3 dónde se leen los outputs; §4 limpieza de la resource policy huérfana al borrar la Function URL; §5 coste, alerta $0 y las premisas C8 **pospuestas a Fase 08 con nota**. El `setWebhook`, la rotación y el rollback con comandos cerrados se añaden en Fase 08 (§6) |

## Regla de frescura (computable)

1. Cada archivo de esta carpeta, y `README.md`/`CHANGELOG.md`, llevan arriba del todo: `Actualizado: fase NN · AAAA-MM-DD`. El marcador significa **última fase en que el artefacto fue revisado y declarado vigente**, no última edición literal (convención fijada en el cierre de Fase 02, spec 02 A-02: `check.ps1` exige marcador ≥ última fase cerrada, así que cerrar una fase incluye repasar y subir el marcador de los artefactos que siguen siendo correctos tal cual).
2. Al cerrar **cada tarea** en `done`, se actualiza el artefacto afectado y la columna *Docs* de `tasks.md` lo cita (o declara `sin impacto`).
3. Al cerrar **cada fase**, `scripts/check.ps1` comprueba que ningún artefacto requerido tiene un marcador anterior a la última fase cerrada en `docs/specs/INDEX.md`. Si lo tiene, **la fase no cierra** (I8b).
4. El contrato no puede divergir del código: `pnpm run validate:api` (lint del OpenAPI) + el test de contrato `tests/contract/openapi.test.js` están en la compuerta desde la Fase 02 — **en dos tiempos** (D-23): hoy verifica **superficie** (paths, métodos y exigencia de auth por ruta); los **códigos de estado y schemas por endpoint** se verifican desde las Fases 04–07 al sustituir cada stub `501` por el handler real. Ningún doc puede prometer la segunda mitad antes de su fase.

## Cómo se regenera la documentación derivada

Todo con devDependencies locales, instaladas por pnpm (constitución I4b; prohibido `npm`/`npx`/CDN). Estado real de los comandos: **`validate:api` existe desde la Fase 02** (D-33: `@redocly/cli@2.81.0`); **`docs:diagrams` nace declarado en la Fase 03** (`node scripts/export-diagrams.mjs`, con `@mermaid-js/mermaid-cli@12.2.0` instalado bajo la excepción de build **D-41**) y produce su primer `.svg` cuando T-07 escriba los `.mmd`; `docs:api-html` sigue opcional y sin script hasta que alguien lo pida:

```bash
pnpm run validate:api                 # lint de docs/api/openapi.yaml — EXISTE (Fase 02)
pnpm run docs:diagrams                # docs/human/diagrams/*.svg desde los *.mmd (mermaid-cli) — declarado en Fase 03
pnpm run docs:api-html                # (opcional, sin fecha) docs/api/api.html desde openapi.yaml (Redoc, offline)
```

La tercera compuerta nueva de la Fase 03, **`pnpm run validate:iac`**, no regenera documentación: valida la plantilla (`cfn-lint template.yaml`, offline y sin credenciales, D-31). Se describe en `technical/operations.md` y en `runbook.md` §1.

Los `.mmd` son la fuente versionable y revisable en diff; los `.svg` se commitean junto a ellos para que cualquier persona lea los diagramas sin instalar nada.

## Qué NO va aquí

- Decisiones con su historia (eso es `DECISIONS.md`, append-only: aquí se resume y se enlaza por ID).
- Criterios de aceptación y tareas de fase (`docs/specs/NN-*/`).
- Notas internas de agentes o del orquestador (`docs/harness/`).
- Nada con secretos, URLs con credenciales o datos personales de usuarios de Telegram en los ejemplos.
