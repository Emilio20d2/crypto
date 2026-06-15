import { SegmentedControl } from "./SegmentedControl";

export type Period = "1h" | "24h" | "1w" | "1m" | "1y" | "all";

interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
  options?: { value: Period; label: string }[];
  className?: string;
}

const DEFAULT_PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "1w", label: "7d" },
  { value: "1m", label: "30d" },
  { value: "1y", label: "1a" },
  { value: "all", label: "Todo" },
];

export function PeriodSelector({ value, onChange, options = DEFAULT_PERIOD_OPTIONS, className = "" }: PeriodSelectorProps) {
  return (
    <SegmentedControl
      value={value}
      options={options}
      onChange={onChange}
      label="Periodo"
      className={className}
    />
  );
}
