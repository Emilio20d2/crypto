import { describe, test, expect } from "vitest";
import {
  initTreasuryState, eurcAvailable, addSaleProceeds,
  consumeEurcForRebuy, consumeCashForContribution, recordTaxPayment,
} from "./treasury-simulator";

describe("TreasuryState", () => {
  test("EURC disponible excluye reserva fiscal", () => {
    const s = initTreasuryState(0, 500, 100);
    expect(eurcAvailable(s)).toBeCloseTo(400);
  });

  test("sin EURC: disponible es cero", () => {
    const s = initTreasuryState(0, 0, 0);
    expect(eurcAvailable(s)).toBe(0);
  });

  test("reserva > EURC → disponible es 0, no negativo", () => {
    const s = initTreasuryState(0, 50, 100);
    expect(eurcAvailable(s)).toBe(0);
  });

  test("addSaleProceeds añade EURC y reserva fiscal", () => {
    const s = initTreasuryState(0, 0, 0);
    const s2 = addSaleProceeds(s, 1000, 190);
    expect(s2.eurcEur).toBeCloseTo(1000);
    expect(s2.fiscalReserveEur).toBeCloseTo(190);
    expect(eurcAvailable(s2)).toBeCloseTo(810);
  });

  test("consumeEurcForRebuy no consume reserva fiscal", () => {
    const s = initTreasuryState(0, 500, 100);
    const s2 = consumeEurcForRebuy(s, 300);
    // Solo puede consumir de los 400 disponibles
    expect(s2.eurcEur).toBeCloseTo(200);
    expect(s2.fiscalReserveEur).toBeCloseTo(100);
  });

  test("no puede consumir más EURC del disponible", () => {
    const s = initTreasuryState(0, 400, 100);
    const s2 = consumeEurcForRebuy(s, 500); // intenta 500 pero solo 300 disponibles
    expect(s2.eurcEur).toBeGreaterThanOrEqual(0);
  });

  test("consumeCashForContribution reduce efectivo", () => {
    const s = initTreasuryState(1000, 0, 0);
    const s2 = consumeCashForContribution(s, 200);
    expect(s2.cashEur).toBeCloseTo(800);
  });

  test("recordTaxPayment reduce EURC y reserva", () => {
    const s = addSaleProceeds(initTreasuryState(0, 0, 0), 1000, 190);
    const s2 = recordTaxPayment(s, 190);
    expect(s2.fiscalReserveEur).toBeCloseTo(0, 1);
    expect(s2.taxPaidEur).toBeCloseTo(190, 1);
    expect(s2.eurcEur).toBeCloseTo(810, 1);
  });

  test("efectivo y EURC son pools separados", () => {
    const s = initTreasuryState(1000, 500, 100);
    const s2 = consumeEurcForRebuy(s, 300);
    expect(s2.cashEur).toBeCloseTo(1000); // intacto
    expect(s2.eurcEur).toBeCloseTo(200);
  });
});
