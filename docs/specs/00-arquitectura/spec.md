# Spec — Fase 00 · Arquitectura, IaC y estructura de capas

Estado de fase: **spec** (ver `docs/specs/INDEX.md`; el estado no vive aquí)
Dependencias: ninguna (primera fase)
Compuerta: `powershell -File scripts/check.ps1` + **aprobación explícita del usuario** (D-07; esta fase condiciona todo lo posterior)

## 1. Objetivo

Fijar las cuatro decisiones que determinan todos los artefactos siguientes y dejarlas escritas:

1. Herramienta de IaC (D-15).
2. Estructura de capas y límites entre handler / service / utils / domain (D-16).
3. Contrato de variables de entorno y configuración por stage (D-17).
4. Política de logs y trazabilidad (D-18).

## 2. Alcance

- Documento de arquitectura en esta spec (secciones 4–7) + decisiones registradas en `DECISIONS.md`.
- Definición del árbol de carpetas objetivo (sin crear el código de producto).
- Definición del conjunto de scripts npm que exigirá la Fase 02 (`lint`, `test`, `check`, `validate:iac`).
- Definición del comando/criterio de "validación de IaC sin desplegar" que usará la Fase 03.

## 3. Fuera de alcance

- Escribir `package.json`, handlers, servicios o el archivo de IaC (Fases 02 y 03).
- El modelo de datos y los contratos de endpoint (Fase 01).
- Cualquier despliegue o creación de recursos (prohibido por I6 hasta el visto del usuario).

## 4. Decisión prevista: IaC (D-15) — tres opciones

| Criterio | **A: Serverless Framework v4** | **B: AWS SAM (recomendada)** | **C: CloudFormation nativo** |
|---|---|---|---|
| Licencia / coste del software | npm con componentes **propietarios** (On-Premise SW License); gratis solo si facturación < 2 M$ (honor system) | **Apache-2.0** (CLI y spec), $0 | Sin software: el servicio no factura plantillas `AWS::` |
| Autenticación para usar el CLI | **Obligatoria**: login/Access Key/License Key de Serverless Inc. en *toda* la CLI, incluida CI/CD (breaking change declarado en su doc de v4) | No (solo credenciales AWS al desplegar) | No |
| Validación estática **sin credenciales** (C5) | `serverless print` resuelve esquema pero exige login + red al vendor; `serverless package` **necesita credenciales AWS**; no existe `--no-deploy` en v4 | **`sam build` + `cfn-lint`: offline, sin credenciales, sin Docker** (Node.js) | `cfn-lint` offline impecable; `aws cloudformation validate-template` requiere credenciales y solo mira sintaxis |
| HTTP API v2 | First-class (`provider.httpApi`, payload 2.0, CORS, authorizers) | First-class (`AWS::Serverless::HttpApi`, `StageName: $default` → URL sin sufijo de stage) | `AWS::ApiGatewayV2::*` a mano (Api/Route/Integration/Deployment/Stage/Perms) |
| IAM de menor privilegio | `iam.role.statements`, pero la plantilla final es generada/opaca | `Policies` + `!GetAtt` explícitos por función | Máximo control y auditoría |
| Salud / mantenimiento | 4.46.0 (oct-2026) y ritmo semanal, pero giro a SaaS; **v3 sin mantenimiento desde principios de 2025**; action oficial `serverless/github-action` busca mantenedores | 1.172.1 (nov-2026), spec `AWS::Serverless-2016-10-31` estable desde 2016, `aws-actions/setup-sam@v3` oficial, preinstalado en runners ubuntu | Servicio AWS: siempre al día |
| Legibilidad para 4 endpoints | La menor cantidad de YAML | Moderada (YAML CFN + macro) | Alta: 3–4× líneas y trampas de `Deployment`/`Stage` |
| Artefactos | Bucket S3 del framework (<$0.01/mes) | Bucket gestionado `aws-sam-cli-managed-default` (<$0.01/mes) | También bucket S3: el `Code.ZipFile` inline obliga a **un único archivo `index.js` en CommonJS** → choca con ESM multicharchivo |
| Fuga / lock-in | DSL del vendor + credencial de tercero en la pipeline | Es CloudFormation: salida directa al mismo archivo | Cero |

**Elección registrada (visto del usuario, 2026-11-18 → D-15): Opción B — AWS SAM** (`template.yaml` con `Transform: AWS::Serverless-2016-10-31`, un solo stage implícito, artefactos en el bucket gestionado por SAM). El comando de compuerta es `sam build` + `cfn-lint`: offline, sin credenciales AWS, sin Docker para Node.js. Serverless Framework v4 queda descartada por la credencial de tercero obligatoria en CLI/CI; CloudFormation nativo queda como vía de escape abierta (el mismo archivo es CFN) y no como punto de partida.

Motivo, en orden de peso:
1. **C5 es vinculante y A no lo cumple honestamente**: el propio documento de upgrade a v4 declara la autenticación como *breaking change* que afecta a máquina local **y a pipelines**. Nuestra compuerta exige validar sin credenciales y sin tocar el mundo real; con A hay que meter una credencial de un tercero (`SERVERLESS_ACCESS_KEY`) y depender de la red de Serverless Inc. Con B, `sam build` + `cfn-lint` corren 100 % offline y sin credenciales AWS.
2. **Licencia**: B es Apache-2.0; A empaqueta código propietario en el módulo npm y condiciona su gratuidad a un umbral de facturación por honor system.
3. **Sin puerta falsa a v3**: v3 sigue open source pero **sin parches de seguridad desde 2025**; no es una vía de escape.
4. **El brief y la constitución salen mejor servidos**: B genera exactamente los recursos del §5 de `PROMPT.md` (HTTP API v2, Lambdas, IAM) y deja la plantilla legible para auditar menor privilegio (I4), con `StageName: $default` para una URL limpia que Telegram acepte, y secretos como `Parameters` con `NoEcho` inyectados por `--parameter-overrides` desde secretos de GitHub (I4, sin valor literal en la plantilla).
5. **Coste**: ninguna opción es $0 en su propio software, y las tres acaban usando un bucket S3 de artefactos (<1 céntimo/mes). En coste residual, B ≈ A ≈ C.

Riesgos aceptados de B: (i) el CLI SAM se instala en Python/Docker-imagen propia → en GitHub Actions se usa `aws-actions/setup-sam@v3` o el preinstalado del runner; (ii) `sam validate` **a secas** sí pide credenciales AWS: el gate se define con `sam build` + `cfn-lint`, no con `validate`; (iii) más líneas de YAML que A (mitigado por `Fn::ForEach` y por ser CFN legible).

Condiciones bajo las que cambiaría de opinión: (1) si aceptas explícitamente cuenta/Access Key de Serverless Inc. en los secretos del repo para ganar las menos líneas posibles → A; (2) si quieres cero herramientas adicionales en local y aceptas la verbosidad → C, con `cfn-lint` como único validador.


## 5. Estructura de capas (D-16) — reescrita por D-27

Con **1 sola Lambda + Express dentro** ya no existen "1 handler por endpoint": existe 1 entrada Lambda y el enrutado vive en la app. Topología objetivo:

```
src/
  lambda.js         # UNICO handler: serverlessExpress({ app }) — nada de lógica aquí
  local.js          # app.listen(PORT) para `npm run dev`: mismo arbol, sin adaptador
  app.js            # createApp(deps): middlewares globales + montado de routers + error handler
  routes/
    telegram.js     # POST /webhook/telegram   (publico, ack 2xx garantizada)
    tickets.js      # GET /api/tickets · PATCH /api/tickets/:id · POST /api/tickets/:id/reply
  middleware/
    apiKey.js       # x-api-key vs ADMIN_API_KEY -> 401/403 antes de tocar la tabla (I4)
    webhookGuard.js # error handler propio: cualquier excepcion -> 200 { ignored: ... } (I5)
  services/         # logica de negocio, inyectable y testeable sin AWS ni HTTP
    ticketService.js
    telegramService.js
  repositories/     # UNICO sitio que conoce DynamoDB y la tabla
    ticketRepository.js
  utils/            # helpers puros
    http.js  validation.js  ids.js  time.js  logger.js
  config.js         # unica lectura de process.env
tests/              # espejo de src/: unitarios de services + supertest sobre createApp()
template.yaml       # SAM: 1 tabla PROVISIONED + 1 Function + 1 FunctionUrlConfig + 1 rol
```

Reglas de dependencia (una dirección): `lambda|local → app → routes → middleware|services → repositories|utils → config`.

- **Nada importa AWS SDK fuera de `repositories/` y `services/telegramService.js`.** `src/lambda.js` es el único punto que conoce el adaptador Express↔Lambda.
- El `app` se construye con dependencias inyectadas (`createApp({ ticketService, telegramService, config })`) → los tests usan `supertest` contra la app real sin Lambda, sin DynamoDB y sin Telegram.
- **CORS: cero código.** Se declara solo en `FunctionUrlConfig.Cors` del IaC (I4); un `cors()` en Express duplicaría cabeceras y rompería el preflight.
- Payload: la Function URL entrega **SIEMPRE HTTP payload format v2.0** (`rawPath`, `requestContext.http.*`, `pathParameters: null`); el adaptador se encarga de la traducción y Express hace de `:id` — por eso el enrutado interno es legítimo y no hay que parsear `rawPath` a mano.
- Límite funcional heredado de Function URL: 30 s de timeout por invocación HTTP y 6 MB de payload; ninguno afecta a mensajes de Telegram (≤ 4.096 caracteres).


## 6. Contrato de configuración (D-17)

| Variable | Dónde | Descripción |
|---|---|---|
| `TABLE_NAME` | Lambda env | Nombre de la tabla DynamoDB (sale del stack, nunca hardcode) |
| `TELEGRAM_BOT_TOKEN` | Lambda env (secreto de GH para el deploy) | Token del bot; **solo** se usa en runtime, jamás se loguea (I4) |
| `ADMIN_API_KEY` | Lambda env | Comparación con cabecera `x-api-key` en `/api/*` |
| `TELEGRAM_WEBHOOK_SECRET` | Lambda env + `setWebhook` | Valor de `X-Telegram-Bot-Api-Secret-Token` (I4) |
| `LOG_LEVEL` | Lambda env | `info` por defecto; `debug` solo en dev |
| `STAGE` | Serverless/SAM variables | `dev` en la v1 |
| `PORT` | **solo local** (`npm run dev`) | Puerto de `src/local.js`; no existe en Lambda (Function URL) |

`.env.example` (Fase 02) lista exactamente estas siete, con placeholders y sin valores reales. En IaC, `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY` y `TELEGRAM_WEBHOOK_SECRET` entran como `Parameters` con `NoEcho: true` y se inyectan en CI con `--parameter-overrides` desde secretos de GitHub: la plantilla nunca contiene el valor.

## 7. Política de logs propuesta (D-18)

- Un evento JSON por invocation: `level`, `msg`, `ticketId`, `updateId`, `statusCode`, `durationMs`. Sin `message_content` completo (solo su longitud).
- Prohibido loguear: `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, la cabecera `x-api-key` y el `text` íntegro del usuario (I4/I5).
- Retención CloudWatch ≤ 30 días declarada en IaC (I2).

## 8. Scripts y compuertas que esta fase compromete

| Script | Qué hace | Nace en |
|---|---|---|
| `npm run lint` | ESLint flat config, `src/` + `tests/` | 02 |
| `npm test` | Runner de tests (elegido en D-23) | 02 |
| `npm run check` | `powershell -File scripts/check.ps1` | 02 |
| `npm run validate:iac` | `sam build` + `cfn-lint template.yaml`: offline, **sin credenciales AWS, sin Docker para Node.js y sin desplegar**. Quedan descartados como gate `sam validate` a secas y `aws cloudformation validate-template` (piden credenciales) | 03 |
| `npm run dev` | `node src/local.js`: levanta la **misma app Express** en `PORT` sin adaptador Lambda (I7) | 02 |
| `npm run deploy` | **No existe.** El despliegue no es un script de proyecto: lo propone el orquestador y lo ejecuta con visto del usuario (I6) | — |

## 8b. Evidencia consultada (Fase 00, 2026-11-18)

- Serverless Framework, *Upgrading to v4* (doc oficial, leída íntegra): "Version 4 of the Serverless Framework CLI now requires authentication. This is a breaking change as the authentication prompt in the CLI will disrupt usage of CLI commands on local machines **and in CI/CD pipelines**." Sección *License Changes*: licencia "On-Premise Software License", umbral 2 M$/año; v3 "no longer maintained" desde principios de 2025.
- Serverless Framework, *Deploying / commands*: `serverless package` y `deploy` requieren credenciales AWS válidas; `--no-deploy` de v3 no existe en v4.
- AWS SAM CLI releases (nov-2026: v1.172.1) y `aws-actions/setup-sam`; doc de SAM: `sam build` para Node.js no requiere Docker (salvo `--use-container`); nota de `sam validate`: "requires AWS credentials to be configured".
- `cfn-lint` (nov-2026: v1.60.1): validación offline contra esquema de recursos, con soporte del transform `AWS::Serverless-*`.
- CloudFormation: plantillas `AWS::` sin cargo; `TemplateBody` ≤ 51.200 bytes; `Code.ZipFile` genera `index.js` único en CommonJS → incompatible con ESM multicharchivo sin flag experimental.
- API Gateway HTTP API: no tiene authorizer de *API key* (solo IAM, Lambda, JWT) → la decisión D-21 de Fase 01 debe elegir entre authorizer Lambda (`IdentitySource: $request.header.x-api-key`, 401 antes del handler) o middleware en código.
- **Lambda Function URL** (`docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html`): *"The request and response event formats follow the same schema as the **Amazon API Gateway payload format version 2.0**"* → el evento es siempre v2.0, con `routeKey: "$default"`, **`pathParameters: null`** y `stageVariables: null`; el path útil llega en `rawPath` / `requestContext.http.path`. Consecuencia para D-27: **Express no puede recibir ese evento tal cual, necesita un adaptador** (handler = `serverlessExpress({ app })`), y a cambio el enrutado `{id}` lo hace Express en código. Otros hechos citados: `AuthType: AWS_IAM | NONE` (sin authorizer), CORS configurable en la propia URL, *"Function URLs are not supported in all AWS regions"*, límite de invocación HTTP 30 s, URL inmutable tras crearla, y `429` por exceso de concurrencia si se declara `reservedConcurrency` (que además sirve de *kill switch* poniéndolo a 0).
- Adaptadores Express↔Lambda candidatos (nov-2026): **`@vendia/serverless-express`** — vivo, *"v5.0.0 Released! Includes Node.js 24 support and removal of deprecated APIs"*, sucesor mantenido de `aws-serverless-express` (archivada, no usar). Nota de salud: el repo ha cambiado de ownership (Vendia → CodeGenieApp/CodeGenieApp/serverless-express), con forks paralelos (`tesseractcollective/serverless-express`) → se fija versión exacta en Fase 02 y se revisa en cada compuerta. Alternativa mínima sin dependencia propia: `serverless-http`. **Descartado**: `aws-serverless-express` (archivada).
- **Lambda Web Functions** (oct-2026) quedan **prohibidas por I2**: tarifa $0,30/M de peticiones con CPU activa y entorno con memoria propia, **sin franquicia documentada** → romperían el invariante de coste aunque evitaran el adaptador.
- **AWS Free Tier (modelo vigente desde 2025)**: cuenta nueva = hasta $200 en créditos ($100 + hasta $100 por actividad), **plan gratuito de 6 meses** (la cuenta se cierra sola al acabar o agotarse los créditos) y 30+ servicios *always free*. Lambda: 1 M peticiones + 400.000 GB-s/mes (always free). **DynamoDB: 25 GB always free, pero la franquicia de 25 RCU/25 WCU aplica al modo provisioned; `PAY_PER_REQUEST` no tiene franquicia permanente.** **HTTP API: 1 M peticiones/mes gratis solo durante 12 meses**, luego $1/M. Implicación directa en I2 → ver §10.


## 9. Criterios de aceptación

- **C1** — `DECISIONS.md` contiene D-15 (IaC), D-16 (capas), D-17 (env), D-18 (logs), **D-26 (capacidad DynamoDB)** y **D-27 (Function URL + Express)** con opciones, elección, motivo y riesgo.
- **C2** — El árbol de carpetas y las reglas de dependencia a una dirección quedan escritos en esta spec (§5) y cubren los **4 endpoints del brief** (aunque ahora vivan como rutas Express y no como 4 handlers Lambda: desviación documentada en §11 / D-27).
- **C3** — La tabla de variables de entorno es cerrada: **siete nombres** (seis de runtime + `PORT` local), ninguno con valor real.
- **C4** — La política de logs declara explícitamente qué campos están prohibidos en log (I4).
- **C5** — El comando de validación de IaC queda fijado (`sam build` + `cfn-lint`) y es verificable **sin credenciales**, sin Docker y sin crear recursos (I2/I6/I7).
- **C6** — El usuario ha dado el visto a la elección de IaC, a la capacidad de DynamoDB y al frontend (compuerta de aprobación de la fase).
- **C7** — `scripts/check.ps1` en verde con esta spec como fase en curso.
- **C8** — La constitución (I2/I4/I5/I7/I1) está actualizada con las reglas de Function URL + provisioned 25/25 y los `asserts` de IaC que las hacen cumplir, y `check.ps1` **rechaza una plantilla que incumpla I2** (verificado: PAY_PER_REQUEST, >25 unidades, GSI, auto scaling, PITR, HTTP API, MemorySize 512, provisioned concurrency, >1 URL o >1 tabla → FAIL; plantilla conforme → PASS).
- **C9** — Queda fijado el mecanismo de ack 2xx del webhook dentro de Express (middleware de guard dedicated, §5/I5), y la regla "CORS solo en IaC" está escrita (I4).

## 10. Riesgos / desviaciones

### 10a. Tensión detectada en I2 (coste $0 "nunca") — resuelta con números, escalate para enmienda

Investigación del explorador + verificación directa del orquestador (18-nov-2026, fuentes literales):

**DynamoDB — la franquicia es del modo PROVISIONED, no del on-demand.** Cita literal de `aws.amazon.com/dynamodb/pricing/`: *"The DynamoDB free tier … **It uses provisioned capacity** and the DynamoDB Standard table class. The DynamoDB free tier offers the following benefits **each month** on a per Region, per-payer account basis: **25 WCUs, 25 RCUs**, 25 GB of data storage…"*, y en los ejemplos de precios: *"The AWS Free Tier includes 25 WCUs and 25 RCUs … **reducing your monthly bill by $14.04**"* (25 WCU × $0,00065/h + 25 RCU × $0,00013/h). La página separa esa franquicia mensual de los créditos ($200 / 6 meses). Conclusión: con **1 tabla Standard, 1 región, provisioned 25/25, sin GSI/LSI, sin Streams, sin PITR, auto scaling OFF**, DynamoDB vuelve a **$0 real y permanente**; el mismo texto sin franquicia costaría $14,04–14,24/mes, cifra **fija y conocida**, no dependiente del tráfico.

**Techo duro de coste**: si no declaras auto scaling, el exceso de capacidad no se factura, se rechaza — *"ReadCapacityUnits — The maximum number of strongly consistent reads consumed per second **before DynamoDB returns a `ThrottlingException`**"*. Amortiguadores gratuitos: burst capacity de 300 s y adaptive capacity (*"enabled automatically for every DynamoDB table, at no additional cost"*). Es la propiedad que convierte "coste 0, nunca" en algo verificable: el riesgo pasa de *factura* a *disponibilidad*.

**Capacidad frente a nuestra carga real** (items ~2 KB): 25 WCU ≈ 12,5 escrituras/s sostenidas (nuestro típico: 5.000 escrituras/mes ≈ 0,002/s). 25 RCU en lectura eventual ≈ 50 lecturas/s (típico: 50.000/mes ≈ 0,7/s). Un `Scan` completo de 1.000 items de 2 KB = 2 MB ≈ **256 RCU** (≈10 s de capacidad, 2 páginas de 1 MB). El filtro `?status=` **no** ahorra capacidad: *"DynamoDB considers the size of the items that are evaluated, not the size of the items returned"*. Umbral de revisión de I5 reexpresado en **items leídos (~1.000–2.000)**, no en peticiones: por encima, migrar de `Scan` a `Query` en lugar de subir capacidad (subirla rompería el $0).

**Lo que provisioned NO arregla**: la franquicia de **API Gateway HTTP API** es *"one million API calls received for HTTP APIs … **per month for up to 12 months**"* y *"only available to new AWS customers"* → tras ella, $1/M llamadas ≈ **$0,055/mes** a nuestro volumen. No es always free en ningún escenario.

**La vía para $0 estricto en el frontend es Lambda Function URL**, según la doc de decisión de AWS: *"Function URLs follow the standard Lambda pricing model – **you only pay for function invocations and compute time. There are no additional charges for the URL endpoint itself**"*. Es una prestación de la **Event Function** (tarifa 1 M peticiones + 400.000 GB-s/mes siempre gratis), con recurso propio en IaC (`AWS::Lambda::Url`, `FunctionUrlConfig` en SAM). Contrapartidas que hay que aceptar conscientemente: **no hay plantillas de ruta** (`pathParameters` llega `null`; el `{id}` se extrae de `rawPath` en código), autenticación solo `AWS_IAM | NONE` → el `x-api-key` pasa a middleware en código (opción ya barajada en D-21), CORS declarado **solo** en la config de la URL (hacerlo también en código produce cabeceras duplicadas `*, *`), **no disponible en todas las regiones** (verificar us-east-1 en Fase 03), sin stages/dominio propio/usage plans, y al borrar una URL con `AuthType: NONE` queda la resource policy (hay que limpiarla a mano).

**Riesgo de continuidad que pesa más que cualquier céntimo**: en el modelo actual, el *Free plan* cierra la cuenta sola a los 6 meses y después borra los recursos. El backend necesita **Paid plan**, donde los límites *always free* siguen aplicando pero los excesos se facturan; y el control de gasto de AWS **no permite un tope por debajo de $20/mes** (*"you can set a monthly spend limit for your project starting at $20"*). Por eso la **alerta de facturación en $0** de I2 no es decorativa: es el único freno real.

### 10b. Configuraciones candidatas y elección

| | **(i) $0 estricto — ELEGIDA (D-26+D-27)** | **(ii) Híbrida** | **(iii) Brief tal cual** |
|---|---|---|---|
| DynamoDB | provisioned 25/25, auto scaling OFF | provisioned 25/25, auto scaling OFF | `PAY_PER_REQUEST` |
| HTTP frontend | **Function URL + Express dentro** (1 función, 1 URL) | Function URL o HTTP API v2 | HTTP API v2 |
| Coste típico/mes | **$0,00** | **$0,00** / ~$0,055 | ~$0,06 |
| Peor caso/mes (nuestro volumen) | **$14,24 fijo** (si la franquicia no aplicase a esta cuenta) | $14,24 / ~$1,35 | ~$1,83 |
| Comportamiento ante pico | `ThrottlingException` (429), no factura | ídem / se factura | se factura |
| Coste humano | + adaptador Express y 1 solo proceso | medio | el previsto en el brief |

Comparten: 1 tabla, 1 región (us-east-1), CloudWatch ≤ 30 días, bucket S3 de artefactos (~$0,0002), IAM de menor privilegio y alerta de facturación en $0.

**Enmienda de I2 aplicada con el visto del usuario de este mensaje (18-nov-2026, texto ya vigente en `constitution.md`):** la franquicia de peticiones de DynamoDB es **del modo provisioned**, así que I2 pasa a exigir **`PROVISIONED` ≤ 25/25, 1 tabla, 1 región, sin GSI/LSI, sin Streams, sin PITR y con auto scaling prohibido**; se prohíbe expresamente migrar a `PAY_PER_REQUEST` sin decisión nueva + OK del usuario; se prohíben **provisioned concurrency** y **Lambda Web Functions** (ambos facturables); y se redefine el invariante como *"$0 dentro de franquicias always-free, con techo de gasto conocido de antemano; el exceso se resuelve con throttling o parada + reporte, nunca con facturas silenciosas"*. El borrador de la cláusula sigue siendo válido: la cuenta debe estar en **Paid plan** (el Free plan se cierra solo a los 6 meses) y la **alerta de facturación en $0** es evidencia obligatoria de la Fase 03.

### 10c. Otros riesgos de la fase

- La elección A (Serverless Framework) se descarta no por coste sino porque su autenticación obligatoria rompe el criterio C5 y mete una credencial de tercero en la pipeline (I4/I6). Queda registrada como opción descartada, no prohibida: reversible con decisión nueva (`supersedes: D-15`).
- El CLI SAM se mantiene con releases casi semanales; riesgo bajo. `cfn-lint` y el transform SAM evolucionan juntos: fijar versiones en la Fase 02 y revisar en cada compuerta.
- Si al validar C5 hicieran falta credenciales reales, eso es una anomalía de I6: se para y se reporta, no se introducen claves en el pipeline de validación.
- Premisas a cerrar en Fase 03 (sin desplegar, solo lectura/validación estática): (1) que la franquicia 25/25 esté **activa en esta cuenta** (captura en Billing → Free Tier / `ce GetFreeTierUsage`); (2) disponibilidad de **Function URL en us-east-1**; (3) asserts de IaC **ya implementados** en `scripts/check.ps1` (1 tabla PROVISIONED ≤ 25/25 sin GSI/Streams/PITR/AutoScaling, 1 función, 1 Function URL, sin `AWS::ApiGatewayV2::*`, sin provisioned concurrency, MemorySize ≤ 256) — verificados en verde/rojo el 2026-11-18.

### 10d. Viabilidad de "Function URL + Express dentro" (evaluación de D-27)

**Es viable y encaja bien con este proyecto**, con cuatro condiciones que hay que aceptar explícitamente:

1. **Hace falta un adaptador** (el evento es payload v2.0, no un `req` de Node). Se fija `@vendia/serverless-express` **v5 pinned en `package-lock`** y `src/lambda.js` como único sitio que lo importa. Riesgo de salud: el proyecto cambió de ownership (Vendia → CodeGenieApp) y hay forks con el mismo nombre → la Fase 02 fija versión exacta y el gate falla si la dependencia desaparece; el plan B (sin dependencias exóticas) es un adaptador propio de ~80 líneas en `src/adapters/functionUrl.js`. Descartado: `aws-serverless-express` (archivada) y **Lambda Web Functions** (facturable, I2).
2. **El enrutado pasa a código**, y con él el `{id}`: Express lo resuelve (`/api/tickets/:id`), así que desaparece la trampa de `pathParameters: null`. Contrapartida: **no hay 4 Lambdas aisladas**, hay 1 proceso → un error no capturado en una ruta afecta a todas; se mitiga con el *error handler* de `app.js` + el guard del webhook (I5) + tests con `supertest`.
3. **Coste de arranque**: Express añade init (≈ decenas de ms de require + Middlewares) al cold start de Lambda, y **no se puede comprar provisioned concurrency porque es facturable (I2)**. Con 256 MB, payloads pequeños y una única función, el cold start observado objetivo es < 800 ms: aceptable para humanos y para Telegram (que reintenta, no espera). Mitigación gratuita y declarada en IaC: **`reservedConcurrency` como *kill switch* de emergencia** (ponerlo a 0 → 429 inmediato) y nunca subir memoria sin OK.
4. **Desviación del brief**: `PROMPT.md` §6.1 pedía `src/handlers/` y §5.5 API Gateway HTTP API. La regla operativa pasa a vivir en la constitución (I1/I2/I4) y en D-26/D-27; el brief se anota como **histórico con nota de vigencia** (change control: editar `PROMPT.md` pide OK del usuario). Alternativa si prefieres el brief intacto: dejarlo como está y que cualquiera que lo lea sepa que manda la constitución.

Ventajas reales que justifican el cambio: un solo dominio/URL, CORS y rutas en el mismo lugar que el código, **el mismo árbol Express corre en local con `npm run dev`** (nada de `sam local` ni de Docker para desarrollar), los tests usan `supertest` contra la app real, y el IAM se reduce a un único rol. El coste total del stack vuelve a **$0 típico** porque Function URL no factura el endpoint y la franquicia de Lambda cubre nuestro volumen.

- Deuda asumida: el `Scan` de `GET /api/tickets` (I5) se acepta por volumen bajo; su umbral queda reexpresado en items leídos (§10a).



## 11. Amendments

- (ninguna todavía)
