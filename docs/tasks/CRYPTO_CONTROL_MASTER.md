TAREA MAESTRA PARA CODEX — TERMINAR CRYPTO CONTROL E INTEGRAR DEFINITIVAMENTE LOS MOTORES DE TIEMPO REAL Y PERSPECTIVAS

MISIÓN

Termina y deja lista para uso real la aplicación Crypto Control, integrando correctamente todo lo ya implementado y corrigiendo definitivamente los dos motores principales que ahora no funcionan como deben:

1. Motor de actualización en tiempo real de Cartera y Mercado.
2. Motor completo de Perspectivas.

No hagas más parches aislados.

No arregles únicamente el síntoma visible.

No cambies unas cifras por otras elegidas manualmente.

No reconstruyas la interfaz.

Debes auditar el repositorio actual, conservar todo lo correcto, sustituir las partes defectuosas, integrar los motores con una sola fuente de verdad, probarlos con datos reales, generar el DMG, instalarlo, comprobarlo y subir el resultado final a GitHub.

⸻

1. REPOSITORIO Y ENTORNO

Repositorio:

Emilio20d2/crypto

Rama principal:

main

Commit esperado al iniciar:

ccecc6002fc54140e3ae1639775aa2a34ef18a91

No confíes ciegamente en ese SHA.

Antes de modificar:

git fetch --all --prune
git status
git branch --show-current
git rev-parse HEAD
git log --oneline -20

Comprueba si main ha avanzado.

Ruta local habitual:

/Volumes/Disco externo/macmini/Documentos/Codex/crypto-control-nueva

No borres ni sustituyas la base de datos real del usuario.

Haz una copia de seguridad previa de cualquier SQLite utilizado durante las pruebas locales.

⸻

2. RESULTADO FINAL EXIGIDO

La aplicación debe quedar funcionando como una única plataforma coherente:

Coinbase y proveedores de mercado
↓
motor central de datos actuales
↓
snapshot único
↓
Cartera y Mercado
↓
web y Electron con los mismos datos

Y:

cartera real
+ Plan real
+ previsiones verificadas
+ modelo de escenarios
↓
motor mensual de Perspectivas
↓
cinco escenarios conciliados
↓
interfaz actual de Perspectivas

No puede haber:

* motores paralelos;
* datos diferentes entre web y escritorio;
* precios distintos según la página;
* varios temporizadores para la misma información;
* previsiones mostradas distintas de las utilizadas;
* fallbacks silenciosos;
* cifras inventadas;
* código antiguo todavía alcanzable;
* resultados corregidos manualmente después del cálculo.

⸻

3. PROTECCIÓN DE LA INTERFAZ

Conserva el diseño actual de:

* Cartera;
* Mercado;
* Operaciones;
* Plan;
* Compra Inteligente;
* Ciclos;
* Perspectivas;
* Alertas;
* Tesorería;
* navegación;
* cabeceras;
* pies;
* versión móvil;
* versión de escritorio.

No modificar:

* distribución de las páginas;
* tarjetas;
* colores;
* tipografías;
* espaciados;
* navegación;
* CSS;
* responsive;
* jerarquía visual;
* textos funcionales ya aprobados.

Única modificación visual expresamente permitida en Cartera:

Eliminar la indicación visible “Último válido”
o cualquier equivalente:
“Último dato válido”
“Last valid”
“Valor de respaldo”

Mantén internamente el último snapshot correcto para proteger la app ante fallos temporales, pero no repitas esa etiqueta dentro de las tarjetas.

No rediseñes Perspectivas.

Debe seguir utilizando:

persp2:getSimulation

Puedes cambiar su implementación interna, pero no el contrato visual de la página salvo ampliaciones de tipos estrictamente necesarias.

⸻

4. FASE CERO — AUDITORÍA COMPLETA

Antes de escribir código, realiza una auditoría de:

apps/desktop
apps/web
packages/coinbase-sync
packages/market-data
packages/portfolio
packages/database
packages/core

Busca:

rg -n \
"setInterval|setTimeout|refetchInterval|staleTime|gcTime|WebSocket|socket|SSE|ticker|snapshot|lastValid|Último válido|live|5000|10000|30000|300000|getPositions|getAllocation|getCurrentPrice|getHistoricalPrices|invalidateQueries" \
apps packages

Para Perspectivas busca:

rg -n \
"KNOWN_FORECASTS|PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED|buildExternalPriceMap|carry-forward|EUR_PER_USD|forecast_versions_active|forecast_versions_candidate|forecast_observations_staging|runRegressionTest|runPerspectivesSimulation|persp2:getSimulation" \
apps packages

Entrega primero un diagnóstico técnico interno:

MOTOR EN TIEMPO REAL
Servicio actual:
Fuente de balances:
Fuente de precios:
Polling actual:
WebSocket:
Caché:
Motor web:
Motor Electron:
Consultas duplicadas:
Causa de la pérdida de tiempo real:
GRÁFICAS
Componentes:
Servicios:
Consultas por timeframe:
Número de peticiones:
Número de puntos:
Caché:
Invalidaciones:
Causa de la lentitud:
PERSPECTIVAS
Motor alcanzable:
Motores antiguos alcanzables:
Fuente de previsiones:
Feature flag:
Versión activa:
Carry-forward:
Tipo de cambio:
Prueba de regresión:
Causa de TWR 0 %:
Causa del resultado −24 €:

No empieces a implementar hasta entender qué rutas son realmente productivas.

⸻

==================================================

PARTE A — MOTOR EN TIEMPO REAL

==================================================

5. CREAR UN ÚNICO MOTOR CENTRAL

Crea o consolida un servicio equivalente a:

RealtimePortfolioMarketEngine

Debe ser la única fuente de datos actuales para:

* valor total de activos;
* posiciones;
* cantidades;
* precios;
* EUR;
* EURC;
* Cartera;
* Mercado;
* cabecera;
* minigráficas;
* web;
* Electron.

No debe existir:

* un polling por tarjeta;
* un polling por página;
* un motor web separado;
* un motor Electron diferente;
* un cálculo independiente del total en React;
* una caché incompatible por cliente.

⸻

6. SNAPSHOT ÚNICO

Implementa una estructura equivalente:

interface RealtimePortfolioSnapshot {
  requestedAt: number;
  receivedAt: number;
  publishedAt: number;
  marketTimestamp: number;
  snapshotVersion: string;
  balanceVersion: string;
  priceVersion: string;
  balances: Array<{
    accountId: string | null;
    assetId: string;
    available: number;
    hold: number;
    total: number;
    source: "coinbase" | "cache";
  }>;
  prices: Record<string, {
    assetId: string;
    productId: string | null;
    priceEur: number | null;
    originalPrice: number | null;
    originalCurrency: "EUR" | "USD" | null;
    fxRate: number | null;
    fxSource: string | null;
    source: string;
    quotedAt: number;
    state:
      | "live"
      | "polling"
      | "fallback"
      | "stale"
      | "unavailable";
  }>;
  positions: Array<{
    assetId: string;
    quantity: number;
    priceEur: number | null;
    valueEur: number | null;
  }>;
  cryptoValueEur: number;
  eurBalance: number;
  eurcBalance: number;
  eurcValueEur: number;
  totalAssetValueEur: number | null;
  complete: boolean;
  stale: boolean;
  usingFallback: boolean;
  missingPrices: string[];
  warnings: string[];
}

Todos los componentes deben utilizar la misma snapshotVersion.

⸻

7. PRIORIDAD ABSOLUTA: VALOR TOTAL

Cada ciclo debe realizarse estrictamente así:

1. Obtener balances actuales de Coinbase.
2. Leer los precios live disponibles.
3. Resolver precios ausentes mediante REST o fallback.
4. Convertir todo a EUR.
5. Calcular el valor total.
6. Publicar inmediatamente el valor total.
7. Publicar el desglose por activo.
8. Actualizar Mercado.
9. Actualizar después PnL, ROI, costes y detalles.
10. Lanzar sincronización histórica si cambió algún saldo.

El valor total no puede esperar a:

* FIFO;
* historial completo;
* operaciones;
* fiscalidad;
* coste medio;
* gráficas;
* minigráficas;
* Perspectivas.

Fórmula:

Valor total =
Σ cantidad cripto × precio actual en EUR
+ EUR
+ valor EUR de EURC

EURC no puede sumarse dos veces.

⸻

8. ACTUALIZACIÓN CADA CINCO SEGUNDOS

Centraliza:

const REALTIME_BALANCE_REFRESH_MS = 5_000;
const REALTIME_PRICE_FALLBACK_MS = 5_000;

Requisitos:

* primera actualización inmediata al iniciar;
* actualización aproximadamente cada cinco segundos;
* actualización inmediata al recuperar foco;
* actualización inmediata al recuperar conexión;
* actualización inmediata después de una operación;
* una sola petición de balances activa.

No cambies solo un refetchInterval.

El ciclo debe consultar datos reales y producir un snapshot nuevo.

⸻

9. PRECIOS LIVE

Prioridad:

1. Coinbase WebSocket EUR.
2. Coinbase REST EUR.
3. Coinbase USD convertido a EUR.
4. CoinGecko.
5. CryptoCompare.
6. Último precio válido dentro del TTL.

Nunca utilizar:

* 0 €;
* 1 €;
* coste medio;
* precio histórico antiguo;
* precio de Perspectivas.

Los proveedores secundarios completan precios.

Los balances siempre proceden de Coinbase.

⸻

10. WEBSOCKET ROBUSTO

Gestiona:

* conexión;
* autenticación si corresponde;
* suscripción;
* heartbeat;
* último mensaje;
* detección de socket congelado;
* desconexión;
* reconexión;
* resuscripción;
* recuperación REST inmediata.

Backoff orientativo:

1 s
2 s
5 s
10 s
30 s máximo

Añade jitter.

No consideres connected un socket que no recibe mensajes durante el periodo permitido.

⸻

11. BALANCES COINBASE

Cada cinco segundos consulta solamente:

* cuentas;
* disponible;
* retenido;
* total;
* EUR;
* EURC;
* activos con saldo positivo.

No descargues cada cinco segundos:

* todos los fills;
* historial completo;
* conversiones antiguas;
* FIFO;
* fiscalidad;
* velas;
* Perspectivas.

La sincronización pesada debe quedar separada.

⸻

12. CAMBIO DE BALANCE

Genera balanceVersion con:

assetId
+ disponible
+ retenido
+ total

Si cambia:

1. Publicar inmediatamente el nuevo saldo.
2. Recalcular y publicar el total.
3. Actualizar la posición.
4. Lanzar sincronización completa en segundo plano.
5. Importar la operación.
6. Recalcular lotes y costes afectados.
7. Actualizar fiscalidad cuando proceda.

No esperes a importar la operación para mostrar el nuevo total.

⸻

13. WEB Y ESCRITORIO A LA MISMA VELOCIDAD

La versión web no puede actualizarse más lentamente que Electron.

Ambas deben recibir:

* misma snapshotVersion;
* mismo balanceVersion;
* mismo priceVersion;
* mismos precios;
* mismos balances;
* mismo valor total;
* mismo receivedAt.

Arquitectura:

motor central
↓
publicación del snapshot
├── IPC para Electron
└── WebSocket o SSE para web

No hagas que la web dependa de un polling de 10 o 30 segundos.

REST puede utilizarse para carga inicial y recuperación, pero no como único canal de tiempo real si existe una suscripción central.

Objetivo:

Diferencia normal de recepción web/Electron:
menos de 1 segundo

⸻

14. SEGUNDO PLANO

No confíes solamente en setInterval del navegador.

Los navegadores ralentizan temporizadores en pestañas ocultas.

Al recuperar visibilidad:

1. Recuperar inmediatamente el snapshot actual.
2. Comprobar la suscripción.
3. Reconectar si es necesario.
4. Actualizar sin esperar al siguiente ciclo.

Electron y web deben volver al mismo snapshot.

⸻

15. ELIMINAR “ÚLTIMO VÁLIDO”

Elimina el indicador visible de Cartera:

Último válido

Mantén internamente:

último snapshot correcto

Si hay un fallo temporal:

* conservar cifras;
* no mostrar cero;
* reintentar;
* utilizar el estado global de sincronización ya existente.

No mostrar una insignia repetida dentro de cada tarjeta.

⸻

==================================================

PARTE B — GRÁFICAS

==================================================

16. PROBLEMA

Cambiar entre:

1h
1d
1s
1m
1a
Todo

tarda demasiado porque se vuelven a descargar, procesar o renderizar datos que ya deberían estar disponibles.

⸻

17. CACHÉ COMPARTIDA

Implementa una única caché histórica:

assetId
+ timeframe
+ fiat
+ provider

Debe ser compartida por:

* Cartera;
* Mercado;
* minigráficas;
* web;
* Electron.

Cuando un periodo ya está cargado:

mostrar inmediatamente caché
↓
actualizar en segundo plano
↓
sustituir solo si existen datos nuevos

No dejar la gráfica vacía.

⸻

18. CAMBIO DE TIMEFRAME

Al cambiar de periodo:

1. Mantener la gráfica anterior visible.
2. Solicitar o recuperar la nueva serie.
3. Cancelar la petición anterior si queda obsoleta.
4. Preparar la nueva serie.
5. Sustituirla de forma atómica.
6. No mezclar puntos de periodos distintos.

Utiliza:

* AbortController;
* cancelación de React Query;
* request id;
* generation token;
* mecanismo equivalente.

Una respuesta antigua no puede sobrescribir la selección actual.

⸻

19. ACTUALIZACIÓN INCREMENTAL

No descargues toda la serie si solo faltan puntos recientes.

Implementa:

histórico en caché
+ último timestamp
↓
descargar tramo nuevo
↓
fusionar
↓
deduplicar
↓
ordenar
↓
guardar

El motor live actualiza únicamente:

* último punto;
* vela abierta;
* tramo pendiente.

⸻

20. RESOLUCIÓN Y DOWNSAMPLING

No envíes al navegador cientos de miles de puntos.

Resolución orientativa:

1h: minuto o equivalente
1d: intradía
1s: horario
1m: varias horas o diario
1a: diario
Todo: semanal o adaptativo

Aplica LTTB o algoritmo equivalente cuando sea necesario.

Conserva:

* primer punto;
* último punto;
* máximos;
* mínimos;
* forma de la curva;
* discontinuidades relevantes.

No alteres los datos financieros almacenados.

⸻

21. PREFETCH

Después de cargar un periodo, precarga discretamente los adyacentes:

1d → 1h y 1s
1m → 1s y 1a
1a → 1m y Todo

Respeta:

* límites de API;
* memoria;
* caché existente;
* solicitudes activas.

⸻

22. OBJETIVOS DE RENDIMIENTO

Medir, no inventar resultados.

Objetivos:

Periodo ya cargado:
menos de 300 ms hasta visible.
Primera carga de periodos normales:
menos de 1 segundo con red normal.
Todo:
mostrar caché inmediatamente y completar en segundo plano.

No invalides toda Cartera por cambiar una gráfica.

No recargues:

* balances;
* FIFO;
* Plan;
* Perspectivas;
* todas las minigráficas.

⸻

==================================================

PARTE C — MOTOR DE PERSPECTIVAS

==================================================

23. CONSERVAR LO CORRECTO

Conserva:

* interfaz actual;
* persp2:getSimulation;
* selector de años;
* cinco escenarios;
* horizonte derivado del último ciclo del Plan;
* posiciones reales;
* precios actuales;
* lotes;
* FIFO;
* EUR;
* EURC;
* reserva fiscal;
* ciclos;
* aportaciones;
* distribución por activo;
* objetivos;
* sustituciones;
* revisiones;
* ventas configuradas;
* recompras configuradas;
* simulación mensual;
* snapshots anuales;
* eventos;
* TWR;
* XIRR;
* conciliación EURC.

Principio:

Valor de un activo =
cantidad acumulada × precio del escenario

⸻

24. ELIMINAR DEL MOTOR PRODUCTIVO

Elimina:

* KNOWN_FORECASTS como fuente productiva;
* fallback silencioso a KNOWN_FORECASTS;
* USD/EUR fijo en 0,92;
* carry-forward del último precio;
* precio de 2030 repetido hasta 2044;
* una cifra convertida en cinco escenarios;
* cuantiles no ponderados;
* cobertura global porque exista un solo activo cubierto;
* pruebas que comparan el motor consigo mismo;
* motores antiguos todavía alcanzables;
* ajuste manual de resultados;
* fallback de 1 €;
* fallback a cero.

KNOWN_FORECASTS puede conservarse únicamente como fixture histórico de tests.

⸻

25. ARQUITECTURA POR CAPAS

Implementa:

PerspectiveInputBuilder
ForecastDataService
ForecastConsensusEngine
ScenarioPathEngine
MonthlySimulationEngine
AccountingValidator
PerspectivesResultMapper

PerspectiveInputBuilder

Lee estado real:

* cartera;
* lotes;
* Plan;
* tesorería;
* reglas;
* precios actuales;
* horizonte.

ForecastDataService

Devuelve una versión activa e inmutable.

ForecastConsensusEngine

Calcula:

* cinco escenarios;
* pesos;
* cobertura;
* confianza;
* dispersión;
* capitalización implícita.

ScenarioPathEngine

Construye precios mensuales.

MonthlySimulationEngine

Simula:

* aportaciones;
* compras;
* ventas;
* recompras;
* impuestos;
* balances;
* patrimonio.

AccountingValidator

Bloquea resultados que no concilien.

PerspectivesResultMapper

Mantiene el contrato actual de Perspectivas.tsx.

⸻

26. STAGING, CANDIDATE Y ACTIVE

Completa la arquitectura ya iniciada:

fuentes externas
↓
forecast_observations_staging
↓
validación
↓
forecast_versions_candidate
↓
regresión real
↓
aprobación
↓
forecast_versions_active
↓
motor

El motor solo puede consumir:

forecast_versions_active

No puede consumir:

* staging;
* observaciones recién importadas;
* RSS;
* HTML;
* candidatos pendientes;
* seeds.

La activación debe ser atómica y reversible.

⸻

27. FEATURE FLAG

No cambies simplemente:

PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED = false

a true.

Primero:

1. Refactoriza el motor para recibir un dataset inyectable.
2. Crea una versión candidata.
3. Valídala.
4. Ejecuta regresión real.
5. Actívala.
6. Comprueba que la simulación usa el candidateId.
7. Prueba rollback.
8. Activa el flujo productivo.

Desactivar el flag no debe volver a datos hardcodeados.

Debe utilizar la última versión activa válida o devolver un estado controlado.

⸻

28. FUENTES QUE DEBEN CONSULTARSE

Fuentes institucionales y de research:

ARK Invest
Bitwise
VanEck
Fidelity Digital Assets
Grayscale Research
Galaxy Research
CoinShares
Coinbase Institutional
Messari
Glassnode
The Block Research
Binance Research
Kraken Research
Coin Metrics
Kaiko
Delphi Digital
Blockworks Research
K33 Research
CryptoQuant

Medios para descubrir publicaciones:

CoinDesk
The Block
Decrypt
Cointelegraph
Blockworks
DL News
Bitcoin Magazine
CryptoSlate

Los medios especializados sirven para descubrir el informe.

La previsión debe atribuirse a la fuente original.

Una noticia general no es una previsión de precio.

⸻

29. PERIODICIDAD

Configura:

Feeds y noticias:
cada 3 horas
APIs de research:
cada 6 horas
Research institucional:
diariamente
Verificación de enlaces:
cada 7 días
Revisión integral del consenso:
cada 14 días

Actualizar una fecha no cuenta como revisión.

Debe existir una consulta real y un registro de resultado.

⸻

30. NO ABANDONAR POR FALTA DE DATOS

No cierres la tarea al encontrar que una fuente no responde.

Debes:

1. Intentar fuentes alternativas.
2. Utilizar RSS cuando exista.
3. Consultar páginas institucionales.
4. Localizar el informe original desde medios.
5. Registrar fuentes de pago sin eludir sus condiciones.
6. Mantener operativa una carga manual verificada.
7. Guardar errores y siguiente intento.
8. Continuar con las demás fuentes.

No inventes información.

Cuando no exista una previsión externa suficiente:

* no fabriques una fuente;
* no fabriques un objetivo;
* utiliza, cuando sea defendible, el modelo explícito de extensión;
* marca claramente la cobertura interna;
* conserva la infraestructura para incorporar futuros informes.

La falta de una fuente concreta no puede dejar la arquitectura sin terminar.

⸻

31. OBSERVACIONES VÁLIDAS

Cada observación necesita:

* activo;
* publisher;
* autor o entidad;
* título;
* URL original;
* fecha de publicación;
* fecha objetivo;
* precio o rango;
* moneda;
* tipo de previsión;
* metodología o contexto;
* fecha de verificación.

Valida:

* URL;
* contenido;
* activo;
* ticker;
* año;
* moneda;
* escala;
* duplicidad;
* vigencia;
* revisión posterior.

Evita errores como:

* capitalización interpretada como precio;
* millones interpretados como unidades;
* USD interpretado como EUR;
* año de publicación usado como año objetivo;
* precio de BTC aplicado a SUI;
* republicaciones contadas como fuentes independientes.

⸻

32. CONSENSO DE CINCO ESCENARIOS

Escenarios:

Conservador
Moderado
Base
Favorable
Optimista

Con tres o más fuentes independientes:

Conservador: percentil ponderado 10–15
Moderado: percentil ponderado 30
Base: mediana ponderada
Favorable: percentil ponderado 70
Optimista: percentil ponderado 85–90

No utilizar:

* mínimo absoluto;
* máximo absoluto;
* multiplicadores arbitrarios;
* porcentajes aplicados a Base;
* una única fuente repetida cinco veces.

Una fuente con Low/Base/High puede utilizar su rango, marcado como fuente única y confianza baja.

Una fuente puntual no genera cinco escenarios.

⸻

33. PESOS REALES

Usa realmente:

calidad
actualidad
coincidencia con el horizonte
metodología
independencia

finalWeight debe intervenir matemáticamente en el consenso.

Deduplica:

* mismo publisher;
* mismo informe;
* mismo objetivo;
* republicaciones;
* versiones idénticas.

⸻

34. TIPO DE CAMBIO

Elimina todos los 0.92 hardcodeados.

Crea un servicio FX con:

* proveedor;
* tasa;
* timestamp;
* fecha de referencia;
* moneda original;
* versión.

Una versión de previsiones debe conservar la tasa con la que fue normalizada.

No cambies retrospectivamente resultados activos sin crear una nueva versión.

⸻

35. COBERTURA

Estados internos:

direct
interpolated
modeled
insufficient

Direct

Existe un objetivo o consenso verificable.

Interpolated

Existen anclas válidas antes y después.

Modeled

El año está después de la última previsión externa y utiliza el modelo terminal.

Insufficient

No existe base suficiente.

Calcula cobertura por activo y año.

No declares cubierto todo el año porque BTC tenga un dato y ETH o SUI no.

⸻

36. ELIMINAR CARRY-FORWARD

Prohibido mantener:

último precio conocido sin variación hasta 2044

Ese comportamiento provocó:

* TWR aproximadamente 0 %;
* resultado de mercado de −24 €;
* escenarios casi iguales;
* Optimista acumulando solo aportaciones.

⸻

37. MODELO POSTERIOR A LA ÚLTIMA PREVISIÓN

El Plan puede llegar a 2044 aunque las fuentes terminen antes.

Construye un modelo terminal explícito que considere:

* último consenso externo;
* capitalización;
* suministro proyectado;
* tokenomics;
* madurez;
* volatilidad;
* drawdowns;
* correlación;
* liquidez;
* crecimiento decreciente por capitalización;
* incertidumbre creciente por horizonte.

No utilizar:

* tasa fija anual;
* CAGR arbitrario;
* el mismo porcentaje para todos los activos;
* el mismo modelo para BTC, ETH y SUI.

Debe ser:

* específico por activo;
* acotado;
* versionado;
* reproducible;
* marcado como modeled;
* con confianza decreciente.

⸻

38. TRAYECTORIAS MENSUALES

No generes líneas siempre ascendentes.

Las trayectorias deben incluir:

* periodos alcistas;
* bajistas;
* laterales;
* correcciones;
* volatilidad;
* correlación entre activos;
* riesgo mayor en small caps.

Puedes utilizar un modelo correlacionado con semilla determinista.

Los tests deben ser reproducibles.

Cada escenario debe influir en:

* precio de compra;
* valor mensual;
* ventas;
* recompras;
* impuestos;
* TWR;
* drawdown;
* patrimonio.

⸻

39. APORTACIONES Y COMISIONES

Registra primero toda aportación:

1. Registrar aportación.
2. Incrementar capital aportado.
3. Distribuir.
4. Comprar.
5. Mantener sobrante en EUR o EURC.

Aunque una compra no se ejecute, la aportación no desaparece.

La comisión actual del 0,4 % explica:

6.000 € × 0,4 % = 24 €
5.100 € × 0,4 % = 20,40 €

Mantén la comisión si es correcta, pero clasifícala como comisión.

No como resultado de mercado.

⸻

40. VENTAS Y RECOMPRAS

Usa únicamente reglas configuradas.

Ventas:

* nunca 100 % automáticamente;
* sin escalones genéricos;
* sin rearme en cada máximo;
* FIFO;
* comisión;
* plusvalía;
* reserva fiscal.

Recompras solo cuando:

1. Hubo venta previa.
2. Se generó EURC.
3. Se separó reserva fiscal.
4. Existe EURC libre.
5. Hay regla activa.
6. Se cumple la condición.

No usar aportaciones ordinarias como EURC procedente de ventas.

⸻

41. CONTABILIDAD

Mensualmente:

patrimonio final =
patrimonio inicial
+ aportaciones externas
+ resultado de mercado
− comisiones
− retiradas externas

Ventas y recompras son movimientos internos.

Por activo:

balance final =
balance inicial
+ compras
+ recompras
− ventas
− sustituciones salientes
+ sustituciones entrantes

EURC:

EURC final =
EURC inicial
+ ventas netas
+ aportaciones expresamente dirigidas a EURC
− recompras
− pagos
− reinversión configurada

Tolerancia máxima:

0,01 €

No devuelvas una simulación que no concilie.

⸻

42. TWR Y XIRR

Revisa:

* TWR mensual;
* TWR anual;
* TWR acumulado;
* XIRR;
* momento de aportaciones;
* ventas;
* retiradas;
* comisiones.

El TWR debe eliminar el efecto de las aportaciones.

Define una convención única y documentada para la fecha mensual de cada aportación.

⸻

43. REGRESIÓN REAL

Refactoriza el motor para aceptar:

runPerspectivesSimulation(input, forecastDataset)

o inyección equivalente.

Ejecuta realmente:

versión activa
vs
versión candidata

No ejecutes dos veces el mismo dataset.

Compara:

* precios;
* cantidades;
* aportaciones;
* comisiones;
* patrimonio;
* TWR;
* XIRR;
* cobertura;
* capitalización implícita.

⸻

44. ACTIVACIÓN Y ROLLBACK

Prueba:

A activa
B falla
A sigue activa

Y:

C pasa
C se activa
motor usa C
rollback
motor vuelve exactamente a A

Guarda en cada simulación:

* candidateId;
* versión;
* fecha de activación;
* metodología.

⸻

==================================================

PARTE D — PRUEBAS

==================================================

45. TESTS DEL MOTOR LIVE

Añade pruebas para:

* primera actualización inmediata;
* ciclo de cinco segundos;
* WebSocket;
* REST fallback;
* reconexión;
* resuscripción;
* socket stale;
* una petición activa;
* tick omitido;
* timeout;
* último snapshot interno;
* eliminación visual de “Último válido”;
* EUR;
* EURC;
* no duplicar EURC;
* activo nuevo;
* activo sin precio;
* publicación prioritaria del total;
* web y Electron;
* recuperación de foco;
* React Strict Mode.

⸻

46. TESTS DE GRÁFICAS

Añade pruebas para:

* caché por timeframe;
* periodo ya cargado;
* cancelación de petición;
* respuesta obsoleta;
* prefetch;
* actualización incremental;
* deduplicación;
* orden cronológico;
* downsampling;
* conservación de máximo y mínimo;
* mismo dataset en Cartera y Mercado;
* mismo dataset en web y Electron;
* no invalidar toda la app.

⸻

47. TESTS DE PERSPECTIVAS

Añade pruebas para:

* posición inicial;
* activo solo en Plan;
* DCA mensual;
* distribución 60/30/10;
* cambio de ciclo;
* último año parcial;
* aportación sin precio;
* comisión;
* FIFO;
* venta configurada;
* venta no repetida;
* recompra válida;
* recompra sin EURC;
* reserva fiscal;
* sustitución;
* tres fuentes;
* fuente puntual;
* Low/Base/High;
* deduplicación;
* pesos;
* FX;
* interpolación;
* extensión modelizada;
* ausencia de carry-forward;
* cinco escenarios;
* mercado alcista;
* mercado bajista;
* TWR;
* XIRR;
* conciliación;
* candidate;
* active;
* rollback.

⸻

48. TEST 2036–2044

Debe fallar si todos los años cumplen:

cierre =
apertura
+ aportación
− comisión

Comprobar:

* precios variables;
* resultado de mercado real;
* comisión separada;
* TWR distinto de cero;
* cinco escenarios distintos;
* Optimista aplicando su trayectoria;
* cobertura por activo;
* conciliación.

⸻

49. PRUEBA REAL WEB/ESCRITORIO

Abre simultáneamente:

* Electron;
* versión web.

Durante 60 segundos registra cada cinco segundos:

hora
snapshotVersion Electron
snapshotVersion web
valor total Electron
valor total web
BTC Electron
BTC web
ETH Electron
ETH web
SUI Electron
SUI web
diferencia de recepción

Puntos:

0
5
10
15
20
25
30
35
40
45
50
55
60 segundos

Resultado esperado:

* misma versión;
* mismos balances;
* mismos precios;
* mismo total;
* diferencia de recepción inferior a un segundo con conexión normal.

⸻

50. PRUEBA REAL DE GRÁFICAS

Mide:

1h
1d
1s
1m
1a
Todo

Registra:

* primera carga;
* carga desde caché;
* peticiones;
* puntos descargados;
* puntos renderizados;
* red;
* transformación;
* tiempo hasta visible.

No declares mejoras sin números.

⸻

51. PRUEBA REAL DE PREVISIONES

Demuestra:

fuente
→ publicación detectada
→ observación verificada
→ staging
→ candidate
→ validación
→ active
→ consenso
→ trayectoria
→ simulación
→ Perspectivas

Realiza el proceso para:

* BTC;
* ETH;
* SUI.

No utilices fixtures en esta prueba concreta.

Si no encuentras un objetivo válido para algún activo, demuestra:

* fuentes consultadas;
* errores;
* alternativas;
* carga manual funcional;
* modelo utilizado;
* cobertura final.

⸻

==================================================

PARTE E — TERMINAR Y PUBLICAR LA APP

==================================================

52. AUDITORÍA FINAL DE TODAS LAS PÁGINAS

Antes del build final comprueba que abren y funcionan:

Cartera
Mercado
Operaciones
Plan
Compra Inteligente
Ciclos
Perspectivas
Alertas y objetivos
Tesorería
Configuración

Comprueba:

* navegación;
* móvil;
* escritorio;
* errores de consola;
* errores IPC;
* queries infinitas;
* pantallas vacías;
* scroll horizontal;
* textos cortados.

No añadas funciones ajenas al encargo.

Corrige únicamente regresiones causadas o descubiertas durante la integración.

⸻

53. COMANDOS DE VALIDACIÓN

Inspecciona todos los package.json.

Utiliza los comandos reales disponibles.

Ejecuta como mínimo:

* typecheck;
* lint;
* tests unitarios;
* tests de integración;
* tests de regresión;
* build web;
* build Electron;
* build de producción.

No inventes comandos.

No ignores pruebas fallidas.

No continúes hacia el DMG con errores.

⸻

54. DMG

Después de superar todo:

1. Build limpio.
2. Generar .app.
3. Generar .dmg.
4. Calcular SHA-256.
5. Montar DMG.
6. Instalar en /Applications.
7. Confirmar el commit incluido.
8. Abrir la aplicación instalada.
9. Probar Cartera durante 60 segundos.
10. Probar Mercado.
11. Probar las seis gráficas.
12. Probar Perspectivas.
13. Revisar 2036–2044.
14. Cambiar los cinco escenarios.
15. Abrir web y Electron a la vez.
16. Confirmar paridad.
17. Navegar entre páginas.
18. Confirmar que no se duplican sockets.
19. Cerrar.
20. Volver a abrir.
21. Repetir comprobaciones esenciales.
22. Confirmar persistencia.

No consideres válido el DMG solo porque se haya creado.

⸻

55. GITHUB

Después de verificar la aplicación instalada:

git status
git diff

No subir:

* SQLite;
* datos personales;
* credenciales;
* .env;
* claves;
* DMG;
* .app;
* node_modules;
* cachés;
* logs con información sensible;
* artefactos de compilación no versionados.

Trabaja preferentemente en:

codex/final-engine-rebuild

Una vez verificado:

1. Crear commit descriptivo.
2. Hacer push de la rama.
3. Integrar o hacer fast-forward a main si el flujo lo permite.
4. Hacer push de main.
5. Confirmar el SHA remoto.
6. Informar la URL final.

Si una protección de rama impide el push directo, crea el PR y deja todo preparado para merge, explicando el bloqueo exacto.

⸻

56. CRITERIOS DE NO ACEPTACIÓN

La tarea no está terminada si:

Tiempo real

* el total no se actualiza cada cinco segundos;
* solo cambia el contador;
* web es más lenta que Electron;
* Cartera y Mercado usan precios distintos;
* hay temporizadores por componente;
* existen peticiones superpuestas;
* un fallo pone valores a cero;
* EURC se duplica;
* sigue apareciendo “Último válido”.

Gráficas

* quedan vacías al cambiar periodo;
* vuelven a descargar toda la serie;
* un periodo ya cargado tarda segundos;
* respuestas antiguas sobrescriben;
* cada minigráfica consulta por separado;
* Cartera y Mercado tienen históricos diferentes.

Perspectivas

* KNOWN_FORECASTS sigue siendo productivo;
* el feature flag se activa sin pruebas;
* continúa el carry-forward;
* existe USD/EUR fijo;
* una sola cifra genera cinco escenarios;
* la regresión compara el mismo dataset;
* Optimista sigue con TWR 0 %;
* −24 € sigue siendo resultado de mercado;
* falta activación atómica;
* falta rollback;
* falta conciliación;
* la interfaz se rediseña.

Publicación

* no se instala el DMG;
* no se prueba la app instalada;
* no se prueba web y Electron juntos;
* no se confirma el commit remoto;
* se afirman pruebas que no se ejecutaron.

⸻

57. INFORME FINAL OBLIGATORIO

Entrega exactamente este informe:

ESTADO INICIAL
Commit inicial:
Rama inicial:
Cambios locales iniciales:
Última versión funcional localizada:
Causa de la regresión del tiempo real:
Causa de la lentitud de gráficas:
Causa de la diferencia web/Electron:
Causa de la rotura de Perspectivas:
MOTOR EN TIEMPO REAL
Servicio:
Ubicación:
WebSocket:
Polling de balances:
Primera actualización:
Frecuencia:
Peticiones simultáneas máximas:
Timeouts:
Fallbacks:
Reconexión:
Valor total actualizado primero:
Sí / No
“Último válido” visible:
ELIMINADO
Protección interna:
CONSERVADA
PARIDAD WEB/ELECTRON
Canal Electron:
Canal web:
Frecuencia Electron:
Frecuencia web:
SnapshotVersion Electron:
SnapshotVersion web:
Diferencia de recepción:
Diferencia de valor:
Prueba de 60 segundos:
SUPERADA / FALLIDA
GRÁFICAS
Servicio compartido:
Caché:
Actualización incremental:
Cancelación:
Prefetch:
Downsampling:
1h primera carga:
1h caché:
1d primera carga:
1d caché:
1s primera carga:
1s caché:
1m primera carga:
1m caché:
1a primera carga:
1a caché:
Todo primera carga:
Todo caché:
PERSPECTIVAS
Motor anterior:
Motor final:
KNOWN_FORECASTS productivo:
ELIMINADO
Carry-forward:
ELIMINADO
USD/EUR fijo:
ELIMINADO
Versión activa:
CandidateId:
Metodología:
Fuentes:
BTC:
ETH:
SUI:
Años directos:
Años interpolados:
Años modelizados:
Años insuficientes:
Activación:
Rollback:
Regresión real:
RESULTADOS 2044
Conservador:
Moderado:
Base:
Favorable:
Optimista:
CONTROL 2036–2044
TWR fijo 0 %:
ELIMINADO
Resultado fijo −24 €:
ELIMINADO
Comisiones separadas:
Sí / No
Aportaciones conciliadas:
Sí / No
Cobertura por activo:
Sí / No
ELEMENTOS CONSERVADOS
Interfaz Cartera:
Interfaz Mercado:
Interfaz Perspectivas:
Plan:
Ciclos:
FIFO:
Fiscalidad:
Ventas:
Recompras:
Tesorería:
PRUEBAS
Unitarias:
Integración:
Tiempo real:
Gráficas:
Web/Electron:
Perspectivas:
Regresión:
Activación:
Rollback:
Conciliación:
Typecheck:
Lint:
Build web:
Build Electron:
DMG
Ruta:
SHA-256:
Commit incluido:
Instalado:
Primera apertura:
Cartera comprobada:
Mercado comprobado:
Gráficas comprobadas:
Perspectivas comprobada:
Web/Electron comprobados:
Segunda apertura:
Persistencia:
GITHUB
Rama de trabajo:
Archivos modificados:
Commit final:
Push:
Main actualizado:
SHA remoto:
URL:

REGLA DEFINITIVA

No termines por haber escrito código.

La tarea solo se considera finalizada después de completar esta cadena:

auditoría
→ corrección arquitectónica
→ integración
→ tests
→ validación con datos reales
→ build
→ DMG
→ instalación
→ comprobación
→ reapertura
→ commit
→ push
→ confirmación remota

No sacrifiques las partes que ya funcionan.

Conserva la interfaz y la lógica correcta.

Sustituye únicamente los motores, fuentes, cachés y rutas defectuosas hasta que Crypto Control funcione como una aplicación terminada, coherente, rápida y verificable.
