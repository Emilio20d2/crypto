# Final cache market automation report

Fecha: 2026-07-01
Rama: `codex/cache-market-automation`

## Resumen

La rama avanza la integracion de cache, mercado y automatizacion, pero no queda lista para publicar ni para operar dinero real. La automatizacion real permanece desactivada por defecto y bloqueada en backend.

## Implementado en esta fase

- Auditoria final previa en `docs/AUDITORIA_FINAL_CACHE_MARKET_AUTOMATION.md`.
- `apps/web/package-lock.json` versionado.
- CI de integracion actualizada a `npm ci --prefix apps/web`.
- Migracion `0019_cache_market_automation.sql` para cache de mercado, cache de transacciones y tablas de automatizacion.
- Prueba de migracion reforzada para verificar tablas, columnas e invalidadores.
- Scheduler de automatizacion integrado en Electron con parada en `before-quit`.
- Canales IPC/HTTP `automation:*` para listar politicas, crear/actualizar, pausar/reanudar, listar ejecuciones, consultar estado y ejecutar una evaluacion manual.
- Constructor de contexto de automatizacion conectado a cartera, tesoreria, precio de mercado y sentimiento disponibles.
- Runner conectado en modo `simulation_guarded`.
- Preview y submit reales de automatizacion bloqueados hasta completar Coinbase y reconciliacion contable.
- Interfaz de Operaciones con pestana `Politicas` para crear politicas simuladas, pausarlas/reanudarlas, evaluar manualmente y revisar historial con bloqueos/motivos.

## Commits principales

- `audit: document remaining cache market automation gaps`
- `build: make web dependencies reproducible`
- `db: add cache and automation migrations`
- `automation: integrate guarded background scheduler`
- `operations: add guarded policy management interface`

## Validacion ejecutada

- `npm ci`
- `npm ci --prefix apps/web`
- `npm --prefix packages/market-data run typecheck`
- `npm --prefix packages/market-data test`
- `npm --prefix packages/market-data run build`
- `npm --prefix packages/portfolio run typecheck`
- `npm --prefix packages/portfolio test`
- `npm --prefix packages/portfolio run build`
- `npm --prefix packages/database run typecheck`
- `npm --prefix packages/database test`
- `npm --prefix packages/database run build`
- `npm --prefix packages/core run build`
- `npm --prefix apps/web run typecheck`
- `npm --prefix apps/web test`
- `npm --prefix apps/web run build`
- `npm --prefix apps/desktop run typecheck`
- `npm --prefix apps/desktop run build`
- `npm --prefix packages/coinbase-sync run build`

## Comportamiento de cache

Mercado conserva cache persistente por proveedor en `market_series_cache_v2`. Cartera conserva cache transaccional en `portfolio_transaction_cache_v2` con invalidacion por triggers sobre transacciones, legs y comisiones.

Sigue pendiente cachear el resultado final de graficas de Cartera con clave por activo, periodo, moneda, saldos, lotes, precios, version del algoritmo y cobertura.

## Comportamiento de automatizacion

El scheduler corre en backend y no depende de que la pagina Operaciones este abierta. Usa el runner de dominio y registra ejecuciones en `automated_operation_runs_v1`.

El modo real esta bloqueado. Las politicas creadas desde UI se guardan como `simulationOnly: true`; `autoExecute` se fuerza a `false` al normalizar desde Electron.

## Comportamiento de Coinbase

Las ordenes manuales existentes siguen usando el flujo `coinbase:preview-order` / `coinbase:submit-order`.

La automatizacion nueva aun no envia ordenes reales a Coinbase. No se implemento todavia la cadena productiva completa preview real, validacion, envio, persistencia inmediata de identificador, consulta de estado y reconciliacion.

## Sincronizacion contable

No se completo la sincronizacion posterior idempotente de una orden automatizada sobre transacciones, legs, comisiones, cuentas, lotes FIFO, ganancias realizadas, Tesoreria, reserva fiscal, EURC operativo, ciclos, objetivos, Perspectivas y caches.

## Perspectivas V5

Perspectivas V5 existe como paquete, pero la ruta productiva `persp2:getSimulation` sigue sin estar migrada a `runPerspectivesV5Simulation`. No debe publicarse un DMG mientras esta ruta siga bloqueada por el guard legacy.

## DMG

No se genero ni instalo DMG en esta fase. No se valido la aplicacion desde `/Applications` con copia segura de la base real.

## BLOQUEOS RESTANTES

- Cache final de graficas de Cartera pendiente.
- Cobertura de Mercado con rangos ausentes precisos en UI pendiente.
- Constructor de contexto todavia parcial: no valida ciclo/plan/objetivo completos ni todas las fuentes independientes.
- Coinbase automatizado preview-submit-status-reconcile pendiente.
- Sincronizacion contable posterior recuperable pendiente.
- Perspectivas productiva V5 pendiente.
- E2E pendiente.
- Informe de performance pendiente.
- DMG instalado y validado pendiente.
- Comentario final de PR pendiente porque `gh` no esta disponible en esta maquina.
