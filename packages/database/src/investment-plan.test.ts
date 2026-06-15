import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import * as schema from "./schema";

describe("Plan de inversión y ciclos", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    const now = Date.now();
    db.insert(schema.assets).values([
      { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto", createdAt: now, updatedAt: now },
      { id: "TON", symbol: "TON", name: "Toncoin", type: "crypto", createdAt: now, updatedAt: now },
    ]).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  function createPlan() {
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(schema.investmentPlans).values({
      id,
      name: "Plan principal",
      description: "Estrategia principal",
      status: "active",
      baseCurrency: "EUR",
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return id;
  }

  function createCycle(planId = createPlan()) {
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(schema.investmentCycles).values({
      id,
      planId,
      name: "Ciclo 2026-2030",
      startDate: new Date("2026-01-01T00:00:00Z").getTime(),
      endDate: new Date("2030-12-31T00:00:00Z").getTime(),
      monthlyAmountEur: 100,
      contributionCurrency: "EUR",
      status: "planned",
      priority: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return id;
  }

  test("crea un plan activo como fuente estratégica", () => {
    const planId = createPlan();

    const plan = db.select().from(schema.investmentPlans).where(eq(schema.investmentPlans.id, planId)).get();
    expect(plan?.status).toBe("active");
    expect(plan?.baseCurrency).toBe("EUR");
    expect(plan?.description).toBe("Estrategia principal");
  });

  test("crea un ciclo vinculado a un plan", () => {
    const planId = createPlan();
    const cycleId = createCycle(planId);

    const cycle = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, cycleId)).get();
    expect(cycle?.planId).toBe(planId);
    expect(cycle?.monthlyAmountEur).toBe(100);
    expect(cycle?.contributionCurrency).toBe("EUR");
    expect(cycle?.status).toBe("planned");
  });

  test("edita y elimina un ciclo sin tocar el plan", () => {
    const planId = createPlan();
    const cycleId = createCycle(planId);

    db.update(schema.investmentCycles)
      .set({ name: "Ciclo editado", monthlyAmountEur: 200, status: "paused", updatedAt: Date.now() })
      .where(eq(schema.investmentCycles.id, cycleId))
      .run();

    const updated = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, cycleId)).get();
    expect(updated?.name).toBe("Ciclo editado");
    expect(updated?.monthlyAmountEur).toBe(200);
    expect(updated?.status).toBe("paused");

    db.delete(schema.investmentCycles).where(eq(schema.investmentCycles.id, cycleId)).run();
    const deleted = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, cycleId)).get();
    const plan = db.select().from(schema.investmentPlans).where(eq(schema.investmentPlans.id, planId)).get();
    expect(deleted).toBeUndefined();
    expect(plan?.id).toBe(planId);
  });

  test("permite ciclo con fecha fin null", () => {
    const planId = createPlan();
    const now = Date.now();
    const cycleId = crypto.randomUUID();

    db.insert(schema.investmentCycles).values({
      id: cycleId,
      planId,
      name: "Ciclo abierto",
      startDate: new Date("2036-01-01T00:00:00Z").getTime(),
      endDate: null,
      monthlyAmountEur: 250,
      contributionCurrency: "EUR",
      status: "planned",
      priority: 3,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const cycle = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, cycleId)).get();
    expect(cycle?.endDate).toBeNull();
  });

  test("añade moneda con fecha inicio y fecha fin null", () => {
    const cycleId = createCycle();
    const now = Date.now();
    const assetPlanId = crypto.randomUUID();
    const startDate = new Date("2026-01-01T00:00:00Z").getTime();

    db.insert(schema.investmentAssets).values({
      id: assetPlanId,
      cycleId,
      assetId: "ADA",
      allocationType: "percentage",
      allocationValue: 40,
      allocationPercentage: 40,
      fixedAmountEur: null,
      priority: 1,
      targetAmount: 1_000,
      targetValueEur: 2_500,
      targetPortfolioPercentage: 15,
      startDate,
      endDate: null,
      status: "active",
      isActive: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const asset = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, assetPlanId)).get();
    expect(asset?.assetId).toBe("ADA");
    expect(asset?.startDate).toBe(startDate);
    expect(asset?.endDate).toBeNull();
    expect(asset?.allocationPercentage).toBe(40);
    expect(asset?.targetAmount).toBe(1_000);
    expect(asset?.targetValueEur).toBe(2_500);
    expect(asset?.targetPortfolioPercentage).toBe(15);
  });

  test("desactivar moneda no borra su histórico del ciclo", () => {
    const cycleId = createCycle();
    const now = Date.now();
    const assetPlanId = crypto.randomUUID();

    db.insert(schema.investmentAssets).values({
      id: assetPlanId,
      cycleId,
      assetId: "ADA",
      allocationType: "percentage",
      allocationValue: 40,
      allocationPercentage: 40,
      fixedAmountEur: null,
      priority: 1,
      startDate: new Date("2026-01-01T00:00:00Z").getTime(),
      endDate: null,
      status: "active",
      isActive: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.update(schema.investmentAssets)
      .set({
        isActive: 0,
        status: "paused",
        endDate: new Date("2028-01-01T00:00:00Z").getTime(),
        updatedAt: Date.now(),
      })
      .where(eq(schema.investmentAssets.id, assetPlanId))
      .run();

    const rows = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, assetPlanId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(0);
    expect(rows[0].status).toBe("paused");
    expect(rows[0].assetId).toBe("ADA");
  });

  test("cerrar moneda no borra su histórico del ciclo", () => {
    const cycleId = createCycle();
    const now = Date.now();
    const assetPlanId = crypto.randomUUID();

    db.insert(schema.investmentAssets).values({
      id: assetPlanId,
      cycleId,
      assetId: "TON",
      allocationType: "percentage",
      allocationValue: 60,
      allocationPercentage: 60,
      fixedAmountEur: null,
      priority: 2,
      startDate: new Date("2028-01-01T00:00:00Z").getTime(),
      endDate: null,
      status: "active",
      isActive: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.update(schema.investmentAssets)
      .set({
        isActive: 0,
        status: "closed",
        endDate: new Date("2030-01-01T00:00:00Z").getTime(),
        updatedAt: Date.now(),
      })
      .where(eq(schema.investmentAssets.id, assetPlanId))
      .run();

    const rows = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, assetPlanId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("closed");
    expect(rows[0].assetId).toBe("TON");
  });


  test("una revisión de estrategia no modifica el pasado", () => {
    const cycleId = createCycle();
    const now = Date.now();
    const adaPlanId = crypto.randomUUID();
    const adaStart = new Date("2026-01-01T00:00:00Z").getTime();

    db.insert(schema.investmentAssets).values({
      id: adaPlanId,
      cycleId,
      assetId: "ADA",
      allocationType: "percentage",
      allocationValue: 40,
      allocationPercentage: 40,
      fixedAmountEur: null,
      priority: 1,
      startDate: adaStart,
      endDate: null,
      status: "active",
      isActive: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(schema.strategyRevisions).values({
      id: crypto.randomUUID(),
      cycleId,
      effectiveDate: new Date("2028-01-01T00:00:00Z").getTime(),
      title: "Dejar ADA y empezar TON",
      notes: "Cambio de estrategia desde 2028.",
      changesJson: JSON.stringify({ stop: ["ADA"], start: ["TON"] }),
      createdAt: Date.now(),
    }).run();

    const asset = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, adaPlanId)).get();
    const revisions = db.select().from(schema.strategyRevisions).where(eq(schema.strategyRevisions.cycleId, cycleId)).all();
    expect(asset?.startDate).toBe(adaStart);
    expect(asset?.allocationValue).toBe(40);
    expect(revisions).toHaveLength(1);
  });
});
