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
  }
};

export function getAssetMetadata(assetId: string): AssetMetadata | undefined {
  return ASSET_MAP[assetId];
}
