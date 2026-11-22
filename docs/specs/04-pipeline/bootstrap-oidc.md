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
          "token.actions.githubusercontent.com:sub": "repo:Pathles5/subdesk-api:environment:dev"
        }
      }
    }
  ]
}
```

La condición **atará el rol al environment `dev`**: ni otro repo, ni otro entorno, ni otro workflow pueden asumirlo. (Si en GitHub renombraras el environment, esto se rompe de forma segura: deniega, no afloja.)

### C) Policy inline `SubDeskCiDeployPolicy` (paso 2 — pegar tal cual, cuenta ya sustituida)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "CloudFormation", "Effect": "Allow", "Action": ["cloudformation:CreateChangeSet","cloudformation:DescribeChangeSet","cloudformation:ExecuteChangeSet","cloudformation:DescribeStacks","cloudformation:DescribeStackEvents","cloudformation:GetTemplateSummary","cloudformation:DeleteStack","cloudformation:ListStacks"], "Resource": "arn:aws:cloudformation:us-east-1:159177056493:stack/subdesk-api-dev/*" },
    { "Sid": "SAMArtifactBucket", "Effect": "Allow", "Action": ["s3:CreateBucket","s3:PutObject","s3:GetObject","s3:ListBucket","s3:PutEncryptionConfiguration","s3:PutLifecycleConfiguration"], "Resource": ["arn:aws:s3:::aws-sam-cli-managed-*", "arn:aws:s3:::aws-sam-cli-managed-*/*"] },
    { "Sid": "LambdaScoped", "Effect": "Allow", "Action": ["lambda:CreateFunction","lambda:GetFunction","lambda:UpdateFunctionCode","lambda:UpdateFunctionConfiguration","lambda:DeleteFunction","lambda:GetFunctionConfiguration","lambda:ListVersionsByFunction"], "Resource": "arn:aws:lambda:us-east-1:159177056493:function:TicketApiFunction" },
    { "Sid": "FunctionUrlScoped", "Effect": "Allow", "Action": ["lambda:CreateFunctionUrlConfig","lambda:GetFunctionUrlConfig","lambda:UpdateFunctionUrlConfig","lambda:DeleteFunctionUrlConfig","lambda:AddPermission","lambda:RemovePermission"], "Resource": "arn:aws:lambda:us-east-1:159177056493:function:TicketApiFunction" },
    { "Sid": "TableScoped", "Effect": "Allow", "Action": ["dynamodb:CreateTable","dynamodb:DescribeTable","dynamodb:DeleteTable","dynamodb:UpdateTable","dynamodb:TagResource","dynamodb:ListTagsOfResource"], "Resource": "arn:aws:dynamodb:us-east-1:159177056493:table/subdesk-api-dev-*" },
    { "Sid": "LogsReadScoped", "Effect": "Allow", "Action": ["logs:DescribeLogGroups","logs:ListTagsForResource"], "Resource": "arn:aws:logs:us-east-1:159177056493:log-group:/aws/lambda/TicketApiFunction*" },
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
- **Required reviewers**: tú mismo (esto ES el visto I6 auditable de cada deploy).
- **Secrets** (6): `TELEGRAM_BOT_TOKEN` (el de tu bot de prueba de @BotFather), `ADMIN_API_KEY` (genéralo tú, p. ej. `node -e "console.log(require('crypto').randomUUID())"` — ≥16 chars por AllowedPattern), `TELEGRAM_WEBHOOK_SECRET` (igual, otro random), `AWS_159177056493`, `AWS_REGION` (puede ser *variable*, no secreto: `us-east-1`), `AWS_ROLE_ARN` (el ARN del paso 2).

## 5. Bot de prueba (2 min, gratis)

@BotFather → `/newbot` → nombre y username → **token** → pángalo en el secreto `TELEGRAM_BOT_TOKEN` del environment. Con la app stub el token no se usa aún; lo usará `reply` (F08) y el `setWebhook` (F09). El bot de prueba no necesita configuración extra todavía (no registras webhook hasta F09).

## 6. Verificación por lectura (la hace el orquestador, con tu visto para CLI o por pantallazo)

- Rol: trust con condición exacta + policy sin `Resource: "*"` (salvo `sts:GetCallerIdentity`, inerte).
- Provider: sub claim apunta a `environment:dev`.
- GitHub: environment con reviewer = usuario; secretos presentes por NOMBRE (nunca valores).

## 7. Estado del bootstrap dev (se rellena al ejecutar; spec de valores NO secrets en `docs/human/runbook.md` §2.7-D)

| Paso | Estado |
|---|---|
| 1. Provider OIDC | ✔ creado el 2026-11-20 — `arn:aws:iam::159177056493:oidc-provider/token.actions.githubusercontent.com` |
| 2. Rol `SubDeskCiDeployRole` | ✔ **creado el 2026-11-22** vía `bootstrap-oidc-cli.sh` en CloudShell (provider existente saltado; trust `sub=repo:Pathles5/subdesk-api:environment:dev`; policy inline) — ARN: `arn:aws:iam::159177056493:role/SubDeskCiDeployRole` |
| 3. Alertas de coste | ⚠️ **parcial**: existen alertas de cuenta €3 y €10 (usuario, 2026-11-22) — útiles pero NO son la evidencia I2. Falta el **budget mensual filtrado por tag `Project=subdesk-api` con umbral €0.01** (detector del céntimo; razón: peor caso ~14 €/mes — las alertas de 3/10 € saltan tarde y sin firma de proyecto) |
| 4. Environment `dev` + secretos | ✔ environment, secretos y **`AWS_ROLE_ARN` pegado (2026-11-22)**; pendiente solo la confirmación visual de **Required reviewers = usuario** |
| 5. Bot de prueba (@BotFather) | ✔ token guardado en el secreto `TELEGRAM_BOT_TOKEN` (usuario 2026-11-22) |

**Resumen:** pasos 1, 2, 4 (ARN) y 5 ✔. Quedan dos: **(a)** crear el budget €0.01 con filtro tag `Project=subdesk-api` (comando abajo, §3b) y **(b)** confirmación visual de Required reviewers en el environment `dev`. Con eso, "bootstrap listo" y arrancan T-04/T-05.

### 3b. Budget de €0.01 filtrado por tag — la evidencia I2 que faltan tus alertas de 3/10 €

Tus alertas de €3 y €10 son de **cuenta global**: saltan tarde (el peor caso de este proyecto son ~14 €/mes solo si la franquicia no aplicara, y €14 dispara la de €10 cuando ya vas dos meses desviado) y **sin firma de proyecto** (no distinguen un gasto del proyecto de uno de otro servicio). La evidencia que pide I2 es el **detector del céntimo con nombre propio**:

```bash
# 1) activa la etiqueta de coste (consola: Billing → Cost allocation tags → Project → Activate;
#    tarda hasta 24 h en verse en el filtro del budget; es prerequisito del paso 2)
# 2) crea el budget mensual filtrado por tag, alerta ACTUAL > 0.01 por email (sin SNS):
aws budgets create-budget \
  --account-id 159177056493 \
  --budget "{
    \"BudgetName\": \"subdesk-api-cent-detect\",
    \"BudgetType\": \"COST\",
    \"TimeUnit\": \"MONTHLY\",
    \"CostFilters\": { \"Tag\": [ \"project/subdesk-api\" ] },
    \"BudgetLimit\": { \"Amount\": \"0.01\", \"Unit\": \"EUR\" }
  }" \
  --notifications-with-subscribers "[{
    \"Notification\": { \"NotificationType\": \"ACTUAL\", \"ComparisonOperator\": \"GREATER_THAN\", \"Threshold\": 0.01, \"ThresholdType\": \"ABSOLUTE_VALUE\" },
    \"Subscribers\": [ { \"SubscriptionType\": \"EMAIL\", \"Address\": \"TU_EMAIL\" } ]
  }]"
```

**Campos que la API exige literalmente (verificado en vivo 2026-11-22, dos vueltas):** en `Subscribers[]` el email va en **`Address`**, no `EmailAddress`; y `ThresholdType` admite el enum **`FORECASTED_BREACH_IN_DAYS | ABSOLUTE_VALUE | PERCENTAGE`** — para el detector del céntimo es **`ABSOLUTE_VALUE`** con `Threshold: 0.01` (PERCENTAGE 0.01 sería "1 % del límite", otra cosa). En **Windows PowerShell** el literal `'{...}'` llega a `aws.exe` sin comillas dobles (PS 5.1 las destruye al invocar nativos) — pasar los JSON por ficheros `file:///$env:TEMP/budget.json`; en **CloudShell/bash** el comando funciona tal cual y es la vía recomendada también para re-ejecutar `bootstrap-oidc-cli.sh`.

Cuando el paso 1–4 esté hecho, dime "bootstrap listo" y el orquestador: (a) verifica por lectura, (b) despacha T-04/T-05/T-06 (workflows + scripts + asserts), (c) te propone el push del workflow y el primer deploy lo apruebas tú **en la pestaña Actions** del PR/merge. Nada más toca AWS desde esta máquina: ni ahora ni después.
