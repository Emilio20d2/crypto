import type { PerspectivesTaxBand } from "./domain/types";

export const DEFAULT_SPANISH_TAX_BANDS: PerspectivesTaxBand[] = [
  { upToEur: 6_000, rate: 0.19 },
  { upToEur: 50_000, rate: 0.21 },
  { upToEur: 200_000, rate: 0.23 },
  { upToEur: 300_000, rate: 0.27 },
  { upToEur: null, rate: 0.28 },
];

/**
 * Compatibility guard for the removed Perspectives V4 entry point.
 *
 * The variadic signature deliberately accepts the previous call shape so old
 * Electron handlers still compile, but execution always fails closed. This
 * prevents a packaged application from silently falling back to the obsolete
 * simulator while the handler is migrated to runPerspectivesV5Simulation.
 */
export function runPerspectivesSimulation(..._legacyArguments: unknown[]): never {
  throw new Error(
    "PERSPECTIVES_V4_REMOVED: usa runPerspectivesV5Simulation desde @crypto-control/portfolio/perspectives-v5. " +
    "La ruta legacy persp2 debe migrarse antes de publicar un nuevo DMG.",
  );
}
