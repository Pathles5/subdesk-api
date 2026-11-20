# Documentación para humanos — índice

Actualizado: fase 01 · 2026-11-20

Este es el mapa vinculante de la documentación que **una persona** lee: para usar el sistema, para mantenerlo y para operarlo. El proceso SDD (specs, tasks, decisiones) vive en `docs/specs/**` y `docs/harness/**`; aquí no se duplica, se **explica**. Regla general: constitución **I8**.

Idioma: prosa en español. Rutas, campos JSON, `operationId`, comandos y nombres de recursos en inglés. Secretos: solo placeholders (`<ADMIN_API_KEY>`, `<TELEGRAM_BOT_TOKEN>`).

## Qué hay dónde

| Artefacto | Para quién | Qué contiene | Dueño | Nace en | Estado |
|---|---|---|---|---|---|
| `README.md` (raíz) | quien clona el repo | qué es (API — sin bot, D-37), estado por fases, comandos, variables, conexión del bot, límites | documentador (por orden) | v1 creada 2026-11-19 a petición del usuario (orquestador); se **completa en Fase 02** con comandos ejecutables reales | **creado v1 (Actualizado: fase 01 · 2026-11-20)** |
| `CHANGELOG.md` (raíz) | quien consume la API | cambios por versión: endpoints añadidos/modificados, rupturas, migraciones | documentador | Fase 02 | pendiente (Fase 02) |
| `functional/product.md` | producto / agente del panel | flujos de uso: usuario escribe al bot → ticket → agente responde → llega al chat | documentador | Fase 09 | pendiente (Fase 09) |
| `functional/api.md` | frontend del panel | los 4 endpoints en lenguaje humano: ejemplos reales de petición/respuesta, errores, auth, límites (30 s / 6 MB) | documentador | **Fase 01** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `technical/architecture.md` | quien mantiene el código | topología real (Function URL → Express → services → repositories → DynamoDB), capas y reglas de dependencia, dónde entra cada cosa | documentador | **Fase 00** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `technical/data-model.md` | quien mantiene el código | la tabla, el enum cerrado, capacidad provisioned 25/25 y su franquicia, consumo de RCU/WCU del `Scan`, cuándo migrar a `Query` | documentador | **Fase 01** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `technical/operations.md` | quien opera | seguridad (x-api-key, secret token), logs (qué se registra y qué nunca), cold start, límites, IAM | documentador | Fase 02 | pendiente (Fase 02) |
| `technical/bot-plan.md` | quien diseñe el bot (proyecto-hijo, fase futura 12) | reparto bot↔API, topología de dos Function URLs, protocolo (update-format, `update_id` sintéticos, ack encadenado), reglas del catálogo y aterrizaje | orquestador | **Fase 01+ (D-38)** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `technical/decisions-summary.md` | cualquiera | resumen legible de `DECISIONS.md` con enlaces a las IDs (no lo reescribe) | documentador | Fase 09 | pendiente (Fase 09) |
| `docs/api/openapi.yaml` | **contrato** machine-readable | OpenAPI 3.1 de los 4 endpoints: schemas, códigos, ejemplos, seguridad. **Propiedad del orquestador**: es contrato, no prosa | orquestador | **Fase 01** | **creado (Actualizado: fase 01 · 2026-11-20)** |
| `docs/api/api.html` | lector ocasional | documento navegable generado **en local** desde `openapi.yaml` (devDependency; sin CDN) | documentador | opcional | opcional |
| `docs/human/diagrams/api-flow.mmd` (+ `.svg`) | todos | por endpoint: cliente → Function URL → router → middleware → service → repository/Telegram, con los caminos de error | documentador | Fase 04 | pendiente (Fase 04) |
| `docs/human/diagrams/deployment.mmd` (+ `.svg`) | todos | repo → GitHub Actions → SAM/CloudFormation → recursos AWS (región única, 1 Lambda, 1 tabla, 1 URL) | documentador | Fase 03 | pendiente (Fase 03) |
| `docs/human/diagrams/component.mmd` (+ `.svg`) | mantenimiento | capas internas y dirección única de dependencias | documentador | Fase 03 | pendiente (Fase 03) |
| `docs/human/runbook.md` | quien despliega | desplegar, registrar/cambiar el webhook, rotar `ADMIN_API_KEY`, revisar coste y cuotas, rollback, limpieza de resource policy | documentador | Fase 03 (sección en seco) → Fase 08 (completo) | pendiente (Fase 03) |

## Regla de frescura (computable)

1. Cada archivo de esta carpeta, y `README.md`/`CHANGELOG.md`, llevan arriba del todo: `Actualizado: fase NN · AAAA-MM-DD`.
2. Al cerrar **cada tarea** en `done`, se actualiza el artefacto afectado y la columna *Docs* de `tasks.md` lo cita (o declara `sin impacto`).
3. Al cerrar **cada fase**, `scripts/check.ps1` comprueba que ningún artefacto requerido tiene un marcador anterior a la última fase cerrada en `docs/specs/INDEX.md`. Si lo tiene, **la fase no cierra** (I8b).
4. El contrato no puede divergir del código: `pnpm run validate:api` (lint del OpenAPI) + el test de contrato `tests/contract/openapi.test.js` (rutas, métodos, códigos y schemas contra la app Express) están en la compuerta desde la Fase 02.

## Cómo se regenera la documentación derivada

Todo con devDependencies locales, instaladas por pnpm (constitución I4b; prohibido `npm`/`npx`/CDN). **Los tres comandos nacen con el scaffold de Fase 02** (D-33 fija las herramientas):

```bash
pnpm run validate:api                 # lint de docs/api/openapi.yaml
pnpm run docs:api-html                # docs/api/api.html a partir de openapi.yaml (Redoc, offline)
pnpm run docs:diagrams                # docs/human/diagrams/*.svg a partir de los *.mmd (mermaid-cli)
```

Los `.mmd` son la fuente versionable y revisable en diff; los `.svg` se commitean junto a ellos para que cualquier persona lea los diagramas sin instalar nada.

## Qué NO va aquí

- Decisiones con su historia (eso es `DECISIONS.md`, append-only: aquí se resume y se enlaza por ID).
- Criterios de aceptación y tareas de fase (`docs/specs/NN-*/`).
- Notas internas de agentes o del orquestador (`docs/harness/`).
- Nada con secretos, URLs con credenciales o datos personales de usuarios de Telegram en los ejemplos.
