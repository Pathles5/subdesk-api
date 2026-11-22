# Runbook — SubDesk API

Actualizado: fase 04 · 2026-11-22

> Documento para **quien opera el stack**: cómo se valida la infraestructura, cómo se despliega (solo por pipeline), dónde se leen los outputs, qué hay que limpiar a mano y cómo se comprueba el coste. Topología y capas: `technical/architecture.md`; compuertas de desarrollo: `technical/operations.md`; contrato: `docs/api/openapi.yaml`; decisiones por ID: `DECISIONS.md`. Modelo de visto de la pipeline: **D-48** (2026-11-22) — no hay aprobación manual en Actions.

**Regla de oro (I6 / D-42 / D-48).** Dos capas, y ya no son la misma cosa:

1. **Quién ejecuta:** ninguna acción que cree, cambie o borre recursos reales de AWS se corre desde una máquina local. El **único ejecutor** es la pipeline de GitHub Actions — `deploy.yml` (apilar) y `prune.yml` (demoler). Desde local hay validación estática (compuertas) y **solo lecturas** autorizadas. Única excepción registrada y **no precedentable**: el `aws iam put-role-policy` de la policy del propio rol de CI, ejecutado por el orquestador el 2026-11-22 con visto puntual del usuario (**D-49**) — prerequisito huevo-gallina de la pipeline, con payload comparado programáticamente contra `bootstrap-oidc-cli.sh`. Cualquier otra escritura local sigue prohibida (I6/D-42) y exige un visto nuevo, específico y registrado.
2. **Quién da el visto:** no es una aprobación dentro de Actions. El environment `dev` **no tiene *required reviewers* y no se van a poner** (**D-48**, visto del usuario 2026-11-22): no existe el estado *Waiting* ni el botón de aprobar. El visto I6 es **la acción humana que arranca el workflow** — el **push a `main`** que el orquestador solo hace con tu autorización explícita (deploy), y el `workflow_dispatch` con el **literal exacto `BORRO-SUBDESK-API-DEV`** (prune). `environment: dev` se declara igual en todo job que mute AWS, pero por lo que sí hace: scope de secretos y producción del claim OIDC `sub = repo:Pathles5/subdesk-api:environment:dev` que exige el trust del rol — sin él no hay credenciales (fail-closed, D-43).

**Nada de lo que sigue se ha ejecutado contra recursos de la app**: a fecha de este documento **no existe stack, ni Lambda, ni URL ni bucket SAM** — verificado por API el 2026-11-22 tras el run #2 (cero stacks, cero roles `subdesk-api-dev-*`, bucket SAM inexistente). El `template.yaml` está validado en seco desde la Fase 03, la identidad de la pipeline está **completa y verificada** (D-49 cerró el último hueco de policy) y el primer apilado real —**run #3**— espera **solo el push a `main` autorizado por el usuario**. Los valores entre `<>` son placeholders; los secretos **nunca** se escriben en el repo ni en un comando tecleado con su valor literal (I4).

## 1. Despliegue en seco — cómo se valida la infraestructura sin desplegar

Objetivo: tener certeza estructural del `template.yaml` (AWS SAM, `Transform: AWS::Serverless-2016-10-31`, D-15) **sin credenciales, sin red a AWS y sin crear recursos** (criterio C5 de la Fase 00). Por eso `sam build` y `sam validate` a secas **no** son compuerta: el primero ejecuta scripts de dependencias (D-31) y el segundo pide credenciales.

```bash
pnpm install --frozen-lockfile   # cadena de suministro I4b (pnpm; npm/yarn prohibidos)
pnpm run validate:iac            # cfn-lint template.yaml → 0 errores, offline, sin credenciales
pnpm run check                   # scripts/check.ps1 → asserts de IaC + frescura I8 + higiene de secretos
```

`pnpm run validate:iac` lanza `cfn-lint template.yaml`: valida esquema, tipos y propiedades del transform SAM. Lo que `cfn-lint` **no** puede ver lo cubren los asserts de `scripts/check.ps1` sobre el texto de la plantilla (D-31/D-26/D-27), que fallan la fase si aparece alguno de estos estados:

| Assert sobre el `template.yaml` | Invariante |
|---|---|
| 1 sola `AWS::DynamoDB::Table`, `BillingMode: PROVISIONED`, capacidad ≤ 25/25, sin GSI/LSI, sin Streams, sin PITR, sin `AWS::ApplicationAutoScaling::*` | I2 / D-26 |
| 1 sola Lambda con **1 sola** Function URL (`AWS::Lambda::Url`); ausencia de `AWS::ApiGatewayV2::*` y de `AWS::Serverless::HttpApi` | D-27 |
| `MemorySize` ≤ 256 y **sin** provisioned concurrency (`AutoPublishAlias`/`ProvisionedConcurrencyConfig`) | I2 |
| Ningún `"Resource": "*"` ni `arn:aws:iam::*` en la policy del rol | I4 / D-24 |
| **Región única**: guard de *literales* — cualquier token con forma de región (comentarios incluidos) debe ser `us-east-1`; no «fija» la región (la plantilla no declara propiedad de región: la fijan `--region us-east-1` en los comandos de §2/§3 y las lecturas de §5). Puede dar falso positivo si un comentario cita otra región (assert nuevo en Fase 03) | I2 / D-26 |
| Los tres `Parameters` (`TelegramBotTokenParam`, `AdminApiKeyParam`, `WebhookSecretParam`) con `NoEcho: true`, `AllowedPattern` de forma y ningún valor literal en el archivo | I4 / D-17 (criterio C5 de la fase) |

La topología es la de siempre —tabla, función, rol, grupo de logs y URL—, pero la URL está declarada como recurso **nativo** de CloudFormation (`AWS::Lambda::Url`) acompañada de su `AWS::Lambda::Permission` de invocación, que `AuthType: NONE` necesita; el permiso va declarado en la plantilla, explícito y auditable, en lugar de inyectado por el transform SAM. No añade superficie: apunta al ARN de la única función y no admite `Condition`.

### Herramientas de esta sección

| Herramienta | Cómo se instaló | Estado |
|---|---|---|
| `cfn-lint` **1.61.0** | `python -m pip install --user cfn-lint` (OSS, sin cuentas, sin valores) — visto del usuario 2026-11-20 | instalada; el ejecutable vive en `%APPDATA%\Python\Python313\Scripts`, que debe estar en el **PATH de usuario** o `pnpm run validate:iac` fallará con «cfn-lint no se reconoce» |
| `sam` (AWS SAM CLI) | instalada en la máquina del dev el **2026-11-22** (`C:\Program Files\Amazon\AWSSAMCLI\bin`) | instalada, **pero no es vía de despliegue**: ninguna compuerta local la invoca y `sam build` sigue proscrito (D-31). El `sam package`/`sam deploy` reales los ejecuta el job `deploy` de la pipeline (D-42); el runner instala su propia versión |
| `aws` (AWS CLI) | instalada en la máquina del dev el **2026-11-22** (`%LOCALAPPDATA%\Programs\Amazon\AWSCLIV2`) | instalada, con credenciales del usuario: sirve **solo para lecturas** (verificaciones del bootstrap, premisas de §5) y nunca para crear/mutar recursos desde local (D-42/I6). Rutas y workaround de PATH de esta sesión: `technical/operations.md` |
| `@mermaid-js/mermaid-cli` 12.2.0 | devDependency de pnpm (D-33/D-41) | para exportar los `.svg` de `diagrams/`; nada que ver con el despliegue |

### Árbol plano del artefacto (spike D-31, local y sin nube)

El artefacto Lambda no puede llevar symlinks (pnpm los usa por defecto; D-30 riesgo 1). La verificación se hace en seco, con el árbol de producción:

```bash
pnpm install --frozen-lockfile --prod --config.nodeLinker=hoisted
```

```powershell
Get-ChildItem node_modules -Recurse -Attributes ReparsePoint | Measure-Object   # esperado: 0
```

La evidencia (cero symlinks/junctions y tamaño del zip frente al límite de 50 MB directo) se registra en `docs/specs/03-iac/tasks.md` T-06 y cierra la fila D-31 de `DECISIONS.md`. El empaquetado real **no usa `sam build`** (D-31): `CodeUri: dist/lambda` apunta al **staging** que genera `scripts/package-lambda.mjs` — y aquí vive el hazard documentado en §2.5 abajo (`.gitignore` + el filtrado de `sam package`).

### 2.5 Hazard del empaquetado — precondición del pipeline de **Fase 04** (corrección D3, revisión fresh-eyes 2026-11-20; D-42)

`sam package`/`sam deploy` aplican las reglas de **`.gitignore`** al comprimir el `CodeUri`. Como `.gitignore` contiene `node_modules/`, la receta ingenua puede producir un ZIP **sin dependencias** (la Lambda arrancaría con `ERR_MODULE_NOT_FOUND: express`) — o, al revés, sin filtrado, llevarse devDeps y `.bin` dentro. Regla determinista, hoy en vigor en el job `package` de `deploy.yml` (la ejecuta `scripts/package-lambda.mjs`; no hay receta local que teclear):

1. **Staging explícito**: preparar `dist/lambda/` con `src/`, `package.json` y el `node_modules` **plano de producción** (`pnpm install --prod --frozen-lockfile --config.nodeLinker=hoisted` en dir limpio, copiado después) — nada de symlinks (spike D-31).
2. **Staging como única fuente**: se descarta la opción **`.samignore`** (decisión tomada al escribir el workflow, T-04): `CodeUri: dist/lambda` ya apunta al staging limpio, así que no hay nada que filtrar del árbol del repo.
3. **Verificación antes del deploy** (obligatoria, solo lectura): el job lista el ZIP generado y comprueba (a) presencia de `node_modules/express` y `serverless-http`, (b) ausencia de devDeps/`.bin`/`.env`, (c) tamaño coherente con la spike (~1 MB). El assert es **fail-closed**: en local detectó y abortó sobre 7 devDeps filtradas (T-05). Sin ese check, el job no publica artefacto y el deploy no arranca.

### 2.6 Colisión del nombre físico (riesgo D4 anotado aquí y en spec §8)

`FunctionName: TicketApiFunction` está fijado a propósito (determinismo del log group y del ARN literal del rol, §3). Consecuencias que el operador debe conocer: (a) un **segundo stack** en la misma cuenta+región que reutilice esta plantilla **colisiona** — el repo-hijo del bot (D-38) debe usar nombres propios; (b) un prune interrumpido (`delete-stack` en curso, job `destroy` de `prune.yml`) puede dejar la función o el log group huérfanos y hacer fallar el recreate (mitigación: `get-function`/`list-functions` de solo lectura antes de recrear, y borrar el stack completo en vez de recursos sueltos); (c) si esto molestara más adelante (hardening de F09), la alternativa limpia es `!Sub "${AWS::StackName}-TicketApiFunction"` reconstruyendo igual el ARN de logs — enmienda registrada entonces, con visto.

## 2. Despliegue real — **Fase 04, vía pipeline** (D-42; el visto es el push, D-48)

Ejecutor: `deploy.yml` en GitHub Actions. **No hay ningún comando de esta sección que se teclee en local** — ni `sam`, ni `aws cloudformation`, ni claves estáticas (D-42). La estrategia de CI/CD es la fila **D-25**; el `setWebhook` real vive en la **Fase 09**.

### 2.1 Cómo se da el visto (modelo vigente desde D-48, 2026-11-22)

- **No existe aprobación manual en Actions.** El environment `dev` se configuró **deliberadamente sin *required reviewers***: un run de `deploy.yml` no se queda nunca en *Waiting* y no hay botón que pulsar.
- **El visto I6 es la acción que arranca el workflow**: el **push a `main`**. El orquestador no hace push sin tu autorización explícita sobre lo que se sube; ese sí es el gate humano, y ocurre **antes** de que GitHub sepa nada.
- **Consecuencia asumida y escrita:** *todo* push a `main` despliega, **incluidos los commits de solo documentación**. Por eso la disciplina de push es la que protege, junto con el job `verify` (si una compuerta falla, el deploy no llega a AWS).
- **El candado que sustituye a los reviewers** es la política de ramas del environment: solo `main`, con `can_admins_bypass: false` (verificado por API el 2026-11-22). Sin él, cualquier rama que declarara `environment: dev` obtendría credenciales: el trust del rol fija el claim `…:environment:dev` pero **no** la rama. Comandos de aplicación y verificación, y las dos trampas del esquema: `docs/specs/04-pipeline/bootstrap-oidc.md` **§7b** (no se duplican aquí).
- `environment: dev` sigue declarado en los jobs que mutean AWS (`deploy`, `smoke`, `destroy`). Lo que aporta es mecanismo, no aprobación: scope de secretos + claim OIDC que exige el trust del rol (D-43, fail-closed). `scripts/check.ps1` lo exige **a nivel de job** (enmienda A-03), así que un `environment:` en un comentario o en un job que no despliega ya no cuela.

### 2.2 Los cuatro jobs del pipeline

| Job | Qué hace | Qué hay que mirar |
|---|---|---|
| `verify` | las 5 compuertas del repo en runner limpio: `pnpm install --frozen-lockfile`, `lint`, `test`, `validate:api`, `validate:iac`, `check.ps1` | si esto falla, no se toca AWS. Verde en el run #2 (2026-11-22, ✓ 32 s) |
| `package` | staging determinista del artefacto Lambda (`scripts/package-lambda.mjs`, receta §2.5) + asserts de contenido del ZIP + subida del handoff | evidencia C1 del run #2 (✓ 11 s). Fail-closed: detecta devDeps filtradas y aborta |
| `deploy` | `environment: dev` + OIDC → `sam package` → `sam deploy` del stack `subdesk-api-dev` | rojo en el run #2 por el claim OIDC (secreto `AWS_ROLE_ARN` mal pegado; corregido por API el 2026-11-22). **Sin Waiting: si las credenciales cuadran, despliega directo** |
| `smoke` | lee el `FunctionUrl` del stack (`describe-stacks`, solo lectura) y ejecuta `scripts/smoke-live.mjs` contra la URL viva | 15/15 casos de la colección Postman |

### 2.3 Secretos y parámetros

Los secretos viajan **solo como nombres de secretos del environment `dev`** — nunca con su valor en un archivo del repo ni en la salida del log (I4/D-17). Cada nombre de la izquierda es el `Parameter` del `template.yaml` (con `NoEcho: true`); el de la derecha, el secreto de GitHub:

- `TelegramBotTokenParam`  ← secreto `TELEGRAM_BOT_TOKEN`
- `AdminApiKeyParam`       ← secreto `ADMIN_API_KEY`
- `WebhookSecretParam`     ← secreto `TELEGRAM_WEBHOOK_SECRET`
- credenciales: **ninguna clave estática**. El job asume `SubDeskCiDeployRole` por OIDC con `role-to-assume: ${{ secrets.AWS_ROLE_ARN }}` (D-43); las tres de app se leen del mismo scope `dev`

Forma de los comandos que **ejecuta el job `deploy`** (se documentan para lectura; no son una receta local):

```bash
# 1) empaquetar el artefacto ya stagerizado (árbol plano de producción, D-31)
sam package --template-file template.yaml --s3-bucket <SAM_ARTIFACTS_BUCKET> \
            --s3-prefix subdesk-api-dev --output-template-file packaged.yaml --region us-east-1

# 2) crear/actualizar el stack: 5 recursos, un solo rol, una sola región
sam deploy --template-file packaged.yaml --stack-name subdesk-api-dev --region us-east-1 \
           --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --no-confirm-changeset \
           --parameter-overrides \
             "TelegramBotTokenParam=$TELEGRAM_BOT_TOKEN" \
             "AdminApiKeyParam=$ADMIN_API_KEY" \
             "WebhookSecretParam=$TELEGRAM_WEBHOOK_SECRET"
```

`--capabilities CAPABILITY_IAM` es obligatorio porque la plantilla crea el rol de D-24; es la señalización explícita de que CloudFormation asume una política IAM, no un bypass. `sam build` no aparece: está fuera de las compuertas y denegado al devops (D-31/D-12). Nota de permisos (A-03.3 → **aplicada**, D-49): `sam deploy` **no** pasa `--role-arn`, así que CloudFormation autoriza contra la **sesión del rol de CI** — la policy inline de `SubDeskCiDeployRole` necesita los permisos que eso exige (`logs:CreateLogGroup`/`PutRetentionPolicy`/`TagResource`/`DeleteLogGroup`, `lambda:TagResource`/`ListTags`, `s3:PutBucketTagging`) y ya están en AWS: los aplicó el orquestador el 2026-11-22 con visto puntual del usuario (**D-49**, excepción única y no precedentable: es la política del propio rol de CI, no estado de la app), con el payload comparado byte a byte contra el heredoc de `bootstrap-oidc-cli.sh` (`IDENTICO: true`) y re-leído después con `get-role-policy`. Pre-Flight determinista: `aws iam simulate-principal-policy`, 22/22 `allowed` + dos negativos de `iam:PassRole` en `implicitDeny`.

## 2.7 Identidad y secretos de la pipeline — guía de bootstrap (D-43; replicable a un cliente nuevo)

> **Esta es la guía canónica.** El JSON completo está en `docs/specs/04-pipeline/bootstrap-oidc.md`; aquí se fija *qué* se crea, *dónde* vive cada valor y *qué se cambia* al llevar el proyecto a otra cuenta (la del cliente). El bootstrap lo ejecuta **solo un humano con permisos de IAM en la consola AWS** + admin del repo en GitHub: la pipeline no puede crearse a sí misma (huevo-gallina). Coste: $0.
>
> **Vía CLI (recomendada si el wizard de consola complica — pregunta "organization", pide GitHub App, etc.):** `docs/specs/04-pipeline/bootstrap-oidc-cli.sh` — script idempotente (provider si falta + trust con la condición environment-exacta + policy inline), con las 4 variables de entorno de destino arriba (cuenta, owner/repo, environment, región). Imprime al final el `AWS_ROLE_ARN` listo para pegar en el environment de GitHub. La ruta de consola de abajo queda documentada como alternativa equivalente.

### A) Pasos (orden y qué se verifica al terminar)

1. **Provider OIDC en AWS** — IAM → Identity providers → OIDC: URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
   Verificación: el ARN existe (`arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com`). ✔ **Hecho en el dev el 2026-11-20** (ver D) ).
2. **Rol `SubDeskCiDeployRole`** — trust = provider anterior **con la condición** `repo:<ORG>/<REPO>:environment:dev` (la línea exacta en bootstrap §2; es lo que hace que *solo* el job que declara ese environment del repo indicado pueda asumir el rol — fail-closed, D-43). Adjuntar la inline policy `SubDeskCiDeployPolicy` (bootstrap §2): prefijos `subdesk-api-dev-*` en CloudFormation/IAM/DynamoDB/Logs, Lambda por nombre fijo, bucket SAM gestionado, `iam:PassRole` solo a `lambda.amazonaws.com`. Sin `Resource:"*"` (salvo `sts:GetCallerIdentity`, inerte).
   ✅ **Aplicada y verificada el 2026-11-22 (D-49).** La versión anterior de la policy viva se quedó en un borrador (le faltaban los permisos que CloudFormation necesita porque `sam deploy` no pasa `--role-arn` y la autorización corre contra la sesión del rol de CI — §2.3). El orquestador aplicó la versión auditada de A-03.3 con **visto puntual del usuario** mediante `aws iam put-role-policy`, con el payload comparado programáticamente contra el heredoc de `bootstrap-oidc-cli.sh` (`IDENTICO: true`). **Es la única escritura AWS desde local autorizada y no abre precedente** (D-49): cualquier otra sigue prohibida por I6/D-42. Verificación re-leída de AWS:
   ```bash
   aws iam get-role-policy --role-name SubDeskCiDeployRole --policy-name SubDeskCiDeployPolicy \
     --region us-east-1 --output json
   # esperado: LogsScoped con CreateLogGroup/PutRetentionPolicy/TagResource/DeleteLogGroup ·
   # LambdaScoped con TagResource/ListTags · s3:PutBucketTagging en SAMArtifactBucket ·
   # cloudformation:ListStacks AUSENTE · PassRoleToStackRolesOnly con iam:PassedToService
   ```
   Pre-Flight sin desplegar (`aws iam simulate-principal-policy` sobre las formas reales de ARN): **22/22 `allowed`**, y dos negativos que confirman la menor privilegio — `iam:PassRole` sin la context key → `implicitDeny` (`iam:PassedToService` en `MissingContextValues`) y `iam:PassRole` a un rol fuera del prefijo `subdesk-api-dev-*` → `implicitDeny`. Forma de la respuesta en `technical/operations.md` (no es la que sugiere la documentación genérica).
3. **Alerta de facturación $0** — Billing → Budgets → alerta de gasto mensual con umbral y email. **Antes** del primer deploy (es el detector que I2 exige; no es accionable por IaC: vivir en Billing es su gracia y su límite). ✔ En dev: budget `subdesk-api-cent-detect` creado y verificado el 2026-11-22 (umbral €0,01 filtrado por tag; formato final y los 4 rechazos encadenados, en bootstrap §3b y §5.1 de este documento) + alertas globales de cuenta €3/€10 preexistentes.
4. **Environment `dev` en GitHub** — Settings → Environments: nombre `dev`, **sin *required reviewers*** (**D-48**, visto del usuario 2026-11-22: el visto es la acción de disparo — push a `main` autorizado / `workflow_dispatch` + literal — y en Actions no hay nada que aprobar), **Deployment branches → Selected branches: solo `main`** y **Admin access / bypass de administradores DESACTIVADO** (el candado que cubre el hueco de no tener reviewers: el trust fija el environment, no la rama), y los 6 valores de C). El environment se declara listo **solo con verificación por API, nunca por pantalla** — comandos exactos y las dos trampas del esquema (422 del POST, y el PUT antes de crear la política de rama que deja el environment con cero ramas permitidas) en `docs/specs/04-pipeline/bootstrap-oidc.md` **§7b**.

### B) Matriz de secretos — qué es cada uno, cómo se genera, dónde se consume

| Secreto (nombre EXACTO) | Qué es | Cómo se genera / obtiene | Validación que lo espera | Dónde se consume | Rotación |
|---|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram (el del **bot de prueba** en el dev; el real cuando exista el bot-hijo, D-38) | @BotFather → `/newbot` → `número:secreto` | AllowedPattern del template: `^[0-9]{8,}:[A-Za-z0-9_-]{8,}$` | `Environment.Variables` de la Lambda (via `TelegramBotTokenParam`); solo `telegramService.js` al llamar `sendMessage` — nunca en logs (D-18) | Revoke/crea token con @BotFather `/revoke` → actualizar el secreto → re-deploy (pipeline) |
| `ADMIN_API_KEY` | Clave del panel; se compara con la cabecera `x-api-key` | `node -e "console.log(require('crypto').randomUUID())"` (36 chars, cumple ≥16) | AllowedPattern: `^[A-Za-z0-9._-]{16,}$` | via `AdminApiKeyParam` → env `ADMIN_API_KEY`; middleware `apiKey.js` con `timingSafeEqual` | Generar UUID nuevo → actualizar secreto → re-deploy → avisar al panel (breve ventana de dualidad si se quiere cero-corte: futuro, F09) |
| `TELEGRAM_WEBHOOK_SECRET` | Valor de `X-Telegram-Bot-Api-Secret-Token` que el webhook exige | igual, otro UUID nuevo (distinto del anterior) | AllowedPattern: `^\S{16,}$` | via `WebhookSecretParam` → env `TELEGRAM_WEBHOOK_SECRET`; gate del webhook (403) — **y debe coincidir con el registrado en `setWebhook`** (F09; descuadre = 403 en silencio, riesgo D-21) | Rotar = generar → actualizar secreto → re-deploy → **re-`setWebhook`** con el nuevo valor (comando en runbook §6, F09) |
| `AWS_ACCOUNT_ID` *(no secreto: variable)* | 12 dígitos de la cuenta destino | cabecera de la consola | — | `deploy.yml` (construcción del rol, logs) | n/a |
| `AWS_ROLE_ARN` | ARN del rol de paso 2 | `arn:aws:iam::<ACCOUNT_ID>:role/SubDeskCiDeployRole` (copiar del console al crearlo). En GitHub es un secreto **write-only**: un valor roto no se ve, solo se arregla **re-pegándolo por API** con el ARN exacto y mirando su `updated_at` | — | `aws-actions/configure-aws-credentials` (`role-to-assume`) — la **única** credencial de la pipeline. En dev se re-pegó el 2026-11-22T12:17:16Z; verificación por API en bootstrap §7b | El rol no tiene claves: no hay nada que rotar; si se revoca confianza, se edita la condición del trust |
| `AWS_REGION` *(variable)* | `us-east-1` en dev | — | asserts de región de `check.ps1` | todos los comandos `--region` de la pipeline | n/a |

Reglas: los 3 secretos de app viajan del environment → `--parameter-overrides` → `Parameters NoEcho` → env vars; **ninguno** se escribe nunca en el repo, en un log ni en un comando tecleado (I4). Los nombres son contrato (D-17): renombrar uno = enmienda de la spec 01, no un tweak.

### C) Checklist de bootstrap para una cuenta nueva (cliente)

Sustituir en este orden y verificar: (1) `ACCOUNT_ID` (todos los ARNs) · (2) `Pathles5/subdesk-api` → `ORG/REPO` del cliente (condición del trust — **olvidar esto es dejar la puerta abierta**; el assert del runbook lo verifica por lectura) · (3) `subdesk-api-dev` → nombre de stack del cliente (prefijos de policy) · (4) `us-east-1` si su región difiere (y re-validar el assert de región) · (5) crear los 3 secretos de app nuevos (nunca reutilizar los del dev) · (6) alerta $0 antes del primer deploy · (7) `FunctionName: TicketApiFunction` fijo → colisión con otro stack preexistente en la cuenta: comprobar `aws lambda get-function` ANTES del primer apilado del cliente (runbook §2.6; para multi-cliente serio se migraría a `${AWS::StackName}-` con enmienda, previsto y no hecho en v1) · (8) environment del cliente: **sin *required reviewers*** (el visto es el push/dispatch, D-48) PERO con **política de ramas = la rama que despliega** y `can_admins_bypass: false` — sin ese candado, el trust (que fija environment, no rama) deja desplegar desde cualquier rama. Verificar por API, nunca por pantalla: bootstrap §7b.

### D) Valores registrados del entorno dev (se rellenan según se ejecuta; NO secrets)

| Item | Valor de dev | Estado |
|---|---|---|
| Account ID | `159177056493` | facilitado por el usuario 2026-11-20 (identificador, no credencial) |
| Provider OIDC | `arn:aws:iam::159177056493:oidc-provider/token.actions.githubusercontent.com` | ✔ creado (reporte del usuario 2026-11-20) |
| Rol `SubDeskCiDeployRole` | `arn:aws:iam::159177056493:role/SubDeskCiDeployRole` | ✔ creado el 2026-11-22 vía `bootstrap-oidc-cli.sh` en CloudShell; trust correcto y verificado por lectura. ✔ **policy A-03.3 aplicada y re-leída el 2026-11-22 (D-49)** + pre-Flight `simulate-principal-policy` 22/22 `allowed` y 2 negativos en `implicitDeny` |
| GitHub environment `dev` | 6 secretos del environment (`TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `AWS_REGION`); `AWS_ROLE_ARN` re-pegado por API el 2026-11-22T12:17:16Z | ✔ **cerrado por API el 2026-11-22** (`protection_rules: ["branch_policy"]`, rama única `main` id 67773148, `can_admins_bypass: false`, **sin required reviewers por D-48**). Verificación: bootstrap §7b |
| Señuelo a no confundir | `GitHubActionsDeployRole` (trust `repo:Pathles5/api-meta:*`) | ⚠️ rol de **otro proyecto** en la misma cuenta: no es el de esta pipeline — fue la hipótesis del rojo OIDC del run #2 |
| Alerta $0 | budget `subdesk-api-cent-detect` | ✔ creado y verificado el 2026-11-22 (§5.1); único resto: activar la clave `Project` en Cost allocation tags, imposible hasta el primer deploy |

## 3. Dónde se leen los outputs

La plantilla declara tres `Outputs` (spec §4 de Fase 03):

| Output | Qué es | Para qué se usa |
|---|---|---|
| `FunctionUrl` | URL pública HTTPS de la función (`AWS::Lambda::Url`, `AuthType: NONE`) | base de todos los `curl` del panel y del `setWebhook` (Fase 09); es el valor que se documenta en el `README.md` cuando exista |
| `TableName` | nombre físico de `TicketsTable` | lo consume `TABLE_NAME` de la Lambda (D-17); para inspección manual en la consola de DynamoDB |
| `LogsGroupName` | `/aws/lambda/TicketApiFunction` con `RetentionInDays: 30` | destino de los logs JSON de D-18; desde ahí se abre CloudWatch Insights |

El nombre del grupo de logs es predecible porque la función fija `FunctionName: TicketApiFunction`: por eso el `Resource` de los permisos de logs del rol (D-24) puede escribirse literal y la relación función ↔ grupo queda determinista.

Dónde: consola de CloudFormation → stack → pestaña **Outputs**; o en solo lectura (necesita `aws` instalado y credenciales del usuario — Fase 04, si se prefieren lecturas CLI a la consola):

```bash
aws cloudformation describe-stacks --stack-name <NOMBRE_DEL_STACK> --region us-east-1 \
    --query "Stacks[0].Outputs" --output table
```

Mientras no haya stack, en docs y tests la URL se escribe siempre como `<FUNCTION_URL>`.

## 4. Borrar el stack (*prune*) y limpiar la resource policy huérfana

### 4.1 Prune — cómo se demuele `subdesk-api-dev`

Lo ejecuta **`prune.yml`**, nunca una consola local (D-42). **Dos capas de confirmación, las dos visibles en el run**, y **ninguna es una aprobación en Actions** (D-48):

1. **`workflow_dispatch` manual** con la rama y el formulario de GitHub rellenos por el usuario: es el primer gesto humano. No hay *required reviewer*, así que el run arranca directo — el visto real es que alguien con acceso pulse *Run workflow* después de autorizarlo.
2. **El literal exacto `BORRO-SUBDESK-API-DEV`** en el input `confirm` (case-sensitive). El job `verify-approval` compara la cadena y aborta si difiere; el job `destroy` no arranca sin esa coincidencia.

> Corrección de realidad-vs-doc (A-03.4): `prune.yml` **no** ejecuta `sam delete`. Hace `aws cloudformation delete-stack` y luego sondea `describe-stacks` hasta confirmar que el stack ha desaparecido — opción **menos privilegiada** (no necesita los permisos de `sam delete` ni interpreta la plantilla). El literal implementado es `BORRO-SUBDESK-API-DEV`, no el `destruyo-ticketstabla-con-datos` que imaginó el diseño original; la spec 04 §4 lleva el puntero. La forma que corre en el runner:

```bash
aws cloudformation delete-stack --stack-name subdesk-api-dev --region us-east-1
# y sondeo hasta que describe-stacks ya no devuelve el stack (DELETE_COMPLETE)
aws cloudformation describe-stacks --stack-name subdesk-api-dev --region us-east-1 \
  --query "Stacks[0].StackStatus" --output text
```

Consecuencias que hay que aceptar antes de disparar el prune: la **tabla `TicketsTable` se borra con el stack**, con sus tickets (exportar/confirmar antes); el grupo de logs y la Function URL también se van con él, así que **no queda resource policy huérfana** (§4.2); y el bucket SAM de artefactos **no** pertenece al stack: sobrevive y se gestiona a mano (su coste es ~$0.0002/mes, §5.1).

### 4.2 Limpieza al borrar la Function URL (resource policy huérfana)

Aviso ya consignado en la Fase 00 §10a y en el riesgo 3 de D-27: una Function URL con `AuthType: NONE` añade a la Lambda una **resource-based policy** propia. Si se borra la URL (o la función) **por fuera** de CloudFormation, esa política **sobrevive huérfana**: es un permiso vivo que ya no describe nada y puede bloquear la creación de una URL nueva sobre la misma función.

Comprobación (solo lectura) y limpieza — es una **excepción a D-42**: escritura puntual fuera del stack que la pipeline no cubre (su caso es borrar el stack completo, y con él la política). Va con **visto explícito del usuario** (I6) y la ejecuta él en su consola/CloudShell:

```bash
aws lambda get-policy --function-name <NOMBRE_DE_LA_FUNCION> --region us-east-1
aws lambda remove-permission --function-name <NOMBRE_DE_LA_FUNCION> \
                             --statement-id <ID_DEL_STATEMENT_DE_LA_URL> --region us-east-1
```

Notas operativas:

- El `statement-id` real de la política sale de la lectura `aws lambda get-policy` (CFN lo genera al no fijarse `StatementId` en la plantilla; puede fijarse `TicketApiUrlInvoke` explícito como cambio de plantilla con enmienda + visto, previsto para el hardening de F09). La limpieza de §4.2 se hace SIEMPRE contra el id leído, nunca adivinándolo.
- **Borrando el stack completo no queda residuo**: la URL y su política pertenecen al stack y se eliminan con él (es justo lo que hace `prune.yml`, §4.1). El problema aparece al quitar solo el recurso `UrlConfig`, al importar recursos a mano o al recrear la función con el mismo nombre.
- El grupo de logs es recurso **explícito** de la plantilla con `RetentionInDays: 30` (spec §4.1) — por eso la función no necesita `logs:CreateLogGroup` (D-24) y no deja grupo sin retención tras el borrado.
- La tabla `TicketsTable` **sí** se borra con el stack: si contiene tickets reales, exportar/confirmar antes de disparar el prune (§4.1), que es un `aws cloudformation delete-stack`. Ningún borrado de tabla forma parte de una compuerta (D-12).

## 5. Coste, alerta $0 y premisas de I2 (criterio C8)

El invariante I2/D-26 dice: una sola región (`us-east-1`), una sola tabla `Standard` `PROVISIONED` 25/25 sin auto scaling, una Lambda Event con Function URL, retención de logs ≤ 30 días. Coste esperado: **$0** mientras la franquicia de la cuenta esté activa. Techo conocido si la franquicia **no** aplicase a esta cuenta: **~$14,04–14,24/mes** por la tabla (D-26), no por picos de tráfico — con capacidad fija el exceso responde con `ThrottlingException`, no con factura.

**Estado de las premisas de C8 (nota formal, actualizada 2026-11-20).** El usuario las pospuso primero a la antigua Fase 08 y, tras el reorder **D-42**, su sede es la **Fase 04 (pipeline)**: deben evidenciarse **antes** del primer apilado real que ejecuta `deploy.yml`. **Ninguna se salta**: son bloqueantes del despliegue, no de la validación estática.

| Premisa | Cómo se comprueba (Fase 04, pipeline) | Referencia |
|---|---|---|
| Function URL disponible en `us-east-1` y `nodejs22.x` vigente en esa región (D-40) | consulta de la documentación de AWS (funciona sin credenciales: es lectura de quotas/región); en la cuenta, confirmación tras el deploy con `aws lambda get-function --function-name TicketApiFunction --region us-east-1` (solo lectura, con visto) | `docs/specs/03-iac/tasks.md` T-09 → fila 08 de `docs/specs/INDEX.md` |
| Franquicia 25 RCU / 25 WCU activa en esta cuenta | consola **Billing → Free Tier** o `aws ce get-free-tier-usage` (solo lectura) | D-26 riesgo 1 |
| Alerta de facturación en **$0** creada antes del primer deploy | `aws cloudwatch put-metric-alarm` sobre `EstimatedCharges` con umbral 0 (se fija el comando exacto con el visto; requiere un destino SNS: `<ARN_DEL_TOPIC_SNS>`) | D-11, I2 |
| Cuenta en plan **Paid** (no Free account con límites de servicio) | consola **Billing → Account settings** (verificación manual, sin CLI) | I2, Fase 00 §10c |

Comprobación de gasto, una vez desplegado, siempre de solo lectura: `aws ce get-free-tier-usage --region us-east-1` y la alarma de `EstimatedCharges` (no sustituye a revisar el uso real de RCU/WCU en la consola de DynamoDB).

### 5.1 Análisis de costes por tag (`Project=subdesk-api`) — visto de usuario 2026-11-22

Estrategia: **un tag común en todo recurso taggeable del stack** (tabla, Lambda, rol, log group y URL; la Permission no admite y cuesta $0) → dos usos:

1. **Budget del céntimo** (bootstrap §3b): filtro `Cost Filters: Tag = project/subdesk-api`, umbral €0.01 actual — la evidencia I2 real (las alertas globales de €3/€10 siguen como red gruesa de cuenta).
2. **Cost Explorer**: `Group by: Tag → Project`, filtro `subdesk-api` → desglose mensual del proyecto contra el techo conocido de D-26.

Requisitos del lado de la consola (manuales, una vez): **Billing → Cost allocation tags → activar la clave `Project`** (tarda ~24 h en verse en filtros; el budget existe desde el día 1 pero no ve nada hasta activada la etiqueta). Limitaciones honestas: hay líneas que el tag no atrapa — el **bucket `aws-sam-cli-managed-default`** (lo crea SAM fuera del stack: se taggea una vez a mano tras el primer deploy, `aws s3api put-bucket-tagging`; su coste es ~$0.0002) y los tags tardan 24–48 h en reflejarse en los reportes. El coste *esperado* del proyecto sigue siendo €0: el análisis por tag existe para que cualquier desvío sea **atribuible el primer día**, no detective a posteriori.

Si alguna premisa resulta **falsa**, el camino no es subir capacidad ni cambiar la tabla a `PAY_PER_REQUEST` por iniciativa propia: es decisión registrada + OK explícito del usuario (vía de escape de D-26, fila D-29 de pendientes).

## 6. Qué falta para que este runbook esté completo (sección pipeline: escrita en F04; cierre en F09)

La compuerta de Fase 09 exige el runbook completo (AGENTS §4, numeración post-D-42). **La sección de la pipeline ya está aterrizada**: §2 (despliegue ejecutado por `deploy.yml`, con el modelo de visto D-48) y §4.1 (prune ejecutado por `prune.yml`). Lo que queda para F09, con comandos exactos y placeholders:

1. **`setWebhook`** — el `curl` real con `<FUNCTION_URL>`, `<TELEGRAM_BOT_TOKEN>` y el mismo `<TELEGRAM_WEBHOOK_SECRET>` que la variable de entorno (si difieren, todo el webhook falla en silencio con `403`; riesgo anotado en D-21). Su forma ya está adelantada en el `README.md` de la raíz.
2. **Rotación** de `ADMIN_API_KEY` y `TELEGRAM_WEBHOOK_SECRET`: actualizar el secreto del environment `dev` y dejar que la pipeline reapile (un push autorizado, o el `workflow_dispatch` de `deploy.yml`) — los `--parameter-overrides` los ejecuta el job `deploy`, no una consola local; y re-`setWebhook` cuando cambie el secreto del webhook.
3. **Rollback**: **revert del commit en `main`** → el push reapila el stack al estado anterior (así está decidido en D-25: el repo es la fuente de verdad continua). No hay `sam deploy` local ni que guardar un `packaged.yaml`: el ZIP vive como artefacto de Actions. Para desmontar en vez de reapilar, el prune de §4.1. Qué se hace con la tabla y con la resource policy: §4.2.
4. **Prueba E2E documentada** del flujo completo: mensaje al bot → ticket `PENDING` → lectura del panel → `reply` → `RESOLVED`.

Mientras eso no exista, este documento describe **cómo se valida y cómo se despliega desde la pipeline**, no un sistema en producción: hoy no hay nada que operar (cero stacks; el run #3 espera **solo el push a `main` autorizado** — la identidad y la policy del rol de CI están aplicadas y verificadas, D-49).
