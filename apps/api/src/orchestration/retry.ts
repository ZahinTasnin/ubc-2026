export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

/**
 * Bounded retry with exponential backoff and full jitter. Only errors for which `isRetryable`
 * returns true are retried; anything else (and the last retryable error) is rethrown.
 * `fn` receives the attempt number (1-based) so it can re-read state before acting again.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { policy: RetryPolicy; isRetryable: (err: unknown) => boolean } & RetryDeps,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.policy.maxAttempts || !opts.isRetryable(err)) throw err;
      const cap = Math.min(opts.policy.maxDelayMs, opts.policy.baseDelayMs * 2 ** (attempt - 1));
      await opts.sleep(Math.floor(opts.random() * cap));
    }
  }
}
