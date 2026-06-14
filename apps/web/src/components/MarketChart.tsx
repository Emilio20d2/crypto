import { useEffect, useRef } from "react";
import { createChart, AreaSeries, CrosshairMode, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time, ISeriesMarkersPluginApi } from "lightweight-charts";

export interface MarketChartProps {
  data: { time: Time; value: number }[];
  operations?: { time: Time; type: string; label: string; color: string }[];
  provider?: string;
  isCached?: boolean;
  emptyStateMessage?: string;
  height?: number;
}

export function MarketChart({ data, operations = [], provider, isCached, emptyStateMessage = "No hay datos disponibles", height = 400 }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "#ffffff" },
        textColor: "#333",
      },
      grid: {
        vertLines: { color: "#eaf6ff" },
        horzLines: { color: "#eaf6ff" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height,
    });
    
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#327cff",
      topColor: "rgba(37, 191, 232, 0.4)",
      bottomColor: "rgba(37, 191, 232, 0)",
      lineWidth: 2,
    });
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series);

    // Use ResizeObserver for more robust resizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) {
        return;
      }
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width });
    });
    
    resizeObserver.observe(chartContainerRef.current);
    
    // Tooltip logic
    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current) return;
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        tooltipRef.current.style.display = 'none';
      } else {
        const data = param.seriesData.get(series) as unknown as Record<string, unknown>;
        if (data) {
          const value = (data.value !== undefined ? data.value : data.close) as number;
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = param.point.x + 15 + 'px';
          tooltipRef.current.style.top = param.point.y + 15 + 'px';
          tooltipRef.current.innerHTML = `<div><strong>Precio:</strong> €${value.toFixed(2)}</div>`;
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      if (markersRef.current) {
        markersRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- chart created once; height handled separately

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      // sanitizePoints: Garantizar tiempo Unix en segundos, sin duplicados, estrictamente ascendente, finito y mayor que cero.
      const map = new Map<number, number>();
      for (const pt of data) {
        let ts = typeof pt.time === 'string' ? new Date(pt.time).getTime() / 1000 : (pt.time as number);
        // Si el timestamp es muy grande (> 100 mil millones), probablemente está en ms, lo pasamos a s.
        if (ts > 1e11) ts = Math.floor(ts / 1000);
        else ts = Math.floor(ts);
        
        if (ts <= 0 || !Number.isFinite(pt.value) || pt.value <= 0) continue;
        
        // Almacenar el último valor conocido para cada segundo (deduplicación natural)
        map.set(ts, pt.value);
      }
      
      const sanitizedData = Array.from(map.entries())
        .map(([time, value]) => ({ time: time as Time, value }))
        .sort((a, b) => (a.time as number) - (b.time as number));
        
      if (sanitizedData.length < 2) {
        // Lightweight Charts requiere al menos 2 puntos para AreaSeries, si no, lo vaciamos de forma segura
        seriesRef.current.setData([]);
        return;
      }
      
      seriesRef.current.setData(sanitizedData);
      chartRef.current?.timeScale().fitContent();

      const latest = sanitizedData[sanitizedData.length - 1];
      if (markersRef.current) {
        const markers: import('lightweight-charts').SeriesMarker<Time>[] = operations.map(op => ({
          time: op.time,
          position: op.type === "buy" ? 'belowBar' : 'aboveBar',
          color: op.color,
          shape: op.type === "buy" ? 'arrowUp' : 'arrowDown',
          text: op.label,
        }));
        
        markers.push({
          time: latest.time,
          position: 'aboveBar',
          color: '#327cff',
          shape: 'circle',
          text: 'Actual',
        });
        
        // Order markers by strict time
        markers.sort((a, b) => {
          let ta = typeof a.time === 'string' ? new Date(a.time).getTime() / 1000 : (a.time as number);
          let tb = typeof b.time === 'string' ? new Date(b.time).getTime() / 1000 : (b.time as number);
          if (ta > 1e11) ta = Math.floor(ta / 1000);
          if (tb > 1e11) tb = Math.floor(tb / 1000);
          return ta - tb;
        });

        // Eliminar marcadores duplicados en el mismo segundo exacto
        const uniqueMarkers = markers.filter((m, i, arr) => {
          if (i === 0) return true;
          const prevTime = typeof arr[i-1].time === 'string' ? new Date(arr[i-1].time as string).getTime() / 1000 : (arr[i-1].time as number);
          const currTime = typeof m.time === 'string' ? new Date(m.time as string).getTime() / 1000 : (m.time as number);
          return Math.floor(currTime) !== Math.floor(prevTime);
        });

        markersRef.current.setMarkers(uniqueMarkers);
      }
    } else if (seriesRef.current && data.length === 0) {
      seriesRef.current.setData([]);
    }
  }, [data, operations]);

  return (
    <div style={{ position: "relative" }}>
      {provider && (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: "rgba(255,255,255,0.8)", padding: "4px 8px", borderRadius: 4, fontSize: "12px", border: "1px solid #ddd" }}>
          Proveedor: {provider} {isCached && <span style={{ color: "green", marginLeft: "4px" }}>(En caché)</span>}
        </div>
      )}
      {data.length === 0 && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2, color: "#666" }}>
          {emptyStateMessage}
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: "100%", height: `${height}px` }} />
      <div 
        ref={tooltipRef} 
        style={{
          display: 'none',
          position: 'absolute',
          background: 'rgba(255, 255, 255, 0.9)',
          border: '1px solid #ccc',
          padding: '8px',
          borderRadius: '4px',
          pointerEvents: 'none',
          zIndex: 10,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
      />
    </div>
  );
}
