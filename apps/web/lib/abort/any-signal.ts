/**
 * `AbortSignal.any`, with a fallback for the browsers that lack it (Safari before 17.4, so the
 * iOS 16 iPads common in pits, and Chrome before 116). There the native call threw a TypeError
 * inside each page's `try`, and the page said "Couldn't reach Vantage" with the network fine.
 */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === "function") return native.call(AbortSignal, [...signals]);
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    controller.abort(signal.reason);
    for (const other of signals) other.removeEventListener("abort", onAbort);
  };
  function onAbort(this: AbortSignal) {
    abort(this);
  }
  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}
