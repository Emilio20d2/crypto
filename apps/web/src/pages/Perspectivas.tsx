import { ChartNoAxesCombined, CheckCircle2, CircleDashed } from "lucide-react";
import { Badge } from "../components/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { PageToolbar } from "../components/PageToolbar";

const READINESS_ITEMS = [
  "Cartera",
  "Mercado",
  "Operaciones",
  "Configuración",
  "Históricos",
  "Modo recuperación",
];

export function Perspectivas() {
  return (
    <section className="page-stack perspectives-page">
      <PageToolbar title="Perspectivas" meta="Pendiente de validación funcional, visual, datos y rendimiento" />
      <Card>
        <CardHeader>
          <CardTitle>Validación previa</CardTitle>
          <Badge variant="warning">Bloqueado</Badge>
        </CardHeader>
        <CardContent>
          <div className="perspectives-gate">
            <ChartNoAxesCombined size={38} />
            <span>
              <strong>No se inicia este módulo hasta cerrar la auditoría base.</strong>
              <small>Cartera, Mercado, Operaciones, Configuración e históricos deben quedar estables antes de activar análisis nuevos.</small>
            </span>
          </div>
          <div className="readiness-list">
            {READINESS_ITEMS.map((item) => (
              <div className="readiness-row" key={item}>
                {item === "Modo recuperación" ? <CircleDashed size={16} /> : <CheckCircle2 size={16} />}
                <span>{item}</span>
                <Badge variant={item === "Modo recuperación" ? "warning" : "neutral"}>
                  {item === "Modo recuperación" ? "Pendiente" : "En auditoría"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
