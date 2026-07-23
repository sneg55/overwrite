// Keep Tab focus inside a container, wrapping between its first and last enabled control.
//
// A native modal <dialog> is supposed to do this itself, but Chrome lets one Tab past the
// last control land on <body> before wrapping, so a keyboard user loses the visible focus
// ring for a keystroke inside an open dialog (verified in Chrome). Call this from the
// container's onKeyDown to close that gap.

// Only the fields this needs, so it stays testable without a React synthetic event.
interface TabKeyEvent {
  key: string
  shiftKey: boolean
  preventDefault: () => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function trapTabFocus(container: HTMLElement, e: TabKeyEvent): void {
  if (e.key !== 'Tab') return
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE)
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (first === undefined || last === undefined) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
