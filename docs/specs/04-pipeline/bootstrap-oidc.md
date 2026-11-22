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
| 3. Alertas de coste | ✔ **budget `subdesk-api-cent-detect` creado 2026-11-22** (0.01 USD, filtro `user:project$subdesk-api`; formato final en §3b) + alertas de cuenta €3/€10 preexistentes. ⏳ único resto: activar la clave `Project` en Cost allocation tags — imposible hasta el primer deploy (la consola no lista claves sin recursos etiquetados); es paso de T-07+ con recordatorio |
| 4. Environment `dev` + secretos | ✔ environment, secretos y **`AWS_ROLE_ARN` pegado (2026-11-22)**; pendiente solo la confirmación visual de **Required reviewers = usuario** |
| 5. Bot de prueba (@BotFather) | ✔ token guardado en el secreto `TELEGRAM_BOT_TOKEN` (usuario 2026-11-22) |

**Resumen:** pasos 1, 2, 3 (budget), 4 (ARN) y 5 ✔. Quedan para "bootstrap listo": **(a)** re-ejecutar `bootstrap-oidc-cli.sh` si el rol se creó ANTES de la ampliación de policy (logs:CreateLogGroup etc. — imprescindible para el primer deploy) y **(b)** confirmación visual de Required reviewers en el environment `dev`. El activar el tag `Project` se pospone estructuralmente a T-07+ (ver §3b).

### 3b. Budget de 0.01 USD filtrado por tag — la evidencia I2 ✔ creada en dev el 2026-11-22

`subdesk-api-cent-detect` existe. El formato **final verificado contra la API real** costó cuatro rechazos encadenados, y cada uno es instrucción para el cliente: (1) en **PowerShell 5.1** el literal `'{...}'` llega a `aws.exe` sin comillas dobles → usar **CloudShell/bash** o ficheros `file://`; (2) el suscriptor es **`Address`**, no `EmailAddress`; (3) `ThresholdType` admite el enum `FORECASTED_BREACH_IN_DAYS | ABSOLUTE_VALUE | PERCENTAGE` → **`ABSOLUTE_VALUE`**; (4) el filtro moderno es **`TagKeyValue`** con `scope:clave$valor` → `user:project$subdesk-api` (el antiguo `"Tag": ["clave/valor"]` ya no está en las dimensiones soportadas). Nota: la API **aceptó el filtro antes de existir recursos etiquetados** — el presupuesto queda montado y leerá USD 0 hasta el primer deploy; corrige mi previsión anterior ("créalo tras el deploy"): se puede y se debe crear antes.

```bash
# ELIMINAR del doc el comando viejo; el bueno verificado:
aws budgets create-budget \
  --account-id 159177056493 \
  --budget '{"BudgetName":"subdesk-api-cent-detect","BudgetType":"COST","TimeUnit":"MONTHLY","CostFilters":{"TagKeyValue":["user:project$subdesk-api"]},"BudgetLimit":{"Amount":"0.01","Unit":"USD"}}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":0.01,"ThresholdType":"ABSOLUTE_VALUE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<EMAIL>"}]}]'
# verificacion:
aws budgets describe-budgets --account-id 159177056493 --query "Budgets[].BudgetName" --output text
```

**La otra mitad del tag (el "segundo fleco") sigue pendiente por naturaleza, no por olvido:** *activar* la clave `Project` en Billing → Cost allocation tags requiere que la consola la vea, y solo la ve cuando existe al menos un recurso real etiquetado — es decir, **tras el primer deploy (T-07)**. Queda en el checklist post-deploy con recordatorio del orquestador; hasta entonces el detector grueso de la cuenta (alertas €3/€10, usuario 2026-11-22) cubre el intervalo.

Cuando el paso 1–4 esté hecho, dime "bootstrap listo" y el orquestador: (a) verifica por lectura, (b) despacha T-04/T-05/T-06 (workflows + scripts + asserts), (c) te propone el push del workflow y el primer deploy lo apruebas tú **en la pestaña Actions** del PR/merge. Nada más toca AWS desde esta máquina: ni ahora ni después.
