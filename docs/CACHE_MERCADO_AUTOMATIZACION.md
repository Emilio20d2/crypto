# Caché, Mercado y automatización de operaciones

## Objetivo

La aplicación debe:

1. abrir las gráficas de Cartera usando primero la base local;
2. actualizar en segundo plano sin dejar la pantalla esperando;
3. declarar exactamente qué datos de Mercado faltan;
4. utilizar precios, OHLCV, volumen, sentimiento y calidad verificables;
5. permitir compras y ventas manuales;
6. permitir programar ventas parciales en fases alcistas y recompras escalonadas en fases bajistas;
7. vincular las operaciones con los ciclos, reservas y objetivos de Perspectivas;
8. no utilizar nunca la reserva fiscal para recompras;
9. impedir duplicados y ejecuciones sin autorización vigente.

## Cambios implementados en esta rama

### Caché de mercado persistente

Se añade `market_series_cache_v2`, una caché SQLite por:

- activo;
- moneda;
- periodo;
- proveedor.

Guarda la serie completa en JSON con:

- timestamp;
- cierre;
- apertura;
- máximo;
- mínimo;
- volumen;
- fuente;
- confianza.

La lectura normal utiliza esta serie compacta antes de consultar miles de filas de `price_history`.

La tabla anterior se mantiene como compatibilidad y respaldo.

Los históricos dejan de borrarse antes de cada guardado. Se actualizan mediante upsert, evitando perder cobertura válida cuando un proveedor devuelve una respuesta parcial.

### Caché persistente de transacciones

Se añade `portfolio_transaction_cache_v1`.

La reconstrucción de transacciones, legs y comisiones se guarda en SQLite y solo se recalcula cuando cambia su firma contable.

Esto reduce el trabajo repetido de las gráficas de Cartera.

### Datos completos de Mercado

Los proveedores conservan ahora:

- Coinbase: OHLCV completo.
- CoinGecko: precio y volumen.
- CryptoCompare: OHLCV completo.

El sentimiento v2 utiliza:

- momentum 24h;
- tendencia 7d;
- tendencia 30d;
- volatilidad;
- confirmación por volumen;
- Fear & Greed;
- amplitud de mercado;
- confirmación agregada por volumen.

Cuando falta una señal:

- se incluye en `missingSignals`;
- baja la confianza;
- el estado pasa a `partial` o `unavailable`;
- nunca se sustituye por neutral para ocultar la ausencia.

### Motor de automatización

Se añade un evaluador puro para:

- `BULL_PARTIAL_SALE`;
- `BEAR_REBUY`.

Una venta parcial solo puede prepararse cuando:

- el régimen está autorizado;
- existe plusvalía suficiente;
- el sentimiento confirma la fase;
- los datos tienen calidad y antigüedad aceptables;
- se respetan límites diarios, cooldown y porcentaje residual;
- existe autorización vigente.

Una recompra solo puede prepararse cuando:

- el mercado está en corrección, bajista, capitulación o recuperación temprana;
- existe caída suficiente desde el precio de referencia;
- existe estabilización mínima;
- el sentimiento confirma la zona;
- hay EURC operativo libre;
- la reserva fiscal queda completamente excluida;
- se respeta el tramo, límite diario y objetivo vinculado.

### Persistencia e idempotencia

Se añaden:

- `automated_operation_policies_v1`;
- `automated_operation_runs_v1`.

Cada ejecución tiene una clave idempotente única para impedir órdenes duplicadas.

Estados:

- programada;
- monitorizando;
- bloqueada por datos;
- bloqueada por riesgo;
- pendiente de revisión;
- lista para preview;
- preview en curso;
- lista para enviar;
- enviada;
- completada;
- fallida;
- pausada;
- cancelada;
- caducada.

El runner exige un preview nuevo antes de enviar una orden.

## Integración pendiente antes de operar dinero real

El motor y la persistencia ya están disponibles, pero la ruta productiva de Electron todavía debe conectarlos con:

1. contexto real de Mercado y sentimiento;
2. ciclos y objetivos de Perspectivas V5;
3. reglas de ventas parciales y tramos de recompra;
4. preview real de Coinbase;
5. envío idempotente de la orden;
6. consulta posterior del estado de Coinbase;
7. sincronización de transacciones, FIFO, Tesorería y Perspectivas;
8. interfaz para activar, pausar, autorizar y auditar cada política.

Hasta que esta integración pase CI y pruebas con entorno controlado, la versión instalada debe continuar en modo revisión y no debe afirmar que ejecuta automáticamente.

## Reglas de seguridad obligatorias

- La automatización real es opt-in.
- La autorización debe tener fecha de caducidad.
- Deben existir límites por operación, día y número de operaciones.
- Un dato parcial o caducado bloquea la ejecución cuando la política exige cobertura completa.
- Cada orden debe tener preview fresco.
- Cada paso de una conversión multipaso debe persistirse.
- No se repite una orden que Coinbase ya aceptó.
- La reserva fiscal no se utiliza.
- Alcanzar el objetivo vinculado bloquea nuevas operaciones.
- Un fallo deja un estado recuperable y auditable.

## Criterios de aceptación

### Cartera

- La segunda carga de cada gráfica utiliza caché local.
- Reiniciar la aplicación no elimina la caché.
- Una respuesta parcial de un proveedor no borra el histórico anterior.
- La UI muestra cobertura, antigüedad, fuentes y rangos ausentes.
- Los puntos incompletos no se presentan como patrimonio total completo.

### Mercado

- Cada activo muestra qué señales están disponibles.
- Volumen real participa en sentimiento cuando existe.
- Los estados `partial` y `unavailable` son visibles.
- Las decisiones automáticas se bloquean con datos insuficientes.

### Operaciones

- Compra y venta manual mantienen preview y confirmación.
- Programar una venta alcista crea una política persistente.
- Programar una recompra bajista crea una política persistente.
- La condición se evalúa aunque no esté abierta la página Operaciones, siempre que el backend esté activo.
- El proceso crea preview, persiste el estado y envía una sola vez.
- La operación real se sincroniza con Coinbase, lotes, FIFO, Tesorería y objetivos.
- Las recompras se registran como capital interno desplegado y generan beneficios o pérdidas posteriores en Perspectivas.

## Estado de esta rama

Implementado:

- caché compacta de series;
- caché de reconstrucción transaccional;
- OHLCV en proveedores;
- sentimiento con volumen y cobertura;
- evaluador de automatización;
- persistencia de políticas y ejecuciones;
- runner idempotente;
- pruebas unitarias del evaluador y runner;
- workflow de CI.

Pendiente:

- conexión del runner a Electron y Coinbase;
- creación/edición de políticas desde Operaciones;
- cachear también el JSON final de la gráfica de Cartera;
- mostrar rangos ausentes reales;
- sincronización completa tras ejecución;
- pruebas E2E y DMG instalado.
