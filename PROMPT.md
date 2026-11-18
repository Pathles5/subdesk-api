# SubDesk API — Brief y mandato para el lead engineer/architect

> **Esto no es una especificación cerrada.** Es un brief de producto y un mandato de ingeniería. Tú tomas las decisiones de arquitectura y desarrollo. No ejecutes una receta: propone, justifica, construye y documenta.
> El nombre visible del proyecto (`SubDesk API`) es provisional; el repo es `subdesk-api`.

> **⚠️ Nota de vigencia (2026-11-18).** Este brief se mantiene como **histórico**. Tres puntos de sus §4/§5 han sido **sustituidos por decisión explícita del usuario** y la regla operativa vive en `docs/specs/constitution.md` + `DECISIONS.md`:
> 1. §4/§5.5 *"IaC: Serverless Framework o AWS SAM"* → **AWS SAM** (D-15).
> 2. §4/§5.6 *"API Gateway HTTP API"* → **Lambda Function URL** (D-27): la franquicia de HTTP API caduca a los 12 meses y la Function URL no factura por petición (I2).
> 3. §2/§5.4 *"DynamoDB `PAY_PER_REQUEST`"* → **`PROVISIONED` 25/25, auto scaling OFF** (D-26): la franquicia mensual de peticiones solo existe en modo provisioned; la migración a bajo demanda queda prevista como vía de escape futura (D-29) y exige OK del usuario.
> 4. §6.1 *"estructura limpia (`src/handlers/`)"* → **1 sola Lambda con Express dentro** (`src/lambda.js` + `src/routes/`), por D-27.
> 5. Uso implícito de **npm** (y las deps `axios`/`node-fetch`/`uuid` que sugería) → **pnpm como único gestor**, con configuración endurecida en `pnpm-workspace.yaml`, `fetch` nativo y `crypto.randomUUID()` (D-30, constitución I4b).


---

## 1. Mandato

Actúa como **cloud architect + senior backend developer** (especialista en AWS Serverless y Node.js) de un proyecto backend nuevo. Eres responsable de:

- Elegir el IaC (Serverless Framework o AWS SAM) y justificarlo.
- Definir la estructura de capas del proyecto y sus convenciones.
- Definir el modelo de datos de DynamoDB y los contratos de la API.
- Definir la estrategia de seguridad (admin key + secret token del webhook).
- Definir la estrategia de test y verificación sin desplegar.
- Implementar el código base completo y funcional.
- Definir e implementar el CI/CD de despliegue.
- Documentar cada decisión y sus riesgos.

No quiero una lista de instrucciones pixel a pixel. Quiero las decisiones que tomaría un buen equipo de producto e infra, con las restricciones de abajo. Si una preferencia del brief te parece equivocada, cámbiala y explica por qué (quedando registrada en `DECISIONS.md`).

---

## 2. Producto

**SubDesk API** es el backend de un sistema gestor de tickets integrado con Telegram:

1. Un **Bot de Telegram** recibe mensajes de usuarios vía **webhook** (no polling).
2. Cada solicitud se almacena como **ticket** en DynamoDB.
3. Una **API REST** permite a un panel frontend listar tickets, cambiar su estado y **responder** al usuario (la respuesta se envía de vuelta al chat de Telegram).

- El frontend del panel **no forma parte de este repo**: este proyecto entrega el backend y sus contratos.
- No hay autenticación de usuarios finales: el panel se autentica con una clave de administración simple.
- El volumen esperado es bajo (uso personal / equipo pequeño): las decisiones de arquitectura optimizan coste, latencia y claridad, no escala masiva.

---

## 3. Usuario y contexto

- **Usuario 1 — el que escribe al bot:** cualquier persona con Telegram; manda un mensaje de texto y espera una respuesta en su chat.
- **Usuario 2 — el agente/operator del panel:** consulta la cola, cambia estados y redacta respuestas desde un frontend propio.
- **Developer:** una sola persona; necesita `deploy` simple, variables de entorno claras y comandos exactos para registrar el webhook tras desplegar.
- Idioma: documentación y commit messages en **español**; código, identificadores, campos JSON y comentarios en **inglés**.

---

## 4. Preferencias del usuario (punto de partida, no dogma)

| Área | Preferencia inicial |
|---|---|
| Runtime | Node.js ≥ 20.x, **ES Modules** |
| IaC | Serverless Framework v3/v4 o AWS SAM (elige el más limpio y estándar) |
| Computación | Lambda con memoria baja (128–256 MB) |
| API | API Gateway **HTTP API** (`v2`), no REST API |
| BD | DynamoDB `PAY_PER_REQUEST` (on-demand) |
| Telegram | **Webhooks** + llamadas HTTP directas a la Bot API (`fetch` nativo o `axios` ligero); sin librerías de polling |
| CI/CD | GitHub Actions: despliegue automático al hacer push a `main` |
| Seguridad | `x-api-key` vs `ADMIN_API_KEY` en middleware/authorizer ligero; secret token opcional en el webhook |
| Estructura | `src/handlers/`, `src/services/`, `src/utils/` |
| Deps | Mínimas: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `uuid` |
| Verificación | lint + tests; validación de IaC **sin desplegar** |

Puedes cambiar cualquiera de estas preferencias con una razón mejor. Documenta el cambio y el motivo.

---

## 5. Restricciones reales (no negociables)

1. **Coste $0 / Free Tier:** nada de infra, CI/CD ni repo puede generar gasto. Solo Lambda (128–256 MB), HTTP API, DynamoDB on-demand dentro de la cuota gratuita, GitHub Actions en plan gratuito, CloudFormation (no factura por plantillas). Sin NAT, sin CloudFront, sin WAF pago, sin servicios con reserva, sin dominios gestionados por la infra. Cualquier excepción exige aprobación explícita del usuario y registro en `DECISIONS.md`.
2. **Webhook, no polling:** no hay proceso largo ni `getUpdates` en bucle.
3. **`POST /webhook/telegram` responde `200` siempre**, incluso si el update se ignora (mensaje vacío o no-texto), para que Telegram no reintente.
4. **`status` es un enum cerrado:** `PENDING` · `IN_PROGRESS` · `RESOLVED`. Cualquier otro valor se rechaza con `400`.
5. **Campos del contrato tal como los fijó el brief** (`telegram_chat_id`, `username`, `message_content`, `response_text`, `status`, `created_at`, `updated_at`), en `snake_case`, timestamps ISO 8601.
6. **Secretos nunca en el repo:** `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY` y el secret token salen de variables de entorno / secrets de GitHub. Nada de tokens en logs ni en salidas de comandos.
7. **Principio de menor privilegio** en IAM: cada rol, solo las acciones sobre los recursos que usa.
8. **CORS abierto (`*`) solo como estado de desarrollo**, anotado como riesgo y revisable por enmienda.
9. **No se despliega sin visto explícito del usuario.** Las acciones externas (`deploy`, `remove`, `setWebhook`) se proponen con comandos exactos y las ejecuta el orquestador con el OK del usuario.

---

## 6. Decisiones que debes tomar

Pronúnciate por escrito en `DECISIONS.md` (opciones · elección · motivo · riesgo) sobre:

1. **IaC**: Serverless Framework vs AWS SAM. Evalúa legibilidad, validación sin desplegar, tamaño del artefacto, curva de mantenimiento y soporte de HTTP API + IAM.
2. **Estructura de capas**: carpetas, cómo se separan handlers / services / utils / domain, dónde vive la configuración y cómo se inyectan los puertos de salida (DynamoDB, Telegram).
3. **Modelo de datos**: atributos indexados, si `telegram_chat_id` es string o number, versionado del ítem, qué se guarda del update de Telegram y qué no.
4. **Contrato de API**: forma exacta de las respuestas de éxito y error de los 4 endpoints, códigos HTTP, paginación/`LastEvaluatedKey` del `Scan`, filtro `?status=` y orden.
5. **Seguridad**: middleware en código vs authorizer Lambda en API Gateway; rotación de `ADMIN_API_KEY`; validación del `X-Telegram-Bot-Api-Secret-Token`; qué se loguea.
6. **Validación de entrada**: librería ligera vs guards manuales (preferencia: cero dependencias de runtime innecesarias).
7. **Estrategia de test**: framework, qué se prueba con DynamoDB mocked, cómo se stubbea Telegram, qué queda para verificación manual post-despliegue.
8. **Observabilidad**: logs estructurados mínimos, alertas de error, y cómo se revisa el coste en cada compuerta.
9. **CI/CD**: secretos necesarios, pasos de validación antes del deploy, políticas de rollback y cuándo se dispara `setWebhook`.
10. **Manejo de errores y reintentos**: qué pasa si Telegram devuelve error al responder (el ticket NO debe quedar `RESOLVED`).

---

## 7. Proceso obligatorio

Trabaja en este orden. No pidas aprobación entre fases, salvo lo que el harness declara como compuerta con visto del usuario.

> **Nota de proceso:** el trabajo es un ciclo **SDD** (Spec-Driven Development) gobernado por el **AI harness** (ver `AGENTS.md`). Cada fase tiene su spec en `docs/specs/` **antes** de implementar; cada fase termina con verificación mecánica y decisiones registradas en `DECISIONS.md`. Los inmutables están en `docs/specs/constitution.md` y ganan a cualquier spec.

### Fase 00 — Arquitectura y elección de IaC
Spec + decisión de IaC, estructura de carpetas, contrato de variables de entorno y convención de capas. Sin código de producto.

### Fase 01 — Modelo de datos y contrato de API
`TicketsTable` (clave, atributos, tipos, enum de estado, índices si hacen falta) y los 4 contratos de endpoint documentados con ejemplos de petición/respuesta y errores. Sin handlers.

### Fase 02 — Scaffold del proyecto
`package.json` (ESM), lint, estructura de carpetas, configuración, `.env.example`, scripts (`lint`/`test`/`check`/`validate:iac`). Código mínimo de arranque, sin lógica de negocio.

### Fase 03 — Infraestructura como código
Tabla, HTTP API, funciones Lambda, IAM de menor privilegio, variables de entorno. **Validado sin desplegar.**

### Fase 04 — Ingesta: `POST /webhook/telegram`
Extracción de `chat.id`, `from.username`/`from.first_name` y `text`; alta del ticket en `PENDING`; `200` garantizado en los casos que se ignoran.

### Fase 05 — Lectura: `GET /api/tickets`
`Scan` + orden descendente por `created_at`, filtro `?status=`, autenticación `x-api-key`.

### Fase 06 — Mutación: `PATCH /api/tickets/{id}`
Validación del enum, actualización con `updated_at`, `404` si no existe, respuesta con el ticket actualizado.

### Fase 07 — Respuesta: `POST /api/tickets/{id}/reply`
Llamada a `sendMessage`, actualización a `RESOLVED` **solo si Telegram responde OK**, manejo del error de Telegram.

### Fase 08 — CI/CD y despliegue
`.github/workflows/deploy.yml`, validaciones previas al deploy, comando exacto de registro del webhook, prueba end-to-end con el bot real (con visto del usuario: es acción externa).

### Fase 09 — Hardening y entrega
`README.md`, revisión de coste/cuotas, límites conocidos, informe final.

Al final de cada fase ejecuta las compuertas (`scripts/check.ps1` + `pnpm run lint` + `pnpm test`, y `pnpm run validate:iac` = `cfn-lint` cuando aplique; npm/yarn prohibidos por I4b). Si algo falla, corrígelo antes de continuar.

---

## 8. Criterios de éxito

- El repo es clonable y `npm run lint` + `npm test` pasan sin desplegar nada.
- La IaC es válida y desplegable con un solo comando, con permisos IAM de menor privilegio y coste previsto $0.
- Los 4 endpoints funcionan según contrato, con errores y códigos HTTP documentados.
- El webhook de Telegram crea tickets reales y **nunca** devuelve un código que provoque reintentos.
- `PATCH` y `reply` no dejan el estado del ticket incoherente si Telegram falla.
- Ningún secreto en el repo; `.env.example` con placeholders y README con el `curl` exacto de `setWebhook`.
- El pipeline de GitHub Actions despliega en `main` y falla de forma ruidosa si faltan secretos.
- `DECISIONS.md` y `README.md` explican el qué, el porqué y cómo se despliega/registra el webhook.

---

## 9. Entregables

- Repo funcional con la estructura de capas definida en la Fase 00.
- IaC completa y válida (tabla + HTTP API + Lambdas + IAM + env vars).
- Código de handlers y services con validación y manejo de errores.
- Tests de las reglas de negocio (ingesta, estados, reply con Telegram simulado).
- Workflow de despliegue en GitHub Actions.
- `DECISIONS.md`: las diez decisiones del §6 + modelo de datos + contratos + política de seguridad.
- `README.md`: arranque local, despliegue, registro del webhook (`curl` exacto), variables necesarias y limitaciones.

---

## 10. Fuera de alcance de la v1

- Frontend del panel (solo se documentan sus contratos).
- Múltiples bots, multi-tenancy, colas (SQS), streams, caché (ElastiCache/DAX).
- Autenticación real (Cognito, OAuth, authorizer JWT), roles y permisos granulares.
- Notificaciones push al agente, métricas de SLA, adjuntos de mensajes, fotos/voz/stickers.
- Bots interactivos (botones, comandos, inline keyboard), migración de datos histórica.
- Terraform/Pulumi, Kubernetes, contenedores, bases de datos SQL.
- Cualquier servicio AWS que no esté en la lista de Free Tier de I2.

Si algo de esto aparece como "mejora obvia", anótalo en el informe final, no lo implementes.

---

## 11. Cómo responder

- Empieza con un plan de 10–15 líneas y las decisiones principales.
- Después implementa según el ciclo de fase del harness (`AGENTS.md` §1), con la solución validada por el usuario por tarea (D-07).
- Si algo es ambiguo: decide, documenta y sigue.
- No cierres con preguntas abiertas, salvo acciones externas (despliegue, `setWebhook`) que exigen el visto del usuario.
- Termina cada fase con el resultado de las compuertas visible.

---

## 12. Contexto original del usuario (resumen del brief recibido)

> "Actúa como Arquitecto Cloud y Desarrollador Backend Senior especializado en AWS Serverless y Node.js. El sistema recibirá mensajes de usuarios a través de un Bot de Telegram, almacenará cada solicitud como un ticket en DynamoDB y expondrá una API REST para que un panel frontend pueda listar, actualizar el estado y responder a esos tickets (enviando la respuesta de vuelta al chat del usuario). Stack: Node 20+ ESM, Serverless Framework o AWS SAM, Lambda 128/256 MB, API Gateway HTTP API, DynamoDB `PAY_PER_REQUEST`, Telegram por webhooks con llamadas HTTP directas, GitHub Actions al push de `main`. Tabla `TicketsTable` con PK `id` (UUID v4) y atributos `telegram_chat_id`, `username`, `message_content`, `response_text`, `status` (`PENDING`/`IN_PROGRESS`/`RESOLVED`), `created_at`, `updated_at`. Endpoints: `POST /webhook/telegram`, `GET /api/tickets` (scan, orden `created_at` desc, filtro opcional `?status=`), `PATCH /api/tickets/{id}`, `POST /api/tickets/{id}/reply` (llama a `sendMessage` y cierra el ticket si Telegram responde OK). Seguridad: `x-api-key` vs `ADMIN_API_KEY` en `/api/*`; webhook público, opcionalmente validando `X-Telegram-Bot-Api-Secret-Token`. Entregables: estructura limpia (`src/handlers`, `src/services`, `src/utils`), `package.json` con deps mínimas, archivo de infra con coste cero e IAM de menor privilegio, código completo, `.github/workflows/deploy.yml` y `README.md` con el `curl` exacto para registrar el webhook."
