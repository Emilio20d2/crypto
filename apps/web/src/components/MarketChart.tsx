import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, CrosshairMode, createChart, createSeriesMarkers } from "lightweight-charts";
import type { CSSProperties } from "react";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time } from "lightweight-charts";

export type ChartPoint = {
  time: Time;
  value: number;
  high?: number;
  low?: number;
  source?: string;
  confidence?: number;
};

export interface MarketChartProps {
  data: ChartPoint[];
  operations?: { time: Time; type: string; label: string; color: string }[];
  provider?: string;
  isCached?: boolean;
  emptyStateMessage?: string;
  height?: number;
}

type ChartStyle = CSSProperties & {
  "--chart-height"?: string;
  "--tooltip-x"?: string;
  "--tooltip-y"?: string;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  price: number;
  high?: number;
  low?: number;
  timestamp: number;
};

function toSeconds(time: Time | null | undefined) {
  if (typeof time === "number") {
    const seconds = time > 1e11 ? Math.floor(time / 1000) : Math.floor(time);
    return Number.isFinite(seconds) ? seconds : null;
  }

  if (typeof time === "string") {
    const seconds = Math.floor(new Date(time).getTime() / 1000);
    return Number.isFinite(seconds) ? seconds : null;
  }

  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const seconds = Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    return Number.isFinite(seconds) ? seconds : null;
  }

  return null;
}

function sanitizeData(data: ChartPoint[]) {
  const map = new Map<number, ChartPoint>();

  for (const point of data) {
    const seconds = toSeconds(point.time);
    if (seconds === null || seconds <= 0 || !Number.isFinite(point.value) || point.value <= 0) continue;
    map.set(seconds, { ...point, time: seconds as Time });
  }

  return Array.from(map.values()).sort((a, b) => (toSeconds(a.time) ?? 0) - (toSeconds(b.time) ?? 0));
}

function formatTooltipDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return {
    date: date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
  };
}

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export function MarketChart({
  data,
  operations = [],
  emptyStateMessage = "No hay datos disponibles",
  height = 320,
}: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const pointLookupRef = useRef<Map<number, ChartPoint>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const sanitized = useMemo(() => sanitizeData(data), [data]);
  const pointLookup = useMemo(() => {
    const lookup = new Map<number, ChartPoint>();
    sanitized.forEach((point) => {
      const seconds = toSeconds(point.time);
      if (seconds !== null) lookup.set(seconds, point);
    });
    return lookup;
  }, [sanitized]);

  useEffect(() => {
    pointLookupRef.current = pointLookup;
  }, [pointLookup]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#667085",
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(17, 24, 39, 0.06)" },
        horzLines: { color: "rgba(17, 24, 39, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.18 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#327cff",
      topColor: "rgba(50, 124, 255, 0.18)",
      bottomColor: "rgba(37, 191, 232, 0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series);

    const hideTooltip = () => {
      setTooltip((current) => current === null ? current : null);
    };

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !container) {
        hideTooltip();
        return;
      }

      if (
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        hideTooltip();
        return;
      }

      const seriesData = param.seriesData.get(series) as { value?: number; close?: number } | undefined;
      const price = seriesData?.value ?? seriesData?.close;
      if (!price || !Number.isFinite(price)) {
        hideTooltip();
        return;
      }

      const timestamp = toSeconds(param.time);
      if (timestamp === null) {
        hideTooltip();
        return;
      }

      const point = pointLookupRef.current.get(timestamp);
      const nextTooltip = {
        visible: true,
        x: Math.min(param.point.x + 14, Math.max(16, container.clientWidth - 190)),
        y: Math.min(param.point.y + 14, Math.max(16, container.clientHeight - 112)),
        price,
        high: point?.high,
        low: point?.low,
        timestamp,
      };

      setTooltip((current) => {
        if (
          current &&
          current.visible === nextTooltip.visible &&
          current.x === nextTooltip.x &&
          current.y === nextTooltip.y &&
          current.price === nextTooltip.price &&
          current.high === nextTooltip.high &&
          current.low === nextTooltip.low &&
          current.timestamp === nextTooltip.timestamp
        ) {
          return current;
        }

        return nextTooltip;
      });
    });

    return () => {
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (sanitized.length < 2) {
      series.setData([]);
      markersRef.current?.setMarkers([]);
      return;
    }

    series.setData(sanitized.map((point) => ({ time: point.time, value: point.value })));
    chartRef.current?.timeScale().fitContent();

    const markers = operations
      .flatMap((operation) => {
        const time = toSeconds(operation.time);
        if (time === null) return [];
        return [{
          time: time as Time,
          position: operation.type === "buy" ? "belowBar" as const : "aboveBar" as const,
          color: operation.color,
          shape: operation.type === "buy" ? "arrowUp" as const : "arrowDown" as const,
          text: operation.label,
        }];
      })
      .sort((a, b) => (toSeconds(a.time) ?? 0) - (toSeconds(b.time) ?? 0));

    markersRef.current?.setMarkers(markers);
  }, [operations, sanitized]);

  const chartStyle: ChartStyle = { "--chart-height": `${height}px` };
  const tooltipStyle: ChartStyle | undefined = tooltip?.visible
    ? { "--tooltip-x": `${tooltip.x}px`, "--tooltip-y": `${tooltip.y}px` }
    : undefined;
  const tooltipDate = tooltip ? formatTooltipDate(tooltip.timestamp) : null;

  return (
    <div className="market-chart" style={chartStyle}>
      {sanitized.length < 2 && (
        <div className="chart-empty-state">
          <p>{emptyStateMessage}</p>
        </div>
      )}
      <div ref={chartContainerRef} className="market-chart-canvas" />
      {tooltip && tooltipDate && (
        <div className="chart-tooltip" style={tooltipStyle}>
          <strong>{eur.format(tooltip.price)}</strong>
          <span>{tooltipDate.date}</span>
          <span>{tooltipDate.time}</span>
          <span>Máx. {tooltip.high ? eur.format(tooltip.high) : "No disponible"}</span>
          <span>Mín. {tooltip.low ? eur.format(tooltip.low) : "No disponible"}</span>
        </div>
      )}
    </div>
  );
}
