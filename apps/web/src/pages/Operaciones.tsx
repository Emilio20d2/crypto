import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

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
    hour: "2-digit", minute: "2-digit"
  });
}

function txTypeLabel(type: string) {
  const labels: Record<string, string> = {
    buy: "Compra", sell: "Venta", convert: "Conversión",
    transfer_in: "Entrada", transfer_out: "Salida",
    reward: "Recompensa", staking: "Staking", airdrop: "Airdrop",
    fee: "Comisión", adjustment: "Ajuste"
  };
  return labels[type] ?? type;
}

export function Operaciones() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { register, watch, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(uiSchema),
    defaultValues: { type: "buy", amount: undefined, feeAmount: 0 }
  });

  const type = watch("type");

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list()
  });

  const { data: txsRes, isLoading: loadingTxs } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list()
  });

  const assets = assetsRes?.ok ? assetsRes.data : [];

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const legs = [];
      const dateMs = new Date(data.date).getTime();

      if (data.type === "buy" || data.type === "transfer_in" || data.type === "reward" || data.type === "staking" || data.type === "airdrop") {
        const valuationEur = data.priceEur ? data.amount * data.priceEur : undefined;
        legs.push({ assetId: data.sourceAsset, amount: data.amount, legType: "destination" as const, valuationEur });
      } else if (data.type === "sell" || data.type === "transfer_out") {
        const valuationEur = data.priceEur ? data.amount * data.priceEur : undefined;
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const, valuationEur });
      } else if (data.type === "convert") {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const });
        if (data.destinationAsset && data.destinationAmount) {
          legs.push({ assetId: data.destinationAsset, amount: data.destinationAmount, legType: "destination" as const });
        }
      } else if (data.type === "fee" || data.type === "adjustment") {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "fee" as const });
      }

      const fees = data.feeAmount && data.feeAmount > 0 ? [{ assetId: data.sourceAsset, amount: data.feeAmount }] : [];

      const result = await window.cryptoControl.transactions.create({
        type: data.type,
        date: dateMs,
        legs,
        fees: fees.length > 0 ? fees : undefined
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
      setLoading(false);
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

  return (
    <div className="operaciones-page">
      <h1 className="page-title">Operaciones</h1>

      <div className="card" style={{ marginBottom: "24px" }}>
        <h3>Registrar Operación</h3>

        {errorMsg && <div className="error-banner" style={{ marginBottom: "12px" }}>{errorMsg}</div>}
        {successMsg && <div style={{ marginBottom: "12px", padding: "10px 14px", backgroundColor: "#D1FAE5", color: "#065F46", borderRadius: "var(--radius-md)" }}>{successMsg}</div>}

        <form onSubmit={handleSubmit(onSubmit)} className="op-form" noValidate>
          <div className="form-group">
            <label htmlFor="type">Tipo</label>
            <select id="type" {...register("type")}>
              <option value="buy">Compra</option>
              <option value="sell">Venta</option>
              <option value="convert">Conversión</option>
              <option value="transfer_in">Entrada (Transferencia)</option>
              <option value="transfer_out">Salida (Transferencia)</option>
              <option value="reward">Recompensa</option>
              <option value="staking">Staking</option>
              <option value="airdrop">Airdrop</option>
              <option value="fee">Comisión</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="date">Fecha y Hora</label>
            <input id="date" type="datetime-local" {...register("date")} />
            {errors.date && <span className="error">{errors.date.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="sourceAsset">Activo {type === "convert" ? "Origen" : ""}</label>
            <select id="sourceAsset" {...register("sourceAsset")}>
              <option value="">Selecciona un activo</option>
              {assets.map((a: { id: string; name: string; symbol: string }) => (
                <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
              ))}
            </select>
            {errors.sourceAsset && <span className="error">{errors.sourceAsset.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="amount">Cantidad {type === "convert" ? "Entregada" : ""}</label>
            <input id="amount" type="number" step="any"{...register("amount", { valueAsNumber: true })} />
            {errors.amount && <span className="error">{errors.amount.message}</span>}
          </div>

          {(type === "buy" || type === "sell") && (
            <div className="form-group">
              <label htmlFor="priceEur">Precio unitario (€) — opcional</label>
              <input id="priceEur" type="number" step="any"{...register("priceEur", { valueAsNumber: true })} />
              {errors.priceEur && <span className="error">{errors.priceEur.message}</span>}
            </div>
          )}

          {type === "convert" && (
            <>
              <div className="form-group">
                <label htmlFor="destinationAsset">Activo Destino</label>
                <select id="destinationAsset" {...register("destinationAsset")}>
                  <option value="">Selecciona un activo</option>
                  {assets.map((a: { id: string; name: string; symbol: string }) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="destinationAmount">Cantidad Recibida</label>
                <input id="destinationAmount" type="number" step="any"{...register("destinationAmount", { valueAsNumber: true })} />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="feeAmount">Comisión (opcional)</label>
            <input id="feeAmount" type="number" step="any"{...register("feeAmount", { valueAsNumber: true })} />
            {errors.feeAmount && <span className="error">{errors.feeAmount.message}</span>}
          </div>

          <button type="submit" disabled={loading}>
            {loading ? "Guardando..." : "Guardar Operación"}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: "24px 24px 16px 24px", margin: 0 }}>Historial de Operaciones</h3>

        {loadingTxs && (
          <div style={{ padding: "24px", color: "var(--text-secondary)" }}>Cargando operaciones...</div>
        )}

        {!loadingTxs && transactions.length === 0 && (
          <div style={{ padding: "24px", color: "var(--text-secondary)", textAlign: "center" }}>
            Todavía no hay operaciones registradas.
          </div>
        )}

        {transactions.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="portfolio-desktop-view" style={{ overflowX: "auto" }}>
              <table className="portfolio-table" style={{ width: "100%", textAlign: "left", borderCollapse: "collapse", minWidth: "500px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <th style={{ padding: "12px 16px" }}>Fecha</th>
                    <th style={{ padding: "12px 16px" }}>Tipo</th>
                    <th style={{ padding: "12px 16px" }}>Activo</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Cantidad</th>
                    <th style={{ padding: "12px 16px", textAlign: "center" }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {[...transactions].sort((a, b) => b.date - a.date).map(tx => {
                    const mainLeg = tx.legs.find(l => l.legType === "destination") ?? tx.legs[0];
                    const sourceLeg = tx.legs.find(l => l.legType === "source");
                    const asset = assets.find((a: { id: string; symbol: string }) => a.id === mainLeg?.assetId);

                    return (
                      <tr key={tx.id} style={{ borderBottom: "1px solid var(--surface-hover)" }}>
                        <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
                          {formatDate(tx.date)}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            backgroundColor: tx.type === "buy" || tx.type === "transfer_in" || tx.type === "reward" ? "#D1FAE5" : tx.type === "convert" ? "#DBEAFE" : "#FEE2E2",
                            color: tx.type === "buy" || tx.type === "transfer_in" || tx.type === "reward" ? "#065F46" : tx.type === "convert" ? "#1E40AF" : "#991B1B"
                          }}>
                            {txTypeLabel(tx.type)}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontWeight: 600 }}>{asset?.symbol ?? mainLeg?.assetId ?? "?"}</div>
                          {tx.type === "convert" && sourceLeg && (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                              desde {assets.find((a: { id: string; symbol: string }) => a.id === sourceLeg.assetId)?.symbol ?? sourceLeg.assetId}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 500 }}>
                          {mainLeg ? Math.abs(mainLeg.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 }) : "-"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <button
                            onClick={() => handleDelete(tx.id)}
                            style={{ fontSize: "0.8rem", padding: "4px 10px", backgroundColor: "transparent", border: "1px solid #EF4444", color: "#EF4444", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="portfolio-cards" style={{ padding: "0 24px 24px 24px" }}>
              {[...transactions].sort((a, b) => b.date - a.date).map(tx => {
                const mainLeg = tx.legs.find(l => l.legType === "destination") ?? tx.legs[0];
                const asset = assets.find((a: { id: string; symbol: string }) => a.id === mainLeg?.assetId);
                return (
                  <div key={tx.id} className="portfolio-card" style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{txTypeLabel(tx.type)} — {asset?.symbol ?? mainLeg?.assetId}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{formatDate(tx.date)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 600 }}>{mainLeg ? Math.abs(mainLeg.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 }) : "-"}</div>
                        <button
                          onClick={() => handleDelete(tx.id)}
                          style={{ fontSize: "0.75rem", padding: "2px 8px", backgroundColor: "transparent", border: "1px solid #EF4444", color: "#EF4444", borderRadius: "4px", cursor: "pointer", marginTop: "4px" }}
                        >
                          Eliminar
                        </button>
                      </div>
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
