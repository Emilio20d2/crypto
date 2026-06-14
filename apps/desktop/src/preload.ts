import { contextBridge, ipcRenderer } from "electron";
import type { FullCryptoControlAPI, CreateTransactionInput, CoinbaseCredentials } from "@crypto-control/core";

const cryptoControl: FullCryptoControlAPI = {
  assets: {
    list: () => ipcRenderer.invoke("assets:list")
  },
  portfolio: {
    getSummary:   () => ipcRenderer.invoke("portfolio:get-summary"),
    getPositions: () => ipcRenderer.invoke("portfolio:get-positions"),
    getAllocation: () => ipcRenderer.invoke("portfolio:get-allocation"),
  },
  transactions: {
    list:   ()                                     => ipcRenderer.invoke("transactions:list"),
    create: (data: CreateTransactionInput)         => ipcRenderer.invoke("transactions:create", data),
    update: (id: string, data: CreateTransactionInput) => ipcRenderer.invoke("transactions:update", id, data),
    delete: (id: string)                           => ipcRenderer.invoke("transactions:delete", id),
  },
  market: {
    getCurrentPrice:    (input: { assetId: string; quoteCurrency: string })                    => ipcRenderer.invoke("market:get-current-price", input),
    getHistoricalPrices:(input: { assetId: string; quoteCurrency: string; period: string })    => ipcRenderer.invoke("market:get-historical-prices", input),
  },
  settings: {
    get:    (key: string)               => ipcRenderer.invoke("settings:get", key),
    update: (key: string, value: string)=> ipcRenderer.invoke("settings:update", key, value),
  },
  coinbase: {
    importCredentialsFile: ()                           => ipcRenderer.invoke("coinbase:import-credentials-file"),
    connectFromJson:       (jsonContent: string)        => ipcRenderer.invoke("coinbase:connect-from-json", jsonContent),
    connect:               (credentials: CoinbaseCredentials) => ipcRenderer.invoke("coinbase:connect", credentials),
    disconnect:            ()                           => ipcRenderer.invoke("coinbase:disconnect"),
    getStatus:             ()                           => ipcRenderer.invoke("coinbase:get-status"),
    sync:                  ()                           => ipcRenderer.invoke("coinbase:sync"),
    listPortfolios:        ()                           => ipcRenderer.invoke("coinbase:list-portfolios"),
    getPortfolioBreakdown: (portfolioUuid: string, currency: string) => ipcRenderer.invoke("coinbase:get-portfolio-breakdown", portfolioUuid, currency),
    getPortfolioSnapshots: (portfolioUuid: string)      => ipcRenderer.invoke("coinbase:get-portfolio-snapshots", portfolioUuid),
  },
};

contextBridge.exposeInMainWorld("cryptoControl", cryptoControl);
