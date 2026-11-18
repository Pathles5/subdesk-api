# DECISIONS — SubDesk API

Registro append-only. Una decisión desfasada no se edita ni se borra: la nueva añade `supersedes: D-xx`.
Formato: ID · fecha · contexto · opciones · elección · motivo · riesgo.

---

# Harness del proyecto · scaffolding (2026-11-18)

## D-01 · 2026-11-18 · Proceso SDD con fases de backend serverless

- **Contexto:** el brief pide estructura completa + código base de un backend AWS Serverless. Sin proceso, un repo así genera 20 archivos de golpe sin trazabilidad de por qué existe cada uno.
- **Opciones:** (a) entregar todo el código de una vez; (b) ciclo SDD con fases architecture → modelo/contrato → scaffold → IaC → endpoints → CI/CD → hardening.
- **Elección:** (b), diez fases (00–09) portadas del patrón de harness del proyecto hermano y adaptadas a backend: 00 arquitectura/IaC, 01 modelo + contratos, 02 scaffold, 03 IaC, 04 webhook, 05 GET, 06 PATCH, 07 reply, 08 CI/CD + despliegue, 09 hardening y entrega.
- **Motivo:** la elección de IaC (Fase 00) condiciona todos los artefactos siguientes; congelar el contrato antes de implementar los handlers evita improvisar el JSON que consume el panel.
- **Riesgo:** más fricción inicial que un "one-shot"; mitigado porque las specs de fase son cortas.

## D-02 · 2026-11-18 · AI Harness con swarm desde todas las fases

- **Contexto:** el usuario quiere harness explícito con orquestación de agentes + SDD, copiado de la estructura ya validada en `GestorFiichaDnD`.
- **Opciones:** (a) swarm solo desde la implementación; (b) swarm desde la Fase 00 (incluidas arquitectura e investigación de APIs).
- **Elección:** (b), roles orquestador / implementador / explorador / revisor / documentador / devops con escritura acotada según `AGENTS.md` §3.
- **Motivo:** la Fase 00–01 de este proyecto es investigación densa (Telegram Bot API, límites de HTTP API, cuotas de Free Tier) y beneficia al explorador igual que el código.
- **Riesgo:** en fases de decisión el subagente puede avanzar propuestas que el orquestador debe curtir; el control fino lo retiene el orquestador.

## D-03 · 2026-11-18 · Compuerta mecánica documental ejecutable desde el primer commit

- **Contexto:** en Fase 00 no existe `package.json` ni npm; el riesgo es que las compuertas fueran de papel.
- **Opciones:** (a) esperar a Fase 02 para tener gate; (b) `scripts/check.ps1` sin dependencias desde el scaffolding.
- **Elección:** (b). Valida presencia y forma de constitución (incluidas cláusula de coste $0 y cláusula de seguridad), `DECISIONS.md`, `INDEX.md`, spec de la fase en curso con criterios de aceptación y alcance, y **higiene de secretos** en los archivos del repo. Desde Fase 02 se expone también como `npm run check`.
- **Motivo:** convierte el harness en algo ejecutable y barato; añade una comprobación de tokens/clave AWS que en el brief es invariante, no preferencia.
- **Riesgo:** valida forma, no contenido; la calidad sigue en spec + revisor.

## D-04 · 2026-11-18 · Revisor fresh-eyes al cierre de cada fase

- **Contexto:** quién verifica que la entrega cumple los criterios de la spec.
- **Opciones:** (a) el propio orquestador; (b) subagente revisor en cada fase; (c) solo QA final.
- **Elección:** (b). El revisor recibe ruta de constitución + spec, sin saber quién escribió el código; solo lectura y compuertas concedidas explícitamente.
- **Motivo:** evita el sesgo de autocomplacencia, crítico en código generado en tandas grandes.
- **Riesgo:** coste de contexto por fase; aceptado.

## D-05 · 2026-11-18 · Jerarquía de verdad y change control

- **Contexto:** necesidad de un orden de mando estable entre brief, constitución, harness, specs y decisiones.
- **Elección:** `PROMPT.md` → `docs/specs/constitution.md` (gana a todo) → `AGENTS.md` → specs por fase; `DECISIONS.md` append-only con IDs; estado vivo solo en `INDEX.md`. Constitución solo modificable con OK explícito del usuario; specs congeladas en `implement` (enmiendas documentadas).
- **Motivo:** trazabilidad decisión → spec → código y prevención de erosión de inmutables (coste $0 y secretos) por fases posteriores.
- **Riesgo:** overhead de proceso; mitigado con documentos concisos.

## D-06 · 2026-11-18 · Subagentes como archivos OpenCode V2 con permisos mecánicos

- **Contexto:** port del patrón ya validado (D-06/D-10 del proyecto hermano) a este repo.
- **Opciones:** (a) roles descritos solo en `AGENTS.md` y lanzados como subagentes built-in; (b) agentes custom en `.opencode/agents/*.md` con frontmatter (`description`, `mode`, `permissions`) y system prompt en el cuerpo.
- **Elección:** (b). Seis definiciones: `orchestrator.md` (`mode: primary`), `implementer.md` (escritura acotada a `src/**`/`tests/**`, prohibido IaC/CI/docs/config de harness), `explorer.md` (solo lectura, sin shell), `reviewer.md` (solo lectura + compuertas), `documenter.md` (solo `docs/**`, `DECISIONS.md`, `README.md`), `devops.md` (escritura acotada a IaC y `.github/**`, shell solo inspección/validación).
- **Motivo:** los permisos declarativos eliminan el riesgo de que un subagente pise por error los archivos inmutables o dispare un despliegue.
- **Riesgo:** los permisos usan globs de ruta y de comando: una reorganización de carpetas o un cambio de CLI de IaC los desajusta; se revisan al abrir cada fase.

## D-07 · 2026-11-18 · Validación del usuario por tarea (user-first obligatorio)

- **Contexto:** el usuario exige validar el planteamiento de cada tarea antes de que se implemente.
- **Opciones:** (a) validación a nivel de fase/spec; (b) validación por tarea antes del implement.
- **Elección:** (b). Ciclo por tarea: propose·validate → implement (`AGENTS.md` §1.3). Las propuestas nacidas en subagentes también pasan por el usuario.
- **Motivo:** decisión explícita del usuario; cada implement pasa a ser la ejecución de una solución ya vista y avalada.
- **Riesgo:** más paradas por sesión; a cambio, cero retrabajo grande en código de infra.

## D-08 · 2026-11-18 · Límite de bucle entre subagentes: máximo 2 repeticiones

- **Contexto:** riesgo conocido del swarm: bucles implement ↔ revisor que queman contexto sin converger.
- **Opciones:** (a) sin límite; (b) máximo 2 repeticiones por tarea y luego escalado.
- **Elección:** (b). Primera entrega → revisión → corrección 1 → revisión → corrección 2. Si aún falla: la tarea vuelve al orquestador (la resuelve él o escala al usuario) y el bloqueo se anota en la spec (*Risks / deviations*).
- **Motivo:** garantiza terminación y evita tandas de revisión sin convergencia.
- **Riesgo:** una tarea difícil puede quedar engavetada prematuramente; el escape es el escalado explícito.

## D-09 · 2026-11-18 · Ciclo de vida y asignación de tareas por estado

- **Contexto:** hacía falta definir quién toca cada tarea según su estado antes de tener fases con piezas paralelas.
- **Opciones:** (a) casillas hecho/no-hecho y decidir caso a caso; (b) estados por tarea (`pendiente → propuesta → validada/en-flight → impl-done → revisada → done`, más `bloqueada`) con matriz de asignación y plantilla de `tasks.md`.
- **Elección:** (b). Rotación por cambio de estado, sin round-robin: propuesta = orquestador → usuario (D-07); ejecución = implementador (código) o devops (IaC/CI); integración y compuertas = orquestador; revisión = revisor; sincronización documental = documentador. Plantilla en `docs/harness/tasks-format.md`; matriz en `AGENTS.md` §3a.
- **Motivo:** hace auditable quién hizo qué y con qué visto, y habilita paralelismo seguro entre endpoints (04–07) sin solaparse en archivos.
- **Riesgo:** overhead de registro por tarea; mitigado porque lo lleva el documentador.

## D-10 · 2026-11-18 · El orquestador es un agente declarativo y default del repo

- **Contexto:** en el patrón original el orquestador era "la sesión principal" con instrucciones, sin definición declarativa.
- **Opciones:** (a) dejarlo implícito sobre el agente built-in; (b) definirlo como agente primario con `permissions` y marcarlo `default_agent`.
- **Elección:** (b). `.opencode/agents/orchestrator.md` (`mode: primary`) con `ask` para editar constitución, `AGENTS.md`, `PROMPT.md` y `.opencode/agents/**`, y subagentes restringidos a los 5 del harness; `opencode.jsonc` con `default_agent: "orchestrator"`.
- **Motivo:** paridad con los demás roles, enforcement mecánico del change control y comportamiento estable entre sesiones sin depender de la memoria del modelo.
- **Riesgo:** un system prompt propio sustituye el prompt base del agente primario; el cuerpo remite a `AGENTS.md` como fuente de reglas para no perder instrucciones genéricas.

## D-11 · 2026-11-18 · Invariante de coste $0 (constitución I2) verificado mecánicamente

- **Contexto:** el brief fija "Coste 0 / Free Tier" como restricción, no como preferencia.
- **Opciones:** (a) dejarlo como nota del brief; (b) elevarlo a invariante de constitución con verificación en el gate documental.
- **Elección:** (b). Lambda 128–256 MB, HTTP API (nunca REST API), DynamoDB `PAY_PER_REQUEST`, CloudFormation/IaC sin factura por plantillas, GitHub Actions en plan gratuito, retención de logs ≤ 30 días, **alerta de facturación en $0 antes del primer despliegue**. Prohibido: NAT, CloudFront, WAF, capacity reservations, GSI/LSI provisionados, dominios gestionados por la infra. Excepción = OK explícito del usuario + decisión registrada. `check.ps1` falla si la cláusula desaparece de la constitución.
- **Motivo:** el coste es un invariante financiero: pertenece a la capa que gana sobre todas las specs.
- **Riesgo:** las cuotas de Free Tier son condicionales (12 meses en algunas métricas de DynamoDB/CloudWatch) y el webhook de Telegram es tráfico entrante que consume peticiones de API Gateway; hay que revisar la cuenta y el uso en cada compuerta de fase de infra/CI.

## D-12 · 2026-11-18 · Subagente DevOps definido por adelantado (activación en Fase 03)

- **Contexto:** este proyecto es infra desde el minuto uno; aplazar el rol a una fase tardía no tenía sentido, pero tampoco dejarlo sin reglas.
- **Opciones:** (a) definirlo al abrir la Fase 03; (b) definirlo ya con permisos cerrados y activación declarada en Fase 03.
- **Elección:** (b). `.opencode/agents/devops.md`: escritura acotada a IaC (`serverless.yml` / `template.yaml` / `infra/**`) y `.github/**`; shell solo de inspección/validación sin efectos (`git status/log/diff`, `gh run/workflow/pr view`, `serverless print|info`, `validate-template`, `describe-*`); denegación mecánica de `deploy`, `remove`, `delete-stack`, `delete-table`, `delete-function`, push forzado/borrado de ramas y credenciales/export de secrets. Cualquier acción que cree o cambie recursos reales la ejecuta el orquestador con visto del usuario.
- **Motivo:** cerrar el swarm con reglas de coste y de no-destrucción escritas antes de tocar infra.
- **Riesgo:** los patrones de comando son best-effort (un wrapper con alias podría esquivarlos); la garantía real es la compuerta `validate:iac` sin credenciales + la política de "nada externo sin visto".

## D-13 · 2026-11-18 · Higiene de secretos como compuerta, no como costumbre

- **Contexto:** el brief exige usar `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY` y secretos de GitHub; el fallo típico es commitarlos o loguearlos.
- **Opciones:** (a) confianza en `.gitignore`; (b) `.gitignore` + escaneo de patrones de token/clave en los archivos de texto del repo dentro de `check.ps1` + cláusula de "ningún secreto en logs" en la constitución.
- **Elección:** (b). `.gitignore` creado en el scaffolding (`node_modules/`, `dist/`, `.serverless/`, `.aws-sam/`, `.env*` salvo `.env.example`); `check.ps1` falla si aparece un patrón de token de bot (`NNNNNNNNN:AA…`), una access key `AKIA…` o una secret key asignada en texto versionable; los docs usan placeholders `<TELEGRAM_BOT_TOKEN>`.
- **Motivo:** convierte I4 en verificable y barato, sin dependencias externas.
- **Riesgo:** falsos positivos si un fixture de test usa un valor con forma real; la convención es usar tokens sintéticos imposibles (`TESTTOKEN…`).

## D-14 · 2026-11-18 · Idioma: docs en español, código e identificadores en inglés

- **Contexto:** herencia del patrón del proyecto hermano y del brief del usuario.
- **Elección:** documentación del harness y specs en español; código, JSON de contrato, identificadores, nombres de recursos AWS y comentarios en inglés. Los campos del contrato quedan en `snake_case` porque el brief los fijó así.
- **Motivo:** coherencia con lo que ya funciona y respeto explícito del contrato pedido.
- **Riesgo:** mezcla de idiomas en un mismo repo; se aclara en `AGENTS.md` §0 y en las plantillas de prompt.

---

# Pendientes de decisión (se resuelven en su fase, con IDs siguientes)

| Próximo ID | Tema | Fase | Estado |
|---|---|---|---|
| D-15 | IaC: Serverless Framework v3/v4 vs AWS SAM | 00 | pendiente (propuesta en `docs/specs/00-arquitectura/spec.md`) |
| D-16 | Estructura de capas y puertos de salida (DynamoDB / Telegram) | 00 | pendiente |
| D-17 | Contrato de variables de entorno y configuración por stage | 00 | pendiente |
| D-18 | Política de logs y trazabilidad (qué se loguea y qué no) | 00 | pendiente |
| D-19 | Modelo de datos: tipos exactos, índices, idempotencia por `update_id` | 01 | pendiente |
| D-20 | Contratos de API: errores, códigos HTTP, paginación y filtro | 01 | pendiente |
| D-21 | Seguridad: middleware en código vs authorizer Lambda; validación del secret token | 01 | pendiente |
| D-22 | Validación de entrada: guards manuales vs librería ligera | 01/02 | pendiente |
| D-23 | Estrategia y framework de tests (mock de DynamoDB y de Telegram) | 02 | pendiente |
| D-24 | IAM de menor privilegio y comando exacto de validación de IaC | 03 | pendiente |
| D-25 | Estrategia de CI/CD, secretos y momento del `setWebhook` | 08 | pendiente |
