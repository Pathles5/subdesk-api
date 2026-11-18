# Checklist — Subagente revisor fresh-eyes

Contexto que da el orquestador al revisor: ruta de la constitución, ruta de la spec, ruta de la entrega, y qué NO saber (el revisor no sabe quién escribió el código ni detalles de la conversación).

El revisor compara la entrega contra `spec.md` y los criterios de aceptación, y devuelve un informe estructurado. Nunca escribe código, nunca instala dependencias, nunca despliega.

## Procedimiento del revisor

1. Lee `docs/specs/constitution.md` (I1–I7, incluido **I4b cadena de suministro**) y la spec de la fase (`docs/specs/NN-<nombre>/spec.md`).
2. Ejecuta las compuertas: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`; desde Fase 02 `pnpm run lint` y `pnpm test`; desde Fase 03 `pnpm run validate:iac` (= `cfn-lint template.yaml`). **No** `sam build` ni ningún comando de despliegue o de nube.
3. Recorre el código/IaC/config con la checklist fija y los criterios de la spec.
4. Informe con el formato del final.

## Checklist fija

- [ ] Constitución: ningún criterio violado (I1–I7 + I4b).
- [ ] **I2 coste**: 1 sola tabla `PROVISIONED` ≤ 25/25, sin auto scaling, sin GSI/LSI, sin Streams, sin PITR; 1 sola Lambda + 1 sola Function URL; `MemorySize` ≤ 256; sin `ProvisionedConcurrencyConfig`; ausencia total de `AWS::ApiGatewayV2::*`/`AWS::Serverless::HttpApi`; retención de logs ≤ 30 días.
- [ ] **I3 contrato**: campos del ítem exactos como en Fase 01 (`snake_case`), enum de estado cerrado, códigos HTTP del contrato.
- [ ] **I4 seguridad**: middleware `x-api-key` antes de cualquier acceso a DynamoDB; `AuthType: NONE` en la URL con CORS **solo** en IaC; cero secretos literales en código, tests, docs, plantilla y workflows; ningún token/clave en logs ni en payloads de error; `Parameters` con `NoEcho: true`; IAM sin wildcards.
- [ ] **I4b cadena de suministro**: `pnpm-lock.yaml` como único lockfile (sin `package-lock.json`/`yarn.lock`); `packageManager: pnpm@<x.y.z>` exacto; `pnpm-workspace.yaml` con `ignoreScripts`, `strictDepBuilds`, `allowBuilds`, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`; cero scripts de dependencias ejecutados (nada en `allowBuilds` sin entrada en `DECISIONS.md`); cero specs exóticas (`git:`, `github:`, `file:`, `tarball`, `link:`) y cero `pnpmfile`/`patchedDependencies` sin registrar; `fetch` nativo en lugar de `axios`, `crypto.randomUUID()` en lugar de `uuid`; artefacto Lambda con árbol **plano** (`nodeLinker: hoisted` o `pnpm deploy`) porque ZIP no conserva symlinks.
- [ ] **I5 comportamiento**: el router del webhook devuelve 2xx en todos los casos, incluidos fallo de parseo del body y excepción interna (una excepción sin capturar = invocación fallida = reintentos de Telegram); `RESOLVED` solo tras OK de Telegram; `updated_at` refrescado; `?status=` no se vende como ahorro de capacidad.
- [ ] Capas: dependencias en una sola dirección (`lambda|local → app → routes → middleware|services → repositories|utils → config`); `serverlessExpress` solo en `src/lambda.js`; AWS SDK solo en `repositories/`/`telegramService.js`.
- [ ] Cada criterio de aceptación de la spec: verificado o marcado explícitamente como no verificable (nunca silenciado).
- [ ] Alcance: nada implementado fuera del alcance de la fase (ni endpoints extra, ni "mejoras obvias" del §10 del brief).
- [ ] Tests: cubren reglas de negocio y contratos (con `supertest`/dobles), sin red real ni AWS real.
- [ ] `INDEX.md`: estado coherente con la entrega. `DECISIONS.md`: decisiones nuevas de esta fase registradas con IDs.
- [ ] Inglés en código, JSON, identificadores y comentarios; español en documentación.
- [ ] Deuda y deltas documentados como riesgo, no escondidos.

## Formato del informe

```md
## Informe de revisión — Fase NN
Veredicto: PASS | PASS with remarks | FAIL

### Criterios de aceptación
- C1: <criterio> → <evidencia> (cumplido / no cumplido / no verificable porque <motivo>)

### Desviaciones
<severidad: crítico/mayor/menor> — <descripción> — <evidencia/archivo>

### Riesgos para fases siguientes
<breve>
```
