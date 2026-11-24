# API en lenguaje humano — los 4 endpoints de SubDesk

Actualizado: fase 05 · 2026-11-23

> Documento para quien **integra el panel frontend** u **opera la conexión con Telegram**. El contrato machine-readable vinculante es `docs/api/openapi.yaml` (OpenAPI 3.1, nace en Fase 01): si alguna vez este texto y el contrato difieren, **manda el contrato** — repórtalo, no lo asumas. Aquí no hay jerga de AWS: qué envías, qué recibes y qué casos raros existen.

> **Alcance (importante):** esto es **una API**. El bot de Telegram **no vive en este repo ni se desarrolla aquí**: es externo y se creará después (BotFather, identidad y conversación fuera de estos entregables). La API lo único que hace con Telegram es *recibir* sus webhooks autenticados con el secreto y *enviar* mensajes con `sendMessage` usando el token configurado. Quien despliegue la API y cree el bot después solo tiene que registrar la URL del webhook (`runbook.md`, Fase 09) para que todo empiece a fluir.

## Visión de conjunto

| Método | Ruta | Para qué sirve | Auth | Éxito |
|---|---|---|---|---|
| `POST` | `/webhook/telegram` | Telegram avisa de un mensaje nuevo → nace un ticket — **VIVO desde Fase 05** | cabecera `X-Telegram-Bot-Api-Secret-Token` | `200` siempre (creado o ignorado) |
| `GET` | `/api/tickets` | cola de tickets para el panel, con filtro y paginación — *stub `501` hasta Fase 06* | cabecera `x-api-key` | `200` con `{ tickets, next_cursor }` |
| `PATCH` | `/api/tickets/{id}` | cambiar el estado de un ticket (sin responder al usuario) — *stub `501` hasta Fase 07* | cabecera `x-api-key` | `200` con el ticket actualizado |
| `POST` | `/api/tickets/{id}/reply` | responder al usuario **en su chat de Telegram** y cerrar el ticket — *stub `501` hasta Fase 08* | cabecera `x-api-key` | `200` con el ticket `RESOLVED` |

Las cuatro rutas conviven en una sola URL pública. **El despliegue de la Fase 04 ya ocurrió** (pipeline — D-42; run #8 `45079697512`, stack `subdesk-api-dev` `UPDATE_COMPLETE`) y el host exacto **ya está fijado**: la URL viva es `https://ddndau6zrzk24hgglvag6435640jdxro.lambda-url.eu-west-1.on.aws/`, registrada también en el `README.md` de la raíz. La región — `eu-west-1` — es la declarada en `infra/deployment.env` (**D-54**). En los ejemplos de este documento se mantiene el placeholder genérico `https://SU-URL.lambda-url.eu-west-1.on.aws`, para que nadie copie y pegue contra el entorno real sin querer: al probar de verdad, sustitúyelo por la URL viva de arriba (es un endpoint público, sin credenciales en la URL; la autenticación va en cabeceras). El campo JSON `id` de la ruta es el identificador opaco del ticket (un UUID; trátalo como caja negra).

**Estado de implementación (Fase 05, ola B — 2026-11-23):** `POST /webhook/telegram` **ya no es un stub**: la ingesta está implementada y verde en local (suite 149/149 y smoke 15/15 contra `pnpm run dev`) y será visible en la URL viva en cuanto se ejecute el próximo despliegue por la pipeline (tarea T-15 de la fase). Los otros tres endpoints **siguen respondiendo `501`** hasta las fases 06 (`GET`), 07 (`PATCH`) y 08 (`reply`).

### Autenticación, en dos frases

- **`/api/*`** (lo que llama tu panel): cabecera `x-api-key` con el valor de la variable de despliegue `ADMIN_API_KEY`. Falta o está vacía → `401`; presente pero distinta → `403`. La comprobación ocurre antes de tocar la base de datos.
- **`/webhook/telegram`** (lo que llama Telegram): cabecera `X-Telegram-Bot-Api-Secret-Token` con el secreto que se registró al configurar el webhook (variable `TELEGRAM_WEBHOOK_SECRET`). Ausente o distinto → `403`. Es **la única excepción** al `200` garantizado del webhook (se explica más abajo).

En este documento todas las credenciales de los ejemplos son placeholders (`SU_CLAVE`, `SU_SECRETO`; `SU-URL` es el host genérico): ningún secreto ni clave real va en el repo ni en la documentación. La única excepción es la URL pública del despliegue, fijada arriba — un endpoint no es un secreto y no lleva credenciales. La rotación de ambas claves es una operación documentada en el `runbook.md` (Fase 09).

---

## `POST /webhook/telegram` — entrada de mensajes

**Para qué sirve:** cada mensaje de un usuario al bot llega aquí. Si es un mensaje de texto legítimo y nuevo, se crea un ticket en estado `PENDING`. Todo lo demás se descarta **sin error**.

```bash
curl -X POST "https://SU-URL.lambda-url.eu-west-1.on.aws/webhook/telegram" \
  -H "content-type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: SU_SECRETO" \
  -d '{"update_id":482391756,"message":{"message_id":42,"from":{"id":112233445,"is_bot":false,"first_name":"Ana","username":"ana_example"},"chat":{"id":112233445,"type":"private"},"date":1763424000,"text":"Hola, mi suscripcion no se ha renovado."}}'
```

Respuesta: `200 {"received": true}` — y el ticket queda listo para aparecer en `GET /api/tickets`.

**La promesa importante: este endpoint responde `200` a prácticamente todo.** No hay `4xx` ni `5xx` por payload raro, y es a propósito: si Telegram no recibe `2xx`, considera el mensaje no entregado y **reintenta en bucle**, lo que duplicaría carga y tickets. Así que un update que no sirve para crear ticket se ignora con `200` y un motivo explícito:

| `ignored` | Cuándo ocurre (en lenguaje humano) |
|---|---|
| `no_text` | el mensaje no trae texto (p. ej. solo foto o voz; los adjuntos no están en la v1) |
| `empty_message` | el texto llega vacío |
| `chat_not_found` | el update no trae el chat al que pertenece: sin chat no hay ticket posible |
| `unsupported_update` | update que este backend no puede convertir en ticket: tipo de update que no consume el bot (p. ej. `callback_query`, `channel_post`, `edited_message`), `update_id` ausente o inválido, **cuerpo que no se puede parsear / supera el límite de 64 KB / declara charset o content-encoding no soportados**, o texto de más de 4096 caracteres (**nunca se trunca**: o el mensaje íntegro, o nada). Desde la Fase 05 los rechazos del parser caen aquí (antes respondían `internal_error`): es el cierre de la divergencia con el contrato que la spec 04 A-10 aplazó a esta fase |
| `duplicate` | este `update_id` ya se procesó antes (es el reintento legítimo de Telegram: no se duplica el ticket) |
| `internal_error` | algo interno falló; el guard del webhook lo convierte en `200` para cerrar el bucle de reintentos y el suceso queda en los logs, no en la respuesta. Desde **D-70** el secreto inválido (→ `403`) y el cuerpo roto (→ `unsupported_update`) ya no caen aquí |

Las definiciones de los seis motivos están **congeladas** en la spec de Fase 01 §5.1 (enmienda A-01): la Fase 05 las **implementó tal cual** (ola B, 2026-11-23), no las reabre (la renumeracion pipelines-first D-42 movio la ingesta de la antigua Fase 04 a la 05). Para ti como consumidor los tres primeros significan lo mismo: `200`, ningún ticket creado, no reintentes.

### Precedencia de motivos (tabla congelada, spec 05 §5.1)

Cuando varias cosas fallan a la vez, la respuesta la decide la **primera regla que casa**, en este orden exacto:

| # | Qué se comprueba | Respuesta |
|---|---|---|
| 0 | Secreto de la cabecera `X-Telegram-Bot-Api-Secret-Token` ausente o distinto de `TELEGRAM_WEBHOOK_SECRET` (comparación en tiempo constante sobre digests SHA-256) | **`403`** `{"error":{"code":"FORBIDDEN","message":"invalid webhook secret"}}` |
| 1 | Cuerpo no parseable, > **64 KB**, charset no soportado o content-encoding no soportado | `200 {"ignored":"unsupported_update"}` |
| 2 | `update_id` ausente o no entero ≥ 1 | `200 {"ignored":"unsupported_update"}` |
| 3 | `message` ausente o no objeto (`callback_query`, `channel_post`, `edited_message`, `poll`, `inline_query`, …) | `200 {"ignored":"unsupported_update"}` |
| 4 | `message.chat.id` ausente o no utilizable (no entero, o fuera de `^-?[0-9]{1,20}$`) | `200 {"ignored":"chat_not_found"}` |
| 5 | `message.text` ausente o no string | `200 {"ignored":"no_text"}` |
| 6 | `message.text` vacío tras `trim` | `200 {"ignored":"empty_message"}` |
| 7 | `message.text` de más de **4096** caracteres (defensivo: Telegram no lo excede) | `200 {"ignored":"unsupported_update"}` + log — **nunca se trunca** |
| 8 | Escritura condicional (`PutItem` con `attribute_not_exists(id)`) correcta | `200 {"received":true}` |
| 9 | Esa escritura falla porque el `update_id` ya estaba | `200 {"ignored":"duplicate"}` |
| 10 | Cualquier otra excepción | `200 {"ignored":"internal_error"}` + log **sin contenido** |

Tres consecuencias prácticas:

- **La dedupe por `update_id` no cuesta ninguna lectura** (D-19): no se consulta nada antes de escribir; la deduplicación **es** la propia escritura condicional. Mismo `update_id` ⇒ `duplicate`, sin segundo ticket y sin carreras entre reintentos concurrentes (uno gana y el otro cae en `duplicate`). La escritura fallida **sí consume capacidad** (~2 WCU, igual que la exitosa): irrelevante con 25 WCU provisionados y el volumen previsto.
- **El texto del ticket se guarda íntegro, sin `trim`, y nunca se trunca**: si superara los 4096 caracteres, el update se ignora (regla 7) en vez de guardar contenido corrupto.
- **El límite de 64 KB** aplica al cuerpo entero del webhook (igual que en `/api/*`); superarlo no produce un error sino `200 {"ignored":"unsupported_update"}`.

Ejemplos de ignoro:

```json
{ "ignored": "unsupported_update" }
{ "ignored": "duplicate" }
```

**El único `403` del webhook:** si la cabecera `X-Telegram-Bot-Api-Secret-Token` falta o no coincide — **independientemente de lo que lleve el cuerpo**: desde **D-70** el gate del secreto se comprueba **antes** de parsear el cuerpo, así que «secreto erróneo + cuerpo roto» también responde `403` (antes respondía `200 {"ignored":"internal_error"}`); es lo que el contrato siempre prescribió (`openapi.yaml:54`). No rompe la promesa de arriba porque los reintentos legítimos de Telegram **siempre** llevan el secreto registrado; quien falla el secreto no es Telegram reintentando un update, es un tercero, y rechazarlo no provoca bucle de reintento alguno. Si al desplegar ves `403` masivos, casi seguro es un secreto de despliegue distinto del registrado con `setWebhook` (se comprueba en la prueba E2E de Fase 09).

Respuestas de este endpoint: `200` (creado o ignorado) y `403` (secreto inválido). No hay más.

---

## `GET /api/tickets` — la cola del panel

**Para qué sirve:** listar tickets, opcionalmente filtrados por estado, de más recientes a más antiguos.

```bash
curl "https://SU-URL.lambda-url.eu-west-1.on.aws/api/tickets?status=PENDING&limit=50" \
  -H "x-api-key: SU_CLAVE"
```

Parámetros de consulta:

| Parámetro | Valores | Notas |
|---|---|---|
| `status` | `PENDING` · `IN_PROGRESS` · `RESOLVED` | opcional; cualquier otro valor → `400 VALIDATION_ERROR` |
| `limit` | entero `1–100`, por defecto `50` | opcional; fuera de rango → `400` |
| `cursor` | la cadena que devolvió `next_cursor` | opcional; omítelo para la primera página |

Respuesta `200` (ejemplo con un ticket pendiente, aún sin respuesta):

```json
{
  "tickets": [
    {
      "id": "f53dea7a-383f-510d-b6ff-eddd5270f4b6",
      "telegram_chat_id": "112233445",
      "username": "ana_example",
      "message_content": "Hola, mi suscripcion no se ha renovado.",
      "status": "PENDING",
      "created_at": "2026-11-17T09:15:42.000Z",
      "updated_at": "2026-11-17T09:15:42.000Z",
      "telegram_update_id": 482391756
    }
  ],
  "next_cursor": null
}
```

Tres cosas que conviene saber:

- **`username` y `response_text` pueden faltar** en el JSON: el primero si el usuario de Telegram no tiene nombre de usuario ni nombre propio; el segundo hasta que alguien responde el ticket. El resto de campos están siempre.
- **El cursor es opaco**: es un secreto interno de paginación del almacén. No lo parses, no lo generes tú, no asumas nada de su contenido; solo reenvíalo tal cual en `cursor` para pedir la siguiente página, y `next_cursor: null` significa fin de la cola. (El ejemplo sigue siendo un placeholder opaco **a propósito**: la codificación del cursor nace en la Fase 06 con el `GET` real; inventar un valor ahora sería congelar algo que aún no existe.)
- **El `id` de los ejemplos ya es real** (Fase 05): está derivado con `uuidv5(TG_UPDATE_NS, "tg:" + update_id)` bajo el namespace congelado `TG_UPDATE_NS = 57ef65e4-85f4-5f1d-a5c3-e55bd593494d` (D-69/D-75; el literal manda sobre la receta). `f53dea7a-383f-510d-b6ff-eddd5270f4b6` corresponde a `update_id 482391756`, y `7e364a81-28ea-5d7e-b335-21c4ab8e122f` a `update_id 482391757`. El ejemplo ilustrativo anterior (`2f6cf473-…`) quedó retirado. Para tu panel el `id` sigue siendo una cadena opaca que no cambias tú.
- **Nota de honestidad sobre el orden:** `created_at` descendente está garantizado *dentro de cada página*. Mientras la cola esté en el volumen objetivo (hasta unos 1.000–2.000 tickets), una sola página cubre todo y el matiz no se nota. Si el volumen crece, el orden entre páginas puede no ser estricto; la respuesta prevista es una mejora interna del servidor (migrar a índice y `Query`, fase futura), **no** un cambio de contrato. Tu panel puede tratar `next_cursor` como única forma de avanzar.

Respuestas: `200`, `400` (filtros inválidos), `401` (falta `x-api-key`), `403` (clave incorrecta).

---

## `PATCH /api/tickets/{id}` — cambiar el estado

**Para qué sirve:** marcar un ticket como atendido (`IN_PROGRESS`) o cerrarlo administrativamente (`RESOLVED`, **sin** responder al usuario; el cierre con respuesta es `reply`).

```bash
curl -X PATCH "https://SU-URL.lambda-url.eu-west-1.on.aws/api/tickets/f53dea7a-383f-510d-b6ff-eddd5270f4b6" \
  -H "x-api-key: SU_CLAVE" \
  -H "content-type: application/json" \
  -d '{"status":"IN_PROGRESS"}'
```

Reglas:

- El cuerpo es **exactamente** `{ "status": ... }` con valor `IN_PROGRESS` o `RESOLVED`. Cualquier otro campo, otra forma, o un valor fuera del enum → `400`.
- **Nada se reabre en la v1:** volver a `PENDING` no está permitido → `400`. Si hace falta reabrir, es una enmienda al contrato, no un bug.
- `id` inexistente → `404 NOT_FOUND`.
- Si dos agentes editan a la vez, gana el último (tamaño v1: una persona y sus agentes; no hay bloqueo optimista ni número de versión).
- En el `200` recibes el ticket completo con `updated_at` refrescado.

Respuestas: `200`, `400`, `401`, `403`, `404`.

---

## `POST /api/tickets/{id}/reply` — responder en Telegram y cerrar

**Para qué sirve:** escribir la respuesta al usuario **en su chat de Telegram** y cerrar el ticket. Es el único camino que produce `RESOLVED` con mensaje entregado.

```bash
curl -X POST "https://SU-URL.lambda-url.eu-west-1.on.aws/api/tickets/f53dea7a-383f-510d-b6ff-eddd5270f4b6/reply" \
  -H "x-api-key: SU_CLAVE" \
  -H "content-type: application/json" \
  -d '{"response_text":"Hola Ana: he revisado tu caso y la suscripcion queda renovada 30 dias mas."}'
```

Qué pasa dentro, por orden: se carga el ticket; si ya está `RESOLVED` se responde `409` **sin enviar nada**; si no, se envía el mensaje a Telegram **antes** de escribir nada; solo si Telegram confirma entrega se guarda `response_text`, se pasa el ticket a `RESOLVED` y se devuelve el ticket completo.

Los casos raros, que son los que importan aquí:

- **Telegram caído o el mensaje rechazado → `502 TELEGRAM_SEND_FAILED`, y el ticket queda intacto**: ni estado nuevo ni texto guardado. Puedes reintentar la llamada con la seguridad de que no has dejado el ticket a medias.
- **Riesgo anotado del reintento:** si el `502` se produjo porque Telegram sí recibió el mensaje pero la respuesta se perdió en el camino, reintentar puede **duplicar el mensaje al usuario**. En la v1 no hay clave de idempotencia de envío: la política es reintentar con criterio humano (el agente comprueba si el usuario ya recibió la respuesta). Queda registrado como riesgo aceptado en la spec de Fase 01 (§9.2).
- **`409 ALREADY_RESOLVED`:** reply sobre un ticket ya resuelto. Responde al mismo contrato que el `PATCH`: nada se reabre.
- **`400`:** `response_text` vacío o todo espacios (tras recortar debe tener entre 1 y 4096 caracteres), o cuerpo con campos extra.
- **`404`:** ticket inexistente.

Respuestas: `200`, `400`, `401`, `403`, `404`, `409`, `502`.

---

## Envelope de error: un único formato para todo

Todo error de toda la API usa el mismo cuerpo (decisión D-20):

```json
{ "error": { "code": "NOT_FOUND", "message": "ticket not found" } }
```

- `code`: enum cerrado, máquina-legible — haz el manejo de errores **sobre `code`**, nunca sobre el texto.
- `message`: texto legible para el operador del panel; puede cambiar, no lo parsees. Nunca contiene secretos ni el `message_content` del usuario.
- No hay `request_id` en la respuesta (v1): la correlación con los logs se hace con el `id` del ticket o el `update_id`.

| `error.code` | HTTP | Dónde aparece | Qué significa para ti |
|---|---|---|---|
| `VALIDATION_ERROR` | `400` | `GET` · `PATCH` · `reply` | enviaste algo fuera del contrato: campo, forma o valor de enum inválido — **o un cuerpo que el parser rechaza** (los cinco casos, tabla de abajo) |
| `UNAUTHORIZED` | `401` | `/api/*` | falta la cabecera `x-api-key` o está vacía |
| `FORBIDDEN` | `403` | `/api/*` y webhook | la clave no coincide con `ADMIN_API_KEY`, o el secreto del webhook falta o es incorrecto |
| `NOT_FOUND` | `404` | `PATCH` · `reply` | no hay ticket con ese `id` |
| `ALREADY_RESOLVED` | `409` | `reply` | el ticket ya está `RESOLVED`; reply no reabre |
| `TELEGRAM_SEND_FAILED` | `502` | `reply` | Telegram no aceptó el mensaje; el ticket quedó intacto |
| `INTERNAL` | `500` | cualquier `/api/*` | fallo inesperado del servidor. En el webhook **nunca** se emite: su guard lo convierte en `200 {"ignored":"internal_error"}` |

Los cinco rechazos del parser de cuerpo en **`/api/*`** son también `400 VALIDATION_ERROR` — nunca un 5xx — desde **D-62**. Estos son los cinco casos y su `message` literal (texto exacto que produce el código, `src/app.js`; programa contra `code`, no contra estos textos):

| Situación | `error.message` |
|---|---|
| JSON mal formado | `invalid JSON body` |
| Cuerpo que supera el límite de **64 KB** | `request body too large` |
| Charset no `utf-*` (p. ej. `charset=iso-8859-1`) | `unsupported charset` |
| `Content-Encoding` desconocido (p. ej. `bogus`) | `unsupported content encoding` |
| Descompresión fallida del `Content-Encoding` declarado (gzip/br/deflate/zstd con datos inválidos) | `invalid request body` |

El quinto caso es el que más cuesta entender: llega con `err.type === null` y `status 400`, así que lo cubre un respaldo **acotado a `status === 400`** — no a «cualquier 4xx»: un `404`/`409` que cayera ahí se convertiría en un `VALIDATION_ERROR` falso. Antes de este cambio, los cinco producían un **`500 INTERNAL`** provocable por cualquier cliente.

**Esto aplica solo a `/api/*`.** En **`/webhook/telegram` NO aplica**: el contrato exige que allí cualquier cuerpo no parseable o excesivo se absorba como **`200 {"ignored":"unsupported_update"}`** — implementado desde la Fase 05 (ola B), cerrando la divergencia que la spec 04 A-10 aplazó: antes respondía `internal_error` — (nunca 4xx/5xx), para que Telegram no reintente en bucle (I5). La **única** excepción es el `403` del secreto, que desde **D-70** se evalúa antes que cualquier consideración sobre el cuerpo.

El `500` no está declarado en ningún endpoint del contrato: es el fallback del envelope para lo inesperado. Si tu panel lo ve en `/api/*`, es un incidente nuestro, no un error de uso.

## Límites que hay que respetar (heredados de la plataforma, no negociables en v1)

| Límite | Valor | Consecuencia práctica |
|---|---|---|
| Tiempo de respuesta de una petición | 30 s | cada llamada es síncrona y corta; no hay procesos largos por HTTP |
| Payload de una petición | 6 MB (plataforma) · **64 KB (límite de la app)** | el límite de **64 KB** aplica a **todos** los cuerpos JSON — el webhook **y también `/api/*`** (D-62). Superarlo en `/api/*` responde `400 VALIDATION_ERROR` con `request body too large`; en el webhook se absorbe como `200 {"ignored":"unsupported_update"}` |
| `limit` de paginación | 1–100 (defecto 50) | no pidas páginas de 1.000 |
| `message_content` / `response_text` | 1–4096 caracteres | el tamaño máximo de un mensaje de Telegram de texto |
| Contenido del ticket en pantallas y logs | — | es **datos de usuario**: el servicio jamás lo loguea (política de logs D-18); cuídalo tú igual en el panel |
