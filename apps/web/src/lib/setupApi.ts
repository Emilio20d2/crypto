// Installs a window.cryptoControl implementation backed by HTTP when running in
// a browser (no Electron preload). The Electron main process exposes the same
// IPC handlers on http://<host>:3001/api/ipc so both clients share one SQLite DB.
import type { FullCryptoControlAPI } from "@crypto-control/core";

if (typeof window !== "undefined" && !window.cryptoControl) {
  const hostname = window.location.hostname || "localhost";
  const API_BASE = `http://${hostname}:3001`;

  async function ipc(channel: string, ...args: unknown[]): Promise<unknown> {
    const res = await fetch(`${API_BASE}/api/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, args }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on channel ${channel}`);
    return res.json();
  }

  window.cryptoControl = {
    assets: {
      list: () => ipc("assets:list"),
    },
    portfolio: {
      getSummary:          () => ipc("portfolio:get-summary"),
      getPositions:        () => ipc("portfolio:get-positions"),
      getAllocation:        () => ipc("portfolio:get-allocation"),
      getRealizedGains:    () => ipc("portfolio:get-realized-gains"),
      getFifoLots:         () => ipc("portfolio:get-fifo-lots"),
      getHistoricalSeries: (i?: unknown) => ipc("portfolio:get-historical-series", i),
      backfillCostBasis:   () => ipc("portfolio:backfillCostBasis"),
    },
    diagnostics: {
      getReport: () => ipc("diagnostics:getReport"),
    },
    transactions: {
      list:   () =>                              ipc("transactions:list"),
      create: (d: unknown) =>                   ipc("transactions:create", d),
      update: (id: unknown, d: unknown) =>      ipc("transactions:update", id, d),
      delete: (id: unknown) =>                  ipc("transactions:delete", id),
    },
    market: {
      getCurrentPrice:     (i: unknown) =>      ipc("market:get-current-price", i),
      getHistoricalPrices: (i: unknown) =>      ipc("market:get-historical-prices", i),
      getOverview:         (i: unknown) =>      ipc("market:get-overview", i),
      getFearGreed:        () =>                ipc("market:get-fear-greed"),
      getGlobalMetrics:    () =>                ipc("market:get-global-metrics"),
      getCryptoControlIndex: () =>              ipc("market:getCryptoControlIndex"),
    },
    settings: {
      get:    (key: unknown) =>                 ipc("settings:get", key),
      update: (key: unknown, v: unknown) =>     ipc("settings:update", key, v),
    },
    coinbase: {
      importCredentialsFile:  () =>                         ipc("coinbase:import-credentials-file"),
      connectFromJson:        (json: unknown) =>            ipc("coinbase:connect-from-json", json),
      connect:                (creds: unknown) =>           ipc("coinbase:connect", creds),
      disconnect:             () =>                         ipc("coinbase:disconnect"),
      getStatus:              () =>                         ipc("coinbase:get-status"),
      sync:                   () =>                         ipc("coinbase:sync"),
      getSyncHistory:         () =>                         ipc("coinbase:get-sync-history"),
      listPortfolios:         () =>                         ipc("coinbase:list-portfolios"),
      getPortfolioBreakdown:  (uuid: unknown, cur: unknown) => ipc("coinbase:get-portfolio-breakdown", uuid, cur),
      getPortfolioSnapshots:  (uuid: unknown) =>            ipc("coinbase:get-portfolio-snapshots", uuid),
    },
    sentiment: {
      getGlobal: (i: unknown) => ipc("sentiment:get-global", i),
      getAsset:  (i: unknown) => ipc("sentiment:get-asset", i),
      getHistory:(i: unknown) => ipc("sentiment:get-history", i),
      refresh:   (i: unknown) => ipc("sentiment:refresh", i),
    },
    targets: {
      list:   () =>                             ipc("targets:list"),
      upsert: (d: unknown) =>                   ipc("targets:upsert", d),
      delete: (id: unknown) =>                  ipc("targets:delete", id),
    },
    alerts: {
      list:   () =>                             ipc("alerts:list"),
      create: (d: unknown) =>                   ipc("alerts:create", d),
      delete: (id: unknown) =>                  ipc("alerts:delete", id),
      toggle: (id: unknown) =>                  ipc("alerts:toggle", id),
    },
    investmentPlan: {
      list:      () =>                          ipc("investmentPlan:list"),
      getActive: () =>                          ipc("investmentPlan:getActive"),
      create:    (d: unknown) =>                ipc("investmentPlan:create", d),
      update:    (id: unknown, d: unknown) =>   ipc("investmentPlan:update", id, d),
      delete:    (id: unknown) =>               ipc("investmentPlan:delete", id),
    },
    investmentCycles: {
      list:              (i?: unknown) =>             ipc("investmentCycles:list", i),
      getCurrent:        (i?: unknown) =>             ipc("investmentCycles:getCurrent", i),
      create:            (d: unknown) =>              ipc("investmentCycles:create", d),
      update:            (id: unknown, d: unknown) => ipc("investmentCycles:update", id, d),
      delete:            (id: unknown) =>             ipc("investmentCycles:delete", id),
      getMetrics:        (i: unknown) =>              ipc("investmentCycles:getMetrics", i),
      listPartialSales:  (i?: unknown) =>             ipc("investmentCycles:listPartialSales", i),
      createPartialSale: (d: unknown) =>              ipc("investmentCycles:createPartialSale", d),
      deletePartialSale: (id: unknown) =>             ipc("investmentCycles:deletePartialSale", id),
    },
    investmentAssets: {
      list:   (i?: unknown) =>                  ipc("investmentAssets:list", i),
      create: (d: unknown) =>                   ipc("investmentAssets:create", d),
      update: (id: unknown, d: unknown) =>      ipc("investmentAssets:update", id, d),
      pause:  (id: unknown, d?: unknown) =>     ipc("investmentAssets:pause", id, d),
      close:  (id: unknown, d?: unknown) =>     ipc("investmentAssets:close", id, d),
      delete: (id: unknown) =>                  ipc("investmentAssets:delete", id),
      getHealth: (i: unknown) =>                ipc("investmentAssets:getHealth", i),
    },
    strategyRevisions: {
      list:   (i?: unknown) =>                  ipc("strategyRevisions:list", i),
      create: (d: unknown) =>                   ipc("strategyRevisions:create", d),
    },
    contributionSchedule: {
      list:    (i?: unknown) =>                 ipc("contributionSchedule:list", i),
      create:  (d: unknown) =>                  ipc("contributionSchedule:create", d),
      update:  (id: unknown, d: unknown) =>     ipc("contributionSchedule:update", id, d),
      execute: (id: unknown) =>                 ipc("contributionSchedule:execute", id),
      delete:  (id: unknown) =>                 ipc("contributionSchedule:delete", id),
    },
    assetSubstitutions: {
      list:    (i?: unknown) =>                 ipc("assetSubstitutions:list", i),
      create:  (d: unknown) =>                  ipc("assetSubstitutions:create", d),
      execute: (id: unknown) =>                 ipc("assetSubstitutions:execute", id),
      delete:  (id: unknown) =>                 ipc("assetSubstitutions:delete", id),
    },
    strategicAlerts: {
      generate: (i: unknown) =>                 ipc("strategicAlerts:generate", i),
    },
    strategicDecisions: {
      getCycleReport: (i: unknown) =>           ipc("strategicDecisions:getCycleReport", i),
    },
    treasury: {
      getSummary:                 () =>                         ipc("treasury:getSummary"),
      listMovements:              () =>                         ipc("treasury:listMovements"),
      createMovement:             (d: unknown) =>               ipc("treasury:createMovement", d),
      updateMovement:             (id: unknown, d: unknown) =>  ipc("treasury:updateMovement", id, d),
      deleteMovement:             (id: unknown) =>              ipc("treasury:deleteMovement", id),
      setFiscalReserve:           (d: unknown) =>               ipc("treasury:setFiscalReserve", d),
      allocateEurcToRebuy:        (d: unknown) =>               ipc("treasury:allocateEurcToRebuy", d),
      allocateCashToRebuy:        (d: unknown) =>               ipc("treasury:allocateCashToRebuy", d),
      listCycleLiquidity:         (i?: unknown) =>              ipc("treasury:listCycleLiquidity", i),
      listFiscalReserveMovements: (i?: unknown) =>              ipc("treasury:listFiscalReserveMovements", i),
    },
  } as unknown as FullCryptoControlAPI;
}
