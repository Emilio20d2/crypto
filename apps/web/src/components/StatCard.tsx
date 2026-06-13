import React from "react";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, subValue, className = "" }: StatCardProps) {
  return (
    <div className={`ui-stat-card ${className}`}>
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value">{value}</div>
      {subValue && <div className="ui-stat-sub">{subValue}</div>}
    </div>
  );
}
