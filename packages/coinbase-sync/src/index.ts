export { CoinbaseCredentialsManager } from "./credentials";
export { CoinbaseClient, CoinbaseApiError, buildJWT } from "./client";
export type { CoinbaseErrorCode } from "./client";
export { CoinbaseSyncService } from "./sync-service";
export { parseCdpJson, normalizePrivateKey, CdpParseError } from "./cdp-parser";
export type { ParsedCdpCredentials, CdpErrorCode } from "./cdp-parser";
export type {
  CoinbaseCredentials,
  CoinbaseStatus,
  CoinbaseSyncResult,
  CoinbaseFill,
  CoinbaseCreateOrderRequest,
  CoinbaseCreateOrderResponse,
  CoinbaseOrderPreviewRequest,
  CoinbaseOrderPreviewResponse,
  KeyPermissionsResponse,
  CdpKeyPermissions,
  CdpImportResult,
} from "./types";

export { CoinbasePortfolioService } from "./portfolio-service";
export type { CoinbasePortfolioView, CoinbaseSpotPositionView } from "./portfolio-service";
