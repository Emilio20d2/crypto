export type Period = "1h" | "1d" | "1s" | "1m" | "1a" | "Todo";

export const PERIODS = ["1h", "1d", "1s", "1m", "1a", "Todo"] as const;

interface PeriodSelectorProps {
  activePeriod: Period;
  onChange: (period: Period) => void;
  periods?: Period[];
  className?: string;
}

const DEFAULT_PERIODS: Period[] = ["1h", "1d", "1s", "1m", "1a", "Todo"];

export function PeriodSelector({ activePeriod, onChange, periods = DEFAULT_PERIODS, className = "" }: PeriodSelectorProps) {
  return (
    <div className={`ui-period-selector ${className}`}>
      {periods.map(period => (
        <button
          key={period}
          className={`ui-period-btn ${activePeriod === period ? "active" : ""}`}
          onClick={() => onChange(period)}
          type="button"
        >
          {period}
        </button>
      ))}
    </div>
  );
}
