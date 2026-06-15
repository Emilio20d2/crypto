import { useState } from "react";
import type { CSSProperties } from "react";

const FALLBACK_COLORS = ["#327cff", "#25bfe8", "#5ae37a", "#111827", "#64748b", "#0f766e"];

function fallbackColor(symbol: string) {
  const first = symbol.trim().charCodeAt(0);
  return FALLBACK_COLORS[Math.abs(first || 0) % FALLBACK_COLORS.length];
}

type LogoStyle = CSSProperties & {
  "--logo-size"?: string;
  "--logo-color"?: string;
};

export function LocalAssetLogo({
  logoUrl,
  symbol,
  size = 32,
  className = "",
}: {
  logoUrl?: string | null;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = (symbol || "?").slice(0, 3).toUpperCase();
  const style: LogoStyle = {
    "--logo-size": `${size}px`,
    "--logo-color": fallbackColor(label),
  };

  if (logoUrl && !failed) {
    return (
      <span className={`asset-logo ${className}`} style={style}>
        <img src={logoUrl} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className={`asset-logo asset-logo-fallback ${className}`} style={style} aria-label={label}>
      {label.slice(0, 1)}
    </span>
  );
}
