import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Filter } from "lucide-react";
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
import { formatMoney } from "../lib/format";

function moneyValue(input: any): number | null {
  if (!input) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  const raw = typeof input === "string" ? input : input.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringAmount(input: any): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (typeof input.value === "string") return input.value;
  if (typeof input === "number") return String(input);
  return null;
}

export function Operaciones() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [successMsg, setSuccessMsg] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [preparedPreview, setPreparedPreview] = useState<{ key: string; data: any } | null>(null);
  const [preparedError, setPreparedError] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const preparedTrade = useMemo(() => {
    if (searchParams.get("source") !== "smart-buy") return null;
    const assetId = searchParams.get("asset")?.toUpperCase() || "";
    const quoteAmountEur = Number(searchParams.get("quoteAmount"));
    if (!assetId || !Number.isFinite(quoteAmountEur) || quoteAmountEur <= 0) return null;
    return {
      assetId,
      quoteAmountEur,
      cycleId: searchParams.get("cycleId") || null,
    };
  }, [searchParams]);

  const preparedTradeKey = preparedTrade
    ? `${preparedTrade.assetId}:${preparedTrade.quoteAmountEur}:${preparedTrade.cycleId ?? ""}`
    : null;
  const currentPreparedPreview = preparedTradeKey && preparedPreview?.key === preparedTradeKey ? preparedPreview.data : null;

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: txsRes, isLoading: loadingTxs } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list(),
  });

  const assets = assetsRes?.ok ? assetsRes.data : [];
  const transactions = useMemo(() => txsRes?.ok ? txsRes.data : [], [txsRes]);
  const filteredTransactions = useMemo(() => {
    const coinbaseTransactions = transactions.filter((tx) => typeof tx.externalId === "string" && tx.externalId.length > 0);
    const sorted = [...coinbaseTransactions].sort((a, b) => b.date - a.date);
    return typeFilter === "all" ? sorted : sorted.filter((tx) => tx.type === typeFilter);
  }, [transactions, typeFilter]);
  const selectedTx = filteredTransactions.find((tx) => tx.id === selectedTxId) || filteredTransactions[0];

  const requestPreparedPreview = async () => {
    if (!preparedTrade || !preparedTradeKey) return;
    setPreviewLoading(true);
    setPreparedError("");
    setPreparedPreview(null);
    try {
      const result = await window.cryptoControl.coinbase.previewOrder({
        assetId: preparedTrade.assetId,
        side: "BUY",
        quoteAmountEur: preparedTrade.quoteAmountEur,
      });
      if (!result.ok) {
        setPreparedError(result.error.message);
        return;
      }
      setPreparedPreview({ key: preparedTradeKey, data: result.data });
    } catch (error) {
      setPreparedError(error instanceof Error ? error.message : "No se pudo obtener preview de Coinbase");
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitPreparedOrder = async () => {
    if (!preparedTrade || !currentPreparedPreview) return;
    setOrderLoading(true);
    setPreparedError("");
    try {
      const result = await window.cryptoControl.coinbase.submitOrder({
        assetId: preparedTrade.assetId,
        side: "BUY",
        quoteAmountEur: preparedTrade.quoteAmountEur,
        previewId: currentPreparedPreview.preview_id ?? null,
        confirmationText,
      });
      if (!result.ok) {
        setPreparedError(result.error.message);
        return;
      }
      setSuccessMsg("Orden enviada a Coinbase. Sincronizando cartera y operaciones en segundo plano.");
      await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      setPreparedError(error instanceof Error ? error.message : "No se pudo enviar la orden a Coinbase");
    } finally {
      setOrderLoading(false);
    }
  };

  return (
    <section className="page-stack operations-page">
      <PageToolbar
        title="Operaciones"
        meta="Registro y trazabilidad fiscal"
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

      <div className="operations-layout">
        {preparedTrade ? (
          <Card className="operation-form-panel">
            <CardHeader>
              <CardTitle>Orden preparada desde Compra Inteligente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="investment-distribution">
                <span>Activo: <strong>{preparedTrade.assetId}</strong></span>
                <span>Importe: <strong>{formatMoney(preparedTrade.quoteAmountEur)}</strong></span>
                <span>Origen: <strong>Aportaciones EUR</strong></span>
              </div>
              {preparedError ? <div className="banner banner-error">{preparedError}</div> : null}
              {currentPreparedPreview ? (
                <div className="investment-contribution-list" style={{ marginTop: 12 }}>
                  <article className="investment-contribution">
                    <div className="investment-contribution-header">
                      <div>
                        <strong>Preview Coinbase</strong>
                        <span>{currentPreparedPreview.productId ?? `${preparedTrade.assetId}-EUR`}</span>
                      </div>
                      <span className="badge">No ejecutada</span>
                    </div>
                    <p className="investment-contribution-meta">
                      Total estimado: <strong>{formatMoney(moneyValue(currentPreparedPreview.order_total), "Pendiente")}</strong>
                      {" "} · Comisión: <strong>{formatMoney(moneyValue(currentPreparedPreview.commission_total), "Pendiente")}</strong>
                    </p>
                    <p className="investment-contribution-meta">
                      Cantidad estimada: {stringAmount(currentPreparedPreview.base_size) ?? "Pendiente"} {preparedTrade.assetId}
                      {" "} · Precio medio estimado: {currentPreparedPreview.est_average_filled_price ?? "Pendiente"}
                    </p>
                    <FormField label="Confirmación explícita" htmlFor="coinbase-confirmation">
                      <Input
                        id="coinbase-confirmation"
                        value={confirmationText}
                        onChange={(event) => setConfirmationText(event.target.value)}
                        placeholder="Escribe CONFIRMAR"
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="primary"
                      fullWidth
                      loading={orderLoading}
                      disabled={confirmationText !== "CONFIRMAR"}
                      onClick={() => void submitPreparedOrder()}
                    >
                      Enviar orden real a Coinbase
                    </Button>
                  </article>
                </div>
              ) : (
                <Button type="button" fullWidth loading={previewLoading} onClick={() => void requestPreparedPreview()}>
                  Solicitar preview de Coinbase
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}

        {successMsg ? (
          <Card className="operation-form-panel">
            <CardContent>
              <div className="banner banner-success">{successMsg}</div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="operation-history-panel">
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTxs && <LoadingState message="Cargando historial..." />}
            {!loadingTxs && filteredTransactions.length === 0 && (
              <EmptyState
                icon={<ClipboardList size={44} />}
                title="Sin operaciones de Coinbase"
                description="Sincroniza Coinbase para ver compras, ventas y conversiones reales. El registro manual está desactivado."
              />
            )}
            {filteredTransactions.length > 0 && (
              <OperationList
                transactions={filteredTransactions}
                assets={assets}
                selectedId={selectedTx?.id}
                onSelect={setSelectedTxId}
              />
            )}
          </CardContent>
        </Card>

        <OperationDetail tx={selectedTx} assets={assets} onOpenCoinbaseSettings={() => navigate("/configuracion/coinbase")} />
      </div>
    </section>
  );
}
