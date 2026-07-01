# Auditoría total de Crypto Control — 1 de julio de 2026

## Alcance y limitaciones

Esta auditoría revisa estáticamente:

- la rama `main`;
- el estado documentado de la aplicación instalada;
- la rama de reconstrucción `codex/perspectives-v5-clean-rebuild`;
- web, Electron, paquetes de cartera, mercado, base de datos, Coinbase, Plan, Tesorería, Fiscalidad, señales y Perspectivas;
- coherencia con los requisitos funcionales definidos para el proyecto.

Esta revisión no sustituye una ejecución local. Desde GitHub no se ha podido:

- arrancar Electron;
- ejecutar la base SQLite real del usuario;
- ejecutar los tests;
- generar o instalar un DMG;
- verificar llamadas reales a Coinbase;
- comprobar visualmente todos los flujos.

Por tanto, `PASS` significa que el diseño estático encontrado es coherente. La aceptación final requiere pruebas de ejecución y evidencia de la aplicación instalada.

Estados usados:

- `PASS`: diseño estático coherente y sin bloqueo encontrado.
- `PARTIAL`: existe implementación útil, pero faltan garantías o hay defectos relevantes.
- `FAIL`: incumple un requisito principal.
- `BLOCKED`: no puede validarse sin ejecución o datos reales.

---

# 1. Veredicto general

## Estado global: FAIL

El repositorio contiene módulos valiosos y varias mejoras reales, especialmente en datos de mercado, reconstrucción histórica de Cartera, protección de credenciales y previsualización de operaciones.

Sin embargo, no puede declararse que la aplicación completa funcione como se ha definido para el proyecto porque existen bloqueos críticos:

1. `main`, la aplicación instalada y la rama V5 representan tres estados diferentes.
2. Perspectivas V4 sigue siendo la ruta productiva.
3. Perspectivas V5 es solo una base incompleta y no está conectada.
4. No existe CI en GitHub que garantice tests, compilación y empaquetado en cada cambio.
5. Las operaciones Coinbase multipaso no son atómicas ni reanudables de forma segura.
6. La fiscalidad visible está fijada a tramos de 2024.
7. El arranque continúa incluso si fallan migraciones o tablas esenciales.
8. La identidad de aplicación y la ruta de datos no son consistentes: `Crypto Control` frente a `Crypto Control Nueva`.
9. La capa de inteligencia no usa realmente 10–15 fuentes activas por snapshot; gran parte es catálogo, ingestión pendiente o un análisis simple de titulares.
10. Varias pantallas de Configuración muestran estados positivos escritos de forma fija, no resultados comprobados.

---

# 2. Matriz de estado por módulo

| Área | Estado | Veredicto |
|---|---|---|
| Control de versiones y release | FAIL | La app instalada no coincide con `main`; V5 vive en otra rama |
| CI, tests y validación automática | FAIL | No hay workflow ni checks de GitHub |
| Base de datos y migraciones | PARTIAL | Hay migraciones y tablas de rescate, pero los fallos se registran y la app continúa |
| Seguridad Electron | PARTIAL | `contextIsolation` y `nodeIntegration=false` correctos; faltan CSP, sandbox y restricciones de navegación |
| Credenciales Coinbase | PASS estático | Se validan permisos antes de guardar en Llavero |
| Cartera en tiempo real | PARTIAL | Motor vivo y reconstrucción histórica útiles; falta prueba real completa |
| Gráficas de Cartera | PARTIAL | Buen orden de caché/fallback; `missingRanges` no se calcula y la UI aún puede quedar vacía |
| Mercado | PARTIAL | Coinbase, CoinGecko, CryptoCompare y caché; presión de consultas y validación real pendiente |
| Operaciones Coinbase | PARTIAL | Preview y confirmación reales; multipaso no atómico |
| Operaciones programadas | FAIL respecto a automatización | Solo quedan para revisión; no existe servicio persistente de ejecución |
| Plan | PARTIAL | Estructura completa y validaciones; faltan pruebas de integración y hay estados ambiguos |
| Compra inteligente | PARTIAL | Existe recomendación; no se ha validado extremo a extremo con datos reales |
| Ventas parciales y recompras reales | PARTIAL | Hay reglas, señales y preview; falta trazabilidad automática completa hasta Tesorería y lotes |
| Tesorería | PARTIAL | Separa EURC y reserva; permite movimientos manuales que requieren conciliación estricta |
| Fiscalidad | FAIL | Tramos 2024, cálculo en frontend y sin cierre fiscal anual completo |
| Alertas y señales | PARTIAL | Persistencia y notificaciones; solo funcionan con la app abierta y las fuentes son limitadas |
| Perspectivas V4 | FAIL | Arquitectura y resultados incompatibles con los requisitos |
| Perspectivas V5 | BLOCKED/FAIL | No conectada, sin motor mensual completo, paths, API, UI ni tests |
| Diagnóstico | PARTIAL | Muestra commit y algunos huecos; otros estados de Configuración son estáticos |
| DMG instalado | BLOCKED | Hay documentación, pero no evidencia reproducible desde `main` mediante CI |

---

# 3. Hallazgos bloqueantes P0

## P0-01 — Tres fuentes de verdad diferentes

Actualmente existen:

1. `main`, cuyo último commit documenta una instalación;
2. una aplicación instalada desde `codex/final-engine-rebuild`, commit `177f03b...`;
3. la rama `codex/perspectives-v5-clean-rebuild` con seis commits todavía no conectados.

Consecuencias:

- una corrección en `main` no garantiza que esté instalada;
- una captura no identifica necesariamente el código que se está auditando;
- el equipo puede validar un bundle distinto del repositorio visible;
- no existe una única rama protegida y reproducible.

Corrección obligatoria:

- definir `main` como única versión liberable;
- usar PR para V5;
- exigir CI verde;
- fusionar mediante commit identificable;
- generar el DMG exclusivamente desde ese commit;
- mostrar commit, hash del motor, esquema y ruta SQLite en Diagnóstico;
- guardar manifiesto de build dentro del artefacto.

## P0-02 — Identidad y ruta de datos incoherentes

El empaquetado usa `productName: Crypto Control`, mientras Electron ejecuta `app.setName("Crypto Control Nueva")` y el título de la ventana también contiene `Nueva`.

Esto puede producir rutas `userData` distintas, bases SQLite duplicadas y confusión entre instalaciones.

Corrección obligatoria:

- elegir una única identidad: `Crypto Control`;
- fijar explícitamente una ruta de datos única y migrable;
- detectar bases antiguas en ambas rutas;
- ofrecer migración segura con backup e integridad;
- impedir que dos instalaciones escriban bases diferentes sin aviso.

## P0-03 — Perspectivas V4 continúa en producción

La ruta productiva sigue siendo:

- `packages/portfolio/src/perspectives/sim-engine.ts`;
- `persp2:getSimulation`;
- `window.cryptoControl.persp2`;
- `engineVersion: perspectives-v4.0-market-regimes`.

La V5 no está exportada, no tiene coordinador, IPC, interfaz ni pruebas conectadas.

Corrección obligatoria:

- mantener V4 solo hasta que V5 pase pruebas controladas;
- conectar `perspectivesV5:getSimulation` en paralelo;
- comparar V4/V5 sin mostrar V5 como terminada;
- sustituir producción únicamente al pasar todos los criterios de aceptación;
- retirar V4 completamente tras la migración.

## P0-04 — Perspectivas V4 puede convertir aportaciones en EURC silenciosamente

Cuando falta un precio mensual, el motor V4 no compra unidades y suma la aportación a `eurcFree`.

Esto puede hacer que la proyección parezca una suma de aportaciones y que no existan beneficios o pérdidas reales.

Corrección obligatoria:

- bloquear con `INVALID_PRICE_PATH`;
- identificar activo y mes;
- no ejecutar la simulación hasta tener un path completo;
- no convertir una compra programada en liquidez sin decisión explícita.

## P0-05 — Capital de recompra abandonado

La captura auditada mostró una cartera final dominada por EURC, con ventas muy elevadas y recompras mínimas.

El motor V4 tiene una función de reinversión residual, pero no aparece conectada en el flujo mensual revisado. Las recompras dependen de reglas rígidas y no gestionan correctamente varios ciclos completos.

Corrección obligatoria:

- una bolsa EURC por venta;
- evaluación mensual por bolsa;
- varios tramos de recompra;
- ciclo que puede cruzar años;
- coste de oportunidad del EURC;
- alerta `UNDEPLOYED_REBUY_CAPITAL`;
- cada recompra crea lote `INTERNAL_REBUY` productivo.

## P0-06 — Operaciones Coinbase multipaso sin atomicidad

Una ruta CRIPTO → EUR → EURC se ejecuta paso a paso. La previsualización solo queda marcada como enviada después de completar todos los pasos.

Si el primer paso se ejecuta y el segundo falla:

- el estado local no registra correctamente el progreso parcial;
- un reintento puede repetir la primera orden;
- no hay máquina de estados por paso;
- no hay recuperación, compensación ni conciliación explícita.

Corrección obligatoria:

- persistir cada paso antes y después de enviarlo;
- usar `client_order_id` estable por paso;
- consultar Coinbase antes de reintentar;
- estados `PENDING`, `SUBMITTED`, `FILLED`, `FAILED`, `RECOVERY_REQUIRED`;
- bloquear repetición de pasos ya aceptados;
- mostrar operación parcialmente completada y acción de recuperación.

## P0-07 — Sin CI ni checks de rama

El commit principal no tiene checks asociados y no se encontró workflow de GitHub Actions.

Los documentos afirman que tests y builds pasaron, pero esas afirmaciones no son reproducibles automáticamente.

Corrección obligatoria:

- workflow en macOS y Linux cuando sea posible;
- lint, typecheck, tests y builds de todos los paquetes;
- tests de Electron main;
- prueba de migraciones desde una base anterior;
- generación de artefacto en macOS;
- protección de `main` y prohibición de merge con CI rojo.

## P0-08 — Fallos de migración no bloquean el arranque

`setupDatabase()` captura errores de migración y errores de tablas esenciales, los escribe en consola y continúa.

Esto permite abrir la interfaz con un esquema incompleto.

Corrección obligatoria:

- backup antes de migrar;
- transacción cuando sea posible;
- abortar el arranque funcional si falla una migración;
- mostrar pantalla de recuperación;
- no registrar handlers que dependan del esquema fallido;
- ejecutar `PRAGMA integrity_check` y verificación de tablas/versiones.

---

# 4. Auditoría de Cartera

## Implementación positiva

- Snapshot ligero en tiempo real.
- Actualización por IPC.
- Sincronización Coinbase periódica.
- Detección de cambio de balance para recalcular operaciones y FIFO.
- Reconstrucción de patrimonio mediante cantidades históricas y precios históricos.
- EURC valorado a 1 EUR.
- Caché persistente, `priceHistory`, caché de velas y proveedores externos.
- Estados de cobertura y advertencias.

## Defectos y pendientes

### C-01 — `missingRanges` siempre vacío

El backend devuelve el campo, pero no calcula los intervalos que faltan.

Debe informar exactamente:

- activo;
- inicio y fin del hueco;
- granularidad;
- fuente intentada;
- motivo del fallo.

### C-02 — Puntos incompletos pueden infravalorar patrimonio

Cuando existe una posición pero no hay precio en un timestamp, `complete=false`, pero la suma parcial puede continuar.

Debe definirse una política única:

- no mostrar un punto incompleto como valor total;
- o marcarlo como parcial y no usarlo en rentabilidad;
- nunca presentar una suma incompleta como patrimonio completo.

### C-03 — La UI vacía la gráfica con menos de dos puntos

El backend ya realiza varias recuperaciones, pero la UI convierte cualquier serie menor de dos puntos en `[]`.

Debe conservar:

- última serie válida;
- estado de error;
- cobertura;
- botón de reintento;
- fecha de actualización.

### C-04 — Histórico no se invalida tras nuevas transacciones

Tras sincronizar Coinbase se invalidan posiciones y snapshot, pero no la serie histórica. Esto evita coste, pero una compra o venta nueva puede no aparecer hasta el siguiente refresco.

Debe invalidarse selectivamente cuando la sincronización importe movimientos que cambien cantidades históricas.

## Estado Cartera: PARTIAL

La arquitectura es bastante mejor que en versiones anteriores, pero necesita pruebas de reinicio, sin red, huecos parciales y transacciones nuevas.

---

# 5. Auditoría de Mercado

## Implementación positiva

Orden de proveedores:

1. Coinbase.
2. CoinGecko.
3. CryptoCompare cuando está configurado.
4. Última caché válida, incluso caducada.

También existen:

- deduplicación de peticiones concurrentes;
- normalización;
- confianza por proveedor;
- validación de resolución;
- etiquetas de caché y fuente alternativa.

## Defectos y pendientes

### M-01 — Exceso potencial de consultas

La pantalla solicita overview de todos los activos cada cinco segundos, además del activo seleccionado y su histórico.

Aunque existe caché y deduplicación, debe medirse:

- llamadas por minuto;
- rate limits;
- latencia;
- duplicados entre overview, current price y realtime snapshot.

Preferencia:

- un snapshot central compartido;
- actualización por evento;
- consultas individuales solo para detalle.

### M-02 — CryptoCompare depende de configuración no visible

La interfaz puede indicar fallback automático aunque CryptoCompare no esté configurado.

Diagnóstico debe mostrar proveedores realmente operativos, no solo implementados.

### M-03 — Sin validación cruzada explícita

No se detectan públicamente discrepancias anómalas entre proveedores.

Debe añadirse tolerancia y alerta cuando dos precios contemporáneos diverjan materialmente.

## Estado Mercado: PARTIAL

---

# 6. Auditoría de Operaciones

## Implementación positiva

- compra, venta, conversión y recompra;
- simulación y modo real;
- preview real de Coinbase;
- confirmación escrita `CONFIRMAR`;
- caducidad de preview;
- permiso `can_trade` comprobado;
- bloqueo de venta total;
- protección de reserva fiscal en recompra;
- sincronización posterior a la orden.

## Defectos y pendientes

### O-01 — Multipaso no atómico

Bloqueante P0-06.

### O-02 — Simulación con costes artificialmente cero

El preview sintético usa comisión y slippage cero.

Una simulación útil debe emplear:

- tarifa configurada o histórica;
- spread estimado;
- slippage por liquidez;
- advertencia visible de que no es una cotización real.

### O-03 — Programación no es ejecución programada

Las operaciones programadas se guardan para revisión. Las condiciones se evalúan al listar y no existe ejecución persistente con la app cerrada.

La interfaz debe llamarlas:

`Recordatorios/operaciones pendientes de revisión`

hasta que exista un servicio persistente real.

### O-04 — Cobertura de tests no demostrada

No existe script de tests en `apps/desktop` ni se encontró cobertura automática del submit real, preview, caducidad, permisos y fallos multipaso.

## Estado Operaciones: PARTIAL

---

# 7. Auditoría del Plan

## Implementación positiva

- plan, ciclos y activos;
- configuración, resumen, aportaciones, beneficios/caídas, seguimiento y escenarios;
- validación de porcentajes activos;
- validación de importes fijos;
- prevención de activos duplicados superpuestos;
- objetivos y redistribución;
- revisiones estratégicas;
- aportaciones reales sincronizadas desde operaciones.

## Defectos y pendientes

### P-01 — `Sin datos` usado para importe real cero

En Aportaciones, un valor `0` se presenta como `Sin datos`.

Debe distinguirse:

- `0,00 EUR aportados`;
- `dato aún no calculado`;
- `fuente no disponible`.

### P-02 — Validaciones duplicadas entre frontend y backend

Parte de las reglas se repite en la UI. La fuente de verdad debe ser el dominio/backend y la UI debe mostrar el error estructurado.

### P-03 — Propuestas automáticas sobreprometen sus fuentes

La pantalla afirma usar medios y analistas cuando están disponibles. La implementación revisada de medios se apoya principalmente en CryptoCompare News y conteo de palabras.

Debe mostrar el manifiesto real de fuentes de cada propuesta.

### P-04 — Falta prueba integral de cambio de ciclo

Debe demostrarse:

- cierre de un ciclo;
- apertura del siguiente;
- conservación de posiciones;
- cambio de aportaciones;
- reglas aplicables por fecha;
- continuidad de bolsas de recompra.

## Estado Plan: PARTIAL

---

# 8. Auditoría de Tesorería

## Implementación positiva

- efectivo, EURC, reserva fiscal y liquidez libre separados;
- asignación a recompra por ciclo;
- movimientos auditables;
- la recompra real no puede usar la reserva fiscal.

## Defectos y pendientes

### T-01 — Movimientos manuales pueden divergir de Coinbase

La pantalla permite crear entradas y salidas manuales de EUR y EURC.

Debe existir conciliación entre:

- saldo físico Coinbase;
- libro de Tesorería;
- reserva fiscal;
- asignaciones de recompra;
- diferencias justificadas.

### T-02 — Reserva objetivo manual sin cierre fiscal

Puede ajustarse la reserva manualmente, pero falta un ciclo anual completo de:

- impuesto devengado;
- reserva creada;
- pago;
- liberación;
- saldo pendiente.

### T-03 — Bolsa real y bolsa simulada no comparten un modelo común

Perspectivas V5 debe reutilizar conceptos compatibles, sin escribir en la Tesorería real.

## Estado Tesorería: PARTIAL

---

# 9. Auditoría de Fiscalidad

## Estado: FAIL

### F-01 — Tramos fijados a 2024

La interfaz y el cálculo importan `SPAIN_SAVINGS_TAX_2024` para todos los ejercicios.

Esto incumple el requisito de cálculo por ejercicio y puede quedar desactualizado.

Corrección:

- configuración fiscal versionada por año;
- fuente y fecha de actualización;
- selección del ejercicio de la operación;
- pruebas por límites de tramo;
- no aplicar automáticamente una tabla histórica a años futuros.

### F-02 — Cálculo principal en frontend

La estimación anual se ejecuta en la capa web.

Debe trasladarse a un servicio compartido y probado, utilizado también por Tesorería y Perspectivas.

### F-03 — No existe libro fiscal anual completo

Falta integrar:

- ganancias y pérdidas;
- compensaciones;
- reserva incremental;
- impuesto pagado;
- exceso liberado;
- obligaciones pendientes.

### F-04 — Reserva recomendada igual al impuesto total

No descuenta la reserva ya apartada ni los pagos efectuados.

Debe mostrar:

- obligación estimada;
- ya reservado;
- ya pagado;
- pendiente de reservar;
- exceso.

---

# 10. Auditoría de señales y alertas

## Implementación positiva

- señales persistidas;
- deduplicación;
- estados y motivos;
- notificaciones del sistema;
- evaluación cada quince minutos con la app abierta;
- separación de recomendaciones y ejecución.

## Defectos y pendientes

### S-01 — Alertas no funcionan con la app cerrada

El intervalo vive dentro de Electron. Debe indicarse claramente.

### S-02 — Deduplicación solo en memoria para notificaciones

Tras reiniciar, las claves notificadas se pierden y pueden repetirse avisos.

Debe persistirse la fecha de última notificación por señal/umbral.

### S-03 — Fuentes estratégicas limitadas

El análisis de medios actual:

- consulta CryptoCompare News;
- revisa hasta veinte textos;
- cuenta palabras positivas, negativas y menciones;
- guarda caché en memoria.

No equivale a un consenso de 10–15 fuentes.

### S-04 — Tramos derivados con números fijos

La compatibilidad antigua asigna tiers 50/100/200 y 15/25/40 mediante umbrales fijos. Debe revisarse para que no reintroduzca lógica rígida en el nuevo motor.

## Estado Señales: PARTIAL

---

# 11. Auditoría de Perspectivas V4

## Estado: FAIL

Perspectivas V4 no cumple el contrato funcional del proyecto.

Problemas principales:

- ruta antigua en producción;
- aportaciones desviadas a EURC si falta precio;
- parámetros de regímenes definidos en código;
- anclaje final de trayectorias;
- inteligencia con muchos campos nulos o neutrales;
- fuentes externas opcionales y frecuentemente vacías;
- decisiones por reglas rígidas;
- capital EURC que puede quedar sin desplegar;
- revisión anual construida alrededor de resultados ya ejecutados;
- TWR/XIRR sin verificador externo;
- libro mensual no persistido como artefacto de auditoría;
- resultados y aplicación instalada ya demostraron incoherencias visuales y económicas.

No deben añadirse más parches a V4.

---

# 12. Auditoría de Perspectivas V5

## Estado: FAIL/BLOCKED

La rama V5 contiene una base conceptual útil, pero no es todavía un motor ejecutable.

Archivos actuales:

- contrato de reconstrucción;
- tipos de dominio;
- libro de lotes y EURC;
- manifiesto de precios/fuentes;
- evaluador de decisiones;
- generador de informe anual.

Faltan:

- coordinador mensual;
- generador y calibrador de mercado;
- 2.000 paths comunes;
- bandas de escenarios;
- inteligencia mensual;
- impuesto anual completo;
- TWR, XIRR y drawdown;
- verificador independiente;
- tests;
- exportaciones del paquete;
- IPC;
- preload;
- interfaz;
- build e instalación.

## Defectos encontrados en el esqueleto V5

### V5-01 — Informe anual calcula mal deltas acumulados

El informe resta el valor anual anterior de un acumulado, en lugar del acumulado de cierre anterior. A partir de varios ejercicios puede producir diferencias erróneas.

Debe derivar ventas, recompras y capital desplegado directamente del ledger del año o guardar acumulados explícitos.

### V5-02 — Cierre mensual acepta impuesto opcional con aserción no segura

`taxesPaidThisMonthEur` es opcional, pero la fórmula usa una aserción no nula. Sin coordinador que garantice el valor puede producir `NaN`.

Debe normalizarse a cero dentro de la función.

### V5-03 — Falta liquidación fiscal

El ledger crea reserva, pero no tiene todavía operaciones de pago, liberación o cierre anual.

### V5-04 — Evaluador de recompra incompleto

No calcula correctamente:

- precio de venta unitario;
- unidades recuperables;
- unidades adicionales;
- punto de equilibrio;
- resultado frente a no vender;
- coste de oportunidad por meses en EURC.

### V5-05 — Manifiesto de fuentes demasiado rígido

Bloquea si no existe ninguna fuente `ACTIVE_IN_ENGINE`, aunque el contrato permite una simulación calibrada con históricos y confianza reducida cuando no hay previsiones de analistas.

Debe exigir fuentes reales de mercado/calibración, no necesariamente publicaciones de analistas para todos los activos.

### V5-06 — Sin pruebas de compilación

No hay CI ni test que demuestre que los seis archivos compilan juntos.

La rama V5 no debe fusionarse en su estado actual.

---

# 13. Auditoría de fuentes externas

## Estado: FAIL respecto al objetivo de 10–15 fuentes

Existe un catálogo amplio y un proceso periódico de ingestión, pero:

- sembrar una fuente no significa utilizarla;
- la ingestión deja elementos para revisión;
- la versión activa puede estar vacía;
- el motor V4 puede continuar con `sources=[]`;
- el análisis visible de medios se concentra en CryptoCompare News;
- no hay manifiesto mensual en pantalla que pruebe qué fuentes influyeron.

Corrección obligatoria:

- estado por fuente;
- observaciones verificadas;
- deduplicación por informe original;
- versión activa reproducible;
- manifiesto por activo/mes;
- número de publicaciones independientes;
- calidad, fecha y caducidad;
- datos ausentes reducen confianza;
- no rellenar ausencias con neutral.

---

# 14. Auditoría de Configuración y Diagnóstico

## Implementación positiva

- muestra commit, rama y fecha de build;
- diagnóstico de precio, histórico y coste por activo;
- backfill manual.

## Defectos

### D-01 — Estados escritos de forma fija

Configuración presenta como hechos:

- migraciones activas;
- backup creado;
- caché local;
- sentimiento activo;
- secretos no expuestos.

Estos badges no proceden del diagnóstico real.

Deben reemplazarse por datos comprobados:

- versión de esquema;
- última migración;
- último backup y hash;
- ruta SQLite;
- integridad;
- proveedores operativos;
- última actualización;
- fuentes activas;
- canales IPC disponibles.

### D-02 — El diagnóstico no incluye Perspectivas

Debe mostrar:

- versión del motor;
- canal usado;
- paths generados;
- fuente activa;
- cobertura de precios;
- conciliación mensual;
- errores del verificador;
- V4/V5.

---

# 15. Seguridad

## Estado: PARTIAL

Correcto:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- credenciales guardadas en Llavero;
- verificación de permisos.

Pendiente:

- `sandbox: true` cuando sea compatible;
- Content Security Policy;
- bloquear navegación externa inesperada;
- `setWindowOpenHandler`;
- validar esquemas para todos los IPC, incluidos los antiguos;
- evitar `any` y tipos duplicados entre renderer/preload/main;
- comprobar permisos y producto antes de cada paso multipaso;
- no registrar datos sensibles en logs.

El HTML no contiene CSP y declara `lang="en"` aunque la aplicación está en español.

---

# 16. Arranque y estabilidad

## A-01 — Carrera entre renderer, DB e IPC

Electron crea y empieza a cargar la ventana antes de ejecutar `setupDatabase()` y `setupIpcHandlers()`.

La intención es acelerar el arranque, pero el renderer puede invocar canales antes de que estén registrados.

Corrección:

- inicializar DB y handlers antes de exponer la UI funcional;
- o cargar una pantalla de bootstrap aislada;
- emitir `backend:ready`;
- habilitar queries únicamente después del evento.

## A-02 — Intervalos sin gestión central

Alertas, ingestión y sincronizaciones crean intervalos independientes.

Debe existir un scheduler central que:

- evite duplicados al recrear ventanas;
- cancele tareas al cerrar;
- registre última ejecución;
- aplique backoff;
- muestre estado en Diagnóstico.

---

# 17. Tests y calidad

## Estado: FAIL como garantía de release

Scripts encontrados:

- web: lint, typecheck, test, build;
- portfolio: typecheck, test, build;
- database: typecheck, test, build;
- market-data: typecheck, test, build;
- coinbase-sync: typecheck, test, build;
- core: typecheck y build, sin test;
- desktop: typecheck y build, sin test.

Falta:

- comando raíz único;
- CI;
- test de migración;
- test de IPC;
- test de operaciones reales/multipaso;
- test de empaquetado;
- test de base real anonimizada;
- prueba E2E Playwright de cada página;
- prueba de la aplicación instalada.

El repositorio incluye Playwright como dependencia raíz, pero no se ha encontrado un flujo obligatorio de aceptación.

---

# 18. Plan de corrección ordenado

## Fase 0 — Congelar releases

- No generar nuevos DMG desde V4.
- No fusionar la rama V5 actual.
- Crear backup de la base real.
- Documentar rutas `Crypto Control` y `Crypto Control Nueva`.

## Fase 1 — Unificar repositorio, identidad y CI

- Un único nombre de aplicación.
- Migración de userData.
- Workflow de CI.
- Protección de `main`.
- Diagnóstico real de build y DB.
- Arranque bloqueante ante migración fallida.

## Fase 2 — Asegurar operaciones Coinbase

- Máquina de estados multipaso.
- Idempotencia y recuperación.
- Tests del main process.
- Costes realistas en simulación.

## Fase 3 — Cerrar Cartera y Mercado

- `missingRanges` real.
- puntos incompletos marcados;
- invalidación histórica tras movimientos;
- prueba offline, caché parcial, reinicio y fallos de proveedores;
- snapshot central para reducir consultas.

## Fase 4 — Fiscalidad y Tesorería

- motor fiscal versionado por año;
- reserva, pago y liberación;
- conciliación Coinbase/Tesorería;
- fuente de verdad compartida.

## Fase 5 — Plan y señales

- manifiesto real de fuentes;
- pruebas de cambio de ciclo;
- estados cero/no disponible separados;
- persistencia de notificaciones.

## Fase 6 — Completar Perspectivas V5

- corregir defectos V5-01 a V5-06;
- coordinador mensual;
- paths comunes;
- varios ciclos;
- ventas y bolsas EURC;
- recompras productivas;
- fiscalidad;
- métricas;
- verificador independiente;
- tests controlados.

## Fase 7 — Nueva interfaz Perspectivas

- conectar solo V5;
- eliminar tipos duplicados;
- mostrar capital externo, interno y desplegado;
- explicar cada venta, reserva y recompra;
- gráficas mensuales y marcadores de operaciones;
- mostrar fuentes y confianza.

## Fase 8 — Validación real y release

- fixture anonimizado de la base real;
- ejecución de todos los años y escenarios;
- conciliación al céntimo;
- DMG desde commit de `main` con CI verde;
- instalación limpia y migración;
- comparación JSON motor/verificador/app;
- capturas y manifiesto final.

---

# 19. Criterios de aceptación finales

La aplicación solo podrá declararse terminada cuando:

1. `main`, bundle, DMG y app instalada tengan el mismo commit.
2. Solo exista una ruta SQLite activa.
3. Todas las migraciones pasen o el arranque se bloquee de forma segura.
4. CI ejecute todos los tests y builds.
5. Cartera y Mercado funcionen con live, caché y proveedores alternativos.
6. Las gráficas sobrevivan al reinicio y expliquen huecos.
7. Las operaciones Coinbase sean idempotentes, incluso multipaso.
8. Plan, Tesorería y Fiscalidad concilien con operaciones reales.
9. La fiscalidad use reglas versionadas por ejercicio.
10. Perspectivas V5 sea la única ruta productiva.
11. Cada año empiece con el cierre del anterior.
12. Cada aportación compre unidades.
13. Cada venta cree una bolsa EURC.
14. Cada recompra cree un lote productivo.
15. Las recompras cuenten como capital aportado interno y capital desplegado.
16. El beneficio reste únicamente aportaciones externas.
17. Existan varios ciclos alcistas y bajistas.
18. Los escenarios procedan de paths comunes, sin reordenación posterior.
19. Las fuentes utilizadas estén identificadas y activas.
20. El verificador independiente coincida al céntimo.
21. La aplicación instalada reproduzca exactamente los resultados validados.

---

# 20. Conclusión

Crypto Control no está vacío ni debe rehacerse entero. Cartera, Mercado, Coinbase, Plan y Tesorería contienen piezas aprovechables.

Pero el producto completo todavía no cumple el contrato acordado. Los problemas más importantes ya no son visuales: son de versión, datos, atomicidad, fiscalidad, validación y arquitectura de Perspectivas.

La prioridad correcta es:

1. unificar versión y base de datos;
2. introducir CI;
3. asegurar operaciones reales;
4. cerrar contabilidad y fiscalidad;
5. terminar V5 con pruebas financieras;
6. sustituir Perspectivas V4;
7. generar un único DMG reproducible.
