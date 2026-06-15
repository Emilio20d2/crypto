import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";

interface StatCardProps {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <Card className="stat-card">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <strong>{value}</strong>
        {subValue && <span>{subValue}</span>}
      </CardContent>
    </Card>
  );
}
