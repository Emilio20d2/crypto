import { MarketCacheRepository, HistoricalPriceData } from "@crypto-control/market-data";
import { getDb, getSqlite } from "./db";
import { priceHistory } from "./schema";
import { and, eq, desc, asc, sql } from "drizzle-orm";

function confidenceForProvider(provider: string): number {
  if (provider === "coinbase") return 1;
  if (provider === "coingecko") return 0.9;
  if (provider === "cryptocompare") return 0.85;
  return 0.6;
}

function maxAgeForPeriod(period: string): number {
  if (period === "1h" || period === "24h") return 5 * 60_000;
  if (period === "7d" || period === "30d") return 60 * 60_000;
  return 24 * 60 * 60_000;
}

function periodWindowMs(period: string): number | null {
  if (period === "1h") return 60 * 60_000;
  if (period === "24h") return 24 * 60 * 60_000;
  if (period === "7d") return 7 * 24 * 60 * 60_000;
  if (period === "30d") return 30 * 24 * 60 * 60_000;
  if (period === "1y") return 365 * 24 * 60 * 60_000;
  return null;
}

function normalizePoint(point: HistoricalPriceData, provider: string): HistoricalPriceData | null {
  if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.price) || point.timestamp <= 0 || point.price <= 0) return null;
  return {
    timestamp: point.timestamp,
    price: point.price,
    open: Number.isFinite(point.open) ? point.open : undefined,
    high: Number.isFinite(point.high) ? point.high : undefined,
    low: Number.isFinite(point.low) ? point.low : undefined,
    volume: Number.isFinite(point.volume) && (point.volume ?? 0) >= 0 ? point.volume : undefined,
    source: point.source ?? provider,
    confidence: point.confidence ?? confidenceForProvider(provider),
  };
}

function mergeSeries(series: HistoricalPriceData[][]): HistoricalPriceData[] {
  const merged = new Map<number, HistoricalPriceData>();
  for (const points of series) {
    for (const point of points) {
      const normalized = normalizePoint(point, point.source ?? "cache");
      if (!normalized) continue;
      const current = merged.get(normalized.timestamp);
      if (!current) {
        merged.set(normalized.timestamp, normalized);
        continue;
      }
      const currentQuality = (current.confidence ?? 0) + (current.volume != null ? 0.05 : 0) + (current.open != null ? 0.02 : 0);
      const nextQuality = (normalized.confidence ?? 0) + (normalized.volume != null ? 0.05 : 0) + (normalized.open != null ? 0.02 : 0);
      if (nextQuality >= currentQuality) merged.set(normalized.timestamp, normalized);
    }
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function scopeSeries(points: HistoricalPriceData[], period: string): HistoricalPriceData[] {
  const windowMs = periodWindowMs(period);
  if (windowMs === null || points.length === 0) return points;
  const latest = points.at(-1)!.timestamp;
  const cutoff = latest - windowMs;
  return points.filter((point) => point.timestamp >= cutoff);
}

export class DatabaseMarketCacheRepository implements MarketCacheRepository {
  constructor(private db: ReturnType<typeof getDb>) {
    this.ensureSeriesCacheTable();
  }

  private ensureSeriesCacheTable(): void {
    const sqlite = getSqlite();
    if (!sqlite) return;
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS market_series_cache_v2 (
        asset_id TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        period TEXT NOT NULL,
        provider TEXT NOT NULL,
        data_json TEXT NOT NULL,
        point_count INTEGER NOT NULL,
        coverage_start INTEGER,
        coverage_end INTEGER,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (asset_id, quote_currency, period, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_market_series_cache_lookup
        ON market_series_cache_v2 (asset_id, quote_currency, period, fetched_at);
    `);
  }

  private readSeriesRows(assetId: string, quoteCurrency: string, period: string): Array<{ data_json: string; provider: string; fetched_at: number }> {
    const sqlite = getSqlite();
    if (!sqlite) return [];
    this.ensureSeriesCacheTable();
    return sqlite.prepare(`
      SELECT data_json, provider, fetched_at
      FROM market_series_cache_v2
      WHERE asset_id = ? AND quote_currency = ? AND period = ?
      ORDER BY fetched_at DESC
    `).all(assetId, quoteCurrency, period) as Array<{ data_json: string; provider: string; fetched_at: number }>;
  }

  private readProviderSeries(assetId: string, quoteCurrency: string, period: string, provider: string): HistoricalPriceData[] {
    const sqlite = getSqlite();
    if (!sqlite) return [];
    this.ensureSeriesCacheTable();
    const row = sqlite.prepare(`
      SELECT data_json
      FROM market_series_cache_v2
      WHERE asset_id = ? AND quote_currency = ? AND period = ? AND provider = ?
    `).get(assetId, quoteCurrency, period, provider) as { data_json: string } | undefined;
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.data_json) as HistoricalPriceData[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async getHistoricalPrices(assetId: string, quoteCurrency: string, period: string, options?: { allowStale?: boolean }): Promise<HistoricalPriceData[] | null> {
    const now = Date.now();
    const maxAge = maxAgeForPeriod(period);
    const rows = this.readSeriesRows(assetId, quoteCurrency, period);
    const eligible = rows.filter((row) => options?.allowStale || now - row.fetched_at <= maxAge);
    const parsed: HistoricalPriceData[][] = [];
    for (const row of eligible) {
      try {
        const value = JSON.parse(row.data_json) as HistoricalPriceData[];
        if (Array.isArray(value)) parsed.push(value.map((point) => ({ ...point, source: point.source ?? row.provider })));
      } catch {
        // Ignore a corrupt compact row; price_history remains the compatibility fallback.
      }
    }
    const fastSeries = scopeSeries(mergeSeries(parsed), period);
    if (fastSeries.length > 0) return fastSeries;

    const legacyRows = await this.db.select()
      .from(priceHistory)
      .where(and(
        eq(priceHistory.assetId, assetId),
        eq(priceHistory.quoteCurrency, quoteCurrency),
        eq(priceHistory.interval, period),
      ))
      .orderBy(asc(priceHistory.timestamp));

    if (legacyRows.length === 0) return null;
    const latest = legacyRows[legacyRows.length - 1];
    if (!options?.allowStale && now - latest.fetchedAt > maxAge) return null;

    return scopeSeries(legacyRows.map((row) => ({
      timestamp: row.timestamp,
      price: row.price,
      source: row.provider,
      confidence: confidenceForProvider(row.provider),
    })), period);
  }

  async saveHistoricalPrices(assetId: string, quoteCurrency: string, period: string, data: HistoricalPriceData[], provider: string): Promise<void> {
    const incoming = data.map((point) => ({ ...point, source: point.source ?? provider }));
    const existing = this.readProviderSeries(assetId, quoteCurrency, period, provider);
    const normalized = scopeSeries(mergeSeries([existing, incoming]), period);
    if (normalized.length === 0) return;

    const fetchedAt = Date.now();
    const sqlite = getSqlite();
    if (sqlite) {
      this.ensureSeriesCacheTable();
      sqlite.prepare(`
        INSERT INTO market_series_cache_v2
          (asset_id, quote_currency, period, provider, data_json, point_count, coverage_start, coverage_end, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, quote_currency, period, provider) DO UPDATE SET
          data_json = excluded.data_json,
          point_count = excluded.point_count,
          coverage_start = excluded.coverage_start,
          coverage_end = excluded.coverage_end,
          fetched_at = excluded.fetched_at
      `).run(
        assetId,
        quoteCurrency,
        period,
        provider,
        JSON.stringify(normalized),
        normalized.length,
        normalized[0]?.timestamp ?? null,
        normalized.at(-1)?.timestamp ?? null,
        fetchedAt,
      );
    }

    const values = incoming.flatMap((point) => {
      const normalizedPoint = normalizePoint(point, provider);
      return normalizedPoint ? [{
        assetId,
        quoteCurrency,
        timestamp: normalizedPoint.timestamp,
        price: normalizedPoint.price,
        provider: normalizedPoint.source ?? provider,
        interval: period,
        fetchedAt,
      }] : [];
    });

    const chunkSize = 500;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      await this.db.insert(priceHistory).values(chunk)
        .onConflictDoUpdate({
          target: [priceHistory.assetId, priceHistory.quoteCurrency, priceHistory.timestamp, priceHistory.provider, priceHistory.interval],
          set: { price: sql`excluded.price`, fetchedAt },
        });
    }
  }

  async getCurrentPrice(assetId: string, quoteCurrency: string, _options?: { allowStale?: boolean }): Promise<{ price: number; fetchedAt: number; provider: string } | null> {
    const rows = await this.db.select()
      .from(priceHistory)
      .where(and(
        eq(priceHistory.assetId, assetId),
        eq(priceHistory.quoteCurrency, quoteCurrency),
        eq(priceHistory.interval, "current"),
      ))
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
      timestamp: fetchedAt,
      price,
      provider,
      interval: "current",
      fetchedAt,
    }).onConflictDoUpdate({
      target: [priceHistory.assetId, priceHistory.quoteCurrency, priceHistory.timestamp, priceHistory.provider, priceHistory.interval],
      set: { price, fetchedAt },
    });
  }
}
