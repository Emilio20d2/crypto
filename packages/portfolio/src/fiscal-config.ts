export interface FiscalBracket {
  upTo: number | null;
  rate: number;
}

export interface FiscalConfig {
  version: string;
  effectiveFrom: number;
  brackets: FiscalBracket[];
  jurisdiction: string;
}

export const SPANISH_FISCAL_CONFIG_2024: FiscalConfig = {
  version: "es-2024",
  effectiveFrom: new Date("2024-01-01").getTime(),
  jurisdiction: "ES",
  brackets: [
    { upTo: 6_000,   rate: 0.19 },
    { upTo: 50_000,  rate: 0.21 },
    { upTo: 200_000, rate: 0.23 },
    { upTo: 300_000, rate: 0.27 },
    { upTo: null,    rate: 0.28 },
  ],
};
