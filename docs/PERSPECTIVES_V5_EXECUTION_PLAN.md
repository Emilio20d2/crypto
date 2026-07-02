# Plan de ejecucion Perspectivas V5

Fuente de verdad principal: [Issue #5](https://github.com/Emilio20d2/crypto/issues/5) y su comentario "ORDEN CANONICO DE EJECUCION - PERSPECTIVAS V5 Y OPERACIONES REALES".

Pull request relacionado: [PR #4](https://github.com/Emilio20d2/crypto/pull/4).

Estados permitidos: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `CODE_COMPLETE`, `TESTED`, `VALIDATED`.

## Linea base de Fase 0

- Fecha de auditoria: 2026-07-02.
- Rama local auditada inicialmente: `codex/perspectives-v5-clean-rebuild`.
- Commit local auditado inicialmente: `1203e93dfa32d121298878dfc2b6071dbce24083`.
- Rama de ejecucion creada desde el PR #4: `codex/issue5-execution`.
- Commit base de la rama de ejecucion: `3cf1354c4afd4de0410cc4233c46798078183436`.
- `origin/main`: `bc5a3ddb6a8f8f3ef003e8b7841763c63a04486e`.
- PR #4: rama `codex/cache-market-automation`, head `3cf1354c4afd4de0410cc4233c46798078183436`, estado `open`, `draft=true`, mergeable `clean`.
- Rama remota `origin/codex/perspectives-v5-clean-rebuild`: `0627f414739449e904983152f368a95ee413e81d`.
- App instalada en `/Applications/Crypto Control.app`: commit `1203e93dfa32d121298878dfc2b6071dbce24083`, rama `codex/perspectives-v5-clean-rebuild`, build `2026-07-02T04:53:16.297Z`.
- Copia verificada de base real: `/private/tmp/crypto-control-backups/phase0-issue5-20260702-113642.sqlite`, `PRAGMA integrity_check = ok`.

## Bloqueos detectados en Fase 0

- La app instalada (`codex/perspectives-v5-clean-rebuild` en `1203e93`) no coincide con la rama del PR #4 (`codex/cache-market-automation` en `3cf1354`).
- El commit local instalado `1203e93` no esta publicado en `origin/codex/perspectives-v5-clean-rebuild`, que permanece en `0627f414`.
- Se creo la rama local `codex/issue5-execution` desde `origin/codex/cache-market-automation` para continuar sobre la base canonica del PR #4.
- El DMG instalado fue generado antes de validar las fases 0-14 de la issue #5; por la regla de la issue, no puede considerarse DMG final.
- La busqueda exigida por la issue no devuelve cero porque `packages/portfolio/dist/perspectives/sim-engine.*` aun contiene `runPerspectivesSimulation`.
- No hay `gh` instalado. La lectura por API publica funciona, pero comentar en la issue y empujar commits requieren credenciales de escritura verificadas.
- Existe `commissionRate: 0` en `packages/portfolio/src/perspectives/types.ts`; debe auditarse en fase 1 para confirmar si sigue dentro de algun artefacto productivo o debe eliminarse.

## Tabla de ejecucion

| Fase | Estado | Dependencias | Objetivos | Archivos afectados | Migraciones | Pruebas necesarias | Evidencia | Commit | Bloqueos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FASE 0 - Estado real, commits, rama, base de datos y linea base | VALIDATED | Ninguna | Fijar estado local/remoto/PR/DMG, copia de DB, riesgos y ruta de trabajo | `docs/PERSPECTIVES_V5_EXECUTION_PLAN.md`, `docs/tasks/CRYPTO_CONTROL_PROGRESS.md` | Ninguna | Git/PR/issue audit, backup DB, grep legacy V5/V4, `npm --prefix packages/portfolio run typecheck` | Issue #5 leida, comentario canonico leido, PR #4 auditado, backup DB verificado, rama `codex/issue5-execution` creada desde PR #4 | Pendiente | Push/comentario issue pendientes por credenciales no verificadas; app instalada no coincide con PR y se validara de nuevo en Fase 15 |
| FASE 1 - Migracion productiva completa a Perspectivas V5 | VALIDATED | FASE 0 VALIDATED | Demostrar V5 productivo, eliminar grafo V4, DTO V5 nativo | `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`, `apps/web/src/lib/setupApi.ts`, `apps/web/src/pages/Perspectivas.tsx`, `packages/core/src/ipc.ts`, `packages/portfolio/src/index.ts`, `packages/portfolio/src/perspectives-v5/*`, tests productivos | Ninguna | Grep V4 cero, productive-route tests, typecheck | `grep -R "runPerspectivesSimulation" apps packages --exclude="legacy-guard.ts" --exclude="*.test.ts"` sin resultados; `npm --prefix packages/portfolio run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm --prefix apps/web run typecheck`; `npm --prefix packages/portfolio run test -- src/perspectives-v5/productive-route.test.ts src/perspectives-v5/perspectives-v5.test.ts`; `npm --prefix packages/portfolio run build` | Pendiente | Push/comentario issue pendientes por credenciales no verificadas; la UI V5 definitiva queda para Fase 8 |
| FASE 2 - Modelo de dominio y migraciones de base de datos | NOT_STARTED | FASE 1 VALIDATED | Dominio V5 estable, tablas versionadas, migracion repetible | Pendiente | Operaciones, reservas, buckets, previews, fills, autorizaciones | Migracion base vacia/antigua/actual/corrupta/repetida | Pendiente | Pendiente |
| FASE 3 - Motor de fuentes y minimo de 15 fuentes independientes por activo | NOT_STARTED | FASE 2 VALIDATED | Fuentes BTC/ETH/SUI, corto/medio/largo, deduplicacion y estados VALID/PARTIAL/BLOCKED | Pendiente | Pendiente | Validacion de fuentes, normalizacion, no duplicados | Pendiente | Requiere evidencias verificables de fuentes |
| FASE 4 - Consenso anual y caminos mensuales por criptomoneda | NOT_STARTED | FASE 3 VALIDATED | Consenso anual y paths mensuales completos por activo | Pendiente | Pendiente | Cobertura asset x month x scenario x pathId, no precio plano sin cobertura | Pendiente | Pendiente |
| FASE 5 - Ledger, continuidad mensual, patrimonio, TWR y XIRR | NOT_STARTED | FASE 4 VALIDATED | Ledger mensual, compras en unidades, continuidad, patrimonio, TWR, XIRR | Pendiente | Pendiente | Precio constante, capital inicial, continuidad mensual, conciliacion | Pendiente | Pendiente |
| FASE 6 - Ventas parciales y recuperacion de capital por activo | NOT_STARTED | FASE 5 VALIDATED | Venta parcial con FIFO, beneficio neto, comision, reserva fiscal y capital recuperado | Pendiente | Pendiente | Venta prematura bloqueada, recuperacion de capital, trazabilidad por activo | Pendiente | Pendiente |
| FASE 7 - Buckets separados y recompras por debajo del coste medio | NOT_STARTED | FASE 6 VALIDATED | Buckets por activo, recompras bajo coste medio, lotes `INTERNAL_REBUY` | Pendiente | Pendiente | Recompra antes de recuperar bloqueada, reserva otro activo bloqueada, beneficio posterior | Pendiente | Pendiente |
| FASE 8 - Salida V5 programable e interfaz de Perspectivas | NOT_STARTED | FASE 7 VALIDATED | Operaciones programables trazables y UI Perspectivas V5 | Pendiente | Pendiente | DTO programable, cantidades congelables, sin contrato antiguo | Pendiente | Pendiente |
| FASE 9 - Persistencia, reservas y maquina de estados de operaciones | NOT_STARTED | FASE 8 VALIDATED | Persistencia, reservas, estados, reinicio, concurrencia | Pendiente | Programmed operations, reservas, estados, errores | Reinicio, doble reserva, cancelacion local, idempotencia local | Pendiente | Pendiente |
| FASE 10 - Coinbase en modo lectura, productos y preview | NOT_STARTED | FASE 9 VALIDATED | Productos, saldos, permisos, incrementos, minimos y preview sin submit | Pendiente | Persistencia previews/productos | Preview REVIEW_ONLY, bloqueo credenciales/permisos/productos/saldo | Pendiente | Pendiente |
| FASE 11 - Ordenes mock, fills, cancelacion y conciliacion completa | NOT_STARTED | FASE 10 VALIDATED | Submit mock, timeout, fills parciales/completos, cancelacion, conciliacion | Pendiente | Fills, attempts, client ids | Timeout despues de submit, fill parcial, fill completo, cancelacion, reinicio | Pendiente | Pendiente |
| FASE 12 - Adaptador productivo de Coinbase desactivado por defecto | NOT_STARTED | FASE 11 VALIDATED | Adaptador real implementado con `REVIEW_ONLY` por defecto y LIVE bloqueado | Pendiente | Autorizaciones y limites | Create/get/fills/cancel bloqueados sin autorizacion LIVE | Pendiente | No enviar dinero real |
| FASE 13 - Interfaz completa de Operaciones | NOT_STARTED | FASE 12 VALIDATED | UI de operaciones programadas, estados, acciones y conciliacion | Pendiente | Pendiente | UI tests, estados simulada/programada/open/filled/cancelled/blocked | Pendiente | Pendiente |
| FASE 14 - Pruebas E2E, seguridad, concurrencia y rendimiento | NOT_STARTED | FASE 13 VALIDATED | E2E completo, seguridad, rendimiento, no LIVE, no duplicados | Pendiente | Pendiente | E2E programar venta/recompra, preview mock, fills, reinicio, cartera/FIFO/tesoreria | Pendiente | Pendiente |
| FASE 15 - Nuevo DMG e instalacion lateral validada | NOT_STARTED | FASE 14 VALIDATED | DMG nuevo, SHA-256, instalacion lateral y validacion instalada | Pendiente | Pendiente | App instalada, REVIEW_ONLY, persistencia, no sobrescribir estable | Pendiente | No generar antes de fases 0-14 VALIDATED |
| FASE 16 - Auditoria final y cierre | NOT_STARTED | FASE 15 VALIDATED | Evidencia final, matriz de aceptacion, issue/PR sin cierre prematuro | Pendiente | Pendiente | Auditoria legacy, commits, checks, DMG, evidencias | Pendiente | No cerrar issue ni fusionar PR con pendientes |
