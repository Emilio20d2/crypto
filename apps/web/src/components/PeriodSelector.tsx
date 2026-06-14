export type Period = "1h" | "24h" | "1w" | "1m" | "1y" | "all";

interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
  options?: { value: Period; label: string }[];
}

const DEFAULT_OPTIONS: { value: Period; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "1d" },
  { value: "1w", label: "1s" },
  { value: "1m", label: "1m" },
  { value: "1y", label: "1a" },
  { value: "all", label: "Todo" },
];

export function PeriodSelector({ value, onChange, options = DEFAULT_OPTIONS }: PeriodSelectorProps) {
  return (
    <div className="ui-period-selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`ui-period-btn ${value === opt.value ? "active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
