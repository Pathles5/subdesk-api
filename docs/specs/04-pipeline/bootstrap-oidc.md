# Bootstrap OIDC — guía manual del usuario (Fase 04, T-03, D-43)

> Lo ejecuta **solo el usuario** (consola AWS + consola GitHub). El orquestador no toca la consola ni pide claves. Duración estimada: 5–8 minutos. Cuesta $0 (IAM, STS y GitHub environments no se facturan). Reemplaza `159177056493` por el tuyo (cabecera de la consola → "Account").

## 1. AWS — Identity Provider (una vez)

Console → IAM → Identity providers → Add provider:
- Provider: ** OIDC **; URL: `https://token.actions.githubusercontent.com`; obtén la config (thumbprints por defecto OK).
- Audience: `sts.amazonaws.com` (añadir como "aud" personalizado).

## 2. AWS — Rol de despliegue `SubDeskCiDeployRole`

**Guía de consola paso a paso (T-03; para llevar al cliente, replicar igual con sus valores):**

1. IAM → **Roles → Create role**. Trusted identity: **Web identity** → Identity provider: `token.actions.githubusercontent.com`. ⚠️ El wizard pregunta "GitHub organization": con cuenta personal es el **usuario propietario del repo** (dev: `Pathles5`), y en "repository": `subdesk-api` — **nunca** *all repositories*. Si pregunta branches/environment: ambiente `dev`; si solo ramas: `main` y entonces el paso 4 es obligatorio. Audience: **Custom** → `sts.amazonaws.com` (exacto; si dejas *Everyone*, el `aud` del trust no coincidirá y el `AssumeRoleWithWebIdentity` falla). Next. *(Si ofrece instalar una GitHub App para gestionar OIDC: rechazable — el provider ya existe desde el paso 1.)*
2. Permissions: **Create policy** → pestaña **JSON** → pegar la policy `SubDeskCiDeployPolicy` (bloque C de abajo) → Review → name `SubDeskCiDeployPolicy`. Next.
3. Role name: **`SubDeskCiDeployRole`** → Create role.
4. Abrir el rol → pestaña **Trust relationships → Edit trust policy** → reemplazar TODO el documento por el JSON **A** de abajo. El `Condition` es el candado D-43/D-45: ata el rol a ESTE repo y a SU environment `dev`. Save changes.
5. Copiar el **ARN del rol** (página del rol, arriba) → valor del secreto `AWS_ROLE_ARN` en el environment `dev` de GitHub.
6. Regla de orden para el futuro: si el environment de GitHub se renombrara, **primero** se corrige el trust (paso 4) y **después** GitHub; el desmatch es fail-closed — deniega, nunca abre de más.

### A) Trust policy (paso 4 — reemplazo completo; sub = environment real `dev`, D-45)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::159177056493:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:Pathles5@43617338/subdesk-api@1462037116:environment:dev"
        }
      }
    }
  ]
}
```

La condición **atará el rol al environment `dev`**: ni otro repo, ni otro entorno, ni otro workflow pueden asumirlo. (Si en GitHub renombraras el environment, esto se rompe de forma segura: deniega, no afloja.)

> **A-05/D-50 (2026-11-22) — el valor de `sub` es la forma INMUTABLE, y esto no es opcional.** GitHub emite subject claims inmutables (`repo:OWNER@OWNER_ID/REPO@REPO_ID:…`) para todo repo **creado, renombrado o transferido después del 2026-07-15**. Este repo se creó el **2026-11-17**, así que su claim es `repo:Pathles5@43617338/subdesk-api@1462037116:environment:dev`; un trust escrito con la forma legada `repo:Pathles5/subdesk-api:environment:dev` **nunca matchea** y STS responde `Not authorized to perform sts:AssumeRoleWithWebIdentity` — el fallo exacto que dejó rojos los runs #2 y #3 con provider, `aud`, rol y secretos ya correctos. Se comprueba SIEMPRE contra el endpoint oficial antes de escribir ningún trust:
>
> ```bash
> gh api "repos/Pathles5/subdesk-api/actions/oidc/customization/sub" --jq .sub_claim_prefix
> # => repo:Pathles5@43617338/subdesk-api@1462037116   (use_immutable_subject: true)
> gh api repos/Pathles5/subdesk-api --jq '{repo_id: .id, owner_id: .owner.id, created_at: .created_at}'
> ```
>
> deliberately **sin wildcards y sin la variante legada**: los IDs numéricos son permanentes, así que fijarlos es más estrecho que el patrón `repo:OWNER@*/REPO@*` que se ve en internet, y ante cualquier cambio falla cerrado (deniega, no afloja). `check.ps1` ahora audita que las dos copias de este JSON (esta sección y el heredoc de `bootstrap-oidc-cli.sh`) lleven el mismo valor inmutable.

### C) Policy inline `SubDeskCiDeployPolicy` (paso 2 — pegar tal cual, cuenta ya sustituida)

> **A-03/D-48 (2026-11-22) — versión auditada actual.** CloudFormation autoriza cada llamada por
> recurso **contra la sesión del propio rol de CI** (no se pasa `--role-arn` a `sam deploy`, así que
> CFN usa un *temporary session* generado de nuestras credenciales: docs AWS
> `using-iam-servicerole.html`). Con la versión anterior el run #3 habría muerto en `ApiLogGroup`
> **y también en su rollback** (sin `logs:DeleteLogGroup`), dejando un stack `ROLLBACK_FAILED` que la
> pipeline no puede limpiar. Añadidas: `logs:CreateLogGroup`, `logs:PutRetentionPolicy` (la retención
> NO es parámetro de `CreateLogGroup`), `logs:TagResource`, `logs:DeleteLogGroup`,
> `lambda:TagResource` (la fila de autorización de `CreateFunction` la exige aunque los tags viajen
> dentro), `lambda:ListTags` (`GetFunction` se autoriza con `GetFunction` **y** `ListTags`) y
> `s3:PutBucketTagging`. Quitada: `cloudformation:ListStacks` — es acción *list* sin resource-level,
> dentro de un Sid con ARN de stack era **inerte** y nadie la llama (`deployer.py` siempre pasa
> `StackName`). Cada añadidos está verificado contra el grafo de llamadas de SAM CLI `v1.174.0` y el
> *Service Authorization Reference* de AWS; la justificación de lo que **no** se concede está en
> comments del propio `bootstrap-oidc-cli.sh`.
>
> **D-54 (2026-11-22) — la región se parametriza.** Este JSON es el **render expandido** del heredoc del script con `REGION=eu-west-1` y `STACK_NAME=subdesk-api-dev`: en el script los ARNs se construyen con `$REGION`/`$STACK_NAME`, así que cambiar de destino es editar **un** sitio (`infra/deployment.env`) y re-ejecutar el script, que re-emite la policy con los ARNs de la región declarada. `check.ps1` audita la cadena entera: fuente de verdad ↔ workflows ↔ este documento ↔ script, y que el bucket de artefactos lleve el token de región en el nombre (los nombres S3 son un espacio global: el bucket que creó el run #4 en `us-east-1` **bloquea ese nombre para siempre**).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "CloudFormation", "Effect": "Allow", "Action": ["cloudformation:CreateChangeSet","cloudformation:DescribeChangeSet","cloudformation:ExecuteChangeSet","cloudformation:DescribeStacks","cloudformation:DescribeStackEvents","cloudformation:GetTemplateSummary","cloudformation:DeleteStack"], "Resource": "arn:aws:cloudformation:eu-west-1:159177056493:stack/subdesk-api-dev/*" },
    { "Sid": "CloudFormationTransform", "Effect": "Allow", "Action": ["cloudformation:CreateChangeSet"], "Resource": "arn:aws:cloudformation:eu-west-1:aws:transform/Serverless-2016-10-31" },
    { "Sid": "SAMArtifactBucket", "Effect": "Allow", "Action": ["s3:CreateBucket","s3:PutObject","s3:GetObject","s3:ListBucket","s3:PutEncryptionConfiguration","s3:PutLifecycleConfiguration","s3:PutBucketTagging"], "Resource": ["arn:aws:s3:::aws-sam-cli-managed-*", "arn:aws:s3:::aws-sam-cli-managed-*/*"] },
    { "Sid": "LambdaScoped", "Effect": "Allow", "Action": ["lambda:CreateFunction","lambda:GetFunction","lambda:UpdateFunctionCode","lambda:UpdateFunctionConfiguration","lambda:DeleteFunction","lambda:GetFunctionConfiguration","lambda:ListVersionsByFunction","lambda:TagResource","lambda:ListTags"], "Resource": "arn:aws:lambda:eu-west-1:159177056493:function:TicketApiFunction" },
    { "Sid": "FunctionUrlScoped", "Effect": "Allow", "Action": ["lambda:CreateFunctionUrlConfig","lambda:GetFunctionUrlConfig","lambda:UpdateFunctionUrlConfig","lambda:DeleteFunctionUrlConfig","lambda:AddPermission","lambda:RemovePermission"], "Resource": "arn:aws:lambda:eu-west-1:159177056493:function:TicketApiFunction" },
    { "Sid": "TableScoped", "Effect": "Allow", "Action": ["dynamodb:CreateTable","dynamodb:DescribeTable","dynamodb:DeleteTable","dynamodb:UpdateTable","dynamodb:TagResource","dynamodb:ListTagsOfResource"], "Resource": "arn:aws:dynamodb:eu-west-1:159177056493:table/subdesk-api-dev-*" },
    { "Sid": "LogsScoped", "Effect": "Allow", "Action": ["logs:DescribeLogGroups","logs:ListTagsForResource","logs:CreateLogGroup","logs:PutRetentionPolicy","logs:TagResource","logs:DeleteLogGroup"], "Resource": "arn:aws:logs:eu-west-1:159177056493:log-group:/aws/lambda/TicketApiFunction*" },
    { "Sid": "CFNRolesLifecycle", "Effect": "Allow", "Action": ["iam:CreateRole","iam:GetRole","iam:GetRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy","iam:DeleteRole","iam:TagRole","iam:UntagRole","iam:ListRolePolicies","iam:ListAttachedRolePolicies","iam:ListInstanceProfilesForRole","iam:UpdateAssumeRolePolicy"], "Resource": "arn:aws:iam::159177056493:role/subdesk-api-dev-*" },
    { "Sid": "PassRoleToStackRolesOnly", "Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::159177056493:role/subdesk-api-dev-*", "Condition": { "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" } } },
    { "Sid": "WhoAmI", "Effect": "Allow", "Action": "sts:GetCallerIdentity", "Resource": "*" }
  ]
}
```

**Por qué el prefijo `subdesk-api-dev-`**: el stack se llamará `subdesk-api-dev` (decisión D-25 en la spec §4). CloudFormation nombra los roles que crea como `stackName-logicoRandom` y la tabla igual — el prefijo los acota sin `*` globales. (El rol del template, `AppRole`, no fija `Path`: CFN lo genera bajo ese prefijo de nombre. La condición `iam:PassedToService` remata: solo se puede pasar a Lambda.)

Copia el **ARN del rol**: `arn:aws:iam::159177056493:role/SubDeskCiDeployRole` → lo necesitarás en GitHub.

## 3. AWS — Alerta de facturación en $0 (antes del primer deploy; es el detector I2)

Console → Billing → Budgets → Alerts → Create: Monthly cost, actual spend, **threshold 0 USD**, email a tu correo. (Sin SNS si solo quieres email; esto no se puede crear por IaC sin superficie nueva — así está decidido.)

## 4. GitHub — Environment `dev`

Repo → Settings → Environments → **New environment**: `dev`.
- **Required reviewers**: **NO se ponen** (**D-48**, visto del usuario 2026-11-22). El visto I6 de un deploy es **la acción que arranca el workflow**: el push a `main` que el orquestador solo hace con tu autorización (y en `prune.yml`, el `workflow_dispatch` + el literal exacto). No existe ya la "aprobación en Actions".
- **Deployment branches → Selected branches: solo `main`**, y **bypass de administradores DESACTIVADO**. Esto sí es un candado, y es el que cubre el hueco que dejó quitar los reviewers: el trust del rol fija el claim `sub = repo:Pathles5@43617338/subdesk-api@1462037116:environment:dev` (inmutable, A-05/D-50) pero **no la rama**, así que sin esta política cualquier rama cuyo job declarara `environment: dev` obtendría credenciales y desplegaría ese código. Estado verificado por API el 2026-11-22: `deployment_branch_policy.custom_branch_policies = true`, `branch_policies = [{name: "main", type: "branch"}]` (id 67773148), `can_admins_bypass = false`, `protection_rules = ["branch_policy"]`. Comandos exactos en §7b.
- **Secrets** (6): `TELEGRAM_BOT_TOKEN` (el de tu bot de prueba de @BotFather), `ADMIN_API_KEY` (genéralo tú, p. ej. `node -e "console.log(require('crypto').randomUUID())"` — ≥16 chars por AllowedPattern), `TELEGRAM_WEBHOOK_SECRET` (igual, otro random), `AWS_ACCOUNT_ID`, `AWS_REGION` (puede ser *variable*, no secreto: `us-east-1`), `AWS_ROLE_ARN` (el ARN del paso 2).

## 5. Bot de prueba (2 min, gratis)

@BotFather → `/newbot` → nombre y username → **token** → pángalo en el secreto `TELEGRAM_BOT_TOKEN` del environment. Con la app stub el token no se usa aún; lo usará `reply` (F08) y el `setWebhook` (F09). El bot de prueba no necesita configuración extra todavía (no registras webhook hasta F09).

## 6. Verificación por lectura (la hace el orquestador, con tu visto para CLI o por pantallazo)

- Rol: trust con condición exacta + policy sin `Resource: "*"` (salvo `sts:GetCallerIdentity`, inerte).
- Provider: sub claim apunta a `environment:dev`.
- GitHub: environment `dev` con **política de ramas = `main`** y `can_admins_bypass: false`, verificado por `gh api` (nunca por pantalla — regla de A-02); **sin required reviewers desde D-48, ya no es un hallazgo que buscar**; secretos presentes por NOMBRE (nunca valores) y `AWS_ROLE_ARN` con el ARN del paso 2 **re-pegado por API** (los secretos son write-only: un valor roto solo se arregla reescribiéndolo, y el `updated_at` por API es la única evidencia de que el write cayó).

## 7. Estado del bootstrap dev (se rellena al ejecutar; spec de valores NO secrets en `docs/human/runbook.md` §2.7-D)

| Paso | Estado |
|---|---|
| 1. Provider OIDC | ✔ creado el 2026-11-20 — `arn:aws:iam::159177056493:oidc-provider/token.actions.githubusercontent.com` |
| 2. Rol `SubDeskCiDeployRole` | ✔ **creado el 2026-11-22** vía `bootstrap-oidc-cli.sh` en CloudShell (provider existente saltado; policy inline) — ARN: `arn:aws:iam::159177056493:role/SubDeskCiDeployRole`. ⚠ **El trust VIVO en AWS quedó con la forma LEGADA del claim (`repo:Pathles5/subdesk-api:environment:dev`) — causa de los rojos de los runs #2 y #3, diagnosticada con evidencia y registrada como D-50/A-05.** Las dos copias auditadas (`bootstrap-oidc-cli.sh` y §2B de este documento) llevan ya la forma **INMUTABLE** `sub=repo:Pathles5@43617338/subdesk-api@1462037116:environment:dev` (repo creado 2026-11-17 → post-2026-07-15; `use_immutable_subject: true`, leído en `gh api repos/Pathles5/subdesk-api/actions/oidc/customization/sub`), y `check.ps1` audita su coherencia (assert D-50). **✔ APLICADO en AWS el 2026-11-22 bajo visto puntual del usuario → D-51** (segunda excepción puntual, `aws iam update-assume-role-policy`; D-49 no se invocó como precedente). Re-leído con `get-role`: `StringEquals.sub = repo:Pathles5@43617338/subdesk-api@1462037116:environment:dev` y `aud = sts.amazonaws.com`. Dos trampas de herramienta que costaron tiempo real: el flag es **`--policy-document`** (con `--assume-role-policy-document` el CLI sale con **exit 252 sin cambiar nada**), y **ningún `simulate-*` puede validar la condición de un trust** — `simulate-principal-policy` solo ve políticas de identidad (por eso daba 22/22 `allowed` mientras el assume seguía roto) y `simulate-custom-policy` rechaza documentos con `Principal` (`InvalidInput`). La validación barata es el endpoint de `customization/sub` + CloudTrail **en la región del `aws-region` del workflow** | ✔ **policy A-03 aplicada el mismo día**: la versión viva era de un borrador anterior (sin los permisos que CloudFormation necesita para `ApiLogGroup` ni los tags de la Lambda, y sin la condición `iam:PassedToService`). Se ejecutó **desde local con visto puntual del usuario → D-49** (excepción única de «T-03 no delegable», solo `aws iam put-role-policy`, payload comparado programáticamente contra el heredoc de este script: `IDENTICO: true`). Re-leído de AWS: `LogsScoped` con `CreateLogGroup`/`PutRetentionPolicy`/`TagResource`/`DeleteLogGroup`, `LambdaScoped` con `TagResource`/`ListTags`, `s3:PutBucketTagging`, `ListStacks` fuera, PassRole condicionado ✔. Pre-vuelo con `aws iam simulate-principal-policy`: 22/22 acciones `allowed` y los negativos correctos (`PassRole` sin context key → `implicitDeny`; fuera del prefijo → `implicitDeny`) |
| 3. Alertas de coste | ✔ **budget `subdesk-api-cent-detect`** (0.01 USD/mes, alerta `ACTUAL GREATER_THAN 0.01`, `NotificationState OK`, `HealthStatus HEALTHY`) + dos alertas de cuenta preexistentes de **3.0 y 10.0 USD/mes** (no eran €: la moneda es USD) que no son recurso de SubDesk. **Creado 2026-11-22 con la clave del filtro en minúscula y corregido el mismo día a `user:Project$subdesk-api` (D-64)**: mientras fue `user:project$…` no casaba con ningún recurso y leía `0.0` sin medir nada — formato final y explicación en §3b. ✔ **Tag `Project` y `Stack` activados como *cost allocation tags* el 2026-11-22 (D-63)**, verificado `Active` con `aws ce list-cost-allocation-tags`; la previsión de que era «imposible hasta el primer deploy» resultó cierta sólo en parte: la consola no los listaba, pero la API `update-cost-allocation-tags-status` sí permite activarlos. ⏳ **Verificación diferida pendiente**: en ~24 h confirmar que Cost Explorer atribuye a `Project=subdesk-api` el coste de S3 de los artefactos (~0,00008 USD/mes) |
| 4. Environment `dev` + secretos | ✔ **cerrado el 2026-11-22 por API** (D-48 cambió el criterio): 6 secretos ✔ (solo en el environment; nivel repo vacío; `AWS_ROLE_ARN` re-pegado por `gh secret set` a las 12:17:16Z con el ARN exacto que devolvió `aws iam get-role`) · **sin required reviewers, deliberadamente** (el visto es el push) · **política de ramas = `main`** con `can_admins_bypass: false` ✔ verificado por API (comandos en §7b). La lectura anterior `protection_rules: []` dejo de ser un hallazgo: ahora el estado esperado es `["branch_policy"]` |
| 5. Bot de prueba (@BotFather) | ✔ token guardado en el secreto `TELEGRAM_BOT_TOKEN` (usuario 2026-11-22) |

**Resumen (2026-11-22, tras D-48/D-49, el run #3 rojo, D-50 y su aplicación D-51):** pasos materiales 1–5 ✔ **y el trust ya aplicado en AWS** (D-51): la forma inmutable del claim está viva y re-leída, así que **no queda ningún fleco de bootstrap abierto**. «Bootstrap listo · revisado» se cumple en sus tres condiciones: (a) `get-role-policy` con `LogsScoped`/`LambdaScoped` nuevos, `s3:PutBucketTagging`, sin `ListStacks` y con `iam:PassedToService` ✔; (b) environment verificado por API — ramas `main`, `can_admins_bypass: false`, 6 secretos por nombre, `AWS_ROLE_ARN` re-escrito con el ARN correcto el 2026-11-22T12:17:16Z ✔ (que **no** era la causa del rojo: D-50) — y trust vivo con el `sub` inmutable ✔; (c) cero required reviewers **por decisión**, D-48 ✔. **El único paso que queda es la ejecución del push a `main` del run #5** (bajo D-48 ese push ES el visto I6; el visto ya está dado por el usuario en esta sesión). Desde este resumen se cerraron además T-15 (secreto del webhook re-pegado, `updated_at 2026-11-22T14:42:14Z`), T-17 (policy re-emitida con ARNs `eu-west-1`, D-55) y la migración de región D-54. El activar el tag `Project` sigue pospuesto estructuralmente a T-07+ (ver §3b).

### 7b. Endurecimiento del environment por API (D-48 · aplicado y verificado 2026-11-22)

Los secretos de un environment son **write-only** y sus reglas de protección **no se ven en la API hasta que se guardan**, así que este bloque es la única forma honesta de declarar el environment como listo. Escribiendo los bodies a fichero (PowerShell 5.1 se come las comillas del JSON inline — misma lección que §3b):

```bash
# 1) activar políticas de rama custom y dejar reviewers vacíos (a propósito, D-48)
cat > env.json <<'JSON'
{ "reviewers": [], "can_admins_bypass": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X PUT repos/Pathles5/subdesk-api/environments/dev --input env.json

# 2) crear la política de rama. OJO al esquema: name + type (NO deployment_branch_policy,
#    que es el nombre del bloque en el PUT del environment y produce un 422 aquí).
cat > main.json <<'JSON'
{ "name": "main", "type": "branch" }
JSON
gh api -X POST repos/Pathles5/subdesk-api/environments/dev/deployment-branch-policies --input main.json

# 3) re-pegar el rol OIDC sin pasar por la UI (valor exacto, sin erratas de paste)
echo 'arn:aws:iam::159177056493:role/SubDeskCiDeployRole' \
  | gh secret set AWS_ROLE_ARN --env dev -R Pathles5/subdesk-api

# 4) VERIFICACIÓN (esto, no una pantalla)
gh api repos/Pathles5/subdesk-api/environments/dev --jq '{rules: [.protection_rules[].type], bypass: .can_admins_bypass, dbp: .deployment_branch_policy}'
gh api repos/Pathles5/subdesk-api/environments/dev/deployment-branch-policies --jq '.branch_policies[] | {name: .name, type: .type}'
gh api repos/Pathles5/subdesk-api/environments/dev/secrets --jq '.secrets[] | {name: .name, updated_at: .updated_at}'
```

Resultado real obtenido: `rules: ["branch_policy"]`, `bypass: false`, `branch_policies: [{main, branch}] (id 67773148)`, 6 secretos con `AWS_ROLE_ARN → 2026-11-22T12:17:16Z` y los otros cinco en 2026-11-20 (el PUT **no** borra secretos). Trampas vividas al aplicarlo: el POST con `deployment_branch_policy=…` da **422 "not a permitted key"**; y hacer el PUT **antes** de crear la política deja el environment con `custom_branch_policies: true` y **cero ramas permitidas** = ningún despliegue puede usar `dev` (bloqueo autoinfligido, reversible con el mismo PUT). Orden seguro: política de rama primero, o PUT+POST en el mismo bloque y verificar después.

### 3b. Budget de 0.01 USD filtrado por tag — la evidencia I2 ✔ creada en dev el 2026-11-22

`subdesk-api-cent-detect` existe. El formato **final verificado contra la API real** costó cuatro rechazos encadenados, y cada uno es instrucción para el cliente: (1) en **PowerShell 5.1** el literal `'{...}'` llega a `aws.exe` sin comillas dobles → usar **CloudShell/bash** o ficheros `file://`; (2) el suscriptor es **`Address`**, no `EmailAddress`; (3) `ThresholdType` admite el enum `FORECASTED_BREACH_IN_DAYS | ABSOLUTE_VALUE | PERCENTAGE` → **`ABSOLUTE_VALUE`**; (4) el filtro moderno es **`TagKeyValue`** con `scope:clave$valor` → `user:Project$subdesk-api` (el antiguo `"Tag": ["clave/valor"]` ya no está en las dimensiones soportadas). Nota: la API **aceptó el filtro antes de existir recursos etiquetados** — el presupuesto queda montado y leerá USD 0 hasta el primer deploy; corrige mi previsión anterior ("créalo tras el deploy"): se puede y se debe crear antes.

> **Corrección (2026-11-22, D-64): la clave del filtro iba en minúscula y eso dejó la guarda ciega desde el primer día.** La receta original decía `user:project$subdesk-api`, con `project` en minúscula. Las claves de tag en AWS son **sensibles a mayúsculas** y los recursos del stack llevan `Project: subdesk-api` (verificado con `lambda list-tags`, `dynamodb list-tags-of-resource` y `s3api get-bucket-tagging`), así que el filtro **no casaba con ningún recurso**: el budget leía `ActualSpend 0.0` y reportaba `NotificationState OK` / `HealthStatus HEALTHY` sin medir absolutamente nada. La API lo aceptó porque **no valida que la clave exista** — *aceptar no es acertar*, y la nota de arriba («leerá USD 0 hasta el primer deploy») convirtió ese cero en una falsa confirmación. Corregido con `aws budgets update-budget --new-budget` a `user:Project$subdesk-api`, conservando límite 0.01 USD/mes, `CostTypes` con `IncludeTax: true`, `TimeUnit` y `TimePeriod`, y verificando tras la escritura que la notificación `ACTUAL GREATER_THAN 0.01` se conserva. Trampa de CLI: el parámetro es **`--new-budget`**, no `--budget`, y el fallo devuelve un **`exit 252` silencioso**; además la doc avisa de que al modificar un budget el `calculatedSpend` **cae a cero**, así que un `0.0` inmediatamente después del cambio no prueba nada.
>
> **Segundo eslabón roto a la vez (D-63):** la atribución por tag exige además que la clave esté **activa** como *cost allocation tag*, y `Project`/`Stack` estaban `Inactive` hasta el 2026-11-22. Activados con `aws ce update-cost-allocation-tags-status` (la operación se llama así, no `update-cost-allocation-tags`, y el campo del payload es **`TagKey`**, no `CostAllocationTagKey` como figura en la documentación de la API). Mientras el tag estuvo inactivo, **todo** análisis de coste filtrado por tag devolvía vacío — incluido el que se registró como prueba de «$0 atribuidos».
>
> **Regla que queda:** un `0.0` de un budget filtrado por tag **no es evidencia de coste cero** hasta verificar (a) que la clave coincide **exactamente en mayúsculas** con la de los recursos y (b) que el tag consta `Active` en `aws ce list-cost-allocation-tags`. La evidencia de I2 debe apoyarse en el desglose **por servicio** de Cost Explorer y en la medición de bytes, y usar el tag sólo como corroboración. Verificación diferida pendiente: en ~24 h, filtrar CE por `Project=subdesk-api` y comprobar que aparece el coste de S3 de los artefactos (~0,00008 USD/mes); **no** se hace prueba negativa deliberada porque consistiría en gastar dinero.

```bash
# ELIMINAR del doc el comando viejo; el bueno verificado:
aws budgets create-budget \
  --account-id 159177056493 \
  --budget '{"BudgetName":"subdesk-api-cent-detect","BudgetType":"COST","TimeUnit":"MONTHLY","CostFilters":{"TagKeyValue":["user:Project$subdesk-api"]},"BudgetLimit":{"Amount":"0.01","Unit":"USD"}}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":0.01,"ThresholdType":"ABSOLUTE_VALUE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<EMAIL>"}]}]'
# verificacion:
aws budgets describe-budgets --account-id 159177056493 --query "Budgets[].BudgetName" --output text
```

**La otra mitad del tag (el "segundo fleco") sigue pendiente por naturaleza, no por olvido:** *activar* la clave `Project` en Billing → Cost allocation tags requiere que la consola la vea, y solo la ve cuando existe al menos un recurso real etiquetado — es decir, **tras el primer deploy (T-07)**. **[Corrección 2026-11-22, D-63: la previsión era demasiado conservadora. Las claves `Project` y `Stack` se activaron con `aws ce update-cost-allocation-tags-status` SIN esperar al deploy — la API lo permite aunque la consola no liste la clave — y quedaron verificadas `Active` con `aws ce list-cost-allocation-tags`, respuesta `{"Errors": []}`. Trampa medida: el campo del payload es `TagKey`, no `CostAllocationTagKey` como figura en la documentación de la API. El detector grueso de la cuenta son dos budgets preexistentes de 3.0 y 10.0 USD/mes (en USD, no €), ajenos a SubDesk.]**

Cuando el paso 1–4 esté hecho, dime "bootstrap listo" y el orquestador: (a) verifica por lectura, (b) despacha T-04/T-05/T-06 (workflows + scripts + asserts), (c) te propone el push del workflow y el primer deploy lo apruebas tú **en la pestaña Actions** del PR/merge. Nada más toca AWS desde esta máquina: ni ahora ni después.
