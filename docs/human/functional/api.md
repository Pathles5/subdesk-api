# API en lenguaje humano — los 4 endpoints de SubDesk

Actualizado: fase 01 · 2026-11-19

> Documento para quien **integra el panel frontend** u **opera la conexión con Telegram**. El contrato machine-readable vinculante es `docs/api/openapi.yaml` (OpenAPI 3.1, nace en Fase 01): si alguna vez este texto y el contrato difieren, **manda el contrato** — repórtalo, no lo asumas. Aquí no hay jerga de AWS: qué envías, qué recibes y qué casos raros existen.

> **Alcance (importante):** esto es **una API**. El bot de Telegram **no vive en este repo ni se desarrolla aquí**: es externo y se creará después (BotFather, identidad y conversación fuera de estos entregables). La API lo único que hace con Telegram es *recibir* sus webhooks autenticados con el secreto y *enviar* mensajes con `sendMessage` usando el token configurado. Quien despliegue la API y cree el bot después solo tiene que registrar la URL del webhook (`runbook.md`, Fase 08) para que todo empiece a fluir.

## Visión de conjunto

| Método | Ruta | Para qué sirve | Auth | Éxito |
|---|---|---|---|---|
| `POST` | `/webhook/telegram` | Telegram avisa de un mensaje nuevo → nace un ticket | cabecera `X-Telegram-Bot-Api-Secret-Token` | `200` siempre (creado o ignorado) |
| `GET` | `/api/tickets` | cola de tickets para el panel, con filtro y paginación | cabecera `x-api-key` | `200` con `{ tickets, next_cursor }` |
| `PATCH` | `/api/tickets/{id}` | cambiar el estado de un ticket (sin responder al usuario) | cabecera `x-api-key` | `200` con el ticket actualizado |
| `POST` | `/api/tickets/{id}/reply` | responder al usuario **en su chat de Telegram** y cerrar el ticket | cabecera `x-api-key` | `200` con el ticket `RESOLVED` |

Las cuatro rutas conviven en una sola URL pública. En los ejemplos uso el placeholder `https://SU-URL.lambda-url.us-east-1.on.aws`; la URL real sale del despliegue de la Fase 08 y queda registrada en el `README.md` de la raíz. El campo JSON `id` de la ruta es el identificador opaco del ticket (un UUID; trátalo como caja negra).

### Autenticación, en dos frases

- **`/api/*`** (lo que llama tu panel): cabecera `x-api-key` con el valor de la variable de despliegue `ADMIN_API_KEY`. Falta o está vacía → `401`; presente pero distinta → `403`. La comprobación ocurre antes de tocar la base de datos.
- **`/webhook/telegram`** (lo que llama Telegram): cabecera `X-Telegram-Bot-Api-Secret-Token` con el secreto que se registró al configurar el webhook (variable `TELEGRAM_WEBHOOK_SECRET`). Ausente o distinto → `403`. Es **la única excepción** al `200` garantizado del webhook (se explica más abajo).

En este documento todos los valores son placeholders (`SU_CLAVE`, `SU_SECRETO`, `SU-URL`); ningún valor real va en el repo ni en la documentación. La rotación de ambas claves es una operación documentada en el `runbook.md` (Fase 08).

---

## `POST /webhook/telegram` — entrada de mensajes

**Para qué sirve:** cada mensaje de un usuario al bot llega aquí. Si es un mensaje de texto legítimo y nuevo, se crea un ticket en estado `PENDING`. Todo lo demás se descarta **sin error**.

```bash
curl -X POST "https://SU-URL.lambda-url.us-east-1.on.aws/webhook/telegram" \
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
| `unsupported_update` | tipo de update que no consume el bot (p. ej. `callback_query`), o cuerpo que no se puede parsear / pasa del límite declarado de 64 KB |
| `duplicate` | este `update_id` ya se procesó antes (es el reintento legítimo de Telegram: no se duplica el ticket) |
| `internal_error` | algo interno falló; el guard del webhook lo convierte en `200` para cerrar el bucle de reintentos y el suceso queda en los logs, no en la respuesta |

Las definiciones de los seis motivos están **congeladas** en la spec de Fase 01 §5.1 (enmienda A-01): la Fase 04 las implementa tal cual, no las reabre. Para ti como consumidor los tres primeros significan lo mismo: `200`, ningún ticket creado, no reintentes.

Ejemplos de ignoro:

```json
{ "ignored": "unsupported_update" }
{ "ignored": "duplicate" }
```

**El único `403` del webhook:** si la cabecera `X-Telegram-Bot-Api-Secret-Token` falta o no coincide. No rompe la promesa de arriba porque los reintentos legítimos de Telegram **siempre** llevan el secreto registrado; quien falla el secreto no es Telegram reintentando un update, es un tercero, y rechazarlo no provoca bucle de reintento alguno. Si al desplegar ves `403` masivos, casi seguro es un secreto de despliegue distinto del registrado con `setWebhook` (se comprueba en la prueba E2E de Fase 08).

Respuestas de este endpoint: `200` (creado o ignorado) y `403` (secreto inválido). No hay más.

---

## `GET /api/tickets` — la cola del panel

**Para qué sirve:** listar tickets, opcionalmente filtrados por estado, de más recientes a más antiguos.

```bash
curl "https://SU-URL.lambda-url.us-east-1.on.aws/api/tickets?status=PENDING&limit=50" \
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
      "id": "2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7",
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
- **El cursor es opaco**: es un secreto interno de paginación del almacén. No lo parses, no lo generes tú, no asumas nada de su contenido; solo reenvíalo tal cual en `cursor` para pedir la siguiente página, y `next_cursor: null` significa fin de la cola.
- **El `id` de los ejemplos es ilustrativo**: no es el UUID v5 real de ningún `update_id` (el namespace `TG_UPDATE_NS` se congela en Fase 02 y entonces se regeneran los ejemplos, D-35). Para tu panel es simplemente una cadena opaca que no cambias tú.
- **Nota de honestidad sobre el orden:** `created_at` descendente está garantizado *dentro de cada página*. Mientras la cola esté en el volumen objetivo (hasta unos 1.000–2.000 tickets), una sola página cubre todo y el matiz no se nota. Si el volumen crece, el orden entre páginas puede no ser estricto; la respuesta prevista es una mejora interna del servidor (migrar a índice y `Query`, fase futura), **no** un cambio de contrato. Tu panel puede tratar `next_cursor` como única forma de avanzar.

Respuestas: `200`, `400` (filtros inválidos), `401` (falta `x-api-key`), `403` (clave incorrecta).

---

## `PATCH /api/tickets/{id}` — cambiar el estado

**Para qué sirve:** marcar un ticket como atendido (`IN_PROGRESS`) o cerrarlo administrativamente (`RESOLVED`, **sin** responder al usuario; el cierre con respuesta es `reply`).

```bash
curl -X PATCH "https://SU-URL.lambda-url.us-east-1.on.aws/api/tickets/2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7" \
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
curl -X POST "https://SU-URL.lambda-url.us-east-1.on.aws/api/tickets/2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7/reply" \
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
| `VALIDATION_ERROR` | `400` | `GET` · `PATCH` · `reply` | enviaste algo fuera del contrato: campo, forma o valor de enum inválido |
| `UNAUTHORIZED` | `401` | `/api/*` | falta la cabecera `x-api-key` o está vacía |
| `FORBIDDEN` | `403` | `/api/*` y webhook | la clave no coincide con `ADMIN_API_KEY`, o el secreto del webhook falta o es incorrecto |
| `NOT_FOUND` | `404` | `PATCH` · `reply` | no hay ticket con ese `id` |
| `ALREADY_RESOLVED` | `409` | `reply` | el ticket ya está `RESOLVED`; reply no reabre |
| `TELEGRAM_SEND_FAILED` | `502` | `reply` | Telegram no aceptó el mensaje; el ticket quedó intacto |
| `INTERNAL` | `500` | cualquier `/api/*` | fallo inesperado del servidor. En el webhook **nunca** se emite: su guard lo convierte en `200 {"ignored":"internal_error"}` |

El `500` no está declarado en ningún endpoint del contrato: es el fallback del envelope para lo inesperado. Si tu panel lo ve en `/api/*`, es un incidente nuestro, no un error de uso.

## Límites que hay que respetar (heredados de la plataforma, no negociables en v1)

| Límite | Valor | Consecuencia práctica |
|---|---|---|
| Tiempo de respuesta de una petición | 30 s | cada llamada es síncrona y corta; no hay procesos largos por HTTP |
| Payload de una petición | 6 MB | irrelevante con mensajes de Telegram; el webhook declara su propio límite más ajustado: 64 KB |
| `limit` de paginación | 1–100 (defecto 50) | no pidas páginas de 1.000 |
| `message_content` / `response_text` | 1–4096 caracteres | el tamaño máximo de un mensaje de Telegram de texto |
| Contenido del ticket en pantallas y logs | — | es **datos de usuario**: el servicio jamás lo loguea (política de logs D-18); cuídalo tú igual en el panel |
