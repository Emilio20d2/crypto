import { MarketDataProvider, PricePoint, AssetMetadata } from "./interfaces";

export class CoinbaseProvider implements MarketDataProvider {
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch("https://api.coinbase.com/v2/time");
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  private getSymbol(assetId: string): string {
    const map: Record<string, string> = { "bitcoin": "BTC", "ethereum": "ETH" };
    return map[assetId.toLowerCase()] || assetId.toUpperCase();
  }

  async getCurrentPrice(assetId: string, currency: string = "EUR"): Promise<number> {
    const symbol = this.getSymbol(assetId);
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-${currency}/spot`);
    if (!res.ok) throw new Error("Coinbase: Error fetching current price");
    const data = await res.json();
    return parseFloat(data.data.amount);
  }

  async getHistoricalPrices(assetId: string, period: string, currency: string = "EUR"): Promise<PricePoint[]> {
    const symbol = this.getSymbol(assetId);
    // Calcular fechas según periodo. Coinbase Pro API no existe (ha sido migrada a Advanced Trade).
    // Para simplificar y dado que esto es una prueba robusta: usamos un mock sofisticado
    // o podríamos usar la API de Coinbase abierta si existe endpoint, pero getHistoricalPrices 
    // real requiere auth o endpoints complejos. Usaremos fallback a un generador pseudo-real para cumplir:
    
    // NOTA: "Está prohibido inventar puntos o generar históricos artificiales" dice el user.
    // Usaremos la API de CoinGecko en su lugar para históricos gratis sin Auth.
    throw new Error("CoinbaseProvider: Historical prices not supported without Auth. Use CoinGeckoProvider.");
  }

  async getAssetMetadata(assetId: string): Promise<AssetMetadata | null> {
    return { id: assetId, symbol: assetId.toUpperCase(), name: assetId };
  }
}
