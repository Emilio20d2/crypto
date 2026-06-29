AMPLIACIÓN CORRECTIVA BLOQUEANTE — DIFERENCIAR OPERACIONES REALES, SIMULACIÓN ESTRATÉGICA Y ALERTAS DINÁMICAS

ACLARACIÓN DE LA MISIÓN

La corrección realizada para impedir que la cartera real registre ventas o recompras inexistentes es válida, pero la interpretación funcional es incompleta.

La aplicación no debe limitarse a ejecutar ventas y recompras únicamente cuando existan reglas manuales previamente configuradas.

El objetivo del sistema es también:

* Analizar continuamente la evolución del mercado.
* Detectar posibles fases de sobrevaloración o agotamiento.
* Proponer ventas parciales cuando exista una ventaja neta razonable.
* Reservar la fiscalidad estimada.
* Mantener el beneficio operativo en EURC.
* Detectar posteriormente zonas coherentes de recompra.
* Proponer recompras escalonadas.
* Simular el efecto de dichas decisiones en Perspectivas.
* Comparar el resultado con la estrategia de mantener sin operar.

Además, las ventas solo se propondrán si ha habido un beneficio considerablemente bueno para recuperar capital invertido, y las recompras solo si el precio es lo bastante bajo como para permitir posteriormente una rentabilidad atractiva.

Por tanto, debes diferenciar estrictamente tres capas que no pueden mezclarse.

⸻

1. TRES CAPAS INDEPENDIENTES

CAPA A — CARTERA Y OPERACIONES REALES

Esta capa solo puede contener operaciones realmente ejecutadas o introducidas por el usuario.

Si la base de datos tiene:

* 0 reglas de venta.
* 0 ventas ejecutadas.
* 0 recompras ejecutadas.
* 0 tiers aceptados.

Entonces los valores reales deben cumplir:

* realizedSalesEur === 0
* realizedRebuysEur === 0
* realizedTaxEur === 0

La aplicación no puede inventar operaciones realizadas.

Esta parte de la corrección actual debe mantenerse.

⸻

CAPA B — SIMULACIÓN ESTRATÉGICA DE PERSPECTIVAS

Perspectivas sí debe poder generar operaciones hipotéticas aunque el usuario todavía no haya configurado manualmente reglas de venta o tiers de recompra.

Estas operaciones deben ser creadas por el motor estratégico basándose en:

* Trayectoria de precios del escenario.
* Fase del ciclo.
* Tendencia.
* Valoración.
* Volatilidad.
* Momentum.
* Riesgo.
* Datos técnicos.
* Datos de derivados.
* Datos on-chain.
* Fundamentales.
* Condiciones macroeconómicas.
* Opiniones de analistas.
* Medios especializados.
* Consenso y sentimiento del mercado.
* Estado de la cartera.
* Coste medio.
* Beneficio acumulado.
* Concentración por activo.
* Saldo disponible en EURC.
* Impacto fiscal.
* Comisiones.
* Riesgo de vender prematuramente.
* Probabilidad de poder recomprar con ventaja.

Estas operaciones son:

* Hipotéticas.
* Estratégicas.
* Auditables.
* Diferentes de las operaciones reales.
* Específicas para cada escenario.
* Claramente identificadas como simulación.

No deben incorporarse al libro mayor real.

La ausencia de reglas manuales no significa que la simulación estratégica deba hacer cero ventas y cero recompras.

Significa únicamente que:

* No existen operaciones obligatorias predefinidas por el usuario.
* El motor debe decidir si resulta razonable proponer operaciones estratégicas.
* Si los datos no justifican operar, debe mantener.
* Si los datos sí lo justifican, debe simular la propuesta.

⸻

CAPA C — MOTOR DE ALERTAS EN TIEMPO REAL

El motor de alertas debe vigilar el mercado real y generar propuestas actuales de:

* Preparación de venta parcial.
* Venta parcial recomendada.
* Vigilancia de corrección.
* Preparación de recompra.
* Recompra escalonada recomendada.
* Cancelación o invalidación de una señal.
* Mantener sin actuar.

Las alertas no deben depender exclusivamente de reglas manuales.

Las reglas manuales son límites y preferencias del usuario, pero el motor debe detectar oportunidades dinámicamente.

Una recomendación no equivale a una operación ejecutada.

La operación real solo debe registrarse cuando:

* El usuario confirme que la ha ejecutado.
* Se importe desde el exchange.
* Se concilie mediante una fuente real de operaciones.

⸻

2. CORREGIR LOS TESTS ACTUALES

Los tests añadidos que exigen:

* totalSalesEur === 0
* totalRebuysEur === 0
* totalTaxEur === 0

solo son correctos si se refieren a:

* Operaciones reales.
* Simulación pasiva.
* Modo sin estrategia táctica.
* Escenario en el que ninguna señal justifica actuar.

No deben imponerse globalmente a toda la simulación de Perspectivas.

Revisa los nombres y el alcance de esos campos.

Evita utilizar un único total ambiguo.

Separa, como mínimo:

* realizedSalesEur
* realizedRebuysEur
* realizedTaxEur
* simulatedStrategicSalesEur
* simulatedStrategicRebuysEur
* simulatedStrategicTaxEur
* proposedSalesEur
* proposedRebuysEur
* projectedEurcReserve
* projectedFiscalReserve

Añade también:

* strategyEnabled
* strategyMode
* strategySource
* simulationOnly
* requiresUserConfirmation

Los tests deben demostrar:

Caso 1 — Cartera real sin operaciones

* realizedSalesEur === 0
* realizedRebuysEur === 0
* realizedTaxEur === 0

Caso 2 — Perspectivas sin estrategia táctica

* simulatedStrategicSalesEur === 0
* simulatedStrategicRebuysEur === 0

Caso 3 — Perspectivas con estrategia dinámica, pero sin señales suficientes

* simulatedStrategicSalesEur === 0
* simulatedStrategicRebuysEur === 0
* decision === “hold”

Caso 4 — Perspectivas con señales sólidas de venta

* simulatedStrategicSalesEur > 0
* simulatedStrategicTaxEur > 0 cuando exista plusvalía
* projectedEurcReserve > 0
* no se modifica el libro mayor real

Caso 5 — Perspectivas con corrección suficiente y señales de estabilización

* simulatedStrategicRebuysEur > 0
* se reduce el EURC operativo
* se incrementan las unidades proyectadas
* no se utiliza el EURC fiscal

Caso 6 — Venta no rentable después de impuestos y costes

* simulatedStrategicSalesEur === 0
* decision === “hold”
* debe explicarse la falta de ventaja neta

⸻

3. MODOS DE SIMULACIÓN

Implementa expresamente varios modos.

PASSIVE

Utiliza aportaciones y evolución de mercado sin ventas tácticas ni recompras.

Sirve como referencia.

USER_RULES

Ejecuta únicamente reglas de venta y recompra configuradas por el usuario.

INTELLIGENT_STRATEGY

El motor propone y simula ventas y recompras dinámicas basándose en las condiciones del mercado.

HYBRID

Combina:

* Reglas y límites definidos por el usuario.
* Detección inteligente de oportunidades.
* Confirmación de señales externas.
* Optimización del tamaño de cada tramo.

Perspectivas debe permitir comparar al menos:

* Estrategia pasiva.
* Reglas manuales.
* Estrategia inteligente.
* Estrategia híbrida.

No sustituyas una por otra.

⸻

4. OBJETIVO DEL MOTOR ESTRATÉGICO

El objetivo no debe definirse como “hacer el mayor número de operaciones”.

Tampoco como “vender siempre arriba y comprar siempre abajo”.

El objetivo debe ser:

Maximizar el patrimonio neto esperado y el número de unidades recuperables, después de impuestos y costes, sujeto a límites de riesgo, incertidumbre y concentración.

El motor debe priorizar:

* Beneficio neto.
* Protección del patrimonio.
* Aumento de unidades.
* Reducción del drawdown.
* Coherencia con el Plan.
* Control fiscal.
* Baja sobreoperación.

No puede garantizar que obtendrá la máxima rentabilidad.

Debe intentar mejorar la rentabilidad esperada frente a mantener, demostrando la ventaja mediante simulaciones y escenarios.

⸻

5. MOTOR DE INTELIGENCIA DE MERCADO

Implementa un motor que se actualice continuamente con datos reales.

Debe recopilar y normalizar, cuando estén disponibles:

Precio y mercado

* Precio actual.
* Volumen.
* Liquidez.
* Volatilidad.
* Máximos y mínimos.
* Caída desde máximos.
* Distancia a soportes y resistencias.
* Tendencia diaria.
* Tendencia semanal.
* Tendencia mensual.
* Aceleración.
* Amplitud del mercado.

Técnicos

* RSI.
* MACD.
* Medias móviles.
* ATR.
* Volumen.
* Divergencias.
* Estructura de mercado.
* Momentum.
* Rupturas y falsas rupturas.

No utilices ningún indicador como señal única.

Derivados

* Funding.
* Interés abierto.
* Liquidaciones.
* Prima de futuros.
* Apalancamiento.
* Desequilibrio entre posiciones largas y cortas.

On-chain

Cuando sea aplicable:

* Entradas y salidas de exchanges.
* Actividad de grandes carteras.
* Beneficios realizados.
* Coste base.
* Actividad de red.
* Oferta.
* Emisión.
* Desbloqueos.
* Concentración.

Fundamentales

* Uso de la red.
* Actividad de desarrolladores.
* Ingresos.
* Comisiones.
* TVL.
* Adopción.
* Riesgos del protocolo.
* Cambios regulatorios.
* Tokenomics.

Macroeconomía

* Tipos de interés.
* Liquidez.
* Inflación.
* Política monetaria.
* Riesgo sistémico.
* Flujos institucionales.
* Contexto regulatorio.

⸻

6. ANALISTAS, MEDIOS Y SENTIMIENTO

El sistema debe consultar y actualizar periódicamente:

* Medios especializados en criptomonedas.
* Informes de analistas.
* Proveedores de análisis de mercado.
* Informes institucionales.
* Fuentes on-chain.
* Noticias regulatorias.
* Noticias macroeconómicas.
* Cambios de previsiones.
* Opiniones alcistas, neutrales y bajistas.

Cada elemento debe guardar:

* Fuente.
* Autor.
* Fecha y hora.
* Activo.
* Horizonte temporal.
* Tesis.
* Riesgos.
* Sesgo.
* Tipo de contenido.
* Fuente original.
* Fiabilidad.
* Caducidad.
* Referencia.

Deduplica contenidos.

Una noticia publicada por veinte medios a partir de una única fuente cuenta como una sola evidencia.

Distingue:

* Hecho.
* Opinión.
* Predicción.
* Estimación.
* Rumor.
* Contenido patrocinado.
* Publicación de una parte interesada.

Los medios y analistas no pueden decidir por sí solos una venta o recompra.

Deben utilizarse como una categoría de confirmación junto con datos de mercado.

⸻

7. ACTUALIZACIÓN CONTINUA

La aplicación debe mantener actualizados los datos según la frecuencia real de cada proveedor.

Como mínimo, diseña frecuencias diferenciadas:

* Precio y mercado: tiempo real o frecuencia máxima disponible.
* Técnicos: recalculados al cerrar cada marco temporal relevante.
* Derivados: según frecuencia del proveedor.
* Noticias: consulta periódica y por eventos.
* Analistas: al publicarse nuevos informes.
* On-chain: según frecuencia real de cada métrica.
* Macroeconomía: cuando se publiquen datos o cambien eventos relevantes.
* Consenso: recalculado cuando cambien fuentes relevantes.

Cada dato debe incluir:

* sourceTimestamp
* fetchedAt
* expiresAt
* freshnessStatus
* provider
* reliability
* confidence

Si los datos críticos están caducados, la alerta no puede considerarse accionable.

No utilices indefinidamente datos guardados en caché.

⸻

8. DECISIÓN DE VENTA PARCIAL

El motor debe analizar si vender parcialmente puede ser mejor que mantener.

Debe considerar:

* Ganancia acumulada.
* Coste medio.
* Rentabilidad por lote.
* Peso del activo.
* Concentración.
* Fase del ciclo.
* Sobrevaloración.
* Pérdida de impulso.
* Riesgo de corrección.
* Situación de derivados.
* Datos on-chain.
* Fundamentales.
* Consenso de analistas.
* Riesgo macroeconómico.
* Impuestos.
* Comisiones.
* Spread.
* Coste de oportunidad.
* Probabilidad de continuación alcista.
* Probabilidad de corrección suficiente.

Debe evaluar varios tamaños de venta, por ejemplo:

* 5 %.
* 10 %.
* 15 %.
* 20 %.
* 25 %.

La propuesta debe seleccionar el tramo que produzca mejor equilibrio entre:

* Beneficio protegido.
* Riesgo de vender demasiado pronto.
* Fiscalidad.
* Posible recompra.
* Unidades recuperables.
* Patrimonio neto esperado.

No vendas el 100 % salvo una situación extraordinaria y explícitamente justificada.

⸻

9. PUNTO DE EQUILIBRIO DE LA RECOMPRA

Antes de proponer una venta, calcula:

* Importe bruto de venta.
* Plusvalía.
* Impuesto estimado.
* Comisiones.
* Spread.
* Deslizamiento.
* EURC fiscal.
* EURC operativo.
* Precio de recompra para recuperar las mismas unidades.
* Caída mínima necesaria.
* Caída necesaria con margen de seguridad.
* Unidades adicionales posibles.

Si la corrección probable no supera el punto de equilibrio y el margen de seguridad, no recomiendes vender.

Ejemplo conceptual:

Si la operación necesita una caída del 14 % para recuperar las mismas unidades netas y el escenario central solo estima una corrección del 8 %, la decisión correcta debe ser mantener.

⸻

10. DECISIÓN DE RECOMPRA

El motor no debe recomprar solo porque el precio esté por debajo del precio de venta.

Debe comprobar:

* Que se ha superado el punto de equilibrio.
* Que existe ventaja neta.
* Que el activo conserva una tesis válida.
* Que la caída no presenta todavía deterioro incontrolado.
* Que hay estabilización o regla escalonada válida.
* Que el EURC utilizado es operativo.
* Que no se emplea la reserva fiscal.
* Que la distribución resultante respeta el Plan.
* Que la recompra ofrece una ventaja frente a seguir esperando.

Debe evaluar diferentes tramos:

* 20 %.
* 25 %.
* 33 %.
* 50 % del EURC operativo asociado.

Debe mostrar:

* EURC utilizado.
* Unidades estimadas.
* Unidades vendidas anteriormente.
* Unidades adicionales.
* Nuevo coste medio.
* EURC restante.
* Riesgo de caída adicional.
* Siguiente nivel posible.
* Condición de invalidación.

⸻

11. PUNTUACIONES DINÁMICAS

Implementa puntuaciones diferentes:

SellOpportunityScore

Mide la conveniencia de recoger beneficios parcialmente.

RebuyOpportunityScore

Mide la conveniencia de desplegar EURC.

Las puntuaciones deben combinar:

* Calidad de datos.
* Actualidad.
* Independencia de señales.
* Régimen de mercado.
* Estado de cartera.
* Coherencia con el Plan.
* Impacto fiscal.
* Costes.
* Ventaja neta.
* Riesgo.
* Incertidumbre.
* Calidad de analistas y fuentes.

No utilices una media simple de indicadores correlacionados.

Cinco indicadores derivados del mismo precio no equivalen a cinco confirmaciones independientes.

⸻

12. PROYECCIÓN EN LOS CINCO ESCENARIOS

Mantén los cinco escenarios:

* Conservador.
* Moderado.
* Base.
* Favorable.
* Optimista.

Cada escenario debe contener:

* Trayectoria de precios.
* Volatilidad.
* Correcciones.
* Fases de mercado.
* Señales disponibles en cada momento.
* Ventas hipotéticas propuestas.
* EURC generado.
* Impuestos estimados.
* Recompras hipotéticas.
* Unidades finales.
* Patrimonio final.

Las ventas y recompras de cada escenario deben ser consecuencia de los datos simulados de ese escenario.

No utilices exactamente las mismas operaciones en los cinco escenarios.

No uses información futura para ejecutar retrospectivamente una operación perfecta.

El motor debe decidir utilizando únicamente la información que estaría disponible en cada punto simulado.

⸻

13. COMPARACIÓN OBLIGATORIA

Para cada escenario calcula en paralelo:

A. Plan pasivo

Aportaciones y mantenimiento sin operaciones tácticas.

B. Plan con reglas del usuario

Solo reglas configuradas.

C. Estrategia inteligente

Ventas y recompras propuestas por el motor.

D. Estrategia híbrida

Reglas del usuario más inteligencia de mercado.

Muestra:

* Patrimonio final.
* Beneficio neto.
* TWR.
* XIRR.
* Drawdown.
* Impuestos.
* Comisiones.
* Tiempo en EURC.
* Ventas.
* Recompras.
* Unidades finales.
* Diferencia frente al plan pasivo.
* Diferencia frente a mantener.

No ocultes los casos en los que la estrategia inteligente produce peor resultado.

⸻

14. PERSPECTIVAS DEBE MOSTRAR AMBOS RESULTADOS

La página Perspectivas no debe presentar un único patrimonio final sin explicar cómo se ha obtenido.

Debe diferenciar claramente:

* Proyección sin estrategia táctica.
* Proyección con estrategia inteligente.
* Mejora o empeoramiento estimado.
* Operaciones hipotéticas incluidas.
* Impuestos.
* EURC.
* Unidades adicionales.
* Nivel de confianza.
* Incertidumbre.

Las operaciones hipotéticas deben etiquetarse como:

“Operaciones simuladas por el motor estratégico. No ejecutadas.”

Nunca deben confundirse con operaciones reales.

⸻

15. ALERTAS EN TIEMPO REAL

Las señales reales del mercado deben generar alertas con estados:

* Sin acción.
* Vigilancia.
* Preparación.
* Acción parcial propuesta.
* Invalidada.
* Caducada.
* Datos insuficientes.
* Riesgo extraordinario.

Cada alerta debe mostrar:

* Activo.
* Tipo.
* Confianza.
* Precio.
* Tramo propuesto.
* Motivos a favor.
* Motivos en contra.
* Analistas y fuentes.
* Fiscalidad.
* Costes.
* EURC resultante.
* Punto de equilibrio.
* Caída necesaria.
* Unidades adicionales potenciales.
* Qué confirma la alerta.
* Qué la invalida.
* Hasta cuándo es válida.

La aplicación no ejecutará automáticamente la operación.

⸻

16. NO UTILIZAR “MÁXIMA RENTABILIDAD” COMO PROMESA

El motor debe intentar maximizar la rentabilidad neta esperada dentro de límites de riesgo.

No debe presentar:

* Beneficios garantizados.
* Máximos o mínimos seguros.
* Probabilidades falsas.
* Precisión inexistente.
* Operaciones como certezas.

La terminología correcta será