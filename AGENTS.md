# AGENTS.md — Harness del agente para SubDesk API

Instrucciones de operación para cualquier agente de IA que trabaje en este repo.
Orden de mando: `PROMPT.md` (brief) → `docs/specs/constitution.md` (inmutables; gana a todo) → este archivo → specs por fase.
Respuestas y documentación en español; código, identificadores y comentarios en inglés.

## 1. Ciclo de fase (SDD)

Cada fase es una máquina de estados:

```
draft → spec → tasks → [por tarea: propose·validate → implement] → verify → decided (→ approved si la compuerta exige visto del usuario)
```

1. **Spec.** Crear `docs/specs/NN-<nombre>/spec.md`: objetivo, alcance, decisiones previstas, **criterios de aceptación verificables** y qué queda fuera. Escribir esto SIEMPRE antes de tocar código.
2. **Tasks.** Descomponer en `docs/specs/NN-<nombre>/tasks.md` con la tabla de `docs/harness/tasks-format.md`. Las casillas las marca el orquestador, o el documentador bajo su orden.
3. **Propose·validate (OBLIGATORIO para cada tarea, D-07).** Antes de pasar una tarea al implementador, el **planteamiento de la solución** se muestra al usuario y queda validado por él. Sin visto del usuario no hay implement. Esto incluye las soluciones que propongan los subagentes: el subagente propone; el usuario valida; el implementador ejecuta.
4. **Implement.** Solo lo que cubren spec y tasks, ejecutando la solución validada. Trabajo no previsto: o se amplía la spec (con nota de motivo y registro en `DECISIONS.md`) o se anota como pendiente de otra fase.
5. **Verify.** Ejecutar `powershell -File scripts/check.ps1` (compuerta documental + asserts de IaC + asserts de cadena de suministro + **frescura de `docs/human/**` (I8)** + higiene de secretos). Dependencias siempre con **`pnpm install --frozen-lockfile`** (npm/yarn prohibidos, I4b). Desde Fase 02, además `pnpm run lint`, `pnpm test` y `pnpm run validate:api`. Desde Fase 03, además `pnpm run validate:iac` = **`cfn-lint template.yaml`** (offline, sin credenciales, sin ejecutar scripts de dependencias; `sam build` **no** es compuerta: AWS documenta que corre *package manager scripts*, D-31). Si algo falla, arreglar antes de avanzar.
6. **Revisor.** Al cierre de cada fase, un subagente revisor con ojos frescos evalúa la entrega contra los criterios de la spec (ver §3 y `docs/harness/reviewer-checklist.md`) y reporta desviaciones. El orquestador corrige o registra el desvío aceptado.
7. **Decide.** Registrar en `DECISIONS.md` las decisiones de la fase con IDs (`D-xx`), opción elegida, motivo y riesgo.
8. **Documenta (obligatorio, I8 / D-32).** Toda tarea cerrada deja actualizado el artefacto de `docs/human/**` que afecte (doc funcional, técnica, contrato `openapi.yaml`, diagramas Mermaid, `README.md`, `CHANGELOG.md`, `runbook.md`) con su línea `Actualizado: fase NN · fecha`, y la columna *Docs* de `tasks.md` cita lo tocado o `sin impacto`. Al cerrar la fase se comprueba la frescura con `scripts/check.ps1`: un artefacto con marcador anterior a la última fase cerrada es un fallo de compuerta. **La fase no pasa a `verified` con la documentación pendiente.**

Reglas de estado:

- **El estado vive en `INDEX.md`**, no en la spec. `INDEX.md` es la única fuente de verdad del progreso.
- **La spec se congela en cuanto entra en `implement`**: cambios posteriores = enmienda documentada en la spec (sección *Amendments*) + `DECISIONS.md`.
- **`DECISIONS.md` es append-only**: una decisión desfasada no se borra; la nueva la referencia con `supersedes: D-xx`. Las specs pueden citar IDs de decisión.
- **Contratos congelados**: el modelo de datos y los contratos de API de la Fase 01 son la referencia vinculante del panel frontend; cambiarlos es enmienda, no refactor.

## 2. Change control

- La **constitución solo se modifica con aprobación explícita del usuario**: propuesta de enmienda → OK del usuario → cambio + registro en `DECISIONS.md`.
- Las **specs** se reescriben libremente antes de `implement`; después, solo por vía de enmienda.
- El brief de producto (`PROMPT.md`) solo cambia pidiendo autorización al usuario.
- Las **definiciones de agente** (`.opencode/agents/*.md`) y este `AGENTS.md` son change control de harness: el orquestador tiene `ask` al editarlos.
- **Dependencias y cadena de suministro** (I4b / D-30): el gestor de paquetes, su versión en `packageManager`, `pnpm-lock.yaml`, `allowBuilds`, `pnpmfile`, `patchedDependencies` o cualquier spec exótica **no se cambian desde el código**: son decisión registrada + edición de `package.json`/`pnpm-workspace.yaml` ordenada por el orquestador. El implementador tiene `pnpm add|update|install` denegados.
- **Acciones externas** (crear/modificar recursos AWS reales, `deploy`, `remove`, `setWebhook`, rotar claves): nunca automáticas. Se proponen con comandos exactos y se ejecutan con visto del usuario (I6).

## 3. Swarm (orquestación de subagentes)

Desde **todas** las fases (decisión D-02). Los roles están definidos como archivos Markdown de OpenCode V2 en `.opencode/agents/<nombre>.md` (frontmatter `description` / `mode` / `permissions`, cuerpo = system prompt); el orquestador además es el `default_agent` del repo (`opencode.jsonc`, D-10). Roles:

| Rol | Definición | Contexto | Qué hace / no hace |
|---|---|---|---|
| **Orquestador** | `.opencode/agents/orchestrator.md` (`mode: primary`, default del repo) | Brief, constitución, historia de decisiones, conversación | Specs, decisiones, propuestas y validación con el usuario, integración, compuertas, ejecución de acciones externas con el visto. No delega decisiones de diseño ni de contrato. Sus `permissions` piden aprobación del usuario para editar constitución, `AGENTS.md`, `PROMPT.md` y los agentes, y solo le dejan lanzar los 5 subagentes del harness. |
| **Implementador** | `.opencode/agents/implementer.md` | Prompt cerrado: spec + tasks + **solución validada por el usuario** + lista exacta de archivos | Ejecuta la solución validada en `src/**` y `tests/**`. No marca tasks, no toca IaC ni CI/CD, no edita docs: **en su informe declara el impacto documental** (qué artefactos de `docs/human/**` hay que tocar) y el orquestador lo ordena al documentador (I8). No añade dependencias fuera de lo validado. |
| **Explorador** | `.opencode/agents/explorer.md` | Pregunta puntual | Lee, busca e investiga (docs de Telegram Bot API, Function URL, cuota de Free Tier, ajustes de seguridad de pnpm, sintaxis de SAM/CFN); nunca escribe ni ejecuta shell. |
| **Revisor fresh-eyes** | `.opencode/agents/reviewer.md` | Spec + criterios de aceptación, sin saber quién escribió el código | Compara entrega contra criterios; reporta desviaciones por severidad. Solo lectura + compuertas (`check`/`lint`/`test`/`validate:api`/`validate:iac`). **Verifica también la documentación: contrato `openapi.yaml` coherente con el código, diagramas al día, frescura `Actualizado:` y ejemplos ejecutables (I8).** |
| **Documentador** | `.opencode/agents/documenter.md` | Orden mecánica del orquestador | Sincroniza `INDEX.md`, `tasks.md`, `DECISIONS.md` y **toda la documentación para humanos: `README.md`, `CHANGELOG.md` y `docs/human/**` (funcional, técnica, `api/openapi.yaml`, diagramas Mermaid, `runbook.md`) con su marcador `Actualizado:` (I8)**. Nunca toca código, IaC ni constitución. |
| **DevOps** | `.opencode/agents/devops.md` (definido por adelantado, D-12; se activa en Fase 03) | Spec de la fase de infra + constitución (I2: coste $0, D-11/D-26/D-27; I4b: cadena de suministro, D-30) | IaC SAM (`template.yaml`, `infra/**`) y workflows de Actions (`.github/**`). Shell solo de inspección y validación estática (`cfn-lint`, `validate-template`, `describe-*`); **`sam build`/`sam deploy` no son compuertas** y los despliegues los propone y los ejecuta el orquestador con el visto (D-31). Nunca crea ni destruye recursos pagados ni elimina tablas/stacks/functions (deny mecánico). |

Reglas del protocolo:

1. **Prompts autosuficientes**: los subagentes nacen sin memoria; cada prompt lleva ruta de constitución, ruta de spec y tarea explícita. Un prompt tipo "continúa lo de antes" es un bug del orquestador.
2. **Escritura acotada**: el prompt lista los archivos exactos que puede crear/editar. Fuera de esa lista: informe, no acción. (Los `permissions` de cada `.md` lo refuerzan mecánicamente.)
3. **Devolución estructurada**: qué hizo, qué quedó fuera, riesgos. El orquestador integra y el documentador sincroniza estado. Plantillas en `docs/harness/`.
4. **Paralelización con criterio**: varias tareas pueden estar `en-flight` a la vez solo si no comparten archivos. Contratos de datos, seguridad e integración final: siempre del orquestador.
5. **Límite de bucle (máximo 2 repeticiones, D-08)**: una tarea no puede rebotar entre subagentes más de 2 veces. Primera entrega → revisión → corrección 1 → revisión → corrección 2. Si tras la segunda corrección no pasa, la tarea pasa a `bloqueada` y vuelve al orquestador: la resuelve él directamente o escala al usuario. El bloqueo queda anotado en la spec (sección *Risks / deviations*).
6. **Validación user-first (D-07)**: las propuestas de solución que nazcan en subagentes no llegan al implementador sin pasar por el usuario (§1.3). El orquestador presenta y recolecta el visto.
7. Las plantillas de prompt y las listas de verificación viven en `docs/harness/` (no en las specs).
8. **Documentación como parte de la entrega (I8 / D-32)**: el contrato machine-readable (`docs/api/openapi.yaml`) es propiedad del orquestador (es contrato, no prosa); la redacción de `docs/human/**`, `README.md`, `CHANGELOG.md` y diagramas la ejecuta el documentador por orden, con el contenido que el orquestador dicta desde la spec y el informe del implementador. **Ninguna tarea pasa a `done` con su fila *Docs* vacía.**

### 3a. Ciclo de vida y asignación de tareas (D-09)

Cada tarea de `tasks.md` tiene ID (`T-xx`), estado, responsable, evidencia y **fila *Docs*** (artefactos de `docs/human/**` tocados o `sin impacto`). Estados:

```
pendiente → propuesta → validada(en-flight) → impl-done → revisada → done
                                     ↘ bloqueada (tras 2 bucles, D-08)
```

Matriz de asignación (la tarea rota de rol **cuando cambia de estado**; no hay round-robin):

| Estado | Propon la solución | Ejecuta | Revisa | Documentación (I8) |
|---|---|---|---|---|
| pendiente | Orquestador (o el subagente que él designe) | — | — | Documentador anota el artefacto previsible en la fila *Docs* |
| propuesta | Orquestador te la muestra (D-07) | — | — | Documentador |
| validada (en-flight) | — | Implementador (código) / DevOps (IaC, CI) | — | Implementador **declara el impacto documental en su informe**; no edita docs |
| impl-done | — | Orquestador corre compuertas (`check`/`lint`/`test`/`validate:api`/`validate:iac`) | Revisor fresh-eyes | **Documentador actualiza los artefactos afectados, su línea `Actualizado:` y `CHANGELOG.md`, por orden del orquestador** |
| revisada-OK | — | — | Revisor confirma frescura y coherencia contrato↔código | Documentador marca `done` **solo con la fila *Docs* rellena** |
| revisada-FAIL | Orquestador reencuadra la solución → nueva validación → corrección 1 → 2 (máx., D-08) | Implementador (corrección) | Revisor | Documentador |
| bloqueada | **Escala al usuario** con lo intentado | — | — | Documentador (nota en la spec, sección *Risks / deviations*) |

Reglas de asignación:

- Contratos de datos, política de seguridad, enmiendas y decisiones: nunca salen del orquestador. El `docs/api/openapi.yaml` es contrato → lo fija el orquestador; el documentador lo maqueta/comenta, nunca lo cambia de fondo.
- **Una tarea no pasa a `done` con la fila *Docs* vacía**, ni una fase a `verified` con frescura rota (`check.ps1` lo comprueba contra la última fase cerrada de `INDEX.md`).
- Todo lo que cree o modifique recursos reales (deploy, `setWebhook`, rotación de claves) lo ejecuta el orquestador con visto del usuario, aunque la definición técnica sea del DevOps.
- El explorador solo interviene en `pendiente`/`propuesta` (investigación de APIs, cuotas y límites de Function URL/DynamoDB, seguridad de dependencias) cuando el orquestador se lo ordena.
- La rotación termina en `done`: una tarea no vuelve a estados anteriores salvo vía revisión-FAIL (y siempre con el límite de bucle de D-08).
- El responsable de sincronizar el estado en `tasks.md`/`INDEX.md` es siempre el documentador (por orden); el orquestador nunca ejecuta en-flight a sí mismo en fases 2+.

## 4. Compuertas de fase

**Transversal a todas las fases (I8):** al cerrar la fase, `docs/human/**` refleja lo entregado (contrato `openapi.yaml`, doc funcional, doc técnica, diagramas, `README.md`, `CHANGELOG.md`) con su línea `Actualizado: fase NN · fecha`, y `scripts/check.ps1` valida la frescura. Una fase con documentación sin actualizar **no** pasa a `verified`.

| Fase | Contenido | Compuerta |
|---|---|---|
| 00 | Arquitectura, elección de IaC, capas, env vars | `check.ps1` en verde; decisión de IaC registrada; estructura de carpetas y contrato de variables documentados; **`docs/human/README.md` (índice + tabla de frescura) y `technical/architecture.md` creados**; **aprobación del usuario** (condiciona todo lo demás) |
| 01 | Modelo de datos + 4 contratos de API | `check.ps1`; esquema estricto de `TicketsTable`, enum de estado, errores y códigos HTTP documentados; idempotencia del webhook decidida; **`docs/api/openapi.yaml` + `functional/api.md` existentes y sin ejemplos con secretos** |
| 02 | Scaffold (ESM, ESLint, scripts, `.env.example`, `pnpm-workspace.yaml`) | `pnpm install --frozen-lockfile` + `pnpm run lint` + `pnpm test` + `check.ps1`; **`README.md` con comandos ejecutables y variables; `CHANGELOG.md`; `technical/operations.md` (dev local); script `validate:api` + test de contrato en verde** |
| 03 | IaC: tabla provisioned, Function URL, Lambda, IAM, env | Compuertas 02 + `pnpm run validate:iac` (cfn-lint) en verde; **asserts de IaC** de `check.ps1` en verde; revisión IAM de menor privilegio; spike D-31 resuelta (artefacto con árbol plano); **`diagrams/deployment.mmd` + `.svg` y `runbook.md` (sección despliegue en seco)**. Las premisas de evidencia I2 (alerta $0, cuenta Paid, cuota 25/25 activa, Function URL en la región) se aportan al levantar la pipeline (Fase 04), no aquí (D-42; visto del usuario 2026-11-20) |
| 04 | **Pipeline de despliegue + primer apilado (app stub) + prune** — D-42 pipelines-first: `deploy.yml` (compuertas → empaquetado determinista runbook §2.5 con verificación del ZIP → `sam deploy` equivalente → smoke contra la URL viva con la colección Postman) y `prune.yml` (`workflow_dispatch` + aprobación manual obligatoria); autenticación OIDC GitHub→IAM (D-43); evidencias C8 de la Fase 03 | Compuertas base + workflow verde en `main` + **stack creado exclusivamente por la pipeline** (ninguna creación/edición/borrado de AWS desde local — regla I6 ampliada) + evidencia de las 4 premisas I2 + URL pública real respondiendo 401/403/404/501 |
| 05 | Ingesta `POST /webhook/telegram` (antes 04) | Compuertas base + tests: `2xx` garantizado en ignores, campos extraídos, ticket en `PENDING`, cero duplicados por `update_id`; **`functional/api.md` + `openapi.yaml` + `diagrams/api-flow.mmd` del endpoint**; entrega por la pipeline viva |
| 06 | Lectura `GET /api/tickets` + auth (antes 05) | Compuertas base + tests de orden desc, filtro `?status=` y `401`/`403` sin `x-api-key` válida; **doc y contrato del endpoint al día** |
| 07 | Mutación `PATCH /api/tickets/{id}` (antes 06) | Compuertas base + tests de enum (`400`), `404` si no existe, `updated_at` refrescado; **doc y contrato al día** |
| 08 | Respuesta `POST /api/tickets/{id}/reply` (antes 07) | Compuertas base + tests con Telegram simulado: `RESOLVED` solo con OK real, estado intacto si Telegram falla; **doc y contrato al día** |
| 09 | `setWebhook` + E2E con bot + hardening + entrega (restos de la antigua 08 + 09) | Prueba E2E documentada contra Telegram real con bot de desarrollo (**visto explícito**); **`runbook.md` completo (`setWebhook` con `curl` exacto, rotación, rollback) y `README.md` con la URL final**; **`functional/product.md` y `technical/decisions-summary.md`**; pase final de frescura; revisión de cuotas y límites |

## 5. Reglas de comunicación

- Si algo es ambiguo: decidir, documentar (spec + `DECISIONS.md`) y seguir. No cerrar con preguntas abiertas, salvo decisiones de producto/estilo que la constitución exige validar con el usuario y salvo acciones externas (I6).
- Si un criterio de la constitución se rompe para superar una limitación técnica: **parar y explicarlo antes**, no silenciar la anomalía. En especial I2 (coste) e I4 (secretos).
- Responder con el estado del repo actualizado (`INDEX.md`) cuando la conversación toque el trabajo.
- Los fallos de compuerta se reportan con la salida del comando, no resumidos.

## 6. Verificación mecánica

- `scripts/check.ps1`: valida constitución y `DECISIONS.md` presentes, cláusula de coste $0 e cláusula de seguridad presentes, spec de la fase en curso con criterios de aceptación y alcance, estado coherente en `INDEX.md` y **higiene de secretos** (ningún token/clave real en archivos del repo). Sin dependencias externas.
- Desde Fase 02 el proyecto integra el mismo script como `pnpm run check`, además de `lint`/`test`. **Todo comando de dependencias es pnpm** (`pnpm install --frozen-lockfile`, `pnpm add -D <paquete>`); `npm`, `npx` e `yarn` están prohibidos por I4b/D-30.
- Desde Fase 03 se añade `pnpm run validate:iac` = **`cfn-lint template.yaml`**. `sam build` queda fuera de las compuertas porque ejecuta scripts de dependencias (D-31); el empaquetado del artefacto se hace con pasos deterministas de pnpm y se valida en la spike D-31 de Fase 03. **Ningún comando de despliegue forma parte de una compuerta.**
- `check.ps1` también valida los **asserts de cadena de suministro** (I7): `pnpm-lock.yaml` presente, `package-lock.json`/`yarn.lock` ausentes, `packageManager: pnpm@x.y.z` exacto, `pnpm-workspace.yaml` con `ignoreScripts`/`strictDepBuilds`/`minimumReleaseAge`/`trustPolicy`, y cero specs exóticas en `dependencies`.
- `check.ps1` valida además la **documentación para humanos** (I8): existe el índice `docs/human/README.md` con su tabla de frescura; existen los artefactos exigidos por la fase en curso (contrato `docs/api/openapi.yaml` desde Fase 01, `README.md`/`CHANGELOG.md` desde Fase 02, diagramas `.mmd` + `.svg` desde Fase 03, `runbook.md` desde Fase 03); cada artefacto requerido lleva `Actualizado: fase NN · fecha` con `NN` ≥ la última fase cerrada en `INDEX.md`; y el `README.md` menciona los comandos reales del proyecto (`pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run dev`).
- Desde Fase 02, `pnpm run validate:api` (lint de `docs/api/openapi.yaml` con la herramienta dev fijada en D-32) y el **test de contrato** `código ↔ openapi` forman parte de la compuerta: si difieren, la fase no cierra. Para exportar diagramas/HTML se usan devDependencies locales (`@mermaid-js/mermaid-cli`, `@redocly/cli`), **nunca** CDN ni servicios hosted (I8d).
