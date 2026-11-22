# Constitución — SubDesk API

Inmutables del proyecto. Ninguna spec ni implementación puede contradecir esto.
Si hay conflicto entre una spec y la constitución, gana la constitución y la spec se reescribe.

## I1. Alcance
- **La entrega de este repo es SOLO la API backend** (serverless, AWS): una API REST + el endpoint de ingesta por webhook. **El bot de Telegram NO forma parte de este repo ni se desarrolla aquí**: es un consumidor externo que se creará después (BotFather, identidad, conversación y UX viven fuera). El único acoplamiento entre el bot y esta API son el `TELEGRAM_BOT_TOKEN`, el secreto del webhook y la URL que se registrará con `setWebhook` (Fase 09, post-D-42).
- Un solo bot consumidor, una sola tabla (`TicketsTable`), un solo tipo de entidad (ticket).
- Topología fijada por D-27: **un solo endpoint público** (Lambda Function URL), **una sola función Lambda** con enrutado interno (Express) y **un solo rol IAM** de aplicación. Los 4 endpoints conviven en esa función.
- No hay en la v1: frontend del panel, multi-tenancy, colas (SQS), streams, caché, autenticación de usuarios finales, comandos/botones interactivos del bot, adjuntos (foto/voz/sticker), métricas de SLA.
- No hay polling a Telegram (`getUpdates`): solo webhooks.

## I2. Coste $0 (invariante financiero, decisión D-11; redacción operativa redefinida por D-26 y D-27)
- Infraestructura AWS, CI/CD y repositorio **no pueden incurrir en ningún gasto, nunca**. La regla operativa es: **$0 dentro de franquicias *always free*, con techo de gasto conocido de antemano; el exceso se resuelve con *throttling* o con parada + reporte, nunca con facturas silenciosas.**
- Permitido (y suficiente para este proyecto):
  - **Lambda Event Functions** Node.js 20+ ESM, 128–256 MB → franquicia *always free* de 1 M peticiones + 400.000 GB-s/mes.
  - **Lambda Function URL** (`AWS::Lambda::Url` / `FunctionUrlConfig`) como entrada HTTP: *"there are no additional charges for the URL endpoint itself"* → se consume de la franquicia de Lambda (decisión D-27).
  - **DynamoDB tabla Standard, modo `PROVISIONED` ≤ 25 WCU / 25 RCU, 1 sola tabla y 1 sola región** → es *exactamente* la franquicia mensual del Free Tier, que **solo aplica al modo provisioned** ("It uses provisioned capacity"). Techo si la franquicia no aplicase: $14,04–14,24/mes, cifra fija.
  - **CloudWatch Logs** con retención ≤ 30 días y 1 evento JSON por invocación (franquicia 5 GB/mes).
  - **CloudFormation/IaC** (no factura plantillas `AWS::*`), **IAM**, GitHub Actions en repo público o dentro de la cuota del plan gratuito.
  - **pnpm** (MIT, sin cuenta ni servicio de pago) y su store local: no introducen coste (D-30).
  - Bucket S3 de artefactos del deploy (≈ $0,0002/mes a nuestro volumen; inevitable en cualquier IaC que suba un ZIP).
- **Prohibido sin aprobación explícita del usuario + registro en `DECISIONS.md`:**
  - **Capacidad provisionada > 25/25**, **auto scaling de capacidad provisionada** (Application Auto Scaling), **GSI/LSI**, **DynamoDB Streams**, **PITR**, backups on-demand, pre-warming de warm throughput, tabla `Standard-IA` sin decisión.
  - **Migrar la tabla a `PAY_PER_REQUEST`** sin decisión registrada (vía de escape prevista en D-26: se activa solo ante escalado real, con enmienda + OK del usuario).
  - **Provisioned concurrency** de Lambda (se factura por GB-s reservado) y **Lambda Web Functions** (tarifa $0,30/M con CPU activa y sin franquicia documentada al 2026-11-18).
  - API Gateway (HTTP API o REST), NAT, CloudFront, WAF, ElastiCache/DAX, colas (SQS), servicios con reserva, dominios gestionados por la infra, cualquier servicio fuera de la lista de arriba.
- **La cuenta debe estar en Paid plan**: el *Free plan* cierra la cuenta sola a los 6 meses y borra los recursos. El control de gasto de AWS **no permite un tope por debajo de $20/mes**, así que la **alerta de facturación en $0** es obligatoria y su evidencia (captura o `ce` read-only) se documenta en la spec de la Fase 03 antes del primer despliegue.
- `scripts/check.ps1` falla si esta cláusula desaparece de la constitución.

## I3. Modelo de datos y contrato
- La forma del ítem de `TicketsTable` definida en Fase 01 es **el contrato** del panel frontend y del bot: `id`, `telegram_chat_id`, `username`, `message_content`, `response_text`, `status`, `created_at`, `updated_at`, en `snake_case`, timestamps ISO 8601, `id` **UUID determinista derivada del `update_id` de Telegram (v5; D-19, enmienda de 2026-11-19 registrada en D-35 — el «v4» heredado del brief queda superado)**.
- `id` se genera en `src/utils/ids.js` como UUID v5 de `"tg:<update_id>"` usando `node:crypto` (SHA-1), sin dependencia externa (I4b): mismo `update_id` → mismo `id`, lo que con el `Put` condicional `attribute_not_exists(id)` da la idempotencia exacta del webhook (D-19). `crypto.randomUUID()` queda solo para UUIDs no deterministas.
- `status` es un enum cerrado: `PENDING` · `IN_PROGRESS` · `RESOLVED`. Valores fuera del enum → `400`, nunca escritura.
- Los contratos de los 4 endpoints (forma de éxito, errores y códigos HTTP) se documentan en Fase 01 y se congelan con la spec. Cambiarlos = enmienda + `DECISIONS.md`.
- Campos nuevos solo si la spec de la fase los justifica; no se infla el modelo.

## I4. Seguridad
- **La Function URL solo admite `AuthType: AWS_IAM | NONE`** → el recurso público se declara `NONE` y la autenticación de `/api/*` se hace **en código**, con un middleware Express que compara `x-api-key` con `ADMIN_API_KEY` **antes** de tocar DynamoDB. Sin clave o clave inválida → `401`/`403`, nunca `500`, y nunca una lectura de tabla.
- `POST /webhook/telegram` es pública (Telegram la invoca), y valida `X-Telegram-Bot-Api-Secret-Token` cuando esté configurado; el modo de validación queda decidido y documentado en Fase 01.
- **CORS en una sola fuente de verdad**: se declara **solo** en la config `Cors` de la Function URL (IaC). Está prohibido emitir cabeceras CORS desde Express o con un paquete `cors`: Lambda las duplica (`Access-Control-Allow-Origin: *, *`) y rompe el preflight. En el preflight (`OPTIONS`) manda la config de la URL. `AllowHeaders` debe incluir `x-api-key`. `*` como origen sigue siendo estado de desarrollo y exige enmienda para producción.
- **Ningún secreto en el repo**: ni tokens, ni claves, ni URLs con credenciales, ni en tests ni en documentación. Solo placeholders (`<TELEGRAM_BOT_TOKEN>`) y `.env.example`.
- **Ningún secreto en logs**: el token del bot no se imprime, no se serializa en errores y no viaja en respuestas al cliente. Los secretos viajan como **parámetros de stack con `NoEcho: true`** (IaC) y nunca literales en la plantilla.
- IAM de menor privilegio: un solo rol de aplicación con `dynamodb:GetItem|PutItem|UpdateItem|Scan` sobre el ARN de la única tabla + permisos de CloudWatch Logs. Nada de `Action: "*"`, nada de `Resource: "*"`.

### I4b. Cadena de suministro (decisión D-30; **npm queda prohibido en este repo**)
Por indicación explícita del usuario, el proyecto **no usa npm ni yarn**: **pnpm es el único gestor de paquetes**, con la versión fijada en el campo `packageManager` de `package.json` (`pnpm@x.y.z`, sin rango). Contexto que lo motiva: incidentes reales de la cadena de suministro alrededor de npm en 2025–2026 (fallo de validación del *trusted publishing* que expuso 1.500+ paquetes, `axios` comprometido el 31-mar-2026, npm 12.2.2 empaquetando `glob`/`minimatch` con advisory de octubre de 2026).

- Instalar siempre con **`pnpm install --frozen-lockfile`** (CI y toda compuerta). Prohibido `npm install|ci|update`, `npx <paquete>` (se usa `pnpm dlx`) y **commitear `package-lock.json` o `yarn.lock`**: un lockfile de otro gestor reabre la superficie que acabamos de cerrar.
- La configuración de seguridad vive en **`pnpm-workspace.yaml`** (en `.npmrc` solo quedan auth/registry/TLS): `ignoreScripts: true`, `strictDepBuilds: true`, `allowBuilds: []`, `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, `verifyStoreIntegrity: true`, `verifyDepsBeforeRun: true` y `enablePrePostScripts: false`.
- **Ningún script de ciclo de vida de una dependencia se ejecuta.** Añadir un paquete a `allowBuilds`, introducir `pnpmfile`, `patchedDependencies` o una spec exótica (`git:`, `github:`, `file:`, `tarball`, `link:`) exige **decisión registrada en `DECISIONS.md`** con nombre, versión, motivo y qué se revisó del script. No es una corrección de configuración.
- **Superficie mínima**: `dependencies` de producción lo más pequeño posible, priorizando capacidades del runtime Node 20 (`fetch` nativo en lugar de `axios`/`node-fetch`, `crypto.randomUUID()` en lugar de `uuid`). Cada dependencia nueva de runtime se justifica en `DECISIONS.md`.
- **El empaquetado no delega scripts a terceros**: `sam build` queda **excluido de las compuertas** porque AWS advierte de que ejecuta *package manager scripts* y build tools del proyecto. El artefacto Lambda se genera con pasos deterministas de pnpm/Node y **árbol plano** (`nodeLinker: hoisted` o `pnpm deploy --prod`), porque el `node_modules` por defecto de pnpm es una red de symlinks y un ZIP de Lambda **no conserva symlinks** (riesgo 3 de D-30; su cierre es la spike D-31 de Fase 03).
- CI: `pnpm/action-setup` + `actions/setup-node` con `cache: pnpm`, siempre `--frozen-lockfile`; `pnpm audit --audit-level=high` se ejecuta como paso informativo del pipeline (su salida se lee y se anota; no sustituye la revisión humana).

## I5. Comportamiento operativo
- `POST /webhook/telegram` **siempre responde 2xx**: también cuando el update se ignora (sin texto, vacío, irrelevante), para que Telegram no reintente. El error interno que no impida la ack se loguea, no se propaga como 5xx. **Única excepción de código (D-21, enmienda D-36 con OK del usuario 2026-11-19):** `X-Telegram-Bot-Api-Secret-Token` ausente o inválido → `403` — los updates legítimos de Telegram siempre llevan el secreto registrado y nunca provocan ese reintento.
- Con Express dentro de Lambda esa ack es una **obligación de la capa HTTP, no solo del handler**: la ruta del webhook va protegida por su propio *error handler* que convierte cualquier excepción —incluido un fallo de parseo de `express.json()` o un `throw` en un servicio— en `200` con cuerpo de descarte. Un `5xx` o una excepción sin capturar **fallan la invocación**, Telegram considera el update no entregado y **reintenta en bucle**, duplicando carga y tickets. Las rutas `/api/*` sí propagan `4xx`/`5xx` normales.
- Idempotencia de ingestión: un mismo `update_id` recibido dos veces no duplica tickets (decisión de mecanismo en Fase 01).
- La respuesta al usuario solo marca `RESOLVED` **si Telegram devolvió OK**. Si falla, el ticket conserva su estado y el error queda registrado.
- Ninguna operación de escritura silenciosa: toda mutación actualiza `updated_at`.
- Lecturas: `Scan` aceptado mientras el volumen sea bajo. El umbral de revisión se expresa en **items leídos (~1.000–2.000)**, no en peticiones; al cruzarlo la respuesta es **migrar a `Query`**, nunca subir la capacidad provisionada (rompería I2). El filtro `?status=` no reduce el consumo: se cobra lo **evaluado**, no lo devuelto.

## I6. Proceso (SDD + AI Harness)
- **Spec-first:** no se implementa nada sin spec previa en `docs/specs/NN-<nombre>/spec.md` con criterios de aceptación verificables.
- **Verify-after:** toda fase termina con las compuertas en verde (`scripts/check.ps1`; desde Fase 02 también `pnpm run lint` y `pnpm test`; desde Fase 03, validación de IaC **sin desplegar**).
- **Revisor fresh-eyes:** al cierre de cada fase un subagente revisor evalúa la entrega contra los criterios de la spec.
- **Decisions:** toda decisión de diseño/arquitectura queda escrita en `DECISIONS.md` (append-only, IDs `D-xx`) con opciones, elección, motivo y riesgo.
- **Nada desplegable se ejecuta sin el usuario:** `deploy`, `remove`, `setWebhook` y cualquier llamada que cree o modifique recursos reales se propone con comandos exactos y la ejecuta el orquestador solo con visto explícito del usuario.
- **La pipeline es el único ejecutor de AWS (D-42, enmienda con visto del usuario 2026-11-20):** todo cambio de estado en AWS —crear, actualizar, borrar (*prune*)— ocurre **exclusivamente** desde GitHub Actions (`deploy.yml`; `prune.yml`: disparo manual + literal exacto de destrucción, obligatorio). Desde local solo hay validación estática (compuertas) y lecturas de solo lectura autorizadas explícitamente. El primer apilado ocurre en la **Fase 04** con la app stub; el visto del usuario se materializa como **la acción humana que arranca el workflow** —push a `main` autorizado para desplegar; `workflow_dispatch` + literal exacto para demoler— y **no** como un *required reviewer* del environment (**D-48**, visto del usuario 2026-11-22). `environment: dev` sigue siendo obligatorio en todo job que mute AWS: scopea los secretos y fija el claim OIDC `sub` que exige el trust del rol, de modo que sin él no hay credenciales (fail-closed, D-43).
- **Enmiendas:** esta constitución solo se modifica con aprobación explícita del usuario; toda enmienda se registra en `DECISIONS.md`.

## I7. Verificación
- Mínimo por fase: `pnpm run lint`, `pnpm test` y `powershell -File scripts/check.ps1` (instalación previa con `pnpm install --frozen-lockfile`).
- Desde Fase 02, además: `pnpm run validate:api` (lint de `docs/api/openapi.yaml`) y el **test de contrato** que compara la app Express con ese documento (I8b.4). La documentación de `docs/human/**` en verde entra en la definición de "fase cerrada" (I8).
- **IaC (desde Fase 03), gate = `cfn-lint template.yaml`**, offline, sin credenciales AWS y **sin ejecutar scripts de dependencias**. `sam build` queda fuera de la compuerta documental (ejecuta *package manager scripts* según la advertencia oficial de SAM); su equivalente controlado se valida en la spike D-31. También quedan excluidos del gate `sam validate` a secas y `aws cloudformation validate-template` (piden credenciales) y `serverless print` (pide login del vendor). **Ningún comando de despliegue forma parte de una compuerta.**
- **Asserts de IaC obligatorios desde Fase 03** (los revisa `check.ps1` sobre la plantilla): 1 sola `AWS::DynamoDB::Table` con `BillingMode: PROVISIONED` y ≤ 25 RCU/25 WCU, **sin** `AWS::ApplicationAutoScaling::*`, sin `GlobalSecondaryIndexes`, sin `StreamSpecification`, sin PITR; 1 sola `AWS::Lambda::Function` + 1 sola Function URL; **ausencia** de `AWS::ApiGatewayV2::*` y de `ProvisionedConcurrencyConfig`; `MemorySize` ≤ 256; sin `*` en `Resource`. Región única.
- **Asserts de cadena de suministro (desde Fase 02, revisados por `check.ps1`)**: existe `pnpm-lock.yaml`; **no** existe `package-lock.json` ni `yarn.lock`; `package.json` declara `packageManager` con `pnpm@` en versión exacta y `engines.node` ≥ 20; existe `pnpm-workspace.yaml` con `ignoreScripts`, `strictDepBuilds`, `minimumReleaseAge` y `trustPolicy`; ningún `dependencies`/`devDependencies` usa spec exótica (`git:`, `github:`, `file:`, `http(s)://`, `link:`, `workspace:`).
- Prueba local: `pnpm run dev` levanta la **misma app Express** en `PORT` sin adaptador Lambda; los tests de negocio corren contra ella o contra los services, nunca contra AWS ni contra Telegram.
- Revisión IAM manual contra I4 en cada fase de infra, y captura de la **alerta de facturación en $0** como evidencia antes del primer despliegue.
- Tests solo de reglas de negocio y contratos (ingestión, enum de estado, orden/filtro de listado, reply con Telegram simulado, auth). Nada de tests cosméticos ni de captura.
- Pruebas end-to-end contra Telegram real: solo en Fase 09 (tras el reorder D-42; antes F08), con visto explícito del usuario, y con cuenta/bot de desarrollo.

## I8. Documentación para humanos (decisión D-32)
La entrega de este proyecto **no es solo código**: un backend que nadie entiende no es utilizable. La documentación para personas es parte del definition-of-done de cada fase y **se actualiza tras cada tarea completa y validada** (no al final del proyecto, no "cuando toque").

### I8a. Dónde vive (mapa vinculante)
```
README.md                          # puerta de entrada: qué es, arranque local, variables, despliegue, curl del webhook
CHANGELOG.md                       # cambios por versión: endpoints añadidos/modificados, migraciones, decisiones visibles
docs/
  human/
    README.md                      # índice de esta documentación + tabla de frescura (artefacto · fase dueño · Actualizado)
    functional/
      product.md                   # qué hace el sistema, para quién (jugador→usuario de Telegram, agente→panel), flujos de uso
      api.md                       # documentación funcional de los 4 endpoints: ejemplos reales req/resp, errores, auth, límites
    technical/
      architecture.md              # topología real: Function URL → Express → services → repositories → DynamoDB; capas y reglas de dependencia
      data-model.md                # la tabla, el enum, capacidad provisioned, consumo de RCU/WCU, por qué Scan y cuándo migrar a Query
      operations.md                # seguridad (x-api-key, secret token), logs (qué se registra y qué nunca), límites de 30 s / 6 MB, cold start
      decisions-summary.md         # resumen legible de DECISIONS.md para quien no va a leer el registro append-only
    diagrams/
      api-flow.mmd                 # Mermaid: petición → Function URL → router → DynamoDB/Telegram, por endpoint
      deployment.mmd               # Mermaid: repo → GitHub Actions → SAM/CloudFormation → recursos AWS (región y stage)
      component.mmd                # Mermaid: capas internas y dirección de dependencias
      *.svg                        # export renderizado y commiteado para leerse sin herramientas
    runbook.md                     # operaciones: desplegar, registrar/cambiar el webhook, rotar claves, revisar coste, revertir
  api/
    openapi.yaml                   # CONTRATO machine-readable (OpenAPI 3.1), ruta estable para el panel frontend
    api.html                       # (opcional, generado en local) documento navegable; nunca dependiente de CDN
```
Reglas del mapa: el **contrato** vive en `docs/api/openapi.yaml` (ruta estable para quien integra el panel); la **prosa para personas** vive en `docs/human/**`; `docs/specs/**` y `docs/harness/**` son el proceso interno. Ningún archivo de `docs/human/**` se crea vacío: o tiene contenido útil o no existe (se declara `pendiente (Fase NN)` en la tabla de frescura del índice).

### I8b. Obligación de frescura (vinculante, computable)
1. Cada artefacto de `docs/human/**` y `README.md`/`CHANGELOG.md` lleva una línea `Actualizado: fase NN · AAAA-MM-DD`.
2. Al cerrar una tarea en `done`, el orquestador ordena al documentador tocar los artefactos afectados; la evidencia de la tarea (`tasks.md`, columna *Docs*) cita los archivos actualizados o `sin impacto`.
3. `scripts/check.ps1` falla si: falta el índice `docs/human/README.md`; falta un artefacto requerido por la fase en curso; un artefacto requerido tiene marcador de fase **anterior** a la última fase cerrada en `INDEX.md`; o `README.md` no menciona los comandos reales del proyecto.
4. El contrato **no puede divergir**: desde Fase 01 existe `docs/api/openapi.yaml` y desde Fase 02 hay un test de contrato que compara rutas, métodos, códigos de estado y schemas contra la app Express. Compuerta: `pnpm run validate:api` (lint del OpenAPI) + `pnpm test` (el test de contrato). Si el código y `openapi.yaml` difieren, **la fase no cierra**.

### I8c. Cuándo nace cada artefacto (por fase)
| Fase | Documentación que debe existir o actualizarse al cerrar |
|---|---|
| 00 | `docs/human/README.md` (índice + tabla de frescura), `technical/architecture.md` (capas y topología elegida) |
| 01 | `api/openapi.yaml`, `functional/api.md`, `technical/data-model.md` |
| 02 | `README.md` (arranque, variables, comandos pnpm), `CHANGELOG.md`, `technical/operations.md` (dev local), scripts `validate:api` + test de contrato |
| 03 | `diagrams/deployment.mmd` + `.svg`, `technical/operations.md` (IAM, límites, retención de logs), `runbook.md` (sección de despliegue en seco) |
| 04 | `runbook.md` §pipeline (comandos de `deploy.yml`/`prune.yml` con placeholders, evidencias C8) y workflow en `.github/workflows/` |
| 05–08 | por cada endpoint: `functional/api.md` + `api/openapi.yaml` + `diagrams/api-flow.mmd` actualizados y test de contrato en verde (numeración post-D-42: ingesta 05, lectura 06, mutación 07, reply 08) |
| 09 | `runbook.md` completo (`setWebhook` con `curl` exacto, rotación, rollback), `README.md` con la URL final y resultados E2E anotados, `functional/product.md` y `technical/decisions-summary.md`, pase final de frescura y límites conocidos |

### I8d. Elecciones de formato (vinculantes)
- **Contrato:** OpenAPI **3.1** en YAML, versionado en `info.version` y alineado con `CHANGELOG.md`. Se elige OpenAPI antes que "Swagger" como marca: Swagger UI es solo un visor; el activo es el documento. El visor se genera en local (`@redocly/cli` o `swagger-cli` como **devDependency**) → **prohibido** enlazar CDN o servicios de documentación hosted (coherente con I4 y con no añadir superficies).
- **Diagramas:** **Mermaid** en texto (`.mmd`, versionable y revisable en diff) con export `.svg` commiteado para lectura sin herramientas. Nada de diagramas binarios opacos ni de servicios externos de diagramado.
- **Idioma:** `docs/human/**`, `README.md`, `CHANGELOG.md` y el `description` de OpenAPI en **español**; campos, rutas, `operationId`, ejemplos de JSON y código en **inglés**.
- **Secretos:** los ejemplos usan placeholders (`<ADMIN_API_KEY>`, `<TELEGRAM_BOT_TOKEN>`); `check.ps1` escanea también la documentación (I4/D-13).
- Lo que **no** se documenta aquí: el proceso SDD (eso vive en `docs/specs/**`), ni se duplica el registro de decisiones (se resume y se enlaza por ID).

## Guía de decisiones rápidas
| Pregunta | Respuesta canónica |
|---|---|
| ¿Puedo usar `npm` o `yarn` para instalar algo? | No. **pnpm, siempre** (`pnpm install --frozen-lockfile`), y nada de `package-lock.json`/`yarn.lock` en el repo (I4b / D-30). |
| ¿Puedo usar `npx`? | No: es npm. Usa `pnpm dlx` o un script de `package.json` (`pnpm <comando>`). |
| ¿Puedo añadir una dependencia? | Sí, si es mínima, no rompe I2, entra por pnpm y queda anotada en `DECISIONS.md`. Si trae scripts de instalación: además, entrada explícita en `allowBuilds` con decisión registrada (I4b). |
| ¿Puedo cambiar un campo del contrato? | Solo con enmienda de la spec de Fase 01 + `DECISIONS.md` (I3). |
| ¿Puedo subir la memoria de Lambda a 512 MB? | No sin OK del usuario: I2 fija 128–256 MB. |
| ¿Puedo activar auto scaling o *provisioned concurrency*? | No. Ambos se facturan y rompen el techo de $0 (I2 / D-26). |
| ¿Puedo pasar la tabla a `PAY_PER_REQUEST`? | Solo ante escalado real, con decisión nueva + OK explícito del usuario (D-26 → D-29). |
| ¿Puedo usar Lambda Web Functions para quitarme el adaptador? | No: tarifa $0,30/M con CPU activa y sin franquicia documentada (D-27, I2). |
| ¿Puedo meter `cors()` en Express si ya hay CORS en la URL? | No. Una sola fuente de verdad: la config `Cors` de la Function URL (I4). |
| ¿Puedo correr `sam build` como validación? | No es compuerta: ejecuta scripts de dependencias (I4b/I7). Se usa en el paso de empaquetado/deploy, bajo decisión D-31 y con OK del usuario. |
| ¿Puedo cerrar una tarea sin tocar la documentación? | No. Si tu cambio afecta a comportamiento, contrato, variables, despliegue o límites, actualiza el artefacto de `docs/human/**` que corresponda y su línea `Actualizado:` (I8). Si realmente no impacta, se anota `sin impacto` en la evidencia. |
| ¿Puedo publicar Swagger UI en un CDN o servicio hosted? | No. El activo es `docs/api/openapi.yaml`; el visor se genera en local con una devDependency, sin CDN (I8d, I4). |
| ¿Puedo dejar un diagrama en PNG sin fuente? | No. Toda imagen nace de un `.mmd` versionado; el `.svg` exportado se commitéa junto a él (I8d). |
| ¿Puedo desplegar para probar? | No. Lo propone el orquestador con comandos exactos y el usuario da el visto (I6). |
| ¿Puedo loguear el payload de Telegram completo? | No. Solo los campos necesarios del ticket, sin datos personales sobrantes (I4/I5). |
| ¿Puedo saltarme una compuerta? | No. |
