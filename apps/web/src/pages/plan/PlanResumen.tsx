import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Asset,
  CycleMetrics,
  InvestmentAsset,
  InvestmentCycle,
  InvestmentPlan,
  Result,
  StrategicAlert,
} from "@crypto-control/core";
import { Button } from "../../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { Input } from "../../components/Input";
import { formatMoney } from "../../lib/format";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function toDateInput(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toISOString().split("T")[0];
}

function parseDateInput(s: string): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function formatDate(ts: number | null | undefined) {
  if (!ts) return "Sin fecha de fin";
  return new Date(ts).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ──────────────────────────────────────────────
// ASISTENTE DE PRIMER USO — 5 PASOS
// ──────────────────────────────────────────────

interface WizardData {
  monthlyAmount: string;
  startDate: string;
  endDate: string;
  planName: string;
  showAdvanced: boolean;
  selectedAssetIds: string[];
  allocations: Record<string, string>; // assetId → porcentaje (string)
  objectives: Record<string, string>;  // assetId → cantidad objetivo (string)
}

function initWizard(): WizardData {
  const today = new Date().toISOString().split("T")[0];
  return {
    monthlyAmount: "",
    startDate: today,
    endDate: "",
    planName: "Plan principal",
    showAdvanced: false,
    selectedAssetIds: [],
    allocations: {},
    objectives: {},
  };
}

function WizardStep1({
  data,
  onChange,
  onNext,
}: {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const validate = () => {
    const amount = parseFloat(data.monthlyAmount.replace(",", "."));
    if (!data.monthlyAmount || isNaN(amount) || amount <= 0) {
      setError("Introduce un importe mensual válido.");
      return false;
    }
    if (!data.startDate) { setError("La fecha de inicio es obligatoria."); return false; }
    setError(null);
    return true;
  };

  const handleNext = (e: FormEvent) => {
    e.preventDefault();
    if (validate()) onNext();
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Paso 1 de 5 — Tu aportación mensual</CardTitle>
          <p className="panel-caption">Define cuánto quieres invertir habitualmente cada mes y en qué periodo.</p>
        </div>
        <span className="badge">1 / 5</span>
      </CardHeader>
      <CardContent>
        {error ? <p className="error-msg">{error}</p> : null}
        <form className="investment-form-grid" onSubmit={handleNext}>
          <label className="form-group">
            <span>¿Cuánto quieres invertir al mes? (€)</span>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Ej. 100"
              value={data.monthlyAmount}
              onChange={(e) => onChange({ monthlyAmount: e.target.value })}
            />
          </label>
          <label className="form-group">
            <span>Fecha de inicio</span>
            <Input
              type="date"
              value={data.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
            />
          </label>
          <label className="form-group">
            <span>Fecha de fin (opcional)</span>
            <Input
              type="date"
              value={data.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </label>

          <div className="investment-wide">
            <button
              type="button"
              className="plan-nav-item"
              style={{ fontSize: 12, color: "var(--text-secondary)" }}
              onClick={() => onChange({ showAdvanced: !data.showAdvanced })}
            >
              {data.showAdvanced ? "▴ Ocultar opciones" : "▾ Más opciones"}
            </button>
            {data.showAdvanced ? (
              <div className="investment-form-grid" style={{ marginTop: 8 }}>
                <label className="form-group investment-wide">
                  <span>Nombre del plan</span>
                  <Input
                    value={data.planName}
                    onChange={(e) => onChange({ planName: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="investment-form-actions">
            <Button type="submit">Siguiente →</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function WizardStep2({
  data,
  availableAssets,
  onChange,
  onBack,
  onNext,
}: {
  data: WizardData;
  availableAssets: Asset[];
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = availableAssets.filter(
    (a) =>
      a.type === "crypto" &&
      (a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.symbol.toLowerCase().includes(search.toLowerCase()))
  );

  const toggle = (assetId: string) => {
    const ids = data.selectedAssetIds.includes(assetId)
      ? data.selectedAssetIds.filter((id) => id !== assetId)
      : [...data.selectedAssetIds, assetId];
    onChange({ selectedAssetIds: ids });
  };

  const handleNext = () => {
    if (data.selectedAssetIds.length === 0) {
      setError("Selecciona al menos una moneda.");
      return;
    }
    // Inicializar distribución uniforme si no hay valores
    const existing = data.allocations;
    const autoPercent = Math.floor(100 / data.selectedAssetIds.length);
    const allocations = { ...existing };
    data.selectedAssetIds.forEach((id, i) => {
      if (!allocations[id]) {
        // Último activo recibe el resto para evitar redondeo
        const isLast = i === data.selectedAssetIds.length - 1;
        allocations[id] = String(isLast ? 100 - autoPercent * (data.selectedAssetIds.length - 1) : autoPercent);
      }
    });
    // Eliminar activos ya no seleccionados
    Object.keys(allocations).forEach((id) => {
      if (!data.selectedAssetIds.includes(id)) delete allocations[id];
    });
    onChange({ allocations });
    setError(null);
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Paso 2 de 5 — ¿En qué monedas quieres invertir?</CardTitle>
          <p className="panel-caption">Selecciona las criptomonedas que formarán parte de tu plan.</p>
        </div>
        <span className="badge">2 / 5</span>
      </CardHeader>
      <CardContent>
        {error ? <p className="error-msg">{error}</p> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input
            placeholder="Buscar moneda..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="investment-contribution-list" style={{ maxHeight: 280, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <p className="empty-inline">No se encontraron monedas.</p>
            ) : (
              filtered.slice(0, 30).map((asset) => {
                const selected = data.selectedAssetIds.includes(asset.id);
                return (
                  <label
                    key={asset.id}
                    className="investment-contribution"
                    style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(asset.id)}
                    />
                    <strong>{asset.symbol}</strong>
                    <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{asset.name}</span>
                  </label>
                );
              })
            )}
          </div>
          {data.selectedAssetIds.length > 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {data.selectedAssetIds.length} moneda{data.selectedAssetIds.length !== 1 ? "s" : ""} seleccionada{data.selectedAssetIds.length !== 1 ? "s" : ""}
            </p>
          ) : null}
          <div className="investment-form-actions">
            <Button type="button" variant="ghost" onClick={onBack}>← Atrás</Button>
            <Button type="button" onClick={handleNext}>Siguiente →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WizardStep3({
  data,
  availableAssets,
  onChange,
  onBack,
  onNext,
}: {
  data: WizardData;
  availableAssets: Asset[];
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const monthly = parseFloat(data.monthlyAmount.replace(",", ".")) || 0;

  const totalPct = data.selectedAssetIds.reduce(
    (sum, id) => sum + (parseFloat(data.allocations[id] ?? "0") || 0),
    0
  );
  const remaining = 100 - totalPct;
  const allAssigned = Math.abs(remaining) < 0.01;

  const getAsset = (id: string) => availableAssets.find((a) => a.id === id);

  const updatePct = (assetId: string, value: string) => {
    onChange({ allocations: { ...data.allocations, [assetId]: value } });
  };

  const handleNext = () => {
    if (!allAssigned) {
      setError(`El reparto suma ${totalPct.toFixed(1)}%. Debe sumar exactamente 100%.`);
      return;
    }
    const anyInvalid = data.selectedAssetIds.some(
      (id) => !(parseFloat(data.allocations[id] ?? "0") > 0)
    );
    if (anyInvalid) {
      setError("Cada moneda debe tener un porcentaje mayor que 0.");
      return;
    }
    setError(null);
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Paso 3 de 5 — Reparto del dinero</CardTitle>
          <p className="panel-caption">
            Indica qué porcentaje de tus {formatMoney(monthly)} mensuales recibirá cada moneda.
          </p>
        </div>
        <span className={`badge ${allAssigned ? "badge-success" : remaining < 0 ? "badge-danger" : "badge-warning"}`}>
          {allAssigned ? "100% ✓" : remaining > 0 ? `Queda ${remaining.toFixed(0)}%` : `Exceso ${Math.abs(remaining).toFixed(0)}%`}
        </span>
      </CardHeader>
      <CardContent>
        {error ? <p className="error-msg">{error}</p> : null}
        <div className="investment-form-grid">
          {data.selectedAssetIds.map((assetId) => {
            const asset = getAsset(assetId);
            const pct = parseFloat(data.allocations[assetId] ?? "0") || 0;
            const eur = (monthly * pct) / 100;
            return (
              <div key={assetId} className="form-group" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span>
                  <strong>{asset?.symbol ?? assetId}</strong>
                  <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: 6 }}>{asset?.name}</span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={data.allocations[assetId] ?? ""}
                    onChange={(e) => updatePct(assetId, e.target.value)}
                    style={{ width: 80 }}
                  />
                  <span style={{ fontSize: 13 }}>%</span>
                  {eur > 0 ? (
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>= {formatMoney(eur)}/mes</span>
                  ) : null}
                </div>
              </div>
            );
          })}
          <p className="investment-wide" style={{ fontSize: 12, color: allAssigned ? "var(--color-success-text)" : remaining < 0 ? "var(--color-danger)" : "var(--text-secondary)", margin: 0 }}>
            {allAssigned
              ? `Reparto correcto: ${formatMoney(monthly)} distribuidos al 100%.`
              : remaining > 0
              ? `Quedan ${formatMoney((monthly * remaining) / 100)} por asignar (${remaining.toFixed(1)}%).`
              : `Exceso de ${formatMoney((monthly * Math.abs(remaining)) / 100)} (${Math.abs(remaining).toFixed(1)}% de más).`}
          </p>
          <div className="investment-form-actions">
            <Button type="button" variant="ghost" onClick={onBack}>← Atrás</Button>
            <Button type="button" onClick={handleNext}>Siguiente →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WizardStep4({
  data,
  availableAssets,
  onChange,
  onBack,
  onNext,
}: {
  data: WizardData;
  availableAssets: Asset[];
  onChange: (patch: Partial<WizardData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const getAsset = (id: string) => availableAssets.find((a) => a.id === id);

  const updateObjective = (assetId: string, value: string) => {
    onChange({ objectives: { ...data.objectives, [assetId]: value } });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Paso 4 de 5 — Objetivos (opcional)</CardTitle>
          <p className="panel-caption">
            Si alguna moneda tiene una cantidad objetivo, introdúcela aquí. Cuando se alcance, dejará de recibir compras programadas.
          </p>
        </div>
        <span className="badge">4 / 5</span>
      </CardHeader>
      <CardContent>
        <div className="investment-form-grid">
          {data.selectedAssetIds.map((assetId) => {
            const asset = getAsset(assetId);
            return (
              <div key={assetId} className="form-group" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span>
                  <strong>{asset?.symbol ?? assetId}</strong>
                  <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: 6 }}>
                    Hasta cuántas monedas quieres acumular (opcional)
                  </span>
                </span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Sin límite"
                  value={data.objectives[assetId] ?? ""}
                  onChange={(e) => updateObjective(assetId, e.target.value)}
                />
              </div>
            );
          })}
          <div className="investment-form-actions">
            <Button type="button" variant="ghost" onClick={onBack}>← Atrás</Button>
            <Button type="button" variant="ghost" onClick={onNext}>Omitir este paso</Button>
            <Button type="button" onClick={onNext}>Siguiente →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WizardStep5({
  data,
  availableAssets,
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  data: WizardData;
  availableAssets: Asset[];
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const monthly = parseFloat(data.monthlyAmount.replace(",", ".")) || 0;
  const getAsset = (id: string) => availableAssets.find((a) => a.id === id);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Paso 5 de 5 — Confirma tu plan</CardTitle>
          <p className="panel-caption">Revisa la configuración antes de crear el plan.</p>
        </div>
        <span className="badge">5 / 5</span>
      </CardHeader>
      <CardContent>
        {error ? <p className="error-msg">{error}</p> : null}
        <div className="investment-layout" style={{ marginBottom: 16 }}>
          <section className="investment-summary-grid" aria-label="Resumen del plan a crear">
            <article className="investment-summary-tile">
              <span>Plan</span>
              <strong>{data.planName}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Aportación mensual</span>
              <strong>{formatMoney(monthly)}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Inicio</span>
              <strong>{data.startDate}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Fin</span>
              <strong>{data.endDate || "Sin fecha de fin"}</strong>
            </article>
            <article className="investment-summary-tile investment-wide">
              <span>Monedas</span>
              <strong>
                {data.selectedAssetIds.map((id) => {
                  const a = getAsset(id);
                  const pct = parseFloat(data.allocations[id] ?? "0") || 0;
                  const eur = (monthly * pct) / 100;
                  const obj = data.objectives[id];
                  return (
                    <span key={id} style={{ display: "block", fontWeight: "normal", fontSize: 13 }}>
                      {a?.symbol ?? id}: {pct}% · {formatMoney(eur)}/mes
                      {obj && parseFloat(obj) > 0 ? ` · Objetivo: ${obj} monedas` : ""}
                    </span>
                  );
                })}
              </strong>
            </article>
          </section>
        </div>
        <div className="investment-form-actions">
          <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>← Atrás</Button>
          <Button type="button" loading={submitting} onClick={onSubmit}>
            Crear mi plan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanSetupWizard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [data, setData] = useState<WizardData>(initWizard);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetsQuery = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: () => unwrap(window.cryptoControl.assets.list()),
  });
  const availableAssets = assetsQuery.data ?? [];

  const patch = (p: Partial<WizardData>) => setData((d) => ({ ...d, ...p }));
  const next = () => setStep((s) => Math.min(s + 1, 5) as typeof s);
  const back = () => setStep((s) => Math.max(s - 1, 1) as typeof s);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    let planId: string | undefined;
    try {
      const monthly = parseFloat(data.monthlyAmount.replace(",", "."));
      const startTs = parseDateInput(data.startDate);
      const endTs = parseDateInput(data.endDate);
      if (!startTs) throw new Error("Fecha de inicio no válida.");

      // 1. Crear plan
      const plan = await unwrap(
        window.cryptoControl.investmentPlan.create({
          name: data.planName.trim() || "Plan principal",
          description: null,
          notes: null,
          status: "active",
          baseCurrency: "EUR",
        })
      );
      planId = plan.id;

      // 2. Crear ciclo/etapa en estado "planned" para poder añadir activos primero
      const cycle = await unwrap(
        window.cryptoControl.investmentCycles.create({
          planId: plan.id,
          name: "Primera etapa",
          startDate: startTs,
          endDate: endTs,
          monthlyAmountEur: monthly,
          contributionCurrency: "EUR",
          status: "planned",
          priority: 0,
          objetivo: null,
          riesgo: null,
          allowExtraContributions: true,
          notes: null,
        })
      );

      // 3. Crear activos (el ciclo aún está en "planned", sin validación de distribución)
      await Promise.all(
        data.selectedAssetIds.map((assetId) => {
          const pct = parseFloat(data.allocations[assetId] ?? "0") || 0;
          const objRaw = data.objectives[assetId];
          const targetAmount = objRaw && parseFloat(objRaw) > 0 ? parseFloat(objRaw) : null;
          return unwrap(
            window.cryptoControl.investmentAssets.create({
              cycleId: cycle.id,
              assetId,
              allocationType: "percentage",
              allocationValue: pct,
              allocationPercentage: pct,
              fixedAmountEur: null,
              priority: 0,
              targetAmount,
              targetValueEur: null,
              targetPortfolioPercentage: null,
              startDate: startTs,
              endDate: null,
              status: "active",
              notes: null,
            })
          );
        })
      );

      // 4. Activar el ciclo ahora que sus activos existen (validación completa en backend)
      await unwrap(
        window.cryptoControl.investmentCycles.update(cycle.id, { status: "active" })
      );

      // Éxito: invalidar todas las queries del módulo
      queryClient.removeQueries({ queryKey: ["persp2:getSimulation"] });
      await queryClient.invalidateQueries({ queryKey: ["investment-plan"] });
      await queryClient.invalidateQueries({ queryKey: ["investment-cycles"] });
      await queryClient.invalidateQueries({ queryKey: ["investment-assets"] });

      navigate("/plan-inversion/resumen");
    } catch (err) {
      // Limpiar registros parciales si se creó el plan
      if (planId) {
        try {
          await unwrap(window.cryptoControl.investmentPlan.delete(planId));
        } catch {
          // limpieza best-effort
        }
      }
      setError(err instanceof Error ? err.message : "Error al crear el plan. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (assetsQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">Cargando monedas disponibles...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="plan-wizard-header">
        <h2 style={{ margin: 0, fontSize: 20 }}>Crea tu plan de inversión</h2>
        <p className="panel-caption">Te guiamos paso a paso para configurarlo en menos de 2 minutos.</p>
      </div>
      {step === 1 && <WizardStep1 data={data} onChange={patch} onNext={next} />}
      {step === 2 && (
        <WizardStep2 data={data} availableAssets={availableAssets} onChange={patch} onBack={back} onNext={next} />
      )}
      {step === 3 && (
        <WizardStep3 data={data} availableAssets={availableAssets} onChange={patch} onBack={back} onNext={next} />
      )}
      {step === 4 && (
        <WizardStep4 data={data} availableAssets={availableAssets} onChange={patch} onBack={back} onNext={next} />
      )}
      {step === 5 && (
        <WizardStep5
          data={data}
          availableAssets={availableAssets}
          submitting={submitting}
          error={error}
          onBack={back}
          onSubmit={() => void handleSubmit()}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────
// TARJETA "QUÉ DEBES HACER AHORA"
// ──────────────────────────────────────────────

type NextActionType =
  | "crear-plan"
  | "crear-etapa"
  | "completar-reparto"
  | "registrar-aportacion"
  | "completar-aportacion"
  | "al-dia"
  | "sin-acciones";

interface NextAction {
  type: NextActionType;
  message: string;
  cta: string | null;
  ctaPath: string | null;
  detail: string | null;
}

function computeNextAction({
  hasPlan,
  hasCycles,
  hasCurrentCycle,
  hasAssets,
  metrics,
}: {
  hasPlan: boolean;
  hasCycles: boolean;
  hasCurrentCycle: boolean;
  hasAssets: boolean;
  metrics: CycleMetrics | null;
}): NextAction {
  if (!hasPlan) {
    return {
      type: "crear-plan",
      message: "Aún no has creado tu plan de inversión.",
      cta: "Crear mi plan",
      ctaPath: null,
      detail: "El asistente te guía paso a paso en menos de 2 minutos.",
    };
  }
  if (!hasCycles) {
    return {
      type: "crear-etapa",
      message: "El plan no tiene ninguna etapa de inversión configurada.",
      cta: "Configurar primera etapa",
      ctaPath: "/plan-inversion/configurar",
      detail: "Una etapa define cuánto invertirás y durante qué periodo.",
    };
  }
  if (!hasCurrentCycle) {
    return {
      type: "crear-etapa",
      message: "No hay ninguna etapa activa en este momento.",
      cta: "Ver etapas",
      ctaPath: "/plan-inversion/configurar",
      detail: null,
    };
  }
  if (!hasAssets) {
    return {
      type: "completar-reparto",
      message: "La etapa activa no tiene monedas configuradas.",
      cta: "Completar el reparto",
      ctaPath: "/plan-inversion/configurar",
      detail: "Añade las monedas y define cómo se reparte el dinero mensual.",
    };
  }
  if (!metrics) {
    return {
      type: "sin-acciones",
      message: "Plan configurado. Sin información adicional disponible.",
      cta: null,
      ctaPath: null,
      detail: null,
    };
  }

  const lastMonth = metrics.monthlyContributions.at(-1) ?? null;
  const deficit = lastMonth ? Math.max(0, lastMonth.programmedEur - lastMonth.actualEur) : 0;
  const extra = lastMonth ? Math.max(0, lastMonth.actualEur - lastMonth.programmedEur) : 0;

  if (deficit > 0) {
    return {
      type: "completar-aportacion",
      message: `Faltan ${formatMoney(deficit)} para completar la aportación de ${lastMonth!.monthKey}.`,
      cta: "Revisar aportaciones",
      ctaPath: "/plan-inversion/aportaciones",
      detail: `Aportado: ${formatMoney(lastMonth!.actualEur)} · Previsto: ${formatMoney(lastMonth!.programmedEur)}`,
    };
  }
  if (extra > 0) {
    return {
      type: "al-dia",
      message: `Aportación de ${lastMonth!.monthKey} completada. Incluye ${formatMoney(extra)} de aportación extra.`,
      cta: "Ver aportaciones",
      ctaPath: "/plan-inversion/aportaciones",
      detail: null,
    };
  }
  if (lastMonth && lastMonth.actualEur >= lastMonth.programmedEur) {
    return {
      type: "al-dia",
      message: `Aportación de ${lastMonth.monthKey} completada.`,
      cta: null,
      ctaPath: null,
      detail: "Continúa con el plan vigente.",
    };
  }

  return {
    type: "registrar-aportacion",
    message: `Este mes corresponde aportar ${formatMoney(metrics.expectedContributionMonthly)}.`,
    cta: "Revisar aportaciones",
    ctaPath: "/plan-inversion/aportaciones",
    detail: null,
  };
}

function NextActionCard({ action }: { action: NextAction }) {
  const navigate = useNavigate();
  const isPositive = action.type === "al-dia";
  const isUrgent = action.type === "completar-aportacion";

  return (
    <Card className={isPositive ? "investment-card-success" : isUrgent ? "investment-card-warning" : undefined}>
      <CardHeader>
        <div>
          <CardTitle>Qué debes hacer ahora</CardTitle>
          {action.detail ? <p className="panel-caption">{action.detail}</p> : null}
        </div>
        {isPositive ? <span className="badge badge-success">Al día ✓</span> : null}
      </CardHeader>
      <CardContent>
        <p style={{ margin: "0 0 12px", fontWeight: 500 }}>{action.message}</p>
        {action.cta && action.ctaPath ? (
          <Button type="button" onClick={() => navigate(action.ctaPath!)}>
            {action.cta}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────
// PÁGINA RESUMEN
// ──────────────────────────────────────────────

export function PlanResumen() {
  const activePlanQuery = useQuery<InvestmentPlan | null>({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQuery.data ?? null;
  const loadingPlan = activePlanQuery.isPending;

  const cyclesQuery = useQuery<InvestmentCycle[]>({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });
  const cycles = cyclesQuery.data ?? [];

  const currentCycleQuery = useQuery<InvestmentCycle | null>({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });
  const currentCycle = currentCycleQuery.data ?? null;

  const metricsQuery = useQuery<CycleMetrics>({
    queryKey: ["investment-cycles", "metrics", currentCycle?.id],
    enabled: Boolean(currentCycle?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getMetrics({ cycleId: currentCycle!.id })),
  });
  const metrics = metricsQuery.data ?? null;

  const assetsQuery = useQuery<InvestmentAsset[]>({
    queryKey: ["investment-assets"],
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list({})),
    enabled: Boolean(currentCycle?.id),
  });
  const currentAssets = useMemo(
    () => (assetsQuery.data ?? []).filter((a) => a.cycleId === currentCycle?.id && a.status === "active"),
    [assetsQuery.data, currentCycle?.id]
  );

  const alertsQuery = useQuery<StrategicAlert[]>({
    queryKey: ["strategic-alerts", currentCycle?.id],
    enabled: Boolean(currentCycle?.id),
    queryFn: () => unwrap(window.cryptoControl.strategicAlerts.generate({ cycleId: currentCycle!.id })),
    staleTime: 10 * 60 * 1000,
  });
  const criticalAlerts = (alertsQuery.data ?? []).filter((a) => a.severity === "critica");

  const nextAction = useMemo(
    () =>
      computeNextAction({
        hasPlan: Boolean(activePlan),
        hasCycles: cycles.length > 0,
        hasCurrentCycle: Boolean(currentCycle),
        hasAssets: currentAssets.length > 0,
        metrics,
      }),
    [activePlan, cycles.length, currentCycle, currentAssets.length, metrics]
  );

  if (loadingPlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">Cargando plan...</p>
        </CardContent>
      </Card>
    );
  }

  // Sin plan → asistente de primer uso
  if (!activePlan) {
    return <PlanSetupWizard />;
  }

  const lastMonth = metrics?.monthlyContributions.at(-1) ?? null;

  return (
    <div className="investment-layout">
      {/* Acción principal */}
      <NextActionCard action={nextAction} />

      {/* Mi plan actual */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Mi plan actual</CardTitle>
            <p className="panel-caption">{activePlan.name}</p>
          </div>
        </CardHeader>
        <CardContent>
          <section className="investment-summary-grid" aria-label="Datos del plan activo">
            <article className="investment-summary-tile">
              <span>Etapa activa</span>
              <strong>{currentCycle?.name ?? "Sin etapa activa"}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Aportación mensual</span>
              <strong>{currentCycle ? formatMoney(currentCycle.monthlyAmountEur) : "—"}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Inicio</span>
              <strong>{currentCycle ? toDateInput(currentCycle.startDate) : "—"}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Fin</span>
              <strong>{currentCycle ? formatDate(currentCycle.endDate) : "—"}</strong>
            </article>
          </section>
        </CardContent>
      </Card>

      {/* Este mes */}
      {lastMonth ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Este mes ({lastMonth.monthKey})</CardTitle>
              <p className="panel-caption">Capital nuevo aportado frente al previsto en el plan.</p>
            </div>
            {lastMonth.actualEur >= lastMonth.programmedEur ? (
              <span className="badge badge-success">Completado</span>
            ) : (
              <span className="badge badge-warning">
                Pendiente {formatMoney(lastMonth.programmedEur - lastMonth.actualEur)}
              </span>
            )}
          </CardHeader>
          <CardContent>
            <section className="investment-summary-grid" aria-label="Aportación del mes actual">
              <article className="investment-summary-tile">
                <span>Previsto</span>
                <strong>{formatMoney(lastMonth.programmedEur)}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Aportado</span>
                <strong>{formatMoney(lastMonth.actualEur)}</strong>
              </article>
              {lastMonth.extraEur > 0 ? (
                <article className="investment-summary-tile">
                  <span>Aportación extra</span>
                  <strong style={{ color: "var(--color-success-text)" }}>
                    +{formatMoney(lastMonth.extraEur)}
                  </strong>
                </article>
              ) : null}
              {lastMonth.programmedEur > lastMonth.actualEur ? (
                <article className="investment-summary-tile">
                  <span>Pendiente</span>
                  <strong style={{ color: "var(--color-danger)" }}>
                    {formatMoney(lastMonth.programmedEur - lastMonth.actualEur)}
                  </strong>
                </article>
              ) : null}
            </section>
          </CardContent>
        </Card>
      ) : null}

      {/* Reparto actual */}
      {currentAssets.length > 0 && currentCycle ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reparto actual</CardTitle>
              <p className="panel-caption">
                {currentCycle.name} · {formatMoney(currentCycle.monthlyAmountEur)}/mes · {currentAssets.length} monedas
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <section className="investment-summary-grid" aria-label="Distribución de la aportación mensual">
              {currentAssets.map((asset) => {
                const pct = asset.allocationPercentage ?? asset.allocationValue ?? 0;
                const eur = asset.fixedAmountEur ?? (currentCycle.monthlyAmountEur * pct) / 100;
                return (
                  <article key={asset.id} className="investment-summary-tile">
                    <span>{asset.assetId}</span>
                    <strong>
                      {formatMoney(eur)}/mes
                      <span style={{ fontSize: 11, fontWeight: "normal", marginLeft: 4, color: "var(--text-secondary)" }}>
                        {pct.toFixed(0)}%
                      </span>
                    </strong>
                  </article>
                );
              })}
            </section>
          </CardContent>
        </Card>
      ) : null}

      {/* Progreso acumulado */}
      {metrics ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Progreso</CardTitle>
              <p className="panel-caption">
                {metrics.monthsElapsed} {metrics.monthsElapsed === 1 ? "mes" : "meses"} transcurridos
                {metrics.percentComplete !== null ? ` · ${metrics.percentComplete.toFixed(0)}% completado` : ""}
              </p>
            </div>
            {metrics.contributionCompliancePercentage !== null ? (
              <span
                className={`badge ${
                  metrics.contributionCompliancePercentage >= 95
                    ? "badge-success"
                    : metrics.contributionCompliancePercentage >= 75
                    ? "badge-warning"
                    : "badge-danger"
                }`}
              >
                {metrics.contributionCompliancePercentage.toFixed(0)}% cumplimiento
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            <section className="investment-summary-grid" aria-label="Progreso acumulado del ciclo">
              <article className="investment-summary-tile">
                <span>Aportado</span>
                <strong>{formatMoney(metrics.actualContribution)}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Previsto acumulado</span>
                <strong>{formatMoney(metrics.expectedContributionToDate)}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Valor actual</span>
                <strong>
                  {metrics.hasPendingValuation && metrics.currentValueEur === 0
                    ? "Pendiente"
                    : formatMoney(metrics.currentValueEur)}
                </strong>
              </article>
              <article className="investment-summary-tile">
                <span>Resultado</span>
                <strong
                  style={{
                    color:
                      metrics.profitEur >= 0 ? "var(--color-success-text)" : "var(--color-danger)",
                  }}
                >
                  {metrics.profitEur >= 0 ? "+" : ""}
                  {formatMoney(metrics.profitEur)}
                  {metrics.roiPercentage !== null
                    ? ` (${metrics.roiPercentage >= 0 ? "+" : ""}${metrics.roiPercentage.toFixed(2)}%)`
                    : ""}
                </strong>
              </article>
              {metrics.extraContribution > 0 ? (
                <article className="investment-summary-tile">
                  <span>Aportaciones extra</span>
                  <strong>+{formatMoney(metrics.extraContribution)}</strong>
                </article>
              ) : null}
            </section>
          </CardContent>
        </Card>
      ) : null}

      {/* Alertas críticas si las hay */}
      {criticalAlerts.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Alertas que requieren atención</CardTitle>
              <p className="panel-caption">Revisa estas situaciones en Seguimiento.</p>
            </div>
            <span className="badge badge-danger">{criticalAlerts.length} crítica{criticalAlerts.length !== 1 ? "s" : ""}</span>
          </CardHeader>
          <CardContent>
            <div className="investment-contribution-list">
              {criticalAlerts.slice(0, 3).map((alert) => (
                <article key={alert.id} className="investment-contribution">
                  <div className="investment-contribution-header">
                    <strong>{alert.title}</strong>
                    <span className="badge badge-danger">Crítica</span>
                  </div>
                  <p className="investment-contribution-meta">{alert.message}</p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
