import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, TrendingDown, TrendingUp, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { Input } from "../../components/Input";
import type { PartialSaleRule, CycleRebuyTier, CycleStrategyReport, Result } from "@crypto-control/core";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function formatEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

const CONDITION_LABELS: Record<string, string> = {
  price_target: "Precio objetivo",
  cost_multiple: "Múltiplo del coste",
  gain_percentage: "% de subida",
  market_phase: "Fase de mercado",
  euphoria: "Euforia de mercado",
  combined: "Condición combinada",
};

const STATUS_BADGE: Record<string, string> = {
  borrador: "badge-secondary",
  activa: "badge-success",
  activada: "badge-warning",
  preparada: "badge-warning",
  ejecutada: "",
  pausada: "badge-secondary",
  cancelada: "",
};

const PROPOSAL_LABELS: Record<string, string> = {
  mantener: "Mantener",
  vigilar: "Vigilar",
  venta_parcial: "Venta parcial",
  recogida_beneficios: "Recoger beneficios",
};

const RISK_BADGE: Record<string, string> = {
  bajo: "badge-success",
  moderado: "badge-warning",
  alto: "badge-warning",
  muy_alto: "badge-error",
};

function AutomaticProposals({ report, loading }: { report: CycleStrategyReport | null; loading: boolean }) {
  const saleProposals = report?.partialSaleProposals ?? [];
  const rebuyProposals = report?.rebuyProposals ?? [];
  const actionableSales = saleProposals.filter((proposal) => proposal.type !== "mantener");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Propuestas automáticas</CardTitle>
        {report ? <span className="badge">{new Date(report.generatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span> : null}
      </CardHeader>
      <CardContent>
        <p className="panel-caption">
          Generadas con fase de mercado, sentimiento por activo, Fear & Greed, datos de mercado y señales públicas de medios/analistas cuando están disponibles. No ejecutan operaciones automáticamente.
        </p>

        {loading ? (
          <p className="empty-inline">Calculando propuestas…</p>
        ) : !report ? (
          <p className="empty-inline">No se pudieron calcular propuestas automáticas.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="investment-distribution">
              <span>Fase: <strong>{report.marketPhase.phase}</strong></span>
              <span>Confianza: <strong>{report.marketPhase.confidence}</strong></span>
              <span>Indicadores: <strong>{report.marketPhase.indicatorsUsed.length}</strong></span>
            </div>
            <p className="substitution-meta">{report.marketPhase.reasoning}</p>

            <section>
              <h3 className="plan-section-title" style={{ marginBottom: 8 }}>Ventas sugeridas</h3>
              {actionableSales.length === 0 ? (
                <p className="empty-inline">No hay ventas sugeridas ahora. Las posiciones se mantienen en observación.</p>
              ) : (
                <div className="substitution-list">
                  {actionableSales.map((proposal) => (
                    <article key={`${proposal.assetId}-${proposal.type}`} className="substitution-card">
                      <div className="substitution-card-header">
                        <span className="substitution-assets">
                          <strong>{proposal.assetId}</strong> — {PROPOSAL_LABELS[proposal.type] ?? proposal.type}
                        </span>
                        <span className={`badge ${RISK_BADGE[proposal.riskLevel] ?? ""}`}>{proposal.riskLevel}</span>
                      </div>
                      <p className="substitution-meta">
                        {proposal.percentageSuggested != null
                          ? `Sugerido: vender ${proposal.percentageSuggested}% y mantener ${Math.max(0, 100 - proposal.percentageSuggested).toFixed(2)}%`
                          : "Sin venta directa; vigilar"}
                        {proposal.estimatedProceedsEur != null ? ` · Estimado: ${formatEur(proposal.estimatedProceedsEur)}` : ""}
                      </p>
                      <p className="substitution-notes">{proposal.reason}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="plan-section-title" style={{ marginBottom: 8 }}>Recompras sugeridas</h3>
              {rebuyProposals.length === 0 ? (
                <p className="empty-inline">No hay recompras sugeridas con las señales actuales.</p>
              ) : (
                <div className="substitution-list">
                  {rebuyProposals.map((proposal, index) => (
                    <article key={`${proposal.assetId}-${proposal.triggerDropPercentage}-${index}`} className="substitution-card">
                      <div className="substitution-card-header">
                        <span className="substitution-assets">
                          <strong>{proposal.assetId}</strong> — Recompra en caída {proposal.triggerDropPercentage}%
                        </span>
                        <span className={`badge ${proposal.proposedAmountEur > 0 ? "badge-success" : "badge-warning"}`}>
                          {proposal.proposedAmountEur > 0 ? formatEur(proposal.proposedAmountEur) : "Pendiente de EURC"}
                        </span>
                      </div>
                      <p className="substitution-meta">
                        Liquidez libre: {formatEur(proposal.availableLiquidityEur)}
                        {" · "}Propuesta: {formatEur(proposal.proposedAmountEur)}
                        {" · "}Quedará: {formatEur(Math.max(0, proposal.availableLiquidityEur - proposal.proposedAmountEur))}
                      </p>
                      <p className="substitution-notes">{proposal.reason}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {report.riskSummary.length > 0 ? (
              <section>
                <h3 className="plan-section-title" style={{ marginBottom: 8 }}>Riesgos detectados</h3>
                <div className="substitution-list">
                  {report.riskSummary.map((item) => (
                    <article key={item} className="substitution-card">
                      <p className="substitution-notes">{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formulario nueva regla de venta ───────────────────────────────────────────

function NuevaReglaVentaForm({ cycleId, onSuccess }: { cycleId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [name, setName] = useState("");
  const [conditionType, setConditionType] = useState<string>("price_target");
  const [conditionValue, setConditionValue] = useState("");
  const [sellPercentage, setSellPercentage] = useState("25");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (d: Parameters<typeof window.cryptoControl.partialSaleRules.create>[0]) =>
      unwrap(window.cryptoControl.partialSaleRules.create(d)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partial-sale-rules", cycleId] });
      onSuccess();
      setOpen(false); setAssetId(""); setName(""); setConditionValue(""); setNotes(""); setError(null);
    },
  });

  const assetsQ = useQuery({ queryKey: ["investment-assets"], queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()) });
  const cycleAssets = (assetsQ.data ?? []).filter(a => a.cycleId === cycleId && a.status === "active");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!assetId) { setError("Selecciona el activo."); return; }
    if (!name.trim()) { setError("El nombre es obligatorio."); return; }
    const pct = parseFloat(sellPercentage.replace(",", "."));
    const val = conditionValue ? parseFloat(conditionValue.replace(",", ".")) : null;
    if (isNaN(pct) || pct <= 0 || pct >= 100) { setError("El porcentaje debe ser mayor que 0 y menor que 100 para mantener una posición residual."); return; }
    await create.mutateAsync({ cycleId, assetId, name: name.trim(), conditionType: conditionType as any, conditionValue: val, sellPercentage: pct, notes: notes || null });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PlusCircle size={14} /> Nueva regla de venta
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Nueva regla de venta parcial</CardTitle></CardHeader>
      <CardContent>
        <form className="investment-form-grid compact" onSubmit={(e) => void handleSubmit(e)}>
          {error && <p className="error-msg" style={{ gridColumn: "1/-1" }}>{error}</p>}
          <label className="form-group">
            <span>Activo *</span>
            <select className="ui-select" value={assetId} onChange={e => setAssetId(e.target.value)}>
              <option value="">— selecciona —</option>
              {cycleAssets.map(a => <option key={a.id} value={a.assetId}>{a.assetId}</option>)}
            </select>
          </label>
          <label className="form-group">
            <span>Nombre *</span>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Recogida de beneficios BTC" required />
          </label>
          <label className="form-group">
            <span>Condición</span>
            <select className="ui-select" value={conditionType} onChange={e => setConditionType(e.target.value)}>
              {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {conditionType !== "euphoria" && (
            <label className="form-group">
              <span>{conditionType === "cost_multiple" ? "Múltiplo (ej. 3)" : conditionType === "gain_percentage" ? "% de subida (ej. 100)" : "Valor objetivo (€)"}</span>
              <Input type="number" step="any" value={conditionValue} onChange={e => setConditionValue(e.target.value)} placeholder="Ej. 100000" />
            </label>
          )}
          <label className="form-group">
            <span>% a vender *</span>
            <Input type="number" step="0.01" min="0.01" max="99.99" value={sellPercentage} onChange={e => setSellPercentage(e.target.value)} />
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contexto de la regla" />
          </label>
          <p style={{ gridColumn: "1/-1", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            Esta regla no ejecuta ventas automáticamente. Solo calcula y propone cuando se cumple la condición.
          </p>
          <div style={{ display: "flex", gap: 8, gridColumn: "1/-1" }}>
            <Button type="submit" loading={create.isPending}>Guardar regla</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Regla de venta card ───────────────────────────────────────────────────────

function ReglaVentaCard({ rule, onDelete }: { rule: PartialSaleRule; onDelete: () => void }) {
  const evalQ = useQuery({
    queryKey: ["partial-sale-rules-eval", rule.cycleId, rule.id],
    queryFn: () => unwrap(window.cryptoControl.partialSaleRules.evaluate({ cycleId: rule.cycleId, assetId: rule.assetId })),
    staleTime: 30_000,
  });
  const evaluation = evalQ.data?.find(e => e.rule.id === rule.id);

  return (
    <article className="substitution-card">
      <div className="substitution-card-header">
        <span className="substitution-assets">
          <strong>{rule.assetId}</strong> — {rule.name}
        </span>
        <span className={`badge ${STATUS_BADGE[rule.status] ?? ""}`}>{rule.status}</span>
      </div>
      <p className="substitution-meta">
        {CONDITION_LABELS[rule.conditionType] ?? rule.conditionType}
        {rule.conditionValue != null ? ` — ${rule.conditionValue}` : ""}
        {" · "}Vender {rule.sellPercentage}% de la posición
      </p>

      {evaluation ? (
        evaluation.isTriggered ? (
          <div style={{ marginTop: 8, padding: 8, background: "var(--color-warning-bg, #fef3c7)", borderRadius: "var(--radius-control)" }}>
            <p style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--color-warning-text, #92400e)" }}>
              ⚡ Regla activada: {evaluation.triggeredReason}
            </p>
            {evaluation.preview && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6, fontSize: "0.78rem" }}>
                <span>Cantidad: {evaluation.preview.quantityToSell.toFixed(6)}</span>
                <span>Bruto: {formatEur(evaluation.preview.grossProceedsEur)}</span>
                <span>Plusvalía est.: {formatEur(evaluation.preview.estimatedGainEur)}</span>
                <span>Impuesto est.: {formatEur(evaluation.preview.estimatedTaxEur)}</span>
                <span>Reserva fiscal: {formatEur(evaluation.preview.fiscalReserveEur)}</span>
                <span>EURC neto: {formatEur(evaluation.preview.netEurcEur)}</span>
                <span>Queda: {evaluation.preview.remainingBalance.toFixed(6)}</span>
                <span>Permanece: {evaluation.preview.remainingPercentage.toFixed(2)}%</span>
              </div>
            )}
            <Button size="sm" style={{ marginTop: 8 }} onClick={() => alert("Preparar venta: funcionalidad en Operaciones")}>
              Preparar venta
            </Button>
          </div>
        ) : (
          <p className="substitution-meta" style={{ marginTop: 4 }}>
            Sin activar: {evaluation.notTriggeredReason}
          </p>
        )
      ) : evalQ.isLoading ? (
        <p className="substitution-meta">Evaluando…</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 size={12} /> Eliminar</Button>
      </div>
    </article>
  );
}

// ── Regla de recompra card ────────────────────────────────────────────────────

function NuevaTierRecompraForm({ cycleId, onSuccess }: { cycleId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [name, setName] = useState("");
  const [drawdown, setDrawdown] = useState("20");
  const [usage, setUsage] = useState("50");
  const [refType, setRefType] = useState("max_since_sale");
  const [refValue, setRefValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (d: Parameters<typeof window.cryptoControl.rebuyTiers.upsert>[0]) =>
      unwrap(window.cryptoControl.rebuyTiers.upsert(d)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["rebuy-tiers", cycleId] });
      onSuccess();
      setOpen(false); setAssetId(""); setName(""); setRefValue(""); setNotes(""); setError(null);
    },
  });

  const assetsQ = useQuery({ queryKey: ["investment-assets"], queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()) });
  const cycleAssets = (assetsQ.data ?? []).filter(a => a.cycleId === cycleId && a.status === "active");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!assetId) { setError("Selecciona el activo."); return; }
    const dd = parseFloat(drawdown.replace(",", "."));
    const u = parseFloat(usage.replace(",", "."));
    const rv = refValue ? parseFloat(refValue.replace(",", ".")) : null;
    if (isNaN(dd) || dd <= 0 || dd > 100) { setError("Caída entre 0 y 100."); return; }
    if (isNaN(u) || u <= 0 || u >= 100) { setError("El % de EURC debe ser mayor que 0 y menor que 100 para mantener liquidez residual."); return; }
    await create.mutateAsync({ cycleId, assetId, name: name || null, drawdownPercentage: dd, usagePercentage: u, referenceType: refType, referenceValue: rv, notes: notes || null });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PlusCircle size={14} /> Nuevo escalón de recompra
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Nuevo escalón de compra en caída</CardTitle></CardHeader>
      <CardContent>
        <form className="investment-form-grid compact" onSubmit={(e) => void handleSubmit(e)}>
          {error && <p className="error-msg" style={{ gridColumn: "1/-1" }}>{error}</p>}
          <label className="form-group">
            <span>Activo *</span>
            <select className="ui-select" value={assetId} onChange={e => setAssetId(e.target.value)}>
              <option value="">— selecciona —</option>
              {cycleAssets.map(a => <option key={a.id} value={a.assetId}>{a.assetId}</option>)}
            </select>
          </label>
          <label className="form-group">
            <span>Nombre</span>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Caída 20% BTC" />
          </label>
          <label className="form-group">
            <span>Caída necesaria (%) *</span>
            <Input type="number" step="0.1" min="1" max="99" value={drawdown} onChange={e => setDrawdown(e.target.value)} />
          </label>
          <label className="form-group">
            <span>% EURC a usar *</span>
            <Input type="number" step="0.1" min="0.1" max="99.9" value={usage} onChange={e => setUsage(e.target.value)} />
          </label>
          <label className="form-group">
            <span>Tipo de referencia</span>
            <select className="ui-select" value={refType} onChange={e => setRefType(e.target.value)}>
              <option value="max_since_sale">Máximo desde última venta</option>
              <option value="sale_price">Precio de venta</option>
              <option value="cycle_max">Máximo del ciclo</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label className="form-group">
            <span>Precio de referencia (€)</span>
            <Input type="number" step="any" value={refValue} onChange={e => setRefValue(e.target.value)} placeholder="Ej. 100000" />
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          <p style={{ gridColumn: "1/-1", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            Solo se despliega EURC generado por ventas anteriores. No usa el efectivo programado del DCA.
          </p>
          <div style={{ display: "flex", gap: 8, gridColumn: "1/-1" }}>
            <Button type="submit" loading={create.isPending}>Guardar escalón</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlanBeneficiosCaidas({ cycleId }: { cycleId: string }) {
  const qc = useQueryClient();

  const saleRulesQ = useQuery({
    queryKey: ["partial-sale-rules", cycleId],
    queryFn: () => unwrap(window.cryptoControl.partialSaleRules.list({ cycleId })),
    staleTime: 30_000,
  });

  const rebuyTiersQ = useQuery({
    queryKey: ["rebuy-tiers", cycleId],
    queryFn: () => unwrap(window.cryptoControl.rebuyTiers.list({ cycleId })),
    staleTime: 30_000,
  });

  const treasuryQ = useQuery({
    queryKey: ["treasury-summary"],
    queryFn: () => unwrap(window.cryptoControl.treasury.getSummary()),
    staleTime: 60_000,
  });

  const strategyReportQ = useQuery({
    queryKey: ["strategic-decisions", "cycle-report", cycleId],
    queryFn: () => unwrap(window.cryptoControl.strategicDecisions.getCycleReport({ cycleId })),
    staleTime: 5 * 60_000,
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.partialSaleRules.delete(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partial-sale-rules", cycleId] }),
  });

  const deleteTier = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.rebuyTiers.delete(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rebuy-tiers", cycleId] }),
  });

  const treasury = treasuryQ.data;
  const saleRules: PartialSaleRule[] = saleRulesQ.data ?? [];
  const rebuyTiers: CycleRebuyTier[] = rebuyTiersQ.data ?? [];
  const strategyReport: CycleStrategyReport | null = strategyReportQ.data ?? null;

  const eurcAvailable = treasury ? Math.max(0, treasury.eurcBalance - treasury.fiscalReserveBalance) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Estado actual ── */}
      <Card>
        <CardHeader><CardTitle>Estado actual</CardTitle></CardHeader>
        <CardContent>
          <div className="plan-metrics-grid">
            <div className="plan-metric-card">
              <p className="plan-metric-label">EURC disponible</p>
              <p className="plan-metric-value">{formatEur(eurcAvailable)}</p>
              <p className="plan-metric-sub">Libre de reserva fiscal</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">Reserva fiscal</p>
              <p className="plan-metric-value">{formatEur(treasury?.fiscalReserveBalance)}</p>
              <p className="plan-metric-sub">Bloqueada — no disponible</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">Reglas de venta</p>
              <p className="plan-metric-value">{saleRules.filter(r => r.status === "activa").length}</p>
              <p className="plan-metric-sub">Activas</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">Escalones de recompra</p>
              <p className="plan-metric-value">{rebuyTiers.length}</p>
              <p className="plan-metric-sub">Configurados</p>
            </div>
          </div>
          {eurcAvailable !== null && eurcAvailable <= 0 && (
            <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              Sin liquidez EURC disponible para compras en caídas. Ejecuta una venta parcial primero para generar EURC.
            </p>
          )}
        </CardContent>
      </Card>

      <AutomaticProposals report={strategyReport} loading={strategyReportQ.isLoading} />

      {/* ── Reglas de venta parcial ── */}
      <Card>
        <CardHeader>
          <CardTitle><TrendingUp size={16} style={{ display: "inline", marginRight: 6 }} />Reglas de recogida de beneficios</CardTitle>
          {saleRules.length > 0 && <span className="badge">{saleRules.length}</span>}
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", marginBottom: 12 }}>
            Las reglas evalúan condiciones reales. Cuando se cumplen, proponen una venta parcial. Ninguna venta se ejecuta automáticamente.
          </p>

          <div className="substitution-list">
            {saleRules.length === 0 ? (
              <p className="empty-inline">Sin reglas configuradas. Crea una para empezar a proteger beneficios.</p>
            ) : (
              saleRules.map(rule => (
                <ReglaVentaCard
                  key={rule.id}
                  rule={rule}
                  onDelete={() => deleteRule.mutate(rule.id)}
                />
              ))
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <NuevaReglaVentaForm cycleId={cycleId} onSuccess={() => {}} />
          </div>
        </CardContent>
      </Card>

      {/* ── Escalones de recompra ── */}
      <Card>
        <CardHeader>
          <CardTitle><TrendingDown size={16} style={{ display: "inline", marginRight: 6 }} />Compras en caídas</CardTitle>
          {rebuyTiers.length > 0 && <span className="badge">{rebuyTiers.length}</span>}
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", marginBottom: 12 }}>
            Solo se despliega EURC generado por ventas anteriores. La reserva fiscal siempre queda excluida.
            {eurcAvailable !== null && eurcAvailable > 0 && (
              <> EURC disponible: <strong>{formatEur(eurcAvailable)}</strong></>
            )}
          </p>

          <div className="substitution-list">
            {rebuyTiers.length === 0 ? (
              <p className="empty-inline">Sin escalones configurados. Crea uno cuando tengas EURC disponible.</p>
            ) : (
              rebuyTiers
                .slice()
                .sort((a, b) => (a.drawdownPercentage ?? 0) - (b.drawdownPercentage ?? 0))
                .map(tier => (
                  <article key={tier.id} className="substitution-card">
                    <div className="substitution-card-header">
                      <span className="substitution-assets">
                        {tier.assetId ? <strong>{tier.assetId}</strong> : "Todos"} — {tier.name ?? `Caída ${tier.drawdownPercentage}%`}
                      </span>
                      <span className={`badge ${tier.status === "activa" ? "badge-success" : "badge-secondary"}`}>
                        {tier.status ?? "activa"}
                      </span>
                    </div>
                    <p className="substitution-meta">
                      Caída ≥ {tier.drawdownPercentage}% → usar {tier.usagePercentage}% del EURC libre y mantener {Math.max(0, 100 - tier.usagePercentage).toFixed(2)}%
                      {tier.referenceType ? ` · Ref: ${tier.referenceType}` : ""}
                      {tier.referenceValue != null ? ` (${formatEur(tier.referenceValue)})` : ""}
                    </p>
                    {tier.notes && <p className="substitution-notes">{tier.notes}</p>}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => deleteTier.mutate(tier.id)}>
                        <Trash2 size={12} /> Eliminar
                      </Button>
                    </div>
                  </article>
                ))
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <NuevaTierRecompraForm cycleId={cycleId} onSuccess={() => {}} />
          </div>
        </CardContent>
      </Card>

      {/* ── Historial ── */}
      <Card>
        <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
        <CardContent>
          <p className="empty-inline">
            Las ventas ejecutadas aparecen en Operaciones. Las propuestas preparadas se envían a Operaciones para confirmación.
          </p>
        </CardContent>
      </Card>

    </div>
  );
}
