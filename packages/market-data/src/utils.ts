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
      throw new DOMException("AbortError", "AbortError");
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
        let abortHandler: (() => void) | undefined;
        
        const timer = setTimeout(() => {
          if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
          resolve();
        }, delayMs);

        if (signal) {
          abortHandler = () => {
            clearTimeout(timer);
            reject(new DOMException("AbortError", "AbortError"));
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      });
    }
  }

  throw new DOMException("Max retries exceeded", "AbortError"); // Should never happen due to the throw inside the loop
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  // If it's purely digits, it's seconds
  if (/^\d+$/.test(header)) {
    return parseInt(header, 10) * 1000;
  }
  // Otherwise, it might be an HTTP date
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return undefined;
}
