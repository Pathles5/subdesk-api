# Spec — Fase 02 · Scaffold del proyecto (ESM, lint, scripts)

Estado de fase: **spec** (ver `docs/specs/INDEX.md`)
Dependencias: Fase 01 cerrada (contratos congelados I3). Compuerta (§4 AGENTS): `pnpm install --frozen-lockfile` + `pnpm run lint` + `pnpm test` + `pnpm run validate:api` + test de contrato + `check.ps1`; docs `README.md`/`CHANGELOG.md`/`operations.md` ejecutables.

## 1. Objetivo

Que el repo pase de papel a proyecto Node ejecutable con las compuertas vivas: ESM, pnpm fijado, ESLint, runner de tests, `.env.example`, el esqueleto de capas de D-16 (sin lógica de negocio) y el **test de contrato superficie** contra `docs/api/openapi.yaml` (I8b.4). Aquí nacen `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `src/` y `tests/`.

## 2. Alcance

- Decisiones con visto: **D-28** (versión de pnpm/Node y adaptador Express↔Function URL definitivo) y **D-23** (framework y estrategia de tests).
- `package.json` ESM con `packageManager` exacto, `engines`, y los scripts de la tabla §5.
- `pnpm-workspace.yaml` con toda la política I4b/D-30 (incluido `nodeLinker: hoisted` para el futuro artefacto Lambda).
- ESLint flat config + reglas que **mecanizan la regla de capas D-16** (import restrictions + `no-process-env` salvo `config.js`).
- Esqueleto `src/` real: `config.js`, `app.js` (fábrica con DI), `middleware/apiKey.js` y `webhookGuard.js` **completos y testeados** (no son lógica de negocio, son superficie de seguridad I4), `routes/telegram.js` y `routes/tickets.js` como stubs `501` + `registry.js` (fuente única rutas↔contrato), `utils/` mínimos (`http.js`, `logger.js` con la política D-18; `validation/ids/time` llegan con quien los usa), `lambda.js`, `local.js`.
- `tests/` con `node:test` + `supertest`: unidades de middleware/config + smoke de app + `tests/contract/openapi.test.js` (superficie).
- Docs I8: actualizar `README.md` (comandos ya reales), `CHANGELOG.md` (nace), `technical/operations.md` (nace: dev local, env, lint/test/validate).

## 3. Fuera de alcance

- Handlers de negocio (Fases 04–07), DynamoDB y su SDK (Fase 04), `template.yaml` (Fase 03), CI (Fase 08), export de diagramas (Fase 03; `@mermaid-js/mermaid-cli` **no** se instala hoy).
- `docs/api/api.html` (opcional; el script puede nacer hoy, el html no se commitea hasta que alguien lo pida).

## 4. Decisiones propuestas

### 4a. D-28 — Runtime, gestor y adaptador (con evidencia de registro del 2026-11-20)

- **pnpm: `10.18.1` exacta** en `packageManager` (= versión instalada en la máquina del developer; CI usará la misma vía `pnpm/action-setup`, Fase 08).
- **Node: motor local 22.20.0; `engines.node: ">=20 <23"`.** El runtime Lambda concreto (`nodejs20.x` vs `nodejs22.x`) se fija en Fase 03 con el template — ahí se verifica disponibilidad regional; el scaffold no lo decide.
- **HTTP framework: `express@5.3.0`** (tag `latest` actual; 4.22.3 queda en `latest-4` como plan B documentado).
- **Adaptador Express↔Function URL: `serverless-http@3.2.0`** — ⚠️ **corrige una premisa de la Fase 00**: `@vendia/serverless-express` está en **4.12.6** sin releases nuevos; el "v5.0.0" que citaba la spec de Fase 00 (§8b/§10d) pertenece al *fork* (CodeGenieApp/serverless-express), no al paquete npm que instalaríamos. Opciones reales: (a) vendia 4.12.6 (estable pero dormido, y su API `serverlessExpress({app})` difiere de la citada en docs), (b) **serverless-http 3.2.0** (mantenido, mínimo, soporta payload v2.0 de Function URL, framework-agnostic), (c) adaptador propio ~80 líneas. **Propuesta: (b)**, con la regla D-16 intacta: `src/lambda.js` es el ÚNICO archivo que lo importa; si al probarlo contra Function URL reales (Fase 08) fallara, el plan B es (c) sin tocar `app.js`. Riesgo asumido: Express 5 + serverless-http es combinación nueva → el smoke test de `createApp()` con supertest (sin adaptador) mantiene el 99 % de la superficie testeable aparte del adaptador.

### 4b. D-23 — Tests: `node:test` + `supertest@7.3.2`, mocks por inyección

- Runner: **`node:test`** (nativo del runtime, cero dependencias, `--test` con glob propio; I4b mínimo). Assertions `node:assert/strict`.
- HTTP: **`supertest`** contra `createApp(deps)` — la app real, sin Lambda ni red (patrón D-16).
- **Mocks sin librerías**: `telegramService` y repositorio reciben sus dependencias por parámetro (fetch real inyectado en prod, fake en test). Nada de `nock`/`aws-sdk-mock`/DynamoDB-local (el scope del SDK llega en Fase 04 con su repo y su fake en memoria; el contrato del fake lo fija esa fase).
- **Test de contrato (I8b.4), alcance Fase 02 = SUPERFICIE**: `tests/contract/openapi.test.js` lee `docs/api/openapi.yaml` (devDep `js-yaml`) y `src/routes/registry.js` y verifica igualdad de paths+methods y de la exigencia de `x-api-key` por path. Los **códigos por endpoint** se verifican incrementalmente en las fases 04–07 al sustituir cada stub `501` por el handler real (el stub devuelve `501 {"error":{"code":"INTERNAL","message":"not implemented yet — Fase N"}}` con N ∈ 4/5/6/7; el 501 es estado de andamiaje, no contrato).
- Convención de nombres: `tests/**/*.test.js` espejando `src/`; script `pnpm test` = `node --test "tests/**/*.test.js"` (el glob explícito porque Node 22 trata el argumento de directorio como entry point).

## 5. Scripts y `package.json` (nacen ejecutables)

| Script | Comando | Nota |
|---|---|---|
| `dev` | `node --env-file=.env src/local.js` | mismo `createApp()`; `.env` local nunca commiteado |
| `test` | `node --test "tests/**/*.test.js"` | incluye el test de contrato |
| `lint` | `eslint .` | flat config, `src/` + `tests/` |
| `check` | `powershell -File scripts/check.ps1` | compuerta del harness |
| `validate:api` | `redocly lint docs/api/openapi.yaml` | **D-33**; enmienda de precisión 2026-11-20: `--fail-severity` NO existe en @redocly/cli 2.81 (falló el gate en vivo) — por defecto redocly ya solo rompe con ERRORS; nuestro documento pasa con 1 warning (`info-license`, decorativo y deliberado: sin licencia que citar). Si un día un warning debe romper, se decide entonces con config file |

Dependencias runtime de la fase: `express@5.3.0`, `serverless-http@3.2.0`. Dev: `eslint@10.15.0`, `@eslint/js@10.0.1`, `globals@17.14.0`, `supertest@7.3.2`, `js-yaml@5.5.0`, `@redocly/cli@2.81.0` (⚠️ enmienda de precisión 2026-11-20: se había fijado 2.82.0, publicada ayer 15:38 — la cuarentena `minimumReleaseAge: 1440` de D-30 la bloqueó **funcionando como debe**; se fija 2.81.0, publicada ayer 11:01 UTC y ya cuarentenada. La política no se toca: si se quisiera excluir un paquete de la cuarentena haría falta decisión + OK del usuario, `minimumReleaseAgeExclude`). Cero paquetes con scripts de build (`allowBuilds: []` debe seguir en `[]` tras `pnpm install --frozen-lockfile`; si alguno pidiera build, se PARA y se reporta — I4b).

## 6. `pnpm-workspace.yaml` (I4b/D-30 completo)

```yaml
packages: ["."]
nodeLinker: hoisted          # artefacto Lambda sin symlinks (D-30; Fase 03 consume)
ignoreScripts: true
strictDepBuilds: true
allowBuilds: []
minimumReleaseAge: 1440      # 24 h de cuarentena a versiones nuevas
trustPolicy: no-downgrade
blockExoticSubdeps: true
verifyStoreIntegrity: true
verifyDepsBeforeRun: true
enablePrePostScripts: false
```

## 7. Reglas ESLint que mecanizan la arquitectura (flat config)

- `no-restricted-imports`: `process.env` permitido **solo** en `src/config.js` (D-17); `serverless-http` solo en `src/lambda.js` (D-16/D-28); `@aws-sdk/*` (cuando exista) solo en `src/repositories/` — regla escrita ya para Fase 04.
- `no-unused-vars` error, `eqeqeq`, `strict`; ESM `ecmaVersion: latest`.
- Sin prettier (una opinión menos; el estilo lo fija el lint).

## 8. Criterios de aceptación

- **C1** — `pnpm install --frozen-lockfile` concluye sin scripts de dependencia; `pnpm-lock.yaml` único lockfile; `packageManager` = `pnpm@10.18.1` exacto; `allowBuilds` sigue `[]`.
- **C2** — `pnpm run lint` en verde sobre `src/` + `tests/` incluyendo las reglas de capas §7 (probar que una import prohibida falla — verificación con fixture temporal borrado después).
- **C3** — `pnpm test` en verde: unidades de `apiKey` (401/403/`timingSafeEqual`), `webhookGuard` (excepción → 200 `ignored/internal_error`), `config` (lectura estricta de las 7), smoke supertest (rutas stub 501 + envelope 404) y **contrato de superficie** paths/methods/auth.
- **C4** — `pnpm run validate:api` en verde (redocly lint con la configuración `recommended` incorporada; los warnings no rompen el exit code — así se entregó tras descubrir en el gate que `--fail-severity` no existe en @redocly/cli 2.81; ver enmienda de §5 y A-02).
- **C5** — `pnpm run check` (o `powershell -File scripts/check.ps1`) PASS con Fase 02 en curso — con `README.md`, `CHANGELOG.md` y `operations.md` presentes y frescos (marca `fase 02`), y `tests/contract/` existiendo (los cuatro FAIL actuales del gate se apagan aquí).
- **C6** — `pnpm run dev` levanta la app en `PORT` local y responde (verificado en seco: arranca, responde `401` a `/api/tickets` sin key, `404` envelope a ruta inexistente; se documenta en `operations.md`).
- **C7** — Ningún secreto/valor real en `.env.example`: los 4 nombres sensibles en forma con ángulos (`<TABLE_NAME>`…; también evita falsos positivos del escáner, que casa `NOMBRE=valor-largo`), y `LOG_LEVEL`/`STAGE`/`PORT` con valores neutros de ejemplo (`info`/`dev`/`3000` — no son secretos). Escáner de secretos verde.
- **C8** — Registro en `DECISIONS.md` de D-28 y D-23 con la evidencia del registro npm (2026-11-20) incluida la corrección de la premisa vendia-v5 de Fase 00.

## 9. Riesgos / desviaciones

1. **Express 5 + serverless-http sin prodar aquí**: el adaptador solo se ejercita de verdad en Fase 08; hasta entonces, `app.js` vive fuera del adaptador (decisión D-28 lo aísla en `lambda.js`). Plan B (c) propio sigue vivo.
2. `@redocly/cli` arrastra tree grande en dev (ciento y pico de paquetes): aceptado en D-33; no entra al artefacto Lambda (deploy con `--prod`).
3. `minimumReleaseAge: 1440` puede bloquear una versión publicada ayer que una dependencia exija en futuro — la política es intencionada (I4b); se resolvería con wait, no con relax sin decisión.
4. `node --test` + supertest: sin recuento de cobertura (no hay umbral en v1; se revisa en Fase 09).
5. Corrección D-28 demuestra que una cita de docs (Fase 00 §8b) puede envejecer mal: el gate de Fase 02 fija versiones contra **registro**, no contra prosa.

## 10. Amendments

- **A-01 · 2026-11-20 (reparación sintáctica del contrato, sin cambio de forma)** — El `pnpm run validate:api` de esta fase (primer parser YAML real que toca el documento) destapó que el contrato congelado de Fase 01 era **YAML inválido** en 3 líneas: 290 y 426 (descripciones que *comienzan* con backtick, carácter reservado) y 447 (un `: ` interior sin comillas). Se repararon entrecomillando los tres escalares; **cero cambios en paths, schemas, códigos ni ejemplos**. Lección mecanizada: desde hoy el parseo real del contrato lo garantizan `validate:api` y el test de contrato en cada gate; el regex de forma de `check.ps1` solo complementa.
- **A-02 · 2026-11-20 (precisiones post-entrega del implementador, informe T-07/T-08)** — cuatro alineaciones de la prosa de esta spec con el entregado real, sin cambio de diseño: (§4b/§5) el script `test` usa glob explícito `"tests/**/*.test.js"` (Node 22 trata el directorio como entry point); (§4b) el mensaje del stub es `not implemented yet — Fase N` con N ∈ 4/5/6/7 (sin cero); (§5/C4) `validate:api` sin `--fail-severity` — la bandera no existe en @redocly/cli 2.81 y el recommended por defecto ya solo rompe con errores; (§C7) los placeholders con ángulos son los 4 sensibles, y `LOG_LEVEL`/`STAGE`/`PORT` llevan valores neutros. Además: `eslint.config.js` ganó el override que permite `@aws-sdk/*` **solo** en `src/repositories/**` (la regla §7 pedía permitirlo allí; el config entregado lo vetaba en todo `src/` — divergencia 5 del documentador, corregida con `lint` re-corrido). Convención de frescura fijada (divergencia 1): el marcador `Actualizado: fase NN` significa *última fase en que el artefacto fue revisado y se declaró vigente*, y al cerrar cada fase se sube el marcador de **todos** los artefactos requeridos — es el mecanismo literal que AGENTS §6 y `check.ps1` aplican, y deja de leerse como "última edición".
- **A-03 · 2026-11-20 (cierre — revisión fresh-eyes)** — Seis observaciones del revisor, todas resueltas antes de `verified`: (1) **BOM UTF-8** que los `Set-Content -Encoding UTF8` de PowerShell del cierre introdujeron en 6 archivos (contrato incluido): eliminado, gates re-corridos, y anotado el mecanismo correcto (`[IO.File]::WriteAllBytes`) para futuros reescritados; (2) la congelación de `TG_UPDATE_NS` se traslada formalmente a Fase 04 (**D-39**) y se reescribieron las tres menciones «Fase 02» (data-model, api.md, prosa del contrato — precedente D-37: sin tocar formas); (3) la regla 4 del índice de `docs/human/README.md` prometía «códigos y schemas» en el test de contrato desde esta fase — redactada en dos tiempos (superficie+auth ahora; códigos al caer cada stub); (4) `operations.md` y el `README.md` raíz conservaban prosa pre-Fase 02 («todavía no existe») — actualizada al estado real; (5) los huecos de mecanización de `check.ps1` (deuda heredada de Fase 00) **se cierran aquí**: asserts nuevos `engines.node`, `patchedDependencies`→FAIL, `verifyStoreIntegrity`/`verifyDepsBeforeRun`/`enablePrePostScripts` en la lista de settings y `allowBuilds` no-vacío→FAIL; (6) la observación 8 (tests del logger por nombre de campo, malformed-JSON del webhook sobre la app real → 200 `unsupported_update` según contrato, mounting↔registry) queda registrada como exigencia de Fase 04 en el INDEX.
- **A-04 · 2026-11-22 (el adaptador de D-28 resulta incompatible con `body-parser@2` de Express 5: bump a `serverless-http@4.0.0`, y la estrategia de tests de D-23 gana la capa que le faltaba — D-62)** — Descubierta en Fase 04 al ejercitar por primera vez la Function URL viva (diagnóstico completo y evidencia en spec 04 **A-10**). Se enmienda aquí porque afecta a dos decisiones de esta spec:
  1. **§4b / D-28 (adaptador).** `serverless-http@3.2.0` construía el `IncomingMessage` con un **socket-stub** (`readable: false`) y `complete: true`. `body-parser@2.4.0` —el que trae `express@5.3.0`— decide «cuerpo ya parseado» con **`onFinished.isFinished(req)`**, donde body-parser 1.x usaba `req._body`, y ese stub la devuelve `true`. Resultado medido: **`express.json()` nunca parseaba bajo Lambda** y `req.body` quedaba en el **Buffer crudo** que asigna el adaptador, así que el `400 VALIDATION_ERROR` del contrato era inalcanzable y en F05–F07 todo `req.body.*` habría salido `undefined`. Fijado con **`serverless-http@4.0.0`**, cuyo `request.js` usa un `PassThrough` real (stream de verdad: `readable` y con `.on`) y emite `'end'` cuando no hay cuerpo. Versión **exacta** con `--save-exact`, para no introducir un rango `^` contra el pinning de D-28. Export idéntico (`module.exports = function (app, opts)`) ⇒ **`src/lambda.js` no cambia** y la regla D-16 (único importador del adaptador, mecanizada por ESLint) sigue intacta. Cadena de suministro (I4b): **10 líneas** de diff en el lockfile, el único paquete que entra/sale es `serverless-http`, cero dependencias transitivas nuevas, sin scripts de instalación, publicada 2025-09-01 (cumple `minimumReleaseAge: 1440`) y upgrade (cumple `trustPolicy: no-downgrade`). La premisa de D-28 («mantenido, mínimo, soporta el payload v2.0») sigue siendo cierta; lo que **no** lo era en 3.2.0 es su compatibilidad con Express 5, y el riesgo que D-28 registró textualmente se materializó cuatro fases antes de lo previsto. Se descartó el shim propio **midiéndolo**: devolvía el 400 pero crasheaba el proceso con cuerpos >64 KB (`TypeError: ee.on is not a function` en `on-finished`/`dump`), porque el stub no es `EventEmitter`.
  2. **§4b / D-23 (tests).** La suite daba **37/37 con el defecto puesto**, porque `supertest` ejercita `createApp` **sin** el adaptador. Se añade la capa que faltaba: `tests/lambda.adapter.test.js`, que invoca el handler con **eventos Function URL v2.0 sintéticos** (cero red, cero AWS, cero coste — I2) y fija entre otros `Buffer.isBuffer(req.body) === false`, el assert directo contra el defecto. La estrategia de D-23 no se reescribe: **se completa**. Regla que queda para el resto de fases: *toda afirmación sobre el comportamiento en Lambda necesita un test que pase por el adaptador*, no sólo por la app Express. `eslint.config.js` ya eximía a los tests de las restricciones de capa, así que no hizo falta tocarlo.
  3. **Corrección de la observación (6) de A-03.** Decía que el caso «malformed-JSON del webhook sobre la app real → 200 `unsupported_update`» quedaba registrado «como exigencia de **Fase 04** en el INDEX». El `INDEX.md` —fuente de verdad del estado según AGENTS §1— lo lista en L15/L81 como **deuda heredada por Fase 05**, y es lo coherente: en F04 toda la superficie webhook es *stub* y el propio smoke admite `[200,501]` en esos escenarios. Se hace caso al INDEX y la discrepancia queda anotada en vez de resolverse en silencio; la deuda sigue viva y su propietario es F05. Dato añadido: hasta D-62 ese caso era **inejecutable**, porque el `express.json()` del router de Telegram también estaba saltado — un cuerpo roto ni siquiera producía error: llegaba al stub como Buffer. Hoy ya produce el error y `webhookGuard` lo absorbe como `200 {"ignored":"internal_error"}`; falta que el valor sea `unsupported_update`, que es justo la deuda de F05.

