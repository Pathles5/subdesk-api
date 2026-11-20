# Runbook — SubDesk API

Actualizado: fase 03 · 2026-11-20

> Documento para **quien opera el stack**: cómo se valida la infraestructura, cómo se desplegará, dónde se leen los outputs, qué hay que limpiar a mano y cómo se comprueba el coste. Topología y capas: `technical/architecture.md`; compuertas de desarrollo: `technical/operations.md`; contrato: `docs/api/openapi.yaml`; decisiones por ID: `DECISIONS.md`.

**Regla de oro (I6).** Ninguna acción que cree, cambie o borre recursos reales de AWS ocurre sin **propuesta con comandos exactos y visto explícito del usuario**. Nada de lo que sigue se ha ejecutado todavía: a fecha de este documento **no existe stack, ni Lambda, ni URL** — la Fase 03 entrega el `template.yaml` validado en seco. Los valores entre `<>` son placeholders; los secretos **nunca** se escriben en el repo ni en un comando tecleado con su valor literal (I4).

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
| `sam` (AWS SAM CLI) | — | **no instalada**: no la necesita ninguna compuerta. La instala el runner de la pipeline en **Fase 04** (D-42: `deploy.yml` es el ejecutor; localmente sigue sin hacer falta) |
| `aws` (AWS CLI) | — | **no instalada**: solo haría falta para las lecturas de premisas de §5 y para la limpieza de §4. Puede pedirse en **Fase 04** para las lecturas de §5 (o aportarse las evidencias por consola), con credenciales del usuario, nunca con valores en el repo |
| `@mermaid-js/mermaid-cli` 12.2.0 | devDependency de pnpm (D-33/D-41) | para exportar los `.svg` de `diagrams/`; nada que ver con el despliegue |

### Árbol plano del artefacto (spike D-31, local y sin nube)

El artefacto Lambda no puede llevar symlinks (pnpm los usa por defecto; D-30 riesgo 1). La verificación se hace en seco, con el árbol de producción:

```bash
pnpm install --frozen-lockfile --prod --config.nodeLinker=hoisted
```

```powershell
Get-ChildItem node_modules -Recurse -Attributes ReparsePoint | Measure-Object   # esperado: 0
```

La evidencia (cero symlinks/junctions y tamaño del zip frente al límite de 50 MB directo) se registra en `docs/specs/03-iac/tasks.md` T-06 y cierra la fila D-31 de `DECISIONS.md`. El empaquetado real **no usa `sam build`** (D-31): `CodeUri: ./` apunta al árbol del repo — y aquí vive un hazard documentado en §2.5 abajo (`.gitignore` + el filtrado de `sam package`).

### 2.5 Hazard del empaquetado — precondición del pipeline de **Fase 04** (corrección D3, revisión fresh-eyes 2026-11-20; D-42)

`sam package`/`sam deploy` aplican las reglas de **`.gitignore`** al comprimir el `CodeUri`. Como `.gitignore` contiene `node_modules/`, la receta ingenua puede producir un ZIP **sin dependencias** (la Lambda arrancaría con `ERR_MODULE_NOT_FOUND: express`) — o, al revés, sin filtrado, llevarse devDeps y `.bin` dentro. Regla determinista para F08 (ninguna se ejecuta hoy):

1. **Staging explícito**: preparar `dist/lambda/` con `src/`, `package.json` y el `node_modules` **plano de producción** (`pnpm install --prod --frozen-lockfile --config.nodeLinker=hoisted` en dir limpio, copiado después) — nada de symlinks (spike D-31).
2. **`.samignore`** en la raíz (fichero por defecto: los ignores de git; contenido explícito: incluir `node_modules`, excluir `dist/`, `tests/`, `docs/`, `.env*`, `*.md`) **o** `CodeUri` apuntando al staging con el mismo `.samignore`. La elección exacta se propone con el workflow (D-25) y su visto.
3. **Verificación antes del deploy** (obligatoria, solo lectura): listar el ZIP generado y comprobar (a) presencia de `node_modules/express` y `serverless-http`, (b) ausencia de devDeps/`.bin`/`.env`, (c) tamaño coherente con la spike (~1 MB). Sin ese check, no se propone el deploy.

### 2.6 Colisión del nombre físico (riesgo D4 anotado aquí y en spec §8)

`FunctionName: TicketApiFunction` está fijado a propósito (determinismo del log group y del ARN literal del rol, §3). Consecuencias que el operador debe conocer: (a) un **segundo stack** en la misma cuenta+región que reutilice esta plantilla **colisiona** — el repo-hijo del bot (D-38) debe usar nombres propios; (b) un `sam delete` interrumpido puede dejar la función o el log group huérfanos y hacer fallar el recreate (mitigación: `get-function`/`list-functions` de solo lectura antes de recrear, y borrar el stack completo en vez de recursos sueltos); (c) si esto molestara en F08, la alternativa limpia es `!Sub "${AWS::StackName}-TicketApiFunction"` reconstruyendo igual el ARN de logs — enmienda registrada entonces, con visto.

## 2. Despliegue real — **Fase 04, vía pipeline** (D-42; propuesta documentada; no ejecutada)

Nada de este bloque se ha corrido. Con el reorder pipelines-first (**D-42**) entra en vigor en la **Fase 04** y su ejecutor es `deploy.yml` en GitHub Actions — nunca un comando tecleado en local; el visto del usuario se materializa como **aprobación del entorno `Production`** (D-43/OIDC). La estrategia de CI/CD sigue siendo la fila **D-25** (se resuelve en esa fase); el `setWebhook` real se movió a la **Fase 09**.

Los secretos viajan **solo como nombres de variables de GitHub Actions** — nunca con su valor en un archivo del repo ni en la salida del log (I4/D-17). Cada nombre de la izquierda es el `Parameter` del `template.yaml` (con `NoEcho: true`); el de la derecha, el secreto de GitHub:

- `TelegramBotTokenParam`  ← secreto `TELEGRAM_BOT_TOKEN`
- `AdminApiKeyParam`       ← secreto `ADMIN_API_KEY`
- `WebhookSecretParam`     ← secreto `TELEGRAM_WEBHOOK_SECRET`
- credenciales de despliegue: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (recomendable rol asumible, no clave raíz)

Forma de los comandos (placeholders; en la máquina local se leen del entorno, en CI de los secretos):

```bash
# 1) empaquetar el artefacto (árbol plano de producción, D-31)
sam package --template-file template.yaml --s3-bucket <BUCKET_DE_DESPLEGUE> \
            --output-template-file packaged.yaml --region us-east-1

# 2) crear/actualizar el stack: 5 recursos, un solo rol, una sola región
sam deploy --template-file packaged.yaml --stack-name <NOMBRE_DEL_STACK> --region us-east-1 \
           --capabilities CAPABILITY_IAM \
           --parameter-overrides TelegramBotTokenParam="$env:TELEGRAM_BOT_TOKEN" \
                                 AdminApiKeyParam="$env:ADMIN_API_KEY" \
                                 WebhookSecretParam="$env:TELEGRAM_WEBHOOK_SECRET"
```

`--capabilities CAPABILITY_IAM` es obligatorio porque la plantilla crea el rol de D-24; es la señalización explícita de que CloudFormation asume una política IAM, no un bypass. `sam build` no aparece: está fuera de las compuertas y denegado al devops (D-31/D-12).

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

## 4. Limpieza al borrar la Function URL (resource policy huérfana)

Aviso ya consignado en la Fase 00 §10a y en el riesgo 3 de D-27: una Function URL con `AuthType: NONE` añade a la Lambda una **resource-based policy** propia. Si se borra la URL (o la función) **por fuera** de CloudFormation, esa política **sobrevive huérfana**: es un permiso vivo que ya no describe nada y puede bloquear la creación de una URL nueva sobre la misma función.

Comprobación (solo lectura) y limpieza (acción externa: **con visto del usuario**, I6):

```bash
aws lambda get-policy --function-name <NOMBRE_DE_LA_FUNCION> --region us-east-1
aws lambda remove-permission --function-name <NOMBRE_DE_LA_FUNCION> \
                             --statement-id <ID_DEL_STATEMENT_DE_LA_URL> --region us-east-1
```

Notas operativas:

- El `statement-id` real de la política sale de la lectura `aws lambda get-policy` (CFN lo genera al no fijarse `StatementId` en la plantilla; en F08 puede fijarse `TicketApiUrlInvoke` explícito como cambio de plantilla con visto). La limpieza de §4 se hace SIEMPRE contra el id leído, nunca adivinándolo.
- **Borrando el stack completo no queda residuo**: la URL y su política pertenecen al stack y se eliminan con él. El problema aparece al quitar solo el recurso `UrlConfig`, al importar recursos a mano o al recrear la función con el mismo nombre.
- El grupo de logs es recurso **explícito** de la plantilla con `RetentionInDays: 30` (spec §4.1) — por eso la función no necesita `logs:CreateLogGroup` (D-24) y no deja grupo sin retención tras el borrado.
- La tabla `TicketsTable` **sí** se borra con el stack: si contiene tickets reales, exportar/confirmar antes de cualquier `sam delete` o `DeleteStack`. Ningún borrado de tabla forma parte de una compuerta (D-12).

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

Si alguna premisa resulta **falsa**, el camino no es subir capacidad ni cambiar la tabla a `PAY_PER_REQUEST` por iniciativa propia: es decisión registrada + OK explícito del usuario (vía de escape de D-26, fila D-29 de pendientes).

## 6. Qué falta para que este runbook esté completo (sección pipeline en F04; cierre en F09)

La compuerta de Fase 09 exige el runbook completo (AGENTS §4, numeración post-D-42). Al aterrizar F04 se añade la sección de la pipeline (despliegue/prune ejecutados por Actions); al aterrizar F09, con comandos exactos y placeholders:

1. **`setWebhook`** — el `curl` real con `<FUNCTION_URL>`, `<TELEGRAM_BOT_TOKEN>` y el mismo `<TELEGRAM_WEBHOOK_SECRET>` que la variable de entorno (si difieren, todo el webhook falla en silencio con `403`; riesgo anotado en D-21). Su forma ya está adelantada en el `README.md` de la raíz.
2. **Rotación** de `ADMIN_API_KEY` y `TELEGRAM_WEBHOOK_SECRET` (`--parameter-overrides` sobre el stack existente + re-`setWebhook` cuando cambie el secreto).
3. **Rollback**: redeploy del `packaged.yaml` anterior o `sam deploy` al último estado conocido, y qué se hace con la tabla y con la resource policy (§4).
4. **Prueba E2E documentada** del flujo completo: mensaje al bot → ticket `PENDING` → lectura del panel → `reply` → `RESOLVED`.

Mientras eso no exista, este documento describe **cómo se valida y cómo se desplegará**, no un sistema en producción: hoy no hay nada que operar.
