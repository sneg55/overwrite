// A cancellable sleep for the process loops. Resolves (never rejects) so a loop can
// `await delay(...)` between ticks and fall straight through to its `while` guard the
// instant an AbortSignal fires. Cleans up its timer and listener on either path.

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
