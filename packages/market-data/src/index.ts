export * from "./interfaces";
export * from "./coinbase";
export * from "./coingecko";

import { MarketDataProvider } from "./interfaces";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";

export class MarketService {
  private coinbase = new CoinbaseProvider();
  private coingecko = new CoinGeckoProvider();

  // Orquestador con Fallback
  async getCurrentPrice(assetId: string, currency: string = "EUR"): Promise<number> {
    try {
      return await this.coinbase.getCurrentPrice(assetId, currency);
    } catch (e) {
      console.warn("Coinbase falló, haciendo fallback a CoinGecko");
      return await this.coingecko.getCurrentPrice(assetId, currency);
    }
  }

  async getHistoricalPrices(assetId: string, period: string, currency: string = "EUR") {
    // Coinbase no soporta historial gratis sin auth, siempre usamos coingecko
    return await this.coingecko.getHistoricalPrices(assetId, period, currency);
  }
}
