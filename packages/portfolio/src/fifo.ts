import type { TransactionInput } from "./types";
import type { RealizedGain } from "./schemas";

export interface FifoLot {
  id: string;
  assetId: string;
  transactionId: string;
  date: number;
  originalAmount: number;
  remainingAmount: number;
  unitAcquisitionPriceEur: number;
}

export interface LotConsumption {
  id: string;
  lotId: string;
  transactionId: string;
  amountConsumed: number;
  unitSellPriceEur: number;
  realizedGainEur: number;
  date: number;
}

export class FifoCalculator {
  calculate(transactions: TransactionInput[]): { lots: FifoLot[], consumptions: LotConsumption[], realizedGains: RealizedGain[] } {
    const sorted = [...transactions].sort((a, b) => a.date - b.date);
    const lots: FifoLot[] = [];
    const consumptions: LotConsumption[] = [];
    const realizedGains: RealizedGain[] = [];

    let lotCounter = 1;
    let consumptionCounter = 1;

    for (const tx of sorted) {
      // Group legs by asset
      const assetImpacts: Record<string, { amount: number; valuation: number | undefined }> = {};

      for (const leg of tx.legs) {
        if (!assetImpacts[leg.assetId]) {
          assetImpacts[leg.assetId] = { amount: 0, valuation: undefined };
        }
        assetImpacts[leg.assetId].amount += leg.amount;
        if (leg.valuationEur !== undefined) {
          assetImpacts[leg.assetId].valuation = (assetImpacts[leg.assetId].valuation || 0) + leg.valuationEur;
        }
      }

      for (const assetId in assetImpacts) {
        const impact = assetImpacts[assetId];

        if (impact.amount > 0 && tx.type !== "transfer_in" && tx.type !== "transfer_out") {
          // Inflow that is not a transfer -> Create Lot
          if (impact.valuation !== undefined) {
            lots.push({
              id: `lot_${tx.id}_${lotCounter++}`,
              assetId,
              transactionId: tx.id,
              date: tx.date,
              originalAmount: impact.amount,
              remainingAmount: impact.amount,
              unitAcquisitionPriceEur: impact.valuation / impact.amount
            });
          }
        } else if (impact.amount < 0 && tx.type !== "transfer_in" && tx.type !== "transfer_out") {
          // Outflow that is not a transfer -> Consume Lots
          let amountToConsume = Math.abs(impact.amount);
          let remainingSellValue = impact.valuation !== undefined ? Math.abs(impact.valuation) : 0;
          const unitSellPriceEur = impact.valuation !== undefined ? remainingSellValue / amountToConsume : 0;

          // Find available lots for this asset
          const availableLots = lots.filter(l => l.assetId === assetId && l.remainingAmount > 0).sort((a, b) => a.date - b.date);

          let totalCostBasis = 0;
          let totalSellValueForGains = 0;

          for (const lot of availableLots) {
            if (amountToConsume <= 0) break;

            const consumed = Math.min(lot.remainingAmount, amountToConsume);
            lot.remainingAmount -= consumed;
            amountToConsume -= consumed;

            const costBasis = consumed * lot.unitAcquisitionPriceEur;
            const sellValueForThisLot = consumed * unitSellPriceEur;
            const gain = sellValueForThisLot - costBasis;

            totalCostBasis += costBasis;
            totalSellValueForGains += sellValueForThisLot;

            if (impact.valuation !== undefined) {
              consumptions.push({
                id: `cons_${tx.id}_${consumptionCounter++}`,
                lotId: lot.id,
                transactionId: tx.id,
                amountConsumed: consumed,
                unitSellPriceEur,
                realizedGainEur: gain,
                date: tx.date
              });
            }
          }

          if (impact.valuation !== undefined) {
             realizedGains.push({
               transactionId: tx.id,
               assetId,
               amountSold: Math.abs(impact.amount) - amountToConsume, // What was actually consumed
               sellValueEur: totalSellValueForGains,
               costBasisEur: totalCostBasis,
               realizedGainEur: totalSellValueForGains - totalCostBasis
             });
          }
        }
      }
    }

    return { lots, consumptions, realizedGains };
  }
}
