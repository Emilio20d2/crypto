import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
// Usamos el esquema del core o uno local extendido para UI

// Esquema de UI adaptado (extiende mensajes en español)
const uiSchema = z.object({
  type: z.enum(["buy", "sell", "convert", "transfer_in", "transfer_out", "reward", "staking", "airdrop", "fee", "adjustment"]),
  date: z.string().min(1, "La fecha es obligatoria"),
  sourceAsset: z.string().min(1, "Selecciona el activo"),
  destinationAsset: z.string().optional(),
  amount: z.number().positive("La cantidad debe ser mayor a 0"),
  destinationAmount: z.number().positive("La cantidad debe ser mayor a 0").optional(),
  feeAmount: z.number().min(0, "La comisión no puede ser negativa").optional(),
});

type FormData = z.infer<typeof uiSchema>;

export function Operaciones() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const { register, watch, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(uiSchema),
    defaultValues: {
      type: "buy",
      amount: 0,
      feeAmount: 0
    }
  });

  const type = watch("type");

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const legs = [];
      
      // Adaptar el form plano al esquema relacional
      if (data.type === "buy" || data.type === "transfer_in") {
        legs.push({ assetId: data.sourceAsset, amount: data.amount, legType: "destination" as const });
      } else if (data.type === "sell" || data.type === "transfer_out") {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const });
      } else if (data.type === "convert") {
        legs.push({ assetId: data.sourceAsset, amount: -data.amount, legType: "source" as const });
        if (data.destinationAsset && data.destinationAmount) {
          legs.push({ assetId: data.destinationAsset, amount: data.destinationAmount, legType: "destination" as const });
        }
      }

      const fees = data.feeAmount && data.feeAmount > 0 ? [{
        assetId: data.sourceAsset, // asumiendo que se paga en el mismo origen
        amount: data.feeAmount
      }] : [];

      const txData = {
        type: data.type,
        date: new Date(data.date).getTime(),
        legs,
        fees
      };

      // @ts-ignore IPC API
      const result = await window.api.transactions.create(txData);
      
      if (!result.success) {
        setErrorMsg(result.error || "Error desconocido");
      } else {
        alert("Operación guardada");
      }
    } catch (e: any) {
      setErrorMsg("Fallo al guardar: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="operaciones-page">
      <h1 className="page-title">Operaciones</h1>
      
      <div className="card">
        <h3>Registrar Operación</h3>
        
        {errorMsg && <div className="error-banner">{errorMsg}</div>}
        
        <form onSubmit={handleSubmit(onSubmit)} className="op-form">
          <div className="form-group">
            <label htmlFor="type">Tipo</label>
            <select id="type" {...register("type")}>
              <option value="buy">Compra</option>
              <option value="sell">Venta</option>
              <option value="convert">Conversión</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="date">Fecha y Hora</label>
            <input id="date" type="datetime-local" {...register("date")} />
            {errors.date && <span className="error">{errors.date.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="sourceAsset">Activo {type === "convert" ? "Origen" : ""}</label>
            <input id="sourceAsset" type="text" placeholder="Ej. bitcoin" {...register("sourceAsset")} />
            {errors.sourceAsset && <span className="error">{errors.sourceAsset.message}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="amount">Cantidad {type === "convert" ? "Entregada" : ""}</label>
            <input id="amount" type="number" step="any" {...register("amount", { valueAsNumber: true })} />
            {errors.amount && <span className="error">{errors.amount.message}</span>}
          </div>

          {type === "convert" && (
            <>
              <div className="form-group">
                <label htmlFor="destinationAsset">Activo Destino</label>
                <input id="destinationAsset" type="text" placeholder="Ej. ethereum" {...register("destinationAsset")} />
              </div>
              <div className="form-group">
                <label htmlFor="destinationAmount">Cantidad Recibida</label>
                <input id="destinationAmount" type="number" step="any" {...register("destinationAmount", { valueAsNumber: true })} />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="feeAmount">Comisión</label>
            <input id="feeAmount" type="number" step="any" {...register("feeAmount", { valueAsNumber: true })} />
            {errors.feeAmount && <span className="error">{errors.feeAmount.message}</span>}
          </div>

          <button type="submit" disabled={loading}>
            {loading ? "Guardando..." : "Guardar Operación"}
          </button>
        </form>
      </div>
    </div>
  );
}
