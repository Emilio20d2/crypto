import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvestmentCycle, Result, TreasuryMovement, TreasuryMovementType } from "@crypto-control/core";
import { Banknote, Coins, Landmark, LockKeyhole, PiggyBank, Plus, RotateCcw, Save } from "lucide-react";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { Input } from "../components/Input";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { PageToolbar } from "../components/PageToolbar";
import { formatDateTime, formatMoney } from "../lib/format";

async function unwrap<T>(promise: Promise<Result<T>>) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function todayInput() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromDateInput(value: string) {
  return new Date(`${value || todayInput()}T00:00:00`).getTime();
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

const MOVEMENT_LABELS: Record<TreasuryMovementType, string> = {
  efectivo_entrada: "Entrada efectivo",
  efectivo_salida: "Salida efectivo",
  eurc_entrada: "Entrada EURC",
  eurc_salida: "Salida EURC",
  reserva_fiscal: "Reserva fiscal",
  liberar_reserva: "Liberar reserva",
  asignar_recompra: "Asignar recompra",
  usar_recompra: "Usar recompra",
};

const MOVEMENT_OPTIONS: TreasuryMovementType[] = [
  "efectivo_entrada",
  "efectivo_salida",
  "eurc_entrada",
  "eurc_salida",
  "reserva_fiscal",
  "liberar_reserva",
];

function cycleLabel(cycle: InvestmentCycle) {
  return `${cycle.name} · ${formatMoney(cycle.monthlyAmountEur)}/mes`;
}

function SummaryTile({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <article className={`treasury-tile treasury-tile-${tone}`}>
      <span className="treasury-tile-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function MovementCard({ movement }: { movement: TreasuryMovement }) {
  return (
    <article className="treasury-movement-card">
      <div className="treasury-movement-main">
        <div>
          <strong>{MOVEMENT_LABELS[movement.type]}</strong>
          <span>{movement.reason}</span>
        </div>
        <strong>{formatMoney(movement.amount)}</strong>
      </div>
      <dl>
        <div><dt>Fecha</dt><dd>{formatDateTime(movement.date)}</dd></div>
        <div><dt>Origen</dt><dd>{movement.sourceAccountType ?? "Externo"}</dd></div>
        <div><dt>Destino</dt><dd>{movement.destinationAccountType ?? "Ninguno"}</dd></div>
        <div><dt>Moneda</dt><dd>{movement.currency}</dd></div>
      </dl>
      {movement.notes ? <p>{movement.notes}</p> : null}
    </article>
  );
}

export function Tesoreria() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [date, setDate] = useState(todayInput());
  const [type, setType] = useState<TreasuryMovementType>("efectivo_entrada");
  const [amount, setAmount] = useState("0");
  const [reason, setReason] = useState("Aportación manual");
  const [notes, setNotes] = useState("");
  const [reserveTarget, setReserveTarget] = useState("0");
  const [rebuyAmount, setRebuyAmount] = useState("0");
  const [rebuyReason, setRebuyReason] = useState("Liquidez para recompra de ciclo");
  const [cycleId, setCycleId] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["treasury", "summary"],
    queryFn: () => unwrap(window.cryptoControl.treasury.getSummary()),
  });

  const movementsQuery = useQuery({
    queryKey: ["treasury", "movements"],
    queryFn: () => unwrap(window.cryptoControl.treasury.listMovements()),
  });

  const cyclesQuery = useQuery({
    queryKey: ["investment-cycles", "treasury"],
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list()),
  });

  async function invalidateTreasury() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["treasury"] }),
      queryClient.invalidateQueries({ queryKey: ["investment-cycles"] }),
    ]);
  }

  const createMovement = useMutation({
    mutationFn: () => unwrap(window.cryptoControl.treasury.createMovement({
      date: fromDateInput(date),
      type,
      amount: parseNumber(amount),
      currency: type.startsWith("eurc") || type.includes("recompra") ? "EURC" : "EUR",
      reason,
      notes: notes || null,
    })),
    onSuccess: async () => {
      setFeedback("Movimiento guardado.");
      setAmount("0");
      setNotes("");
      await invalidateTreasury();
    },
  });

  const setFiscalReserve = useMutation({
    mutationFn: () => unwrap(window.cryptoControl.treasury.setFiscalReserve({
      amountEur: parseNumber(reserveTarget),
      notes: "Ajuste manual desde Tesorería",
    })),
    onSuccess: async () => {
      setFeedback("Reserva fiscal actualizada.");
      await invalidateTreasury();
    },
  });

  const allocateRebuy = useMutation({
    mutationFn: () => unwrap(window.cryptoControl.treasury.allocateEurcToRebuy({
      cycleId: cycleId || null,
      amountEur: parseNumber(rebuyAmount),
      reason: rebuyReason,
      notes: null,
    })),
    onSuccess: async () => {
      setFeedback("EURC asignado para recompra.");
      setRebuyAmount("0");
      await invalidateTreasury();
    },
  });

  const summary = summaryQuery.data;
  const movements = useMemo(
    () => [...(movementsQuery.data ?? [])].sort((a, b) => b.date - a.date),
    [movementsQuery.data]
  );
  const cycles = cyclesQuery.data ?? [];
  const error = summaryQuery.error ?? movementsQuery.error ?? cyclesQuery.error ?? createMovement.error ?? setFiscalReserve.error ?? allocateRebuy.error;

  if (summaryQuery.isLoading || movementsQuery.isLoading) return <LoadingState message="Cargando tesorería..." />;
  if (!summary) return <ErrorState message="No se pudo cargar Tesorería." />;

  return (
    <div className="treasury-page">
      <PageToolbar
        title="Tesorería"
        eyebrow="Ciclos — liquidez separada"
        meta={`Actualizado ${formatDateTime(summary.updatedAt)}`}
      />

      {feedback ? <p className="investment-feedback">{feedback}</p> : null}
      {error instanceof Error ? <p className="error-msg">{error.message}</p> : null}

      <section className="treasury-summary-grid" aria-label="Resumen de tesorería">
        <SummaryTile label="Efectivo disponible" value={formatMoney(summary.cashBalance)} icon={<Banknote size={18} />} />
        <SummaryTile label="EURC disponible" value={formatMoney(summary.eurcBalance)} icon={<Coins size={18} />} />
        <SummaryTile label="Reserva fiscal" value={formatMoney(summary.fiscalReserveBalance)} icon={<LockKeyhole size={18} />} tone="warning" />
        <SummaryTile label="Liquidez total" value={formatMoney(summary.totalLiquidity)} icon={<Landmark size={18} />} />
        <SummaryTile label="Libre para recompras" value={formatMoney(summary.freeRebuyLiquidity)} icon={<RotateCcw size={18} />} tone="success" />
        <SummaryTile label="Impuestos pendientes" value={formatMoney(summary.pendingEstimatedTaxes)} icon={<PiggyBank size={18} />} tone={summary.pendingEstimatedTaxes > 0 ? "warning" : "neutral"} />
      </section>

      <section className="treasury-layout">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Movimiento manual</CardTitle>
              <p className="panel-caption">Efectivo, EURC y reserva fiscal se guardan en bolsas separadas.</p>
            </div>
          </CardHeader>
          <CardContent>
            <form className="investment-form-grid compact" onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void createMovement.mutateAsync();
            }}>
              <label className="form-group">
                <span>Fecha</span>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="form-group">
                <span>Tipo</span>
                <select className="ui-select" value={type} onChange={(event) => setType(event.target.value as TreasuryMovementType)}>
                  {MOVEMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{MOVEMENT_LABELS[option]}</option>
                  ))}
                </select>
              </label>
              <label className="form-group">
                <span>Importe</span>
                <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="form-group">
                <span>Motivo</span>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label className="form-group investment-wide">
                <span>Nota</span>
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <div className="investment-form-actions">
                <Button type="submit" loading={createMovement.isPending}><Plus size={15} /> Guardar movimiento</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reserva y recompras</CardTitle>
              <p className="panel-caption">Recomendado: {formatMoney(summary.recommendedFiscalReserve)} · Actual: {formatMoney(summary.fiscalReserveBalance)}</p>
            </div>
          </CardHeader>
          <CardContent className="treasury-actions-stack">
            <form className="investment-form-grid compact" onSubmit={(event) => {
              event.preventDefault();
              void setFiscalReserve.mutateAsync();
            }}>
              <label className="form-group">
                <span>Reserva actual objetivo</span>
                <Input inputMode="decimal" value={reserveTarget} onChange={(event) => setReserveTarget(event.target.value)} />
              </label>
              <div className="investment-form-actions">
                <Button type="submit" variant="secondary" loading={setFiscalReserve.isPending}><Save size={15} /> Ajustar reserva</Button>
              </div>
            </form>

            <form className="investment-form-grid compact" onSubmit={(event) => {
              event.preventDefault();
              void allocateRebuy.mutateAsync();
            }}>
              <label className="form-group">
                <span>Ciclo</span>
                <select className="ui-select" value={cycleId} onChange={(event) => setCycleId(event.target.value)}>
                  <option value="">Sin ciclo vinculado</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>{cycleLabel(cycle)}</option>
                  ))}
                </select>
              </label>
              <label className="form-group">
                <span>EURC para recompra</span>
                <Input inputMode="decimal" value={rebuyAmount} onChange={(event) => setRebuyAmount(event.target.value)} />
              </label>
              <label className="form-group investment-wide">
                <span>Motivo</span>
                <Input value={rebuyReason} onChange={(event) => setRebuyReason(event.target.value)} />
              </label>
              <div className="investment-form-actions">
                <Button type="submit" variant="secondary" loading={allocateRebuy.isPending}><RotateCcw size={15} /> Asignar EURC</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Movimientos</CardTitle>
            <p className="panel-caption">{movements.length} registros de tesorería</p>
          </div>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="empty-inline">Sin movimientos de tesorería registrados.</p>
          ) : (
            <div className="treasury-movement-grid">
              {movements.map((movement) => <MovementCard key={movement.id} movement={movement} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
