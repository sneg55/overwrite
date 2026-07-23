// Labeled demo price schedule, shared by the oracle (what it observes) and the MM
// (how it decides to exercise), so the two independent processes agree on the demo
// price without any ledger coupling. A single constant `base` is always OTM, because
// the strike is base * (1 + strikePct); a `base` -> `late` step lets one epoch settle
// ITM deterministically: the option opens at `base` (strike = base * 1.1) and settles
// after the switch at `late` > strike. Unset means live public spot (the real path).

export interface DemoPriceSchedule {
  base: string
  late?: string
  switchMs?: number
}

// The demo price at `elapsedMs` since the process's schedule anchor (loop start).
// Returns `late` once elapsed reaches `switchMs`, otherwise `base`. The step applies
// only when BOTH `late` and `switchMs` are set; a half-configured step stays on base.
export function demoPriceAt(schedule: DemoPriceSchedule, elapsedMs: number): string {
  if (
    schedule.late !== undefined &&
    schedule.switchMs !== undefined &&
    elapsedMs >= schedule.switchMs
  ) {
    return schedule.late
  }
  return schedule.base
}
