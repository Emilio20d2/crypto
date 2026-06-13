import { test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock window.api
beforeEach(() => {
  (window as any).api = {
    assets: {
      list: async () => []
    },
    market: {
      getCurrentPrice: async () => ({}),
      getHistoricalPrices: async () => []
    }
  };
});

test('renders Cartera page as initial route', () => {
  render(<App />);
  const titles = screen.getAllByText(/Cartera/i);
  expect(titles.length).toBeGreaterThan(0);
});
