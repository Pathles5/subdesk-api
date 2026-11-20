# Spec — Fase 04 · Pipeline de despliegue + primer apilado (app stub) + prune

Estado de fase: **spec** (ver `docs/specs/INDEX.md`)
Dependencias: F02 `verified` (app stub con seguridad real), F03 `verified` (template lint-clean), D-42 (reorder pipelines-first, visto del usuario 2026-11-20), D-43 (OIDC, visto del usuario 2026-11-20).
Compuerta (§4 AGENTS renumerado): las 6 compuertas previas + workflow verde en `main` + **stack creado exclusivamente por la pipeline** + las 4 premisas I2 evidenciadas + URL pública real respondiendo 401/403/501/404. El «visto del usuario» de esta fase se materializa tres veces y de forma auditable: (1) visto a la propuesta (D-07), (2) bootstrap de OIDC en su consola (no delegable), (3) **aprobación del environment `Production`** en el primer `deploy.yml` (eso ES I6 ejecutándose).

## 1. Objetivo

Que AWS solo se toque desde GitHub Actions, para siempre:
1. `deploy.yml` — compuertas → empaquetado determinista (runbook §2.5, con verificación del ZIP) → `sam deploy` vía OIDC → smoke contra la URL viva.
2. `prune.yml` — borrado del stack por `workflow_dispatch` con doble confirmación (aprobación del environment + input explícito de destrucción de tabla).
3. Primer apilado real: el stack de F03 con la **app stub** de F02 corriendo en producción dev (`STAGE: dev`). Coste esperado: $0 (franquicias; Function URL y Permission no facturan; Actions dentro del free de GitHub).
4. Cerrar aquí las **premisas C8** de F03 (Function URL en us-east-1, `nodejs22.x`, franquicia 25/25, alerta $0, Paid).

## 2. Alcance

- `.github/workflows/deploy.yml` + `prune.yml` + `.samignore` + `scripts/package-lambda.mjs` (staging determinista) + `scripts/smoke-live.mjs` (ejecuta los 15 escenarios de la colección Postman contra la URL real, espera la "era hoy" del stub: 403/501/401/404).
- Bootstrap OIDC documentado con JSON exacto (provider + `SubDeskCiDeployRole` con la condición de repo/environment) — **lo ejecuta el usuario en su consola**, es lectura/creación manual fuera del repo.
- GitHub: environment `Production` (required reviewers = el usuario), secretos de entorno (`TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `AWS_REGION=us-east-1`), variables del workflow (stack name, bucket de artefactos SAM creado por el propio primer deploy — `sam deploy` gestiona el ECR/S3 gestionado, <$0.01/mes ya aceptado en D-15).
- D-25 se resuelve aquí (estrategia CI/CD: la de esta spec), con el `setWebhook` excluido (va a F09).
- Docs I8: `runbook.md` §2 pasa de "propuesta" a realidad ejecutada (comandos reales de la pipeline), `operations.md` (la pipeline como ejecutor), README (tabla de fases + URL final una vez desplegada), CHANGELOG.

## 3. Fuera de alcance

- `setWebhook`, E2E con bot real, rotación (F09). Negocio (F05–F08).
- Deploys por PR (el stack es uno; el entorno de preproducción con segundo stack está explícitamente fuera de I1/I2).
- Terrafom/Pulumi/otro CI. Claves de largo vivir (prohibidas por D-43).

## 4. Diseño de la pipeline (resolución propuesta de D-25)

```
 push main / workflow_dispatch
        │
        ▼
 [verify]  pnpm install --frozen-lockfile · lint · test 27/27 · validate:api · validate:iac (pip install cfn-lint) · check.ps1 (pwsh)
        │
        ▼
 [package] node 22.x · pnpm install --prod --config.nodeLinker=hoisted en dir limpio → staging dist/lambda/ (src + package.json + node_modules plano)
        │   scripts/package-lambda.mjs → artifact.zip + ASSERTS del contenido:
        │     ✓ node_modules/express/package.json presente   ✓ serverless-http presente
        │     ✗ .env / devDeps / tests / docs (lista negra explícita, no relies-on-gitignore)
        ▼
 [deploy]  environment: Production (APROBACIÓN MANUAL = visto I6) · OIDC (aws-actions/configure-aws-credentials @v4, role-to-assume=AWS_ROLE_ARN, aud=sts, ref main)
        │   aws-actions/setup-sam@v3 · sam deploy --guided-off (--no-fail-on-empty-changeset, --fail-on-changesets? se decide: --no-fail-on-empty-changeset, idempotente)
        │   --parameter-overrides TelegramBotTokenParam=… AdminApiKeyParam=… WebhookSecretParam=… (desde secrets del environment, nunca echo)
        ▼
 [smoke]   describe-stacks → FunctionUrl → node scripts/smoke-live.mjs (los 15 casos de la colección contra internet de verdad, esperando la era-stub: 403/501/401/404/200-ignorado-no-aplica-aún)
```

- **Disparador**: `push: main` + `workflow_dispatch`. Cada merge a main reapila (el stack dev es la fuente de verdad continua; rollback = revert commit + pipeline). Sin deploys por PR (I2: un solo stack).
- **Idempotencia**: `--no-fail-on-empty-changeset`; el `FunctionName` fijo ya no asusta porque **un único ejecutor** existe (D-42 disuelve el riesgo D4 de F03: nadie más puede crear el stack).
- **Prune**: `prune.yml` = dispatch + environment Production (aprobación) + `confirm: "destruyo-ticketstabla-con-datos"` input exacto; ejecuta `sam delete --stack-name <stack>`; documentado con el caveat de la resource policy (runbook §4).
- **Premisas C8** (job `premises`, solo cuando el stack no existe): `aws lambda list-versions-by-function` post-deploy confirma runtime; Function URL en la región se demuestra con el propio deploy exitoso; franqicia + Paid + alerta $0: checklist que el usuario verifica en consola **antes** de aprobar el primer deploy (pantallazos a la prueba de la fase; la alerta $0 se pide crearla antes del apilado — es su detector).

## 5. Decisiones de seguridad de la pipeline (vinculantes)

1. El rol OIDC `SubDeskCiDeployRole` lleva la **condición** `repo:Pathles5/subdesk-api:environment:Production` en el trust (no `ref` suelto) — sin entorno aprobado, no hay credenciales.
2. Sus permisos: exactos del §5 de la spec (CloudFormation stack `subdesk-api*`, IAM con `PathPrefix=/subdesk-api/` + PassRole solo al rol de la app, S3 al bucket SAM, Lambda/Table/Logs al prefijo del stack). Cero `Resource: "*"` en el propio rol de CI (lo audita `check.ps1` leyendo el JSON publicado en este repo; **el JSON definitivo y auditado está en `docs/specs/04-pipeline/bootstrap-oidc.md` §2** — prefijos `subdesk-api-dev-*` por ser el nombre de stack resuelto en D-25; PassRole además condicionado a `PassedToService=lambda`).
3. Ningún workflow usa `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (assert en `check.ps1`: grep de esos nombres en `.github/**` fuera de `configure-aws-credentials@v4` con `role-to-assume`).
4. Los secretos de la app viven solo en el environment `Production`; `echo::none` en el log del deploy.
5. Dependabot: **no** en esta fase (superficie nueva; se propone con decisión en F09).

## 6. Criterios de aceptación

- **C1** — `deploy.yml` verde en `main` tras la aprobación manual del usuario; stack creado; `smoke` pasó los 15/15 casos contra la URL real (salidas en `tasks.md`).
- **C2** — `prune.yml` probado en seco (validación de sintaxis + permisos; **ejecución real solo** cuando el usuario decida demoler, con su aprobación también visible).
- **C3** — Las 4 premisas C8 evidenciadas en `tasks.md` (runtime/URL por el propio deploy; franquicia/Paid/alerta por pantalla del usuario, con fecha).
- **C4** — Los asserts de seguridad de §5 verificados: grep de claves en workflows = 0; trust con condición documentado; `check.ps1` con sus asserts nuevos de CI (bloque existente de hygiene ampliado, no reescribe el resto).
- **C5** — Cero acciones AWS desde local ejecutadas en toda la fase (I6 ampliado D-42) — verificable en el registro de la fase.
- **C6** — Docs: runbook §2 realidad, operations, README con la URL final, CHANGELOG `0.1.0 — Fase 04 (primer apilado)`.
- **C7** — Compuertas completas 7/7 (las 6 previas + esta fase smoke real).

## 7. Riesgos

1. El primer apilado **usa secretos reales** del environment: si el usuario elige un `TELEGRAM_BOT_TOKEN` inventado para la stub, nada funciona mal — la app stub no llama a Telegram; se anota qué valor se usó (nombre, no valor) para re-deployar con el del bot futuro en F09.
2. Coste de Actions: runner ubuntu 22.04 dentro de las 2.000 min/mes del plan gratuito; el workflow < 10 min por ejecutor. $0.
3. `sam deploy` crea el bucket `aws-sam-cli-managed-default` (S3, ~$0.0002/mes) — ya aceptado en D-15; la cuenta Paid lo factura céntimos si la franquicia S3 no cubriera (riesgo ínfimo, anotado).
4. El ZIP-check protege del hazard D3 (F03); el hazard D4 (colisión) queda neutralizado por el ejecutor único.
5. Si el usuario rechaza la aprobación del environment, el push queda sin desplegar: correcto por diseño (el merge no es deploy hasta que él aprueba).

## 8. Amendments

(ninguna aún)
