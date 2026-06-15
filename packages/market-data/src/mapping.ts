export interface AssetMetadata {
  internalId: string;
  symbol: string;
  coinGeckoId: string;
  coinbaseProductId: string;
  quoteCurrency: string;
  supportedProviders: ("coingecko" | "coinbase")[];
}

export const ASSET_MAP: Record<string, AssetMetadata> = {
  "BTC": {
    internalId: "BTC",
    symbol: "BTC",
    coinGeckoId: "bitcoin",
    coinbaseProductId: "BTC-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "ETH": {
    internalId: "ETH",
    symbol: "ETH",
    coinGeckoId: "ethereum",
    coinbaseProductId: "ETH-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "SOL": {
    internalId: "SOL",
    symbol: "SOL",
    coinGeckoId: "solana",
    coinbaseProductId: "SOL-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "TON": {
    internalId: "TON",
    symbol: "TON",
    coinGeckoId: "the-open-network",
    coinbaseProductId: "TON-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "XLM": {
    internalId: "XLM",
    symbol: "XLM",
    coinGeckoId: "stellar",
    coinbaseProductId: "XLM-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "USDC": {
    internalId: "USDC",
    symbol: "USDC",
    coinGeckoId: "usd-coin",
    coinbaseProductId: "USDC-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "ADA": {
    internalId: "ADA",
    symbol: "ADA",
    coinGeckoId: "cardano",
    coinbaseProductId: "ADA-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "SUI": {
    internalId: "SUI",
    symbol: "SUI",
    coinGeckoId: "sui",
    coinbaseProductId: "SUI-EUR", // Check if coinbase supports SUI-EUR
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "SEI": {
    internalId: "SEI",
    symbol: "SEI",
    coinGeckoId: "sei-network",
    coinbaseProductId: "SEI-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "EURC": {
    internalId: "EURC",
    symbol: "EURC",
    coinGeckoId: "euro-coin",
    coinbaseProductId: "EURC-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  },
  "LMTS": {
    internalId: "LMTS",
    symbol: "LMTS",
    coinGeckoId: "limitless-3",
    coinbaseProductId: "LMTS-EUR",
    quoteCurrency: "EUR",
    supportedProviders: ["coingecko", "coinbase"]
  }
};

export function getAssetMetadata(assetId: string): AssetMetadata | undefined {
  return ASSET_MAP[assetId];
}
