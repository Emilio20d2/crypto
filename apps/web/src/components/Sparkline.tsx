import type { CSSProperties } from "react";

type SparklinePoint = {
  time?: number;
  value?: number;
  close?: number;
};

type SparklineStyle = CSSProperties & {
  "--spark-color"?: string;
};

function normalize(points: SparklinePoint[]) {
  return points
    .map((point, index) => {
      const x = point.time ?? index;
      const y = point.value ?? point.close;
      return typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && y > 0 ? { x, y } : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .sort((a, b) => a.x - b.x);
}

export function Sparkline({
  points,
  positive,
  label = "Minigráfica 24 h",
}: {
  points: SparklinePoint[];
  positive?: boolean;
  label?: string;
}) {
  const data = normalize(points);

  if (data.length < 2) {
    return <span className="sparkline-empty">Sin datos</span>;
  }

  const min = Math.min(...data.map((point) => point.y));
  const max = Math.max(...data.map((point) => point.y));

  if (min === max) {
    return <span className="sparkline-empty">Sin variación</span>;
  }

  const width = 112;
  const height = 34;
  const xMin = data[0].x;
  const xMax = data[data.length - 1].x;
  const path = data.map((point, index) => {
    const x = xMax === xMin ? 0 : ((point.x - xMin) / (xMax - xMin)) * width;
    const y = height - ((point.y - min) / (max - min)) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

  const style: SparklineStyle = {
    "--spark-color": positive === false ? "#ef4444" : "#327cff",
  };

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={style}>
      <path d={path} />
    </svg>
  );
}
