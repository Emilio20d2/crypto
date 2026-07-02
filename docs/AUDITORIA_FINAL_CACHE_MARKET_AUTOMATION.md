# Auditoria final cache market automation

Fecha: 2026-07-01
Rama auditada: `codex/cache-market-automation`
Commit auditado: `c26cfad`
Base comparada: `origin/main`

## Estado actual real

La rama contiene una primera base funcional para cache de mercado, cache de transacciones de cartera, sentimiento con datos ausentes explicitos, politicas de venta/recompra, persistencia de politicas y ejecuciones, e idempotencia basica.

La rama no esta lista para publicacion ni para automatizacion real. La propia implementacion mantiene bloqueos documentados y verificados: la ruta productiva `persp2:getSimulation` sigue expuesta en Electron y web, el runner de operaciones no esta conectado al ciclo productivo de Electron, Coinbase no tiene el flujo preview-submit-reconcile conectado a politicas, no existe interfaz completa de programacion/autorizacion, y no hay validacion de DMG instalado.

`gh` no esta instalado en esta maquina, por lo que el estado del PR #4 no se pudo consultar por CLI. La rama local sigue exactamente a `origin/codex/cache-market-automation` antes de estos cambios.

## Componentes completos o parcialmente verificados

- `packages/market-data` conserva OHLCV donde el proveedor lo permite y contiene pruebas para resolucion, sentimiento y calidad de datos.
- `packages/database/src/market-cache-repository.ts` persiste series en `market_series_cache_v2` y selecciona proveedor sin mezclar series.
- `packages/database/src/portfolio-repository.ts` persiste una cache de transacciones en `portfolio_transaction_cache_v2` con triggers de invalidacion para tablas contables principales.
- `packages/database/src/automated-operation-repository.ts` persiste politicas y ejecuciones, valida JSON corrupto y restringe transiciones de estado.
- `packages/portfolio/src/automated-operations.ts` y `packages/portfolio/src/automated-operation-runner.ts` evaluan propuestas, limites, autorizacion, cooldown e idempotencia en modo de dominio.
- `.github/workflows/ci.yml` ya separa jobs de Market Data, Portfolio, Database e integracion de aplicacion, y sube logs de diagnostico en fallos de web/Electron.

## Componentes parciales

- La cache de Cartera solo cubre la reconstruccion transaccional. No existe todavia una cache persistente del resultado final usado para dibujar graficas de Cartera con clave por activo, periodo, moneda, saldos, lotes, precios, version de algoritmo y cobertura.
- La cobertura de Mercado y el sentimiento existen en libreria, pero la UI no muestra aun rangos ausentes precisos por activo/periodo ni causas detalladas para todos los estados.
- El evaluador de automatizacion recibe `AutomationMarketContext`, pero no hay un constructor productivo unico que lo arme desde Mercado, Tesoreria, FIFO, ciclos, objetivos y autorizacion reales.
- La persistencia de automatizacion permite idempotencia, pero no cubre aun reconciliacion completa ante orden aceptada sin respuesta local, timeout tardio o sincronizacion contable pendiente.
- Coinbase existe como paquete de sincronizacion y cliente, pero no esta conectado al flujo productivo de politicas: preview real, validacion, envio, consulta de estado y reconciliacion.
- La sincronizacion posterior a orden completada no actualiza de forma idempotente transacciones, legs, comisiones, cuentas, lotes FIFO, Tesoreria, reserva fiscal, EURC operativo, ciclos, objetivos, Perspectivas y caches.
- Perspectivas V5 existe en `packages/portfolio/src/perspectives-v5`, pero la ruta productiva web/Electron sigue usando `persp2:getSimulation` y actualmente falla cerrada mediante guard legacy.

## Componentes desconectados

- `AutomatedOperationRunner` no se inicia desde `apps/desktop/src/main.ts` tras abrir/migrar la base.
- No existe programador de segundo plano con bloqueo de proceso, intervalo configurable, evaluacion manual inmediata y parada ordenada al cerrar la app.
- `apps/web/src/pages/Operaciones.tsx` no ofrece todavia CRUD completo de politicas, autorizacion explicita caducable, preview, historial, bloqueos y sincronizacion posterior.
- `apps/web/src/pages/Perspectivas.tsx` y vistas de plan siguen consumiendo `window.cryptoControl.persp2.getSimulation`.
- El workflow de CI genera `apps/web/package-lock.json` con `npm install --prefix apps/web`; no usa aun `npm ci --prefix apps/web`.

## Riesgos detectados

- Las tablas nuevas de cache y automatizacion se crean desde repositorios con `CREATE TABLE IF NOT EXISTS`; no hay migraciones versionadas para `market_series_cache_v2`, `portfolio_transaction_cache_v2`, `automated_operation_policies_v1` ni `automated_operation_runs_v1`.
- Una instalacion nueva puede funcionar por codigo defensivo, pero la migracion no es todavia la fuente de verdad auditable.
- Publicar un DMG ahora dejaria Perspectivas productiva bloqueada por el guard legacy.
- Activar automatizacion real ahora seria inseguro: faltan preview vigente conectado, envio idempotente a Coinbase, reconciliacion y sincronizacion contable recuperable.
- La ausencia de lockfile web versionado impide reproducibilidad estricta de `apps/web`.
- No hay evidencia local aun de instalacion limpia, E2E, performance ni DMG instalado.

## Plan de ejecucion por fases

1. Estabilizar dependencias web: generar `apps/web/package-lock.json`, cambiar CI a `npm ci --prefix apps/web` y validar instalacion limpia.
2. Crear migraciones versionadas para caches y automatizacion, manteniendo los guards defensivos como red de seguridad.
3. Completar cache de graficas de Cartera e invalidacion fina.
4. Exponer cobertura real de Mercado y rangos ausentes en API/UI.
5. Crear un unico constructor productivo de `AutomationMarketContext`.
6. Integrar scheduler de automatizacion en Electron con bloqueo, parada ordenada y ejecucion manual.
7. Conectar Coinbase preview-submit-status-reconcile en modos simulado/mock/revision/real autorizado.
8. Completar interfaz de Operaciones y autorizacion explicita.
9. Implementar sincronizacion posterior idempotente con contabilidad, FIFO, Tesoreria, ciclos, objetivos, Perspectivas y caches.
10. Migrar la ruta productiva a Perspectivas V5 y bloquear sin fallback si faltan datos.
11. Anadir pruebas unitarias, integracion y E2E sobre mocks.
12. Medir performance y documentar resultados.
13. Generar, instalar y validar DMG desde `/Applications` con copia segura de base real.

## Criterios que bloquean la publicacion

- Falta lockfile propio de `apps/web` y CI aun instala web con `npm install`.
- Faltan migraciones reales para las tablas nuevas.
- Falta cache persistente del resultado final de graficas de Cartera.
- Falta UI completa de cobertura, antiguedad y rangos ausentes.
- Falta constructor productivo unico de contexto de automatizacion.
- Falta scheduler de Electron.
- Falta integracion Coinbase preview/envio/estado/reconciliacion.
- Falta sincronizacion contable posterior recuperable.
- Falta interfaz completa de Operaciones.
- Falta migracion productiva de Perspectivas V5.
- Faltan pruebas E2E y performance.
- Falta DMG generado, instalado y validado.

Mientras cualquiera de estos puntos siga pendiente, el PR debe permanecer en borrador, sin merge y sin activar automatizacion real por defecto.
