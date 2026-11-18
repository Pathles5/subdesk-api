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
5. **Verify.** Ejecutar `powershell -File scripts/check.ps1` (compuerta documental del harness). Desde Fase 02, además `npm run lint` y `npm test`. Desde Fase 03, además la validación de IaC **sin desplegar** (`npm run validate:iac` o el comando elegido en Fase 00). Si falla, arreglar antes de avanzar.
6. **Revisor.** Al cierre de cada fase, un subagente revisor con ojos frescos evalúa la entrega contra los criterios de la spec (ver §3 y `docs/harness/reviewer-checklist.md`) y reporta desviaciones. El orquestador corrige o registra el desvío aceptado.
7. **Decide.** Registrar en `DECISIONS.md` las decisiones de la fase con IDs (`D-xx`), opción elegida, motivo y riesgo.

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
- **Acciones externas** (crear/modificar recursos AWS reales, `deploy`, `remove`, `setWebhook`, rotar claves): nunca automáticas. Se proponen con comandos exactos y se ejecutan con visto del usuario (I6).

## 3. Swarm (orquestación de subagentes)

Desde **todas** las fases (decisión D-02). Los roles están definidos como archivos Markdown de OpenCode V2 en `.opencode/agents/<nombre>.md` (frontmatter `description` / `mode` / `permissions`, cuerpo = system prompt); el orquestador además es el `default_agent` del repo (`opencode.jsonc`, D-10). Roles:

| Rol | Definición | Contexto | Qué hace / no hace |
|---|---|---|---|
| **Orquestador** | `.opencode/agents/orchestrator.md` (`mode: primary`, default del repo) | Brief, constitución, historia de decisiones, conversación | Specs, decisiones, propuestas y validación con el usuario, integración, compuertas, ejecución de acciones externas con el visto. No delega decisiones de diseño ni de contrato. Sus `permissions` piden aprobación del usuario para editar constitución, `AGENTS.md`, `PROMPT.md` y los agentes, y solo le dejan lanzar los 5 subagentes del harness. |
| **Implementador** | `.opencode/agents/implementer.md` | Prompt cerrado: spec + tasks + **solución validada por el usuario** + lista exacta de archivos | Ejecuta la solución validada en `src/**` y `tests/**`. No marca tasks, no toca IaC ni CI/CD, no edita docs, no añade dependencias fuera de lo validado. Devuelve informe. |
| **Explorador** | `.opencode/agents/explorer.md` | Pregunta puntual | Lee, busca e investiga (docs de Telegram Bot API, cuota de Free Tier, comportamiento de HTTP API, sintaxis de IaC); nunca escribe ni ejecuta shell. |
| **Revisor fresh-eyes** | `.opencode/agents/reviewer.md` | Spec + criterios de aceptación, sin saber quién escribió el código | Compara entrega contra criterios; reporta desviaciones por severidad. Solo lectura + compuertas (`check`/`lint`/`test`/`validate:iac`). |
| **Documentador** | `.opencode/agents/documenter.md` | Orden mecánica del orquestador | Sincroniza `INDEX.md`, `tasks.md`, `DECISIONS.md`, `README.md` y enmiendas de specs. Nunca toca código, IaC ni constitución. |
| **DevOps** | `.opencode/agents/devops.md` (definido por adelantado, D-12; se activa en Fase 03) | Spec de la fase de infra + constitución (I2: coste $0, D-11) | IaC (`serverless.yml`/`template.yaml`/`infra/**`) y workflows de Actions (`.github/**`). Shell solo de inspección y validación; los despliegues los propone y los ejecuta el orquestador con el visto. Nunca crea ni destruye recursos pagados ni elimina tablas/stacks/functions (deny mecánico). |

Reglas del protocolo:

1. **Prompts autosuficientes**: los subagentes nacen sin memoria; cada prompt lleva ruta de constitución, ruta de spec y tarea explícita. Un prompt tipo "continúa lo de antes" es un bug del orquestador.
2. **Escritura acotada**: el prompt lista los archivos exactos que puede crear/editar. Fuera de esa lista: informe, no acción. (Los `permissions` de cada `.md` lo refuerzan mecánicamente.)
3. **Devolución estructurada**: qué hizo, qué quedó fuera, riesgos. El orquestador integra y el documentador sincroniza estado. Plantillas en `docs/harness/`.
4. **Paralelización con criterio**: varias tareas pueden estar `en-flight` a la vez solo si no comparten archivos. Contratos de datos, seguridad e integración final: siempre del orquestador.
5. **Límite de bucle (máximo 2 repeticiones, D-08)**: una tarea no puede rebotar entre subagentes más de 2 veces. Primera entrega → revisión → corrección 1 → revisión → corrección 2. Si tras la segunda corrección no pasa, la tarea pasa a `bloqueada` y vuelve al orquestador: la resuelve él directamente o escala al usuario. El bloqueo queda anotado en la spec (sección *Risks / deviations*).
6. **Validación user-first (D-07)**: las propuestas de solución que nazcan en subagentes no llegan al implementador sin pasar por el usuario (§1.3). El orquestador presenta y recolecta el visto.
7. Las plantillas de prompt y las listas de verificación viven en `docs/harness/` (no en las specs).

### 3a. Ciclo de vida y asignación de tareas (D-09)

Cada tarea de `tasks.md` tiene ID (`T-xx`), estado, responsable y evidencia. Estados:

```
pendiente → propuesta → validada(en-flight) → impl-done → revisada → done
                                     ↘ bloqueada (tras 2 bucles, D-08)
```

Matriz de asignación (la tarea rota de rol **cuando cambia de estado**; no hay round-robin):

| Estado | Propon la solución | Ejecuta | Revisa | Sincroniza doc |
|---|---|---|---|---|
| pendiente | Orquestador (o el subagente que él designe) | — | — | Documentador |
| propuesta | Orquestador te la muestra (D-07) | — | — | Documentador |
| validada (en-flight) | — | Implementador (código) / DevOps (IaC, CI) | — | Documentador |
| impl-done | — | Orquestador corre compuertas (`check`/`lint`/`test`/`validate:iac`) | Revisor fresh-eyes | Documentador |
| revisada-OK | — | — | — | Documentador marca `done` |
| revisada-FAIL | Orquestador reencuadra la solución → nueva validación → corrección 1 → 2 (máx., D-08) | Implementador (corrección) | Revisor | Documentador |
| bloqueada | **Escala al usuario** con lo intentado | — | — | Documentador |

Reglas de asignación:

- Contratos de datos, política de seguridad, enmiendas y decisiones: nunca salen del orquestador.
- Todo lo que cree o modifique recursos reales (deploy, `setWebhook`, rotación de claves) lo ejecuta el orquestador con visto del usuario, aunque la definición técnica sea del DevOps.
- El explorador solo interviene en `pendiente`/`propuesta` (investigación de APIs, cuotas, límites de HTTP API) cuando el orquestador se lo ordena.
- La rotación termina en `done`: una tarea no vuelve a estados anteriores salvo vía revisión-FAIL (y siempre con el límite de bucle de D-08).
- El responsable de sincronizar el estado en `tasks.md`/`INDEX.md` es siempre el documentador (por orden); el orquestador nunca ejecuta en-flight a sí mismo en fases 2+.

## 4. Compuertas de fase

| Fase | Contenido | Compuerta |
|---|---|---|
| 00 | Arquitectura, elección de IaC, capas, env vars | `check.ps1` en verde; decisión de IaC registrada; estructura de carpetas y contrato de variables documentados; **aprobación del usuario** (condiciona todo lo demás) |
| 01 | Modelo de datos + 4 contratos de API | `check.ps1`; esquema estricto de `TicketsTable`, enum de estado, errores y códigos HTTP documentados; idempotencia del webhook decidida |
| 02 | Scaffold (ESM, lint, scripts, `.env.example`) | `npm run lint` + `npm test` + `check.ps1`; `npm run check` expone el gate documental |
| 03 | IaC: tabla, HTTP API, Lambdas, IAM, env | Compuertas 02 + validación de IaC **sin desplegar**; revisión IAM de menor privilegio; evidencia de alerta de facturación $0 (I2) |
| 04 | Ingesta `POST /webhook/telegram` | Compuertas base + tests: `2xx` garantizado en ignores, campos extraídos, ticket en `PENDING`, cero duplicados por `update_id` |
| 05 | Lectura `GET /api/tickets` + auth | Compuertas base + tests de orden desc, filtro `?status=` y `401`/`403` sin `x-api-key` válida |
| 06 | Mutación `PATCH /api/tickets/{id}` | Compuertas base + tests de enum (`400`), `404` si no existe, `updated_at` refrescado |
| 07 | Respuesta `POST /api/tickets/{id}/reply` | Compuertas base + tests con Telegram simulado: `RESOLVED` solo con OK real, estado intacto si Telegram falla |
| 08 | CI/CD + despliegue + `setWebhook` | Compuertas base + workflow válido en seco; **visto explícito del usuario** antes de cualquier comando que toque el mundo real; prueba E2E documentada |
| 09 | Hardening, coste y entrega | `README.md` con el `curl` exacto; informe final; revisión de cuotas y límites conocidos anotados |

## 5. Reglas de comunicación

- Si algo es ambiguo: decidir, documentar (spec + `DECISIONS.md`) y seguir. No cerrar con preguntas abiertas, salvo decisiones de producto/estilo que la constitución exige validar con el usuario y salvo acciones externas (I6).
- Si un criterio de la constitución se rompe para superar una limitación técnica: **parar y explicarlo antes**, no silenciar la anomalía. En especial I2 (coste) e I4 (secretos).
- Responder con el estado del repo actualizado (`INDEX.md`) cuando la conversación toque el trabajo.
- Los fallos de compuerta se reportan con la salida del comando, no resumidos.

## 6. Verificación mecánica

- `scripts/check.ps1`: valida constitución y `DECISIONS.md` presentes, cláusula de coste $0 e cláusula de seguridad presentes, spec de la fase en curso con criterios de aceptación y alcance, estado coherente en `INDEX.md` y **higiene de secretos** (ningún token/clave real en archivos del repo). Sin dependencias externas.
- Desde Fase 02 el proyecto integra el mismo script como `npm run check`, además de `lint`/`test`.
- Desde Fase 03 se añade `npm run validate:iac` (envuelve el validador estático elegido en Fase 00). **Nunca** invoca un despliegue.
