# Plan del proyecto-hijo: el bot de Telegram

Actualizado: fase 01 · 2026-11-20

> Documento de diseño para el **proyecto aparte** del bot. No es una fase de este repo: es la semilla del repo-hijo (`subdesk-bot`, nombre provisional). Decisiones marco: D-37 (este repo entrega SOLO la API) y D-38 (separación por responsabilidades en dos proyectos hermanos). El contrato que el bot consuma es el de este repo: `docs/api/openapi.yaml` — el bot **no** puede exigir cambios del mismo sin enmienda aquí (I3).

## 1 · Reparto de responsabilidades (el principio)

| | **SubDesk API** (este repo) | **Bot** (repo-hijo) | **Panel** (futuro, tercer consumer) |
|---|---|---|---|
| Dominio | Gestión de tickets: recibir, guardar, estados, responder | Experiencia conversacional del usuario final | Operación humana de la cola |
| Sabe de suscripciones | **No.** Ve texto y devuelve texto | **Sí.** Es suya la interacción y el catálogo | Solo si algún día existe un dominio de comercio (proyecto aparte) |
| Expuesto a Telegram | Un endpoint de webhook (entrada) + llamadas `sendMessage` (salida, solo al responder) | **El webhook es de él**: Telegram llama al bot, no a SubDesk | No |
| Estado | `TicketsTable` (la única tabla) | **Stateless** (catálogo en config/SSM, nada de tabla propia sin decisión) | Ninguno |

Regla mnemotécnica: **el bot habla "como persona"; la API habla "como oficina de tickets"**. Todo lo que sea conversación, botones, comandos, marketing o catálogo es del bot. Todo lo que sea cola, estado y trazabilidad es de la API.

## 2 · Topología

```
 Telegram ⇄ ┌───────────────────────┐  update Telegram-format  ┌───────────────────────┐
            │ subdesk-bot (hijo)    │ ───────────────────────▶ │ subdesk-api (este)    │
            │ Lambda stateless 128M │  POST /webhook/telegram  │ Lambda+Express 256M   │
 user ─────▶│ Function URL #2       │  + X-…-Secret-Token      │ Function URL #1       │
            │ webhooks salientes:   │                          │ TicketsTable 25/25    │
            │  sendMessage, edición │ ◀─── respuesta 200/4xx ──│  reply → sendMessage  │
            └───────────────────────┘                          └───────────────────────┘
```

Dos stacks SAM, una cuenta, dos Function URLs. La cuenta sigue siendo $0: cada Lambda vive dentro de la misma franquicia always-free (1 M req + 400k GB-s **por cuenta**, compartida — con nuestro volumen, tres órdenes de margen entre los dos).

## 3 · El protocolo entre hermanos (única superficie compartida)

1. **Formato**: el bot reenvía a SubDesk un objeto **update de Telegram válido** (`update_id`, `message.chat.id`, `message.text`, `message.from…`). La API no distingue si el texto lo escribió el usuario o lo compuso el bot tras un botón: para ella es un mensaje.
2. **Idempotencia**: los `update_id` sintéticos del bot (reenvíos compuestos tras pulsaciones de botón) parten de **10¹⁵** hacia arriba; Telegram usa enteros muy por debajo en la práctica. El dedupe de SubDesk (`id` = uuidv5 del `update_id`, D-19) funciona igual para reales que sintéticos.
3. **Secreto**: el mismo `TELEGRAM_WEBHOOK_SECRET` viaja en la cabecera en ambos saltos (Telegram→bot no lo usa: el secreto lo inventamos nosotros; bot→API sí). El secreto entre bot y API es un tercer valor, **distinct** — lo define D-38 en su riesgo 3: cuando el bot pasa a ser el webhook público, SubDesk puede aceptar el secreto que comparta con el bot (mismo nombre de variable, valor nuevo en el redeploy de Fase 08).
4. **Orden de ack (crítico)**: el bot responde 200 a Telegram **solo después** de que SubDesk devuelva 2xx. Así el reintento de la plataforma reinyecta el update y el dedupe lo absorbe. Si el bot ackea a ciegas y SubDesk estaba caído, el mensaje se pierde para siempre.
5. **Botones**: `sendMessage` con `reply_markup` (inline keyboard); la pulsación llega como `callback_query` al webhook del bot, que responde con `answerCallbackQuery` + `editMessageText`. Nada de esto toca SubDesk **nunca**.

## 4 · El catálogo de suscripciones (capa de datos del bot)

| Fase del bot | Dónde | Regla |
|---|---|---|
| V1 (3–6 planes estables) | `catalog.js` en el repo del bot (o `Parameter` SAM) | Versionado con el código; cambiar = redeploy trivial |
| V2 (precios cambian sin redeploy) | SSM Parameter Store **Standard** (uno solo, JSON) | Franquicia always-free 10k reads/mes; lectura en cold-start con caché por invocación |
| V3 (catálogo gestionado desde panel) | **Prohibida la segunda tabla provisionada sin decisión + OK del usuario** (la bolsa 25/25 es por cuenta y `TicketsTable` la ocupa: D-26). Antes de una tabla, pensar en PAY_PER_REQUEST con su decisión D-29 o en que **SubDesk no debe ser el catálogo** — comercio es dominio propio | — |

## 5 · Lo que a propósito NO se hace

- Ni lógica de bot, ni botones, ni autoacks, ni catálogo dentro de SubDesk (D-37/D-38; I1; contrato congelado I3).
- Ni polling (`getUpdates`): proceso vivo 24/7 = factura y fragilidad (I1).
- Ni tabla propia del bot, ni SQS, ni step functions para "orquestar" el doble salto: son ~200 ms de HTTP sincrónico con reintentos de Telegram como red de seguridad.
- Ni variables nuevas en SubDesk: el contrato D-17 sigue en siete. El bot tiene las suyas (`TELEGRAM_BOT_TOKEN`, secreto compartido con la API, `API_BASE_URL`).

## 6 · Secuencia de aterrizaje (dependencias de fechas)

1. Aquí: **Fases 02–07** (código + tests) → **Fase 08**: deploy de la API y `setWebhook` apuntando **directamente a SubDesk** (modo tonto: el usuario escribe → ticket; ya vale para producción sin bot con personalidad).
2. Repo-hijo: nace con el harness copiado (misma compuerta `check.ps1`, pnpm I4b, D-27 topología, D-18 logs). Su Fase 08' hace `setWebhook` → URL del bot, y redeploya SubDesk con el secreto compartido actualizado.
3. Panel: consume la API directamente (fase 11). Ni se entera de que el bot existe.

Coste total prevido de los tres: **$0** (mismas franquicias, dos funciones Event, cero servicios facturables).
