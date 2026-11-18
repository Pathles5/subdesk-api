# Constitución — SubDesk API

Inmutables del proyecto. Ninguna spec ni implementación puede contradecir esto.
Si hay conflicto entre una spec y la constitución, gana la constitución y la spec se reescribe.

## I1. Alcance
- Backend serverless de un gestor de tickets integrado con Telegram: un bot (webhook) + una API REST para un panel externo.
- Un solo bot, una sola tabla (`TicketsTable`), un solo tipo de entidad (ticket).
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
  - Bucket S3 de artefactos del deploy (≈ $0,0002/mes a nuestro volumen; inevitable en cualquier IaC que suba un ZIP).
- **Prohibido sin aprobación explícita del usuario + registro en `DECISIONS.md`:**
  - **Capacidad provisionada > 25/25**, **auto scaling de capacidad provisionada** (Application Auto Scaling), **GSI/LSI**, **DynamoDB Streams**, **PITR**, backups on-demand, pre-warming de warm throughput, tabla `Standard-IA` sin decisión.
  - **Migrar la tabla a `PAY_PER_REQUEST`** sin decisión registrada (vía de escape prevista en D-26: se activa solo ante escalado real, con enmienda + OK del usuario).
  - **Provisioned concurrency** de Lambda (se factura por GB-s reservado) y **Lambda Web Functions** (tarifa $0,30/M con CPU activa y sin franquicia documentada al 2026-11-18).
  - API Gateway (HTTP API o REST), NAT, CloudFront, WAF, ElastiCache/DAX, colas (SQS), servicios con reserva, dominios gestionados por la infra, cualquier servicio fuera de la lista de arriba.
- **La cuenta debe estar en Paid plan**: el *Free plan* cierra la cuenta sola a los 6 meses y borra los recursos. El control de gasto de AWS **no permite un tope por debajo de $20/mes**, así que la **alerta de facturación en $0** es obligatoria y su evidencia (captura o `ce` read-only) se documenta en la spec de la Fase 03 antes del primer despliegue.
- `scripts/check.ps1` falla si esta cláusula desaparece de la constitución.


## I3. Modelo de datos y contrato
- La forma del ítem de `TicketsTable` definida en Fase 01 es **el contrato** del panel frontend y del bot: `id`, `telegram_chat_id`, `username`, `message_content`, `response_text`, `status`, `created_at`, `updated_at`, en `snake_case`, timestamps ISO 8601, `id` UUID v4.
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

## I5. Comportamiento operativo
- `POST /webhook/telegram` **siempre responde 2xx**: también cuando el update se ignora (sin texto, vacío, irrelevante), para que Telegram no reintente. El error interno que no impida la ack se loguea, no se propaga como 5xx.
- Con Express dentro de Lambda esa ack es una **obligación de la capa HTTP, no solo del handler**: la ruta del webhook va protegida por su propio *error handler* que convierte cualquier excepción —incluido un fallo de parseo de `express.json()` o un `throw` en un servicio— en `200` con cuerpo de descarte. Un `5xx` o una excepción sin capturar **fallan la invocación**, Telegram considera el update no entregado y **reintenta en bucle**, duplicando carga y tickets. Las rutas `/api/*` sí propagan `4xx`/`5xx` normales.
- Idempotencia de ingestión: un mismo `update_id` recibido dos veces no duplica tickets (decisión de mecanismo en Fase 01).
- La respuesta al usuario solo marca `RESOLVED` **si Telegram devolvió OK**. Si falla, el ticket conserva su estado y el error queda registrado.
- Ninguna operación de escritura silenciosa: toda mutación actualiza `updated_at`.
- Lecturas: `Scan` aceptado mientras el volumen sea bajo. El umbral de revisión se expresa en **items leídos (~1.000–2.000)**, no en peticiones; al cruzarlo la respuesta es **migrar a `Query`**, nunca subir la capacidad provisionada (rompería I2). El filtro `?status=` no reduce el consumo: se cobra lo **evaluado**, no lo devuelto.

## I6. Proceso (SDD + AI Harness)
- **Spec-first:** no se implementa nada sin spec previa en `docs/specs/NN-<nombre>/spec.md` con criterios de aceptación verificables.
- **Verify-after:** toda fase termina con las compuertas en verde (`scripts/check.ps1`; desde Fase 02 también `npm run lint` y `npm test`; desde Fase 03, validación de IaC **sin desplegar**).
- **Revisor fresh-eyes:** al cierre de cada fase un subagente revisor evalúa la entrega contra los criterios de la spec.
- **Decisions:** toda decisión de diseño/arquitectura queda escrita en `DECISIONS.md` (append-only, IDs `D-xx`) con opciones, elección, motivo y riesgo.
- **Nada desplegable se ejecuta sin el usuario:** `deploy`, `remove`, `setWebhook` y cualquier llamada que cree o modifique recursos reales se propone con comandos exactos y la ejecuta el orquestador solo con visto explícito del usuario.
- **Enmiendas:** esta constitución solo se modifica con aprobación explícita del usuario; toda enmienda se registra en `DECISIONS.md`.

## I7. Verificación
- Mínimo por fase: `npm run lint`, `npm test` y `powershell -File scripts/check.ps1`.
- **IaC (desde Fase 03), gate = `sam build` + `cfn-lint`**, ambos **offline, sin credenciales AWS y sin Docker** para Node.js. Quedan explícitamente descartados como gate: `sam validate` a secas y `aws cloudformation validate-template` (ambos exigen credenciales configuradas) y `serverless print` (exige login del vendor). **Ningún comando de despliegue forma parte de una compuerta.**
- **Asserts de IaC obligatorios desde Fase 03** (los revisa `check.ps1` sobre la plantilla): 1 sola `AWS::DynamoDB::Table` con `BillingMode: PROVISIONED` y ≤ 25 RCU/25 WCU, **sin** `AWS::ApplicationAutoScaling::*`, sin `GlobalSecondaryIndexes`, sin `StreamSpecification`, sin PITR; 1 sola `AWS::Lambda::Function` + 1 sola `AWS::Lambda::Url`; **ausencia** de `AWS::ApiGatewayV2::*` y de `ProvisionedConcurrencyConfig`. Región única.
- Prueba local: `npm run dev` levanta la **misma app Express** en `PORT` sin adaptador Lambda; los tests de negocio corren contra ella o contra los services, nunca contra AWS ni contra Telegram.
- Revisión IAM manual contra I4 en cada fase de infra, y captura de la **alerta de facturación en $0** como evidencia antes del primer despliegue.
- Tests solo de reglas de negocio y contratos (ingestión, enum de estado, orden/filtro de listado, reply con Telegram simulado, auth). Nada de tests cosméticos ni de captura.
- Pruebas end-to-end contra Telegram real: solo en Fase 08, con visto explícito del usuario, y con cuenta/bot de desarrollo.

## Guía de decisiones rápidas
| Pregunta | Respuesta canónica |
|---|---|
| ¿Puedo añadir una dependencia? | Sí, si es de runtime mínima, no rompe I2 y queda anotada en `DECISIONS.md`. Dev-dependencies: libre si no añade coste. |
| ¿Puedo cambiar un campo del contrato? | Solo con enmienda de la spec de Fase 01 + `DECISIONS.md` (I3). |
| ¿Puedo subir la memoria de Lambda a 512 MB? | No sin OK del usuario: I2 fija 128–256 MB. |
| ¿Puedo activar auto scaling o *provisioned concurrency*? | No. Ambos se facturan y rompen el techo de $0 (I2 / D-26). |
| ¿Puedo pasar la tabla a `PAY_PER_REQUEST`? | Solo ante escalado real, con decisión nueva + OK explícito del usuario (D-26). |
| ¿Puedo usar Lambda Web Functions para quitarme el adaptador? | No: tarifa $0,30/M con CPU activa y sin franquicia documentada (D-27, I2). |
| ¿Puedo meter `cors()` en Express si ya hay CORS en la URL? | No. Una sola fuente de verdad: la config `Cors` de la Function URL (I4). |
| ¿Puedo desplegar para probar? | No. Lo propone el orquestador con comandos exactos y el usuario da el visto (I6). |
| ¿Puedo loguear el payload de Telegram completo? | No. Solo los campos necesarios del ticket, sin datos personales sobrantes (I4/I5). |
| ¿Puedo saltarme una compuerta? | No. |
