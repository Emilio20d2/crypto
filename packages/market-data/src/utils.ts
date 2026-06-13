import { MarketError, MarketRateLimitError } from "./errors";

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  signal?: AbortSignal
): Promise<T> {
  let attempt = 0;

  while (attempt < maxRetries) {
    if (signal?.aborted) {
      throw new Error("AbortError");
    }

    try {
      return await operation();
    } catch (error) {
      attempt++;

      // If it's a non-recoverable error, throw immediately
      if (error instanceof MarketError && !error.recoverable) {
        throw error;
      }

      // If we reached max retries, throw the last error
      if (attempt >= maxRetries) {
        throw error;
      }

      let delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      // If it's a rate limit error and provides a retryAfterMs, use that
      if (error instanceof MarketRateLimitError && error.retryAfterMs) {
        delayMs = Math.max(delayMs, error.retryAfterMs);
      }

      // Wait before retrying
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("AbortError"));
          });
        }
      });
    }
  }

  throw new Error("Max retries exceeded"); // Should never happen due to the throw inside the loop
}
