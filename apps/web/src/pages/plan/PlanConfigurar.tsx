import { useState, type FormEvent } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ChevronRight, Copy, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { Input } from "../../components/Input";
import { formatMoney } from "../../lib/format";
import type { CycleGoal, CycleRisk, InvestmentAsset, InvestmentCycle, Result } from "@crypto-control/core";
import { PlanEtapaActivos } from "./PlanEtapaActivos";
import { PlanRepartoMensual } from "./PlanRepartoMensual";
import { PlanCambiosEstrategia } from "./PlanCambiosEstrategia";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInput(v: number | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(v: string, required = false): number | null {
  if (!v) {
    if (required) throw new Error("Fecha de inicio obligatoria.");
    return null;
  }
  return new Date(`${v}T00:00:00`).getTime();
}

function parseNumber(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatDate(v: number | null | undefined): string {
  if (!v) return "Abierta";
  return new Date(v).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Label maps ────────────────────────────────────────────────────────────────

type CycleStatus = InvestmentCycle["status"];

const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  planned: "Planificado",
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
};

const CYCLE_STATUS_BADGE: Record<CycleStatus, string> = {
  planned: "",
  active: "badge-success",
  paused: "badge-warning",
  closed: "",
};

const CYCLE_GOAL_LABEL: Record<CycleGoal, string> = {
  acumulacion: "Acumulación",
  crecimiento: "Crecimiento",
  preservacion: "Preservación",
  renta: "Renta",
};

const CYCLE_RISK_LABEL: Record<CycleRisk, string> = {
  bajo: "Bajo",
  moderado: "Moderado",
  alto: "Alto",
  muy_alto: "Muy alto",
};

// ── Allocation helpers ────────────────────────────────────────────────────────

function getActiveAssets(cycleId: string, allAssets: InvestmentAsset[]): InvestmentAsset[] {
  return allAssets.filter(a => a.cycleId === cycleId && a.status === "active" && a.isActive);
}

function getPercentageTotal(activeAssets: InvestmentAsset[]): number {
  return activeAssets.reduce((sum, a) => {
    const pct = a.allocationPercentage ?? (a.allocationType === "percentage" ? a.allocationValue : 0);
    return sum + pct;
  }, 0);
}

function getAllocationWarning(cycle: InvestmentCycle, activeAssets: InvestmentAsset[]): string | null {
  const hasPct = activeAssets.some(a =>
    (a.allocationPercentage ?? (a.allocationType === "percentage" ? a.allocationValue : null)) !== null
  );
  if (!hasPct) return null;
  const pctTotal = getPercentageTotal(activeAssets);
  if (Math.abs(pctTotal - 100) > 0.01) {
    return cycle.status === "active"
      ? "La suma de porcentajes activos debe ser 100% antes de activar el ciclo."
      : "Borrador: revisa que los porcentajes sumen 100% antes de activar.";
  }
  return null;
}

// ── CycleSummaryCard ──────────────────────────────────────────────────────────

function CycleSummaryCard({
  cycle,
  activeAssets,
  onNavigate,
  onDuplicate,
  onDelete,
  duplicating,
  deleting,
}: {
  cycle: InvestmentCycle;
  activeAssets: InvestmentAsset[];
  onNavigate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  duplicating: boolean;
  deleting: boolean;
}) {
  const pctTotal = getPercentageTotal(activeAssets);
  const warning = getAllocationWarning(cycle, activeAssets);

  return (
    <article className="cycle-summary-card" role="group" aria-label={cycle.name}>
      <div className="cycle-summary-header">
        <div className="cycle-summary-meta">
          <strong className="cycle-summary-name">{cycle.name}</strong>
          <span className={`badge ${CYCLE_STATUS_BADGE[cycle.status]}`}>{CYCLE_STATUS_LABEL[cycle.status]}</span>
          {cycle.objetivo ? <span className="badge">{CYCLE_GOAL_LABEL[cycle.objetivo]}</span> : null}
          {cycle.riesgo ? <span className="badge">{CYCLE_RISK_LABEL[cycle.riesgo]}</span> : null}
        </div>
        <div className="cycle-summary-actions">
          <Button type="button" variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
            <Copy size={13} /> Duplicar
          </Button>
          <Button type="button" variant="danger" size="sm" loading={deleting} onClick={onDelete}>
            <Trash2 size={13} />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onNavigate}>
            Ver detalle <ChevronRight size={13} />
          </Button>
        </div>
      </div>

      <dl className="cycle-summary-grid">
        <div><dt>Inicio</dt><dd>{formatDate(cycle.startDate)}</dd></div>
        <div><dt>Fin</dt><dd>{formatDate(cycle.endDate)}</dd></div>
        <div><dt>Aportación</dt><dd>{formatMoney(cycle.monthlyAmountEur)}/mes</dd></div>
        <div><dt>Monedas</dt><dd>{activeAssets.length} activas</dd></div>
        <div>
          <dt>Reparto</dt>
          <dd>{pctTotal.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%</dd>
        </div>
      </dl>

      {warning ? <p className="cycle-summary-warning">{warning}</p> : null}
    </article>
  );
}

// ── NewCycleForm ──────────────────────────────────────────────────────────────

function NewCycleForm({
  planId,
  onSuccess,
  onCancel,
}: {
  planId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [objetivo, setObjetivo] = useState<CycleGoal | "">("");
  const [riesgo, setRiesgo] = useState<CycleRisk | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: Parameters<typeof window.cryptoControl.investmentCycles.create>[0]) =>
      unwrap(window.cryptoControl.investmentCycles.create(data)),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["investment-cycles"] }),
        qc.invalidateQueries({ queryKey: ["persp2:getSimulation"] }),
      ]);
      onSuccess();
    },
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("El nombre de la etapa es obligatorio."); return; }
    if (!startDate) { setError("La fecha de inicio es obligatoria."); return; }
    const start = fromDateInput(startDate, true);
    const end = fromDateInput(endDate);
    if (!start) { setError("Fecha de inicio inválida."); return; }
    if (end !== null && end < start) {
      setError("La fecha de fin no puede ser anterior al inicio.");
      return;
    }
    const amount = parseNumber(monthlyAmount);
    if (!amount || amount <= 0) { setError("La aportación mensual debe ser mayor de 0."); return; }

    await create.mutateAsync({
      planId,
      name: name.trim(),
      startDate: start,
      endDate: end,
      monthlyAmountEur: amount,
      contributionCurrency: "EUR",
      status: "planned",
      priority: 0,
      objetivo: objetivo || null,
      riesgo: riesgo || null,
      allowExtraContributions: true,
      notes: notes || null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva etapa de inversión</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? <p className="error-msg">{error}</p> : null}
        <form className="investment-form-grid" onSubmit={(e) => void handleSubmit(e)}>
          <label className="form-group">
            <span>Nombre *</span>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Etapa 2026–2030" />
          </label>
          <label className="form-group">
            <span>Fecha de inicio *</span>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label className="form-group">
            <span>Fecha de fin (opcional)</span>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
          <label className="form-group">
            <span>Aportación mensual (EUR) *</span>
            <Input inputMode="decimal" value={monthlyAmount} onChange={e => setMonthlyAmount(e.target.value)} placeholder="Ej. 200" />
          </label>
          <label className="form-group">
            <span>Objetivo</span>
            <select className="ui-select" value={objetivo} onChange={e => setObjetivo(e.target.value as CycleGoal | "")}>
              <option value="">Sin objetivo</option>
              <option value="acumulacion">Acumulación</option>
              <option value="crecimiento">Crecimiento</option>
              <option value="preservacion">Preservación</option>
              <option value="renta">Renta</option>
            </select>
          </label>
          <label className="form-group">
            <span>Perfil de riesgo</span>
            <select className="ui-select" value={riesgo} onChange={e => setRiesgo(e.target.value as CycleRisk | "")}>
              <option value="">Sin definir</option>
              <option value="bajo">Bajo</option>
              <option value="moderado">Moderado</option>
              <option value="alto">Alto</option>
              <option value="muy_alto">Muy alto</option>
            </select>
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones opcionales" />
          </label>
          <div className="investment-form-actions">
            <Button type="submit" loading={create.isPending}>
              <Plus size={14} /> Crear etapa
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── EtapasList ────────────────────────────────────────────────────────────────

function EtapasList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const activePlanQ = useQuery({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQ.data ?? null;

  const cyclesQ = useQuery({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });
  const cycles = Array.isArray(cyclesQ.data) ? cyclesQ.data : [];

  const assetsQ = useQuery({
    queryKey: ["investment-assets"],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()),
  });
  const allAssets: InvestmentAsset[] = assetsQ.data ?? [];

  const deleteCycle = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentCycles.delete(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment-cycles"] }),
  });

  const duplicateCycle = useMutation({
    mutationFn: async (cycle: InvestmentCycle) => {
      const created = await unwrap(window.cryptoControl.investmentCycles.create({
        planId: cycle.planId,
        name: `${cycle.name} copia`,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        monthlyAmountEur: cycle.monthlyAmountEur,
        contributionCurrency: cycle.contributionCurrency,
        status: "planned",
        priority: cycle.priority + 1,
        notes: cycle.notes,
      }));
      const cycleAssets = allAssets.filter(a => a.cycleId === cycle.id);
      for (const a of cycleAssets) {
        await unwrap(window.cryptoControl.investmentAssets.create({
          cycleId: created.id,
          assetId: a.assetId,
          allocationType: a.allocationType,
          allocationValue: a.allocationValue,
          allocationPercentage: a.allocationPercentage,
          fixedAmountEur: a.fixedAmountEur,
          priority: a.priority,
          targetAmount: a.targetAmount,
          targetValueEur: a.targetValueEur,
          targetPortfolioPercentage: a.targetPortfolioPercentage,
          startDate: a.startDate,
          endDate: a.endDate,
          status: a.status,
          isActive: a.isActive,
          notes: a.notes,
        }));
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment-cycles"] }),
  });

  if (activePlanQ.isLoading) {
    return <Card><CardContent><p className="empty-inline">Cargando…</p></CardContent></Card>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay un Plan activo. Crea tu Plan desde la sección Resumen.</p>
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={() => navigate("/plan-inversion/resumen")}>
              Ir a Resumen
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const error = cyclesQ.error;

  return (
    <div className="plan-etapas">
      <div className="plan-etapas-header">
        <div>
          <h2 className="plan-etapas-title">Etapas de inversión</h2>
          <p className="panel-caption">
            {activePlan.name} · {cycles.length} {cycles.length === 1 ? "etapa" : "etapas"}
          </p>
        </div>
        {!showCreate ? (
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Nueva etapa
          </Button>
        ) : null}
      </div>

      {error instanceof Error ? <p className="error-msg">{error.message}</p> : null}

      {showCreate ? (
        <NewCycleForm
          planId={activePlan.id}
          onSuccess={() => setShowCreate(false)}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

      {!showCreate && cycles.length === 0 ? (
        <Card>
          <CardContent>
            <p className="empty-inline">
              Todavía no hay etapas. Crea la primera para empezar a asignar monedas.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="cycle-summary-list">
        {cycles.map(cycle => {
          const activeAssets = getActiveAssets(cycle.id, allAssets);
          return (
            <CycleSummaryCard
              key={cycle.id}
              cycle={cycle}
              activeAssets={activeAssets}
              onNavigate={() => navigate(`/plan-inversion/configurar/etapas/${cycle.id}`)}
              onDuplicate={() => void duplicateCycle.mutateAsync(cycle)}
              onDelete={() => {
                if (confirm(`¿Eliminar la etapa "${cycle.name}"? Esta acción no se puede deshacer.`)) {
                  void deleteCycle.mutateAsync(cycle.id);
                }
              }}
              duplicating={duplicateCycle.isPending}
              deleting={deleteCycle.isPending}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── CycleDetailForm — form state safe because cycle is guaranteed non-null ────

function CycleDetailForm({ cycle }: { cycle: InvestmentCycle }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState(cycle.name);
  const [startDate, setStartDate] = useState(toDateInput(cycle.startDate));
  const [endDate, setEndDate] = useState(toDateInput(cycle.endDate));
  const [monthlyAmount, setMonthlyAmount] = useState(String(cycle.monthlyAmountEur));
  const [status, setStatus] = useState<CycleStatus>(cycle.status);
  const [objetivo, setObjetivo] = useState<CycleGoal | "">(cycle.objetivo ?? "");
  const [riesgo, setRiesgo] = useState<CycleRisk | "">(cycle.riesgo ?? "");
  const [allowExtraContributions, setAllowExtraContributions] = useState(cycle.allowExtraContributions ?? true);
  const [notes, setNotes] = useState(cycle.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateCycle = useMutation({
    mutationFn: (data: Partial<InvestmentCycle>) =>
      unwrap(window.cryptoControl.investmentCycles.update(cycle.id, data)),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["investment-cycles"] }),
        qc.invalidateQueries({ queryKey: ["investment-plan"] }),
        qc.invalidateQueries({ queryKey: ["persp2:getSimulation"] }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const deleteCycle = useMutation({
    mutationFn: () => unwrap(window.cryptoControl.investmentCycles.delete(cycle.id)),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["investment-cycles"] }),
        qc.invalidateQueries({ queryKey: ["persp2:getSimulation"] }),
      ]);
      navigate("/plan-inversion/configurar");
    },
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    if (!name.trim()) { setFormError("El nombre de la etapa es obligatorio."); return; }
    const start = fromDateInput(startDate, true);
    const end = fromDateInput(endDate);
    if (!start) { setFormError("Fecha de inicio inválida."); return; }
    if (end !== null && end < start) {
      setFormError("La fecha de fin no puede ser anterior al inicio.");
      return;
    }
    const amount = parseNumber(monthlyAmount);
    if (!amount || amount <= 0) { setFormError("La aportación mensual debe ser mayor de 0."); return; }

    await updateCycle.mutateAsync({
      name: name.trim(),
      startDate: start,
      endDate: end,
      monthlyAmountEur: amount,
      status,
      objetivo: objetivo || null,
      riesgo: riesgo || null,
      allowExtraContributions,
      notes: notes || null,
    });
  }

  return (
    <div className="plan-etapa-detalle">
      <div className="plan-etapa-detalle-header">
        <button
          type="button"
          className="plan-etapa-back"
          onClick={() => navigate("/plan-inversion/configurar")}
          aria-label="Volver a etapas"
        >
          <ArrowLeft size={14} /> Etapas de inversión
        </button>
        <h2>{cycle.name}</h2>
        <span className={`badge ${CYCLE_STATUS_BADGE[cycle.status]}`}>
          {CYCLE_STATUS_LABEL[cycle.status]}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <CalendarDays size={15} /> Información de la etapa
          </CardTitle>
          {saved ? <span className="badge badge-success">Guardado</span> : null}
        </CardHeader>
        <CardContent>
          {formError ? <p className="error-msg">{formError}</p> : null}
          <form className="investment-form-grid" onSubmit={(e) => void handleSubmit(e)}>
            <label className="form-group">
              <span>Nombre *</span>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Inicio *</span>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Fin (vacío = etapa abierta)</span>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Aportación mensual (EUR) *</span>
              <Input inputMode="decimal" value={monthlyAmount} onChange={e => setMonthlyAmount(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Estado</span>
              <select className="ui-select" value={status} onChange={e => setStatus(e.target.value as CycleStatus)}>
                <option value="planned">Planificado</option>
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
                <option value="closed">Cerrado</option>
              </select>
            </label>
            <label className="form-group">
              <span>Objetivo</span>
              <select className="ui-select" value={objetivo} onChange={e => setObjetivo(e.target.value as CycleGoal | "")}>
                <option value="">Sin objetivo</option>
                <option value="acumulacion">Acumulación</option>
                <option value="crecimiento">Crecimiento</option>
                <option value="preservacion">Preservación</option>
                <option value="renta">Renta</option>
              </select>
            </label>
            <label className="form-group">
              <span>Perfil de riesgo</span>
              <select className="ui-select" value={riesgo} onChange={e => setRiesgo(e.target.value as CycleRisk | "")}>
                <option value="">Sin definir</option>
                <option value="bajo">Bajo</option>
                <option value="moderado">Moderado</option>
                <option value="alto">Alto</option>
                <option value="muy_alto">Muy alto</option>
              </select>
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <textarea
                className="ui-textarea investment-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="secondary" loading={updateCycle.isPending}>
                <Save size={14} /> Guardar cambios
              </Button>
              <label className="investment-checkbox-label">
                <input
                  type="checkbox"
                  checked={allowExtraContributions}
                  onChange={e => setAllowExtraContributions(e.target.checked)}
                />
                <span>Permitir aportaciones extraordinarias</span>
              </label>
            </div>
          </form>
        </CardContent>
      </Card>

      <PlanEtapaActivos
        cycleId={cycle.id}
        cycleStart={cycle.startDate}
        monthlyAmountEur={cycle.monthlyAmountEur}
      />
      <PlanRepartoMensual
        cycleId={cycle.id}
        monthlyAmountEur={cycle.monthlyAmountEur}
      />
      <PlanCambiosEstrategia cycleId={cycle.id} />

      <Card>
        <CardContent>
          <div className="investment-form-actions">
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={deleteCycle.isPending}
              onClick={() => {
                if (confirm(`¿Eliminar la etapa "${cycle.name}"? Esta acción no se puede deshacer.`)) {
                  void deleteCycle.mutateAsync();
                }
              }}
            >
              <Trash2 size={14} /> Eliminar etapa
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── PlanEtapaDetalle ──────────────────────────────────────────────────────────

function PlanEtapaDetalle() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();

  const activePlanQ = useQuery({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQ.data ?? null;

  const cyclesQ = useQuery({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });

  const isLoading = activePlanQ.isLoading || cyclesQ.isLoading;
  const cycle = Array.isArray(cyclesQ.data) ? (cyclesQ.data.find(c => c.id === cycleId) ?? null) : null;

  if (isLoading) {
    return <Card><CardContent><p className="empty-inline">Cargando etapa…</p></CardContent></Card>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay un Plan activo.</p>
          <Button variant="ghost" size="sm" onClick={() => navigate("/plan-inversion/configurar")}>
            <ArrowLeft size={14} /> Volver
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!cycle) {
    return (
      <Card>
        <CardContent>
          <p className="error-msg">No se ha encontrado la etapa solicitada.</p>
          <Button variant="ghost" size="sm" onClick={() => navigate("/plan-inversion/configurar")}>
            <ArrowLeft size={14} /> Volver a etapas
          </Button>
        </CardContent>
      </Card>
    );
  }

  // key=cycle.id ensures CycleDetailForm re-mounts and re-initializes state
  // when navigating between different cycle detail pages
  return <CycleDetailForm key={cycle.id} cycle={cycle} />;
}

// ── PlanConfigurar — sub-router ───────────────────────────────────────────────

export function PlanConfigurar() {
  return (
    <Routes>
      <Route index element={<EtapasList />} />
      <Route path="etapas/:cycleId" element={<PlanEtapaDetalle />} />
      <Route path="*" element={<Navigate to="/plan-inversion/configurar" replace />} />
    </Routes>
  );
}
