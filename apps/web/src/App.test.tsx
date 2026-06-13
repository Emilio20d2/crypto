import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Cartera page as initial route', () => {
  render(<App />);
  const titles = screen.getAllByText(/Cartera/i);
  expect(titles.length).toBeGreaterThan(0);
});
