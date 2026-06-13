import { useEffect, useRef } from "react";
import { createChart, AreaSeries, CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

export interface MarketChartProps {
  data: { time: Time; value: number }[];
  provider?: string;
  isCached?: boolean;
  emptyStateMessage?: string;
}

export function MarketChart({ data, provider, isCached, emptyStateMessage = "No hay datos disponibles" }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
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
      height: 400,
    });
    
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#327cff",
      topColor: "rgba(37, 191, 232, 0.4)",
      bottomColor: "rgba(37, 191, 232, 0)",
      lineWidth: 2,
    });
    seriesRef.current = series;

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
          tooltipRef.current.innerHTML = `<div><strong>Price:</strong> €${value.toFixed(2)}</div>`;
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []); // Only run once on mount

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      seriesRef.current.setData(data);
      chartRef.current?.timeScale().fitContent();

      const latest = data[data.length - 1];
      // @ts-expect-error: En lightweight-charts v5 los markers no están tipados estáticamente en AreaSeries
      seriesRef.current.setMarkers([
        {
          time: latest.time,
          position: 'aboveBar',
          color: '#327cff',
          shape: 'circle',
          text: 'Current',
        }
      ]);
    }
  }, [data]);

  return (
    <div style={{ position: "relative" }}>
      {provider && (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: "rgba(255,255,255,0.8)", padding: "4px 8px", borderRadius: 4, fontSize: "12px", border: "1px solid #ddd" }}>
          Provider: {provider} {isCached && <span style={{ color: "green", marginLeft: "4px" }}>(Cached)</span>}
        </div>
      )}
      {data.length === 0 && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2, color: "#666" }}>
          {emptyStateMessage}
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: "100%", height: "400px" }} />
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
