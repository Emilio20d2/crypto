import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { getAssetMetadata } from "./mapping";
import { MarketNotFoundError } from "./errors";

export * from "./interfaces";
export * from "./coinbase";
export * from "./coingecko";
export * from "./mapping";
export * from "./errors";

export class MarketService {
  private coinbase = new CoinbaseProvider();
  private coingecko = new CoinGeckoProvider();

  // Orquestador con Fallback
  async getCurrentPrice(assetId: string, signal?: AbortSignal): Promise<number> {
    const meta = getAssetMetadata(assetId);
    if (!meta) throw new MarketNotFoundError(`Asset mapping not found for ${assetId}`);

    // Try Coinbase first if supported
    if (meta.supportedProviders.includes("coinbase")) {
      try {
        return await this.coinbase.getCurrentPrice(meta, signal);
      } catch (e: any) {
        if (e.name === "AbortError") throw e;
        console.warn(`Coinbase getCurrentPrice failed for ${assetId}:`, e.message, "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      return await this.coingecko.getCurrentPrice(meta, signal);
    }

    throw new MarketNotFoundError(`No providers available for ${assetId}`);
  }

  async getHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    const meta = getAssetMetadata(assetId);
    if (!meta) throw new MarketNotFoundError(`Asset mapping not found for ${assetId}`);

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        return await this.coinbase.getHistoricalPrices(meta, period, signal);
      } catch (e: any) {
        if (e.name === "AbortError") throw e;
        console.warn(`Coinbase getHistoricalPrices failed for ${assetId}:`, e.message, "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      return await this.coingecko.getHistoricalPrices(meta, period, signal);
    }

    throw new MarketNotFoundError(`No providers available for ${assetId} historical data`);
  }
}
