import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { Database } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@crypto-control/database/dist/schema";
import { CoinbaseClient } from "./client";

// Zod schemas for the final UI contracts
export const CoinbasePortfolioIdentitySchema = z.object({
  uuid: z.string(),
  name: z.string(),
  type: z.string(),
  deleted: z.boolean()
});

export const MoneyValueSchema = z.object({
  value: z.number(),
  currency: z.string()
});

export const CoinbasePortfolioBalancesSchema = z.object({
  totalBalance: MoneyValueSchema.nullable(),
  totalCryptoBalance: MoneyValueSchema.nullable(),
  totalCashEquivalentBalance: MoneyValueSchema.nullable(),
  totalFuturesBalance: MoneyValueSchema.nullable(),
  futuresUnrealizedPnl: MoneyValueSchema.nullable(),
  perpUnrealizedPnl: MoneyValueSchema.nullable()
});

export const CoinbaseCandlePointSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
});

export const CoinbaseProductViewSchema = z.object({
  productId: z.string(),
  price: z.number().nullable(),
  pricePercentageChange24h: z.number().nullable(),
  volume24h: z.number().nullable(),
  volumePercentageChange24h: z.number().nullable(),
  marketCap: z.number().nullable(),
  baseName: z.string().nullable(),
  baseDisplaySymbol: z.string().nullable(),
  quoteDisplaySymbol: z.string().nullable(),
  iconUrl: z.string().nullable(),
  status: z.string().nullable(),
  tradingDisabled: z.boolean(),
  viewOnly: z.boolean()
});

export const CoinbaseSpotPositionViewSchema = z.object({
  asset: z.string(),
  assetUuid: z.string().nullable(),
  accountUuid: z.string(),
  totalBalanceFiat: z.number().nullable(),
  totalBalanceCrypto: z.number().nullable(),
  allocation: z.number().nullable(),
  costBasis: MoneyValueSchema.nullable(),
  averageEntryPrice: MoneyValueSchema.nullable(),
  unrealizedPnl: z.number().nullable(),
  fundingPnl: z.number().nullable(),
  availableToTradeFiat: z.number().nullable(),
  availableToTradeCrypto: z.number().nullable(),
  availableToTransferFiat: z.number().nullable(),
  availableToTransferCrypto: z.number().nullable(),
  availableToSendFiat: z.number().nullable(),
  availableToSendCrypto: z.number().nullable(),
  assetImageUrl: z.string().nullable(),
  assetColor: z.string().nullable(),
  isCash: z.boolean(),
  accountType: z.string().nullable(),
  market: CoinbaseProductViewSchema.nullable(),
  sparkline: z.array(CoinbaseCandlePointSchema)
});

export const CoinbasePortfolioViewSchema = z.object({
  portfolio: CoinbasePortfolioIdentitySchema,
  balances: CoinbasePortfolioBalancesSchema,
  positions: z.array(CoinbaseSpotPositionViewSchema),
  capturedAt: z.number(),
  currency: z.literal("EUR"),
  source: z.literal("coinbase"),
  state: z.enum(["live", "cached", "unavailable"]),
  reason: z.string().optional()
});

export type CoinbasePortfolioView = z.infer<typeof CoinbasePortfolioViewSchema>;
export type CoinbaseSpotPositionView = z.infer<typeof CoinbaseSpotPositionViewSchema>;

// Helper to convert Coinbase string objects to MoneyValue
const parseMoney = (obj: any): { value: number; currency: string } | null => {
  if (!obj || obj.value === undefined || obj.value === null) return null;
  const val = parseFloat(obj.value);
  if (isNaN(val)) return null;
  return { value: val, currency: obj.currency || "EUR" };
};

const parseNum = (str: any): number | null => {
  if (str === undefined || str === null) return null;
  const val = parseFloat(str);
  return isNaN(val) ? null : val;
};

export class CoinbasePortfolioService {
  constructor(
    private db: any, // En este contexto, aceptamos el db de Drizzle inyectado
    private getClient: () => Promise<CoinbaseClient | null>
  ) {
  }

  async listPortfolios() {
    const client = await this.getClient();
    if (!client) throw new Error("No Coinbase client available");
    
    const response = await client.getPortfolios();
    const now = Date.now();
    
    // Save to cache
    for (const p of response.portfolios) {
      this.db.insert(schema.coinbasePortfolios).values({
        uuid: p.uuid,
        name: p.name,
        type: p.type,
        deleted: p.deleted ? 1 : 0,
        currency: "EUR",
        capturedAt: now
      }).onConflictDoUpdate({
        target: schema.coinbasePortfolios.uuid,
        set: {
          name: p.name,
          type: p.type,
          deleted: p.deleted ? 1 : 0,
          capturedAt: now
        }
      }).run();
    }
    
    return response.portfolios;
  }

  async getPortfolioBreakdown(portfolioUuid: string, currency: string = "EUR"): Promise<CoinbasePortfolioView> {
    const client = await this.getClient();
    if (!client) {
      return this.getCachedPortfolioBreakdown(portfolioUuid, currency, "Coinbase client unavailable");
    }

    try {
      const response = await client.getPortfolioBreakdown(portfolioUuid, currency);
      const now = Date.now();
      const b = response.breakdown;
      const pb = b.portfolio_balances;

      const balances = {
        totalBalance: parseMoney(pb?.total_balance),
        totalCryptoBalance: parseMoney(pb?.total_crypto_balance),
        totalCashEquivalentBalance: parseMoney(pb?.total_cash_equivalent_balance),
        totalFuturesBalance: parseMoney(pb?.total_futures_balance),
        futuresUnrealizedPnl: parseMoney(pb?.futures_unrealized_pnl),
        perpUnrealizedPnl: parseMoney(pb?.perp_unrealized_pnl)
      };

      // Save main snapshot
      this.db.insert(schema.coinbasePortfolioSnapshots).values({
        id: crypto.randomUUID(),
        portfolioUuid,
        currency,
        totalBalance: balances.totalBalance?.value ?? null,
        totalCryptoBalance: balances.totalCryptoBalance?.value ?? null,
        totalCashEquivalentBalance: balances.totalCashEquivalentBalance?.value ?? null,
        capturedAt: now,
        source: "coinbase_portfolio_breakdown"
      }).run();

      const positions: CoinbaseSpotPositionView[] = [];

      // Delete old cached positions for this portfolio to replace them
      this.db.delete(schema.coinbaseSpotPositionSnapshots)
        .where(eq(schema.coinbaseSpotPositionSnapshots.portfolioUuid, portfolioUuid))
        .run();

      for (const pos of b.spot_positions || []) {
        const costBasis = parseMoney(pos.cost_basis);
        const avgEntry = parseMoney(pos.average_entry_price);

        const totalFiat = parseNum(pos.total_balance_fiat);
        const unrealizedPnl = parseNum(pos.unrealized_pnl);
        const totalCrypto = parseNum(pos.total_balance_crypto);

        let costBasisValue = costBasis?.value ?? null;
        let avgEntryValue = avgEntry?.value ?? null;

        // Deducción matemática de coste base si no existe
        if (costBasisValue === null && totalFiat !== null && unrealizedPnl !== null) {
          costBasisValue = totalFiat - unrealizedPnl;
        }

        // Deducción matemática de precio medio si no existe
        if (avgEntryValue === null && costBasisValue !== null && totalCrypto !== null && totalCrypto > 0) {
          avgEntryValue = costBasisValue / totalCrypto;
        }

        const computedCostBasis = costBasisValue !== null ? { value: costBasisValue, currency: costBasis?.currency || currency } : null;
        const computedAvgEntry = avgEntryValue !== null ? { value: avgEntryValue, currency: avgEntry?.currency || currency } : null;

        // Save position snapshot
        this.db.insert(schema.coinbaseSpotPositionSnapshots).values({
          id: crypto.randomUUID(),
          portfolioUuid,
          asset: pos.asset,
          assetUuid: pos.asset_uuid,
          accountUuid: pos.account_uuid,
          totalBalanceFiat: totalFiat,
          totalBalanceCrypto: totalCrypto,
          allocation: parseNum(pos.allocation),
          costBasisValue: computedCostBasis?.value ?? null,
          costBasisCurrency: computedCostBasis?.currency ?? null,
          averageEntryPriceValue: computedAvgEntry?.value ?? null,
          averageEntryPriceCurrency: computedAvgEntry?.currency ?? null,
          unrealizedPnl: unrealizedPnl,
          fundingPnl: parseNum(pos.funding_pnl),
          availableToTradeFiat: parseNum(pos.available_to_trade_fiat),
          availableToTradeCrypto: parseNum(pos.available_to_trade_crypto),
          availableToTransferFiat: parseNum(pos.available_to_transfer_fiat),
          availableToTransferCrypto: parseNum(pos.available_to_transfer_crypto),
          availableToSendFiat: parseNum(pos.available_to_send_fiat),
          availableToSendCrypto: parseNum(pos.available_to_send_crypto),
          assetImageUrl: pos.asset_img_url,
          assetColor: pos.asset_color,
          isCash: pos.is_cash ? 1 : 0,
          accountType: pos.account_type,
          capturedAt: now
        }).run();

        // Let's fetch market and candle silently if possible, but we don't want to block everything if it fails
        let marketData = null;
        let sparkline: any[] = [];
        if (!pos.is_cash && pos.asset !== currency) {
          const productId = `${pos.asset}-${currency}`;
          try {
            marketData = await this.getProduct(productId);
            // 24h sparkline (1 hour candles * 24)
            const candlesRes = await this.getCandles(productId, "1d");
            sparkline = candlesRes;
          } catch(e) {
            console.warn(`Failed to fetch market data for ${productId}:`, e);
            // Fallback to cache
            marketData = this.getCachedProduct(productId);
            sparkline = this.getCachedCandles(productId, "ONE_HOUR"); // Approximate sparkline fallback
          }
        }

        positions.push({
          asset: pos.asset,
          assetUuid: pos.asset_uuid,
          accountUuid: pos.account_uuid,
          totalBalanceFiat: totalFiat,
          totalBalanceCrypto: totalCrypto,
          allocation: parseNum(pos.allocation),
          costBasis: computedCostBasis,
          averageEntryPrice: computedAvgEntry,
          unrealizedPnl: unrealizedPnl,
          fundingPnl: parseNum(pos.funding_pnl),
          availableToTradeFiat: parseNum(pos.available_to_trade_fiat),
          availableToTradeCrypto: parseNum(pos.available_to_trade_crypto),
          availableToTransferFiat: parseNum(pos.available_to_transfer_fiat),
          availableToTransferCrypto: parseNum(pos.available_to_transfer_crypto),
          availableToSendFiat: parseNum(pos.available_to_send_fiat),
          availableToSendCrypto: parseNum(pos.available_to_send_crypto),
          assetImageUrl: pos.asset_img_url,
          assetColor: pos.asset_color,
          isCash: !!pos.is_cash,
          accountType: pos.account_type,
          market: marketData,
          sparkline
        });
      }

      const result: CoinbasePortfolioView = {
        portfolio: {
          uuid: b.portfolio.uuid,
          name: b.portfolio.name,
          type: b.portfolio.type,
          deleted: b.portfolio.deleted
        },
        balances,
        positions,
        capturedAt: now,
        currency: "EUR",
        source: "coinbase",
        state: "live"
      };

      return CoinbasePortfolioViewSchema.parse(result);

    } catch (error: any) {
      console.error("CoinbasePortfolioService: Error fetching portfolio", error);
      return this.getCachedPortfolioBreakdown(portfolioUuid, currency, error.message);
    }
  }

  async getProduct(productId: string) {
    const client = await this.getClient();
    if (!client) return this.getCachedProduct(productId);
    
    try {
      const res = await client.getProduct(productId);
      const now = Date.now();
      
      this.db.insert(schema.coinbaseMarketSnapshots).values({
        productId,
        price: parseNum(res.price),
        pricePercentageChange24h: parseNum(res.price_percentage_change_24h),
        volume24h: parseNum(res.volume_24h),
        volumePercentageChange24h: parseNum(res.volume_percentage_change_24h),
        marketCap: parseNum(res.market_cap),
        baseName: res.base_name,
        baseDisplaySymbol: res.base_display_symbol,
        quoteDisplaySymbol: res.quote_display_symbol,
        iconUrl: res.icon_url,
        status: res.status,
        tradingDisabled: res.trading_disabled ? 1 : 0,
        viewOnly: res.view_only ? 1 : 0,
        capturedAt: now
      }).onConflictDoUpdate({
        target: schema.coinbaseMarketSnapshots.productId,
        set: {
          price: parseNum(res.price),
          pricePercentageChange24h: parseNum(res.price_percentage_change_24h),
          volume24h: parseNum(res.volume_24h),
          volumePercentageChange24h: parseNum(res.volume_percentage_change_24h),
          marketCap: parseNum(res.market_cap),
          baseName: res.base_name,
          baseDisplaySymbol: res.base_display_symbol,
          quoteDisplaySymbol: res.quote_display_symbol,
          iconUrl: res.icon_url,
          status: res.status,
          tradingDisabled: res.trading_disabled ? 1 : 0,
          viewOnly: res.view_only ? 1 : 0,
          capturedAt: now
        }
      }).run();
      
      return CoinbaseProductViewSchema.parse({
        productId,
        price: parseNum(res.price),
        pricePercentageChange24h: parseNum(res.price_percentage_change_24h),
        volume24h: parseNum(res.volume_24h),
        volumePercentageChange24h: parseNum(res.volume_percentage_change_24h),
        marketCap: parseNum(res.market_cap),
        baseName: res.base_name,
        baseDisplaySymbol: res.base_display_symbol,
        quoteDisplaySymbol: res.quote_display_symbol,
        iconUrl: res.icon_url,
        status: res.status,
        tradingDisabled: res.trading_disabled,
        viewOnly: res.view_only
      });
    } catch (e) {
      return this.getCachedProduct(productId);
    }
  }

  async getCandles(productId: string, period: "1h" | "1d" | "1s" | "1m" | "1a" | "all") {
    const client = await this.getClient();
    if (!client) return this.getCachedCandles(productId, "ONE_HOUR"); // fallback granularity

    const now = Math.floor(Date.now() / 1000);
    let start: number;
    let granularity: string;

    switch (period) {
      case "1h": start = now - 3600; granularity = "ONE_MINUTE"; break;
      case "1d": start = now - 86400; granularity = "FIFTEEN_MINUTE"; break;
      case "1s": start = now - 604800; granularity = "ONE_HOUR"; break;
      case "1m": start = now - 2592000; granularity = "SIX_HOUR"; break;
      case "1a": start = now - 31536000; granularity = "ONE_DAY"; break;
      case "all": start = 0; granularity = "ONE_DAY"; break;
      default: start = now - 86400; granularity = "FIFTEEN_MINUTE";
    }

    try {
      const res = await client.getCandles(productId, start.toString(), now.toString(), granularity);
      const fetchedAt = Date.now();

      // Clear old cache for this exact pair and granularity
      this.db.delete(schema.coinbaseCandleCache)
        .where(
          and(
            eq(schema.coinbaseCandleCache.productId, productId),
            eq(schema.coinbaseCandleCache.granularity, granularity)
          )
        )
        .run();

      const points = [];
      for (const c of res.candles) {
        const cStart = parseInt(c.start);
        this.db.insert(schema.coinbaseCandleCache).values({
          id: `${productId}_${granularity}_${cStart}`,
          productId,
          granularity,
          start: cStart,
          low: parseFloat(c.low),
          high: parseFloat(c.high),
          open: parseFloat(c.open),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume),
          fetchedAt
        }).onConflictDoNothing().run();

        points.push({
          time: cStart,
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume)
        });
      }

      return points.sort((a, b) => a.time - b.time).map(p => CoinbaseCandlePointSchema.parse(p));
    } catch (e) {
      return this.getCachedCandles(productId, granularity);
    }
  }

  getPortfolioSnapshots(portfolioUuid: string) {
    const records = this.db.select()
      .from(schema.coinbasePortfolioSnapshots)
      .where(eq(schema.coinbasePortfolioSnapshots.portfolioUuid, portfolioUuid))
      .orderBy(schema.coinbasePortfolioSnapshots.capturedAt)
      .all();
    
    return records.map((r: any) => ({
      capturedAt: r.capturedAt,
      totalBalance: r.totalBalance
    }));
  }

  // --- PRIVATE CACHE FALLBACKS ---

  private getCachedPortfolioBreakdown(portfolioUuid: string, currency: string, errorReason: string): CoinbasePortfolioView {
    const p = this.db.select().from(schema.coinbasePortfolios).where(eq(schema.coinbasePortfolios.uuid, portfolioUuid)).get();
    if (!p) {
      return {
        portfolio: { uuid: portfolioUuid, name: "Unknown", type: "default", deleted: false },
        balances: { totalBalance: null, totalCryptoBalance: null, totalCashEquivalentBalance: null, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [],
        capturedAt: 0,
        currency: "EUR",
        source: "coinbase",
        state: "unavailable",
        reason: errorReason
      };
    }

    const latestSnap = this.db.select()
      .from(schema.coinbasePortfolioSnapshots)
      .where(eq(schema.coinbasePortfolioSnapshots.portfolioUuid, portfolioUuid))
      .orderBy(desc(schema.coinbasePortfolioSnapshots.capturedAt))
      .limit(1)
      .get();

    const cachedPositions = this.db.select()
      .from(schema.coinbaseSpotPositionSnapshots)
      .where(eq(schema.coinbaseSpotPositionSnapshots.portfolioUuid, portfolioUuid))
      .all();

    const positions = cachedPositions.map((pos: any) => {
      let market = null;
      let sparkline: any[] = [];
      if (!pos.isCash && pos.asset !== currency) {
        const productId = `${pos.asset}-${currency}`;
        market = this.getCachedProduct(productId);
        sparkline = this.getCachedCandles(productId, "ONE_HOUR");
      }

      return {
        asset: pos.asset,
        assetUuid: pos.assetUuid,
        accountUuid: pos.accountUuid,
        totalBalanceFiat: pos.totalBalanceFiat,
        totalBalanceCrypto: pos.totalBalanceCrypto,
        allocation: pos.allocation,
        costBasis: pos.costBasisValue !== null ? { value: pos.costBasisValue, currency: pos.costBasisCurrency || currency } : null,
        averageEntryPrice: pos.averageEntryPriceValue !== null ? { value: pos.averageEntryPriceValue, currency: pos.averageEntryPriceCurrency || currency } : null,
        unrealizedPnl: pos.unrealizedPnl,
        fundingPnl: pos.fundingPnl,
        availableToTradeFiat: pos.availableToTradeFiat,
        availableToTradeCrypto: pos.availableToTradeCrypto,
        availableToTransferFiat: pos.availableToTransferFiat,
        availableToTransferCrypto: pos.availableToTransferCrypto,
        availableToSendFiat: pos.availableToSendFiat,
        availableToSendCrypto: pos.availableToSendCrypto,
        assetImageUrl: pos.assetImageUrl,
        assetColor: pos.assetColor,
        isCash: pos.isCash === 1,
        accountType: pos.accountType,
        market,
        sparkline
      };
    });

    return CoinbasePortfolioViewSchema.parse({
      portfolio: {
        uuid: p.uuid,
        name: p.name,
        type: p.type,
        deleted: p.deleted === 1
      },
      balances: {
        totalBalance: latestSnap && latestSnap.totalBalance !== null ? { value: latestSnap.totalBalance, currency } : null,
        totalCryptoBalance: latestSnap && latestSnap.totalCryptoBalance !== null ? { value: latestSnap.totalCryptoBalance, currency } : null,
        totalCashEquivalentBalance: latestSnap && latestSnap.totalCashEquivalentBalance !== null ? { value: latestSnap.totalCashEquivalentBalance, currency } : null,
        totalFuturesBalance: null,
        futuresUnrealizedPnl: null,
        perpUnrealizedPnl: null
      },
      positions,
      capturedAt: latestSnap ? latestSnap.capturedAt : p.capturedAt,
      currency: "EUR",
      source: "coinbase",
      state: "cached",
      reason: errorReason
    });
  }

  private getCachedProduct(productId: string) {
    const m = this.db.select().from(schema.coinbaseMarketSnapshots).where(eq(schema.coinbaseMarketSnapshots.productId, productId)).get();
    if (!m) return null;
    return CoinbaseProductViewSchema.parse({
      productId: m.productId,
      price: m.price,
      pricePercentageChange24h: m.pricePercentageChange24h,
      volume24h: m.volume24h,
      volumePercentageChange24h: m.volumePercentageChange24h,
      marketCap: m.marketCap,
      baseName: m.baseName,
      baseDisplaySymbol: m.baseDisplaySymbol,
      quoteDisplaySymbol: m.quoteDisplaySymbol,
      iconUrl: m.iconUrl,
      status: m.status,
      tradingDisabled: m.tradingDisabled === 1,
      viewOnly: m.viewOnly === 1
    });
  }

  private getCachedCandles(productId: string, granularity: string) {
    const candles = this.db.select()
      .from(schema.coinbaseCandleCache)
      .where(
        and(
          eq(schema.coinbaseCandleCache.productId, productId),
          eq(schema.coinbaseCandleCache.granularity, granularity)
        )
      )
      .orderBy(schema.coinbaseCandleCache.start)
      .all();
    
    return candles.map((c: any) => CoinbaseCandlePointSchema.parse({
      time: c.start,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
  }
}
