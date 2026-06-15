import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { Database } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@crypto-control/database/dist/schema";
import { MarketService } from "@crypto-control/market-data";
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
type CoinbaseProductView = z.infer<typeof CoinbaseProductViewSchema>;
type CoinbaseCandlePoint = z.infer<typeof CoinbaseCandlePointSchema>;

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

function computedFiatValue(amount: number | null, price: number | null): number | null {
  return amount !== null && price !== null && Number.isFinite(amount) && Number.isFinite(price)
    ? amount * price
    : null;
}

const BALANCE_EPSILON = 1e-12;

function safeSelectAll(db: any, table: any): any[] {
  try {
    const query = db.select().from(table);
    return typeof query.all === "function" ? query.all() : [];
  } catch {
    return [];
  }
}

export class CoinbasePortfolioService {
  private publicMarketService = new MarketService();

  constructor(
    private db: any, // En este contexto, aceptamos el db de Drizzle inyectado
    private getClient: () => Promise<CoinbaseClient | null>
  ) {
  }

  private async mergeAccountBalancePositions(
    view: CoinbasePortfolioView,
    currency: string,
    usePublicFallback: boolean
  ): Promise<CoinbasePortfolioView> {
    const accounts = safeSelectAll(this.db, schema.accounts);
    const assets = safeSelectAll(this.db, schema.assets) as Array<{ id: string; name: string; type: string; logoUrl?: string | null }>;
    const assetById = new Map(assets.map((asset: any) => [asset.id, asset]));
    const existingAccountIds = new Set(view.positions.map((position) => position.accountUuid));
    const positions = [...view.positions];

    for (const account of accounts) {
      const assetId = account.assetId;
      const balance = parseNum(account.balance);
      if (!assetId || balance === null || balance <= BALANCE_EPSILON) continue;
      if (existingAccountIds.has(account.id)) continue;

      const asset = assetById.get(assetId);
      const isCash = assetId === currency || asset?.type === "fiat";
      const productId = `${assetId}-${currency}`;
      let market = isCash ? null : this.getCachedProduct(productId);
      let sparkline = isCash ? [] : this.getCachedCandles(productId, "ONE_HOUR");

      if (!isCash && usePublicFallback && (!market || market.price === null || sparkline.length < 2)) {
        try {
          const fallback = await this.getPublicMarketFallback(assetId, currency);
          market = market ? {
            ...market,
            price: market.price ?? fallback.market?.price ?? null,
            pricePercentageChange24h: market.pricePercentageChange24h ?? fallback.market?.pricePercentageChange24h ?? null,
            volume24h: market.volume24h ?? fallback.market?.volume24h ?? null,
            volumePercentageChange24h: market.volumePercentageChange24h ?? fallback.market?.volumePercentageChange24h ?? null,
            marketCap: market.marketCap ?? fallback.market?.marketCap ?? null,
            baseName: market.baseName ?? fallback.market?.baseName ?? asset?.name ?? assetId,
            baseDisplaySymbol: market.baseDisplaySymbol ?? fallback.market?.baseDisplaySymbol ?? assetId,
            quoteDisplaySymbol: market.quoteDisplaySymbol ?? fallback.market?.quoteDisplaySymbol ?? currency,
            iconUrl: market.iconUrl ?? fallback.market?.iconUrl ?? asset?.logoUrl ?? null,
            status: market.status ?? fallback.market?.status ?? "account-fallback",
            tradingDisabled: market.tradingDisabled,
            viewOnly: market.viewOnly
          } : fallback.market;
          if (sparkline.length < 2 && fallback.sparkline.length >= 2) sparkline = fallback.sparkline;
        } catch (error) {
          console.warn(`Failed to enrich account fallback for ${assetId}:`, error);
        }
      }

      const price = isCash ? 1 : market?.price ?? null;
      const totalFiat = price !== null ? balance * price : null;

      positions.push({
        asset: assetId,
        assetUuid: null,
        accountUuid: account.id,
        totalBalanceFiat: totalFiat,
        totalBalanceCrypto: balance,
        allocation: null,
        costBasis: null,
        averageEntryPrice: null,
        unrealizedPnl: null,
        fundingPnl: null,
        availableToTradeFiat: totalFiat,
        availableToTradeCrypto: balance,
        availableToTransferFiat: totalFiat,
        availableToTransferCrypto: balance,
        availableToSendFiat: totalFiat,
        availableToSendCrypto: balance,
        assetImageUrl: asset?.logoUrl ?? market?.iconUrl ?? null,
        assetColor: null,
        isCash,
        accountType: account.type ?? null,
        market,
        sparkline
      });
    }

    const totalValue = positions.reduce((sum, position) => {
      return sum + (typeof position.totalBalanceFiat === "number" && Number.isFinite(position.totalBalanceFiat) ? position.totalBalanceFiat : 0);
    }, 0);

    if (totalValue > 0) {
      for (const position of positions) {
        position.allocation = position.allocation ?? (typeof position.totalBalanceFiat === "number" && Number.isFinite(position.totalBalanceFiat)
          ? position.totalBalanceFiat / totalValue
          : null);
      }
    }

    const cryptoValue = positions.reduce((sum, position) => {
      if (position.isCash) return sum;
      return sum + (typeof position.totalBalanceFiat === "number" && Number.isFinite(position.totalBalanceFiat) ? position.totalBalanceFiat : 0);
    }, 0);
    const cashValue = positions.reduce((sum, position) => {
      if (!position.isCash) return sum;
      return sum + (typeof position.totalBalanceFiat === "number" && Number.isFinite(position.totalBalanceFiat) ? position.totalBalanceFiat : 0);
    }, 0);

    return CoinbasePortfolioViewSchema.parse({
      ...view,
      balances: {
        ...view.balances,
        totalBalance: view.balances.totalBalance ?? (totalValue > 0 ? { value: totalValue, currency } : null),
        totalCryptoBalance: view.balances.totalCryptoBalance ?? (cryptoValue > 0 ? { value: cryptoValue, currency } : null),
        totalCashEquivalentBalance: view.balances.totalCashEquivalentBalance ?? (cashValue > 0 ? { value: cashValue, currency } : null),
      },
      positions,
    });
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
      return await this.getCachedPortfolioBreakdown(portfolioUuid, currency, "Coinbase client unavailable");
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

        let totalFiat = parseNum(pos.total_balance_fiat);
        const unrealizedPnl = parseNum(pos.unrealized_pnl);
        const totalCrypto = parseNum(pos.total_balance_crypto);

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
          costBasisValue: costBasis?.value ?? null,
          costBasisCurrency: costBasis?.currency ?? null,
          averageEntryPriceValue: avgEntry?.value ?? null,
          averageEntryPriceCurrency: avgEntry?.currency ?? null,
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
            const candlesRes = await this.getCandles(productId, "24h");
            sparkline = candlesRes;
          } catch(e) {
            console.warn(`Failed to fetch market data for ${productId}:`, e);
            // Fallback to cache
            marketData = this.getCachedProduct(productId);
            sparkline = this.getCachedCandles(productId, "ONE_HOUR"); // Approximate sparkline fallback
          }

          if (!marketData || marketData.price === null || sparkline.length < 2) {
            try {
              const fallback = await this.getPublicMarketFallback(pos.asset, currency);
              if (fallback.market) {
                marketData = marketData ? {
                  ...marketData,
                  price: marketData.price ?? fallback.market.price,
                  pricePercentageChange24h: marketData.pricePercentageChange24h ?? fallback.market.pricePercentageChange24h,
                  volume24h: marketData.volume24h ?? fallback.market.volume24h,
                  volumePercentageChange24h: marketData.volumePercentageChange24h ?? fallback.market.volumePercentageChange24h,
                  marketCap: marketData.marketCap ?? fallback.market.marketCap,
                  baseName: marketData.baseName ?? fallback.market.baseName,
                  baseDisplaySymbol: marketData.baseDisplaySymbol ?? fallback.market.baseDisplaySymbol,
                  quoteDisplaySymbol: marketData.quoteDisplaySymbol ?? fallback.market.quoteDisplaySymbol,
                  iconUrl: marketData.iconUrl ?? fallback.market.iconUrl,
                  status: marketData.status ?? fallback.market.status,
                  tradingDisabled: marketData.tradingDisabled ?? fallback.market.tradingDisabled,
                  viewOnly: marketData.viewOnly ?? fallback.market.viewOnly
                } : fallback.market;
              }

              if (sparkline.length < 2 && fallback.sparkline.length >= 2) {
                sparkline = fallback.sparkline;
              }
            } catch (fallbackError) {
              console.warn(`Failed to fetch public market fallback for ${productId}:`, fallbackError);
            }
          }
        }

        if (totalFiat === null) {
          const price = pos.is_cash || pos.asset === currency ? 1 : marketData?.price ?? null;
          totalFiat = computedFiatValue(totalCrypto, price);
        }

        positions.push({
          asset: pos.asset,
          assetUuid: pos.asset_uuid,
          accountUuid: pos.account_uuid,
          totalBalanceFiat: totalFiat,
          totalBalanceCrypto: totalCrypto,
          allocation: parseNum(pos.allocation),
          costBasis,
          averageEntryPrice: avgEntry,
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

      return this.mergeAccountBalancePositions(CoinbasePortfolioViewSchema.parse(result), currency, true);

    } catch (error: any) {
      console.error("CoinbasePortfolioService: Error fetching portfolio", error);
      return await this.getCachedPortfolioBreakdown(portfolioUuid, currency, error.message);
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

  async getCandles(productId: string, period: "1h" | "24h" | "7d" | "30d" | "1y" | "all") {
    const client = await this.getClient();
    if (!client) return this.getCachedCandles(productId, "ONE_HOUR");

    const now = Math.floor(Date.now() / 1000);
    let start: number;
    let granularity: string;

    switch (period) {
      case "1h":  start = now - 3600;     granularity = "ONE_MINUTE";     break;
      case "24h": start = now - 86400;    granularity = "FIFTEEN_MINUTE"; break;
      case "7d":  start = now - 604800;   granularity = "ONE_HOUR";       break;
      case "30d": start = now - 2592000;  granularity = "SIX_HOUR";       break;
      case "1y":  start = now - 31536000; granularity = "ONE_DAY";        break;
      case "all": start = 0;              granularity = "ONE_DAY";        break;
      default:    start = now - 86400;    granularity = "FIFTEEN_MINUTE";
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

  async getPublicMarketFallback(asset: string, currency: string): Promise<{ market: CoinbaseProductView | null; sparkline: CoinbaseCandlePoint[] }> {
    const [priceResult, historyResult] = await Promise.allSettled([
      this.publicMarketService.getCurrentPrice(asset),
      this.publicMarketService.getHistoricalPrices(asset, "24h")
    ]);

    const history = historyResult.status === "fulfilled" ? historyResult.value : null;
    const points = history?.points ?? [];
    const sparkline = points
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price))
      .map((point) => CoinbaseCandlePointSchema.parse({
        time: Math.floor(point.timestamp / 1000),
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        volume: 0
      }))
      .sort((a, b) => a.time - b.time);

    const first = sparkline[0]?.close;
    const last = sparkline[sparkline.length - 1]?.close;
    const historyChange = first && last ? ((last - first) / first) * 100 : null;
    const priceData = priceResult.status === "fulfilled" ? priceResult.value : null;
    const price = priceData?.price ?? last ?? null;

    if (price === null) {
      return { market: null, sparkline };
    }

    const provider = priceData?.provider && priceData.provider !== "none"
      ? priceData.provider
      : history?.provider || "market-data";

    return {
      market: CoinbaseProductViewSchema.parse({
        productId: `${asset}-${currency}`,
        price,
        pricePercentageChange24h: historyChange,
        volume24h: null,
        volumePercentageChange24h: null,
        marketCap: null,
        baseName: asset,
        baseDisplaySymbol: asset,
        quoteDisplaySymbol: currency,
        iconUrl: null,
        status: `fallback:${provider}`,
        tradingDisabled: false,
        viewOnly: true
      }),
      sparkline
    };
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

  // --- CACHE FALLBACKS ---

  async getCachedPortfolioBreakdown(portfolioUuid: string, currency: string, errorReason: string): Promise<CoinbasePortfolioView> {
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

      const totalCrypto = pos.totalBalanceCrypto;
      const totalBalanceFiat = pos.totalBalanceFiat ?? computedFiatValue(
        typeof totalCrypto === "number" && Number.isFinite(totalCrypto) ? totalCrypto : null,
        pos.isCash === 1 || pos.asset === currency ? 1 : market?.price ?? null
      );

      return {
        asset: pos.asset,
        assetUuid: pos.assetUuid,
        accountUuid: pos.accountUuid,
        totalBalanceFiat,
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

    return this.mergeAccountBalancePositions(CoinbasePortfolioViewSchema.parse({
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
    }), currency, false);
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
