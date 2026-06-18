import { describe, test, expect } from "vitest";
import {
  buildContributionHistory,
  calculateCycleContributionAggregates,
  classifyMonth,
  classifyContributionOrigin,
  isCapitalNuevo,
  detectDuplicateContribution,
  deriveContributionEntriesFromOperations,
  mergeManualAndOperationContributions,
  type ContributionEntry,
  type ContributionCycleInput,
} from "./plan-contributions";

const DAY = 86_400_000;

function makeDate(s: string): number {
  return new Date(s + "T00:00:00Z").getTime();
}

function makeCycle(overrides: Partial<ContributionCycleInput> = {}): ContributionCycleInput {
  return {
    id: "cycle-1",
    startDate: makeDate("2026-01-01"),
    endDate: null,
    monthlyAmountEur: 100,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ContributionEntry> = {}): ContributionEntry {
  return {
    id: "entry-1",
    cycleId: "cycle-1",
    type: "periodica",
    plannedDate: makeDate("2026-01-15"),
    amountEur: 100,
    status: "ejecutada",
    executedAt: makeDate("2026-01-15"),
    notes: null,
    ...overrides,
  };
}

// ── classifyMonth ─────────────────────────────────────────────────────────────

describe("classifyMonth", () => {
  test("100 programados, 150 reales → superada, extraordinaria=50, deficit=0", () => {
    const now = makeDate("2026-02-01");
    const entries = [
      makeEntry({ amountEur: 100, executedAt: makeDate("2026-01-10") }),
      makeEntry({ id: "e2", amountEur: 50, executedAt: makeDate("2026-01-20") }),
    ];
    const s = classifyMonth("2026-01", entries, 100, "cycle-1", now);
    expect(s.actualAmountEur).toBeCloseTo(150);
    expect(s.scheduledPortionEur).toBeCloseTo(100);
    expect(s.extraordinaryAmountEur).toBeCloseTo(50);
    expect(s.deficitAmountEur).toBeCloseTo(0);
    expect(s.status).toBe("superada");
  });

  test("100 programados, 80 reales → parcial, deficit=20, extraordinaria=0", () => {
    const now = makeDate("2026-02-01");
    const entries = [makeEntry({ amountEur: 80, executedAt: makeDate("2026-01-20") })];
    const s = classifyMonth("2026-01", entries, 100, "cycle-1", now);
    expect(s.actualAmountEur).toBeCloseTo(80);
    expect(s.scheduledPortionEur).toBeCloseTo(80);
    expect(s.extraordinaryAmountEur).toBeCloseTo(0);
    expect(s.deficitAmountEur).toBeCloseTo(20);
    expect(s.status).toBe("parcial");
  });

  test("100 programados, 0 reales, mes pasado → omitida", () => {
    const now = makeDate("2026-02-01");
    const s = classifyMonth("2026-01", [], 100, "cycle-1", now);
    expect(s.actualAmountEur).toBeCloseTo(0);
    expect(s.deficitAmountEur).toBeCloseTo(100);
    expect(s.status).toBe("omitida");
  });

  test("100 programados, 100 reales → cumplida", () => {
    const now = makeDate("2026-02-01");
    const entries = [makeEntry({ amountEur: 100, executedAt: makeDate("2026-01-15") })];
    const s = classifyMonth("2026-01", entries, 100, "cycle-1", now);
    expect(s.status).toBe("cumplida");
    expect(s.extraordinaryAmountEur).toBeCloseTo(0);
    expect(s.deficitAmountEur).toBeCloseTo(0);
  });

  test("mes futuro → prevista", () => {
    const now = makeDate("2026-01-01");
    const s = classifyMonth("2026-06", [], 100, "cycle-1", now);
    expect(s.status).toBe("prevista");
    expect(s.deficitAmountEur).toBeCloseTo(100);
  });

  test("mes actual sin aportación → pendiente", () => {
    const now = makeDate("2026-06-15");
    const s = classifyMonth("2026-06", [], 100, "cycle-1", now);
    expect(s.status).toBe("pendiente");
  });

  test("entradas canceladas no cuentan como actual", () => {
    const now = makeDate("2026-02-01");
    const cancelled = makeEntry({ status: "cancelada", amountEur: 100, executedAt: makeDate("2026-01-10") });
    const s = classifyMonth("2026-01", [cancelled], 100, "cycle-1", now);
    expect(s.actualAmountEur).toBeCloseTo(0);
    expect(s.status).toBe("omitida");
  });

  test("entradas pendientes no cuentan como actual", () => {
    const now = makeDate("2026-02-01");
    const pending = makeEntry({ status: "pendiente", amountEur: 100, executedAt: null });
    const s = classifyMonth("2026-01", [pending], 100, "cycle-1", now);
    expect(s.actualAmountEur).toBeCloseTo(0);
    expect(s.status).toBe("omitida");
  });
});

// ── buildContributionHistory ──────────────────────────────────────────────────

describe("buildContributionHistory", () => {
  test("devuelve un mes cuando start y now son el mismo mes", () => {
    const cycle = makeCycle({
      startDate: makeDate("2026-06-01"),
      endDate: null,
    });
    const history = buildContributionHistory(cycle, [], makeDate("2026-06-15"));
    expect(history).toHaveLength(1);
    expect(history[0].yearMonth).toBe("2026-06");
  });

  test("devuelve todos los meses entre start y now", () => {
    const cycle = makeCycle({
      startDate: makeDate("2026-01-01"),
      endDate: null,
    });
    const history = buildContributionHistory(cycle, [], makeDate("2026-04-01"));
    expect(history.map(s => s.yearMonth)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  test("ciclo con fecha fin respeta el fin", () => {
    const cycle = makeCycle({
      startDate: makeDate("2026-01-01"),
      endDate: makeDate("2026-03-01"),
    });
    const history = buildContributionHistory(cycle, [], makeDate("2026-12-01"));
    expect(history.map(s => s.yearMonth)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("asigna las entradas al mes correcto", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = [
      makeEntry({ amountEur: 80, executedAt: makeDate("2026-01-20") }),
      makeEntry({ id: "e2", amountEur: 100, executedAt: makeDate("2026-02-15") }),
    ];
    const history = buildContributionHistory(cycle, entries, makeDate("2026-03-01"));
    expect(history[0].actualAmountEur).toBeCloseTo(80);
    expect(history[1].actualAmountEur).toBeCloseTo(100);
  });
});

// ── deriveContributionEntriesFromOperations ──────────────────────────────────

describe("deriveContributionEntriesFromOperations", () => {
  test("usa depósitos EUR de Operaciones como aportación real y no duplica compras del mismo mes", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = deriveContributionEntriesFromOperations(cycle, [
      {
        id: "deposit-1",
        type: "transfer_in",
        date: makeDate("2026-01-05"),
        externalId: "cb-deposit-1",
        legs: [{ assetId: "EUR", amount: 100, legType: "destination" }],
      },
      {
        id: "buy-1",
        type: "buy",
        date: makeDate("2026-01-06"),
        externalId: "cb-buy-1",
        legs: [
          { assetId: "EUR", amount: -100, legType: "source", valuationEur: 100 },
          { assetId: "BTC", amount: 0.001, legType: "destination", valuationEur: 100 },
        ],
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].amountEur).toBeCloseTo(100);
    expect(entries[0].notes).toMatch(/depósito fiat/);
  });

  test("si no hay depósito EUR, usa compras EUR de Operaciones como aportación", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = deriveContributionEntriesFromOperations(cycle, [
      {
        id: "buy-1",
        type: "buy",
        date: makeDate("2026-02-06"),
        externalId: "cb-buy-1",
        legs: [
          { assetId: "EUR", amount: -40, legType: "source", valuationEur: 40 },
          { assetId: "ADA", amount: 100, legType: "destination", valuationEur: 40 },
        ],
      },
      {
        id: "buy-2",
        type: "buy",
        date: makeDate("2026-02-20"),
        externalId: "cb-buy-2",
        legs: [
          { assetId: "EUR", amount: -60, legType: "source", valuationEur: 60 },
          { assetId: "BTC", amount: 0.001, legType: "destination", valuationEur: 60 },
        ],
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.amountEur, 0)).toBeCloseTo(100);
    expect(entries.every((entry) => entry.notes?.includes("compra EUR"))).toBe(true);
  });

  test("ignora conversiones y compras financiadas con EURC", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = deriveContributionEntriesFromOperations(cycle, [
      {
        id: "convert-1",
        type: "convert",
        date: makeDate("2026-03-10"),
        legs: [
          { assetId: "ADA", amount: -10, legType: "source" },
          { assetId: "BTC", amount: 0.0001, legType: "destination" },
        ],
      },
      {
        id: "buy-eurc",
        type: "buy",
        date: makeDate("2026-03-11"),
        legs: [
          { assetId: "EURC", amount: -50, legType: "source", valuationEur: 50 },
          { assetId: "BTC", amount: 0.0005, legType: "destination" },
        ],
      },
    ], (assetId) => assetId === "EUR");

    expect(entries).toHaveLength(0);
  });

  test("el resumen prefiere Operaciones/Coinbase frente a manuales ejecutadas del mismo mes", () => {
    const manual = [
      makeEntry({ id: "manual-jan", plannedDate: makeDate("2026-01-10"), executedAt: makeDate("2026-01-10"), amountEur: 100 }),
      makeEntry({ id: "manual-feb", plannedDate: makeDate("2026-02-10"), executedAt: makeDate("2026-02-10"), amountEur: 100 }),
    ];
    const operation = [
      makeEntry({ id: "coinbase-operation:jan", plannedDate: makeDate("2026-01-05"), executedAt: makeDate("2026-01-05"), amountEur: 100 }),
    ];

    const merged = mergeManualAndOperationContributions(manual, operation);

    expect(merged.map((entry) => entry.id)).toEqual(["coinbase-operation:jan", "manual-feb"]);
  });
});

// ── calculateCycleContributionAggregates ──────────────────────────────────────

describe("calculateCycleContributionAggregates", () => {
  test("calcula acumulados correctamente: cumplida+superada+parcial+omitida", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = [
      makeEntry({ id: "e1", amountEur: 100, executedAt: makeDate("2026-01-15") }),  // cumplida
      makeEntry({ id: "e2", amountEur: 150, executedAt: makeDate("2026-02-15") }),  // superada
      makeEntry({ id: "e3", amountEur: 60,  executedAt: makeDate("2026-03-15") }),  // parcial
      // 2026-04 sin entrada → omitida
    ];
    const now = makeDate("2026-05-01");
    const history = buildContributionHistory(cycle, entries, now);
    const agg = calculateCycleContributionAggregates(cycle, history, entries, now);

    expect(agg.totalActualEur).toBeCloseTo(310);
    expect(agg.totalPlannedEur).toBeCloseTo(400); // 4 meses cerrados × 100 (mayo=pendiente excluido)
    expect(agg.totalExtraordinaryEur).toBeCloseTo(50);
    expect(agg.totalDeficitEur).toBeCloseTo(140); // 40 de marzo + 100 de abril
    expect(agg.monthsCumplida).toBe(1);
    expect(agg.monthsSuperada).toBe(1);
    expect(agg.monthsParcial).toBe(1);
    expect(agg.monthsOmitida).toBe(1);
  });

  test("cumplimiento al 100% con todo ejecutado", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = [makeEntry({ amountEur: 100, executedAt: makeDate("2026-01-15") })];
    // now = Feb 15: Jan is closed (cumplida), Feb is still open (pendiente, excluded)
    const now = makeDate("2026-02-15");
    const history = buildContributionHistory(cycle, entries, now);
    const agg = calculateCycleContributionAggregates(cycle, history, entries, now);

    expect(agg.compliancePercentage).toBeCloseTo(100);
    expect(agg.monthsCumplida).toBe(1);
  });

  test("sin entradas → cumplimiento 0%", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const now = makeDate("2026-03-01");
    const history = buildContributionHistory(cycle, [], now);
    const agg = calculateCycleContributionAggregates(cycle, history, [], now);

    expect(agg.compliancePercentage).toBeCloseTo(0);
    expect(agg.monthsOmitida).toBe(2);
    expect(agg.monthsCumplida).toBe(0);
  });

  test("lastContributionDate es la fecha más reciente ejecutada", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const entries = [
      makeEntry({ id: "e1", executedAt: makeDate("2026-01-10") }),
      makeEntry({ id: "e2", executedAt: makeDate("2026-02-20") }),
    ];
    const now = makeDate("2026-03-01");
    const history = buildContributionHistory(cycle, entries, now);
    const agg = calculateCycleContributionAggregates(cycle, history, entries, now);

    expect(agg.lastContributionDate).toBe(makeDate("2026-02-20"));
  });

  test("mes actual (pendiente) no se cuenta como omitida", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-06-01") });
    const now = makeDate("2026-06-15");
    const history = buildContributionHistory(cycle, [], now);
    const agg = calculateCycleContributionAggregates(cycle, history, [], now);

    expect(agg.monthsOmitida).toBe(0);
  });
});

// ── classifyContributionOrigin ────────────────────────────────────────────────

describe("classifyContributionOrigin", () => {
  test("periodica sin notas → capital_nuevo", () => {
    expect(classifyContributionOrigin("periodica", null)).toBe("capital_nuevo");
  });

  test("extraordinaria sin notas → capital_nuevo", () => {
    expect(classifyContributionOrigin("extraordinaria", null)).toBe("capital_nuevo");
  });

  test("notas con 'recompra' → recompra", () => {
    expect(classifyContributionOrigin("periodica", "Recompra de BTC")).toBe("recompra");
  });

  test("notas con 'eurc' → eurc", () => {
    expect(classifyContributionOrigin("extraordinaria", "usando EURC")).toBe("eurc");
  });

  test("notas con 'conversion' → conversion", () => {
    expect(classifyContributionOrigin("periodica", "Conversión ADA→SUI")).toBe("conversion");
  });

  test("notas con 'beneficio' → reinversion", () => {
    expect(classifyContributionOrigin("periodica", "Reinversión de beneficios")).toBe("reinversion");
  });

  test("isCapitalNuevo: periodica normal → true", () => {
    expect(isCapitalNuevo(makeEntry({ notes: null }))).toBe(true);
  });

  test("isCapitalNuevo: entrada EURC → false", () => {
    expect(isCapitalNuevo(makeEntry({ notes: "compra con EURC" }))).toBe(false);
  });
});

// ── detectDuplicateContribution ───────────────────────────────────────────────

describe("detectDuplicateContribution", () => {
  test("detecta entrada duplicada del mismo mes y tipo e importe", () => {
    const existing = [makeEntry({ id: "orig", amountEur: 100, plannedDate: makeDate("2026-01-15") })];
    const newEntry = { cycleId: "cycle-1", type: "periodica" as const, plannedDate: makeDate("2026-01-20"), amountEur: 100 };
    const dup = detectDuplicateContribution(newEntry, existing);
    expect(dup).not.toBeNull();
    expect(dup?.id).toBe("orig");
  });

  test("no detecta duplicado de mes diferente", () => {
    const existing = [makeEntry({ id: "orig", amountEur: 100, plannedDate: makeDate("2026-01-15") })];
    const newEntry = { cycleId: "cycle-1", type: "periodica" as const, plannedDate: makeDate("2026-02-10"), amountEur: 100 };
    expect(detectDuplicateContribution(newEntry, existing)).toBeNull();
  });

  test("no detecta duplicado si importe diferente", () => {
    const existing = [makeEntry({ id: "orig", amountEur: 100, plannedDate: makeDate("2026-01-15") })];
    const newEntry = { cycleId: "cycle-1", type: "periodica" as const, plannedDate: makeDate("2026-01-20"), amountEur: 150 };
    expect(detectDuplicateContribution(newEntry, existing)).toBeNull();
  });

  test("entradas canceladas no se consideran duplicado", () => {
    const existing = [makeEntry({ id: "orig", amountEur: 100, plannedDate: makeDate("2026-01-15"), status: "cancelada" })];
    const newEntry = { cycleId: "cycle-1", type: "periodica" as const, plannedDate: makeDate("2026-01-20"), amountEur: 100 };
    expect(detectDuplicateContribution(newEntry, existing)).toBeNull();
  });
});
