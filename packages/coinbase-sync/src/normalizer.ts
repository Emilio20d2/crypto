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
