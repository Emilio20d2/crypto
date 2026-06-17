import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { InvestmentPlan, InvestmentCycle, Result } from "@crypto-control/core";
import { PlanNavigation } from "./PlanNavigation";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

const PLAN_STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
  archived: "Archivado",
};

export function PlanLayout() {
  const activePlanQuery = useQuery<InvestmentPlan | null>({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQuery.data ?? null;

  const currentCycleQuery = useQuery<InvestmentCycle | null>({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });
  const currentCycle = currentCycleQuery.data ?? null;

  return (
    <div className="plan-module">
      <div className="page-toolbar">
        <div className="page-toolbar-copy">
          <span className="page-eyebrow">Estrategia base</span>
          <h1>Plan de Inversión</h1>
          {activePlan ? (
            <span className="page-meta">
              {activePlan.name}
              {" · "}
              {PLAN_STATUS_LABEL[activePlan.status] ?? activePlan.status}
              {currentCycle ? ` · Ciclo activo: ${currentCycle.name}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <div className="plan-module-body">
        <PlanNavigation />
        <div className="plan-module-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
