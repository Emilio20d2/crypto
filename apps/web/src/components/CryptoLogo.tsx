import { useState } from "react";

const FALLBACK_COLORS = [
  "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EF4444", "#EC4899",
];

function getFallbackColor(symbol: string): string {
  return FALLBACK_COLORS[symbol.charCodeAt(0) % FALLBACK_COLORS.length];
}

export function CryptoLogo({
  logoUrl,
  symbol,
  size = 28,
}: {
  logoUrl?: string | null;
  symbol: string;
  size?: number;
}) {
  const [imgError, setImgError] = useState(false);

  if (logoUrl && !imgError) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: getFallbackColor(symbol),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: `${Math.floor(size * 0.45)}px`,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {symbol.charAt(0)}
    </div>
  );
}
