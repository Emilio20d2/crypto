import { and, desc, eq, isNull } from "drizzle-orm";
import type { MarketSentiment, MarketSentimentSnapshotRepository } from "@crypto-control/market-data";
import { getDb } from "./db";
import { marketSentimentSnapshots } from "./schema";

export class DatabaseMarketSentimentRepository implements MarketSentimentSnapshotRepository {
  constructor(private db: ReturnType<typeof getDb>) {}

  async saveSnapshot(sentiment: MarketSentiment, sourceVersion: string): Promise<void> {
    const assetKey = sentiment.assetId ?? "global";
    const id = `${sentiment.scope}:${assetKey}:${sentiment.timeframe}:${sentiment.calculatedAt}:${sourceVersion}`;

    await this.db.insert(marketSentimentSnapshots).values({
      id,
      scope: sentiment.scope,
      assetId: sentiment.assetId ?? null,
      timeframe: sentiment.timeframe,
      score: sentiment.score,
      confidence: sentiment.confidence,
      direction: sentiment.direction,
      factorsJson: JSON.stringify(sentiment.factors),
      sourceSummaryJson: JSON.stringify(sentiment.sourceSummary),
      state: sentiment.state,
      methodology: sentiment.methodology ?? null,
      calculatedAt: sentiment.calculatedAt,
      validUntil: sentiment.validUntil,
      sourceVersion,
    }).onConflictDoNothing().run();
  }

  async getHistory(input: {
    scope: "global" | "asset";
    assetId?: string | null;
    timeframe: "24h" | "7d" | "30d";
    limit?: number;
  }): Promise<MarketSentiment[]> {
    const conditions = [
      eq(marketSentimentSnapshots.scope, input.scope),
      eq(marketSentimentSnapshots.timeframe, input.timeframe),
      input.scope === "asset"
        ? eq(marketSentimentSnapshots.assetId, input.assetId ?? "")
        : isNull(marketSentimentSnapshots.assetId),
    ];

    const rows = await this.db.select()
      .from(marketSentimentSnapshots)
      .where(and(...conditions))
      .orderBy(desc(marketSentimentSnapshots.calculatedAt))
      .limit(input.limit ?? 50);

    return rows.map((row) => ({
      scope: row.scope as "global" | "asset",
      assetId: row.assetId ?? undefined,
      direction: row.direction as MarketSentiment["direction"],
      score: row.score,
      confidence: row.confidence,
      timeframe: row.timeframe as MarketSentiment["timeframe"],
      factors: JSON.parse(row.factorsJson),
      sourceSummary: JSON.parse(row.sourceSummaryJson || "[]"),
      calculatedAt: row.calculatedAt,
      validUntil: row.validUntil,
      state: row.state as MarketSentiment["state"],
      methodology: row.methodology ?? undefined,
    }));
  }
}
