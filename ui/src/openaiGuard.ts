/**
 * Frontend mirror of the backend OpenAI guard.
 *
 * Provides single-flight dedup, opt-in debounce, and a panic breaker that
 * trips if a buggy hook starts hammering an API endpoint. Limits are tight
 * by design — for a demo, normal user flow generates only a handful of
 * heavyweight calls, so a runaway will be caught within ~1s.
 */

const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 12;

const inflight = new Map<string, Promise<unknown>>();
const recent: number[] = [];
let tripped = false;

export class OpenAIGuardTrippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIGuardTrippedError";
  }
}

/**
 * Coalesce concurrent calls with the same key into a single in-flight promise.
 * Followers wait for the same result and share success/failure with the leader.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/**
 * Trailing-edge debounce. Each call resolves with the result of the eventual
 * invocation. Earlier pending calls share that same result.
 */
export function debounce<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  ms: number,
): (...args: A) => Promise<R> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiters: Array<{ resolve: (v: R) => void; reject: (e: unknown) => void }> = [];
  let lastArgs: A | null = null;
  return (...args: A) =>
    new Promise<R>((resolve, reject) => {
      if (timer) clearTimeout(timer);
      lastArgs = args;
      waiters.push({ resolve, reject });
      timer = setTimeout(() => {
        const batch = waiters;
        const a = lastArgs as A;
        waiters = [];
        lastArgs = null;
        timer = null;
        fn(...a).then(
          (v) => batch.forEach((w) => w.resolve(v)),
          (e) => batch.forEach((w) => w.reject(e)),
        );
      }, ms);
    });
}

/**
 * Record a call site invocation. Throws if the panic threshold is exceeded.
 * Mirrors the backend breaker so symptoms are caught before crossing the network.
 */
export function recordCall(label: string): void {
  if (tripped) {
    throw new OpenAIGuardTrippedError(
      `Frontend OpenAI breaker tripped — refresh page to reset (last call: ${label})`,
    );
  }
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  recent.push(now);
  if (recent.length > MAX_IN_WINDOW) {
    tripped = true;
    console.error(
      `[openaiGuard] BREAKER TRIPPED: ${recent.length} calls in ${WINDOW_MS}ms @ ${label}`,
    );
    throw new OpenAIGuardTrippedError(
      `Frontend OpenAI breaker tripped — refresh page to reset (call: ${label})`,
    );
  }
  if (recent.length > MAX_IN_WINDOW / 2) {
    console.warn(
      `[openaiGuard] ${recent.length} calls in last ${WINDOW_MS}ms @ ${label}`,
    );
  }
}

/** For tests / manual recovery without a page refresh. */
export function resetClientBreaker(): void {
  tripped = false;
  recent.length = 0;
  inflight.clear();
}

export function clientGuardStatus(): {
  tripped: boolean;
  recentCount: number;
  inflightCount: number;
} {
  return {
    tripped,
    recentCount: recent.length,
    inflightCount: inflight.size,
  };
}
