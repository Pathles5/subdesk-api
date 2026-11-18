# Checklist — Subagente revisor fresh-eyes

Contexto que da el orquestador al revisor: ruta de la constitución, ruta de la spec, ruta de la entrega y qué NO saber (el revisor no sabe quién escribió el código ni detalles de la conversación).

El revisor compara la entrega contra `spec.md` y los criterios de aceptación, y devuelve un informe estructurado. Nunca escribe código ni despliega nada.

## Procedimiento del revisor

1. Lee `docs/specs/constitution.md` y la spec de la fase (`docs/specs/NN-<nombre>/spec.md`).
2. Ejecuta las compuertas: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`; desde Fase 02 `npm run lint` y `npm test`; desde Fase 03 `npm run validate:iac` (nunca un comando de despliegue).
3. Recorre el código/IaC contra la checklist fija y los criterios de la spec.
4. Informe con el formato de abajo.

## Checklist fija

- [ ] Constitución: ningún criterio violado (I1–I7).
- [ ] **I2 coste**: ninguna referencia a REST API (v1), provisioned capacity, NAT, CloudFront, WAF ni servicios fuera de Free Tier; memoria Lambda ≤ 256 MB.
- [ ] **I4 seguridad**: `/api/*` protegido con `x-api-key`; secreto del webhook validado si está configurado; cero secretos literales en código, tests, docs y workflows; ningún token en logs ni en mensajes de error.
- [ ] **I3 contrato**: campos y nombres exactos del modelo (`snake_case`), enum de estado cerrado, códigos HTTP según lo congelado en Fase 01.
- [ ] **I5 comportamiento**: el webhook devuelve 2xx también en los casos ignorados; sin duplicados por `update_id`; `RESOLVED` solo tras OK de Telegram; `updated_at` refrescado en toda mutación.
- [ ] IAM de menor privilegio: cada rol con acciones mínimas sobre recursos concretos (nada de `arn:aws:iam::...:role/admin` ni `*` en `Resource` salvo justificación en DECISIONS).
- [ ] Cada criterio de aceptación de la spec: verificado o marcado explícitamente como no verificable (nunca silenciado).
- [ ] Alcance: nada implementado fuera del alcance de la fase (ni endpoints extra, ni "mejoras obvias" del §10 del brief).
- [ ] Capas: las dependencias van en una dirección (`handlers → services → repositories|utils → config`); nada importa AWS SDK en handlers.
- [ ] Tests: cubren reglas de negocio y contratos, no cosmética; sin llamadas reales a Telegram ni a AWS.
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
