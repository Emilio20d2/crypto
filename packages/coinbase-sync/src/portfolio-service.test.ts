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

  it("debe deducir el coste base y precio medio cuando Coinbase los omite", async () => {
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

    const result = await service.getPortfolioBreakdown("123", "EUR");
    
    expect(result.positions.length).toBe(1);
    const btc = result.positions[0];
    
    expect(btc.costBasis).toEqual({ value: 4000, currency: "EUR" });
    expect(btc.averageEntryPrice).toEqual({ value: 40000, currency: "EUR" });
  });

  it("debe manejar correctamente un activo sin valor de entrada (Airdrop/Coste Cero)", async () => {
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

    const result = await service.getPortfolioBreakdown("123", "EUR");
    
    expect(result.positions.length).toBe(1);
    const uni = result.positions[0];
    
    expect(uni.costBasis).toEqual({ value: 0, currency: "EUR" });
    expect(uni.averageEntryPrice).toEqual({ value: 0, currency: "EUR" });
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

    const result = await service.getPortfolioBreakdown("123", "EUR");
    const eth = result.positions[0];
    
    expect(eth.costBasis).toBeNull();
    expect(eth.averageEntryPrice).toBeNull();
  });
});
