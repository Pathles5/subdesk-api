# Operaciones — SubDesk API

Actualizado: fase 02 · 2026-11-20

> Documento para **levantar y comprobar el proyecto en local**. La topología y las reglas de capas están en `architecture.md`; el contrato es `docs/api/openapi.yaml`; las decisiones con su historia, en `DECISIONS.md` (se enlazan por ID). Despliegue, `setWebhook`, rotación y coste: `docs/human/runbook.md` (nace en Fase 03).

## Arranque local

```bash
cp .env.example .env          # edítalo con TUS valores; .env NUNCA se commitea
pnpm install --frozen-lockfile
pnpm run dev                  # node --env-file=.env src/local.js
```

La app escucha en `http://localhost:3000` (`PORT` en `.env`, default 3000; es la única variable local del contrato D-17). `src/config.js` es quien lee el entorno: si falta alguna de las cuatro obligatorias (`TABLE_NAME`, `TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`) el arranque falla con un `ConfigError` que **lista nombres, nunca valores** (I4). `LOG_LEVEL` (default `info`), `STAGE` (default `dev`) y `PORT` admiten ausencia.

**Es la misma aplicación que corre en Lambda.** `src/local.js` hace `app.listen()` sobre `createApp()`; `src/lambda.js` pasa ese mismo árbol por el adaptador `serverless-http@3.2.0` (D-28). El adaptador **solo** se importa ahí — ESLint lo prohíbe en cualquier otro archivo —, así que lo que pruebas en local es lo que se despliega, menos el envoltorio del evento.

No hay comando `deploy` ni nada que toque AWS desde este repo en local: la infraestructura todavía no existe (nace en la Fase 03) y ningún despliegue ocurre sin propuesta con comandos exactos y **visto tuyo** (I6).

## Compuertas y qué prueba cada una

| Comando | Qué comprueba | Estado en esta fase |
|---|---|---|
| `pnpm install --frozen-lockfile` | dependencias reproducibles contra `pnpm-lock.yaml`, **sin ejecutar scripts de dependencias** (I4b/D-30); `allowBuilds` sigue `[]` | ✓ |
| `pnpm run lint` | ESLint flat config sobre `src/` + `tests/`. No es solo estilo: **mecaniza la arquitectura** (spec §7) — `process.env` solo en `src/config.js` (D-17) y `serverless-http` solo en `src/lambda.js` (D-28). `@aws-sdk/*` ya está vetado en `src/`: cuando Fase 04 lo instale hará falta el bloque que lo **permita** dentro de `src/repositories/`, y los tests siguen exentos de las restricciones de import | ✓ |
| `pnpm test` | `node --test "tests/**/*.test.js"` → **27 tests**: unidades de `apiKey` (401/403), `webhookGuard` (gate de secreto y ack), `config` (las 7 variables, errores sin valores), smoke de la app con `supertest` (los 4 endpoints como stub `501`, `404`, `403` de secreto y `400` de JSON malformado) y el **test de contrato de superficie** | ✓ 27/27 |
| `pnpm run validate:api` | `redocly lint docs/api/openapi.yaml` (D-33). Rompe solo con **errores**; hoy pasa con 1 warning deliberado y aceptado: `info-license` (no tenemos licencia que citar) | ✓ |
| `pnpm run check` | `scripts/check.ps1`: compuerta del harness — frescura de `docs/human/**` (I8), higiene de secretos, asserts de cadena de suministro (I7) y forma del contrato | verde **con los artefactos de esta fase ya escritos**; su corrida formal se registra en T-09 |
| smoke manual en dev | los 5 casos de abajo contra `pnpm run dev`, con `curl` | ver siguiente bloque |

### Smoke manual (los 5 casos verificados en seco)

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

# 4) webhook con secreto válido -> 501 (el handler de ingesta llega en Fase 04)
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
| `403 FORBIDDEN` — `invalid webhook secret` | falta `X-Telegram-Bot-Api-Secret-Token` o difiere de `TELEGRAM_WEBHOOK_SECRET` | el secreto registrado con `setWebhook` debe ser **el mismo** que el de la variable de entorno (runbook, Fase 08); si no lo es, todo el webhook falla en silencio con 403 (riesgo anotado en D-21) |
| `501 INTERNAL` — `not implemented yet — Fase N` | el andamiaje aún no tiene handler | espera a la fase indicada; no es un fallo |

## Política de logs aplicada (D-18)

**Un evento JSON por línea**: `{ "level", "ts", "msg", ...campos del evento }`. Los campos esperados son los del allowlist de D-18 (`ticketId`, `updateId`, `statusCode`, `durationMs`) más identificadores operativos; nunca se serializa `req.body` ni una cabecera.

La redacción es **por construcción**, no una promesa: `src/utils/logger.js` mantiene la lista de nombres prohibidos (`botToken`, `telegramBotToken`, `adminApiKey`, `apiKey`, `webhookSecret`, `messageContent`, `text`, `x-api-key`) y, al encontrarlos, escribe `"[redacted]"` y, si el valor era un string, su **longitud** en `<campo>Length`. Así no depende de que el programador recuerde no loguear el token: aunque lo intente, no sale (I4).

- `LOG_LEVEL=silent` existe y está testiado como valor válido: no emite nada. Sirve para correr suites o herramientas sin ensuciar la salida (en el smoke de tests alguna línea `error` sí aparece, porque el guard del webhook registra sus fallos — no es un fallo del test).
- El `webhookGuard` loguea con un logger propio de umbral `info`, para que un error del webhook sea visible aunque el entorno esté en `error`.
- Retención de CloudWatch (≤ 30 días) y límites de plataforma: se documentan en Fase 03 con el `template.yaml`.

## Cuarentena de dependencias (`minimumReleaseAge: 1440`)

Es una **política de cadena de suministro**, no una preferencia: pnpm rechaza resolver cualquier versión publicada en las últimas 24 horas (D-30, I4b). El motivo es el historial que justifica todo el apartado: paquetes comprometidos en el registro público el mismo día de su publicación.

Qué hizo ayer en este repo: `@redocly/cli` **2.82.0** se había publicado esa misma mañana y la cuarentena **bloqueó la instalación**. La respuesta fue bajar a `2.81.0` (ya cuarentenada), **no** tocar la política.

Si algún día hace falta eximir un paquete (por ejemplo un fix de seguridad urgente que solo exista en una versión recién publicada), **no es un ajuste local**: exige decisión registrada en `DECISIONS.md` con nombre, versión, motivo **y tu OK explícito**, aplicando `minimumReleaseAgeExclude` solo a ese paquete — nunca global (riesgo 2 de D-30). Lo mismo aplica a `allowBuilds`, `pnpmfile` o `patchedDependencies`.
