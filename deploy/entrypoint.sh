#!/usr/bin/env bash
# deploy/entrypoint.sh - container entrypoint for the shared, writable demo.
#
# Boots the full stack, keeps it alive, and wipes it on a round-clock cadence.
#
# The wipe is deliberately an EXIT rather than an in-place restart: the ledger is an
# in-memory Canton sandbox, so a fresh process tree is the cleanest possible reset and
# it also drops whatever the JVM was holding. compose runs this with
# `restart: unless-stopped`, which restarts a container that exits 0, so leaving is how
# the reset happens. Do not "fix" this into a supervisor loop that reseeds in place:
# that keeps a JVM alive across every cycle for no benefit.
#
# Everything here drives scripts/sandbox.sh rather than reimplementing it. That script
# already knows the boot ordering that works (synchronizer up, THEN package vetting,
# THEN seed), and a second copy of that sequence would drift from it silently.

set -euo pipefail

cd /app

INTERVAL_MIN="${OVERWRITE_RESET_INTERVAL_MINUTES:-360}"
INTERVAL_SEC=$((INTERVAL_MIN * 60))
BACKEND_PORT="${BACKEND_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
RESUME_AFTER="${OVERWRITE_AUTO_RESUME_SECONDS:-600}"
STATE_DIR=/app/.sandbox
# The seed writes SESSIONS=demo-<name>=<party>, so this is the operator's bearer.
OP_TOKEN=demo-operator

if ((INTERVAL_SEC < 900)); then
  echo "entrypoint: OVERWRITE_RESET_INTERVAL_MINUTES=$INTERVAL_MIN is below the 15 min floor" >&2
  echo "entrypoint: a boot cycle costs more than a minute, so anything shorter is mostly downtime" >&2
  exit 1
fi

serve_pid=""
web_pid=""
watchdog_pid=""

log() { echo "entrypoint: $*"; }

stop_all() {
  log "stopping the stack"
  [ -n "$watchdog_pid" ] && kill "$watchdog_pid" 2>/dev/null || true
  [ -n "$web_pid" ] && kill "$web_pid" 2>/dev/null || true
  # next start runs as a child of the bun wrapper, so the wrapper's pid does not always
  # take it with it. Best effort by name; the container exit is the real backstop.
  pkill -f 'next start' 2>/dev/null || true
  [ -n "$serve_pid" ] && kill "$serve_pid" 2>/dev/null || true
  ./scripts/sandbox.sh engine-stop 2>/dev/null || true
  ./scripts/sandbox.sh stop 2>/dev/null || true
}

trap 'stop_all; exit 0' SIGTERM SIGINT

# Poll a URL until it answers or the budget runs out. Returns 1 on timeout so the caller
# can fail the boot loudly instead of handing a half-up stack to visitors.
wait_http() {
  local url="$1" label="$2" tries="${3:-60}"
  echo -n "entrypoint: waiting for $label "
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null -H "Authorization: Bearer $OP_TOKEN" "$url" 2>/dev/null; then
      echo " up."
      return 0
    fi
    echo -n "."
    sleep 2
  done
  echo " TIMED OUT."
  return 1
}

boot() {
  # A container start is always a fresh ledger, so a stale control file or pid from a
  # committed layer must not be believed. sandbox.sh recreates what it needs.
  rm -rf "$STATE_DIR"
  mkdir -p "$STATE_DIR"

  log "starting Canton sandbox"
  # Raises the JSON API's 200-element list cap. Without this the engine wedges about ten
  # minutes in: every ACS read 413s and the scheduler ticks forever without dispatching.
  export CANTON_CONFIG=/app/deploy/canton-demo.conf
  ./scripts/sandbox.sh start

  # Synchronizer-connected is not the same as package-vetted: a create referencing
  # #overwrite-vault 404s in the gap between them.
  ./scripts/sandbox.sh wait-vetted

  # SEED_FUND_WALLETS: this demo is writable, so every depositor needs a spendable
  # wallet balance. Without it the deposit form has nothing to select and the one
  # interactive thing a visitor can do is dead on arrival.
  log "seeding vault + funded depositor wallets"
  SEED_FUND_WALLETS=1 ./scripts/sandbox.sh seed-vault

  # The seed writes a demo clock tuned for a run that lasts minutes, and every process
  # sources that file with `set -a`, so container env alone cannot override it. Patch the
  # file the seed just wrote.
  #
  # The oracle creates a PriceObservation per poll and never archives one, so a 3s poll
  # mints 20 contracts a minute: 7200 over a six hour window, every one of them re-read on
  # every 2s scheduler tick across ten template queries. Slowing the poll cuts that by the
  # same factor it slows the price ticker, which at 15s is still live to a visitor.
  if [ -n "${OVERWRITE_ORACLE_POLL_MS:-}" ]; then
    sed -i "s/^ORACLE_POLL_MS=.*/ORACLE_POLL_MS=${OVERWRITE_ORACLE_POLL_MS}/" "$STATE_DIR/demo.env"
    log "oracle poll set to ${OVERWRITE_ORACLE_POLL_MS}ms for the hosted run"
  fi

  log "starting engine (scheduler + oracle + mm)"
  ./scripts/sandbox.sh engine

  log "starting REST backend on :$BACKEND_PORT"
  PORT="$BACKEND_PORT" ./scripts/sandbox.sh serve &
  serve_pid=$!
  wait_http "http://127.0.0.1:$BACKEND_PORT/engine" "backend" || return 1

  log "starting Next.js on :$WEB_PORT"
  (
    cd /app/web
    OVERWRITE_API_URL="http://127.0.0.1:$BACKEND_PORT" \
      OVERWRITE_DEMO_DEFAULT_PARTY=operator \
      OVERWRITE_RESET_INTERVAL_MINUTES="$INTERVAL_MIN" \
      PORT="$WEB_PORT" exec bun run start
  ) &
  web_pid=$!
  wait_http "http://127.0.0.1:$WEB_PORT/" "web" || return 1

  log "stack up"
}

# A visitor who pauses the engine from the operator control room leaves the vault
# looking dead for everyone after them, and the pause outlives their tab. Resume it once
# it has been paused longer than a person plausibly means to hold it.
#
# The resume goes through the REST route rather than writing engine-intent.json here.
# That file has exactly one writer by design (the server), and adding a second one from
# a shell would recreate the read-modify-write race the split was built to remove.
watchdog() {
  local paused_for=0 status paused
  while sleep 30; do
    status="$(curl -fsS -H "Authorization: Bearer $OP_TOKEN" \
      "http://127.0.0.1:$BACKEND_PORT/engine" 2>/dev/null)" || continue
    paused="$(printf '%s' "$status" | jq -r '.paused // false')"
    if [ "$paused" = "true" ]; then
      paused_for=$((paused_for + 30))
      if ((paused_for >= RESUME_AFTER)); then
        log "engine paused for ${paused_for}s, resuming (demo watchdog)"
        curl -fsS -X POST -o /dev/null -H "Authorization: Bearer $OP_TOKEN" \
          "http://127.0.0.1:$BACKEND_PORT/engine/resume" 2>/dev/null || true
        paused_for=0
      fi
    else
      paused_for=0
    fi
  done
}

if ! boot; then
  log "BOOT FAILED, dumping the last of each log"
  tail -30 "$STATE_DIR/canton.log" 2>/dev/null || true
  tail -20 "$STATE_DIR"/*.log 2>/dev/null || true
  stop_all
  exit 1
fi

watchdog &
watchdog_pid=$!
log "auto-resume watchdog active (${RESUME_AFTER}s of pause)"

now=$(date +%s)
next=$(((now / INTERVAL_SEC + 1) * INTERVAL_SEC))
# Landing just before a boundary would wipe a demo that is seconds old. Take the one
# after it instead.
if ((next - now < 600)); then next=$((next + INTERVAL_SEC)); fi
wait_sec=$((next - now))
log "next wipe in ${wait_sec}s ($(date -u -d "@$next" +'%Y-%m-%dT%H:%M:%SZ')), every ${INTERVAL_MIN} min"

# Backgrounded and waited on, NOT a plain `sleep`. Bash runs a trap only between
# commands, so a foreground sleep defers SIGTERM until it returns: with a 6 hour
# interval that made the handler above dead code, and `docker stop` fell through to
# SIGKILL after the grace period with Canton still running. `wait` is interruptible, so
# the signal lands while we are parked here. Verified 2026-08-03 by signalling pid 1 and
# watching the container come back with a stop line in the log; before this change the
# same signal did nothing at all.
sleep "$wait_sec" &
sleep_pid=$!
wait "$sleep_pid" || true

log "wipe boundary reached, exiting for a clean restart"
stop_all
exit 0
