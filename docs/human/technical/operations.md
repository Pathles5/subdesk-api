# Operaciones — SubDesk API

Actualizado: fase 04 · 2026-11-22

> Documento para **levantar y comprobar el proyecto en local**. La topología y las reglas de capas están en `architecture.md`; el contrato es `docs/api/openapi.yaml`; las decisiones con su historia, en `DECISIONS.md` (se enlazan por ID). Despliegue, prune, `setWebhook`, rotación y coste: `docs/human/runbook.md` — **la sección de la pipeline ya está escrita** (Fase 04: §2 con el modelo de visto D-48, §4.1 con el prune); el runbook completo cierra en la 09 (D-42).

## Arranque local

```bash
cp .env.example .env          # edítalo con TUS valores; .env NUNCA se commitea
pnpm install --frozen-lockfile
pnpm run dev                  # node --env-file=.env src/local.js
```

La app escucha en `http://localhost:3000` (`PORT` en `.env`, default 3000; es la única variable local del contrato D-17). `src/config.js` es quien lee el entorno: si falta alguna de las cuatro obligatorias (`TABLE_NAME`, `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`) el arranque falla con un `ConfigError` que **lista nombres, nunca valores** (I4). `LOG_LEVEL` (default `info`), `STAGE` (default `dev`) y `PORT` admiten ausencia.

**Es la misma aplicación que corre en Lambda.** `src/local.js` hace `app.listen()` sobre `createApp()`; `src/lambda.js` pasa ese mismo árbol por el adaptador `serverless-http@3.2.0` (D-28). El adaptador **solo** se importa ahí — ESLint lo prohíbe en cualquier otro archivo —, así que lo que pruebas en local es lo que se despliega, menos el envoltorio del evento.

No hay comando `deploy` ni nada que toque AWS desde este repo en local: **la pipeline es el único ejecutor de AWS** (D-42) — desde aquí solo validación estática y lecturas. El visto no es una aprobación dentro de Actions (**D-48**: el environment `dev` no tiene *required reviewers*): es **la acción que arranca el workflow**, el push a `main` que el orquestador solo ejecuta con tu autorización explícita. Consecuencia escrita de ese modelo: **todo push a `main` despliega**, incluidos los commits de solo docs. Despliegue y prune: `docs/human/runbook.md` §2 y §4.1.

## Compuertas y qué prueba cada una

| Comando | Qué comprueba | Estado en esta fase |
|---|---|---|
| `pnpm install --frozen-lockfile` | dependencias reproducibles contra `pnpm-lock.yaml`, **sin ejecutar scripts de dependencias** (I4b/D-30); `allowBuilds` solo admite la excepción registrada en **D-41** (`puppeteer`, `@puppeteer/browsers`) — cualquier entrada extra es fallo de `check.ps1` | ✓ |
| `pnpm run lint` | ESLint flat config sobre `src/` + `tests/`. No es solo estilo: **mecaniza la arquitectura** (spec §7) — `process.env` solo en `src/config.js` (D-17) y `serverless-http` solo en `src/lambda.js` (D-28). `@aws-sdk/*` está vetado en `src/**`, con el override en `src/repositories/**` **reservado para la Fase 04** (hoy no permite nada porque `repositories/` todavía no tiene archivos), y los tests siguen exentos de las restricciones de import | ✓ |
| `pnpm test` | `node --test "tests/**/*.test.js"` → **29 tests**: unidades de `apiKey` (401/403), `webhookGuard` (gate de secreto y ack), `config` (las 7 variables, errores sin valores), smoke de la app con `supertest` (los 4 endpoints como stub `501`, `404`, `403` de secreto y `400` de JSON malformado), el **test de contrato de superficie** y — desde la enmienda A-01 de la spec 04 — `tests/pipeline/workflows-syntax.test.js`, que parsea **todos** los `.github/workflows/*.yml` y `pnpm-workspace.yaml` (el YAML inválido que mató el run #1 en 0 s no puede volver a colar) | ✓ 29/29 (evidencia en runner real: job `verify` del run #2, 2026-11-22) |
| `pnpm run validate:api` | `redocly lint docs/api/openapi.yaml` (D-33). Rompe solo con **errores**; hoy pasa con 1 warning deliberado y aceptado: `info-license` (no tenemos licencia que citar) | ✓ |
| `pnpm run validate:iac` | `cfn-lint template.yaml` (D-31): esquema, tipos y propiedades del transform SAM **offline, sin credenciales y sin ejecutar scripts de dependencias**. Nació en la Fase 03 con el `template.yaml`; `sam build`/`sam validate` **no** son compuerta. Requiere tener en el PATH de usuario el `Scripts` de pip donde quedó `cfn-lint` (nota debajo) | exit 0 desde el cierre de la Fase 03; en CI lo repite el job `verify` (runner real, run #2 2026-11-22) |
| `pnpm run check` | `scripts/check.ps1`: compuerta del harness — frescura de `docs/human/**` (I8), higiene de secretos, asserts de cadena de suministro (I7), forma del contrato, **asserts de IaC sobre el `template.yaml`** y el bloque CI/CD (T-06): cero access keys en `.github/**`, `role-to-assume` + `id-token: write` exigidos a `aws-actions/configure-aws-credentials`, `sam build` → FAIL, y **`environment:` obligatorio a nivel de JOB** en todo job que contenga `sam deploy|package|delete`, `create-change-set`, `execute-change-set`, `delete-stack` o `cloudformation deploy`, **descartando líneas de comentario** (enmienda A-03: un comentario ya no puede «aprobar» el gate) | ✓ en runner real (job `verify` del run #2, 2026-11-22). El assert por job se probó **no-vacío** con dos workflows sintéticos: ambos `[FAIL]` (uno sin `environment:`, otro con `environment:` en un job que no despliega) y los reales `[PASS]` |
| smoke manual en dev | los 5 casos de abajo contra `pnpm run dev`, con `curl` | ver siguiente bloque |

### La herramienta fuera de pnpm: `cfn-lint`

`cfn-lint` es una herramienta Python, no un paquete de Node, así que **no** entra en `package.json` ni en `pnpm-lock.yaml`: se instala en el entorno del desarrollador y el script `validate:iac` solo la invoca. Estado de esta máquina: **`cfn-lint` 1.61.0**, instalado con `python -m pip install --user cfn-lint` (OSS, sin cuentas, sin coste: I2), con el visto explícito del usuario del 2026-11-20. El ejecutable queda en `%APPDATA%\Python\Python313\Scripts`, que debe estar en el **PATH de usuario**; si no lo está, el fallo es «`cfn-lint` no se reconoce como comando», no un error de la plantilla. Se comprueba con `cfn-lint --version`.

`sam` y `aws` **sí están instalados en la máquina del dev** (2026-11-22): `aws` → `%LOCALAPPDATA%\Programs\Amazon\AWSCLIV2`, `sam` → `C:\Program Files\Amazon\AWSSAMCLI\bin`, `gh` → `C:\Program Files\GitHub CLI` (login verificado, scopes repo+workflow). Ojo: **el host de sesión de este agente arrancó antes de esas instalaciones/actualizaciones de PATH y no las ve**; workaround en cada comando: anteponer `$env:Path += ";C:\Program Files\GitHub CLI;C:\Users\34670\AppData\Local\Programs\Amazon\AWSCLIV2;C:\Program Files\Amazon\AWSSAMCLI\bin"`. En terminales nuevos del usuario funcionan directo. Ninguna compuerta local los necesita (D-42: AWS solo por pipeline); `gh` se usa para SEGUIR runs (leer Actions), y `aws`/`sam` locales podrían servir para lecturas de premisas C8 si el usuario las autoriza — antes se pedía pantallazo por no existir; ya no es necesario.

### Pre-vuelo de IAM sin desplegar: `simulate-principal-policy`

`aws iam simulate-principal-policy` es **solo simulación** (no crea ni muta nada: D-42 intacto) y es la forma honesta de verificar una policy antes de gastar un run. Nota de esquema, que la documentación genérica no aclara y costó dos intentos en vivo: la respuesta **no** trae `EvaluationResult` ni `EvaluationDetails[]` — es **`EvaluationResults[]`** con `{EvalActionName, EvalDecision, MissingContextValues}` — y el bloque de contexto usa **`ContextKeyName` / `ContextKeyValues` / `ContextKeyType`**, no `Key`/`ValueLists`. Con la forma equivocada el comando responde `[FAIL]` o `None`, que es un error de invocación, **no** un deny de IAM.

### Despliegue y estado del environment `dev` (se verifica por API, no por pantalla)

**D-42 sigue intacto:** `sam` y `aws` locales no son vía de despliegue. Desde esta máquina **cero escrituras en AWS** — nada de `sam deploy`, `sam package`, `sam delete` ni `aws cloudformation *` que muten; la pipeline (`deploy.yml` / `prune.yml`) es el único ejecutor. Las lecturas (`get-role`, `get-role-policy`, `describe-stacks`, `gh api`) sí se usan, con el visto del usuario, para evidenciar el estado.

- **El visto es el push (D-48).** No hay aprobación manual en Actions: el environment `dev` **no tiene *required reviewers* y no se van a poner**, así que un run jamás queda en *Waiting*. Lo que autoriza un despliegue es el push a `main` que el orquestador solo ejecuta con tu OK previo. Efecto asumido: **todo push a `main` despliega, incluidos commits de solo docs**.
- **Por qué `environment: dev` se declara igualmente** en los jobs que mutean AWS: scopea los secretos y produce el claim OIDC `sub = repo:Pathles5/subdesk-api:environment:dev` que exige el trust de `SubDeskCiDeployRole` — sin él no hay credenciales (fail-closed, D-43). `pnpm run check` lo exige ahora **a nivel de job** (A-03).
- **Cómo se comprueba el environment (la única forma honesta).** Los secretos son **write-only** y las reglas de protección no se ven hasta que se guardan, así que el environment se declara listo **por API y con salida copiada**, nunca por captura de pantalla. El bloque de comandos exactos —PUT del environment, POST de la política de rama con `{name, type}`, re-pegado del rol y las tres lecturas de verificación— vive en **`docs/specs/04-pipeline/bootstrap-oidc.md` §7b** (no se duplica aquí). Estado obtenido el 2026-11-22: `protection_rules: ["branch_policy"]`, rama única `main` (id 67773148), `can_admins_bypass: false`, 6 secretos presentes y `AWS_ROLE_ARN` re-escrito a las 12:17:16Z con el ARN `arn:aws:iam::159177056493:role/SubDeskCiDeployRole`.
- **Dos trampas del esquema** (detalladas en §7b, aquí solo para no repetirlas): el POST de la política de rama **no** acepta el bloque `deployment_branch_policy` (422), y hacer el PUT **antes** de crear la política deja el environment con cero ramas permitidas = ningún deploy puede usar `dev`.
- **Estado del pre-requisito del run #3:** la policy A-03.3 del rol de CI **ya está aplicada y re-leída en AWS** (`logs:*` de creación/retención/tag/borrado, `lambda:TagResource`/`ListTags`, `s3:PutBucketTagging`, `ListStacks` fuera, `PassRole` con `iam:PassedToService`) y auditada antes de escribir con `aws iam simulate-principal-policy`: **22/22 `allowed`** sobre las formas reales de ARN, con dos negativos de menor privilegio (`PassRole` sin context key y `PassRole` fuera de `subdesk-api-dev-*` → `implicitDeny`). Lo aplicó el orquestador con visto puntual del usuario (**D-49**, excepción única: es la política del rol de CI, no estado de la app; **no abre precedente** — cualquier otro `aws` de escritura local sigue prohibido por I6/D-42). **El único paso que falta para el run #3 es el push a `main` autorizado**: bajo D-48 ese push *es* el visto I6, no hay *Waiting* que esperar.

Levantada la app con `pnpm run dev`, estos son los cinco casos que se comprobaron en la Fase 02 — `401` · `501` · `403` · `501` · `404`, con los envelopes exactos del contrato. Sustituye los placeholders por tus valores locales:

```bash
# 1) /api/tickets SIN x-api-key -> 401 UNAUTHORIZED
curl -i http://localhost:3000/api/tickets

# 2) /api/tickets con clave válida -> 501 (stub de andamiaje; la clave SÍ pasó el gate)
curl -i -H "x-api-key: <ADMIN_API_KEY>" http://localhost:3000/api/tickets

# 3) webhook con secreto inválido o ausente -> 403 FORBIDDEN (único no-2xx del webhook, D-21/D-36)
curl -i -X POST -H "X-Telegram-Bot-Api-Secret-Token: equivocado" \
  -H "Content-Type: application/json" -d '{"update_id":1}' \
  http://localhost:3000/webhook/telegram

# 4) webhook con secreto válido -> 501 (el handler de ingesta aterriza en la Fase 05 actual;
#    el literal del stub dice "Fase 4" porque el código conserva la numeración pre-D-42)
curl -i -X POST -H "X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" -d '{"update_id":1}' \
  http://localhost:3000/webhook/telegram

# 5) ruta inexistente -> 404 con envelope (nunca el HTML por defecto de Express)
curl -i http://localhost:3000/no-existe
```

Dos casos más cubiertos por `pnpm test` pero que conviene ver una vez a mano: `x-api-key` presente pero **incorrecta** → `403 FORBIDDEN` (`invalid api key`), y un cuerpo que no parsea en `/api/*` → `400 VALIDATION_ERROR` (nunca `500`). En el webhook, en cambio, un cuerpo que no parsea **sí** se absorbe como `200 {"ignored":"internal_error"}`: Telegram nunca debe reintentar (I5).

## Estado actual del servicio

Los **4 endpoints responden `501`** con el envelope cerrado de error:

```json
{ "error": { "code": "INTERNAL", "message": "not implemented yet — Fase 5" } }
```

El número de fase del mensaje dice quién sustituye ese stub: 4 = `POST /webhook/telegram`, 5 = `GET /api/tickets`, 6 = `PATCH /api/tickets/{id}`, 7 = `POST /api/tickets/{id}/reply`. El `501` es **estado de andamiaje, no contrato** (spec §4b): el contrato congelado de Fase 01 no lo incluye.

Ya es definitivo y no cambia en las fases siguientes:

- los dos **middlewares de seguridad** (`apiKey`, `webhookGuard`) y sus códigos `401`/`403`;
- la **superficie** de rutas y métodos, vigilada por `src/routes/registry.js` contra `docs/api/openapi.yaml`;
- el **envelope** de error `{ "error": { "code", "message" } }` y el `404` de ruta inexistente.

Qué significa cada `401`/`403` que ya puedes ver hoy:

| Respuesta | Causa | Qué hacer |
|---|---|---|
| `401 UNAUTHORIZED` — `missing x-api-key header` | la petición no trae `x-api-key` (o viene vacía) | añade la cabecera con tu `ADMIN_API_KEY` |
| `403 FORBIDDEN` — `invalid api key` | la cabecera llega pero **no** coincide con `ADMIN_API_KEY` | revisa el valor en `.env` / en el stack; se compara con `timingSafeEqual` sobre digestos SHA-256, así que ni una diferencia de longitud pasa |
| `403 FORBIDDEN` — `invalid webhook secret` | falta `X-Telegram-Bot-Api-Secret-Token` o difiere de `TELEGRAM_WEBHOOK_SECRET` | el secreto registrado con `setWebhook` debe ser **el mismo** que el de la variable de entorno (runbook, Fase 09); si no lo es, todo el webhook falla en silencio con 403 (riesgo anotado en D-21) |
| `501 INTERNAL` — `not implemented yet — Fase N` | el andamiaje aún no tiene handler | espera a la fase indicada; no es un fallo |

## Política de logs aplicada (D-18)

**Un evento JSON por línea**: `{ "level", "ts", "msg", ...campos del evento }`. Los campos esperados son los del allowlist de D-18 (`ticketId`, `updateId`, `statusCode`, `durationMs`) más identificadores operativos; nunca se serializa `req.body` ni una cabecera.

La redacción es **por construcción**, no una promesa: `src/utils/logger.js` mantiene la lista de nombres prohibidos (`botToken`, `telegramBotToken`, `adminApiKey`, `apiKey`, `webhookSecret`, `messageContent`, `text`, `x-api-key`) y, al encontrarlos, escribe `"[redacted]"` y, si el valor era un string, su **longitud** en `<campo>Length`. Así no depende de que el programador recuerde no loguear el token: aunque lo intente, no sale (I4).

- `LOG_LEVEL=silent` existe y está testiado como valor válido: no emite nada. Sirve para correr suites o herramientas sin ensuciar la salida (en el smoke de tests alguna línea `error` sí aparece, porque el guard del webhook registra sus fallos — no es un fallo del test).
- El `webhookGuard` loguea con un logger propio de umbral `info`, para que un error del webhook sea visible aunque el entorno esté en `error`.
- La **retención ≤ 30 días** es propiedad del `LogsGroup` explícito de la plantilla (`RetentionInDays: 30`, spec §4.1 de Fase 03; por eso el rol de D-24 no necesita `logs:CreateLogGroup`). Dónde se lee y qué hay que limpiar al borrar la Function URL: `docs/human/runbook.md` §3 y §4. Los límites de plataforma (30 s de invocación, 6 MB de payload) están en `functional/api.md`.

## Cuarentena de dependencias (`minimumReleaseAge: 1440`)

Es una **política de cadena de suministro**, no una preferencia: pnpm rechaza resolver cualquier versión publicada en las últimas 24 horas (D-30, I4b). El motivo es el historial que justifica todo el apartado: paquetes comprometidos en el registro público el mismo día de su publicación.

Qué hizo ayer en este repo: `@redocly/cli` **2.82.0** se había publicado esa misma mañana y la cuarentena **bloqueó la instalación**. La respuesta fue bajar a `2.81.0` (ya cuarentenada), **no** tocar la política.

Si algún día hace falta eximir un paquete (por ejemplo un fix de seguridad urgente que solo exista en una versión recién publicada), **no es un ajuste local**: exige decisión registrada en `DECISIONS.md` con nombre, versión, motivo **y tu OK explícito**, aplicando `minimumReleaseAgeExclude` solo a ese paquete — nunca global (riesgo 2 de D-30). Lo mismo aplica a `allowBuilds`, `pnpmfile` o `patchedDependencies`.

Ya hay un precedente de ese trámite con `allowBuilds`: **D-41** (visto del usuario 2026-11-20) registró la única excepción activa, `puppeteer` y `@puppeteer/browsers`, porque `@mermaid-js/mermaid-cli` baja Chromium en su postinstall y el gate de Fase 03 exige los `.svg` sin CDN (I8d). Son devDependencies: no viajan al artefacto Lambda (el empaquetado corre con `pnpm install --prod`). `check.ps1` sigue fallando ante **cualquier** entrada adicional.
