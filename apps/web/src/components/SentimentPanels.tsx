import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MarketSentiment, MarketSentimentDirection, MarketSentimentTimeframe, SentimentFactor } from "@crypto-control/core";
import { Badge } from "./Badge";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { SegmentedControl } from "./SegmentedControl";
import { formatDateTime } from "../lib/format";

const TIMEFRAME_OPTIONS: { value: MarketSentimentTimeframe; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
];

const DIRECTION_LABEL: Record<MarketSentimentDirection, string> = {
  very_bullish: "Muy alcista",
  bullish: "Alcista",
  neutral: "Neutral",
  bearish: "Bajista",
  very_bearish: "Muy bajista",
};

const DIRECTION_VARIANT: Record<MarketSentimentDirection, "success" | "danger" | "info" | "warning" | "neutral"> = {
  very_bullish: "success",
  bullish: "success",
  neutral: "neutral",
  bearish: "warning",
  very_bearish: "danger",
};

const STATE_LABEL: Record<MarketSentiment["state"], string> = {
  live: "Live",
  cached: "Caché",
  partial: "Parcial",
  unavailable: "No disponible",
};

const STATE_VARIANT: Record<MarketSentiment["state"], "success" | "danger" | "info" | "warning" | "neutral"> = {
  live: "success",
  cached: "info",
  partial: "warning",
  unavailable: "danger",
};

const FACTOR_SIGNAL_LABEL: Record<SentimentFactor["signal"], string> = {
  bullish: "Alcista",
  neutral: "Neutral",
  bearish: "Bajista",
};

function clampMeter(score: number) {
  return Math.min(100, Math.max(0, ((score + 100) / 200) * 100));
}

function signedScore(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

function SentimentMeter({ score }: { score: number }) {
  return (
    <div className="sentiment-meter" aria-label={`Puntuación ${signedScore(score)}`}>
      <span className="sentiment-meter-track" />
      <span className="sentiment-meter-mid" />
      <span className="sentiment-meter-marker" style={{ left: `${clampMeter(score)}%` }} />
    </div>
  );
}

function SentimentFactorRow({ factor }: { factor: SentimentFactor }) {
  return (
    <div className="sentiment-factor-row">
      <span>
        <strong>{factor.label}</strong>
        <small>{factor.source} · peso {(factor.weight * 100).toFixed(0)}%</small>
      </span>
      <span>
        <em>{FACTOR_SIGNAL_LABEL[factor.signal]}</em>
        <strong>{signedScore(factor.contribution)}</strong>
      </span>
    </div>
  );
}

export function AssetSentimentChip({ sentiment }: { sentiment?: MarketSentiment | null }) {
  if (!sentiment) return null;
  return (
    <span className={`asset-sentiment-chip ${sentiment.score < 0 ? "negative" : sentiment.score > 0 ? "positive" : ""}`}>
      {signedScore(sentiment.score)}
    </span>
  );
}

export function SentimentCard({
  title,
  subtitle,
  sentiment,
  loading,
}: {
  title: string;
  subtitle: string;
  sentiment?: MarketSentiment | null;
  loading?: boolean;
}) {
  return (
    <Card className="sentiment-card">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="panel-caption">{subtitle}</p>
        </div>
        {sentiment && <Badge variant={STATE_VARIANT[sentiment.state]}>{STATE_LABEL[sentiment.state]}</Badge>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="empty-inline">Calculando sentimiento...</p>
        ) : !sentiment ? (
          <p className="empty-inline">Sentimiento no disponible para este periodo.</p>
        ) : (
          <div className="sentiment-content">
            <div className="sentiment-headline">
              <span>
                <Badge variant={DIRECTION_VARIANT[sentiment.direction]}>{DIRECTION_LABEL[sentiment.direction]}</Badge>
                <small>{sentiment.timeframe} · confianza {Math.round(sentiment.confidence)}%</small>
              </span>
              <strong>{signedScore(sentiment.score)}</strong>
            </div>
            <SentimentMeter score={sentiment.score} />
            <dl className="sentiment-meta">
              <div><dt>Calculado</dt><dd>{formatDateTime(sentiment.calculatedAt)}</dd></div>
              <div><dt>Válido hasta</dt><dd>{formatDateTime(sentiment.validUntil)}</dd></div>
            </dl>
            <div className="sentiment-factor-list">
              {sentiment.factors.length === 0 ? (
                <p className="empty-inline">Sin factores suficientes.</p>
              ) : (
                sentiment.factors.map((factor) => <SentimentFactorRow key={factor.id} factor={factor} />)
              )}
            </div>
            {sentiment.missingSignals && sentiment.missingSignals.length > 0 && (
              <div className="sentiment-missing">
                <strong>Señales no disponibles</strong>
                <span>{sentiment.missingSignals.join(" · ")}</span>
              </div>
            )}
            {sentiment.sourceSummary.length > 0 && (
              <p className="sentiment-sources">{sentiment.sourceSummary.join(" · ")}</p>
            )}
            {sentiment.methodology && <p className="sentiment-methodology">{sentiment.methodology}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


export function MarketSentimentSection({
  assetName,
  assetSymbol,
  timeframe,
  onTimeframeChange,
  assetSentiment,
  globalSentiment,
  assetLoading,
  globalLoading,
}: {
  assetName?: string;
  assetSymbol?: string;
  timeframe: MarketSentimentTimeframe;
  onTimeframeChange: (timeframe: MarketSentimentTimeframe) => void;
  assetSentiment?: MarketSentiment | null;
  globalSentiment?: MarketSentiment | null;
  assetLoading?: boolean;
  globalLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="market-sentiment-section">
      <div className="sentiment-section-header">
        <div>
          <h2>Sentimiento del mercado</h2>
          <p>Lectura local con histórico, cobertura y confianza.</p>
        </div>
        <div className="sentiment-controls">
          {open && (
            <SegmentedControl value={timeframe} options={TIMEFRAME_OPTIONS} onChange={onTimeframeChange} label="Periodo de sentimiento" />
          )}
          <button
            type="button"
            className="sentiment-collapse-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Colapsar sentimiento" : "Expandir sentimiento"}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {open ? "Ocultar" : "Mostrar análisis"}
          </button>
        </div>
      </div>
      {open && (
        <div className="sentiment-grid">
          <SentimentCard
            title={assetName ? `${assetName}` : "Activo seleccionado"}
            subtitle={assetSymbol ? `${assetSymbol} · sentimiento del activo` : "Sentimiento del activo"}
            sentiment={assetSentiment}
            loading={assetLoading}
          />
          <SentimentCard
            title="Mercado global"
            subtitle="Amplitud y tendencia agregada de activos disponibles"
            sentiment={globalSentiment}
            loading={globalLoading}
          />
        </div>
      )}
    </section>
  );
}
