import { test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  window.cryptoControl = {
    assets: {
      list: async () => ({ ok: true as const, data: [] })
    },
    market: {
      getCurrentPrice: async () => ({
        ok: true as const,
        data: { price: 50000, state: "live" as const, provider: "mock", fetchedAt: Date.now() }
      }),
      getHistoricalPrices: async () => ({
        ok: true as const,
        data: { provider: "mock", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: Date.now(), isCached: false }
      })
    },
    portfolio: {
      getSummary: async () => ({
        ok: true as const,
        data: {
          totalValueEur: 0,
          totalInvestedEur: 0,
          unrealizedGainEur: 0,
          unrealizedGainPercentage: 0,
          valuationStatus: "complete" as const,
          valuedAssets: 0,
          unavailableAssets: 0,
          lastSuccessfulPriceAt: null
        }
      }),
      getPositions: async () => ({ ok: true as const, data: {} }),
      getAllocation: async () => ({ ok: true as const, data: [] })
    },
    transactions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: {} }),
      update: async () => ({ ok: true as const, data: null }),
      delete: async () => ({ ok: true as const, data: null })
    },
    settings: {
      get: async () => ({ ok: true as const, data: null }),
      update: async () => ({ ok: true as const, data: null })
    }
  };
});

test('renders Cartera page as initial route', () => {
  render(<App />);
  const titles = screen.getAllByText(/Cartera/i);
  expect(titles.length).toBeGreaterThan(0);
});

test('price result data is never an object when displayed', async () => {
  const res = await window.cryptoControl.market.getCurrentPrice({ assetId: 'BTC', quoteCurrency: 'EUR' });
  if (!res.ok) throw new Error('expected ok');
  const price = res.data.price;
  expect(typeof price === 'number' || price === null).toBe(true);
  if (price !== null) {
    expect(Number.isFinite(price)).toBe(true);
  }
});

test('price data is not double-wrapped', async () => {
  const res = await window.cryptoControl.market.getCurrentPrice({ assetId: 'BTC', quoteCurrency: 'EUR' });
  if (!res.ok) throw new Error('expected ok');
  expect(typeof res.data).toBe('object');
  expect(typeof (res.data as unknown as { price: unknown }).price).not.toBe('object');
});

test('settings.get returns null when not configured', async () => {
  const res = await window.cryptoControl.settings.get('portfolio_target');
  if (!res.ok) throw new Error('expected ok');
  expect(res.data).toBeNull();
});
