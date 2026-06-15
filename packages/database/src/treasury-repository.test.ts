import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { DatabaseTreasuryRepository } from "./treasury-repository";

describe("Tesorería de ciclos", () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database<typeof schema>;
  let repo: DatabaseTreasuryRepository;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });
    repo = new DatabaseTreasuryRepository(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  test("calcula resumen de tesorería separando efectivo, EURC y reserva fiscal", () => {
    repo.createMovement({
      date: Date.now(),
      type: "efectivo_entrada",
      amount: 100,
      reason: "Aportación DCA",
    });
    repo.createMovement({
      date: Date.now(),
      type: "eurc_entrada",
      amount: 80,
      reason: "Venta parcial",
    });
    repo.createMovement({
      date: Date.now(),
      type: "reserva_fiscal",
      amount: 20,
      reason: "Reserva de plusvalías",
    });

    const summary = repo.getSummary(25);
    expect(summary.cashBalance).toBe(100);
    expect(summary.eurcBalance).toBe(60);
    expect(summary.fiscalReserveBalance).toBe(20);
    expect(summary.totalLiquidity).toBe(180);
    expect(summary.pendingEstimatedTaxes).toBe(5);
  });

  test("excluye la reserva fiscal de la liquidez libre para recompras", () => {
    repo.createMovement({ date: Date.now(), type: "eurc_entrada", amount: 100, reason: "Liquidez por venta" });
    repo.createMovement({ date: Date.now(), type: "reserva_fiscal", amount: 40, reason: "Apartar impuestos" });

    const summary = repo.getSummary(40);
    expect(summary.eurcBalance).toBe(60);
    expect(summary.fiscalReserveBalance).toBe(40);
    expect(summary.freeRebuyLiquidity).toBe(60);
  });

  test("usa EURC disponible para recompras sin consumir efectivo", () => {
    repo.createMovement({ date: Date.now(), type: "efectivo_entrada", amount: 200, reason: "Aportación mensual" });
    repo.createMovement({ date: Date.now(), type: "eurc_entrada", amount: 90, reason: "Venta parcial" });

    const allocation = repo.allocateEurcToRebuy({
      amountEur: 35,
      reason: "Recompra del ciclo",
    });

    expect(allocation.id).toBeTruthy();
    const summary = repo.getSummary(0);
    expect(summary.cashBalance).toBe(200);
    expect(summary.eurcBalance).toBe(90);
    expect(summary.allocatedToRebuy).toBe(35);
    expect(summary.freeRebuyLiquidity).toBe(55);
  });

  test("usa EURC observado externamente y descuenta la reserva fiscal lógica", () => {
    repo.createMovement({ date: Date.now(), type: "reserva_fiscal", amount: 20, reason: "Apartar impuestos" });

    const summary = repo.getSummary(20, 100);
    expect(summary.eurcBalance).toBe(80);
    expect(summary.fiscalReserveBalance).toBe(20);
    expect(summary.freeRebuyLiquidity).toBe(80);
  });

  test("no permite financiar recompras con efectivo si no hay EURC libre", () => {
    repo.createMovement({ date: Date.now(), type: "efectivo_entrada", amount: 500, reason: "Aportación mensual" });

    expect(() => repo.allocateEurcToRebuy({
      amountEur: 1,
      reason: "Intento de recompra sin EURC",
    })).toThrow(/EURC libre suficiente/);

    const summary = repo.getSummary(0);
    expect(summary.cashBalance).toBe(500);
    expect(summary.freeRebuyLiquidity).toBe(0);
  });

  test("persiste movimientos manuales", () => {
    const created = repo.createMovement({
      date: Date.now(),
      type: "efectivo_entrada",
      amount: 123,
      reason: "Ingreso manual",
      notes: "Validación de persistencia",
    });

    const movements = repo.listMovements();
    expect(movements).toHaveLength(1);
    expect(movements[0].id).toBe(created.id);
    expect(movements[0].amount).toBe(123);
    expect(movements[0].notes).toBe("Validación de persistencia");
  });
});
