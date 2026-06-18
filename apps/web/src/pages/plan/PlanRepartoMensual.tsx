import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { formatMoney } from "../../lib/format";
import type { Asset, InvestmentAsset, Result } from "@crypto-control/core";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function getPct(item: InvestmentAsset): number | null {
  return item.allocationPercentage ?? (item.allocationType === "percentage" ? item.allocationValue : null);
}

function getFixed(item: InvestmentAsset): number | null {
  return item.fixedAmountEur ?? (item.allocationType === "amount" ? item.allocationValue : null);
}

type DistributionRow = {
  id: string;
  symbol: string;
  pct: number | null;
  fixed: number | null;
  monthly: number;
};

export function PlanRepartoMensual({
  cycleId,
  monthlyAmountEur,
}: {
  cycleId: string;
  monthlyAmountEur: number;
}) {
  const globalAssetsQ = useQuery({
    queryKey: ["assets"],
    queryFn: () => unwrap(window.cryptoControl.assets.list()),
  });
  const globalAssets: Asset[] = globalAssetsQ.data ?? [];

  const assetsQ = useQuery({
    queryKey: ["investment-assets"],
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()),
  });
  const active: InvestmentAsset[] = (assetsQ.data ?? []).filter(
    a => a.cycleId === cycleId && a.status === "active" && a.isActive,
  );

  const rows: DistributionRow[] = active.map(a => {
    const pct = getPct(a);
    const fixed = getFixed(a);
    const monthly = pct !== null ? monthlyAmountEur * pct / 100 : fixed ?? 0;
    const asset = globalAssets.find(g => g.id === a.assetId);
    return { id: a.id, symbol: asset?.symbol ?? a.assetId, pct, fixed, monthly };
  });

  const hasPct = rows.some(r => r.pct !== null);
  const hasFixed = rows.some(r => r.fixed !== null);
  const pctTotal = rows.reduce((s, r) => s + (r.pct ?? 0), 0);
  const fixedTotal = rows.reduce((s, r) => s + (r.fixed ?? 0), 0);

  const warnings: string[] = [];
  if (hasPct && Math.abs(pctTotal - 100) > 0.01) {
    if (pctTotal < 100) {
      warnings.push(
        `Queda un ${(100 - pctTotal).toLocaleString("es-ES", { maximumFractionDigits: 1 })}% pendiente de asignar.`,
      );
    } else {
      warnings.push(
        `El reparto supera el 100% en un ${(pctTotal - 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })}%.`,
      );
    }
  }
  if (hasFixed && fixedTotal > monthlyAmountEur + 0.01) {
    warnings.push(
      `El reparto supera la aportación mensual en ${formatMoney(fixedTotal - monthlyAmountEur)}.`,
    );
  } else if (hasFixed && fixedTotal < monthlyAmountEur - 0.01) {
    warnings.push(
      `Quedan ${formatMoney(monthlyAmountEur - fixedTotal)} pendientes de asignar.`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reparto mensual</CardTitle>
        <span className="badge">{formatMoney(monthlyAmountEur)}/mes</span>
      </CardHeader>
      <CardContent>
        {warnings.map(w => (
          <p key={w} className="cycle-summary-warning">{w}</p>
        ))}

        {rows.length === 0 ? (
          <p className="empty-inline">Sin monedas activas que mostrar.</p>
        ) : (
          <div className="reparto-list" role="list">
            {rows.map(row => (
              <div key={row.id} className="reparto-row" role="listitem">
                <strong className="reparto-symbol">{row.symbol}</strong>
                <span className="reparto-alloc">
                  {row.pct !== null
                    ? `${row.pct.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`
                    : row.fixed !== null
                    ? formatMoney(row.fixed)
                    : "—"}
                </span>
                <span className="reparto-arrow">→</span>
                <span className="reparto-monthly">{formatMoney(row.monthly)}/mes</span>
              </div>
            ))}
            {hasPct ? (
              <div className={`reparto-row reparto-total ${Math.abs(pctTotal - 100) > 0.01 ? "reparto-over" : "reparto-ok"}`}>
                <strong className="reparto-symbol">Total</strong>
                <span className="reparto-alloc">
                  {pctTotal.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%
                </span>
                <span className="reparto-arrow" />
                <span className="reparto-monthly">{formatMoney(monthlyAmountEur)}/mes</span>
              </div>
            ) : null}
          </div>
        )}

        {hasFixed && !hasPct ? (
          <p className="reparto-libre">
            Libre: {formatMoney(Math.max(monthlyAmountEur - fixedTotal, 0))}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
