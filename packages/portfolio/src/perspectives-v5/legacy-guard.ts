import type { PerspectivesTaxBand } from "./domain/types";

export const DEFAULT_SPANISH_TAX_BANDS: PerspectivesTaxBand[] = [
  { upToEur: 6_000, rate: 0.19 },
  { upToEur: 50_000, rate: 0.21 },
  { upToEur: 200_000, rate: 0.23 },
  { upToEur: 300_000, rate: 0.27 },
  { upToEur: null, rate: 0.28 },
];
