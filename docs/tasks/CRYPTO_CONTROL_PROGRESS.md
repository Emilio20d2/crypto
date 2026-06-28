Estado de Crypto Control

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
