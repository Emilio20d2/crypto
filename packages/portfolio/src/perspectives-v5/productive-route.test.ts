import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Perspectives V5 productive route guard", () => {
  it("keeps Electron connected to the V5 handler and not to the removed V4 engine", () => {
    const main = readRepoFile("apps/desktop/src/main.ts");

    expect(main).toContain('ipcMain.handle("perspectivesV5:getSimulation"');
    expect(main).toContain("runPerspectivesV5Simulation({");
    expect(main).not.toContain("runPerspectivesSimulation");
  });

  it("keeps the Perspectivas page on the V5 IPC channel", () => {
    const page = readRepoFile("apps/web/src/pages/Perspectivas.tsx");
    const preload = readRepoFile("apps/desktop/src/preload.ts");
    const setupApi = readRepoFile("apps/web/src/lib/setupApi.ts");

    expect(page).toContain("perspectivesV5:getSimulation");
    expect(page).toContain("window.cryptoControl.perspectivesV5.getSimulation");
    expect(page).not.toContain("window.cryptoControl.persp2.getSimulation");
    expect(preload).toContain('ipcRenderer.invoke("perspectivesV5:getSimulation"');
    expect(setupApi).toContain('ipc("perspectivesV5:getSimulation"');
  });
});
