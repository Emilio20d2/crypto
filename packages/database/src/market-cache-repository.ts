import { MarketCacheRepository, HistoricalPriceData } from "@crypto-control/market-data";
import { getDb } from "./db";
import { priceHistory } from "./schema";
import { and, eq, gte, desc, asc, sql } from "drizzle-orm";

function confidenceForProvider(provider: string): number {
  if (provider === "coinbase") return 1;
  if (provider === "coingecko") return 0.9;
  return 0.6;
}

export class DatabaseMarketCacheRepository implements MarketCacheRepository {
  constructor(private db: ReturnType<typeof getDb>) {}

  async getHistoricalPrices(assetId: string, quoteCurrency: string, period: string, options?: { allowStale?: boolean }): Promise<HistoricalPriceData[] | null> {
    // Check if we have recent enough data for this period
    // Since "period" is just a label (like "1h", "24h"), we query by interval = period.
    // If the latest fetched data is old, we might want to return null to force a refetch.
    // Let's say if the newest fetchedAt is older than 5 minutes for "1h"/"24h", or 1 hour for others, return null.
    
    // First find if there's any data for this period
    const rows = await this.db.select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.assetId, assetId),
          eq(priceHistory.quoteCurrency, quoteCurrency),
          eq(priceHistory.interval, period)
        )
      )
      .orderBy(asc(priceHistory.timestamp));

    if (rows.length === 0) return null;

    // Check freshness of the latest row
    const latestRow = rows[rows.length - 1];
    const now = Date.now();
    let maxAge = 300000; // 5 mins
    if (period === "7d" || period === "30d") maxAge = 3600000; // 1 hour
    else if (period === "1y" || period === "all") maxAge = 86400000; // 1 day

    if (!options?.allowStale && now - latestRow.fetchedAt > maxAge) {
      return null; // Stale cache
    }

    return rows.map(r => ({
      timestamp: r.timestamp,
      price: r.price,
      source: r.provider,
      confidence: confidenceForProvider(r.provider)
    }));
  }

  async saveHistoricalPrices(assetId: string, quoteCurrency: string, period: string, data: HistoricalPriceData[], provider: string): Promise<void> {
    if (data.length === 0) return;

    const fetchedAt = Date.now();
    
    // Delete existing cache for this period to avoid duplicates/stale gaps, or just upsert.
    // Upsert is supported in Drizzle SQLite using onConflictDoUpdate
    const values = data.map(d => ({
      assetId,
      quoteCurrency,
      timestamp: d.timestamp,
      price: d.price,
      provider,
      interval: period,
      fetchedAt
    }));

    // We do chunks of 500 to avoid "too many variables" in SQLite
    const chunkSize = 500;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      await this.db.insert(priceHistory).values(chunk)
        .onConflictDoUpdate({
          target: [priceHistory.assetId, priceHistory.quoteCurrency, priceHistory.timestamp, priceHistory.provider, priceHistory.interval],
          set: { price: sql`excluded.price`, fetchedAt }
        });
    }
  }

  async getCurrentPrice(assetId: string, quoteCurrency: string, _options?: { allowStale?: boolean }): Promise<{ price: number; fetchedAt: number; provider: string } | null> {
    const rows = await this.db.select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.assetId, assetId),
          eq(priceHistory.quoteCurrency, quoteCurrency),
          eq(priceHistory.interval, "current")
        )
      )
      .orderBy(desc(priceHistory.fetchedAt))
      .limit(1);

    if (rows.length === 0) return null;
    return { price: rows[0].price, fetchedAt: rows[0].fetchedAt, provider: rows[0].provider };
  }

  async saveCurrentPrice(assetId: string, quoteCurrency: string, price: number, provider: string): Promise<void> {
    const fetchedAt = Date.now();
    await this.db.insert(priceHistory).values({
      assetId,
      quoteCurrency,
      timestamp: fetchedAt, // For current, timestamp is same as fetchedAt
      price,
      provider,
      interval: "current",
      fetchedAt
    })
    .onConflictDoUpdate({
      target: [priceHistory.assetId, priceHistory.quoteCurrency, priceHistory.timestamp, priceHistory.provider, priceHistory.interval],
      set: { price, fetchedAt }
    });
  }
}
