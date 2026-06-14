import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./Card";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <Card>
      <CardHeader style={{ paddingBottom: "8px" }}>
        <CardTitle style={{ color: "var(--text-secondary)", fontSize: "13px", fontWeight: 500 }}>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent style={{ paddingBottom: "var(--card-padding-desktop)" }}>
        <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          {value}
        </div>
        {subValue && (
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {subValue}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
