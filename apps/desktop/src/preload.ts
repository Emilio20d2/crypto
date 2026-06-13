import { contextBridge, ipcRenderer } from "electron";
import type { IPCAPI, CreateTransactionInput } from "@crypto-control/core";

const api: IPCAPI = {
  portfolio: {
    getSummary: () => ipcRenderer.invoke("portfolio:get-summary"),
  },
  transactions: {
    list: () => ipcRenderer.invoke("transactions:list"),
    create: (data: CreateTransactionInput) => ipcRenderer.invoke("transactions:create", data),
    update: (id: string, data: CreateTransactionInput) => ipcRenderer.invoke("transactions:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("transactions:delete", id),
  },
  assets: {
    list: () => ipcRenderer.invoke("assets:list"),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    update: (key: string, value: string) => ipcRenderer.invoke("settings:update", key, value),
  }
};

contextBridge.exposeInMainWorld("api", api);
