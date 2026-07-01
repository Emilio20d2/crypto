# Perspectivas V5 — contrato bloqueante de reconstrucción

## Estado

La implementación actual de Perspectivas queda rechazada. No se aceptan más parches sobre `packages/portfolio/src/perspectives`, `persp2:getSimulation` ni la página actual.

La nueva implementación debe construirse en una ruta separada y solo sustituirá a producción cuando supere todas las comprobaciones contables, de mercado y de estrategia descritas aquí.

## Objetivo de la página

Perspectivas debe responder a esta pregunta:

> ¿Cómo puede evolucionar la cartera real y el Plan hasta el año seleccionado bajo distintos escenarios de mercado, incluyendo aportaciones, compras, beneficios, pérdidas, ventas parciales, EURC, fiscalidad, recompras y varios ciclos alcistas y bajistas?

No es una suma de aportaciones futuras. Debe simular unidades, lotes, precios, beneficios, pérdidas, ventas, recompras y composición patrimonial mes a mes.

## Reglas contables no negociables

### Continuidad

El cierre de cada mes es exactamente la apertura del siguiente. El cierre de diciembre es exactamente la apertura de enero del año siguiente.

Tolerancia máxima: `0,01 EUR`.

### Definiciones de capital

- `externalCapitalEur`: dinero nuevo aportado por el usuario.
- `internalRebuyCapitalEur`: dinero procedente de ventas que vuelve a invertirse.
- `internalReallocationCapitalEur`: capital desplazado entre activos.
- `totalCapitalDeployedEur = externalPurchasesEur + internalRebuyCapitalEur + internalReallocationCapitalEur`.

Las recompras cuentan como capital aportado interno y capital desplegado. No cuentan como nuevas aportaciones externas.

El beneficio neto se calcula así:

```text
netProfitEur = finalNetWealthEur + externalWithdrawalsEur - externalCapitalEur
```

No se restan las recompras en esta fórmula porque reutilizan patrimonio ya existente.

### Patrimonio

```text
grossWealthEur = cryptoMarketValueEur + operatingEurcEur + fiscalReserveEur + cashEur
netWealthEur = grossWealthEur - outstandingTaxLiabilityEur - otherLiabilitiesEur
```

Una venta o recompra no crea patrimonio por sí sola; cambia su composición y solo reduce patrimonio por costes e impuestos pagados.

### Lotes

Toda compra crea un lote. Orígenes permitidos:

- `INITIAL_POSITION`
- `EXTERNAL_CONTRIBUTION`
- `INTERNAL_REBUY`
- `INTERNAL_REALLOCATION`

Cada lote conserva fecha, activo, precio, unidades, costes, base de coste, unidades abiertas, operación de origen, bolsa EURC de origen y ciclo de recogida de beneficios.

Las posiciones se derivan exclusivamente de los lotes abiertos.

## Recompras

Flujo obligatorio:

```text
venta parcial -> bolsa EURC -> recompra -> lote INTERNAL_REBUY -> unidades -> valoración posterior -> beneficio o pérdida
```

Una recompra:

- no aumenta `externalCapitalEur`;
- aumenta `internalRebuyCapitalEur`;
- aumenta `totalCapitalDeployedEur`;
- crea unidades y base de coste;
- participa en el patrimonio desde su fecha;
- genera beneficio o pérdida posterior;
- puede venderse posteriormente usando su propia base de coste.

Prueba bloqueante:

- EURC utilizado: 5.000 EUR;
- precio de recompra: 10 EUR;
- unidades: 500;
- precio posterior: 14 EUR;
- valor del lote: 7.000 EUR;
- resultado atribuible: +2.000 EUR;
- aportaciones externas: sin cambios.

Caso negativo: precio posterior 8 EUR, valor 4.000 EUR, resultado -1.000 EUR.

La prueba debe ejecutar la misma ruta productiva. Está prohibido construir manualmente el resultado esperado dentro de un objeto de salida.

## Bolsas EURC y varios ciclos

Cada venta parcial abre un `ProfitHarvestCycle` y una `EurcBucket` independiente.

Cada bolsa debe guardar:

- venta y activo de origen;
- importe bruto;
- base de coste vendida;
- plusvalía;
- costes;
- reserva fiscal;
- EURC operativo;
- saldo disponible y consumido;
- recompras vinculadas;
- meses sin invertir;
- oportunidades evaluadas y descartadas.

Los ciclos pueden cruzar años y repetirse varias veces para el mismo activo. No se reinician el 1 de enero.

No es aceptable vender una parte sustancial de la cartera y mantener casi todo el EURC hasta 2044 sin una evaluación mensual completa. Si una bolsa permanece más de doce meses sin desplegar pese a existir señales válidas, devolver `UNDEPLOYED_REBUY_CAPITAL`.

## Precios y cobertura

Antes de simular debe existir una matriz completa:

```text
assetId x month x pathId
```

para todos los activos mantenidos, comprados, vendidos o recomprables.

Estados de cobertura:

- `HISTORICAL`
- `MODEL_CALIBRATED`
- `FORECAST_CONDITIONED`
- `INVALID`

No se permite convertir silenciosamente una aportación en EURC cuando falta un precio. Debe detenerse con `INVALID_PRICE_PATH`, identificando activo y primer mes afectado.

Coinbase es la fuente principal para precios actuales y velas. Deben existir al menos dos proveedores alternativos para huecos, contraste y activos no disponibles.

## Fuentes e inteligencia

El catálogo de fuentes no equivale a fuentes activas.

Estados:

- `REGISTERED_ONLY`
- `FETCHING`
- `PENDING_REVIEW`
- `VERIFIED`
- `ACTIVE_IN_ENGINE`
- `FAILED`
- `EXPIRED`
- `INSUFFICIENT`

Solo cuentan como utilizadas las fuentes `ACTIVE_IN_ENGINE`.

Cuando exista cobertura, cada snapshot mensual debe combinar 10-15 fuentes independientes entre investigación institucional, mercado, on-chain, derivados, macro y medios. Casos bajo/base/alto del mismo informe cuentan como una sola fuente independiente.

Fuentes previstas, cuando estén disponibles y verificadas: Coinbase, CoinGecko, CryptoCompare, Coin Metrics, Kaiko, Glassnode, CryptoQuant, ARK Invest, Bitwise, VanEck, Fidelity Digital Assets, Grayscale, Galaxy, CoinShares, Standard Chartered, JPMorgan, Coinbase Institutional, Messari, Binance Research, Delphi Digital, The Block, CoinDesk, Decrypt, Cointelegraph, BCE, FRED y Eurostat.

Las previsiones externas son priors suaves. No son destinos obligatorios ni líneas rectas hasta un objetivo.

## Modelo de mercado

No se aceptan:

- cinco caminos independientes etiquetados de antemano;
- ordenar resultados y renombrarlos después;
- multiplicadores finales para forzar el orden;
- crecimiento fijo por categoría como motor principal;
- anclas finales que compriman toda la trayectoria;
- transiciones manuales sin calibración demostrable.

Deben generarse al menos 2.000 trayectorias comunes con `pathId`, precios mensuales, correlaciones, drawdowns, recuperaciones, factores globales y riesgo específico por activo.

Los escenarios son bandas de percentiles de la distribución común:

- Conservador
- Moderado
- Base
- Favorable
- Optimista

La trayectoria representativa se selecciona por medoid o distancia multivariable considerando patrimonio, volatilidad, drawdown, años positivos y negativos, número de ciclos y tiempo de recuperación.

En un horizonte hasta 2044 deben poder aparecer varios ciclos de acumulación, expansión, euforia, distribución, corrección, mercado bajista, capitulación, recuperación y lateralidad.

## Decisiones

La secuencia mensual es:

```text
contexto -> alternativas -> valoración económica -> decisión -> operación -> conciliación -> informe
```

La revisión anual nunca debe fabricar decisiones retrospectivamente leyendo operaciones ya ejecutadas.

### Ventas

Comparar mantener con ventas del 5 %, 10 %, 15 %, 20 % y 25 %, considerando lotes, concentración, régimen, tendencia, momentum, volatilidad, costes, fiscalidad, probabilidad de corrección y resultado esperado hasta horizonte.

### Recompras

Por cada bolsa EURC comparar mantener liquidez con recomprar 20 %, 33 %, 50 % u otro tramo óptimo, esperar estabilización, cancelar tesis o redistribuir si está permitido.

No consumir todo el EURC automáticamente para un solo activo.

## Fiscalidad

Libro fiscal anual con ganancias, pérdidas, compensaciones, base fiscal, reserva, pago, liberación y saldo pendiente.

La reserva incremental de una venta es:

```text
taxAfterSale - taxBeforeSale
```

No calcular cada venta como si fuera la primera del ejercicio. No arrastrar hasta 2044 impuestos ya pagados.

## Métricas

Calcular y verificar independientemente:

- patrimonio bruto y neto;
- valor cripto;
- EURC operativo y reserva fiscal;
- capital externo;
- capital interno recomprado;
- capital total desplegado;
- base de coste;
- beneficio realizado y no realizado;
- beneficio neto;
- resultado de recompras;
- TWR acumulado y anualizado;
- XIRR;
- drawdown y tiempo de recuperación.

## Verificador independiente

Debe recibir únicamente movimientos, lotes, precios, costes, flujos externos y pagos fiscales. No puede recibir resultados ya calculados ni importar fórmulas productivas.

Debe recalcular todo desde cero y coincidir al céntimo.

## Nueva arquitectura

Ruta obligatoria:

```text
packages/portfolio/src/perspectives-v5/
  domain/
  data/
  ledger/
  market/
  strategy/
  metrics/
  reports/
  validation/
  index.ts
```

Nueva API:

```text
perspectivesV5:getSimulation
```

No reutilizar `persp2:getSimulation`.

La nueva interfaz se construye solo después de que el motor y el verificador superen las pruebas.

## Pruebas bloqueantes

- continuidad mensual y anual;
- precio constante: beneficio cero;
- precio creciente: beneficio positivo;
- precio decreciente: beneficio negativo;
- ciclo expansión -> venta -> corrección -> recompra -> recuperación;
- dos ciclos completos con bolsas y lotes independientes;
- recompra controlada de 5.000 EUR;
- fiscalidad anual;
- 2.000 trayectorias comunes;
- cobertura completa de precios;
- modo pasivo sin operaciones tácticas;
- modo reglas con solo reglas del usuario;
- modo inteligente con decisiones del motor;
- modo híbrido con ambas fuentes.

## Criterio de cierre

La reconstrucción solo se considera terminada cuando:

- el código antiguo deja de estar conectado a producción;
- no existen importaciones del motor antiguo;
- el libro mensual concilia al céntimo;
- cada año comienza con el cierre anterior;
- cada aportación compra unidades;
- cada venta crea una bolsa EURC trazable;
- cada recompra crea un lote productivo;
- las recompras cuentan como capital aportado interno;
- el beneficio resta únicamente capital externo;
- existen varios ciclos alcistas y bajistas;
- las fuentes activas llegan al motor;
- los escenarios proceden de trayectorias comunes;
- el verificador independiente confirma los resultados;
- la aplicación instalada reproduce exactamente el JSON validado.
