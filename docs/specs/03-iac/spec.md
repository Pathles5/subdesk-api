# Spec — Fase 03 · Infraestructura como código

Estado de fase: **spec** (ver `docs/specs/INDEX.md`)
Dependencias: Fase 02 `verified` (app Express con `lambda.js` por `serverless-http`).
Compuerta (§4 AGENTS): las cinco de Fase 02 **más** `pnpm run validate:iac` = `cfn-lint template.yaml` (offline, sin credenciales, sin ejecutar scripts — D-31), asserts de IaC de `check.ps1` en verde, evidencia de alerta de facturación $0 y cuenta Paid (I2), `deployment.mmd`+`.svg` y `component.mmd`+`.svg`, `runbook.md` (sección despliegue en seco), spike D-31 resuelta (artefacto con árbol plano). **Ningún `sam build/deploy` en compuertas; ningún despliegue sin visto explícito (I6).**

## 1. Objetivo

Materializar en `template.yaml` (AWS SAM, `Transform: AWS::Serverless-2016-10-31`, D-15) el esquema lógico congelado en Fase 01 y el andamiaje de Fase 02: **1 tabla `PROVISIONED` 25/25, 1 Lambda, 1 Function URL (`AuthType: NONE`), 1 rol IAM de menor privilegio, retención CloudWatch ≤ 30 días, secretos por `Parameters NoEcho`** — validado 100 % estático, sin crear recursos.

## 2. Alcance

- `template.yaml` completo + `scripts/` de ayuda si hicieran falta.
- Decisiones propuestas: **D-24** (rol IAM exacto), **D-40** (runtime Lambda y arquitectura), **D-41** (excepción `allowBuilds` para Puppeteer de `@mermaid-js/mermaid-cli` — exigida por I4b si se quieren los `.svg` del gate).
- Spike **D-31** resuelta en seco: generar el árbol plano de producción con `pnpm install --prod` + `nodeLinker: hoisted` y verificar cero symlinks/junctions en `node_modules` (PowerShell, local, sin nube).
- Assert nuevo de `check.ps1`: **región única `us-east-1`** (deuda de Fase 00 consignada en INDEX).
- `runbook.md` §1 (despliegue en seco: comandos exactos propuestos que el orquestador ejecutará con visto en Fase 08 — aquí documentados, no ejecutados).
- Verificaciones de premisas de SOLO LECTURA que el gate pide (§10c de Fase 00: Function URL disponible en us-east-1, franquicia 25/25 activa en esta cuenta, alerta $0, plan Paid): se formulan como comandos `aws`/pantalla de consola **con visto previo**; si el usuario no quiere dar credenciales aún, quedan como evidencia pendiente bloqueante del cierre — se decide con él, no se silencia (AGENTS §5).

## 3. Fuera de alcance

- `sam build`, `sam deploy`, `setWebhook`, cualquier creación de recursos → Fase 08 con visto (I6).
- CI/CD (Fase 08), lógica de negocio (Fases 04–07), el bot-hijo (D-38, repo aparte).

## 4. Diseño del template (lo que se congela)

### 4.1 Recursos (cinco lógicos de topología, vigilados por asserts; la forma física tras A-01 son 7 — ver enmienda)

| Recurso | Propiedades clave | Invariante que cumple |
|---|---|---|
| `TicketsTable` (`AWS::DynamoDB::Table`) | `BillingMode: PROVISIONED`, `ProvisionedThroughput: {ReadCapacityUnits: 25, WriteCapacityUnits: 25}`, PK `id` (S), Standard, SSE default AWS-KMS, **sin** GSI/LSI/Streams/PITR/AutoScalingRead/Write, `TimeToLive` ausente | I2/D-26 (asserts existentes los verifican) |
| `TicketApiFunction` (`AWS::Serverless::Function`) | `Handler: src/lambda.handler`, `Runtime: <D-40>`, `Architectures: [x86_64]`, `MemorySize: 256`, `Timeout: 30`, `CodeUri: ./`, empaquetado con `nodeLinker: hoisted` (D-31), `Environment`: las 6 de runtime (`TABLE_NAME` por `!Ref`, secretos por `!Ref Parameter`, `LOG_LEVEL`, `STAGE`), `AutoPublishAlias`/provisioned concurrency **prohibidos** | I2, I5, D-17 |
| `ServerlessHttpApi` NO se crea: en su lugar → | | |
| `UrlConfig` (`FunctionUrlConfig` en la SAM function) | `AuthType: NONE`, `CorsConfig: { AllowOrigins: ['*'], AllowMethods: [GET,POST,PATCH,OPTIONS], AllowHeaders: [x-api-key, Content-Type, X-Telegram-Bot-Api-Secret-Token], MaxAge: 300 }` — **única fuente de CORS** (I4) | D-27, I4 |
| `AppRole` (`AWS::IAM::Role`, un solo rol) | ver D-24 §4.2 | I4 menor privilegio |
| `LogsGroup` (`AWS::Logs::LogGroup`, explícito) | `LogGroupName: /aws/lambda/<función>`, `RetentionInDays: 30`, `DependsOn` limpio — pre-creado porque Lambda implícito nace sin retención | I2 |

Parameters: `TelegramBotToken`, `AdminApiKey`, `TelegramWebhookSecret` — los tres con `NoEcho: true` + `AllowedPattern` razonable; el template **jamás** contiene valores (D-17/I4). Outputs: `FunctionUrl`, `TableName`, `LogsGroupName`.

### 4.2 D-24 — Rol IAM exacto (propuesta)

`AssumeRolePolicyDocument`: `lambda.amazonaws.com`. `Policies` única, con:

```
- Effect: Allow
  Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:Scan]
  Resource: !GetAtt TicketsTable.Arn
- Effect: Allow
  Action: [logs:CreateLogStream, logs:PutLogEvents]
  Resource: !Sub arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${TicketApiFunction}:*
```

Sin `logs:CreateLogGroup` (el grupo es recurso explícito → la función nunca lo crea por detrás); sin `dynamodb:Query|DeleteItem|BatchWrite*|DescribeTable` (no usados); sin `Resource: "*"`; sin managed `AWSLambdaBasicExecutionRole` (la statement anterior la sustituye con menos superficie). Verificación: lectura del JSON del rol + `cfn-lint` + assert existente de `check.ps1` contra `"Resource": "*"`; además sondeo `iam simulate-policy` **solo** si el usuario da visto y credenciales (sería externo de lectura).

### 4.3 D-40 — Runtime y arquitectura (propuesta)

`Runtime: nodejs22.x`, `Architectures: [x86_64]`. Motivos: motor local 22.20.0 = mismo runtime (mínima deriva dev/prod); `engines.node ">=20 <23"` de D-28 lo cubre; x86_64 sobre arm64 porque el CI runner (ubuntu) empaqueta sin cross-arquitectura ninguna al ser JS puro, y no hay diferencia de franquicia. Riesgo: disponibilidad en us-east-1 de `nodejs22.x` — se verifica con lectura de docs/AWS CLI solo-lectura si se autoriza; el gate estático (`cfn-lint`) valida el enum del esquema SAM.

### 4.4 D-41 — `allowBuilds` para Puppeteer (excepción de cadena de suministro, requiere OK explícito)

El gate §4 de Fase 03 exige los `.svg` de los diagramas → `@mermaid-js/mermaid-cli` (D-33) → su postinstall baja Chromium vía Puppeteer → choca con `strictDepBuilds: true` + `allowBuilds: []`. Opciones:
- (a) **Permitir `allowBuilds: ["puppeteer", "@puppeteer/browsers"]`** con esta entrada en DECISIONS: la excepción mínima nombrada, auditable, y el resto del árbol sigue vetado. Riesgo: es el único sitio donde un script de dependencia corre en el repo — acotado a la instalación local de devDep (CI de despliegue no exporta diagramas; el artefacto Lambda no lleva devDeps).
- (b) Exportar los `.svg` en la spike D-31 una sola vez con `--config` puntual sin guardar allowBuilds (el gate `check.ps1` fallaría al regenerar después).
- (c) Renunciar al `.svg` (NO: rompe AGENTS §4 y la regla I8d de lectura sin herramientas).
**Propuesta: (a)** — decisión explícita del usuario por ser cambio de postura I4b (el assert ya la trata como FAIL sin registrar).

## 5. Spike D-31 en seco (sin sam, sin nube)

1. `pnpm install --frozen-lockfile --prod --config.nodeLinker=hoisted` en un dir temporal → árbol plano real.
2. Verificar con PowerShell: cero entradas de `node_modules` que sean symlink/junction (`Get-ChildItem -Recurse -Attributes ReparsePoint`).
3. Medir tamaño del zip resultante (`src/**` + `node_modules` prod) vs límite de 50 MB directo / 250 MB S3 — esperar KBs.
4. Registrar evidencia en tasks.md (árbol plano, cero symlinks, tamaño) y cerrar la fila D-31 de pendientes.

## 6. Diagramas, runbook y frescura (I8)

- `deployment.mmd`: repo → ( Actions, futuro) → SAM/CFN → 5 recursos + Telegram/panel como actores; `component.mmd`: capas con dirección única actualizadas a `serverless-http`. Ambos con `.svg` exportado (D-41) y `Actualizado: fase 03`.
- `runbook.md` nace con §despliegue-en-seco: parámetros del deploy, `NoEcho`, dónde van los secretos (GitHub → `--parameter-overrides`), cómo se leen outputs, limpieza de resource policy al borrar la URL (nota citada en Fase 00). El `setWebhook` real llega en Fase 08.
- Tabla de frescura del índice + bump de marcadores de artefactos tocados.

## 7. Criterios de aceptación

- **C1** — D-24/D-40/D-41 registradas con opciones/motivo/riesgo tras el visto (D-07); fila D-31 actualizada con la evidencia de la spike.
- **C2** — `pnpm run validate:iac` en verde (`cfn-lint template.yaml`, exit 0, sin credenciales, sin red a AWS).
- **C3** — asserts de IaC de `check.ps1` en verde **más el nuevo de región única**: una sola región `us-east-1` declarada; plantilla conforme pasa y una variante prohibida (PAY_PER_REQUEST o 2ª tabla) fallaría (ya verificado en rojo en Fase 00, se re-verifica con la plantilla real).
- **C4** — Spike D-31: árbol plano de prod generado, cero symlinks demostrado, tamaño registrado.
- **C5** — `template.yaml` NO contiene ningún valor de secreto (higiene de `check.ps1` en verde con el archivo en el repo); los tres `Parameters` tienen `NoEcho: true`.
- **C6** — Diagramas `.mmd`+`.svg` de despliegue y componentes existiendo, coherentes con los recursos reales del template (no con la aspiración).
- **C7** — `runbook.md` con la sección de despliegue en seco; la compuerta completa de Fase 02 SIGUE en verde (regresión cero: `lint`, `test`, `validate:api`, `check.ps1`).
- **C8** — Premisas I2/§10c: o evidencia adjunta (consulta de solo lectura autorizada: región/Function URL, franquicia activa, alerta $0, plan Paid), o nota explícita del usuario de que se aportan en Fase 08 antes del primer deploy. **No se cierra en silencio con la premisa sin tocar.**
- **C9** — Revisión fresh-eyes APTA; cierre `verified` (la fase no toca recursos reales; el visto del usuario va por tarea y por las instalaciones/decisiones I4b, no por una aprobación de fase adicional).

## 8. Riesgos / desviaciones

1. **Las herramientas no están instaladas**: `cfn-lint` vía `python -m pip install --user cfn-lint` (OSS, sin cuentas); `sam`/`aws` **no** hacen falta para el gate de esta fase — se piden solo si el usuario autoriza las lecturas de premisas de C8 (o se posponen a Fase 08 con la evidencia). Instalaciones locales: requieren OK explícito del usuario.
2. D-41 abre la primera excepción de build-scripts del repo; mitigación: nombrada y estrecha, y el assert FAIL si alguien añade más entradas a `allowBuilds` sigue activo (whitelist codificada en `check.ps1`: solo `puppeteer` y `@puppeteer/browsers`).
3. **(ampliado en el cierre por la revisión, desv. D3)** El hazard del empaquetado es más grave que «inflar el artefacto»: `sam package` respeta `.gitignore`, cuyo patrón `node_modules/` puede dejar el ZIP **sin dependencias** (`ERR_MODULE_NOT_FOUND` en el primer invoke). Precondición del pipeline F08 documentada en runbook §2.5: staging explícito o `.samignore`, y **verificación del contenido del ZIP antes de proponer el deploy**. Además: `validate:iac` depende de un binario fuera de pnpm en PATH — el workflow de F08 debe fijar su instalación como paso explícito.
4. `Cors AllowOrigins ['*']` sigue siendo estado de desarrollo anotado (I4): revisión con enmienda si el panel pide credenciales.
5. **(nuevo en el cierre, desv. D4)** `FunctionName: TicketApiFunction` fijo → colisión con un segundo stack en la misma cuenta+región (el bot-hijo debe usar nombres propios) y riesgo de huérfanos tras un `sam delete` interrumpido. Mitigaciones y alternativa `${AWS::StackName}-` prefijado (con enmienda): runbook §2.6.

## 9. Amendments

- **A-02 · 2026-11-20 (nombres lógicos físicos, deriva 1 del informe T-08 del documentador)** — Los `Parameters` del template se declaran como `TelegramBotTokenParam` / `AdminApiKeyParam` / `WebhookSecretParam` (no los nombres secos de §4): son identificadores lógicos CFN y claves de `--parameter-overrides`; **los nombres de las variables de entorno del contrato D-17 no cambian** (`TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET` en `Environment.Variables`). Idem el log group: recurso lógico `ApiLogGroup` (la §4.1 lo llamaba `LogsGroup`). El runbook de Fase 08 usa los nombres físicos del template porque son los ejecutables; el runbook manda sobre la prosa de la spec en este punto mecánico. Consecuencia anotada en D-24 por el documentador: el ARN de logs del rol usa el literal `/aws/lambda/TicketApiFunction` (forma física del `!Sub`, valor idéntico en runtime — aceptada).
- **A-01 · 2026-11-20 (forma validada por cfn-lint, sustancia intacta — informe T-05 del devops)** — Cuatro adaptaciones de representación, todas impuestas por el esquema real CFN y verificadas con `cfn-lint 1.61.0` exit 0 sin supresiones: (§4.1) **7 recursos** en plantilla en vez de 5 «lógicos»: la Function URL se declara como `AWS::Lambda::Url` explícito + su `AWS::Lambda::Permission` (`Principal: AWS:UrlInvoke`) porque el par SAM `FunctionUrlConfig` + `Fn::GetAtt ….Url` **no valida** (E6101) y el hijo generado por el transform no tiene ID lógico alcanzable estable; la topología sigue siendo 1 tabla, 1 función, 1 endpoint público (D-27) y los asserts del gate lo confirman (tableCount=1, fnCount=1, urlCount=1). (§4.2) `FunctionName: TicketApiFunction` fijado: el literal del ARN de streams del rol sustituye al `!Sub ${TicketApiFunction}` (creaba ciclo Function→Role→Function, E3004); la sustitución es byte-idéntica en el deploy. (§4.1 Cors) `AllowMethods: [GET, POST, PATCH]` — `OPTIONS` no existe en el enum del recurso (E3030) y el preflight lo resuelve la URL sola desde esta config; `AllowHeaders` en forma array (E3012), mismos tres headers; `AllowCredentials` omitido (inválido con `*`). (Outputs) el valor de `FunctionUrl` sale de `!GetAtt TicketApiUrlConfig.FunctionUrl` (atributo real; `.Url` no existe). Extra declarado: `InvokeMode: BUFFERED` explícito. Ninguna enmienda toca coste ($0: URL y Permission no facturan), IAM (los 2 statements de D-24 intactos) ni secretos.
- **A-03 · 2026-11-22 (región parametrizada — spec hijo de D-54; el `template.yaml` NO cambia)** — Los criterios **C3** y **C8** de esta spec fijaban el assert de «región única `us-east-1`» y la evidencia de «Function URL disponible en `us-east-1`». Con la decisión del usuario de 2026-11-22 la región pasa a ser **parámetro del despliegue** con valor **`eu-west-1`**, declarado una sola vez en `infra/deployment.env` (spec 00 **A-09**, spec 04 **A-07**). Consecuencias mecánicas, ninguna sobre la sustancia del IaC:
  1. **El template sigue siendo region-agnóstico por construcción**: no declara región (usa `${AWS::Region}` / `${AWS::AccountId}` en el ARN de logs de D-24), así que **no se toca** — y conviene que sea así, porque el `template.yaml` está blindado por orden del usuario y una migración de región que lo obligara a cambiar sería una señal de diseño acoplado.
  2. **El assert de `check.ps1` cambia de naturaleza**: deja de comparar contra un literal dentro del script y pasa a leer la fuente de verdad (`infra/deployment.env`) y a exigir que **ningún otro artefacto ejecutable** (IaC, workflows, `bootstrap-oidc-cli.sh`) declare una región distinta; además prohíbe que un workflow fije `AWS_REGION` a mano y verifica que el bucket de artefactos lleve el token de región en el nombre. Con esto, una migración a medias **falla la compuerta en local** en vez de fallar un deploy.
  3. **C8 re-evidenciada en la región nueva, con lecturas de solo lectura ya hechas**: `eu-west-1` no tiene `TicketApiFunction` (cero colisión con el `FunctionName` fijo del A-01 de arriba), ni tablas `subdesk-*`, ni log groups previos; `dynamodb describe-limits` da 40.000 RCU/WCU por tabla (los 25/25 de D-26 caben holgadamente); `lambda get-account-settings` responde (servicio vivo) y la operación `GetFunctionUrlConfig` existe en la región. Queda pendiente de cierre **con el primer apilado real**: la URL viva respondiendo 401/403/404/501.
  4. **Coste I2 intacto**: la franquicia de DynamoDB es **de cuenta** y la cuenta es de **2018-11-26** (leído en `aws iam get-credential-report`), así que el free tier antiguo `PROVISIONED` 25/25 sigue aplicando en `eu-west-1`; Lambda y CloudWatch Logs también son de cuenta. El único delta económico aceptado es el residuo del bucket de artefactos `us-east-1` (~$0,0002, con ciclo de vida de 30 días) porque **el espacio de nombres de S3 es global y no se puede reutilizar el nombre en otra región**.
