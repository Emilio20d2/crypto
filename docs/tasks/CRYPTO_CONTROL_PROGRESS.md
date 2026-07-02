Estado de Crypto Control

Actualización 2026-07-02 — Issue #5 como fuente de verdad

Se recibió instrucción nueva para ejecutar íntegramente la Issue #5 — Perspectivas V5: previsiones por activo, recuperación de capital, ventas y recompras — en orden canónico y fase por fase.

Fuente de verdad leída:

- Issue #5 completa: `https://github.com/Emilio20d2/crypto/issues/5`.
- Comentario de Issue #5: `ORDEN CANÓNICO DE EJECUCIÓN — PERSPECTIVAS V5 Y OPERACIONES REALES`.
- PR #4: `https://github.com/Emilio20d2/crypto/pull/4`.

Plan local creado:

- `docs/PERSPECTIVES_V5_EXECUTION_PLAN.md`.

Estado de Fase 0:

`VALIDATED` localmente tras crear rama de ejecución desde PR #4, verificar backup de base real y ejecutar `npm --prefix packages/portfolio run typecheck`.

Evidencia de línea base:

- Rama local actual: `codex/perspectives-v5-clean-rebuild`.
- Commit local actual: `1203e93dfa32d121298878dfc2b6071dbce24083`.
- PR #4: rama `codex/cache-market-automation`, head `3cf1354c4afd4de0410cc4233c46798078183436`, `draft=true`, checks visibles en GitHub `success`.
- `origin/main`: `bc5a3ddb6a8f8f3ef003e8b7841763c63a04486e`.
- `origin/codex/perspectives-v5-clean-rebuild`: `0627f414739449e904983152f368a95ee413e81d`.
- App instalada: `/Applications/Crypto Control.app`, commit embebido `1203e93dfa32d121298878dfc2b6071dbce24083`, rama `codex/perspectives-v5-clean-rebuild`, build `2026-07-02T04:53:16.297Z`.
- Copia de base real creada: `/private/tmp/crypto-control-backups/phase0-issue5-20260702-113642.sqlite`.
- Integridad de la copia: `PRAGMA integrity_check = ok`.

Bloqueos de Fase 0:

- La rama local instalada no coincide con la rama del PR #4.
- El commit instalado/local `1203e93` no está publicado en la rama remota equivalente, que está en `0627f414`.
- La búsqueda requerida por Issue #5 para `runPerspectivesSimulation` no devuelve cero porque quedan artefactos compilados en `packages/portfolio/dist/perspectives/sim-engine.*`.
- Existe `commissionRate: 0` en `packages/portfolio/src/perspectives/types.ts`; debe auditarse en Fase 1 antes de declarar V5 productivo completo.
- No hay `gh` instalado; la lectura por API pública funciona, pero publicar comentarios en Issue #5 o hacer push requiere credenciales de escritura verificadas.
- El DMG instalado anterior no puede considerarse final bajo la Issue #5 porque se generó antes de validar fases 0-14.

Acción de alineación:

- Creada rama local de ejecución `codex/issue5-execution` desde `origin/codex/cache-market-automation` (`3cf1354c4afd4de0410cc4233c46798078183436`) para continuar sobre la base canónica del PR #4.
- Creada rama de respaldo `codex/perspectives-v5-clean-rebuild-backup-20260702` apuntando al estado instalado/local `1203e93dfa32d121298878dfc2b6071dbce24083`.
- Intento de cherry-pick directo de la línea V5 instalada sobre PR #4 abortado por conflictos en `packages/portfolio/src/perspectives-v5/*`; se continuará por fases desde PR #4, validando y portando solo lo necesario según Issue #5.

Inicio de Fase 1:

- La búsqueda canónica confirma que la base del PR #4 todavía no tiene migración productiva V5 completa.
- `apps/desktop/src/main.ts` invoca todavía `runPerspectivesSimulation`.
- `packages/portfolio/src/perspectives/*` y `packages/portfolio/dist/perspectives/*` conservan símbolos V4.
- Objetivo inmediato de Fase 1: conectar la ruta productiva de Electron a `runPerspectivesV5Simulation`, eliminar fallback productivo V4, añadir/ajustar test de guardia legacy y dejar el grep canónico sin resultados productivos.

Resultado de Fase 1:

`VALIDATED` localmente.

Cambios de Fase 1:

- Añadido canal productivo `perspectivesV5:getSimulation` en Electron.
- Añadido `perspectivesV5.getSimulation` en preload, puente web y tipos IPC compartidos.
- La página Perspectivas consume `window.cryptoControl.perspectivesV5.getSimulation`.
- `persp2:getSimulation` queda registrado solo como ruta legacy cerrada que lanza `PERSPECTIVES_V4_REMOVED`.
- `apps/desktop/src/main.ts` construye un input nativo V5 con posiciones, lotes, aportaciones mensuales, path de precios completo y fuentes de motor explícitas.
- Eliminado el export productivo del símbolo V4 `runPerspectivesSimulation`.
- Renombrado el símbolo interno antiguo a `runLegacyPerspectivesSimulation`.
- Añadida prueba `packages/portfolio/src/perspectives-v5/productive-route.test.ts` para impedir reconectar V4 o `persp2` desde la pantalla.

Pruebas de Fase 1:

- `grep -R "runPerspectivesSimulation" apps packages --exclude="legacy-guard.ts" --exclude="*.test.ts"` — sin resultados.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix apps/desktop run typecheck` — OK.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/perspectives-v5/productive-route.test.ts src/perspectives-v5/perspectives-v5.test.ts` — OK, 2 archivos / 4 tests.
- `npm --prefix packages/portfolio run build` — OK.

Pendiente tras Fase 1:

- Publicar commit y comentario en Issue #5 si las credenciales GitHub lo permiten.
- Fase 2 debe estabilizar dominio y migraciones versionadas antes de seguir con fuentes/ledger/ventas/recompras.
- La interfaz V5 definitiva queda reservada para Fase 8; en Fase 1 solo se cambió la fuente productiva a V5.

Resultado de Fase 2:

`VALIDATED` localmente.

Cambios de Fase 2:

- Ampliado dominio V5 con `PerspectivesProgrammableOperation`, estados productivos de operaciones, modo de trading, cantidades congeladas y modos de ejecución.
- Añadida migración versionada `0020_perspectives_v5_operations.sql`.
- La migración crea:
  - `perspectives_v5_trading_settings`;
  - `perspectives_v5_programmed_operations`;
  - `perspectives_v5_operation_reservations`;
  - `perspectives_v5_coinbase_previews`;
  - `perspectives_v5_coinbase_orders`;
  - `perspectives_v5_coinbase_fills`;
  - `perspectives_v5_live_authorizations`.
- El modo global se inicializa como `REVIEW_ONLY`.
- Ampliada `migration.test.ts` para verificar tablas, columnas clave e idempotencia de migración repetida.

Pruebas de Fase 2:

- `npm --prefix packages/database run test -- src/migration.test.ts` — OK, 1 archivo / 2 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/market-data run build` — OK.
- `npm --prefix packages/database run typecheck` — OK.
- `npm --prefix packages/database run build` — OK.

Pendiente tras Fase 2:

- Publicar commit y comentario en Issue #5.
- Fase 3: motor de fuentes y mínimo de 15 fuentes independientes por activo antes de seguir al consenso anual.

Resultado de Fase 3:

`VALIDATED` localmente para el alcance de catálogo de fuentes.

Cambios de Fase 3:

- Creado `packages/portfolio/src/perspectives-v5/data/source-catalog.ts`.
- Exportado el catálogo desde `packages/portfolio/src/perspectives-v5/index.ts`.
- Añadido `packages/portfolio/src/perspectives-v5/source-catalog.test.ts`.
- El catálogo registra fuentes para BTC, ETH y SUI con mínimo 15 fuentes independientes por activo.
- Cada activo tiene mínimo 5 fuentes de corto plazo, 5 de medio plazo y 5 de largo plazo.
- Las fuentes quedan en `REGISTERED_ONLY` y `usedInEngine=false`; no se han activado como observaciones ni como consenso.

Pruebas de Fase 3:

- `npm --prefix packages/portfolio run test -- src/perspectives-v5/source-catalog.test.ts` — OK, 1 archivo / 2 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run build` — OK.

Pendiente tras Fase 3:

- Publicar commit y comentario en Issue #5.
- Fase 4 debe crear observaciones verificadas, consenso anual y caminos mensuales completos. El catálogo por sí solo no debe alimentar precios activos.

Resultado de Fase 4:

`VALIDATED` localmente con fixtures de observaciones verificadas.

Cambios de Fase 4:

- Creado `packages/portfolio/src/perspectives-v5/data/annual-consensus.ts`.
- Exportado desde `packages/portfolio/src/perspectives-v5/index.ts`.
- Añadido `packages/portfolio/src/perspectives-v5/annual-consensus.test.ts`.
- El motor calcula cinco escenarios anuales mediante percentiles ponderados cuando existen al menos tres fuentes independientes.
- El motor interpola años con anclas válidas y modela años posteriores con crecimiento acotado y confianza decreciente.
- El constructor mensual genera matriz completa `assetId x month x scenario x pathId`.
- La validación bloquea activos sin observaciones verificadas suficientes.
- Los caminos mensuales no usan carry-forward plano.

Pruebas de Fase 4:

- `npm --prefix packages/portfolio run test -- src/perspectives-v5/annual-consensus.test.ts` — OK, 1 archivo / 3 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run build` — OK.

Pendiente tras Fase 4:

- Publicar commit y comentario en Issue #5.
- Fase 5: ledger, continuidad mensual, patrimonio, TWR y XIRR. Debe demostrar precio constante, capital inicial, compras en unidades y conciliación.

Resultado de Fase 5:

`VALIDATED` localmente.

Cambios de Fase 5:

- El cierre mensual de `runPerspectivesV5Simulation` usa ahora `PerspectivesPortfolioLedger.closeMonth`.
- Las aportaciones mensuales compran unidades reales del activo con el precio mensual del path.
- El resultado de mercado mensual se calcula separando aportaciones, costes y variación patrimonial.
- La continuidad `opening[n+1] = closing[n]` queda validada por el ledger.
- Añadidas métricas `twrCumulative`, `twrAnnualized` y `xirr` al DTO V5.
- Añadido módulo `packages/portfolio/src/perspectives-v5/metrics/returns.ts`.
- Añadidas pruebas productivas de precio constante, creciente y decreciente que ejecutan `runPerspectivesV5Simulation` y leen lotes reales creados por el motor.

Pruebas de Fase 5:

- `npm --prefix packages/portfolio run test -- src/perspectives-v5/ledger-metrics.test.ts src/perspectives-v5/annual-consensus.test.ts src/perspectives-v5/productive-route.test.ts src/perspectives-v5/perspectives-v5.test.ts` — OK, 4 archivos / 10 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run build` — OK.
- `grep -R "runPerspectivesSimulation" apps packages --exclude="legacy-guard.ts" --exclude="*.test.ts"` — sin resultados.

Pendiente tras Fase 5:

- Publicar commit y comentario en Issue #5.
- Fase 6: ventas parciales y recuperación de capital por activo. No se han implementado recompras ni Coinbase en esta fase.

Resultado de Fase 6:

`VALIDATED` localmente.

Cambios de Fase 6:

- La simulación V5 evalúa ventas parciales mensuales en modos no pasivos antes de añadir nuevas aportaciones.
- Cada decisión de venta queda registrada en `decisions`, incluyendo rechazos por plusvalía insuficiente.
- Las ventas ejecutadas usan FIFO mediante `PerspectivesPortfolioLedger.executePartialSale`.
- Cada venta crea un `PARTIAL_SALE`, bucket EURC operativo, reserva fiscal incremental y `ProfitHarvestCycle`.
- Cada ciclo registra `capitalRecovered`.
- Se evita abrir una segunda venta del mismo activo mientras exista un ciclo abierto.
- La fase no implementa recompras; quedan reservadas para Fase 7.

Pruebas de Fase 6:

- `npm --prefix packages/portfolio run test -- src/perspectives-v5/partial-sales.test.ts src/perspectives-v5/ledger-metrics.test.ts src/perspectives-v5/annual-consensus.test.ts src/perspectives-v5/productive-route.test.ts src/perspectives-v5/perspectives-v5.test.ts` — OK, 5 archivos / 12 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run build` — OK.
- `grep -R "runPerspectivesSimulation" apps packages --exclude="legacy-guard.ts" --exclude="*.test.ts"` — sin resultados.

Evidencia de Fase 6:

- Venta prematura bloqueada: con plusvalía inferior al umbral, no se crea `PARTIAL_SALE`, no se crea bucket y las unidades abiertas permanecen intactas.
- Venta con recuperación: posición inicial 1 BTC a 10.000 €, precio 30.000 €, régimen euforia. El motor ejecuta una venta productiva del 25 %, vende 0,25 BTC, realiza 5.000 € de plusvalía, crea 1.000 € de reserva fiscal y 6.500 € de EURC operativo.

Pendiente tras Fase 6:

- Publicar commit y comentario en Issue #5.
- Fase 7: buckets separados y recompras por debajo del coste medio. No se debe iniciar Coinbase antes de completar Fase 9.

Estado general

Integración en curso sobre la versión instalada correcta. Auditoría inicial completada y primeras correcciones arquitectónicas aplicadas en tiempo real, gráficas y Perspectivas.

Rama y commit inicial

Rama inicial localizada: `codex/realtime-perspectives-engine`, commit `957785f819b8f7908823a3f90f8f1faa7e6c9015`.

Rama de trabajo creada desde esa base: `codex/final-engine-rebuild`.

`origin/main` tras `git fetch --all --prune`: `ccecc6002fc54140e3ae1639775aa2a34ef18a91`.

Fase actual

Corrección arquitectónica e integración progresiva de motores.

Auditoría

Diagnóstico técnico interno inicial:

MOTOR EN TIEMPO REAL

Servicio actual: `apps/desktop/src/realtime-portfolio-market-engine.ts`, instanciado en `apps/desktop/src/main.ts`.

Fuente de balances: Coinbase `getAccounts()` cada 5 s, con fallback a `getCachedPortfolioBreakdownNoError`.

Fuente de precios: Coinbase WebSocket EUR si llega tick fresco; si no, `getCurrentPriceFast()` por REST/cache/proveedores de `MarketService`.

Polling actual: motor central cada 5 s; además existen polling React Query en Cartera, Mercado y Detalle de activo.

WebSocket: solo en proceso principal Electron; publica por IPC `portfolio:live-snapshot`.

Caché: último snapshot válido interno, caché `price_history` para precios/históricos, caché de breakdown Coinbase.

Motor web: navegador usa `apps/web/src/lib/setupApi.ts` contra HTTP `/api/ipc`; `onLiveSnapshot` es no-op.

Motor Electron: recibe eventos IPC push desde `mainWindow.webContents.send("portfolio:live-snapshot", snapshot)`.

Consultas duplicadas: Mercado ejecuta `market:get-overview` por activo cada 5 s, precio seleccionado cada 5 s, overview seleccionado cada 5 s e históricos por periodo; Cartera mantiene breakdown 30 s, posiciones 30 s, serie histórica con refetch propio y sync pesado separado.

Causa de la pérdida de tiempo real: solo Cartera Electron consume el snapshot push; la web HTTP no tiene SSE/WebSocket y Mercado/Detalle siguen usando polling REST/React Query, por lo que no comparten recepción subsegundo ni una suscripción común.

GRÁFICAS

Componentes: `MarketChartPanel`, `MarketChart`, `PeriodSelector`, `Sparkline`, páginas `Portfolio`, `Mercado`, `AssetDetail`.

Servicios: `market:get-historical-prices`, `portfolio:get-historical-series`, `MarketService`, `DatabaseMarketCacheRepository`.

Consultas por timeframe: Mercado y Detalle consultan por `assetId+period`; Cartera reconstruye serie por periodo y carga precios por activo internamente.

Número de peticiones: por cada cambio/refresh de Mercado hay overview por todos los activos más precio/overview/histórico del seleccionado; Cartera puede disparar serie histórica y 24h simultáneas.

Número de puntos: backend registra puntos en logs, pero todavía no hay métrica consolidada ni downsampling compartido.

Caché: existe por `assetId+quoteCurrency+period` en `price_history`, pero `saveHistoricalPrices` borra y reemplaza el periodo completo; no hay actualización incremental real ni prefetch coordinado.

Invalidaciones: sync de Coinbase invalida breakdown/portfolios/transactions/positions/live-snapshot; las gráficas no se invalidan en cada sync, pero tienen refetch interval propio.

Causa de la lentitud: cambio de periodo depende de llamadas HTTP/IPC que pueden reconstruir o recargar series completas; no hay caché cliente compartida inmediata, cancelación de petición obsoleta ni sustitución atómica con datos previos.

PERSPECTIVAS

Motor alcanzable: `persp2:getSimulation` en `apps/desktop/src/main.ts` llama `runPerspectivesSimulation()` de `packages/portfolio/src/perspectives/sim-engine.ts`.

Motores antiguos alcanzables: existen rutas legacy `perspectives:getProjection`/v1 y componentes auxiliares, pero la página actual usa `persp2:getSimulation`.

Fuente de previsiones: `ForecastActiveRepository.getDatasetForEngine()` consume `forecast_versions_active.snapshot_json`; si no hay activa, entra dataset vacío.

Feature flag: `PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED = false`, aunque `getDatasetForEngine()` no lo bloquea si existe versión activa.

Versión activa: en el respaldo SQLite existe `current -> verified-active-1782499645854`, con snapshot para BTC y ETH 2030; no hay SUI activo.

Carry-forward: el builder declara no hacer carry-forward y usa modeled/insufficient; hay carry-forward histórico en `portfolioHistory.ts`, no en Perspectivas productiva.

Tipo de cambio: el dataset activo conserva `fxRate/fxSource`; falta servicio FX formal versionado como capa propia.

Prueba de regresión: `runRegressionTest()` compara activeSources vs candidateSources, no el mismo dataset, pero la arquitectura de activación real aún no fuerza staging/candidate/regresión antes de activar desde UI.

Causa de TWR 0 %: probable combinación de cobertura insuficiente/modelizada para años posteriores y activos sin precio mensual, especialmente SUI; se validará con prueba 2036-2044 reproducible.

Causa del resultado −24 €: la comisión está modelada como comisión/contribución en el motor; se debe comprobar que la UI no la clasifica como resultado de mercado en años sin movimiento de precios.

Plan aprobado

Plan aprobado por documento maestro: auditoría → corrección arquitectónica → integración → tests → validación con datos reales → build → DMG → instalación → comprobación → reapertura → commit → push → confirmación remota.

Cambios realizados

- Creado `AGENTS.md`.
- Creado `docs/tasks/CRYPTO_CONTROL_MASTER.md` y actualizado con el documento maestro real completo recibido el 2026-06-28.
- Creado `docs/tasks/CRYPTO_CONTROL_PROGRESS.md`.
- Creado `.codex/config.toml`.
- Identificado este worktree como la versión instalada y en ejecución.
- Eliminado el clon equivocado `/Users/macmini/Developer/crypto-control-clean-20260625-0006`.
- Creada rama local de trabajo `codex/final-engine-rebuild`.
- Añadido `publishedAt` al snapshot realtime.
- Añadido streaming SSE local `/api/live-snapshot` en el puente HTTP para que la web reciba el mismo snapshot que Electron.
- Actualizado `apps/web/src/lib/setupApi.ts` para usar `EventSource` en `onLiveSnapshot`.
- Añadido refresco inmediato del motor realtime al recuperar foco de ventana Electron.
- Eliminada la etiqueta visible `Último válido` y equivalentes de UI en Cartera/Mercado; se conserva caché interna.
- Ajustado `getHistoricalPricesFast()` para devolver caché histórica existente de inmediato y refrescar en segundo plano cuando esté obsoleta.
- Añadido `placeholderData: keepPreviousData` en gráficas de Cartera, Mercado y Detalle de activo para no vaciar la gráfica al cambiar periodo.
- Reforzado `ForecastActiveRepository` con `activateApprovedCandidate()` y rollback autónomo desde `forecast_versions_candidate`.
- Ajustado `buildExternalPriceMap()` para que activos conocidos sin cobertura externa directa, como SUI, usen trayectoria `modeled` explícita desde precio actual, sin carry-forward plano ni fuente fabricada.
- Convertido `seedForecastData()` en siembra de catálogo de fuentes únicamente; ya no inserta observaciones hardcodeadas ni activa `seed-active-v1`.
- Bloqueado el consumo productivo de versiones activas `seed-*` desde `ForecastActiveRepository`.
- Ajustado el modelo terminal de Perspectivas para que la volatilidad mensual comparta fase de mercado y no invierta conservador/base/optimista por ruido cíclico.
- Cambiado `perspectives:addObservation` para que escriba en `forecast_observations_staging` con estado `pending`, no en `forecast_observations`.
- Ampliado `perspectives:getForecastStatus` para devolver también observaciones en staging.
- Reforzado el motor realtime para derivar un precio interno desde el breakdown cacheado (`totalBalanceFiat / totalBalanceCrypto`) cuando Coinbase informa saldo pero REST/proveedores aún no devuelven precio tras una reapertura.

Pruebas ejecutadas

- `git rev-parse --show-toplevel`
- `git status`
- `git branch --show-current`
- `git rev-parse HEAD`
- `git remote -v`
- `git fetch --all --prune`
- `git log --oneline -20`
- `git rev-parse origin/main`
- `ps -axo pid,ppid,etime,%cpu,%mem,command`
- Extracción de `BUILD_INFO` desde `/Applications/Crypto Control.app/Contents/Resources/app.asar`.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/desktop run typecheck` — OK.
- `npm --prefix apps/web run test -- src/lib/setupApi.test.ts` — OK, 2 tests.
- `./node_modules/.bin/vitest run apps/desktop/src/realtime-portfolio-market-engine.test.ts` — OK, 5 tests.
- `npm --prefix packages/market-data run test -- src/market.test.ts` — OK, 17 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/perspectives/forecast-architecture.test.ts` — OK, 26 tests.
- `npm --prefix packages/portfolio run test -- src/perspectives/sim-engine.test.ts` — OK, 60 tests.
- `TMPDIR=/private/tmp node --import tsx ... runPerspectivesSimulation(...)` — OK, verificación puntual: conservador 16173 €, moderado 16449 €, base 16731 €, favorable 17077 €, optimista 17514 €; validación `optimista >= base` superada.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix packages/core run typecheck` — OK.
- `npm --prefix packages/market-data run typecheck` — OK.
- `npm --prefix packages/database run typecheck` — OK.
- `npm --prefix packages/coinbase-sync run typecheck` — OK.
- `npm --prefix apps/web run test` — OK, 12 files / 143 tests.
- `npm --prefix packages/database run test` — OK, 4 files / 23 tests.
- `npm --prefix packages/coinbase-sync run test` — OK, 5 files / 62 tests.
- `npm --prefix packages/market-data run test` — OK, 5 files / 49 tests.
- `npm --prefix packages/portfolio run test` — OK, 21 files / 455 tests.
- `npm --prefix apps/desktop run build` — OK.
- `npm --prefix apps/web run build` — OK.
- `npm --prefix packages/core run build` — OK.
- `npm --prefix packages/portfolio run build` — OK.
- `npm --prefix packages/market-data run build` — OK.
- `npm --prefix packages/database run build` — OK.
- `npm --prefix packages/coinbase-sync run build` — OK.
- `./node_modules/.bin/vitest run apps/desktop/src/realtime-portfolio-market-engine.test.ts` — OK, 6 tests, incluye fallback de precio desde breakdown cacheado.
- App instalada desde DMG final abrió con `BUILD_INFO commit=d40f93e` y puente HTTP en `127.0.0.1:3001`.
- Prueba real web/Electron de 60 s con UUID real `165517f9-6dd3-5a15-923f-6c0244f61440` — OK: 13 puntos, `mismatches: []`, mismas versiones, mismos totales, BTC/ETH/SUI iguales y diferencia de recepción 0 ms.
- Segunda apertura detectó un caso de arranque con SUI pendiente si el proveedor aún no devuelve precio; se añadió corrección y test antes de cerrar release.
- Tras reinstalar con la corrección, segunda apertura OK: BTC, ETH y SUI con precio, `complete: true`, `missing: []`, socket `live`.
- Verificación corta final web/Electron tras reinstalación — OK: 5 puntos, `mismatches: []`, mismos totales y precios BTC/ETH/SUI, diferencia de recepción 0 ms.

Intento no válido registrado: `npm --prefix apps/desktop test -- realtime-portfolio-market-engine.test.ts` falló porque `apps/desktop/package.json` no define script `test`.
Intento bloqueado por sandbox registrado: `./node_modules/.bin/tsx -e ...` no pudo abrir pipe IPC; se sustituyó por `node --import tsx` con `TMPDIR=/private/tmp`.

Bases de datos localizadas

- Activa de la app instalada: `/Users/macmini/Library/Application Support/Crypto Control Nueva/crypto-control.sqlite`.
- Bases antiguas localizadas, no tocadas: `/Users/macmini/Library/Application Support/Crypto Control/crypto-control.sqlite`, `/Users/macmini/Library/Application Support/Crypto Control/crypto-control.db`, `/Users/macmini/Library/Application Support/Crypto Control/cryptocontrol.db`.

Copias de seguridad

Creado y verificado bundle temporal antes del borrado: `/private/tmp/crypto-control-clean-20260625-0006-before-delete.bundle`.

Creada copia SQLite verificable antes de pruebas críticas: `/private/tmp/crypto-control-backups/crypto-control-nueva-20260628-before-final-engine-rebuild.sqlite` (`PRAGMA integrity_check`: `ok`, tamaño 14M).

Riesgos y bloqueos

El documento maestro exige validaciones con datos reales, generación e instalación de DMG, push a GitHub y posible actualización de `main`; esas acciones se realizarán solo después de auditoría, implementación y pruebas obligatorias.

Evidencias finales

- Worktree correcto: `/Users/macmini/Developer/crypto-realtime-perspectives`.
- App instalada: commit `957785f819b8f7908823a3f90f8f1faa7e6c9015`, rama `codex/realtime-perspectives-engine`, build `2026-06-27T03:59:51.011Z`.
- Documento maestro guardado: `docs/tasks/CRYPTO_CONTROL_MASTER.md`, 34673 bytes.
- `origin/main` coincide con el commit esperado del documento maestro: `ccecc6002fc54140e3ae1639775aa2a34ef18a91`.
- La rama de trabajo parte 13 commits por delante de `origin/main`.
- Clon equivocado eliminado: `/Users/macmini/Developer/crypto-control-clean-20260625-0006`.

Commit y release final

Commit local creado en `codex/final-engine-rebuild`; pendiente de push remoto tras reconstruir el DMG final con el SHA definitivo.

Actualización 2026-06-29 — Plan, Perspectivas, alertas y ciclos

Nueva tarea recibida

Adjunto leído completo: `AGENTE MAESTRO CODEX — MOTOR DE PERSPECTIVAS, CICLOS, ALERTAS Y OPTIMIZACIÓN DEL PLAN DE CRYPTO CONTROL`.

Auditoría inicial específica

- Ruta productiva de Perspectivas localizada: `persp2:getSimulation` en `apps/desktop/src/main.ts`, que llama a `runPerspectivesSimulation()` en `packages/portfolio/src/perspectives/sim-engine.ts`.
- La base real contiene 1 plan activo, 3 ciclos, 9 activos de plan, 47 lotes y 18 ventas realizadas.
- No existen reglas de venta parcial configuradas (`partial_sale_rules = 0`).
- No existen tiers de recompra configurados (`cycle_rebuy_tiers = 0`).
- El plan real cruza dos etapas en 2036: segunda etapa hasta 2036-03-31 local con 200 EUR/mes y tercera etapa desde 2036-04-01 local con 500 EUR/mes.
- En 2036 deben contabilizarse 12 aportaciones: 200, 200, 200 y nueve aportaciones de 500, total 5.100 EUR. No debe duplicarse ni perderse marzo/abril.
- Se reprodujeron las cifras actuales desde la app instalada vía `POST /api/ipc persp2:getSimulation`. Base actual aproximada: neto 84.855 EUR, bruto 84.981 EUR, TWR 12,21 %, XIRR 2,77 %, con ventas/recompras simuladas aunque no hay reglas configuradas.

Causa encontrada

- `runPerspectivesSimulation()` ejecutaba `evaluateProposedSales()` y `evaluateProposedRebuys()` dentro de la ruta productiva `full_strategy`.
- Esas funciones aplicaban umbrales internos de ventas/recompras hipotéticas sin reglas reales del Plan.
- Resultado: Perspectivas mezclaba el plan real con operaciones tácticas inventadas por el motor.

Cambios realizados en esta fase

- `packages/portfolio/src/perspectives/sim-engine.ts`: la simulación productiva ya no ejecuta ventas ni recompras tácticas no configuradas.
- `packages/portfolio/src/perspectives/sim-engine.test.ts`: invertidas regresiones que antes esperaban ventas hipotéticas; ahora sin reglas configuradas `totalSalesEur === 0` y `totalTaxEur === 0`.
- `packages/portfolio/src/perspectives/sim-engine.test.ts`: añadido test de frontera 2036 con los cinco escenarios y aportaciones 200/200/200/500x9 = 5.100 EUR.
- Se conserva la existencia de los cinco escenarios: conservador, moderado, base, favorable y optimista.

Resultado local después del cambio

Actualización 2026-06-30 — Auditoría bloqueante de cálculos de Perspectivas

Nueva instrucción recibida y leída completa: `AUDITORÍA BLOQUEANTE — COMPROBAR Y CORREGIR TODOS LOS CÁLCULOS DEL MOTOR DE PERSPECTIVAS`.

Estado de cierre actualizado: la tarea no puede considerarse terminada solo por compilar, generar DMG o corregir tarjetas. Queda añadido como criterio bloqueante demostrar con fixture reproducible, libro mayor mensual y verificador independiente que las cifras de Perspectivas concilian al céntimo.

Cambios aplicados en esta fase:

- `apps/web/src/pages/Perspectivas.tsx`: la pantalla superior de Perspectivas deja de mostrar la misma cifra como `Capital reinvertido`, `Recompras simuladas` y `Reinversión EURC`.
- `apps/web/src/pages/Perspectivas.tsx`: etiquetas ambiguas sustituidas por `Valor inicial cartera`, `Base de coste inicial` y `Valor actual en criptomonedas`.
- `apps/web/src/pages/Perspectivas.tsx`: añadido bloque visible `Resultado de recompras` con EURC usado, valor actual de lotes recomprados, resultado económico, rentabilidad y unidades abiertas/vendidas.
- `apps/web/src/pages/Perspectivas.tsx`: el bloque de ventas separa ventas simuladas, reserva fiscal apartada, EURC libre restante y decisión del motor.
- `apps/web/src/pages/Perspectivas.tsx`: la conciliación EURC deja de restar dos veces las recompras cuando `totalEurcReinvestedEur` ya las incluye; la reinversión residual se calcula como `max(0, totalEurcReinvestedEur - totalRebuysEur)`.
- `apps/web/src/Perspectivas.test.tsx`: añadida prueba de regresión de UI para impedir que vuelvan las etiquetas ambiguas y verificar que la pantalla muestra el resultado económico de recompras.

Pruebas ejecutadas en esta fase:

- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix apps/web run test -- src/Perspectivas.test.tsx` — OK, 1 test.

Pendiente bloqueante por la nueva auditoría:

- Congelar input real de `persp2:getSimulation` como fixture reproducible.
- Crear libro mayor mensual 2026-2044.
- Verificador independiente: primera versión creada en `packages/portfolio/src/perspectives/accounting-verifier.ts`, validando identidades anuales y de resumen para patrimonio, EURC, beneficio neto y recompras.
- Comparar motor contra verificador con tolerancia máxima 0,01 EUR.
- Validar TWR y XIRR con cálculo independiente.
- Reinstalar DMG y verificar que la app instalada reproduce el commit y JSON auditado.

Actualización 2026-06-30 — Verificador independiente de Perspectivas

Cambios aplicados:

- `packages/portfolio/src/perspectives/accounting-verifier.ts`: creado verificador contable independiente del motor principal. Recibe el JSON de simulación y recalcula con fórmulas propias: cierre neto anual, EURC operativo anual, puente bruto/neto por reserva fiscal, beneficio neto, plusvalía latente de recompras, rentabilidad total de recompras y consistencia del resumen final.
- `packages/portfolio/src/perspectives/index.ts`: exportado el verificador para poder usarlo desde tests, auditoría y futuras herramientas de diagnóstico.
- `packages/portfolio/src/perspectives/sim-engine.ts`: corregida la conciliación anual de EURC para restar `eurcReinvestedEur` completo en lugar de restar solo `rebuysEur`; evita diferencias cuando existe reinversión residual adicional.
- `packages/portfolio/src/perspectives/sim-engine.test.ts`: añadido test que ejecuta el motor real y lo compara contra el verificador independiente.
- `packages/portfolio/src/perspectives/sim-engine.test.ts`: añadido caso matemático controlado de recompra: 5.000 EUR a 10 EUR, 500 unidades, precio posterior 14 EUR (+2.000 EUR) y 8 EUR (-1.000 EUR), verificando que la rentabilidad de la recompra llega a patrimonio y beneficio sin aumentar capital externo.

Pruebas ejecutadas:

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/perspectives/sim-engine.test.ts` — OK, 78 tests.
- `npm --prefix packages/portfolio run test` — OK, 18 files / 388 tests.
- `npm --prefix packages/portfolio run build` — OK.
- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 13 files / 144 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.

Actualización 2026-06-30 — DMG final instalado y verificado

Commit final instalado: `177f03b0b0f5ac5145078a77b4109f3b07a5234f`.

Corrección adicional aplicada antes del DMG final:

- `packages/portfolio/src/perspectives/sim-engine.ts`: `internalRebuyTotalReturnPct` usa como denominador el principal acumulado de recompras (`cumulativeInternalRebuyPrincipalEur`) también cuando lotes recomprados han sido vendidos después. Evita que la ganancia realizada quede en el numerador pero el principal vendido salga del denominador.

Validaciones previas al empaquetado final:

- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 13 files / 144 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/portfolio run test` — OK, 18 files / 388 tests. Primer intento bajo carga paralela agotó timeout en un test de importación; repetido en solitario pasó completo.
- `npm --prefix packages/portfolio run build` — OK.

DMG final:

- Ruta: `/Users/macmini/Developer/crypto-realtime-perspectives/dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256: `f8463b6583c2a32163886719271c5edc944e639dabffa0ebf5e211055c9c1a3a`.
- Instalado en `/Applications/Crypto Control.app`.
- La app instalada sirve el bundle con `commit=177f03b0b0f5ac5145078a77b4109f3b07a5234f`, `commitShort=177f03b`, rama `codex/final-engine-rebuild`.
- SQLite real tras instalación: `PRAGMA integrity_check` = `ok`.
- Backup previo verificado: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260630-151514/crypto-control.sqlite`, SHA-256 `447519d3290184eed1665400523fafb57d8f80044e0be40a71058c10251cbcae`, integridad `ok`.

Perspectivas instaladas:

- JSON real extraído desde la app instalada: `/tmp/crypto-control-perspectives-final-177f03b-20260630-154429.json`.
- Tamaño JSON: 3.019.292 bytes.
- Escenarios presentes: conservador, moderado, base, favorable, optimista.
- `engineBuildHash`: `realtime-perspectives-engine`.
- `engineVersion`: `perspectives-v4.0-market-regimes`.
- Verificador independiente: 635 comprobaciones, 0 fallos.
- Resultado final neto por escenario:
  - Conservador: 153.291,69 EUR.
  - Moderado: 157.263,85 EUR.
  - Base: 186.773,53 EUR.
  - Favorable: 195.062,07 EUR.
  - Optimista: 221.377,57 EUR.

Pendientes que siguen fuera del alcance ya comprobado:

- El libro mayor mensual completo 2026-2044 todavía no se persiste como artefacto propio dentro del repositorio.
- TWR/XIRR todavía no están recalculados por un verificador externo separado; el verificador actual cubre patrimonio, EURC, beneficio, bruto/neto y recompras.
Actualización 2026-06-29 — Corrección bloqueante definitiva de Perspectivas

Nueva ampliación recibida

Adjuntos leídos completos:

- `CORRECCIÓN BLOQUEANTE DEFINITIVA — RECONSTRUIR EL MOTOR COMPLETO DE PERSPECTIVAS CON CICLOS ALCISTAS, BAJISTAS, MERCADOS LATERALES, VENTAS PARCIALES Y RECOMPRAS`.
- `AMPLIACIÓN BLOQUEANTE — ORIGEN Y CÁLCULO DE LOS PERIODOS ALCISTAS, BAJISTAS Y LATERALES`.

Cambios realizados

- Añadido `packages/portfolio/src/perspectives/market-regime-engine.ts`.
- `runPerspectivesSimulation()` ya no consume directamente la interpolación mensual de `buildExternalPriceMap()` como trayectoria final.
- Los precios externos verificados quedan como anclajes de largo plazo; la trayectoria mensual productiva se genera con un motor de regímenes.
- Eliminada la secuencia fija de regímenes por escenario que se había introducido inicialmente en esta fase.
- Añadido modelo explícito de transición probabilística entre regímenes, con duración muestreada, semilla reproducible y sesgo por escenario/tipo de activo.
- Añadido clasificador histórico `classifyHistoricalMarketRegimes()` con señales múltiples e histéresis: rentabilidad, medias, drawdown, volumen y confirmación mínima.
- Añadido `CurrentMarketRegime` inyectable como `currentRegime` en el generador de trayectoria.
- Añadidos diagnósticos productivos: `marketRegimeEngine`, `negativeMonths` y `regimeCounts`.
- Ventas/recompras inteligentes pasan a depender de régimen y score (`SellOpportunityScore`/`RebuyOpportunityScore`), no de tramos fijos `+50/+100/+200` o `-15/-25/-40`.

Evidencia numérica local

- `diagnostics.source`: `market-regime-engine+active-forecast-anchors`.
- `engineVersion`: `perspectives-v4.0-market-regimes`.
- `marketRegimeEngine`: `true`.
- `negativeMonthCount`: 481 en la prueba reproducible 2026-2044.
- `realisticCycleValidation`: `passed`.
- Los cinco escenarios existen: conservador, moderado, base, favorable y optimista.
- Ningún escenario es estrictamente monótono.
- Optimista conserva periodos negativos: 99 meses negativos en la prueba reproducible.
- Control 2036-2044 deja de ser `cierre = apertura + aportación - comisión`; todos los años revisados tienen resultado de mercado distinto de cero en la prueba reproducible.
- Ejemplo 2036-2044, escenario base: 2036 `+9.618`, 2037 `+71`, 2038 `-9.693`, 2039 `+15.093`, 2040 `+15.388`, 2041 `+18.557`, 2042 `-8.388`, 2043 `+2.018`, 2044 `+40.522` EUR de resultado de mercado.

Pruebas añadidas

- Misma semilla produce misma trayectoria.
- Semilla distinta produce trayectoria distinta.
- Cambiar régimen actual cambia la distribución futura.
- Optimista contiene meses negativos y drawdown.
- Activos distintos no copian la misma curva.
- Una caída breve no confirma mercado bajista.
- Una caída profunda/prolongada puede clasificar corrección/bajista/capitulación.
- Simulación expone meses negativos, conteo de regímenes y evita proyección estrictamente monótona.

Pruebas ejecutadas en esta fase

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 67 tests.
- `npm --prefix packages/portfolio test` — OK, 18 files / 377 tests.
- `npm --prefix packages/database run typecheck` — OK.
- `npm --prefix packages/database test` — OK, 5 files / 25 tests.
- `npm --prefix packages/market-data run typecheck` — OK.
- `npm --prefix packages/market-data test` — OK, 5 files / 49 tests.
- `npm --prefix packages/coinbase-sync run typecheck` — OK.
- `npm --prefix packages/coinbase-sync test` — OK, 5 files / 62 tests.
- `npm --prefix packages/core run typecheck` — OK.
- `npm --prefix apps/desktop run typecheck` — OK.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/web test` — OK, 12 files / 143 tests.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix apps/web run build` — OK.
- `npm run build:desktop` — OK.
- `npm --prefix packages/portfolio run build` — OK, necesario antes de empaquetar para que Electron incluya `packages/portfolio/dist` actualizado.
- `npm run dist:mac` — OK.
- DMG final: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 final: `2b814d3de28a540cac80f2bce0061914d531cfeecc62b1b8b2f2bb856e640d1f`.
- Instalación final en `/Applications/Crypto Control.app` — OK.
- Verificación IPC instalada `persp2:getSimulation` — OK: `source = market-regime-engine+active-forecast-anchors`, `engineVersion = perspectives-v4.0-market-regimes`, `marketRegimeEngine = true`, cinco escenarios presentes, `realisticCycleValidation = passed`.

Actualización 2026-06-29 — Tarea maestra bloqueante de reconstrucción total

Nueva tarea recibida

Adjuntos duplicados leídos y comparados:

- `eddd7b2b-fa77-407b-ab34-83fcd5e61020/pasted-text.txt`
- `dff945be-48d6-4bed-b15b-71d01dd0d57a/pasted-text.txt`

Ambos tienen el mismo SHA-256: `9820df46ab33d1788af8e966b1ab19c199816ae4b81019b6e483bd2a3f0c131c`.

Congelación del estado anterior

- Evidencia guardada en `docs/tasks/evidence/perspectives-before-rebuild-20260629-225034/`.
- JSON completo de app instalada: `persp2-getSimulation-full.json` (`971K`).
- Resumen de escenarios: `scenario-summary.json`.
- Captura actual: `perspectivas-before-screen.png`.
- Estado Git: `git-state.txt`.
- Procesos de app instalada: `app-processes.txt`.
- DB real verificada con `PRAGMA integrity_check = ok`.
- Extractos guardados de plan, ciclos, activos de inversión, lotes, realized gains, transacciones, legs, previsiones activas, fuentes, snapshots Coinbase y posiciones Coinbase.

Diagnóstico del antes

- Commit de trabajo antes de esta tarea: `f6fad0fe7253bb52bd5a33a868ae52148dfe425b`.
- Motor instalado: `perspectives-v4.0-market-regimes`.
- Candidate activo: `verified-active-1782499645854`.
- Orden observado en app instalada antes de esta reconstrucción: Conservador `157.478,93`, Moderado `142.933,68`, Base `156.052,32`, Favorable `130.568,09`, Optimista `166.697,85`.
- Orden inválido reproducido: Moderado < Conservador, Favorable < Base.
- Causa técnica principal confirmada: cada escenario genera su propia trayectoria estocástica; el azar puede dominar la semántica de escenario.

Cambios aplicados en esta fase

- `runPerspectivesSimulation()` añade `scenarioValidationStatus` y `scenarioOrder`.
- La app ya no presenta silenciosamente un orden incoherente: si falla, devuelve `invalid_order`.
- La generación de escenarios visibles pasa por selección cuantílica ordenada de resultados generados, eliminando la inversión de nombres observada en la base real.
- Los shocks de mercado por activo/horizonte se comparten entre escenarios para reducir el dominio de sorteos independientes.
- La pantalla Perspectivas usa el año seleccionado para las métricas principales de cabecera: patrimonio neto, patrimonio bruto, beneficio, capital externo, capital invertido, capital reinvertido, capital desplegado, coste abierto, EURC operativo y reserva fiscal.
- Las evidencias locales reales no se versionan: `docs/tasks/evidence/.gitignore` evita subir JSON/capturas con datos personales.

Validación instalada después del cambio

- DMG: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 instalado probado: `b5642ea3feafef6d28a6405e9db2537291dd7e60f77bbfe01f857c50cdd46496`.
- App instalada en `/Applications/Crypto Control.app`.
- IPC real `persp2:getSimulation` devuelve `scenarioValidationStatus = valid_order`.
- Orden real tras la corrección: Conservador `121.021`, Moderado `121.967`, Base `136.478`, Favorable `146.722`, Optimista `155.388`.

Limitación pendiente explícita

Esta fase corrige el fallo visible de orden y horizonte seleccionado, pero todavía no completa toda la tarea maestra: faltan el motor Monte Carlo real de al menos 1.000 trayectorias ejecutadas por modo, bolsas EURC por venta, ProfitHarvestCycle productivo completo, fiscalidad anual acumulativa, XIRR mensual real, doble entrada completa y conexión real de analistas/medios como factores probabilísticos. No debe considerarse cierre definitivo de la tarea maestra completa.

Actualización posterior — Origen estructurado y métricas de rentabilidad

Cambios realizados:

- `SimEvent` incorpora `origin` estructurado: `REAL`, `USER_RULE`, `INTELLIGENT_STRATEGY`, `HYBRID`, `PLAN_PURCHASE`, `INTERNAL_REALLOCATION`, `SYSTEM`.
- Los acumulados de ventas/recompras por modo dejan de depender de `description.includes()`.
- Añadida prueba de guardia que prohíbe `description.includes` en el motor de Perspectivas.
- XIRR usa aportaciones externas mensuales reales desde `allMonthlyStates`, no aportaciones agrupadas el 1 de julio.
- El resumen devuelve `twrCumulative` y `twrAnnualized` separados; `twr` se mantiene como compatibilidad con el anualizado.
- La UI etiqueta `TWR anualizado` y muestra `TWR acumulado` aparte.

Validación instalada:

- DMG probado: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 probado: `578f0f042620d1860f20017faf6877ffad17e3cd87ffcab06ac32557997086ed`.
- IPC real `persp2:getSimulation`: `scenarioValidationStatus = valid_order`.
- IPC real confirma eventos con `origin = INTELLIGENT_STRATEGY` en ventas simuladas.
- IPC real confirma `twrCumulative` y `twrAnnualized` presentes.

Pruebas ejecutadas:

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 70 tests.
- `npm --prefix packages/portfolio test` — OK, 18 files / 380 tests.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix apps/web test` — OK, 12 files / 143 tests.
- `npm --prefix packages/portfolio run build` — OK.
- `npm --prefix apps/web run build` — OK.
- `npm run build:desktop` — OK.
- `npm run dist:mac` — OK.

Actualización 2026-06-29 — Corrección contable de capital y EURC

Nueva ampliación recibida

Adjunto leído completo: `CORRECCIÓN CONTABLE BLOQUEANTE — DIFERENCIAR CAPITAL APORTADO, CAPITAL INVERTIDO, CAPITAL REINVERTIDO Y LIQUIDEZ EN EURC`.

Cambios realizados

- Añadidos acumuladores mensuales y anuales para compras externas, capital reinvertido y capital desplegado.
- Añadidos campos de resumen para `initialCapitalEur`, `externalContributionsEur`, `totalExternalPurchasesEur`, `reinvestedCapitalEur`, `cumulativeDeployedCapitalEur`, `currentInvestedCapitalEur`, `eurcOperatingLiquidityEur`, `eurcFiscalReserveEur`, `eurcSecurityReserveEur`, `openCostBasisEur`, `grossWealthEur` y `netProfitEur`.
- Las recompras con EURC ya no pueden confundirse con aportaciones externas; aumentan capital reinvertido y capital desplegado.
- Las recompras crean lote propio `sim_rebuy` y el evento registra EURC usado, comisión, coste base, origen de EURC y ciclo relacionado.
- El beneficio neto se calcula frente a capital externo aportado, no frente a recompras internas.
- Perspectivas muestra por separado aportaciones externas, capital invertido actual, capital reinvertido, capital desplegado, coste de posiciones abiertas, EURC operativo, EURC fiscal y EURC de seguridad.

Pruebas añadidas

- Venta/recompra no incrementa aportaciones externas.
- Recompra incrementa capital reinvertido y capital desplegado.
- Recompra reduce EURC operativo y no toca reserva fiscal.
- Recompra crea trazabilidad de evento/lote.
- Beneficio neto no se reduce artificialmente por sumar recompras como aportaciones.
- XIRR y TWR siguen tratándose como métricas sobre flujos externos, no sobre movimientos internos.

Pruebas ejecutadas en esta fase

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 68 tests.
- `npm --prefix packages/portfolio test` — OK, 18 files / 378 tests.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix apps/web test` — OK, 12 files / 143 tests.
- `npm --prefix packages/portfolio run build` — OK.
- `npm --prefix apps/web run build` — OK.
- `npm run build:desktop` — OK.

Ejecución local del motor modificado contra SQLite real y snapshot vivo:

- Conservador: neto 78.963,13 EUR; ventas 0; recompras 0; impuestos 0.
- Moderado: neto 81.147,38 EUR; ventas 0; recompras 0; impuestos 0.
- Base: neto 87.882,67 EUR; ventas 0; recompras 0; impuestos 0.
- Favorable: neto 94.543,10 EUR; ventas 0; recompras 0; impuestos 0.
- Optimista: neto 129.677,85 EUR; ventas 0; recompras 0; impuestos 0.

Pruebas ejecutadas en esta fase

- `npm --prefix packages/portfolio run test -- src/perspectives/sim-engine.test.ts` — OK, 61 tests.
- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/signals/signal-engine.test.ts` — OK, 12 tests.
- `npm --prefix packages/market-data run test -- src/asset-health.test.ts` — OK, 8 tests.
- `npm --prefix packages/core run typecheck` — OK.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix packages/portfolio run test` — OK, 21 files / 456 tests.

Pendiente

- Ejecutar la batería completa antes de build/release.
- Revisar si las funciones hipotéticas deben moverse explícitamente a un módulo de backtesting/modo sombra.
- Añadir persistencia completa en SQLite de ciclo `ProfitHarvestCycle` antes de emitir alertas accionables como estado duradero.
- Validar móvil/escritorio y DMG solo después de terminar la integración completa.

Ampliación correctiva bloqueante añadida

Archivo añadido: `docs/tasks/CRYPTO_CONTROL_STRATEGY_CLARIFICATION.md`.

Contenido copiado literalmente desde el adjunto `AMPLIACIÓN CORRECTIVA BLOQUEANTE — DIFERENCIAR OPERACIONES REALES, SIMULACIÓN ESTRATÉGICA Y ALERTAS DINÁMICAS`.

Tamaño: 16.998 bytes, 730 líneas.

Nota de integridad: el documento recibido termina en la frase `La terminología correcta será`; no se ha completado ni inferido el resto.

Interpretación obligatoria:

- La corrección de no registrar operaciones inexistentes en cartera real se mantiene.
- La simulación estratégica de Perspectivas no debe quedar globalmente limitada a cero ventas/recompras cuando no existan reglas manuales.
- Deben separarse tres capas: operaciones reales, simulación estratégica y alertas dinámicas.
- Deben existir modos explícitos: `PASSIVE`, `USER_RULES`, `INTELLIGENT_STRATEGY` y `HYBRID`.
- Los campos agregados deben distinguir importes realizados de importes simulados/propuestos, por ejemplo `realizedSalesEur`, `simulatedStrategicSalesEur`, `proposedSalesEur`, `projectedEurcReserve` y `projectedFiscalReserve`.
- Las operaciones simuladas deben estar marcadas como simulación, no modificar el libro mayor real y requerir confirmación humana para convertirse en operación real.
- La página Perspectivas debe comparar estrategia pasiva, reglas de usuario, estrategia inteligente e híbrida en los cinco escenarios.

Impacto sobre los últimos cambios:

- Los tests que exigen ventas/recompras a cero son válidos solo para capa real, modo pasivo, modo sin estrategia táctica o ausencia de señales suficientes.
- Pendiente ajustar nombres y alcance de tests/campos para no bloquear la futura estrategia inteligente.

Ejecución de la ampliación correctiva

Cambios aplicados:

- `packages/portfolio/src/perspectives/types.ts`: añadido `SimulationStrategyMode` con `PASSIVE`, `USER_RULES`, `INTELLIGENT_STRATEGY` y `HYBRID`.
- `packages/portfolio/src/perspectives/types.ts`: añadido desglose no ambiguo en `ScenarioSummary`: `realizedSalesEur`, `realizedRebuysEur`, `realizedTaxEur`, `simulatedUserRuleSalesEur`, `simulatedUserRuleRebuysEur`, `simulatedUserRuleTaxEur`, `simulatedStrategicSalesEur`, `simulatedStrategicRebuysEur`, `simulatedStrategicTaxEur`, `proposedSalesEur`, `proposedRebuysEur`, `projectedEurcReserve`, `projectedFiscalReserve`, `strategyMode`, `strategySource`, `simulationOnly`, `requiresUserConfirmation` y `decision`.
- `packages/portfolio/src/perspectives/sim-engine.ts`: `PASSIVE` no ejecuta ventas/recompras tácticas; `USER_RULES` ejecuta solo reglas configuradas; `INTELLIGENT_STRATEGY` permite propuestas hipotéticas del motor; `HYBRID` combina reglas y propuestas inteligentes.
- `packages/portfolio/src/perspectives/sim-engine.ts`: añadido `strategyComparisons` para comparar pasivo, reglas, inteligente e híbrido en los cinco escenarios.
- `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`, `packages/core/src/ipc.ts` y `apps/web/src/lib/setupApi.ts`: expuesto `strategyMode` en el contrato.
- `apps/web/src/pages/Perspectivas.tsx`: añadida tabla de comparación por estrategia y etiquetas explícitas de operaciones simuladas, confirmación requerida y operaciones reales.

Pruebas ejecutadas tras esta ampliación:

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/perspectives/sim-engine.test.ts` — OK, 62 tests.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix apps/desktop run typecheck` — OK.
- `npm --prefix packages/core run typecheck` — OK.
- `npm --prefix packages/portfolio run test` — OK, 21 files / 457 tests.
- `npm --prefix apps/web run lint` — OK.
- `npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run build` — OK.
- `npm --prefix apps/web run build` — OK tras limpiar `apps/web/node_modules/.tmp/tsconfig.*.tsbuildinfo`; la primera ejecución usó caché incremental antigua y no veía `insufficient_data`.
- `npm --prefix apps/web run test` — OK, 12 files / 143 tests.
- `npm --prefix packages/portfolio run build` — OK.
- `npm --prefix packages/market-data run typecheck` — OK.
- `npm --prefix apps/web run dev` — OK, servidor local `http://localhost:5173/` levantado y detenido.
- `curl -sS http://localhost:5173/perspectivas` — OK, HTML de Vite servido.
- Búsqueda estática de `Comparación de estrategia`, `Operaciones simuladas por el motor estratégico`, `strategyComparisons` y `SimulationStrategyMode` — OK.

Pendiente de esta ampliación:

- Validar visualmente Perspectivas con la tabla nueva.
- Mover las funciones hipotéticas a un módulo explícito de estrategia/backtesting si se decide separar físicamente la capa B.
- Completar persistencia de alertas dinámicas y ciclos `ProfitHarvestCycle`.

Bloqueo de validación visual automatizada:

- Playwright está instalado, pero no tiene Chromium descargado en `/Users/macmini/Library/Caches/ms-playwright/...`.
- No se instalaron binarios de navegador durante esta fase.

Ejecución posterior

Cambios aplicados:

- `packages/portfolio/src/profit-harvest-cycle.ts`: añadido modelo explícito `ProfitHarvestCycle` para separar venta/recompra simulada, reserva fiscal, EURC operativo, señales asociadas, confirmación humana y resultado frente a mantener.
- `packages/portfolio/src/index.ts`: exportado el modelo de ciclo.
- `packages/portfolio/src/profit-harvest-cycle.test.ts`: añadidos tests de reserva fiscal, precio de recompra de equilibrio, recompra simulada y modo pasivo.

Pruebas ejecutadas:

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio run test -- src/profit-harvest-cycle.test.ts src/perspectives/sim-engine.test.ts` — OK, 65 tests.

Pendiente:

- Persistencia SQLite completa del ciclo si se va a activar como estado duradero de producción.
- No hacer push hasta revisar el diff final y confirmar que no se incluyen artefactos, bases de datos ni credenciales.

Validación amplia posterior

Pruebas y builds:

- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 22 archivos / 460 tests.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test && npm --prefix packages/database run build` — OK, 4 archivos / 23 tests.
- `npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, 5 archivos / 62 tests.

Validación visual:

- `apps/web` servido en `http://127.0.0.1:5173/` — OK.
- Captura `artifacts/perspectivas-hash-visual-check.png` — Perspectivas renderiza cinco escenarios, modo `Estrategia inteligente`, operaciones reales 0 €, ventas/recompras simuladas y propuesta simulada.
- Captura `artifacts/installed-perspectivas-check.png` — build instalado renderiza Perspectivas con confirmación de usuario requerida.
- Nota: Chrome headless escribió capturas pero dejó procesos auxiliares de updater; se interrumpieron manualmente. Playwright no está instalado en este checkout.

Copias de seguridad

- Base detectada para la app instalada: `/Users/macmini/Library/Application Support/Crypto Control Nueva/crypto-control.sqlite`.
- Copia creada: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260629-064643/`.
- `PRAGMA integrity_check` sobre copia principal — OK.
- SHA-256 copia principal: `4e13ac6b0c44cb55bcf37f50f6eb0695218f276e7d6e0b8495f0e0c8039e8c96`.
- SHA-256 copia SHM: `e965dd82d0ce927be34aabda432d13a9cf4984e8d4e4e5c4c309f4f6d59304c5`.
- SHA-256 copia WAL: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (WAL vacío).

DMG e instalación

- Comando: `npm run dist:mac` — OK.
- DMG: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 DMG: `8c9b4e923b3532ee9f7e62f2a654d07b0ffb7d94ecb426a85b6a1d4af7d7c430`.
- DMG montado y verificado por `hdiutil attach` — OK.
- App copiada a `/Applications/Crypto Control.app` — OK.
- Primera apertura instalada — OK, proceso escuchando en `:3001`.
- Segunda apertura instalada — OK, proceso escuchando en `:3001` y sirviendo HTML.

Cierre de pendientes posteriores

Dependencias instaladas:

- `playwright` añadido como dependencia de desarrollo.
- `npx playwright install chromium` — OK, Chromium/Headless Shell/FFmpeg descargados en la caché local de Playwright.
- `npm audit` tras instalar informa 14 vulnerabilidades transitivas existentes; no se ejecutó `npm audit fix --force` para evitar cambios de dependencias no solicitados y potencialmente rupturistas.

Persistencia `ProfitHarvestCycle`:

- `packages/database/src/schema.ts`: añadida tabla `profit_harvest_cycles`.
- `packages/database/src/db.ts`: añadida creación defensiva `CREATE TABLE IF NOT EXISTS profit_harvest_cycles`.
- `packages/database/drizzle/0018_profit_harvest_cycles.sql`: añadida migración aditiva.
- `packages/database/drizzle/meta/_journal.json`: registrada migración `0018_profit_harvest_cycles`.
- `packages/database/src/profit-harvest-repository.ts`: añadido repositorio `DatabaseProfitHarvestRepository`.
- `packages/database/src/profit-harvest-repository.test.ts`: añadidos tests que verifican persistencia sin crear `transactions` ni `realized_gains`.
- `packages/database/src/migration.test.ts`: actualizado para exigir `profit_harvest_cycles`.

Pruebas y builds tras persistencia:

- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test` — OK, 5 archivos / 25 tests.
- `npm --prefix packages/portfolio run typecheck && npm --prefix packages/portfolio run test -- src/profit-harvest-cycle.test.ts` — OK.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 22 archivos / 460 tests.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix packages/database run build && npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, coinbase-sync 5 archivos / 62 tests.
- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.

Validación Playwright:

- Vite local `http://127.0.0.1:5173/#/perspectivas` con Playwright Chromium — OK en desktop y móvil.
- App instalada `http://127.0.0.1:3001/#/perspectivas` con Playwright Chromium — OK en desktop y móvil.
- Comprobado que existen los cinco escenarios y textos `Operaciones reales`, `Ventas simuladas`, `Recompras simuladas` y `Confirmación`.

Backup e instalación posterior:

- Copia previa a la migración real: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260629-124853/`.
- `PRAGMA integrity_check` sobre copia — OK.
- SHA-256 copia principal: `5822866d10e2693d0fe0fb99a54f8d290af2c9ac2b713bb114b2e22640dd36e7`.
- Nuevo DMG generado con `npm run dist:mac` — OK.
- SHA-256 nuevo DMG: `4b49ff0f79d0e9b5e51b46e2711e935b046d7bac9dc333a5db6de06fde53b192`.
- App reinstalada en `/Applications/Crypto Control.app` — OK.
- Primera apertura tras migración — OK, `:3001` activo.
- Base real tras abrir app: tabla `profit_harvest_cycles` existe, `PRAGMA integrity_check` — OK.
- Contadores después de migración: `transactions=78`, `realized_gains=18`, `profit_harvest_cycles=0`.
- Segunda apertura tras migración — OK, `:3001` activo, `PRAGMA integrity_check` — OK.

Corrección posterior por motor antiguo de Perspectivas

Hallazgo:

- `apps/desktop/src/main.ts` todavía exponía `perspectives:getProjection`, que ejecutaba `runAllScenarios` del `projection-engine` antiguo.
- La página principal usaba `persp2:getSimulation`, pero el motor viejo seguía alcanzable por IPC/API y podía producir resultados distintos.

Cambios aplicados:

- Retirado el handler productivo `perspectives:getProjection` de `apps/desktop/src/main.ts`.
- Retirado `getProjection` del preload Electron, de la API web HTTP y del contrato `FullCryptoControlAPI`.
- Actualizados tests/mocks para exigir que `getProjection` no exista y que Perspectivas use `persp2:getSimulation`.
- Eliminada la función auxiliar no usada `getProjectionDynamicFactors` del main process.
- Retirado `packages/portfolio/src/projection-engine` y su `dist` generado para que el motor antiguo no quede empaquetado.
- Movida la configuración fiscal compartida a `packages/portfolio/src/fiscal-config.ts`.
- Movidos los tipos de snapshot consolidado a `packages/portfolio/src/plan-snapshot.ts`.

Evidencia:

- Búsqueda productiva: no quedan usos de `projection-engine`, `runProjection`, `runAllScenarios`, `compareScenarios`, `validateWealthFloor`, `validateScenarioOrdering`, `buildContributionLedger` ni `perspectives:getProjection` en `packages/portfolio/src`, `packages/portfolio/dist`, `apps/desktop`, `apps/web` o `packages/core`.

Pruebas tras retirar el motor antiguo:

- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix apps/web run typecheck && npm --prefix apps/web run test -- src/lib/setupApi.test.ts src/PlanInversion.test.tsx` — OK, 43 tests.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix apps/web run lint && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix packages/portfolio run typecheck && npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 18 archivos / 372 tests.
- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test && npm --prefix packages/database run build` — OK, 5 archivos / 25 tests.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, 5 archivos / 62 tests.
- Backup previo a instalación: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260630-145735/`, `PRAGMA integrity_check` — OK.
- SHA-256 backup principal: `1a3cdaa75d63f6bb08a552bd7c1f79dcd889fe2188184b5e077c30cffd14bfe8`.
- Commit del bloque: `2d51e23c85f23293586e00f22c81045369a8ad7f`.
- DMG generado con `npm run dist:mac` — OK.
- SHA-256 DMG: `3c0b0d2d1f01a61becb3e1fef374fc44d9f22bdf85a31c724715e4c4445be04b`.
- DMG instalado en `/Applications/Crypto Control.app` — OK.
- Validación real por `POST /api/ipc persp2:getSimulation` en app instalada — OK: cinco escenarios, `totalRebuysEur=25082.365103786367`, `internalRebuyPrincipalEur=25082.365103786367`, `internalRebuyCurrentMarketValueEur=60890.67959469153`, `internalRebuyTotalReturnEur=40778.57477173332`.
- Base real tras instalación: `PRAGMA integrity_check` — OK.
- Backup previo final: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260629-130536/`, `PRAGMA integrity_check` — OK.
- SHA-256 backup principal final: `ce9a639f321a41ea17c7dc31a511b7f44825d48bc996e6f53211cfa2dd639e2c`.
- DMG final regenerado e instalado — OK.
- SHA-256 DMG final: `6394de25874f9851839fca10464127d003d8ccc101624f6f701af5a13f189a46`.
- `app.asar` final extraído y auditado: no contiene `projection-engine`, `runProjection`, `runAllScenarios`, `compareScenarios`, `validateWealthFloor`, `validateScenarioOrdering`, `buildContributionLedger` ni `perspectives:getProjection`.
- App instalada abierta — OK, `:3001` activo.
- Base real tras abrir app final: `PRAGMA integrity_check` — OK; `profit_harvest_cycles=0`.
- Playwright contra app instalada final en desktop y móvil — OK.

Actualización 2026-06-29 — Ampliación bloqueante de revisión año a año

Nueva ampliación recibida

Adjunto leído completo:

- `AMPLIACIÓN BLOQUEANTE — EVALUACIÓN AÑO POR AÑO DE COMPRAS, VENTAS, LIQUIDEZ Y RECOMPRAS`.

Cambios realizados

- Añadidos tipos productivos `MonthlyDecisionType`, `MonthlyStrategyDecision` y `AnnualStrategyReview` en `packages/portfolio/src/perspectives/types.ts`.
- `ScenarioResult` ahora expone `annualStrategyReviews` junto a `annualSnapshots`.
- Añadido `buildAnnualStrategyReview()` en `packages/portfolio/src/perspectives/sim-engine.ts`.
- Cada año de cada escenario resume las decisiones mensuales cronológicas desde los `MonthlyState` ya simulados.
- Cada mes emite decisiones explícitas: continuar compras del plan, mantener, preparar venta, ejecutar venta, conservar EURC, preparar recompra, ejecutar recompra, esperar estabilización y redistribuir si procede.
- Cada revisión anual incluye patrimonio inicial/final, aportaciones externas, compras del plan, ventas, ganancia realizada, fiscalidad, EURC generado/final, recompras, capital reinvertido, unidades iniciales/finales por activo, resultado de mercado, TWR anual/acumulado, XIRR hasta el año, drawdown, régimen predominante, decisiones ejecutadas y descartadas.
- Se registran oportunidades evaluadas y motivos de descarte por mes; ya no queda un año sin explicación salvo que no exista posición evaluable.
- Se marca explícitamente `usesFutureInformation: false` en cada decisión mensual.
- Añadida conciliación anual de patrimonio y EURC en `AnnualStrategyReview.reconciliation`.

Pruebas ejecutadas

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 74 tests.
- `npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 18 archivos / 384 tests.
- `npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test && npm --prefix packages/database run build` — OK, 5 archivos / 25 tests.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, 5 archivos / 62 tests.

Pendiente de este bloque antes de otro DMG

- Backup previo a instalación: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260629-232658/`, `PRAGMA integrity_check` — OK.
- SHA-256 backup principal: `509aac0f04caf34d9dacdea625ee9d14173817c0868b5285ec82f28c9dfcce67`.
- DMG generado con `npm run dist:mac` — OK.
- Ruta DMG: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 DMG: `6757a577e07557191b29175d238a40e196472b6a58f60dc4d9c6cec0cbf9c821`.
- DMG montado e instalado en `/Applications/Crypto Control.app` — OK.
- App instalada abierta — OK, puente HTTP en `127.0.0.1:3001`.
- Segunda apertura tras reinstalación — OK.
- Validación real por `POST /api/ipc persp2:getSimulation` — OK: cinco escenarios (`conservador`, `moderado`, `base`, `favorable`, `optimista`), 19 `annualSnapshots`, 19 `annualStrategyReviews`, primera conciliación anual superada y `usesFutureInformation=false`.
- Base real tras instalación: `PRAGMA integrity_check` — OK.
- Commit del bloque: `d4cd65db6d383594cdc71bd9ccbf4b9a11524686`.
- Push de `codex/final-engine-rebuild` — OK.
- Fast-forward de `main` a `d4cd65db6d383594cdc71bd9ccbf4b9a11524686` — OK.

Actualización 2026-06-30 — Rentabilidad real de recompras y recuperación de gráficas de Cartera

Nueva ampliación recibida

- `AMPLIACIÓN BLOQUEANTE — RENTABILIDAD REAL DE LAS RECOMPRAS Y RECUPERACIÓN ROBUSTA DE LAS GRÁFICAS DE CARTERA`.

Auditoría específica

- Ruta productiva de recompras: `packages/portfolio/src/perspectives/sim-engine.ts`, funciones `evaluateRebuys()` y `evaluateProposedRebuys()`, consumida por `persp2:getSimulation`.
- La recompra ya sumaba unidades y creaba un lote `sim_rebuy`, pero no exponía origen de financiación ni métricas separadas de rentabilidad atribuible a lotes recomprados.
- Las ventas posteriores usaban FIFO global, pero no separaban plusvalía/minusvalía realizada de lotes de recompra.
- Ruta productiva de gráfica de Cartera: `apps/desktop/src/main.ts`, handler `portfolio:get-historical-series`.
- La reconstrucción usa `buildPortfolioValueGrid()` con cantidades históricas y precios de `price_history`/caché/mercado, pero para `1h` y `24h` devolvía temprano si no había suficientes puntos intradía, aunque existiera caché persistente parcial.

Cambios realizados

- `SimLot` ahora registra `fundingOrigin`, `sourceEurcBucketId`, `profitHarvestCycleId`, `purchaseDate`, `purchasePriceEur`, `purchaseValueEur`, `acquisitionCostsEur`, `units`, `openUnits` y `costBasisEur`.
- Las compras del Plan crean lotes `EXTERNAL_CONTRIBUTION`.
- Las recompras configuradas e inteligentes crean lotes `INTERNAL_REBUY` con bolsa EURC trazable y costes de adquisición.
- Las reinversiones/sustituciones internas crean lotes `INTERNAL_REALLOCATION`.
- Añadidas métricas explicativas: `internalRebuyPrincipalEur`, `cumulativeInternalRebuyPrincipalEur`, `internalRebuyOpenCostBasisEur`, `internalRebuyCurrentMarketValueEur`, `internalRebuyUnrealizedGainEur`, `internalRebuyRealizedGainEur`, `internalRebuyTotalReturnEur`, `internalRebuyTotalReturnPct`, `internalRebuyUnitsOpen`, `internalRebuyUnitsSold`.
- Las métricas anteriores se exponen en `AnnualSnapshot`, `AnnualStrategyReview` y `ScenarioSummary`.
- Las ventas FIFO atribuyen ganancia realizada a lotes `INTERNAL_REBUY` cuando consumen esos lotes.
- `portfolio:get-historical-series` ahora devuelve metadatos de estado/cobertura: `state`, `provider`, `generatedAt`, `oldestPointAt`, `newestPointAt`, `pointCount`, `expectedPointCount`, `coveragePct`, `missingRanges`, `usedPersistentCache`, `usedExternalFallback`, `isStale`, `warnings`.
- Para `1h` y `24h`, si fallan la carga exacta y el rescate externo pero existe caché persistente parcial con al menos dos puntos coherentes, se usa como `CACHE_PARTIAL`/`STALE_USABLE` en lugar de dejar la gráfica vacía.

Pruebas ejecutadas

- `npm --prefix packages/portfolio run typecheck` — OK.
- `npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 75 tests.
- `npm --prefix apps/desktop run typecheck` — OK.
- `npm --prefix packages/core run typecheck` — OK.
- `npm --prefix apps/web run typecheck` — OK.
- `npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 18 archivos / 385 tests.
- `npm --prefix apps/web run lint && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run build` — OK.
- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test && npm --prefix packages/database run build` — OK, 5 archivos / 25 tests.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, 5 archivos / 62 tests.

Pendiente de este bloque

- Backup previo a instalación: `/Users/macmini/Library/Application Support/Crypto Control Nueva/backups-codex-20260630-081148/`, `PRAGMA integrity_check` — OK.
- SHA-256 backup principal: `36e3ad11ce0c378a5eaf6ec39327569b6b3fc015da82405b95971640dda5e606`.
- Commit inicial del bloque: `56044592fe2f998ab921c78de8533621c065cd3d`.
- DMG generado con `npm run dist:mac` — OK.
- Ruta DMG: `dist-packaged/Crypto Control-0.1.0-arm64.dmg`.
- SHA-256 DMG validado: `6842df5292e16cfd029f41a88d10dffc5b1a4c25c901cd5a772cc567fdd1865a`.
- DMG montado e instalado en `/Applications/Crypto Control.app` — OK.
- App instalada abierta — OK, puente HTTP en `127.0.0.1:3001`.
- Validación real por `POST /api/ipc persp2:getSimulation` — OK: cinco escenarios, `totalRebuysEur=11328.173068747377`, `internalRebuyPrincipalEur=11328.173068747377`, `internalRebuyCurrentMarketValueEur=14067.514614471844`, `internalRebuyUnrealizedGainEur=2739.3415457244664`, `internalRebuyTotalReturnPct=0.24181671034686722`, `internalRebuyUnitsOpen=1147.0987072866262`.
- Validación real de gráfica de Cartera por `portfolio:get-historical-series` — OK:
  - `1h`: 61 puntos, `STALE_USABLE`, cobertura 100 %, caché persistente.
  - `24h`: 96 puntos, `CACHE_COMPLETE`, cobertura 98,97 %, caché persistente.
  - `1w`: 169 puntos, `CACHE_COMPLETE`, cobertura 100 %, caché persistente.
  - `1m`: 120 puntos, `CACHE_COMPLETE`, cobertura 99,17 %, caché persistente.
  - `1y`: 339 puntos, `CACHE_PARTIAL`, cobertura 92,62 %, caché persistente.
  - `all`: 34 puntos, `EXTERNAL_BACKFILL`, cobertura 56,67 %, caché persistente y recuperación externa.

Actualización 2026-06-30 — Recompras: reinvertir todo lo posible

Nueva aclaración recibida

- El EURC operativo procedente de ventas se estaba reinvirtiendo demasiado poco.
- El adjunto confirma que el motor no debe limitarse a contadores ni tramos conservadores cuando una tesis de recompra ya es válida.

Cambios realizados

- `evaluateProposedRebuys()` deja de usar tramos `20% / 35% / 50%` según score.
- Una recompra inteligente válida consume el 100% del `eurcFree` operativo disponible en ese momento.
- La reserva fiscal no se toca porque vive separada en `eurcFiscalReserve`.
- Añadida regresión: con EURC libre de 5.000 €, venta previa y oportunidad de recompra válida, la recompra usa 5.000 € completos, deja EURC operativo a 0 y registra `internalRebuyPrincipalEur=5.000`.

Pruebas ejecutadas

- `npm --prefix packages/portfolio run typecheck && npm --prefix packages/portfolio test -- src/perspectives/sim-engine.test.ts` — OK, 76 tests.
- `npm --prefix packages/portfolio run test && npm --prefix packages/portfolio run build` — OK, 18 archivos / 386 tests.
- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build` — OK, 12 archivos / 143 tests.
- `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run build` — OK.
- `npm --prefix packages/core run typecheck && npm --prefix packages/core run build` — OK.
- `npm --prefix packages/database run typecheck && npm --prefix packages/database run test && npm --prefix packages/database run build` — OK, 5 archivos / 25 tests.
- `npm --prefix packages/market-data run typecheck && npm --prefix packages/market-data run test && npm --prefix packages/market-data run build` — OK, 5 archivos / 49 tests.
- `npm --prefix packages/coinbase-sync run typecheck && npm --prefix packages/coinbase-sync run test && npm --prefix packages/coinbase-sync run build` — OK, 5 archivos / 62 tests.
