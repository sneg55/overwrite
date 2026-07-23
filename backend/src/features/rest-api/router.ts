// Pure route matching for the REST surface. Kept separate from the server so the
// method/path -> route mapping is unit-testable without binding a socket.
//
// Read endpoints power the UI (party-scoped, which is what makes the privacy
// reveal real). There is deliberately NO premium-claim endpoint: premium is pushed
// by the scheduler, never pulled.

export type Method = 'GET' | 'POST'

export type RouteName =
  | 'health' // GET  /health
  | 'version' // GET  /version           (proxies JSON Ledger API /v2/version)
  | 'vault' // GET  /vault             (TVL, epoch, timeline)
  | 'option' // GET  /option            (CallOption; operator + mm-buyer only)
  | 'positions' // GET  /positions?party=  (party-scoped; empty for observer)
  | 'reports' // GET  /reports           (aggregate epoch reports)
  | 'receipts' // GET  /receipts?party=   (the caller's own premium receipts)
  | 'currentVault' // GET  /current-vault    (operator-read; public epoch params + cid)
  | 'holdings' // GET  /holdings          (the caller's own CBTC holdings)
  | 'engine' // GET  /engine            (operator-only; scheduler status)
  | 'enginePause' // POST /engine/pause
  | 'engineResume' // POST /engine/resume
  | 'engineStep' // POST /engine/step   (refused unless paused)
  | 'deposit' // POST /deposit
  | 'queueWithdraw' // POST /queue-withdraw
  | 'notFound'

export function matchRoute(method: string, pathname: string): RouteName {
  const path = normalize(pathname)
  if (method === 'GET') {
    switch (path) {
      case '/health':
        return 'health'
      case '/version':
        return 'version'
      case '/vault':
        return 'vault'
      case '/option':
        return 'option'
      case '/positions':
        return 'positions'
      case '/reports':
        return 'reports'
      case '/receipts':
        return 'receipts'
      case '/current-vault':
        return 'currentVault'
      case '/holdings':
        return 'holdings'
      case '/engine':
        return 'engine'
      default:
        return 'notFound'
    }
  }
  if (method === 'POST') {
    switch (path) {
      case '/deposit':
        return 'deposit'
      case '/queue-withdraw':
        return 'queueWithdraw'
      case '/engine/pause':
        return 'enginePause'
      case '/engine/resume':
        return 'engineResume'
      case '/engine/step':
        return 'engineStep'
      default:
        return 'notFound'
    }
  }
  return 'notFound'
}

/** Strip a trailing slash (except root) so /vault and /vault/ match the same route. */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

export function isWrite(route: RouteName): boolean {
  return route === 'deposit' || route === 'queueWithdraw'
}
