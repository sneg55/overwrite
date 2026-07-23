#!/usr/bin/env bash
# The three-process epoch engine: scheduler, oracle and market maker, each its own
# process and its own party. Lifted out of sandbox.sh, which was at the file-size
# limit, and grouped here because starting and stopping them is one responsibility.
#
# Depends on sandbox.sh for STATE_DIR, ROOT and find_bun, so it is sourced after those
# are defined rather than being runnable on its own.

# Start scheduler + oracle + mm as three independent processes against the seed.
cmd_engine() {
  if [ ! -f "$STATE_DIR/demo.env" ]; then echo "no demo.env; run '$0 seed-vault' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  set -a; . "$STATE_DIR/demo.env"; set +a
  # Same channel the server reads. See cmd_serve: both sides are pinned here rather than
  # relying on a relative default that only resolves from backend/.
  export ENGINE_CONTROL_DIR="$STATE_DIR"
  : > "$STATE_DIR/engine.pids"
  for proc in scheduler oracle mm; do
    ( cd "$ROOT/backend" && exec "$bun" run "src/entrypoints/$proc.ts" ) \
      >"$STATE_DIR/$proc.log" 2>&1 &
    echo $! >>"$STATE_DIR/engine.pids"
    echo "  started $proc (pid $!, log $STATE_DIR/$proc.log)"
  done
  echo "engine up: scheduler + oracle + mm. Stop with '$0 engine-stop'."
}

cmd_engine_stop() {
  if [ ! -f "$STATE_DIR/engine.pids" ]; then echo "no engine.pids"; return 0; fi
  while read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done < "$STATE_DIR/engine.pids"
  rm -f "$STATE_DIR/engine.pids"
  echo "engine stopped."
}

# Start just the scheduler for the interactive demo, run alongside `serve` and `web`. This
# is what makes the operator control room a live surface (State, Next action, ticks,
# Pause/Resume/Step) instead of the stale status file a prior run left behind. On the
# seeded demo the scheduler sits at AwaitExpiry (the option is active, seven days out), so
# it dispatches nothing and only refreshes its status; oracle and mm are not needed until
# settlement, which the demo never reaches. Runs in the foreground like serve/web: start it
# backgrounded and stop it by killing that process.
cmd_scheduler() {
  if [ ! -f "$STATE_DIR/demo.env" ]; then echo "no demo.env; run '$0 seed' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  set -a; . "$STATE_DIR/demo.env"; set +a
  # Same control channel the server reads. See cmd_serve: pinned here rather than relying
  # on a relative default that only resolves from backend/.
  export ENGINE_CONTROL_DIR="$STATE_DIR"
  echo "starting scheduler (demo control room, control=$STATE_DIR)..."
  ( cd "$ROOT/backend" && exec "$bun" run src/entrypoints/scheduler.ts )
}
