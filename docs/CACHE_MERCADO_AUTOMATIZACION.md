# Caché, Mercado y automatización de operaciones

## Objetivo

Esta rama prepara tres bloques relacionados, sin declarar todavía que la aplicación puede operar dinero real automáticamente:

1. acelerar Cartera utilizando primero datos persistidos en SQLite;
2. completar y auditar los datos de Mercado y sentimiento;
3. construir la base segura para programar ventas parciales alcistas y recompras bajistas vinculadas a objetivos.

## Implementación auditada

### 1. Caché persistente de mercado

Se utiliza `market_series_cache_v2`, separada por activo, moneda, periodo y proveedor.

Cada serie conserva:

- fecha y hora;
- cierre;
- apertura;
- máximo;
- mínimo;
- volumen;
- proveedor;
- confianza.

La caché compacta se consulta antes de recorrer `price_history`. Los históricos nuevos se fusionan con los anteriores del mismo proveedor; una respuesta parcial no borra la cobertura válida ya guardada.

La lectura no mezcla velas de Coinbase, CoinGecko y CryptoCompare como si fueran una sola serie. Selecciona una serie coherente del proveedor con mejor combinación de cobertura, número de puntos, calidad, antigüedad y disponibilidad de volumen.

`price_history` continúa como respaldo y compatibilidad.

### 2. Caché persistente de transacciones

Se utiliza `portfolio_transaction_cache_v2`.

La reconstrucción de transacciones, legs y comisiones se guarda en SQLite. Triggers de SQLite invalidan automáticamente la caché al insertar, modificar o borrar:

- transacciones;
- legs;
- comisiones.

Por tanto, una segunda carga puede reutilizar el resultado sin volver a ejecutar escaneos contables completos y sin conservar datos antiguos después de una modificación.

La valoración de adquisición prioriza `acquisitionValueEur` y utiliza `valuationEur` solo como compatibilidad.

### 3. Proveedores de Mercado

Los proveedores conservan los campos disponibles:

- Coinbase: OHLCV completo;
- CoinGecko: precio y volumen;
- CryptoCompare: OHLCV completo.

También se han corregido:

- distinción entre timeout interno y cancelación solicitada por el consumidor;
- limpieza de listeners de cancelación;
- deduplicación de velas de Coinbase;
- emparejamiento eficiente de precio y volumen de CoinGecko;
- resolución de seis horas para los treinta días de CryptoCompare;
- rechazo de series en vivo con cobertura insuficiente antes de darlas por completas.

### 4. Sentimiento y calidad de datos

El sentimiento v2 puede utilizar:

- momentum de 24 horas;
- tendencia de 7 días;
- tendencia de 30 días;
- volatilidad;
- confirmación por volumen;
- Fear & Greed;
- amplitud de mercado;
- confirmación agregada por volumen.

Los datos ausentes, parciales o caducados se incluyen en `missingSignals`. Reducen la confianza y cambian el estado a `partial` o `unavailable`. No se sustituyen por una señal neutral para ocultar la ausencia.

Fear & Greed solo se acepta dentro del rango 0–100. Los resultados parciales tienen una validez más corta.

### 5. Evaluador de automatización

Se han creado dos tipos de política:

- `BULL_PARTIAL_SALE`;
- `BEAR_REBUY`.

Una venta parcial solo puede prepararse cuando se cumplen los requisitos configurados de régimen, plusvalía, sentimiento, calidad de datos, antigüedad, límites diarios, cooldown, posición residual y autorización.

Una recompra solo puede prepararse cuando se cumplen los requisitos de caída, régimen, sentimiento, estabilización, disponibilidad de EURC operativo, límites y objetivo vinculado.

`operatingEurcEur` representa EURC ya libre después de separar la reserva fiscal. La reserva fiscal se informa, se excluye y no se resta dos veces.

### 6. Autorización y seguridad

La ejecución automática exige:

- autorización explícita;
- fecha de autorización válida;
- fecha de caducidad;
- versión de autorización registrada;
- límite por operación;
- límite de operaciones diarias;
- límite de capital diario;
- datos suficientemente recientes;
- número mínimo de fuentes independientes;
- preview nuevo antes de enviar.

Una política mal formada o corrupta se desactiva y falla de forma segura.

### 7. Persistencia e idempotencia

Se utilizan:

- `automated_operation_policies_v1`;
- `automated_operation_runs_v1`.

Cada propuesta tiene una clave idempotente. El repositorio valida el flujo permitido entre estados y exige identificadores de orden para `SUBMITTED` y `COMPLETED`.

El runner no vuelve a enviar una operación ya enviada o completada. Si Coinbase acepta una orden y después falla la actualización auxiliar del contador de la política, la orden conserva su estado real; no se degrada falsamente a `FAILED`.

Estados soportados:

- `SCHEDULED`;
- `MONITORING`;
- `BLOCKED_DATA`;
- `BLOCKED_RISK`;
- `REVIEW_REQUIRED`;
- `READY_TO_PREVIEW`;
- `PREVIEWING`;
- `READY_TO_SUBMIT`;
- `SUBMITTED`;
- `COMPLETED`;
- `FAILED`;
- `PAUSED`;
- `CANCELLED`;
- `EXPIRED`.

## Verificación ejecutada

El workflow de CI comprueba por separado:

- Market Data: typecheck, pruebas y compilación;
- Portfolio: typecheck, pruebas y compilación;
- Database: compilación previa de dependencias locales, typecheck, pruebas y compilación;
- aplicación integrada: dependencias web, compilación de paquetes compartidos, typecheck web, pruebas web, build web, typecheck Electron y build Electron.

La ejecución de CI del 1 de julio de 2026, run `28540295717`, terminó correctamente en los cuatro trabajos.

Se corrigieron durante la auditoría fallos reales que inicialmente rompían CI:

- exportación duplicada de `ProfitHarvestCycleStatus`;
- pérdida de OHLCV durante la normalización;
- caché transaccional con invalidación insuficiente;
- combinación incoherente de proveedores;
- doble descuento de reserva fiscal;
- reintento potencial de órdenes ya completadas;
- transición de estados sin validación;
- timeout tratado como cancelación, impidiendo fallback;
- resolución insuficiente de CryptoCompare a treinta días;
- dependencias web no instaladas por la estructura actual del repositorio;
- firma incompatible del guard de Perspectivas legacy;
- ausencia de comprobación conjunta de web y Electron.

## Bloqueos antes de operar dinero real

El motor de evaluación y la persistencia están disponibles, pero todavía no están conectados a una ruta productiva completa de órdenes. Antes de activar dinero real faltan:

1. construir el contexto automático desde Mercado, sentimiento, Tesorería, ciclos y objetivos reales;
2. conectar cada política con preview real de Coinbase;
3. enviar la orden con clave idempotente;
4. consultar el estado posterior de Coinbase;
5. sincronizar transacciones, lotes, FIFO, Tesorería y Perspectivas;
6. crear la interfaz para programar, autorizar, pausar, cancelar y auditar políticas;
7. ejecutar pruebas E2E con un entorno controlado;
8. generar, instalar y validar el DMG con la base real y el keychain helper.

La ruta legacy `persp2:getSimulation` sigue protegida por un guard que falla de forma explícita. Compila para no romper Electron, pero no ejecuta el simulador retirado. Debe migrarse a `runPerspectivesV5Simulation` antes de publicar un DMG nuevo.

## Pendientes técnicos conocidos

- incorporar un `package-lock.json` propio de `apps/web` y sustituir la instalación temporal de CI por `npm ci --prefix apps/web`;
- formalizar como migraciones las tablas de caché y automatización que ahora se crean de forma defensiva con `CREATE TABLE IF NOT EXISTS`;
- cachear también el JSON final ya reconstruido de cada gráfica de Cartera;
- calcular y mostrar rangos históricos ausentes reales;
- mostrar en la interfaz cobertura, antigüedad y proveedor por activo;
- conectar el runner con Electron y Coinbase;
- migrar la ruta de Perspectivas legacy a V5;
- validar la aplicación instalada, no solo TypeScript, pruebas unitarias y builds.

## Estado de publicación

La rama y el PR deben permanecer en borrador.

No está autorizado afirmar que:

- la automatización real ya funciona;
- se pueden programar órdenes reales desde la interfaz;
- la aplicación instalada ha sido validada;
- el DMG está listo para producción.

La automatización real debe continuar desactivada hasta completar la integración y las pruebas anteriores.
