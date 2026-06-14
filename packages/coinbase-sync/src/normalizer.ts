import type { CoinbaseFill } from "./types";

export type TransactionType =
  | "buy"
  | "sell"
  | "convert"
  | "transfer_in"
  | "transfer_out"
  | "reward"
  | "staking"
  | "airdrop"
  | "fee"
  | "adjustment";

export interface NormalizedLeg {
  assetId: string;
  amount: number;
  legType: "source" | "destination" | "fee";
  acquisitionValueEur: number | null;
  unitAcquisitionPriceEur: number | null;
  valuationStatus: "valued" | "pending" | "estimated";
}

export interface NormalizedFee {
  assetId: string;
  amount: number;
}

export interface NormalizedTransaction {
  externalId: string;
  type: TransactionType;
  date: number; // ms
  legs: NormalizedLeg[];
  fees: NormalizedFee[];
  requiredAssets: { id: string; symbol: string; name: string; type: "crypto" | "fiat" }[];
}

const FIAT_QUOTE_CURRENCIES = new Set(["EUR", "GBP", "USD"]);
const STABLE_QUOTE_CURRENCIES = new Set(["USDC", "USDT", "DAI"]);

function parseProductId(productId: string): { base: string; quote: string } {
  const parts = productId.split("-");
  if (parts.length !== 2) throw new Error(`Formato de producto no reconocido: ${productId}`);
  return { base: parts[0], quote: parts[1] };
}

function assetRecord(
  symbol: string,
  type: "crypto" | "fiat" = "crypto"
): { id: string; symbol: string; name: string; type: "crypto" | "fiat" } {
  const KNOWN_NAMES: Record<string, string> = {
    BTC: "Bitcoin",
    ETH: "Ethereum",
    ADA: "Cardano",
    SOL: "Solana",
    SUI: "Sui",
    SEI: "Sei",
    XRP: "Ripple",
    DOGE: "Dogecoin",
    LINK: "Chainlink",
    MATIC: "Polygon",
    DOT: "Polkadot",
    AVAX: "Avalanche",
    UNI: "Uniswap",
    LTC: "Litecoin",
    BCH: "Bitcoin Cash",
    EURC: "Euro Coin",
    USDC: "USD Coin",
    USDT: "Tether",
    DAI: "Dai",
    EUR: "Euro",
    GBP: "British Pound",
    USD: "US Dollar",
  };
  return {
    id: symbol,
    symbol,
    name: KNOWN_NAMES[symbol] ?? symbol,
    type,
  };
}

export function normalizeFill(fill: CoinbaseFill): NormalizedTransaction {
  const { base, quote } = parseProductId(fill.product_id);

  const price = parseFloat(fill.price);
  const size = parseFloat(fill.size);
  const commission = parseFloat(fill.commission);
  const sizeInQuote = fill.size_in_quote;

  // Compute actual base and quote amounts
  const baseAmount = sizeInQuote ? size / price : size;
  const quoteAmount = sizeInQuote ? size : size * price;

  const dateMs = new Date(fill.trade_time).getTime();
  const isEurPair = FIAT_QUOTE_CURRENCIES.has(quote) && quote === "EUR";
  const isStablePair = STABLE_QUOTE_CURRENCIES.has(quote);
  // Treat stables as ~1 EUR for rough valuation (marked estimated)
  const stableToEurRate = isStablePair ? 1 : null;

  const requiredAssets: NormalizedTransaction["requiredAssets"] = [];

  // Base asset
  if (!FIAT_QUOTE_CURRENCIES.has(base)) {
    requiredAssets.push(assetRecord(base, "crypto"));
  }

  // Quote asset (needed for fees)
  if (FIAT_QUOTE_CURRENCIES.has(quote)) {
    requiredAssets.push(assetRecord(quote, "fiat"));
  } else if (STABLE_QUOTE_CURRENCIES.has(quote)) {
    requiredAssets.push(assetRecord(quote, "crypto"));
  } else {
    requiredAssets.push(assetRecord(quote, "crypto"));
  }

  const isCryptoQuote = !FIAT_QUOTE_CURRENCIES.has(quote) && !STABLE_QUOTE_CURRENCIES.has(quote);

  const legs: NormalizedLeg[] = [];
  const fees: NormalizedFee[] = [];
  let type: TransactionType;

  if (isCryptoQuote) {
    // Crypto-to-crypto trade → convert
    type = "convert";

    if (fill.side === "BUY") {
      // Buying base with quote (e.g., buying BTC with ETH)
      legs.push({
        assetId: quote,
        amount: -quoteAmount,
        legType: "source",
        acquisitionValueEur: null,
        unitAcquisitionPriceEur: null,
        valuationStatus: "pending",
      });
      legs.push({
        assetId: base,
        amount: baseAmount,
        legType: "destination",
        acquisitionValueEur: null,
        unitAcquisitionPriceEur: null,
        valuationStatus: "pending",
      });
    } else {
      // Selling base for quote (e.g., selling BTC for ETH)
      legs.push({
        assetId: base,
        amount: -baseAmount,
        legType: "source",
        acquisitionValueEur: null,
        unitAcquisitionPriceEur: null,
        valuationStatus: "pending",
      });
      legs.push({
        assetId: quote,
        amount: quoteAmount,
        legType: "destination",
        acquisitionValueEur: null,
        unitAcquisitionPriceEur: null,
        valuationStatus: "pending",
      });
    }
  } else if (fill.side === "BUY") {
    type = "buy";

    const totalEur = isEurPair
      ? quoteAmount + commission
      : isStablePair && stableToEurRate
        ? (quoteAmount + commission) * stableToEurRate
        : null;
    const unitPrice =
      totalEur !== null && baseAmount > 0 ? totalEur / baseAmount : null;

    legs.push({
      assetId: base,
      amount: baseAmount,
      legType: "destination",
      acquisitionValueEur: totalEur,
      unitAcquisitionPriceEur: unitPrice,
      valuationStatus: isEurPair ? "valued" : isStablePair ? "estimated" : "pending",
    });
  } else {
    type = "sell";

    const saleEur = isEurPair
      ? quoteAmount - commission
      : isStablePair && stableToEurRate
        ? (quoteAmount - commission) * stableToEurRate
        : null;
    const unitPrice =
      saleEur !== null && baseAmount > 0 ? saleEur / baseAmount : null;

    legs.push({
      assetId: base,
      amount: -baseAmount,
      legType: "source",
      acquisitionValueEur: saleEur,
      unitAcquisitionPriceEur: unitPrice,
      valuationStatus: isEurPair ? "valued" : isStablePair ? "estimated" : "pending",
    });
  }

  if (commission > 0) {
    fees.push({ assetId: quote, amount: commission });
  }

  return {
    externalId: fill.entry_id,
    type,
    date: dateMs,
    legs,
    fees,
    requiredAssets,
  };
}

import type { V2Transaction } from "./types";

export function normalizeV2Transactions(txs: V2Transaction[]): NormalizedTransaction[] {
  const normalized: NormalizedTransaction[] = [];
  
  // Group by trade/buy/sell IDs
  const groupedTxs = new Map<string, V2Transaction[]>();
  
  for (const tx of txs) {
    if (tx.status !== "completed") continue;
    if (tx.type === "advanced_trade_fill") continue;
    
    // TEMPORARY LOG FOR DEBUGGING
    // TEMPORARY LOG FOR DEBUGGING
    console.log(`[V2_DUMP_TX_ALL] Type: ${tx.type}, Keys: ${Object.keys(tx).join(", ")}`);
    if (tx.type !== "send" && tx.type !== "receive" && tx.type !== "exchange_deposit" && tx.type !== "exchange_withdrawal") {
        console.log(`[V2_DUMP_TX_PAYLOAD]`, JSON.stringify(tx));
    }
    
    let groupId: string | null = null;
    if (tx.type === "trade" && tx.trade?.id) groupId = `trade_${tx.trade.id}`;
    else if (tx.type === "buy" && tx.buy?.id) groupId = `buy_${tx.buy.id}`;
    else if (tx.type === "sell" && tx.sell?.id) groupId = `sell_${tx.sell.id}`;
    
    if (groupId) {
      const group = groupedTxs.get(groupId) || [];
      group.push(tx);
      groupedTxs.set(groupId, group);
      continue;
    }
    
    // Process standalone transaction
    const norm = processStandaloneV2(tx);
    if (norm) normalized.push(norm);
  }
  
  // Process grouped trades (Conversions, Buys, Sells)
  for (const [groupId, group] of groupedTxs.entries()) {
    if (group.length === 0) continue;
    
    if (groupId.startsWith("trade_")) {
      const requiredAssets: NormalizedTransaction["requiredAssets"] = [];
      const legs: NormalizedLeg[] = [];
      let dateMs = new Date(group[0].created_at).getTime();
      
      for (const tx of group) {
        const baseAsset = tx.amount.currency;
        const baseAmount = parseFloat(tx.amount.amount);
        requiredAssets.push(assetRecord(baseAsset, FIAT_QUOTE_CURRENCIES.has(baseAsset) ? "fiat" : "crypto"));
        
        legs.push({
          assetId: baseAsset,
          amount: baseAmount,
          legType: baseAmount > 0 ? "destination" : "source",
          acquisitionValueEur: null,
          unitAcquisitionPriceEur: null,
          valuationStatus: "pending",
        });
      }
      
      normalized.push({
        externalId: groupId.replace("trade_", ""),
        type: "convert",
        date: dateMs,
        legs,
        fees: [],
        requiredAssets,
      });
    } else if (groupId.startsWith("buy_") || groupId.startsWith("sell_")) {
      const type = groupId.startsWith("buy_") ? "buy" : "sell";
      const externalId = groupId.replace(type + "_", "");
      
      const cryptoTx = group.find(t => !FIAT_QUOTE_CURRENCIES.has(t.amount.currency));
      const fiatTx = group.find(t => FIAT_QUOTE_CURRENCIES.has(t.amount.currency));
      
      if (!cryptoTx) {
        const fallback = fiatTx ? processStandaloneV2(fiatTx) : null;
        if (fallback) normalized.push(fallback);
        continue;
      }
      
      const dateMs = new Date(cryptoTx.created_at).getTime();
      const cryptoAsset = cryptoTx.amount.currency;
      const cryptoAmount = parseFloat(cryptoTx.amount.amount); 
      
      const fiatAsset = cryptoTx.native_amount.currency;
      const fiatValue = Math.abs(parseFloat(cryptoTx.native_amount.amount)); 
      
      const requiredAssets: NormalizedTransaction["requiredAssets"] = [];
      requiredAssets.push(assetRecord(cryptoAsset, "crypto"));
      if (FIAT_QUOTE_CURRENCIES.has(fiatAsset)) {
        requiredAssets.push(assetRecord(fiatAsset, "fiat"));
      } else {
        requiredAssets.push(assetRecord(fiatAsset, "crypto"));
      }
      
      const legs: NormalizedLeg[] = [];
      
      if (type === "buy") {
        legs.push({
          assetId: cryptoAsset,
          amount: Math.abs(cryptoAmount),
          legType: "destination",
          acquisitionValueEur: fiatValue,
          unitAcquisitionPriceEur: Math.abs(cryptoAmount) > 0 ? fiatValue / Math.abs(cryptoAmount) : null,
          valuationStatus: "valued"
        });
        legs.push({
          assetId: fiatAsset,
          amount: -fiatValue,
          legType: "source",
          acquisitionValueEur: fiatValue,
          unitAcquisitionPriceEur: 1,
          valuationStatus: "valued"
        });
      } else {
        legs.push({
          assetId: cryptoAsset,
          amount: -Math.abs(cryptoAmount),
          legType: "source",
          acquisitionValueEur: fiatValue,
          unitAcquisitionPriceEur: Math.abs(cryptoAmount) > 0 ? fiatValue / Math.abs(cryptoAmount) : null,
          valuationStatus: "valued"
        });
        legs.push({
          assetId: fiatAsset,
          amount: fiatValue,
          legType: "destination",
          acquisitionValueEur: fiatValue,
          unitAcquisitionPriceEur: 1,
          valuationStatus: "valued"
        });
      }

      normalized.push({
        externalId,
        type,
        date: dateMs,
        legs,
        fees: [],
        requiredAssets,
      });
    }
  }
  
  return normalized;
}

function processStandaloneV2(tx: V2Transaction): NormalizedTransaction | null {
  const dateMs = new Date(tx.created_at).getTime();
  const baseAsset = tx.amount.currency;
  const baseAmount = parseFloat(tx.amount.amount);
  
  const fiatAsset = tx.native_amount.currency;
  const fiatValue = parseFloat(tx.native_amount.amount);
  
  const requiredAssets: NormalizedTransaction["requiredAssets"] = [];
  requiredAssets.push(assetRecord(baseAsset, FIAT_QUOTE_CURRENCIES.has(baseAsset) ? "fiat" : "crypto"));
  if (fiatAsset !== baseAsset && FIAT_QUOTE_CURRENCIES.has(fiatAsset)) {
    requiredAssets.push(assetRecord(fiatAsset, "fiat"));
  }

  const legs: NormalizedLeg[] = [];
  let type: TransactionType;

  if (tx.type === "buy") {
    type = "buy";
    legs.push({
      assetId: baseAsset,
      amount: baseAmount,
      legType: "destination",
      acquisitionValueEur: fiatValue,
      unitAcquisitionPriceEur: baseAmount > 0 ? fiatValue / baseAmount : null,
      valuationStatus: "valued",
    });
  } else if (tx.type === "sell") {
    type = "sell";
    legs.push({
      assetId: baseAsset,
      amount: baseAmount, 
      legType: "source",
      acquisitionValueEur: Math.abs(fiatValue),
      unitAcquisitionPriceEur: Math.abs(baseAmount) > 0 ? Math.abs(fiatValue) / Math.abs(baseAmount) : null,
      valuationStatus: "valued",
    });
  } else if (tx.type === "send" || tx.type === "exchange_withdrawal") {
    type = "transfer_out";
    legs.push({
      assetId: baseAsset,
      amount: baseAmount < 0 ? baseAmount : -baseAmount,
      legType: "source",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  } else if (tx.type === "receive" || tx.type === "exchange_deposit") {
    type = "transfer_in";
    legs.push({
      assetId: baseAsset,
      amount: Math.abs(baseAmount),
      legType: "destination",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  } else if (tx.type === "staking_reward" || tx.type === "interest" || tx.type === "reward") {
    type = "reward";
    legs.push({
      assetId: baseAsset,
      amount: Math.abs(baseAmount),
      legType: "destination",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  } else if (tx.type === "fiat_deposit") {
    type = "transfer_in";
    legs.push({
      assetId: baseAsset,
      amount: Math.abs(baseAmount),
      legType: "destination",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  } else if (tx.type === "fiat_withdrawal") {
    type = "transfer_out";
    legs.push({
      assetId: baseAsset,
      amount: -Math.abs(baseAmount),
      legType: "source",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  } else {
    type = "adjustment";
    legs.push({
      assetId: baseAsset,
      amount: baseAmount,
      legType: baseAmount > 0 ? "destination" : "source",
      acquisitionValueEur: null,
      unitAcquisitionPriceEur: null,
      valuationStatus: "pending",
    });
  }

  // Fees are often embedded in the sub-objects (tx.buy.fee, etc) but for now
  // native fiat Value encapsulates the gross/net.
  
  return {
    externalId: tx.id,
    type,
    date: dateMs,
    legs,
    fees: [],
    requiredAssets,
  };
}
