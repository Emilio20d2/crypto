import { MarketDataProvider, PricePoint, AssetMetadata } from "./interfaces";

export class CoinGeckoProvider implements MarketDataProvider {
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/ping");
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async getCurrentPrice(assetId: string, currency: string = "eur"): Promise<number> {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=${currency}`);
    if (!res.ok) throw new Error("CoinGecko: Error fetching current price");
    const data = await res.json();
    if (!data[assetId] || !data[assetId][currency.toLowerCase()]) {
      throw new Error("CoinGecko: Asset or currency not found");
    }
    return data[assetId][currency.toLowerCase()];
  }

  async getHistoricalPrices(assetId: string, period: string, currency: string = "eur"): Promise<PricePoint[]> {
    let days = "1";
    switch (period) {
      case "1h":
        days = "1"; // Obtendremos 24h y filtraremos
        break;
      case "24h": days = "1"; break;
      case "7d": days = "7"; break;
      case "30d": days = "30"; break;
      case "1y": days = "365"; break;
      case "all": days = "max"; break;
      default: days = "1";
    }

    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${assetId}/market_chart?vs_currency=${currency.toLowerCase()}&days=${days}`);
    if (!res.ok) throw new Error(`CoinGecko: Error fetching historical prices for ${period}`);
    
    const data = await res.json();
    let prices: [number, number][] = data.prices;

    if (period === "1h") {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      prices = prices.filter(p => p[0] >= oneHourAgo);
    }

    return prices.map(p => ({
      timestamp: p[0],
      price: p[1]
    }));
  }

  async getAssetMetadata(assetId: string): Promise<AssetMetadata | null> {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${assetId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      symbol: data.symbol.toUpperCase(),
      name: data.name,
      logoUrl: data.image?.small
    };
  }
}
