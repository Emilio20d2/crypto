import { useNavigate, useLocation } from "react-router-dom";

export type PlanSectionId =
  | "resumen"
  | "configurar"
  | "aportaciones"
  | "compra-inteligente"
  | "ventas-recompras"
  | "seguimiento";

interface PlanNavItem {
  id: PlanSectionId;
  label: string;
}

const PLAN_NAV: PlanNavItem[] = [
  { id: "resumen", label: "Resumen" },
  { id: "configurar", label: "Configurar mi plan" },
  { id: "aportaciones", label: "Aportaciones" },
  { id: "compra-inteligente", label: "Compra Inteligente" },
  { id: "ventas-recompras", label: "Ventas/Recompras" },
  { id: "seguimiento", label: "Seguimiento" },
];

// Compatibilidad con rutas antiguas de la arquitectura provisional
const LEGACY_ROUTE_MAP: Record<string, PlanSectionId> = {
  ciclos: "configurar",
  estrategia: "configurar",
  "beneficios-y-caidas": "ventas-recompras",
  sustituciones: "ventas-recompras",
  historial: "seguimiento",
};

function resolveSection(pathname: string): PlanSectionId {
  // pathname: /plan-inversion/[section]/...
  const parts = pathname.split("/");
  const segment = parts[2];
  if (!segment) return "resumen";
  const mapped = LEGACY_ROUTE_MAP[segment];
  if (mapped) return mapped;
  const direct = segment as PlanSectionId;
  return PLAN_NAV.some((n) => n.id === direct) ? direct : "resumen";
}

export function PlanNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = resolveSection(location.pathname);

  const goTo = (section: PlanSectionId) => {
    navigate(`/plan-inversion/${section}`);
  };

  return (
    <>
      {/* Mobile (≤834px): selector compacto, sin scroll horizontal */}
      <div className="plan-nav-mobile">
        <select
          className="ui-select"
          value={activeSection}
          onChange={(e) => goTo(e.target.value as PlanSectionId)}
          aria-label="Sección del plan"
        >
          {PLAN_NAV.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop (>834px): lista vertical */}
      <nav className="plan-nav" aria-label="Secciones del plan de inversión">
        {PLAN_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`plan-nav-item${activeSection === item.id ? " active" : ""}`}
            onClick={() => goTo(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}
