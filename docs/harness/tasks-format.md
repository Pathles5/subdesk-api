# Formato de `tasks.md` (todas las fases, D-09 + I8)

Cada fase mantiene su `tasks.md` con esta tabla única. El documentador la sincroniza por orden del orquestador; las casillas `done` solo se marcan con evidencia **y con su fila *Docs* resuelta**.

```md
# Tasks — Fase NN <nombre>

Estado de fase: <draft|spec|tasks|implement|verify|decided|approved> (espejo del INDEX.md)

| ID | Tarea | Estado | Responsable | Solución validada | Docs (I8) | Evidencia |
|---|---|---|---|---|---|---|
| T-01 | <tarea> | pendiente | orquestador | — (pendiente visto) | <artefacto previsto> | — |
| T-02 | <tarea> | done | implementador | OK usuario (fecha/mensaje) | `docs/human/functional/api.md` + `docs/api/openapi.yaml` (Actualizado: fase NN) | <archivo> · lint/test/validate:api PASS |
```

## Estados válidos

`pendiente` · `propuesta` · `validada (en-flight)` · `impl-done` · `revisada-OK→done` · `revisada-FAIL` (vuelve a propuesta con reencuadre) · `bloqueada` (tras 2 bucles, D-08)

## Responsables esperados

`orquestador` · `implementador` (código) · `devops` (IaC y CI/CD) · `revisor` · `documentador` (documentación y sincronización) · `explorador` (investigación puntual por orden).

## Reglas de llenado

1. **ID estable**: nunca se renombra ni se reordena `T-xx`; una tarea cancelada queda en `bloqueada` con nota de motivo (no se borra).
2. **Solución validada**: columna obligatoria; se anota cuándo/por qué mensaje el usuario dio el visto (D-07). Sin visto, la tarea no puede estar `en-flight`.
3. **Docs (I8)**: columna obligatoria. O citas el artefacto realmente actualizado (`docs/human/**`, `docs/api/openapi.yaml`, `docs/human/diagrams/*.mmd`, `README.md`, `CHANGELOG.md`, `runbook.md`) con su marcador `Actualizado: fase NN`, o escribes `sin impacto` y el revisor lo confirma. **Ninguna tarea pasa a `done` con esta columna vacía.**
4. **Evidencia**: lo mínimo verificable — archivo(s) tocados, salida de compuerta (`check`/`lint`/`test`/`validate:api`/`validate:iac`, todas con **pnpm**, D-30) o el ID del informe del revisor.
5. **Correcciones**: no se crean tareas nuevas por cada bucle; la misma `T-xx` registra el intento en la evidencia (`bucle 1/2`, D-08). Al agotarlo: `bloqueada` + nota de lo intentado.
6. **Tareas de acción externa** (deploy, `setWebhook`, rotación de claves): responsable `orquestador`, y en evidencia se cita el mensaje exacto del visto del usuario. Nunca `done` sin ese visto (I6).
7. **Al cerrar la fase**: todas las `T-xx` en `done` (o bloqueadas examinadas y resueltas por el orquestador con nota), **frescura de `docs/human/**` verificada** (`check.ps1` → `I8: … present and fresh`) y `INDEX.md` actualizado.

## Enlace con la matriz de asignación

La definición de quién toca cada estado vive en `AGENTS.md` §3a (matriz de D-09, con la columna Documentación de I8). Esta plantilla es solo el formato de registro.
