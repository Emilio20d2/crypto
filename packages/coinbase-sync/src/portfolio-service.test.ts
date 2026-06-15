import { describe, it, expect, vi } from "vitest";
import { CoinbasePortfolioService } from "./portfolio-service";

describe("CoinbasePortfolioService", () => {
  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }),
        onConflictDoNothing: vi.fn().mockReturnValue({ run: vi.fn() }),
        run: vi.fn()
      })
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ run: vi.fn() })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }),
            all: vi.fn().mockReturnValue([])
          }),
          get: vi.fn().mockReturnValue(null),
          all: vi.fn().mockReturnValue([])
        })
      })
    })
  };

  it("no debe deducir el coste base ni precio medio cuando Coinbase los omite", async () => {
    const mockClient = {
      getPortfolioBreakdown: vi.fn().mockResolvedValue({
        breakdown: {
          portfolio: { uuid: "123", name: "Main", type: "default", deleted: false },
          portfolio_balances: {},
          spot_positions: [
            {
              asset: "BTC",
              asset_uuid: "uuid-1",
              account_uuid: "acc-1",
              total_balance_fiat: "5000",
              total_balance_crypto: "0.1",
              unrealized_pnl: "1000",
              allocation: "0.5",
              cost_basis: null,
              average_entry_price: null,
              is_cash: false,
              asset_img_url: null,
              asset_color: null,
              account_type: "fiat"
            }
          ]
        }
      })
    };

    const service = new CoinbasePortfolioService(mockDb as any, async () => mockClient as any);
    
    service.getProduct = vi.fn().mockResolvedValue(null);
    service.getCandles = vi.fn().mockResolvedValue([]);
    service.getPublicMarketFallback = vi.fn().mockResolvedValue({ market: null, sparkline: [] });

    const result = await service.getPortfolioBreakdown("123", "EUR");
    
    expect(result.positions.length).toBe(1);
    const btc = result.positions[0];
    
    expect(btc.costBasis).toBeNull();
    expect(btc.averageEntryPrice).toBeNull();
  });

  it("debe conservar null en un activo sin coste de entrada informado por Coinbase", async () => {
    const mockClient = {
      getPortfolioBreakdown: vi.fn().mockResolvedValue({
        breakdown: {
          portfolio: { uuid: "123", name: "Main", type: "default", deleted: false },
          portfolio_balances: {},
          spot_positions: [
            {
              asset: "UNI",
              asset_uuid: "uuid-2",
              account_uuid: "acc-2",
              total_balance_fiat: "400",
              total_balance_crypto: "100",
              unrealized_pnl: "400", 
              allocation: "0.04",
              cost_basis: null,
              average_entry_price: null,
              is_cash: false,
              asset_img_url: null,
              asset_color: null,
              account_type: "fiat"
            }
          ]
        }
      })
    };

    const service = new CoinbasePortfolioService(mockDb as any, async () => mockClient as any);
    service.getProduct = vi.fn().mockResolvedValue(null);
    service.getCandles = vi.fn().mockResolvedValue([]);
    service.getPublicMarketFallback = vi.fn().mockResolvedValue({ market: null, sparkline: [] });

    const result = await service.getPortfolioBreakdown("123", "EUR");
    
    expect(result.positions.length).toBe(1);
    const uni = result.positions[0];
    
    expect(uni.costBasis).toBeNull();
    expect(uni.averageEntryPrice).toBeNull();
  });

  it("debe devolver null explícito si los datos de PnL no vienen desde Coinbase", async () => {
    const mockClient = {
      getPortfolioBreakdown: vi.fn().mockResolvedValue({
        breakdown: {
          portfolio: { uuid: "123", name: "Main", type: "default", deleted: false },
          portfolio_balances: {},
          spot_positions: [
            {
              asset: "ETH",
              asset_uuid: "uuid-3",
              account_uuid: "acc-3",
              total_balance_fiat: "3000",
              total_balance_crypto: "1",
              allocation: "0.3",
              unrealized_pnl: null,
              cost_basis: null,
              average_entry_price: null,
              is_cash: false,
              asset_img_url: null,
              asset_color: null,
              account_type: "fiat"
            }
          ]
        }
      })
    };

    const service = new CoinbasePortfolioService(mockDb as any, async () => mockClient as any);
    service.getProduct = vi.fn().mockResolvedValue(null);
    service.getCandles = vi.fn().mockResolvedValue([]);
    service.getPublicMarketFallback = vi.fn().mockResolvedValue({ market: null, sparkline: [] });

    const result = await service.getPortfolioBreakdown("123", "EUR");
    const eth = result.positions[0];
    
    expect(eth.costBasis).toBeNull();
    expect(eth.averageEntryPrice).toBeNull();
  });

  it("debe usar una fuente pública si Coinbase no devuelve mercado ni velas", async () => {
    const mockClient = {
      getPortfolioBreakdown: vi.fn().mockResolvedValue({
        breakdown: {
          portfolio: { uuid: "123", name: "Main", type: "default", deleted: false },
          portfolio_balances: {},
          spot_positions: [
            {
              asset: "LMTS",
              asset_uuid: "uuid-4",
              account_uuid: "acc-4",
              total_balance_fiat: "32.35",
              total_balance_crypto: "25",
              allocation: "0.1",
              unrealized_pnl: null,
              cost_basis: null,
              average_entry_price: null,
              is_cash: false,
              asset_img_url: null,
              asset_color: null,
              account_type: "fiat"
            }
          ]
        }
      })
    };

    const service = new CoinbasePortfolioService(mockDb as any, async () => mockClient as any);
    service.getProduct = vi.fn().mockResolvedValue(null);
    service.getCandles = vi.fn().mockResolvedValue([]);
    service.getPublicMarketFallback = vi.fn().mockResolvedValue({
      market: {
        productId: "LMTS-EUR",
        price: 1.29,
        pricePercentageChange24h: 2.1,
        volume24h: null,
        volumePercentageChange24h: null,
        marketCap: null,
        baseName: "LMTS",
        baseDisplaySymbol: "LMTS",
        quoteDisplaySymbol: "EUR",
        iconUrl: null,
        status: "fallback:coingecko",
        tradingDisabled: false,
        viewOnly: true
      },
      sparkline: [
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 },
        { time: 2, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 0 }
      ]
    });

    const result = await service.getPortfolioBreakdown("123", "EUR");
    const lmts = result.positions[0];

    expect(service.getPublicMarketFallback).toHaveBeenCalledWith("LMTS", "EUR");
    expect(lmts.market?.price).toBe(1.29);
    expect(lmts.market?.status).toBe("fallback:coingecko");
    expect(lmts.sparkline).toHaveLength(2);
  });

  it("debe valorar una posición desde saldo Coinbase y precio si falta total_balance_fiat", async () => {
    const mockClient = {
      getPortfolioBreakdown: vi.fn().mockResolvedValue({
        breakdown: {
          portfolio: { uuid: "123", name: "Main", type: "default", deleted: false },
          portfolio_balances: {},
          spot_positions: [
            {
              asset: "TON",
              asset_uuid: "uuid-5",
              account_uuid: "acc-5",
              total_balance_fiat: null,
              total_balance_crypto: "12.5",
              allocation: null,
              unrealized_pnl: null,
              cost_basis: { value: "20", currency: "EUR" },
              average_entry_price: { value: "1.6", currency: "EUR" },
              is_cash: false,
              asset_img_url: null,
              asset_color: null,
              account_type: "fiat"
            }
          ]
        }
      })
    };

    const service = new CoinbasePortfolioService(mockDb as any, async () => mockClient as any);
    service.getProduct = vi.fn().mockResolvedValue({
      productId: "TON-EUR",
      price: 2,
      pricePercentageChange24h: 1.2,
      volume24h: null,
      volumePercentageChange24h: null,
      marketCap: null,
      baseName: "Toncoin",
      baseDisplaySymbol: "TON",
      quoteDisplaySymbol: "EUR",
      iconUrl: null,
      status: "online",
      tradingDisabled: false,
      viewOnly: false
    });
    service.getCandles = vi.fn().mockResolvedValue([]);
    service.getPublicMarketFallback = vi.fn().mockResolvedValue({ market: null, sparkline: [] });

    const result = await service.getPortfolioBreakdown("123", "EUR");
    const ton = result.positions[0];

    expect(ton.totalBalanceCrypto).toBe(12.5);
    expect(ton.totalBalanceFiat).toBe(25);
    expect(ton.costBasis?.value).toBe(20);
    expect(ton.averageEntryPrice?.value).toBe(1.6);
  });
});
