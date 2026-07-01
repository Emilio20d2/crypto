import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, Filter, ListChecks, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { FormField } from "../components/FormField";
import { Input } from "../components/Input";
import { LoadingState } from "../components/LoadingState";
import { OperationDetail, OperationList } from "../components/OperationPanels";
import { PageToolbar } from "../components/PageToolbar";
import { Select } from "../components/Select";
import { costLevelLabel, moneyValue, operationLabel, routeLabel, stringAmount } from "../lib/coinbaseOperations";
import { formatDateTime, formatMoney } from "../lib/format";

type OperationType = "buy" | "sell" | "convert" | "rebuy";
type OperationMode = "simulation" | "real";
type OperationsTab = "new" | "smart-buy" | "smart-sell" | "rebuy" | "policies" | "scheduled" | "pending" | "history";
type OperationPayload = {
  operationType: OperationType;
  mode: OperationMode;
  assetId?: string;
  fromAssetId?: string;
  toAssetId?: string;
  quoteAmountEur?: number;
  quoteAmount?: number;
  baseAmount?: number;
};
type CoinbaseOperationsApi = typeof window.cryptoControl.coinbase & {
  listPendingOrders: () => Promise<any>;
  listScheduledOperations: () => Promise<any>;
  previewOrder: (input: OperationPayload) => Promise<any>;
  submitOrder: (input: OperationPayload & { previewToken?: string | null; previewId?: string | null; confirmationText: string }) => Promise<any>;
  createScheduledOperation: (input: OperationPayload & { plannedAt: number | null; frequency: string; maxExecutions: number | null }) => Promise<any>;
  deleteScheduledOperation: (id: string) => Promise<any>;
};

const OPERATION_TABS: Array<{ id: OperationsTab; label: string }> = [
  { id: "new", label: "Nueva operación" },
  { id: "smart-buy", label: "Compra Inteligente" },
  { id: "smart-sell", label: "Venta Inteligente" },
  { id: "rebuy", label: "Recompras" },
  { id: "policies", label: "Políticas" },
  { id: "scheduled", label: "Operaciones programadas" },
  { id: "pending", label: "Órdenes pendientes" },
  { id: "history", label: "Historial" },
];

const SMART_BUY_MODES = [
  { value: "plan", label: "Cumplir el Plan" },
  { value: "oportunidad", label: "Aprovechar oportunidades" },
  { value: "mixto", label: "Mixto" },
  { value: "potencial", label: "Potencial medio/largo plazo" },
] as const;

function parsePositive(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function coinbaseOperationsApi(): CoinbaseOperationsApi {
  return window.cryptoControl.coinbase as unknown as CoinbaseOperationsApi;
}

function automationApi() {
  if (!window.cryptoControl.automation) throw new Error("La API de automatización no está disponible.");
  return window.cryptoControl.automation;
}

function badgeForCost(level: string | null | undefined): string {
  if (level === "bajo") return "badge-success";
  if (level === "moderado") return "badge-warning";
  return "badge-error";
}

function getPreviewTotals(preview: any) {
  const firstStep = preview?.route?.[0];
  const lastStep = preview?.route?.[preview.route.length - 1];
  const firstPreview = firstStep?.preview ?? preview;
  const lastPreview = lastStep?.preview ?? preview;
  return {
    total: moneyValue(lastPreview.order_total),
    commission: preview?.costAnalysis?.commission ?? moneyValue(lastPreview.commission_total),
    baseSize: stringAmount(lastPreview.base_size),
    price: lastPreview.est_average_filled_price ?? firstPreview.est_average_filled_price ?? null,
  };
}

function selectedCycleId(cycles: any[]): string {
  const active = cycles.find((cycle) => cycle.status === "active") ?? cycles[0];
  return active?.id ?? "";
}

export function Operaciones() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const preparedFromSmartBuy = searchParams.get("source") === "smart-buy";
  const preparedFromPlanSell = searchParams.get("source") === "plan-sell";
  const preparedType = searchParams.get("type") as OperationType | null;
  const preparedAsset = searchParams.get("asset")?.toUpperCase() ?? "BTC";
  const preparedAmount = searchParams.get("quoteAmount") ?? "100";
  const preparedBaseAmount = searchParams.get("baseAmount") ?? "";

  const [activeTab, setActiveTab] = useState<OperationsTab>("new");
  const [operationType, setOperationType] = useState<OperationType>(preparedType ?? "buy");
  const [mode, setMode] = useState<OperationMode>(preparedFromSmartBuy ? "real" : "simulation");
  const [assetId, setAssetId] = useState(preparedAsset);
  const [fromAssetId, setFromAssetId] = useState("BTC");
  const [toAssetId, setToAssetId] = useState("ETH");
  const [quoteAmount, setQuoteAmount] = useState(preparedAmount);
  const [baseAmount, setBaseAmount] = useState(preparedFromPlanSell ? preparedBaseAmount : "");
  const [plannedAt, setPlannedAt] = useState("");
  const [frequency, setFrequency] = useState("una_vez");
  const [maxExecutions, setMaxExecutions] = useState("1");
  const [condicionType, setCondicionType] = useState<"none" | "price_lte" | "price_gte">("none");
  const [condicionValue, setCondicionValue] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [operationError, setOperationError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const [smartAmount, setSmartAmount] = useState("100");
  const [smartMode, setSmartMode] = useState<(typeof SMART_BUY_MODES)[number]["value"]>("plan");
  const [smartResult, setSmartResult] = useState<any | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState("");
  const [policyKind, setPolicyKind] = useState<"BULL_PARTIAL_SALE" | "BEAR_REBUY">("BULL_PARTIAL_SALE");
  const [policyAssetId, setPolicyAssetId] = useState(preparedAsset);
  const [policyMaxOperation, setPolicyMaxOperation] = useState("100");
  const [policySaving, setPolicySaving] = useState(false);
  const [policyRunning, setPolicyRunning] = useState(false);

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: cyclesRes } = useQuery({
    queryKey: ["investmentCycles"],
    queryFn: () => window.cryptoControl.investmentCycles.list(),
  });

  const { data: treasuryRes } = useQuery({
    queryKey: ["treasury-summary"],
    queryFn: () => window.cryptoControl.treasury.getSummary(),
  });

  const { data: coinbaseStatusRes } = useQuery({
    queryKey: ["coinbase", "status"],
    queryFn: () => window.cryptoControl.coinbase.getStatus(),
  });

  const { data: scheduledRes, refetch: refetchScheduled } = useQuery({
    queryKey: ["coinbase", "scheduled-operations"],
    queryFn: () => coinbaseOperationsApi().listScheduledOperations(),
  });

  const { data: pendingRes, refetch: refetchPending } = useQuery({
    queryKey: ["coinbase", "pending-orders"],
    queryFn: () => coinbaseOperationsApi().listPendingOrders(),
  });

  const { data: automationStatusRes, refetch: refetchAutomationStatus } = useQuery({
    queryKey: ["automation", "status"],
    queryFn: () => automationApi().getStatus(),
  });

  const { data: automationPoliciesRes, refetch: refetchAutomationPolicies } = useQuery({
    queryKey: ["automation", "policies"],
    queryFn: () => automationApi().listPolicies(),
  });

  const { data: automationRunsRes, refetch: refetchAutomationRuns } = useQuery({
    queryKey: ["automation", "runs"],
    queryFn: () => automationApi().listRuns({ limit: 50 }),
  });

  const { data: txsRes, isLoading: loadingTxs } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list(),
  });

  const assets = assetsRes?.ok ? assetsRes.data : [];
  const cryptoAssets = assets.filter((asset: any) => asset.type !== "fiat");
  const cycles = cyclesRes?.ok ? cyclesRes.data : [];
  const cycleId = selectedCycleId(cycles);
  const treasury = treasuryRes?.ok ? treasuryRes.data : null;
  const coinbaseStatus = coinbaseStatusRes?.ok ? coinbaseStatusRes.data : null;
  const scheduledOperations = scheduledRes?.ok ? scheduledRes.data : [];
  const pendingOrders = pendingRes?.ok ? pendingRes.data : [];
  const automationStatus = automationStatusRes?.ok ? automationStatusRes.data : null;
  const automationPolicies = automationPoliciesRes?.ok ? automationPoliciesRes.data : [];
  const automationRuns = automationRunsRes?.ok ? automationRunsRes.data : [];
  const transactions = useMemo(() => txsRes?.ok ? txsRes.data : [], [txsRes]);
  const filteredTransactions = useMemo(() => {
    const coinbaseTransactions = transactions.filter((tx: any) => typeof tx.externalId === "string" && tx.externalId.length > 0);
    const sorted = [...coinbaseTransactions].sort((a: any, b: any) => b.date - a.date);
    return typeFilter === "all" ? sorted : sorted.filter((tx: any) => tx.type === typeFilter);
  }, [transactions, typeFilter]);
  const selectedTx = filteredTransactions.find((tx: any) => tx.id === selectedTxId) || filteredTransactions[0];

  const payload = (): OperationPayload => {
    const base = { operationType, mode, assetId, fromAssetId, toAssetId };
    if (operationType === "buy") {
      const amount = parsePositive(quoteAmount);
      if (!amount) throw new Error("Introduce un importe EUR válido.");
      return { ...base, assetId, quoteAmountEur: amount };
    }
    if (operationType === "rebuy") {
      const amount = parsePositive(quoteAmount);
      if (!amount) throw new Error("Introduce un importe EURC libre válido.");
      return { ...base, assetId, quoteAmount: amount };
    }
    const amount = parsePositive(baseAmount);
    if (!amount) throw new Error("Introduce una cantidad válida.");
    if (operationType === "sell") return { ...base, assetId: fromAssetId, fromAssetId, baseAmount: amount };
    return { ...base, fromAssetId, toAssetId, baseAmount: amount };
  };

  const requestPreview = async () => {
    setPreviewLoading(true);
    setOperationError("");
    setSuccessMsg("");
    setPreview(null);
    setConfirmationText("");
    try {
      const result = await coinbaseOperationsApi().previewOrder(payload());
      if (!result.ok) {
        setOperationError(result.error.message);
        return;
      }
      setPreview(result.data);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "No se pudo obtener preview de Coinbase");
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitOrder = async () => {
    if (!preview) return;
    setOperationError("");
    if (mode === "simulation" || preview.mode === "simulation") {
      setSuccessMsg("Simulación completada. No se envió ninguna orden a Coinbase.");
      setPreview(null);
      setConfirmationText("");
      return;
    }
    setOrderLoading(true);
    try {
      const result = await coinbaseOperationsApi().submitOrder({
        ...payload(),
        previewToken: preview.token,
        previewId: preview.route?.[0]?.preview?.preview_id ?? preview.preview_id ?? null,
        confirmationText,
      });
      if (!result.ok) {
        setOperationError(result.error.message);
        return;
      }
      setSuccessMsg("Orden enviada a Coinbase. Sincronización iniciada en segundo plano.");
      setPreview(null);
      setConfirmationText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["coinbase"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury-summary"] }),
      ]);
      void refetchPending();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "No se pudo enviar la orden");
    } finally {
      setOrderLoading(false);
    }
  };

  const scheduleOperation = async () => {
    setOperationError("");
    try {
      const condicion = condicionType !== "none" && condicionValue
        ? { type: condicionType, assetId: assetId, value: parseFloat(condicionValue) }
        : undefined;
      const result = await coinbaseOperationsApi().createScheduledOperation({
        ...payload(),
        plannedAt: plannedAt ? new Date(plannedAt).getTime() : null,
        frequency,
        maxExecutions: parsePositive(maxExecutions),
        condicion,
      } as any);
      if (!result.ok) {
        setOperationError(result.error.message);
        return;
      }
      setSuccessMsg("Operación programada para revisar. No se ejecutará sin nuevo preview y confirmación.");
      await refetchScheduled();
      setActiveTab("scheduled");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "No se pudo programar la operación");
    }
  };

  const runSmartBuy = async () => {
    if (!cycleId) {
      setSmartError("No hay ciclo activo para Compra Inteligente.");
      return;
    }
    const amount = parsePositive(smartAmount);
    if (!amount) {
      setSmartError("Introduce un importe EUR válido.");
      return;
    }
    setSmartLoading(true);
    setSmartError("");
    setSmartResult(null);
    const result = await window.cryptoControl.smartBuy.getRecommendation({
      cycleId,
      amount,
      mode: smartMode,
      originType: "cash",
    });
    setSmartLoading(false);
    if (!result.ok) {
      setSmartError(result.error.message);
      return;
    }
    setSmartResult(result.data);
  };

  const saveAutomationPolicy = async () => {
    const amount = parsePositive(policyMaxOperation);
    if (!amount) {
      setOperationError("Introduce un límite por operación válido.");
      return;
    }
    setPolicySaving(true);
    setOperationError("");
    setSuccessMsg("");
    const now = Date.now();
    const result = await automationApi().upsertPolicy({
      label: `${policyKind === "BULL_PARTIAL_SALE" ? "Venta parcial" : "Recompra"} ${policyAssetId}`,
      policy: {
        kind: policyKind,
        assetId: policyAssetId,
        cycleId: cycleId || null,
        planId: null,
        goalId: null,
        enabled: true,
        simulationOnly: true,
        startsAt: now,
        cooldownHours: 24,
        maxExecutions: 1,
        minConfidence: 70,
        minIndependentSources: 1,
        requireCompleteData: true,
        maxMarketDataAgeMinutes: 120,
        maxOperationEur: amount,
        authorization: {
          enabled: true,
          autoExecute: false,
          authorizedAt: now,
          expiresAt: now + 7 * 24 * 60 * 60_000,
          authorizationVersion: "ui-simulation-v1",
          maxSingleOperationEur: amount,
          maxDailyOperations: 1,
          maxDailyNotionalEur: amount,
        },
        bull: policyKind === "BULL_PARTIAL_SALE" ? {
          allowedRegimes: ["BULL_EXPANSION", "EUPHORIA", "DISTRIBUTION"],
          minimumUnrealizedGainPct: 25,
          minimumSentimentScore: 65,
          sellPercentage: 10,
          minimumResidualPositionPct: 60,
        } : undefined,
        bear: policyKind === "BEAR_REBUY" ? {
          allowedRegimes: ["CORRECTION", "BEAR_MARKET", "CAPITULATION", "EARLY_RECOVERY"],
          minimumDrawdownPct: 15,
          maximumSentimentScore: 45,
          rebuyPercentageOfFreeEurc: 25,
          minimumStabilizationScore: 50,
        } : undefined,
      },
    });
    setPolicySaving(false);
    if (!result.ok) {
      setOperationError(result.error.message);
      return;
    }
    setSuccessMsg("Política guardada en modo simulación. La automatización real sigue desactivada.");
    await Promise.all([refetchAutomationPolicies(), refetchAutomationRuns(), refetchAutomationStatus()]);
  };

  const runAutomationNow = async () => {
    setPolicyRunning(true);
    setOperationError("");
    const result = await automationApi().runOnce();
    setPolicyRunning(false);
    if (!result.ok) {
      setOperationError(result.error.message);
      return;
    }
    setSuccessMsg("Evaluación manual completada.");
    await Promise.all([refetchAutomationPolicies(), refetchAutomationRuns(), refetchAutomationStatus()]);
  };

  const prepareFromSmartBuy = (recommendation: any) => {
    setOperationType("buy");
    setMode("real");
    setAssetId(recommendation.assetId);
    setQuoteAmount(String(recommendation.recommendedAmountEur));
    setPreview(null);
    setActiveTab("new");
  };

  const totals = preview ? getPreviewTotals(preview) : null;

  return (
    <section className="page-stack operations-page">
      <PageToolbar
        title="Operaciones"
        meta="Compra, venta, conversión y recompra con preview y confirmación"
        actions={
          <div className="filter-control">
            <Filter size={15} />
            <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">Todos los tipos</option>
              <option value="buy">Compra</option>
              <option value="sell">Venta</option>
              <option value="convert">Conversión</option>
              <option value="transfer_in">Entrada</option>
              <option value="transfer_out">Salida</option>
              <option value="reward">Recompensa</option>
              <option value="staking">Staking</option>
              <option value="airdrop">Airdrop</option>
              <option value="fee">Comisión</option>
              <option value="adjustment">Ajuste</option>
            </Select>
          </div>
        }
      />

      <div className="operations-tabs" role="tablist" aria-label="Secciones de Operaciones">
        {OPERATION_TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {successMsg ? <div className="banner banner-success">{successMsg}</div> : null}
      {operationError ? <div className="banner banner-error">{operationError}</div> : null}

      <div className="operations-layout">
        <div className="operation-form-panel">
          {activeTab === "new" ? (
            <Card>
              <CardHeader>
                <CardTitle>Nueva operación</CardTitle>
                <span className={coinbaseStatus?.permissions?.canTrade ? "badge badge-success" : "badge badge-warning"}>
                  {mode === "simulation" ? "Simulación" : coinbaseStatus?.permissions?.canTrade ? "Trading habilitado" : "Trading no verificado"}
                </span>
              </CardHeader>
              <CardContent>
                <div className="investment-distribution">
                  <span>EUR disponible: <strong>{formatMoney(treasury?.cashBalance)}</strong></span>
                  <span>EURC total: <strong>{formatMoney(treasury?.eurcBalance)}</strong></span>
                  <span>EURC libre: <strong>{formatMoney(treasury?.freeRebuyLiquidity)}</strong></span>
                  <span>EURC fiscal: <strong>{formatMoney(treasury?.fiscalReserveBalance)}</strong></span>
                </div>

                <form className="investment-form-grid compact" onSubmit={(event) => { event.preventDefault(); void requestPreview(); }}>
                  <FormField label="Modo">
                    <Select value={mode} onChange={(event) => { setMode(event.target.value as OperationMode); setPreview(null); }}>
                      <option value="simulation">Simulación</option>
                      <option value="real">Operación real</option>
                    </Select>
                  </FormField>
                  <FormField label="Tipo">
                    <Select value={operationType} onChange={(event) => { setOperationType(event.target.value as OperationType); setPreview(null); }}>
                      <option value="buy">Compra</option>
                      <option value="sell">Venta</option>
                      <option value="convert">Conversión</option>
                      <option value="rebuy">Recompra</option>
                    </Select>
                  </FormField>

                  {(operationType === "buy" || operationType === "rebuy") ? (
                    <>
                      <FormField label="Activo">
                        <Select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                          {cryptoAssets.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.symbol ?? asset.id}</option>)}
                        </Select>
                      </FormField>
                      <FormField label={operationType === "rebuy" ? "Importe EURC libre" : "Importe EUR"}>
                        <Input inputMode="decimal" value={quoteAmount} onChange={(event) => setQuoteAmount(event.target.value)} />
                      </FormField>
                    </>
                  ) : operationType === "sell" ? (
                    <>
                      <FormField label="Activo a vender">
                        <Select value={fromAssetId} onChange={(event) => setFromAssetId(event.target.value)}>
                          {cryptoAssets.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.symbol ?? asset.id}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="Cantidad">
                        <Input inputMode="decimal" value={baseAmount} onChange={(event) => setBaseAmount(event.target.value)} />
                      </FormField>
                    </>
                  ) : (
                    <>
                      <FormField label="Activo origen">
                        <Select value={fromAssetId} onChange={(event) => setFromAssetId(event.target.value)}>
                          {cryptoAssets.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.symbol ?? asset.id}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="Activo destino">
                        <Select value={toAssetId} onChange={(event) => setToAssetId(event.target.value)}>
                          {cryptoAssets.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.symbol ?? asset.id}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="Cantidad origen">
                        <Input inputMode="decimal" value={baseAmount} onChange={(event) => setBaseAmount(event.target.value)} />
                      </FormField>
                    </>
                  )}

                  <div className="investment-wide operation-funds-rule">
                    {operationType === "buy" && <span>Origen de fondos: <strong>EUR</strong>. Las compras ordinarias no usan EURC.</span>}
                    {operationType === "rebuy" && <span>Origen de fondos: <strong>EURC libre</strong>. La reserva fiscal queda bloqueada.</span>}
                    {operationType === "sell" && <span>Destino preferente: <strong>EURC</strong>. Si Coinbase no permite ruta directa, se previsualiza ruta multipaso.</span>}
                    {operationType === "convert" && <span>Conversión cripto a cripto. EURC no se usa como intermedio ordinario.</span>}
                  </div>

                  <FormField label="Revisión programada">
                    <Input type="datetime-local" value={plannedAt} onChange={(event) => setPlannedAt(event.target.value)} />
                  </FormField>
                  <FormField label="Condición de precio">
                    <Select value={condicionType} onChange={(event) => setCondicionType(event.target.value as "none" | "price_lte" | "price_gte")}>
                      <option value="none">Sin condición (solo fecha)</option>
                      <option value="price_lte">Precio ≤ valor (caída)</option>
                      <option value="price_gte">Precio ≥ valor (subida)</option>
                    </Select>
                  </FormField>
                  {condicionType !== "none" && (
                    <FormField label={`Precio objetivo (EUR) para ${assetId}`}>
                      <Input type="number" step="any" min="0" value={condicionValue} onChange={(event) => setCondicionValue(event.target.value)} placeholder="Ej. 80000" />
                    </FormField>
                  )}
                  <FormField label="Frecuencia">
                    <Select value={frequency} onChange={(event) => setFrequency(event.target.value)}>
                      <option value="una_vez">Una vez</option>
                      <option value="diaria">Diaria</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensual">Mensual</option>
                    </Select>
                  </FormField>
                  <FormField label="Revisiones máximas">
                    <Input inputMode="numeric" value={maxExecutions} onChange={(event) => setMaxExecutions(event.target.value)} />
                  </FormField>

                  <div className="investment-form-actions investment-wide">
                    <Button type="submit" loading={previewLoading}><ShieldCheck size={15} /> Revisar operación</Button>
                    <Button type="button" variant="ghost" onClick={() => void scheduleOperation()}><CalendarClock size={15} /> Programar para revisar</Button>
                  </div>
                </form>

                {preview ? (
                  <div className="operation-preview">
                    <div className="operation-preview-header">
                      <div>
                        <strong>{operationLabel(preview.operationType)} · {routeLabel(preview.routeType)}</strong>
                        <span>{preview.fundingSource} → {preview.destinationAsset}</span>
                      </div>
                      <span className={`badge ${badgeForCost(preview.costAnalysis?.level)}`}>{costLevelLabel(preview.costAnalysis?.level)}</span>
                    </div>

                    {mode === "simulation" ? <div className="banner banner-warning">SIMULACIÓN — NO SE ENVIARÁ NINGUNA ORDEN A COINBASE</div> : null}
                    {preview.warnings?.map((warning: string) => <div className="banner banner-warning" key={warning}>{warning}</div>)}

                    <div className="investment-distribution">
                      <span>Total estimado: <strong>{formatMoney(totals?.total)}</strong></span>
                      <span>Comisión: <strong>{formatMoney(totals?.commission)}</strong></span>
                      <span>Cantidad estimada: <strong>{totals?.baseSize ?? "Pendiente"}</strong></span>
                      <span>Precio medio: <strong>{totals?.price ?? "Pendiente"}</strong></span>
                    </div>

                    <div className="operation-route-list">
                      {preview.route?.map((step: any) => (
                        <article key={step.id} className="operation-route-step">
                          <strong>{step.label}</strong>
                          <span>{step.productId} · {step.side}</span>
                          <span>Preview ID: {step.preview?.preview_id ?? "simulación"}</span>
                        </article>
                      ))}
                    </div>

                    <p className="substitution-notes">{preview.costAnalysis?.message}</p>
                    <p className="substitution-notes">Esta operación se enviará a Coinbase y utilizará fondos reales.</p>
                    <FormField label="Confirmación explícita" htmlFor="coinbase-confirmation">
                      <Input id="coinbase-confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder="Escribe CONFIRMAR" />
                    </FormField>
                    <Button type="button" variant="primary" fullWidth loading={orderLoading} disabled={mode === "real" && confirmationText !== "CONFIRMAR"} onClick={() => void submitOrder()}>
                      Confirmar y enviar a Coinbase
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : activeTab === "smart-buy" ? (
            <Card>
              <CardHeader><CardTitle>Compra Inteligente</CardTitle></CardHeader>
              <CardContent>
                <p className="panel-caption">Recomienda compras con EUR. No utiliza EURC y no ejecuta automáticamente.</p>
                <div className="investment-form-grid compact">
                  <FormField label="Importe EUR">
                    <Input inputMode="decimal" value={smartAmount} onChange={(event) => setSmartAmount(event.target.value)} />
                  </FormField>
                  <FormField label="Modo">
                    <Select value={smartMode} onChange={(event) => setSmartMode(event.target.value as typeof smartMode)}>
                      {SMART_BUY_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </Select>
                  </FormField>
                  <div className="investment-form-actions">
                    <Button type="button" loading={smartLoading} onClick={() => void runSmartBuy()}><RefreshCw size={15} /> Analizar</Button>
                  </div>
                </div>
                {smartError ? <div className="banner banner-error">{smartError}</div> : null}
                {smartResult ? (
                  <div className="investment-contribution-list">
                    {smartResult.recommendations.map((rec: any) => (
                      <article key={rec.assetId} className="investment-contribution">
                        <div className="investment-contribution-header">
                          <div>
                            <strong>{rec.assetId}</strong>
                            <span>{formatMoney(rec.recommendedAmountEur)} · {rec.recommendedPercentage}% del importe · Origen EUR</span>
                          </div>
                          <span className="badge">{rec.confidenceLevel}</span>
                        </div>
                        <p className="investment-contribution-meta">{rec.reason}</p>
                        <Button type="button" size="sm" disabled={rec.recommendedAmountEur <= 0} onClick={() => prepareFromSmartBuy(rec)}>
                          Preparar compra
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : activeTab === "smart-sell" ? (
            <SmartRulesPanel cycleId={cycleId} onPrepare={(asset, amount) => { setOperationType("sell"); setMode("real"); setFromAssetId(asset); setBaseAmount(String(amount)); setActiveTab("new"); }} />
          ) : activeTab === "rebuy" ? (
            <RebuyRulesPanel cycleId={cycleId} onPrepare={(asset, amount) => { setOperationType("rebuy"); setMode("real"); setAssetId(asset); setQuoteAmount(String(amount)); setActiveTab("new"); }} />
          ) : activeTab === "policies" ? (
            <Card>
              <CardHeader>
                <CardTitle><ShieldCheck size={16} /> Políticas de automatización</CardTitle>
                <span className="badge badge-warning">Real desactivado</span>
              </CardHeader>
              <CardContent>
                <div className="banner banner-warning">{automationStatus?.realAutomationBlocker ?? "La automatización real permanece bloqueada."}</div>
                <div className="investment-distribution">
                  <span>Modo: <strong>{automationStatus?.mode ?? "simulation_guarded"}</strong></span>
                  <span>Última evaluación: <strong>{automationStatus?.lastRunAt ? formatDateTime(automationStatus.lastRunAt) : "Sin ejecutar"}</strong></span>
                  <span>Próxima evaluación: <strong>{automationStatus?.nextRunAt ? formatDateTime(automationStatus.nextRunAt) : "Pendiente"}</strong></span>
                </div>

                <form className="investment-form-grid compact" onSubmit={(event) => { event.preventDefault(); void saveAutomationPolicy(); }}>
                  <FormField label="Tipo de política">
                    <Select value={policyKind} onChange={(event) => setPolicyKind(event.target.value as typeof policyKind)}>
                      <option value="BULL_PARTIAL_SALE">Venta parcial alcista</option>
                      <option value="BEAR_REBUY">Recompra bajista</option>
                    </Select>
                  </FormField>
                  <FormField label="Activo">
                    <Select value={policyAssetId} onChange={(event) => setPolicyAssetId(event.target.value)}>
                      {cryptoAssets.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.symbol ?? asset.id}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Límite por operación">
                    <Input inputMode="decimal" value={policyMaxOperation} onChange={(event) => setPolicyMaxOperation(event.target.value)} />
                  </FormField>
                  <div className="investment-form-actions">
                    <Button type="submit" loading={policySaving}><ShieldCheck size={15} /> Guardar política</Button>
                    <Button type="button" variant="secondary" loading={policyRunning} onClick={() => void runAutomationNow()}><RefreshCw size={15} /> Evaluar ahora</Button>
                  </div>
                </form>

                {automationPolicies.length === 0 ? <EmptyState icon={<ClipboardList size={40} />} title="Sin políticas" description="Crea una política en modo simulación para auditar sus condiciones." /> : (
                  <div className="investment-contribution-list">
                    {automationPolicies.map((item: any) => (
                      <article key={item.id} className="investment-contribution">
                        <div className="investment-contribution-header">
                          <div>
                            <strong>{item.label}</strong>
                            <span>{item.policy?.assetId} · {item.policy?.kind === "BULL_PARTIAL_SALE" ? "Venta parcial" : "Recompra"} · {item.policy?.simulationOnly ? "Simulación" : "Real bloqueado"}</span>
                          </div>
                          <span className={item.enabled ? "badge badge-success" : "badge badge-warning"}>{item.enabled ? "Activa" : "Pausada"}</span>
                        </div>
                        <p className="investment-contribution-meta">Ejecuciones: {item.policy?.executionCount ?? 0} · Límite: {formatMoney(item.policy?.maxOperationEur)}</p>
                        <Button type="button" size="sm" variant="secondary" onClick={async () => {
                          await automationApi().setPolicyEnabled(item.id, !item.enabled);
                          await refetchAutomationPolicies();
                        }}>
                          {item.enabled ? "Pausar" : "Reanudar"}
                        </Button>
                      </article>
                    ))}
                  </div>
                )}

                <h3 className="section-heading">Historial de evaluación</h3>
                {automationRuns.length === 0 ? <p className="panel-caption">Sin evaluaciones registradas.</p> : (
                  <div className="investment-contribution-list">
                    {automationRuns.map((run: any) => (
                      <article key={run.id} className="investment-contribution">
                        <div className="investment-contribution-header">
                          <div>
                            <strong>{run.state}</strong>
                            <span>{run.proposal?.assetId} · {formatDateTime(run.updatedAt ?? run.createdAt)}</span>
                          </div>
                          <span className="badge">{formatMoney(run.notionalEur)}</span>
                        </div>
                        {(run.proposal?.blockers ?? []).length > 0 ? <p className="investment-contribution-meta">Bloqueos: {run.proposal.blockers.join(" · ")}</p> : null}
                        {(run.proposal?.reasons ?? []).length > 0 ? <p className="investment-contribution-meta">Motivos: {run.proposal.reasons.join(" · ")}</p> : null}
                        {run.errorMessage ? <p className="investment-contribution-meta">Error: {run.errorMessage}</p> : null}
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : activeTab === "scheduled" ? (
            <Card>
              <CardHeader><CardTitle><CalendarClock size={16} /> Operaciones programadas</CardTitle></CardHeader>
              <CardContent>
                <p className="panel-caption">Persisten en backend. Modo actual: programar para revisar; al llegar la fecha se requiere nuevo preview y confirmación.</p>
                {scheduledOperations.length === 0 ? <EmptyState icon={<CalendarClock size={40} />} title="Sin operaciones programadas" description="Programa desde Nueva operación." /> : (
                  <div className="investment-contribution-list">
                    {scheduledOperations.map((item: any) => (
                      <article key={item.id} className="investment-contribution">
                        <div className="investment-contribution-header">
                          <div>
                            <strong>{operationLabel(item.operationType)}</strong>
                            <span>{item.plannedAt ? formatDateTime(item.plannedAt) : "Sin fecha"} · {item.frequency}</span>
                          </div>
                          {item.status === "condicion_cumplida" ? (
                            <span className="badge badge-success">Condición cumplida</span>
                          ) : (
                            <span className="badge badge-warning">Revisión manual</span>
                          )}
                        </div>
                        {item.condicion && (
                          <p className="investment-contribution-meta" style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                            Condición: {item.condicion.assetId} precio {item.condicion.type === "price_lte" ? "≤" : "≥"} {item.condicion.value.toLocaleString("es-ES")} EUR
                          </p>
                        )}
                        <p className="investment-contribution-meta">{item.note}</p>
                        <div style={{ display: "flex", gap: 8 }}>
                          {item.status === "condicion_cumplida" && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const inp = item.input ?? {};
                                const params = new URLSearchParams({ source: "scheduled-condition", asset: inp.assetId ?? inp.fromAssetId ?? "" });
                                if (inp.quoteAmountEur) params.set("quoteAmount", String(inp.quoteAmountEur));
                                if (inp.baseAmount) params.set("baseAmount", String(inp.baseAmount));
                                if (inp.operationType) params.set("type", inp.operationType);
                                navigate(`/operaciones?${params.toString()}`);
                              }}
                            >
                              Revisar y preparar
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" onClick={async () => { await coinbaseOperationsApi().deleteScheduledOperation(item.id); await refetchScheduled(); }}>Cancelar</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : activeTab === "pending" ? (
            <Card>
              <CardHeader><CardTitle><ListChecks size={16} /> Órdenes pendientes</CardTitle></CardHeader>
              <CardContent>
                {pendingOrders.length === 0 ? <EmptyState icon={<ListChecks size={40} />} title="Sin órdenes auditadas" description="Las órdenes enviadas desde Crypto Control aparecerán aquí." /> : (
                  <div className="investment-contribution-list">
                    {pendingOrders.map((item: any) => (
                      <article key={item.id} className="investment-contribution">
                        <div className="investment-contribution-header">
                          <div>
                            <strong>{operationLabel(item.operationType)}</strong>
                            <span>{formatDateTime(item.submittedAt)} · {item.routeType}</span>
                          </div>
                          <span className="badge">{item.statusSource ?? "local"}</span>
                        </div>
                        <p className="investment-contribution-meta">Órdenes: {item.orders?.map((order: any) => order.success_response?.order_id ?? order.order_id ?? "pendiente").join(" · ")}</p>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="operation-history-panel">
              <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
              <CardContent>
                {loadingTxs && <LoadingState message="Cargando historial..." />}
                {!loadingTxs && filteredTransactions.length === 0 && (
                  <EmptyState icon={<ClipboardList size={44} />} title="Sin operaciones de Coinbase" description="Sincroniza Coinbase para ver compras, ventas y conversiones reales. El registro manual está desactivado." />
                )}
                {filteredTransactions.length > 0 && (
                  <OperationList transactions={filteredTransactions} assets={assets} selectedId={selectedTx?.id} onSelect={setSelectedTxId} />
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <OperationDetail tx={selectedTx} assets={assets} onOpenCoinbaseSettings={() => navigate("/configuracion/coinbase")} />
      </div>
    </section>
  );
}

function SmartRulesPanel({ cycleId, onPrepare }: { cycleId: string; onPrepare: (assetId: string, amount: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["partial-sale-rules-evaluate", cycleId],
    enabled: Boolean(cycleId),
    queryFn: () => window.cryptoControl.partialSaleRules.evaluate({ cycleId }),
  });
  const rules = data?.ok ? data.data : [];
  return (
    <Card>
      <CardHeader><CardTitle>Venta Inteligente</CardTitle></CardHeader>
      <CardContent>
        <p className="panel-caption">Las ventas inteligentes solo preparan ventas parciales. Operaciones hace el preview y la confirmación.</p>
        {isLoading ? <LoadingState message="Evaluando reglas..." /> : null}
        <div className="investment-contribution-list">
          {rules.filter((item: any) => item.isTriggered).map((item: any) => (
            <article key={item.rule.id} className="investment-contribution">
              <div className="investment-contribution-header">
                <div>
                  <strong>{item.rule.assetId}</strong>
                  <span>Vender {item.preview?.percentageOfPosition}% · permanece {item.preview?.remainingPercentage}%</span>
                </div>
                <span className="badge badge-warning">Activada</span>
              </div>
              <p className="investment-contribution-meta">{item.triggeredReason}</p>
              <p className="investment-contribution-meta">Bruto {formatMoney(item.preview?.grossProceedsEur)} · Impuesto {formatMoney(item.preview?.estimatedTaxEur)} · EURC esperado {formatMoney(item.preview?.netEurcEur)}</p>
              <Button type="button" size="sm" onClick={() => onPrepare(item.rule.assetId, item.preview?.quantityToSell ?? 0)}>Preparar venta</Button>
            </article>
          ))}
          {!isLoading && rules.filter((item: any) => item.isTriggered).length === 0 ? <p className="empty-inline">No hay reglas de venta activadas ahora.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RebuyRulesPanel({ cycleId, onPrepare }: { cycleId: string; onPrepare: (assetId: string, amount: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["rebuy-tiers-evaluate", cycleId],
    enabled: Boolean(cycleId),
    queryFn: () => window.cryptoControl.rebuyTiers.evaluate({ cycleId }),
  });
  const result = data?.ok ? data.data : null;
  const tiers = result?.triggered ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Recompras</CardTitle></CardHeader>
      <CardContent>
        <p className="panel-caption">Las recompras usan exclusivamente EURC libre. Operaciones bloquea EUR y reserva fiscal.</p>
        {isLoading ? <LoadingState message="Evaluando escalones..." /> : null}
        <div className="investment-distribution">
          <span>EURC libre evaluado: <strong>{formatMoney(result?.availableLiquidityEur)}</strong></span>
          <span>Total sugerido: <strong>{formatMoney(result?.totalSuggestedEur)}</strong></span>
        </div>
        <div className="investment-contribution-list">
          {tiers.map((tier: any) => (
            <article key={tier.id} className="investment-contribution">
              <div className="investment-contribution-header">
                <div>
                  <strong>{tier.assetId}</strong>
                  <span>Caída {tier.drawdownPercentage}% · usar {tier.usagePercentage}% del EURC libre</span>
                </div>
                <span className="badge badge-success">Activado</span>
              </div>
              <Button type="button" size="sm" onClick={() => onPrepare(tier.assetId, Math.max(0, (result?.availableLiquidityEur ?? 0) * ((tier.usagePercentage ?? 0) / 100)))}>
                Preparar recompra
              </Button>
            </article>
          ))}
          {!isLoading && tiers.length === 0 ? <p className="empty-inline">No hay escalones de recompra activados ahora.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
