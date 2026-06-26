type Timer = ReturnType<typeof setTimeout>;

export type RealtimePriceState = "live" | "polling" | "fallback" | "stale" | "unavailable";

export interface RealtimeBalance {
  accountId: string | null;
  assetId: string;
  available: number;
  hold: number;
  total: number;
  source: "coinbase" | "cache";
}

export interface RealtimePrice {
  assetId: string;
  productId: string | null;
  priceEur: number | null;
  originalPrice: number | null;
  originalCurrency: "EUR" | "USD" | null;
  fxRate: number | null;
  fxSource: string | null;
  source: string;
  quotedAt: number;
  state: RealtimePriceState;
}

export interface RealtimePosition {
  assetId: string;
  quantity: number;
  availableBalance: number;
  holdBalance: number;
  priceEur: number | null;
  valueEur: number | null;
  currentPriceEur: number | null;
  currentValueEur: number | null;
  priceSource: string;
  priceStatus: string;
}

export interface RealtimePortfolioSnapshot {
  requestedAt: number;
  receivedAt: number;
  marketTimestamp: number;
  snapshotVersion: string;
  balanceVersion: string;
  priceVersion: string;
  balances: RealtimeBalance[];
  prices: Record<string, RealtimePrice>;
  positions: RealtimePosition[];
  cryptoValueEur: number;
  eurBalance: number;
  eurcBalance: number;
  eurcValueEur: number;
  totalAssetValueEur: number | null;
  complete: boolean;
  stale: boolean;
  usingFallback: boolean;
  missingPrices: string[];
  warnings: string[];
  skippedTicks: number;
  socket: {
    connected: boolean;
    state: "idle" | "connecting" | "live" | "stale" | "reconnecting" | "unavailable";
    lastMessageAt: number | null;
    subscribedProducts: string[];
  };

  // Backwards-compatible shape consumed by Portfolio.tsx today.
  accounts: Array<{
    assetId: string;
    availableBalance: number;
    holdBalance: number;
    totalBalance: number;
  }>;
  isComplete: boolean;
  timestamp: number;
  fiat: "EUR";
  portfolioVersion: string;
}

export interface CoinbaseAccountsClient {
  getAccounts(): Promise<{ accounts?: unknown[] }>;
}

export interface CachedPortfolioBreakdown {
  positions?: unknown[];
}

export interface RestPriceResult {
  price: number | null;
  state?: string;
  provider?: string;
  fetchedAt?: number;
  reason?: string;
}

export interface RealtimePortfolioMarketEngineDeps {
  getCoinbaseClient(): CoinbaseAccountsClient | null;
  getCachedPortfolioBreakdown(portfolioUuid: string): Promise<CachedPortfolioBreakdown | null>;
  getRestPrice(assetId: string): Promise<RestPriceResult>;
  now?(): number;
  setInterval?(handler: () => void, ms: number): Timer;
  clearInterval?(timer: Timer): void;
  setTimeout?(handler: () => void, ms: number): Timer;
  clearTimeout?(timer: Timer): void;
  createWebSocket?(url: string): RealtimeWebSocket;
  publish?(snapshot: RealtimePortfolioSnapshot): void;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface RealtimeWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  readyState: number;
  send(data: string): void;
  close(): void;
}

interface RawAccount {
  accountId: string | null;
  currency: string;
  available: number;
  hold: number;
  total: number;
  source: "coinbase" | "cache";
}

interface LivePriceEntry extends RealtimePrice {
  productId: string;
}

const COINBASE_WS_URL = "wss://advanced-trade-ws.coinbase.com";
const BALANCE_REFRESH_MS = 5_000;
const BALANCE_TIMEOUT_MS = 4_500;
const REST_PRICE_TIMEOUT_MS = 3_500;
const LIVE_PRICE_TTL_MS = 10_000;
const LAST_PRICE_TTL_MS = 5 * 60_000;
const SOCKET_STALE_MS = 20_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableVersion(parts: string[]): string {
  return parts.sort().join("|");
}

function productIdFor(assetId: string, quote: "EUR" | "USD" = "EUR"): string {
  return `${assetId.toUpperCase()}-${quote}`;
}

function parseCoinbaseAccount(account: unknown): RawAccount | null {
  const row = account as Record<string, unknown>;
  const currency = stringOrNull(row.currency) ?? stringOrNull(row.asset) ?? stringOrNull(row.asset_id);
  if (!currency) return null;

  const available =
    finiteNumber((row.available_balance as Record<string, unknown> | undefined)?.value) ??
    finiteNumber(row.available) ??
    0;
  const explicitHold =
    finiteNumber((row.hold as Record<string, unknown> | undefined)?.value) ??
    finiteNumber(row.hold) ??
    null;
  const total =
    finiteNumber((row.total_balance as Record<string, unknown> | undefined)?.value) ??
    finiteNumber(row.total) ??
    finiteNumber(row.totalBalance) ??
    (available + (explicitHold ?? 0));
  const hold = explicitHold ?? Math.max(0, total - available);

  if (available + hold <= 1e-10 && total <= 1e-10) return null;

  return {
    accountId:
      stringOrNull(row.uuid) ??
      stringOrNull(row.id) ??
      stringOrNull(row.account_uuid),
    currency: currency.toUpperCase(),
    available,
    hold,
    total: Math.max(total, available + hold),
    source: "coinbase",
  };
}

function parseCachedPosition(position: unknown): RawAccount | null {
  const row = position as Record<string, unknown>;
  const asset = stringOrNull(row.asset) ?? stringOrNull(row.assetId);
  if (!asset) return null;

  const cryptoBalance =
    finiteNumber(row.totalBalanceCrypto) ??
    finiteNumber(row.totalBalance) ??
    finiteNumber(row.balance) ??
    0;
  const fiatBalance = finiteNumber(row.totalBalanceFiat);
  const total = asset.toUpperCase() === "EUR" || asset.toUpperCase() === "EURC"
    ? (fiatBalance ?? cryptoBalance)
    : cryptoBalance;

  if (total <= 1e-10) return null;

  return {
    accountId: null,
    currency: asset.toUpperCase(),
    available: total,
    hold: 0,
    total,
    source: "cache",
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  deps: Pick<RealtimePortfolioMarketEngineDeps, "setTimeout" | "clearTimeout" | "logger">,
): Promise<T> {
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimer(() => {
      reject(new Error(`${label} timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        clearTimer(timer);
        reject(error);
      },
    );
  });
}

export function calculateLiveTotalAssetValue(snapshot: Pick<
  RealtimePortfolioSnapshot,
  "cryptoValueEur" | "eurBalance" | "eurcValueEur"
>): number {
  return snapshot.cryptoValueEur + snapshot.eurBalance + snapshot.eurcValueEur;
}

export class RealtimePortfolioMarketEngine {
  private readonly now: () => number;
  private readonly logger: Pick<Console, "log" | "warn" | "error">;
  private portfolioUuid: string | null = null;
  private interval: Timer | null = null;
  private socketWatchdog: Timer | null = null;
  private refreshInProgress: Promise<RealtimePortfolioSnapshot | null> | null = null;
  private lastSnapshot: RealtimePortfolioSnapshot | null = null;
  private lastValidSnapshot: RealtimePortfolioSnapshot | null = null;
  private skippedTicks = 0;
  private livePrices = new Map<string, LivePriceEntry>();
  private subscribedProducts = new Set<string>();
  private ws: RealtimeWebSocket | null = null;
  private wsState: RealtimePortfolioSnapshot["socket"]["state"] = "idle";
  private wsLastMessageAt: number | null = null;
  private reconnectTimer: Timer | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly deps: RealtimePortfolioMarketEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? console;
  }

  start(portfolioUuid: string): void {
    if (this.portfolioUuid !== portfolioUuid) {
      this.portfolioUuid = portfolioUuid;
    }
    if (!this.interval) {
      const setTimer = this.deps.setInterval ?? setInterval;
      this.interval = setTimer(() => {
        void this.refreshNow("interval");
      }, BALANCE_REFRESH_MS);
      this.startSocketWatchdog();
    }
    void this.refreshNow("startup");
  }

  stop(): void {
    const clearTimer = this.deps.clearInterval ?? clearInterval;
    const clearTimeoutFn = this.deps.clearTimeout ?? clearTimeout;
    if (this.interval) clearTimer(this.interval);
    if (this.socketWatchdog) clearTimer(this.socketWatchdog);
    if (this.reconnectTimer) clearTimeoutFn(this.reconnectTimer);
    this.interval = null;
    this.socketWatchdog = null;
    this.reconnectTimer = null;
    this.closeSocket();
  }

  getCurrentSnapshot(): RealtimePortfolioSnapshot | null {
    return this.lastSnapshot;
  }

  async getSnapshot(portfolioUuid: string): Promise<RealtimePortfolioSnapshot | null> {
    this.start(portfolioUuid);
    if (!this.lastSnapshot) return await this.refreshNow("request");
    return this.lastSnapshot;
  }

  async refreshNow(reason = "manual"): Promise<RealtimePortfolioSnapshot | null> {
    if (!this.portfolioUuid) return this.lastSnapshot;
    if (this.refreshInProgress) {
      this.skippedTicks += 1;
      this.logger.log(`[RealtimePortfolioMarketEngine] skip reason=${reason} skippedTicks=${this.skippedTicks}`);
      return this.lastSnapshot ?? this.lastValidSnapshot;
    }

    this.refreshInProgress = this.refresh(reason).finally(() => {
      this.refreshInProgress = null;
    });
    return this.refreshInProgress;
  }

  private async refresh(reason: string): Promise<RealtimePortfolioSnapshot | null> {
    const requestedAt = this.now();
    let balances: RealtimeBalance[] = [];
    let balancesFromFallback = false;
    const warnings: string[] = [];

    try {
      const rawAccounts = await this.fetchBalances(this.portfolioUuid!);
      balances = rawAccounts.map((a) => ({
        accountId: a.accountId,
        assetId: a.currency,
        available: a.available,
        hold: a.hold,
        total: a.total,
        source: a.source,
      }));
      balancesFromFallback = rawAccounts.some((a) => a.source === "cache");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Balances unavailable: ${message}`);
      if (this.lastValidSnapshot) {
        balances = this.lastValidSnapshot.balances.map((b) => ({ ...b, source: "cache" as const }));
        balancesFromFallback = true;
      } else {
        this.logger.warn(`[RealtimePortfolioMarketEngine] no balances reason=${message}`);
        return null;
      }
    }

    const cryptoBalances = balances.filter((b) => b.assetId !== "EUR" && b.assetId !== "EURC" && b.total > 1e-10);
    this.ensureSocketSubscriptions(cryptoBalances.map((b) => b.assetId));

    const pricePairs = await Promise.all(
      cryptoBalances.map(async (balance) => [balance.assetId, await this.resolvePrice(balance.assetId)] as const),
    );
    const prices: Record<string, RealtimePrice> = {};
    for (const [assetId, price] of pricePairs) {
      prices[assetId] = price;
      if (price.priceEur === null && price.source !== "none") warnings.push(`${assetId}: price unavailable via ${price.source}`);
    }

    const positions: RealtimePosition[] = cryptoBalances.map((balance) => {
      const price = prices[balance.assetId];
      const value = price?.priceEur != null ? balance.total * price.priceEur : null;
      return {
        assetId: balance.assetId,
        quantity: balance.total,
        availableBalance: balance.available,
        holdBalance: balance.hold,
        priceEur: price?.priceEur ?? null,
        valueEur: value,
        currentPriceEur: price?.priceEur ?? null,
        currentValueEur: value,
        priceSource: price?.source ?? "none",
        priceStatus: price?.state ?? "unavailable",
      };
    });

    const eurBalance = balances.find((b) => b.assetId === "EUR")?.total ?? 0;
    const eurcBalance = balances.find((b) => b.assetId === "EURC")?.total ?? 0;
    const eurcValueEur = eurcBalance;
    const cryptoValueEur = positions.reduce((sum, p) => sum + (p.valueEur ?? 0), 0);
    const missingPrices = positions.filter((p) => p.priceEur === null && p.quantity > 1e-10).map((p) => p.assetId);
    const balanceVersion = stableVersion(balances.map((b) => `${b.assetId}:${b.available.toFixed(12)}:${b.hold.toFixed(12)}`));
    const priceVersion = stableVersion(Object.values(prices).map((p) => `${p.assetId}:${p.priceEur ?? "null"}:${p.quotedAt}:${p.state}`));
    const receivedAt = this.now();
    const marketTimestamp = Math.max(0, ...Object.values(prices).map((p) => p.quotedAt));
    const snapshotVersion = `${balanceVersion}::${priceVersion}`;
    const priceStates = Object.values(prices).map((p) => p.state);
    const stale = priceStates.includes("stale") || (marketTimestamp > 0 && receivedAt - marketTimestamp > LAST_PRICE_TTL_MS);
    const usingFallback = balancesFromFallback || priceStates.some((s) => s === "fallback" || s === "stale");

    const snapshot: RealtimePortfolioSnapshot = {
      requestedAt,
      receivedAt,
      marketTimestamp,
      snapshotVersion,
      balanceVersion,
      priceVersion,
      balances,
      prices,
      positions,
      cryptoValueEur,
      eurBalance,
      eurcBalance,
      eurcValueEur,
      totalAssetValueEur: calculateLiveTotalAssetValue({ cryptoValueEur, eurBalance, eurcValueEur }),
      complete: missingPrices.length === 0,
      stale,
      usingFallback,
      missingPrices,
      warnings,
      skippedTicks: this.skippedTicks,
      socket: this.socketState(),
      accounts: balances.map((b) => ({
        assetId: b.assetId,
        availableBalance: b.available,
        holdBalance: b.hold,
        totalBalance: b.total,
      })),
      isComplete: missingPrices.length === 0,
      timestamp: receivedAt,
      fiat: "EUR",
      portfolioVersion: balanceVersion,
    };

    this.lastSnapshot = snapshot;
    if (!snapshot.stale || snapshot.complete) this.lastValidSnapshot = snapshot;
    this.deps.publish?.(snapshot);

    const durationMs = receivedAt - requestedAt;
    this.logger.log(
      `[RealtimePortfolioMarketEngine] completed reason=${reason} durationMs=${durationMs} balanceVersion=${balanceVersion.slice(0, 60)} priceVersion=${priceVersion.slice(0, 60)} totalAssetValueEur=${snapshot.totalAssetValueEur?.toFixed(2) ?? "null"} source=${usingFallback ? "fallback" : "live"} socket=${snapshot.socket.state}`,
    );
    return snapshot;
  }

  private async fetchBalances(portfolioUuid: string): Promise<RawAccount[]> {
    const client = this.deps.getCoinbaseClient();
    if (client) {
      try {
        const response = await withTimeout(client.getAccounts(), BALANCE_TIMEOUT_MS, "Coinbase accounts", this.deps);
        const live = (response.accounts ?? []).map(parseCoinbaseAccount).filter((a): a is RawAccount => a !== null);
        if (live.length > 0) return live;
      } catch (error) {
        this.logger.warn("[RealtimePortfolioMarketEngine] Coinbase accounts failed:", error instanceof Error ? error.message : String(error));
      }
    }

    const cached = await this.deps.getCachedPortfolioBreakdown(portfolioUuid);
    const cachedPositions = (cached?.positions ?? []).map(parseCachedPosition).filter((a): a is RawAccount => a !== null);
    if (cachedPositions.length > 0) return cachedPositions;
    throw new Error(client ? "Coinbase accounts and cache unavailable" : "Coinbase credentials unavailable");
  }

  private async resolvePrice(assetId: string): Promise<RealtimePrice> {
    const live = this.livePrices.get(assetId.toUpperCase());
    const now = this.now();
    if (live && now - live.quotedAt <= LIVE_PRICE_TTL_MS && live.priceEur !== null) {
      return { ...live, state: "live" };
    }

    try {
      const rest = await withTimeout(this.deps.getRestPrice(assetId), REST_PRICE_TIMEOUT_MS, `REST price ${assetId}`, this.deps);
      const price = finiteNumber(rest.price);
      if (price !== null) {
        const entry: RealtimePrice = {
          assetId: assetId.toUpperCase(),
          productId: productIdFor(assetId, "EUR"),
          priceEur: price,
          originalPrice: price,
          originalCurrency: "EUR",
          fxRate: null,
          fxSource: null,
          source: rest.provider ?? "rest",
          quotedAt: finiteNumber(rest.fetchedAt) ?? now,
          state: rest.state === "cached" ? "fallback" : "polling",
        };
        this.livePrices.set(assetId.toUpperCase(), { ...entry, productId: entry.productId! });
        return entry;
      }
    } catch (error) {
      this.logger.warn(`[RealtimePortfolioMarketEngine] REST price failed asset=${assetId}:`, error instanceof Error ? error.message : String(error));
    }

    if (live && live.priceEur !== null && now - live.quotedAt <= LAST_PRICE_TTL_MS) {
      return { ...live, state: "stale", source: live.source || "last-valid" };
    }

    return {
      assetId: assetId.toUpperCase(),
      productId: productIdFor(assetId, "EUR"),
      priceEur: null,
      originalPrice: null,
      originalCurrency: null,
      fxRate: null,
      fxSource: null,
      source: "none",
      quotedAt: now,
      state: "unavailable",
    };
  }

  private ensureSocketSubscriptions(assetIds: string[]): void {
    const products = new Set(assetIds.map((id) => productIdFor(id, "EUR")));
    const changed =
      products.size !== this.subscribedProducts.size ||
      [...products].some((product) => !this.subscribedProducts.has(product));
    if (!changed && this.ws) return;
    this.subscribedProducts = products;
    if (products.size === 0) return;
    if (!this.ws) this.connectSocket();
    else this.subscribeSocket();
  }

  private connectSocket(): void {
    const create = this.deps.createWebSocket;
    if (!create || this.subscribedProducts.size === 0) {
      this.wsState = create ? "idle" : "unavailable";
      return;
    }

    this.closeSocket();
    this.wsState = "connecting";
    try {
      const ws = create(COINBASE_WS_URL);
      this.ws = ws;
      ws.onopen = () => {
        this.wsState = "live";
        this.reconnectAttempt = 0;
        this.subscribeSocket();
      };
      ws.onmessage = (event) => this.handleSocketMessage(event.data);
      ws.onerror = (event) => {
        this.logger.warn("[RealtimePortfolioMarketEngine] websocket error", event);
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.subscribedProducts.size > 0) this.scheduleReconnect();
      };
    } catch (error) {
      this.logger.warn("[RealtimePortfolioMarketEngine] websocket unavailable:", error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    }
  }

  private subscribeSocket(): void {
    if (!this.ws || this.subscribedProducts.size === 0) return;
    const productIds = [...this.subscribedProducts];
    const messages = [
      { type: "subscribe", product_ids: productIds, channel: "ticker" },
      { type: "subscribe", product_ids: productIds, channels: ["ticker", "heartbeats"] },
    ];
    for (const msg of messages) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (error) {
        this.logger.warn("[RealtimePortfolioMarketEngine] websocket subscribe failed:", error instanceof Error ? error.message : String(error));
        this.scheduleReconnect();
        break;
      }
    }
  }

  private handleSocketMessage(data: unknown): void {
    this.wsLastMessageAt = this.now();
    this.wsState = "live";
    let payload: unknown;
    try {
      payload = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return;
    }

    for (const tick of this.extractTickerMessages(payload)) {
      const productId = tick.productId.toUpperCase();
      const [assetId, quote] = productId.split("-");
      if (!assetId || quote !== "EUR") continue;
      const price = finiteNumber(tick.price);
      if (price === null || price <= 0) continue;
      const quotedAt = tick.quotedAt ?? this.wsLastMessageAt ?? this.now();
      this.livePrices.set(assetId, {
        assetId,
        productId,
        priceEur: price,
        originalPrice: price,
        originalCurrency: "EUR",
        fxRate: null,
        fxSource: null,
        source: "coinbase-ws",
        quotedAt,
        state: "live",
      });
    }
  }

  private extractTickerMessages(payload: unknown): Array<{ productId: string; price: unknown; quotedAt: number | null }> {
    const row = payload as Record<string, unknown>;
    const directProduct = stringOrNull(row.product_id);
    if (directProduct && row.price != null) {
      return [{
        productId: directProduct,
        price: row.price,
        quotedAt: typeof row.time === "string" ? Date.parse(row.time) : finiteNumber(row.time),
      }];
    }

    const events = Array.isArray(row.events) ? row.events : [];
    const ticks: Array<{ productId: string; price: unknown; quotedAt: number | null }> = [];
    for (const event of events) {
      const eventRow = event as Record<string, unknown>;
      const tickers = Array.isArray(eventRow.tickers) ? eventRow.tickers : [];
      for (const ticker of tickers) {
        const tickerRow = ticker as Record<string, unknown>;
        const productId = stringOrNull(tickerRow.product_id);
        if (!productId) continue;
        ticks.push({
          productId,
          price: tickerRow.price,
          quotedAt: typeof tickerRow.time === "string" ? Date.parse(tickerRow.time) : finiteNumber(tickerRow.time),
        });
      }
    }
    return ticks;
  }

  private startSocketWatchdog(): void {
    if (this.socketWatchdog) return;
    const setTimer = this.deps.setInterval ?? setInterval;
    this.socketWatchdog = setTimer(() => {
      if (!this.ws || this.wsState === "unavailable") return;
      if (this.wsLastMessageAt && this.now() - this.wsLastMessageAt > SOCKET_STALE_MS) {
        this.wsState = "stale";
        this.scheduleReconnect();
      }
    }, 5_000);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.subscribedProducts.size === 0) return;
    const setTimer = this.deps.setTimeout ?? setTimeout;
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)];
    const jitter = Math.floor(delay * 0.2 * Math.random());
    this.reconnectAttempt += 1;
    this.wsState = "reconnecting";
    this.reconnectTimer = setTimer(() => {
      this.reconnectTimer = null;
      this.connectSocket();
      void this.refreshNow("websocket-reconnect");
    }, delay + jitter);
  }

  private closeSocket(): void {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      // ignore close errors
    }
  }

  private socketState(): RealtimePortfolioSnapshot["socket"] {
    return {
      connected: this.wsState === "live" && !!this.ws,
      state: this.wsState,
      lastMessageAt: this.wsLastMessageAt,
      subscribedProducts: [...this.subscribedProducts].sort(),
    };
  }
}
