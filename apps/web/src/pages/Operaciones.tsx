import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "../components/Button";
import { TxBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { CryptoLogo } from "../components/CryptoLogo";

const uiSchema = z.object({
  type: z.enum(["buy", "sell", "convert", "transfer_in", "transfer_out", "reward", "staking", "airdrop", "fee", "adjustment"]),
  date: z.string().min(1, "La fecha es obligatoria"),
  sourceAsset: z.string().min(1, "Selecciona el activo"),
  destinationAsset: z.string().optional(),
  amount: z.number().positive("La cantidad debe ser mayor a 0"),
  destinationAmount: z.number().positive("La cantidad debe ser mayor a 0").optional(),
  priceEur: z.number().positive("El precio debe ser mayor a 0").optional(),
  feeAmount: z.number().min(0, "La comisión no puede ser negativa").optional(),
});

type FormData = z.infer<typeof uiSchema>;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function Operaciones() {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg,   setErrorMsg]   = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { register, watch, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(uiSchema),
    defaultValues: { type: "buy", amount: undefined, feeAmount: 0 },
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const type = watch("type");

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: txsRes, isLoading: loadingTxs } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list(),
  });

  const assets = assetsRes?.ok ? assetsRes.data : [];

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const dateMs = new Date(data.date).getTime();
      const legs   = [];

      if (["buy", "transfer_in", "reward", "staking", "airdrop"].includes(data.type)) {
        const valuationEur = data.priceEur ? data.amount * data.priceEur : undefined;
        legs.push({ assetId: data.sourceAsset, amount: data.amount, legType: "destination" as const, valuationEur });
      } else if (["sell", "transfer_out"].includes(data.type)) {
        const valuationEur = data.priceEur ? data.amount * data.priceEur : undefined;
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const, valuationEur });
      } else if (data.type === "convert") {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const });
        if (data.destinationAsset && data.destinationAmount) {
          legs.push({ assetId: data.destinationAsset, amount: data.destinationAmount, legType: "destination" as const });
        }
      } else {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "fee" as const });
      }

      const fees = data.feeAmount && data.feeAmount > 0
        ? [{ assetId: data.sourceAsset, amount: data.feeAmount }]
        : [];

      const result = await window.cryptoControl.transactions.create({
        type: data.type, date: dateMs, legs,
        fees: fees.length > 0 ? fees : undefined,
      });

      if (!result.ok) {
        setErrorMsg((result as { ok: false; error: { message: string } }).error?.message ?? "Error desconocido");
      } else {
        setSuccessMsg("Operación guardada correctamente.");
        reset({ type: "buy", amount: undefined, feeAmount: 0 });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      }
    } catch (e) {
      setErrorMsg("Fallo al guardar: " + (e instanceof Error ? e.message : "Error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta operación?")) return;
    const result = await window.cryptoControl.transactions.delete(id);
    if (result.ok) {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    }
  };

  const transactions = txsRes?.ok ? txsRes.data : [];
  const needsDestination = type === "convert";
  const hasPriceField    = type === "buy" || type === "sell";

  return (
    <div>
      <h1 className="page-title">Operaciones</h1>

      {/* Formulario */}
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">Registrar Operación</p>

        {errorMsg   && <div className="banner banner-error">{errorMsg}</div>}
        {successMsg && <div className="banner banner-success">{successMsg}</div>}

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="form-group">
            <label htmlFor="type">Tipo de operación</label>
            <select id="type" {...register("type")}>
              <option value="buy">Compra</option>
              <option value="sell">Venta</option>
              <option value="convert">Conversión</option>
              <option value="transfer_in">Entrada (transferencia)</option>
              <option value="transfer_out">Salida (transferencia)</option>
              <option value="reward">Recompensa</option>
              <option value="staking">Staking</option>
              <option value="airdrop">Airdrop</option>
              <option value="fee">Comisión</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="date">Fecha y hora</label>
            <input id="date" type="datetime-local" {...register("date")} />
            {errors.date && <span className="error-msg">{errors.date.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="sourceAsset">{needsDestination ? "Activo origen" : "Activo"}</label>
            <select id="sourceAsset" {...register("sourceAsset")}>
              <option value="">Selecciona un activo</option>
              {assets.map((a: { id: string; name: string; symbol: string }) => (
                <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
              ))}
            </select>
            {errors.sourceAsset && <span className="error-msg">{errors.sourceAsset.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="amount">{needsDestination ? "Cantidad entregada" : "Cantidad"}</label>
            <input id="amount" type="number" step="any" {...register("amount", { valueAsNumber: true })} />
            {errors.amount && <span className="error-msg">{errors.amount.message}</span>}
          </div>

          {hasPriceField && (
            <div className="form-group">
              <label htmlFor="priceEur">Precio unitario (€) — opcional</label>
              <input id="priceEur" type="number" step="any" {...register("priceEur", { valueAsNumber: true })} />
              {errors.priceEur && <span className="error-msg">{errors.priceEur.message}</span>}
            </div>
          )}

          {needsDestination && (
            <>
              <div className="form-group">
                <label htmlFor="destinationAsset">Activo destino</label>
                <select id="destinationAsset" {...register("destinationAsset")}>
                  <option value="">Selecciona un activo</option>
                  {assets.map((a: { id: string; name: string; symbol: string }) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="destinationAmount">Cantidad recibida</label>
                <input id="destinationAmount" type="number" step="any" {...register("destinationAmount", { valueAsNumber: true })} />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="feeAmount">Comisión (opcional)</label>
            <input id="feeAmount" type="number" step="any" {...register("feeAmount", { valueAsNumber: true })} />
            {errors.feeAmount && <span className="error-msg">{errors.feeAmount.message}</span>}
          </div>

          <div className="form-actions">
            <Button type="submit" loading={submitting}>
              Guardar operación
            </Button>
          </div>
        </form>
      </div>

      {/* Historial */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <p className="section-title" style={{ margin: 0 }}>Historial de operaciones</p>
        </div>

        {loadingTxs && (
          <div style={{ padding: 24 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
        )}

        {!loadingTxs && transactions.length === 0 && (
          <EmptyState
            icon="📋"
            title="Sin operaciones registradas"
            description="Las compras, ventas y conversiones que registres aparecerán aquí."
          />
        )}

        {transactions.length > 0 && (
          <>
            {/* Desktop */}
            <div className="portfolio-desktop-view" style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Activo</th>
                    <th className="num">Cantidad</th>
                    <th className="ctr">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {[...transactions].sort((a, b) => b.date - a.date).map(tx => {
                    const mainLeg  = tx.legs.find(l => l.legType === "destination") ?? tx.legs[0];
                    const srcLeg   = tx.legs.find(l => l.legType === "source");
                    const asset    = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === mainLeg?.assetId);

                    return (
                      <tr key={tx.id}>
                        <td className="text-secondary-color text-sm">{formatDate(tx.date)}</td>
                        <td><TxBadge type={tx.type} /></td>
                        <td>
                          <div className="asset-identity">
                            <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol ?? mainLeg?.assetId ?? "?"} size={24} />
                            <div>
                              <div className="font-semibold">{asset?.symbol ?? mainLeg?.assetId ?? "?"}</div>
                              {tx.type === "convert" && srcLeg && (
                                <div className="text-secondary-color text-xs">
                                  desde {assets.find((a: { id: string; symbol: string }) => a.id === srcLeg.assetId)?.symbol ?? srcLeg.assetId}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="num font-semibold">
                          {mainLeg ? Math.abs(mainLeg.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 }) : "—"}
                        </td>
                        <td className="ctr">
                          <Button variant="danger" size="sm" onClick={() => handleDelete(tx.id)}>
                            Eliminar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Móvil */}
            <div className="portfolio-cards">
              {[...transactions].sort((a, b) => b.date - a.date).map(tx => {
                const mainLeg = tx.legs.find(l => l.legType === "destination") ?? tx.legs[0];
                const asset   = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === mainLeg?.assetId);
                return (
                  <div key={tx.id} className="portfolio-card">
                    <div className="portfolio-card-header">
                      <div className="asset-identity">
                        <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol ?? mainLeg?.assetId ?? "?"} size={28} />
                        <div>
                          <div className="font-semibold">{asset?.symbol ?? mainLeg?.assetId}</div>
                          <TxBadge type={tx.type} />
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="font-semibold">
                          {mainLeg ? Math.abs(mainLeg.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 }) : "—"}
                        </div>
                        <div className="text-secondary-color text-xs">{formatDate(tx.date)}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(tx.id)}>
                        Eliminar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
