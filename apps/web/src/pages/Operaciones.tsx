import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ClipboardList, Filter } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { FormField } from "../components/FormField";
import { Input } from "../components/Input";
import { LoadingState } from "../components/LoadingState";
import { OperationDetail, OperationList } from "../components/OperationPanels";
import { PageToolbar } from "../components/PageToolbar";
import { Select } from "../components/Select";

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

export function Operaciones() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const { register, watch, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(uiSchema),
    defaultValues: { type: "buy", amount: undefined, feeAmount: 0 },
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const type = watch("type");
  const needsDestination = type === "convert";
  const hasPriceField = type === "buy" || type === "sell";

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
    const sorted = [...transactions].sort((a, b) => b.date - a.date);
    return typeFilter === "all" ? sorted : sorted.filter((tx) => tx.type === typeFilter);
  }, [transactions, typeFilter]);
  const selectedTx = filteredTransactions.find((tx) => tx.id === selectedTxId) || filteredTransactions[0];

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const dateMs = new Date(data.date).getTime();
      const legs = [];

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
        type: data.type,
        date: dateMs,
        legs,
        fees: fees.length ? fees : undefined,
      });

      if (!result.ok) {
        setErrorMsg(result.error?.message ?? "Error desconocido");
        return;
      }

      setSuccessMsg("Operación guardada correctamente.");
      reset({ type: "buy", amount: undefined, feeAmount: 0 });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      setErrorMsg(`Fallo al guardar: ${error instanceof Error ? error.message : "Error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta operación?")) return;
    const result = await window.cryptoControl.transactions.delete(id);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      if (selectedTxId === id) setSelectedTxId(null);
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
        <Card className="operation-form-panel">
          <CardHeader>
            <CardTitle>Registrar Operación</CardTitle>
          </CardHeader>
          <CardContent>
            {errorMsg && <div className="banner banner-error">{errorMsg}</div>}
            {successMsg && <div className="banner banner-success">{successMsg}</div>}

            <form className="compact-form" onSubmit={handleSubmit(onSubmit)} noValidate>
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
                  {assets.map((asset: any) => (
                    <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>
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
                      {assets.map((asset: any) => (
                        <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>
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

              <Button type="submit" fullWidth loading={submitting}>
                Guardar Operación
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="operation-history-panel">
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTxs && <LoadingState message="Cargando historial..." />}
            {!loadingTxs && filteredTransactions.length === 0 && (
              <EmptyState
                icon={<ClipboardList size={44} />}
                title="Sin operaciones registradas"
                description="Las compras, ventas y conversiones aparecerán en esta lista."
              />
            )}
            {filteredTransactions.length > 0 && (
              <OperationList
                transactions={filteredTransactions}
                assets={assets}
                selectedId={selectedTx?.id}
                onSelect={setSelectedTxId}
                onDelete={handleDelete}
              />
            )}
          </CardContent>
        </Card>

        <OperationDetail tx={selectedTx} assets={assets} onOpenCoinbaseSettings={() => navigate("/configuracion/coinbase")} />
      </div>
    </section>
  );
}
