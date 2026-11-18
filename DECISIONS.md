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

## D-15 · 2026-11-18 · IaC elegida: AWS SAM (CloudFormation + transform `AWS::Serverless`)

- **Contexto:** T-01 de la Fase 00. Había que fijar la herramienta de IaC antes de escribir cualquier artefacto; tres candidatas (Serverless Framework v4, AWS SAM, CloudFormation nativo). El criterio vinculante es C5 de la spec: validar sin credenciales, sin Docker y sin crear recursos (I2/I6/I7).
- **Opciones:** (a) Serverless Framework v4; (b) AWS SAM CLI + `template.yaml`; (c) CloudFormation nativo sin transform.
- **Elección:** (b), visto del usuario el 2026-11-18 ("IaC está claro, vamos con SAM"). Compuerta: `sam build` + `cfn-lint` (offline, sin credenciales AWS, sin Docker para Node.js).
- **Motivo:** (1) la v4 del Serverless Framework exige autenticación en la CLI —breaking change declarado en su propia guía de upgrade, que afecta también a pipelines—, lo que mete una credencial de un tercero en la compuerta y en el CI; su `package` además pide credenciales AWS; (2) licencia mixta con componentes propietarios en el npm frente a Apache-2.0 de SAM; (3) v3, que era open source sin login, no recibe parches desde 2025, así que no es vía de escape; (4) SAM tiene mejor salud (1.172.1, nov-2026), HTTP API/`FunctionUrlConfig` first-class, `aws-actions/setup-sam` oficial, y su salida es CloudFormation legible para auditar menor privilegio (I4); (5) CloudFormation nativo queda descartado por coste humano: 4 endpoints + CORS + permisos Lambda son 15+ recursos y su alternativa "sin S3" (`Code.ZipFile`) genera un único `index.js` en CommonJS, incompatible con ESM.
- **Riesgo:** `sam validate` a secas y `aws cloudformation validate-template` requieren credenciales, por eso **no** son el gate (el gate es `sam build` + `cfn-lint`); el CLI SAM se instala en el runner con `aws-actions/setup-sam@v3` o se usa el preinstalado; `cfn-lint` y el transform evolucionan juntos → versiones fijadas en Fase 02 y revisadas en cada compuerta. SAM no es lock-in: el mismo archivo puede bajar a CFN puro.

## D-26 · 2026-11-18 · DynamoDB en capacidad PROVISIONED 25/25 (enmienda de I2) `supersedes` la cláusula "`PAY_PER_REQUEST` dentro de la cuota gratuita" de D-11/I2

- **Contexto:** el invariante "coste $0, nunca" de I2 se verificó contra el Free Tier vigente y resultó **incumplible en literalidad con `PAY_PER_REQUEST`**: la franquicia mensual de 25 RCU/25 WCU de DynamoDB es **del modo provisioned** ("It uses provisioned capacity and the DynamoDB Standard table class", aws.amazon.com/dynamodb/pricing) y on-demand cobra $0,125/M lecturas y $0,625/M escrituras sin franquicia de peticiones. El usuario decidió ir con la tabla provisionada y migrar a bajo demanda solo si escala rápido.
- **Opciones:** (a) mantener `PAY_PER_REQUEST` y aceptar ~$0,009–0,06/mes típicos (y crecientes con el tráfico); (b) `PROVISIONED` 25/25 con auto scaling OFF; (c) `PROVISIONED` 5/5 u otra capacidad menor.
- **Elección:** (b), con enmienda de I2 aprobada por el usuario el 2026-11-18. **Condiciones duras:** 1 sola tabla Standard, 1 sola región (us-east-1), sin GSI/LSI, sin Streams, sin PITR, sin backups on-demand, sin pre-warming y **auto scaling prohibido**. Techo si la franquicia no aplicase a esta cuenta: **$14,04–14,24/mes fijo** (25 × $0,00065 + 25 × $0,00013 por hora). (c) se descarta: con franquicia activa 5/5 cuesta lo mismo ($0) y sube el riesgo de throttling en el `Scan`.
- **Motivo:** con capacidad fija y auto scaling OFF, el exceso de carga se responde con `ThrottlingException`, **no con factura**: el riesgo pasa de económico a de disponibilidad, y el techo queda conocido de antemano. Margen sobre la carga estimada (items ~2 KB): 25 WCU ≈ 12,5 escrituras/s frente a ~0,002/s típicas; 25 RCU eventual ≈ 50 lecturas/s frente a ~0,7/s. Además el proyecto mantiene el **derecho de vía de escape**: pasar a `PAY_PER_REQUEST` ante escalado real, pero eso exige decisión nueva + OK explícito del usuario (I2/I6).
- **Riesgo:** (1) que la franquicia no esté activa en esta cuenta → $14,24/mes; se cierra en Fase 03 con captura en Billing → Free Tier o `ce GetFreeTierUsage` (read-only) como evidencia de la spec; (2) el `Scan` de `GET /api/tickets` consume ~256 RCU con 1.000 items de 2 KB y el filtro `?status=` no ahorra capacidad (se cobra lo evaluado, no lo devuelto) → el umbral de revisión de I5 se expresa en **items leídos (~1.000–2.000)** y la respuesta al cruzarlo es **migrar a `Query`**, nunca subir capacidad; (3) un GSI futuro come del mismo bote de 25/25 y rompería el invariante. Mecanizado: `scripts/check.ps1` rechaza una plantilla con `PAY_PER_REQUEST`, capacidad > 25, GSI/LSI, Streams, PITR o `AWS::ApplicationAutoScaling::*`.

## D-27 · 2026-11-18 · Frontend HTTP: Lambda Function URL con una app Express dentro (1 función, 1 URL)

- **Contexto:** decided por el usuario el 2026-11-18 ("El api he decidido que sea una Function URL con una API Express dentro"). Sustituye el API Gateway HTTP API del brief y reorganiza la estructura de capas propuesta en §5 de la spec de Fase 00.
- **Opciones:** (a) HTTP API v2 + 4 Lambdas (brief original); (b) Function URL con una sola Lambda y router interno; (c) Function URL + Express montado dentro de esa Lambda; (d) Lambda Web Functions (Express escuchando en un contenedor).
- **Elección:** (c). `src/lambda.js` exporta `serverlessExpress({ app })`; `src/app.js` construye la app con dependencias inyectadas; `src/routes/telegram.js` y `src/routes/tickets.js` montan los 4 endpoints del contrato; el adaptador fijado es **`@vendia/serverless-express` v5 pinned**. (d) queda **prohibido por I2** (tarifa $0,30/M con CPU activa y sin franquicia documentada) y (a)/(b) se descartan: (a) caduca la franquicia de peticiones a los 12 meses y (b) obligaría a parsear `rawPath` a mano.
- **Motivo:** la Function URL es la única entrada HTTP sin cargo por petición (*"you only pay for function invocations and compute time. There are no additional charges for the URL endpoint itself"*) → con D-26 el stack completo vuelve a **$0 típico**. Aporta además DX: `npm run dev` levanta la misma app Express en local sin adaptador ni Docker; los tests usan `supertest` contra la app real; el enrutado `{id}` lo hace Express (el evento v2.0 de Function URL trae `pathParameters: null`); un único rol IAM y un solo dominio/URL. Coste: 1 solo proceso → un error no capturado afecta a todas las rutas (mitigado por error handler + guard del webhook) y no se puede comprar provisioned concurrency porque es facturable (cold start objetivo < 800 ms con 256 MB, aceptable porque Telegram reintenta y no espera).
- **Riesgo:** (1) salud del adaptador: el repo cambió de ownership (Vendia → CodeGenieApp) y hay forks homónimos → versión fijada en Fase 02, y plan B documentado de adaptador propio (~80 líneas en `src/adapters/functionUrl.js`); **no usar `aws-serverless-express`** (archivada); (2) Function URL no está disponible en todas las regiones → verificar us-east-1 en Fase 03; (3) al borrar una URL con `AuthType: NONE` queda la resource-based policy asociada: hay que limpiarla a mano (nota operativa para Fase 08/09); (4) CORS **solo** en la config de la URL (I4): emitirlo también desde Express produce `Access-Control-Allow-Origin: *, *` y rompe el preflight; (5) desviación del brief (`PROMPT.md` pedía `src/handlers/` y HTTP API): queda anotada en la spec §10d/§11 y en la nota de vigencia del brief; (6) límite de 30 s de invocación HTTP y 6 MB de payload, sin impacto para mensajes de Telegram (≤ 4.096 caracteres). Mecanizado en `check.ps1`: >1 `AWS::Lambda::Url`/`FunctionUrlConfig`, >1 tabla, `AWS::ApiGatewayV2::*`, `MemorySize` > 256 o provisioned concurrency → FAIL.

## D-30 · 2026-11-18 · Gestor de paquetes: pnpm (npm y yarn prohibidos) — nueva cláusula I4b `supersedes` la preferencia de dependencias del brief (§2/§4/§5 de `PROMPT.md`)

- **Contexto:** el usuario rechaza npm por su historial de vulnerabilidades de cadena de suministro ("no quiero usar npm por la vulnerabilidad que tuvo, prefiero usar PNPM") y pide documentarlo. Los hechos verificados que sostienen la preocupación: flaw de validación del *trusted publishing* de npm con 1.500+ paquetes expuestos (parcheado el 2-oct-2026, con expiración de 48 h para configuraciones sin validar); `axios@1.14.1` y `axios@0.30.4` comprometidos el 31-mar-2026 (advisory CISA); npm 12.2.2 empaquetando `glob`/`minimatch` afectados por advisory de octubre de 2026. El brief, además, sugería `axios`/`node-fetch`/`uuid`.
- **Opciones:** (a) npm con lockfile + `npm audit`; (b) Yarn Berry; (c) **pnpm** con configuración endurecida; (d) vendorizar dependencias a mano (cero gestor).
- **Elección:** (c). pnpm con la versión fijada en `packageManager` de `package.json` (`pnpm@x.y.z`, exacta), instalación siempre con `pnpm install --frozen-lockfile`, y política en **`pnpm-workspace.yaml`** (no en `.npmrc`, donde solo quedan auth/registry/TLS): `ignoreScripts: true`, `strictDepBuilds: true`, `allowBuilds: []`, `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, `verifyStoreIntegrity: true`, `verifyDepsBeforeRun: true`, `enablePrePostScripts: false`. Prohibidos `package-lock.json`, `yarn.lock`, `npm`/`npx`/`yarn` en scripts, specs exóticas (`git:`/`github:`/`file:`/`tarball`/`link:`), `pnpmfile` y `patchedDependencies` sin decisión registrada. Se sustituye `axios`/`node-fetch` por `fetch` nativo y `uuid` por `crypto.randomUUID()`.
- **Motivo:** pnpm ≥ 10 **no ejecuta los lifecycle scripts de las dependencias por defecto** y exige aprobarlos nominalmente, que es exactamente el vector de los incidentes citados; la doc oficial de pnpm lo documenta como control de cadena de suministro junto a `minimumReleaseAge` y `trustPolicy`. Es MIT y no introduce coste (I2 intacto). La resolución estricta de `node_modules` reduce además las *phantom dependencies*. (a) es lo que se quiere evitar; (b) no aporta el bloqueo por defecto; (d) tiene un coste humano desproporcionado para un repo de este tamaño.
- **Riesgo:** (1) el `node_modules` por defecto de pnpm es una red de symlinks y **AWS Lambda no soporta symlinks en el ZIP** (la propia doc de pnpm lo llama la atención para serverless) → el artefacto debe construirse con árbol plano (`nodeLinker: hoisted` o `pnpm --filter . --prod deploy <dir>`), lo que a su vez choca con el instalador implícito de `sam build` → se resuelve en **D-31** y se valida en la spike de Fase 03; (2) `minimumReleaseAge: 1440` puede bloquear un fix de seguridad urgente → la excepción se documenta con OK del usuario (`minimumReleaseAgeExclude` por paquete, nunca global); (3) presión para rellenar `allowBuilds`: prohibido sin decisión + revisión del script; (4) la salud del adaptador Express queda abierta en D-28; (5) pnpm evoluciona rápido (series 11.28.x y 12.21.x conviven en 2026) → por eso la versión queda exacta en `packageManager` y la fija definitiva se revisa en Fase 02.

## D-31 · 2026-11-18 · Compuerta de IaC = `cfn-lint`; `sam build` sale de las compuertas `supersedes` la columna de compuerta de D-15

- **Contexto:** al documentar D-30 se verificó que la documentación oficial de SAM advierte: *"Don't run `sam build` on untrusted code. The command runs build tools and scripts that the project defines, such as Makefile targets, package manager scripts, and dependency…"*. Eso contradice I4b (cero scripts de dependencias) y el criterio C5 de la Fase 00 (validar sin credenciales y sin ejecutar código de terceros). Además D-15 se había escrito con "sam build + cfn-lint" como compuerta, y `sam validate` a secas y `aws cloudformation validate-template` exigen credenciales.
- **Opciones:** (a) gate = `sam build` + `cfn-lint` (como quedó en D-15); (b) gate = solo `cfn-lint` + asserts de `check.ps1`, con `sam build` relegado al paso de empaquetado/deploy bajo control; (c) gate = solo los asserts documentales de `check.ps1`.
- **Elección:** (b). `pnpm run validate:iac` = **`cfn-lint template.yaml`** (offline, sin credenciales AWS, sin ejecutar scripts del proyecto ni de dependencias) **más** los asserts de `check.ps1` sobre la plantilla (1 sola tabla `PROVISIONED` ≤ 25/25 sin GSI/Streams/PITR/AutoScaling, 1 sola Lambda con 1 sola Function URL, ausencia de `AWS::ApiGatewayV2::*` y de provisioned concurrency, `MemorySize` ≤ 256, sin `Resource: "*"`). `sam build` queda **denegado por permisos** al devops y al implementador; si el empaquetado lo necesitara, se sustituye por `CodeUri` apuntando al directorio que producimos con pnpm (árbol plano) o se ejecuta en el pipeline de despliegue con visto del usuario (I6).
- **Motivo:** mantiene C5 honesto y coherente con I4b: `cfn-lint` valida esquema, tipos y propiedades del transform SAM sin correr código; el resto de la garantía lo ponen los asserts mecánicos y la revisión del revisor.
- **Riesgo:** `cfn-lint` no detecta errores semánticos que solo aparecen al desplegar o invocar (límites reales de propiedades, permisos insuficientes en runtime). Se cubre con la **spike de Fase 03**: construir el artefacto sin desplegar, inspeccionar el ZIP (que no queden symlinks rotos) y `sam local invoke`/`pnpm run dev` + tests de contrato. Si la spike concluye que hace falta `sam build` sí o sí, se registra otra decisión con su control de scripts (por ejemplo `--use-container` con imagen fijada), no se improvisa en el pipeline.

## D-32 · 2026-11-18 · Documentación para humanos como obligación computable (nueva cláusula I8)

- **Contexto:** el usuario pide expresamente incluir la obligación de generar documentación para personas —funcional y técnica, contrato estilo Swagger o alternativa, `README.md` y diagramas de la API y del despliegue—, fijar dónde vive y dejar claro en el harness que se mantiene actualizada **tras cada tarea completa y validada**. Sin mecanismo, la documentación de un backend serverless muere en la Fase 02 y el panel frontend se integra por prueba y error.
- **Opciones:** (a) solo `README.md` + comentarios en el código; (b) documentar al final del proyecto (Fase 09); (c) **I8 con mapa fijo de destino + marcadores de frescura + contrato OpenAPI con test de deriva + asserts en `check.ps1`**; (d) documentación generada bajo petición, sin destino ni cadencia.
- **Elección:** (c). Mapa vinculante (I8a): `README.md` y `CHANGELOG.md` en la raíz; prosa en `docs/human/functional/**` (producto, API en lenguaje humano), `docs/human/technical/**` (arquitectura, modelo de datos, operaciones, resumen de decisiones), `docs/human/diagrams/*.mmd` (+ `.svg` exportado) y `docs/human/runbook.md`; **el contrato machine-readable en `docs/api/openapi.yaml`**, con `docs/api/api.html` opcional generado en local. Formato (I8d): **OpenAPI 3.1** antes que "Swagger" como marca (Swagger UI es solo un visor; el activo es el documento) y **Mermaid** en texto versionado, con el `.svg` commiteado para leer sin herramientas; prohibidos CDN y servicios hosted de documentación (coherente con I4 y con no sumar superficies). Cadencia (I8b): cada tarea `done` rellena su fila *Docs* (`docs/harness/tasks-format.md` regla 3) o declara `sin impacto`, el revisor lo valida, y cada fase cierra con la frescura comprobada; `docs/api/openapi.yaml` es propiedad del orquestador porque es contrato (AGENTS §3 regla 8). Mecanizado en `scripts/check.ps1`: 13 artefactos requeridos según la fase en curso, marcador `Actualizado: fase NN · AAAA-MM-DD` que debe ser ≥ la última fase **cerrada** de `INDEX.md`, comandos reales citados en `README.md` (pnpm), forma del documento OpenAPI y exigencia de `tests/contract/` desde Fase 02.
- **Motivo:** el panel frontend consume el contrato desde la Fase 01 y quien opera el bot necesita el `runbook.md` antes del primer despliegue (Fase 08); documentar por fase es más barato que reconstruir la explicación al final, y solo la frescura computable evita la erosión. La separación de roles ya existe en el harness: el implementador **no** escribe docs (denegado) sino que declara el impacto documental en su informe; el documentador redacta por orden.
- **Riesgo:** (1) coste de mantenimiento por tarea → mitigado porque la fila *Docs* admite `sin impacto` y el revisor lo confirma; (2) falsos fallos de frescura en fases que no tocan un artefacto → `check.ps1` compara contra la última fase **cerrada**, no contra la actual, y solo exige los artefactos cuya fase de origen ya pasó; (3) `@redocly/cli` y `@mermaid-js/mermaid-cli` pesan en la instalación → son devDependencies, sin coste de runtime ni de nube (I2 intacto) y se fijan con pnpm (I4b); (4) que el contrato se quede atrás si nadie corre `validate:api` → entra en la compuerta (I7) y el test de deriva código↔openapi falla la fase; (5) la versión/herramienta exacta del lint del OpenAPI se fija en Fase 02 (queda como detalle pendiente, no como hueco de regla).

**Nota de excepción de proceso (trazabilidad):** la migración de `docs/specs/00-arquitectura/tasks.md` al formato con columna *Docs*, la creación de `docs/human/README.md` y de `docs/human/technical/architecture.md`, y las ediciones de `constitution.md`, `AGENTS.md`, `PROMPT.md`, la spec de Fase 00 y `.opencode/agents/*.md` de esta ronda las ejecutó **el orquestador directamente** (cambio de harness + enmienda constitucional autorizada por el usuario en el mismo mensaje). El documentador mantiene el roles estándar: esta entrada y el bloque de retomada son suyas.

---

# Pendientes de decisión (se resuelven en su fase, con IDs siguientes)

| Próximo ID | Tema | Fase | Estado |
|---|---|---|---|
| D-15 | IaC: Serverless Framework v3/v4 vs AWS SAM | 00 | resuelta: **D-15 (AWS SAM)**, compuerta ajustada por D-31 |
| D-16 | Estructura de capas y puertos de salida (DynamoDB / Telegram) | 00 | pendiente de visto (spec §5, reescrita por D-27) |
| D-17 | Contrato de variables de entorno y configuración por stage | 00 | pendiente de visto (spec §6, siete variables con PORT solo local) |
| D-18 | Política de logs y trazabilidad (qué se loguea y qué no) | 00 | pendiente de visto (spec §7) |
| D-19 | Modelo de datos: tipos exactos, índices, idempotencia por `update_id` | 01 | pendiente (se documenta en `docs/human/technical/data-model.md`, I8) |
| D-20 | Contratos de API: errores, códigos HTTP, paginación y filtro | 01 | pendiente (salen a `docs/api/openapi.yaml` + `docs/human/functional/api.md`, I8) |
| D-21 | Seguridad: middleware en código vs authorizer Lambda; validación del secret token | 01 | parcialmente resuelta por D-27: Function URL no admite authorizer → middleware `apiKey` en código; falta el modo de validar `X-Telegram-Bot-Api-Secret-Token` |
| D-22 | Validación de entrada: guards manuales vs librería ligera | 01/02 | pendiente (cualquier librería pasa por I4b: mínima, sin scripts, decisión registrada) |
| D-23 | Estrategia y framework de tests (mock de DynamoDB y de Telegram) | 02 | pendiente |
| D-24 | IAM de menor privilegio y comando exacto de validación de IaC | 03 | parcialmente resuelta: gate = cfn-lint (D-31); falta el rol exacto |
| D-25 | Estrategia de CI/CD, secretos y momento del `setWebhook` | 08 | pendiente |
| D-28 | Adaptador Express↔Function URL definitivo (versión fijada o plan B propio) | 02 | pendiente |
| D-29 | Migración de la tabla a `PAY_PER_REQUEST` ante escalado real (activa la vía de escape de D-26) | futura | pendiente, exige OK explícito del usuario |
| D-30 | Gestor de paquetes y endurecimiento de cadena de suministro | 00 | **resuelta: pnpm** (queda fijar la versión exacta en Fase 02) |
| D-31 | Artefacto Lambda con pnpm (árbol plano, sin symlinks) sin sam build en compuertas | 03 | pendiente: spike de Fase 03 |
| D-33 | Herramienta y versión exacta del lint del OpenAPI y del export de diagramas | 02 | pendiente |
