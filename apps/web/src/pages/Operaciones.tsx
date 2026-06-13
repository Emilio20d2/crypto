import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "../components/Button";
import { TxBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { CryptoLogo } from "../components/CryptoLogo";
import { Card, CardHeader, CardTitle, CardContent } from "../components/Card";
import { FormField } from "../components/FormField";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { LoadingState } from "../components/LoadingState";

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
      <Card style={{ marginBottom: "24px" }}>
        <CardHeader>
          <CardTitle>Registrar Operación</CardTitle>
        </CardHeader>
        <CardContent>
          {errorMsg   && <div className="banner banner-error">{errorMsg}</div>}
          {successMsg && <div className="banner banner-success">{successMsg}</div>}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <FormField label="Tipo de operación" htmlFor="type">
              <Select id="type" {...register("type")}>
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
              </Select>
            </FormField>

            <FormField label="Fecha y hora" htmlFor="date" error={errors.date?.message}>
              <Input id="date" type="datetime-local" error={!!errors.date} {...register("date")} />
            </FormField>

            <FormField label={needsDestination ? "Activo origen" : "Activo"} htmlFor="sourceAsset" error={errors.sourceAsset?.message}>
              <Select id="sourceAsset" error={!!errors.sourceAsset} {...register("sourceAsset")}>
                <option value="">Selecciona un activo</option>
                {assets.map((a: { id: string; name: string; symbol: string }) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
                ))}
              </Select>
            </FormField>

            <FormField label={needsDestination ? "Cantidad entregada" : "Cantidad"} htmlFor="amount" error={errors.amount?.message}>
              <Input id="amount" type="number" step="any" error={!!errors.amount} {...register("amount", { valueAsNumber: true })} />
            </FormField>

            {hasPriceField && (
              <FormField label="Precio unitario (€) — opcional" htmlFor="priceEur" error={errors.priceEur?.message}>
                <Input id="priceEur" type="number" step="any" error={!!errors.priceEur} {...register("priceEur", { valueAsNumber: true })} />
              </FormField>
            )}

            {needsDestination && (
              <>
                <FormField label="Activo destino" htmlFor="destinationAsset">
                  <Select id="destinationAsset" {...register("destinationAsset")}>
                    <option value="">Selecciona un activo</option>
                    {assets.map((a: { id: string; name: string; symbol: string }) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Cantidad recibida" htmlFor="destinationAmount">
                  <Input id="destinationAmount" type="number" step="any" {...register("destinationAmount", { valueAsNumber: true })} />
                </FormField>
              </>
            )}

            <FormField label="Comisión (opcional)" htmlFor="feeAmount" error={errors.feeAmount?.message}>
              <Input id="feeAmount" type="number" step="any" error={!!errors.feeAmount} {...register("feeAmount", { valueAsNumber: true })} />
            </FormField>

            <div className="form-actions" style={{ marginTop: "24px" }}>
              <Button type="submit" loading={submitting}>
                Guardar operación
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Historial */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <CardHeader style={{ paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <CardTitle style={{ fontSize: "1rem" }}>Historial de operaciones</CardTitle>
        </CardHeader>

        {loadingTxs && (
          <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
            <LoadingState text="Cargando historial..." />
          </div>
        )}

        {!loadingTxs && transactions.length === 0 && (
          <CardContent style={{ padding: "48px 24px" }}>
            <EmptyState
              icon="📋"
              title="Sin operaciones registradas"
              description="Las compras, ventas y conversiones que registres aparecerán aquí."
            />
          </CardContent>
        )}

        {transactions.length > 0 && (
          <>
            {/* Desktop */}
            <div className="portfolio-desktop-view">
              <ResponsiveTable
                headers={[
                  "Fecha",
                  "Tipo",
                  "Activo",
                  <div className="text-right">Cantidad</div>,
                  <div className="text-center">Acción</div>
                ]}
              >
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
                          <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol ?? mainLeg?.assetId ?? "?"} size={28} />
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
              </ResponsiveTable>
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
                          <div style={{ marginTop: 4 }}>
                            <TxBadge type={tx.type} />
                          </div>
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
      </Card>
    </div>
  );
}
