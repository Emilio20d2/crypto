import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
import { formatMoney, formatDateTime } from "../lib/format";
import {
  buildFiscalYearSummaries,
  type GainWithDate,
  type FiscalYearSummary,
} from "../lib/taxCalculations";

interface FiscalDiagnostics {
  transactionCount: number;
  disposalCount: number;
  valuedDisposalCount: number;
  pendingDisposalCount: number;
  gainsCount: number;
  missingDateGains: number;
  reason: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildFiscalDiagnostics(transactions: any[], gainsCount: number, missingDateGains: number): FiscalDiagnostics {
  const disposalTxs = transactions.filter((tx) => tx.type === "sell" || tx.type === "convert");
  const valuedDisposalCount = disposalTxs.filter((tx) =>
    tx.legs?.some((leg: any) => leg.amount < 0 && isFiniteNumber(leg.valuationEur))
  ).length;
  const pendingDisposalCount = disposalTxs.length - valuedDisposalCount;

  let reason = "No hay ganancias realizadas calculadas para mostrar.";
  if (transactions.length === 0) {
    reason = "No hay operaciones registradas en la base de datos local.";
  } else if (disposalTxs.length === 0) {
    reason = "Hay operaciones registradas, pero ninguna venta o conversión con impacto fiscal.";
  } else if (valuedDisposalCount === 0) {
    reason = "Hay ventas o conversiones, pero sus salidas no tienen valoración EUR; FIFO no puede calcular ganancia o pérdida realizada.";
  } else if (missingDateGains > 0) {
    reason = "Existen ganancias realizadas, pero algunas no tienen fecha fiscal válida para agruparlas por año.";
  }

  return {
    transactionCount: transactions.length,
    disposalCount: disposalTxs.length,
    valuedDisposalCount,
    pendingDisposalCount,
    gainsCount,
    missingDateGains,
    reason,
  };
}

function useFiscalData() {
  const gainsQuery = useQuery({
    queryKey: ["portfolio", "realized-gains"],
    queryFn: () => window.cryptoControl.portfolio.getRealizedGains(),
    staleTime: 60_000,
  });

  const txQuery = useQuery({
    queryKey: ["transactions", "list"],
    queryFn: () => window.cryptoControl.transactions.list(),
    staleTime: 60_000,
  });

  const resultError =
    gainsQuery.data && !gainsQuery.data.ok
      ? gainsQuery.data.error.message
      : txQuery.data && !txQuery.data.ok
        ? txQuery.data.error.message
        : null;

  const fiscalModel = useMemo<{
    summaries: FiscalYearSummary[];
    diagnostics: FiscalDiagnostics;
  }>(() => {
    if (!gainsQuery.data?.ok || !txQuery.data?.ok) {
      return {
        summaries: [],
        diagnostics: buildFiscalDiagnostics([], 0, 0),
      };
    }
    const transactions = txQuery.data.data;
    const txDateMap = new Map(
      transactions.map((tx) => [tx.id, tx.date])
    );
    const gainsWithDate: GainWithDate[] = gainsQuery.data.data
      .map((g) => {
        const date = (g as typeof g & { date?: number }).date;
        return {
          ...g,
          date: isFiniteNumber(date) ? date : txDateMap.get(g.transactionId),
        };
      })
      .filter((g): g is GainWithDate => isFiniteNumber(g.date) && g.date > 0);

    const missingDateGains = gainsQuery.data.data.length - gainsWithDate.length;
    return {
      summaries: buildFiscalYearSummaries(gainsWithDate),
      diagnostics: buildFiscalDiagnostics(transactions, gainsQuery.data.data.length, missingDateGains),
    };
  }, [gainsQuery.data, txQuery.data]);

  return {
    isLoading: gainsQuery.isLoading || txQuery.isLoading,
    isError: gainsQuery.isError || txQuery.isError || !!resultError,
    errorMessage:
      resultError ??
      (gainsQuery.error instanceof Error ? gainsQuery.error.message : null) ??
      (txQuery.error instanceof Error ? txQuery.error.message : "Error al cargar datos fiscales"),
    summaries: fiscalModel.summaries,
    diagnostics: fiscalModel.diagnostics,
  };
}

function FiscalYearSelector({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number;
  onSelect: (y: number) => void;
}) {
  return (
    <div className="fiscal-year-selector" role="group" aria-label="Seleccionar año fiscal">
      {years.map((y) => (
        <button
          key={y}
          type="button"
          className={`fiscal-year-btn${y === selected ? " fiscal-year-btn--active" : ""}`}
          onClick={() => onSelect(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "warning" | "neutral" }) {
  return (
    <div className={`ui-card stat-card fiscal-stat-card${tone ? ` fiscal-stat-${tone}` : ""}`}>
      <div className="ui-card-header">
        <h3 className="ui-card-title">{label}</h3>
      </div>
      <div className="ui-card-content">
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function GainsTable({ gains }: { gains: GainWithDate[] }) {
  if (gains.length === 0) return null;
  return (
    <>
      <div className="fiscal-gains-table responsive-table">
        <table>
          <thead>
            <tr>
              <th>Activo</th>
              <th className="num">Cantidad vendida</th>
              <th className="num">Valor venta</th>
              <th className="num">Coste adquisición</th>
              <th className="num">Ganancia / Pérdida</th>
              <th className="num fiscal-col-date">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {gains
              .slice()
              .sort((a, b) => b.date - a.date)
              .map((g) => (
                <tr key={`${g.transactionId}_${g.assetId}`} className="responsive-table-row">
                  <td>
                    <span className="fiscal-asset-id">{g.assetId.toUpperCase()}</span>
                  </td>
                  <td className="num">
                    {g.amountSold.toLocaleString("es-ES", { maximumFractionDigits: 8 })}
                  </td>
                  <td className="num">{formatMoney(g.sellValueEur)}</td>
                  <td className="num">{formatMoney(g.costBasisEur)}</td>
                  <td className={`num ${g.realizedGainEur >= 0 ? "text-gain" : "text-loss"}`}>
                    {g.realizedGainEur >= 0 ? "+" : ""}
                    {formatMoney(g.realizedGainEur)}
                  </td>
                  <td className="num fiscal-col-date">{formatDateTime(g.date)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="fiscal-gains-mobile" aria-hidden="true">
        {gains
          .slice()
          .sort((a, b) => b.date - a.date)
          .map((g) => (
            <div key={`${g.transactionId}_${g.assetId}_m`} className="fiscal-gain-card">
              <div className="fiscal-gain-card-header">
                <span className="fiscal-asset-id">{g.assetId.toUpperCase()}</span>
                <span className="fiscal-gain-date">{formatDateTime(g.date)}</span>
              </div>
              <div className="fiscal-gain-card-row">
                <span>Valor venta</span>
                <span>{formatMoney(g.sellValueEur)}</span>
              </div>
              <div className="fiscal-gain-card-row">
                <span>Coste</span>
                <span>{formatMoney(g.costBasisEur)}</span>
              </div>
              <div className="fiscal-gain-card-row">
                <span>Resultado</span>
                <strong className={g.realizedGainEur >= 0 ? "text-gain" : "text-loss"}>
                  {g.realizedGainEur >= 0 ? "+" : ""}
                  {formatMoney(g.realizedGainEur)}
                </strong>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

function FiscalYearView({ summary }: { summary: FiscalYearSummary }) {
  const netTone =
    summary.netGainEur > 0 ? "positive" : summary.netGainEur < 0 ? "negative" : "neutral";

  return (
    <div className="fiscal-year-view">
      <div className="fiscal-summary-grid">
        <SummaryCard label="Valor vendido" value={formatMoney(summary.totalSellValueEur)} />
        <SummaryCard label="Coste de adquisición" value={formatMoney(summary.totalCostBasisEur)} />
        <SummaryCard
          label="Ganancia / Pérdida neta"
          value={(summary.netGainEur >= 0 ? "+" : "") + formatMoney(summary.netGainEur)}
          tone={netTone}
        />
        <SummaryCard
          label="Impuesto estimado"
          value={formatMoney(summary.estimatedTaxEur, "0,00 €")}
          tone={summary.estimatedTaxEur > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          label="Reserva fiscal recomendada"
          value={formatMoney(summary.reservaRecomendadaEur, "0,00 €")}
          tone={summary.reservaRecomendadaEur > 0 ? "warning" : "neutral"}
        />
      </div>

      {summary.estimatedTaxEur > 0 && (
        <p className="fiscal-tax-note">
          Estimación basada en los tramos del IRPF 2024 para ganancias patrimoniales del ahorro (España).
          No constituye asesoramiento fiscal. Consulta a un asesor antes de declarar.
        </p>
      )}

      <Card className="fiscal-detail-card">
        <CardHeader>
          <CardTitle>Operaciones con impacto fiscal — {summary.year}</CardTitle>
          <p className="panel-caption">
            {summary.gains.length} operación{summary.gains.length !== 1 ? "es" : ""} con valor de venta registrado
          </p>
        </CardHeader>
        <CardContent>
          <GainsTable gains={summary.gains} />
        </CardContent>
      </Card>
    </div>
  );
}

function FiscalEmptyState({ diagnostics }: { diagnostics: FiscalDiagnostics }) {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={<Receipt size={40} />}
          title="Sin ganancias realizadas calculables"
          description={diagnostics.reason}
        />
        <dl className="stats-list fiscal-diagnostics-list">
          <div><dt>Operaciones registradas</dt><dd>{diagnostics.transactionCount}</dd></div>
          <div><dt>Ventas / conversiones</dt><dd>{diagnostics.disposalCount}</dd></div>
          <div><dt>Con valoración EUR</dt><dd>{diagnostics.valuedDisposalCount}</dd></div>
          <div><dt>Pendientes de valoración</dt><dd>{diagnostics.pendingDisposalCount}</dd></div>
          <div><dt>Ganancias FIFO</dt><dd>{diagnostics.gainsCount}</dd></div>
          <div><dt>Sin fecha fiscal</dt><dd>{diagnostics.missingDateGains}</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function Fiscalidad() {
  const { isLoading, isError, errorMessage, summaries, diagnostics } = useFiscalData();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const years = summaries.map((s) => s.year);
  const activeYear = selectedYear ?? years[0] ?? null;
  const activeSummary = summaries.find((s) => s.year === activeYear) ?? null;

  if (isLoading) return <LoadingState message="Calculando datos fiscales..." />;
  if (isError) return <ErrorState message={errorMessage} />;

  return (
    <div className="fiscal-page">
      <PageToolbar
        title="Fiscalidad"
        eyebrow="IRPF — Ganancias patrimoniales del ahorro"
        meta={
          summaries.length > 0
            ? `${summaries.length} año${summaries.length !== 1 ? "s" : ""} con actividad`
            : undefined
        }
      />

      {summaries.length === 0 ? (
        <FiscalEmptyState diagnostics={diagnostics} />
      ) : (
        <>
          {years.length > 1 && (
            <FiscalYearSelector
              years={years}
              selected={activeYear!}
              onSelect={setSelectedYear}
            />
          )}
          {activeSummary && <FiscalYearView summary={activeSummary} />}
        </>
      )}
    </div>
  );
}
