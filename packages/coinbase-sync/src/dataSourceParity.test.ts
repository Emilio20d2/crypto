import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../../..");
const desktopSrc = resolve(repoRoot, "apps/desktop/src");

function extractChannels(filePath: string, pattern: RegExp): string[] {
  const text = readFileSync(filePath, "utf-8");
  const channels: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    channels.push(match[1]);
  }
  return channels.sort();
}

describe("Web y escritorio consumen la misma fuente de datos", () => {
  test("todo canal invocado por el preload de Electron tiene un handler en main.ts", () => {
    const preloadChannels = extractChannels(
      resolve(desktopSrc, "preload.ts"),
      /ipcRenderer\.invoke\("([a-zA-Z0-9:_-]+)"/g
    );
    const mainChannels = extractChannels(
      resolve(desktopSrc, "main.ts"),
      /ipcMain\.handle\("([a-zA-Z0-9:_-]+)"/g
    );

    expect(preloadChannels.length).toBeGreaterThan(0);
    // Si esto falla, la web (HTTP bridge) y el escritorio (IPC nativo) dejaron
    // de hablar exactamente el mismo contrato — ya no hay una única fuente de verdad.
    expect(preloadChannels).toEqual(mainChannels);
  });

  test("el shim HTTP de la web (setupApi) sólo reenvía canales, no reimplementa lógica propia", () => {
    const setupApiText = readFileSync(resolve(repoRoot, "apps/web/src/lib/setupApi.ts"), "utf-8");
    // El shim debe construir cada llamada como un simple proxy ipc(channel, ...args),
    // nunca contener su propia lógica de negocio (fetch directo a Coinbase, cálculos, etc.).
    expect(setupApiText).toContain("/api/ipc");
    expect(setupApiText).not.toMatch(/api\.coinbase\.com|coingecko/i);
  });
});
