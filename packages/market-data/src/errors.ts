export class MarketError extends Error {
  constructor(public code: string, message: string, public recoverable: boolean) {
    super(message);
    this.name = "MarketError";
  }
}

export class MarketTimeoutError extends MarketError {
  constructor(message = "Market API timeout") {
    super("TIMEOUT", message, true);
    this.name = "MarketTimeoutError";
  }
}

export class MarketRateLimitError extends MarketError {
  constructor(public retryAfterMs?: number, message = "Rate limit exceeded") {
    super("RATE_LIMIT", message, true);
    this.name = "MarketRateLimitError";
  }
}

export class MarketNotFoundError extends MarketError {
  constructor(message = "Asset not found") {
    super("NOT_FOUND", message, false);
    this.name = "MarketNotFoundError";
  }
}

export class MarketInvalidResponseError extends MarketError {
  constructor(message = "Invalid response from market API") {
    super("INVALID_RESPONSE", message, true);
    this.name = "MarketInvalidResponseError";
  }
}

export class MarketUnavailableError extends MarketError {
  constructor(message = "Market API unavailable") {
    super("UNAVAILABLE", message, true);
    this.name = "MarketUnavailableError";
  }
}
