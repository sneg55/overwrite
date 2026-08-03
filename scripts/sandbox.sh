#!/usr/bin/env bash
# scripts/sandbox.sh - repeatable local Canton sandbox for development.
#
# A local sandbox makes you the participant admin, so DAR upload and party
# allocation just work (unlike the HackCanton devnet, where the SSO login is a
# non-admin single-party user and DAR upload is a manual noders-admin step). Use
# this for the full product/backend/web loop; use devnet only for the CBTC
# registry proof (spike 0.1) and the final DAR deploy.
#
# Subcommands: start | stop | status | logs
#
#   ./scripts/sandbox.sh start     # build DAR (if stale) + launch Canton + JSON API
#   ./scripts/sandbox.sh status    # pid + JSON API /v2/version
#   ./scripts/sandbox.sh logs      # tail the sandbox log
#   ./scripts/sandbox.sh stop      # kill it
#
# Endpoints once up: gRPC ledger 6865, JSON Ledger API http://localhost:7575
# (no auth: tokens are omitted, the backend supplies a user-id instead).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/daml-env.sh
. "$SCRIPT_DIR/lib/daml-env.sh"

DAML_DIR="$ROOT/daml"
# Both name and version are resolved from daml.yaml rather than hardcoded: a pinned
# filename here silently rebuilds the new DAR while uploading nothing. The version bumps
# whenever a template changes, and the name is not fixed either. Canton keys a smart
# contract upgrade lineage on the package NAME, so an incompatible template redesign has
# to start a new lineage under a new name (see docs/adr and daml/README.md).
DAR_NAME="$(awk '/^name:/ {print $2; exit}' "$DAML_DIR/daml.yaml")"
DAR_VERSION="$(awk '/^version:/ {print $2; exit}' "$DAML_DIR/daml.yaml")"
DAR="$DAML_DIR/.daml/dist/${DAR_NAME}-${DAR_VERSION}.dar"
STATE_DIR="$ROOT/.sandbox"
PID_FILE="$STATE_DIR/canton.pid"
LOG_FILE="$STATE_DIR/canton.log"
# shellcheck source=lib/ports.sh
. "$SCRIPT_DIR/lib/ports.sh"
mkdir -p "$STATE_DIR"

is_running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

json_up() {
  curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$JSON_PORT/v2/version" 2>/dev/null \
    | grep -q '^200$'
}

# JSON API up != able to allocate parties. The sandbox must be connected to its
# synchronizer first (else party allocation 400s with WITHOUT_CONNECTED_SYNCHRONIZER).
ready() {
  json_up || return 1
  curl -sS "http://localhost:$JSON_PORT/v2/state/connected-synchronizers" 2>/dev/null \
    | grep -q 'synchronizerId'
}

build_dar() {
  if [ -f "$DAR" ] && [ -z "$(find "$DAML_DIR/src" -name '*.daml' -newer "$DAR" 2>/dev/null)" ]; then
    echo "DAR up to date: $DAR"
    return 0
  fi
  echo "building DAR (src changed or missing)..."
  ( cd "$DAML_DIR" && daml build )
}

cmd_start() {
  if is_running && json_up; then
    echo "sandbox already running (pid $(cat "$PID_FILE")), JSON API on :$JSON_PORT"
    return 0
  fi
  if lsof -ti "tcp:$GRPC_PORT" >/dev/null 2>&1 || lsof -ti "tcp:$JSON_PORT" >/dev/null 2>&1 \
     || lsof -ti "tcp:$ADMIN_PORT" >/dev/null 2>&1; then
    echo "ERROR: port $GRPC_PORT, $JSON_PORT or $ADMIN_PORT already in use (stale sandbox? run 'stop')" >&2
    return 1
  fi
  build_dar
  echo "launching Canton sandbox + JSON API (log: $LOG_FILE)..."
  # The ledger and admin ports are passed explicitly. They used to be checked for
  # collisions but never handed to the sandbox, so the guard was inspecting ports the
  # script did not control: overriding GRPC_PORT moved the check and not the binding,
  # and Canton took 6865/6866 anyway.
  # CANTON_CONFIG: optional HOCON overrides merged into the sandbox's generated config.
  # Unset for local development, so nothing here changes. The shared demo sets it to
  # raise the JSON API's 200-element list cap, which a long-running ledger crosses and
  # which wedges every ACS read once it does (see deploy/canton-demo.conf).
  local cfg_arg=()
  if [ -n "${CANTON_CONFIG:-}" ]; then
    if [ ! -f "$CANTON_CONFIG" ]; then
      echo "ERROR: CANTON_CONFIG=$CANTON_CONFIG does not exist" >&2
      return 1
    fi
    cfg_arg=(-c "$CANTON_CONFIG")
    echo "  canton config: $CANTON_CONFIG"
  fi
  ( cd "$DAML_DIR" && exec daml sandbox --port "$GRPC_PORT" --admin-api-port "$ADMIN_PORT" \
      --json-api-port "$JSON_PORT" --dar "$DAR" "${cfg_arg[@]}" ) \
    >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo -n "waiting for JSON API + synchronizer on :$JSON_PORT "
  for _ in $(seq 1 120); do
    if ready; then
      echo " ready."
      echo "  gRPC ledger : localhost:$GRPC_PORT"
      echo "  JSON Ledger : http://localhost:$JSON_PORT  (no auth)"
      echo "  DAR uploaded: $(basename "$DAR")"
      echo "Next: allocate parties + drive the lifecycle via the backend ledger-client."
      return 0
    fi
    if ! is_running; then
      echo " FAILED (process died)."; tail -20 "$LOG_FILE" >&2; return 1
    fi
    echo -n "."; sleep 2
  done
  echo " TIMED OUT after 240s."; tail -20 "$LOG_FILE" >&2; return 1
}

cmd_stop() {
  if ! is_running; then echo "not running."; rm -f "$PID_FILE"; return 0; fi
  local pid; pid="$(cat "$PID_FILE")"
  echo "stopping sandbox (pid $pid)..."
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do is_running || break; sleep 1; done
  is_running && kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "stopped."
}

cmd_status() {
  if is_running; then
    echo "process: RUNNING (pid $(cat "$PID_FILE"))"
  else
    echo "process: not running"
  fi
  if json_up; then
    echo "JSON API: UP  $(curl -sS "http://localhost:$JSON_PORT/v2/version" | sed 's/{.*"version":"\([^"]*\)".*/version \1/')"
  else
    echo "JSON API: down"
  fi
}

cmd_logs() { tail -n "${2:-40}" -f "$LOG_FILE"; }

# Resolve bun (not on the non-interactive PATH; lives at ~/.bun/bin per machine notes).
find_bun() { command -v bun || { [ -x "$HOME/.bun/bin/bun" ] && echo "$HOME/.bun/bin/bun"; }; }

# Drive the full OTM+ITM lifecycle against the running local box, forcing the local
# JSON API URL so bun's auto-loaded .env (devnet) does not hijack it.
cmd_demo() {
  if ! json_up; then echo "sandbox not up; run '$0 start' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  ( cd "$ROOT" && LEDGER_API_URL="http://localhost:$JSON_PORT" "$bun" scripts/demo-scenario )
}

# Seed a persistent demo state (Vault + 3 depositor positions) + write .sandbox/demo.*.
cmd_seed() {
  if ! json_up; then echo "sandbox not up; run '$0 start' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  ( cd "$ROOT" && LEDGER_API_URL="http://localhost:$JSON_PORT" "$bun" scripts/seed-demo )
  # A fresh seed is a fresh demo, so reset the engine control channel. Without this a
  # status file from a prior scheduler run (e.g. a `verify`) makes the operator control
  # room show a stale "last tick failed" against state that no longer exists. `scheduler`
  # (or `engine`) rewrites these the instant it starts; this covers a demo run without one.
  rm -f "$STATE_DIR/engine-status.json" "$STATE_DIR/engine-intent.json"
}

# Start the REST backend in local no-auth mode against the seeded box. Sources the
# seed's demo.env so the env boundary sees LOCAL config, not the devnet .env.
cmd_serve() {
  if [ ! -f "$STATE_DIR/demo.env" ]; then echo "no demo.env; run '$0 seed' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  # A caller-supplied PORT wins over demo.env. seed writes PORT into demo.env, and
  # sourcing it would otherwise clobber `PORT=3002 sandbox.sh serve` back to 3001,
  # which is the one thing that override exists to escape (a machine where something
  # else already holds 3001). Capture it before the source, restore it after.
  local port_override="${PORT:-}"
  set -a; . "$STATE_DIR/demo.env"; set +a
  # Export PORT explicitly rather than letting the backend fall back to its own env
  # default: an unset PORT makes the backend bind :3000 and collide with the web dev
  # server, while this script announces :3001 and cmd_web points the UI there.
  export PORT="${port_override:-${PORT:-3001}}"
  # Pin the engine control channel absolutely. The server and the scheduler are separate
  # processes that share pause/step through files in this directory, and env.ts defaults
  # it to a path relative to backend/, which is only correct because of the `cd` below.
  # Setting it here means the two sides agree because the launcher says so, not because
  # both happen to run from the same working directory.
  export ENGINE_CONTROL_DIR="$STATE_DIR"
  echo "starting local backend on :$PORT (party-scoped, no-auth)..."
  ( cd "$ROOT/backend" && exec "$bun" run src/entrypoints/server.ts )
}

# Start the Next.js web against the local backend. Lands cold-load on the operator via
# the demo-only OVERWRITE_DEMO_DEFAULT_PARTY flag; the app itself defaults to `observer`
# (production-safe), so without this flag the vault page reads empty on first load.
# The backend port defaults to demo.env PORT (override with BACKEND_PORT when `serve`
# ran on a non-default port). The web always listens on WEB_PORT (default 3000): sourcing
# demo.env sets PORT, which `next dev` would otherwise inherit, so PORT is set explicitly.
cmd_web() {
  if [ ! -f "$STATE_DIR/demo.env" ]; then echo "no demo.env; run '$0 seed' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  set -a; . "$STATE_DIR/demo.env"; set +a
  local api="http://localhost:${BACKEND_PORT:-${PORT:-3001}}"
  local web_port="${WEB_PORT:-3000}"
  echo "starting web on :$web_port -> backend $api (cold-load party: operator)..."
  # OVERWRITE_PARTY_HINT_SUFFIX is passed through but empty by default: the sandbox
  # allocates the hints the app expects, so there is nothing to strip. It only carries a
  # value against a shared participant (devnet namespaces hints as `alice-overwrite`).
  ( cd "$ROOT/web" && OVERWRITE_API_URL="$api" OVERWRITE_DEMO_DEFAULT_PARTY=operator \
      OVERWRITE_PARTY_HINT_SUFFIX="${OVERWRITE_PARTY_HINT_SUFFIX:-}" PORT="$web_port" exec "$bun" run dev )
}

# Seed a bare vault for the three-process engine (stops before lock).
cmd_seed_vault() {
  if ! json_up; then echo "sandbox not up; run '$0 start' first" >&2; return 1; fi
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  ( cd "$ROOT" && LEDGER_API_URL="http://localhost:$JSON_PORT" "$bun" scripts/seed-vault )
}

# shellcheck source=lib/engine.sh
. "$SCRIPT_DIR/lib/engine.sh"

# The synchronizer can report connected (what ready() gates on) a few seconds before
# the uploaded DAR's packages are vetted for command submission; a create referencing
# #overwrite then 404s with PACKAGE_NAMES_NOT_FOUND. Poll an ACS query by the overwrite
# package name (as a throwaway probe party) until it resolves, so seeding never races
# vetting. A JSON array back means vetted; the error string means keep waiting.
wait_vetted() {
  local url="http://localhost:$JSON_PORT" probe end body resp
  probe="$(curl -sS -X POST "$url/v2/parties" -H 'content-type: application/json' \
    -d '{"partyIdHint":"vetprobe","identityProviderId":""}' 2>/dev/null \
    | sed -n 's/.*"party":"\([^"]*\)".*/\1/p')" || true
  if [ -z "$probe" ]; then echo "wait_vetted: could not allocate probe party" >&2; return 1; fi
  echo -n "waiting for overwrite package to be vetted "
  for _ in $(seq 1 30); do
    end="$(curl -sS -X POST "$url/v2/state/ledger-end" -H 'content-type: application/json' -d '{}' 2>/dev/null \
      | sed -n 's/.*"offset":\([0-9]*\).*/\1/p')" || true
    body="{\"verbose\":true,\"activeAtOffset\":${end:-0},\"filter\":{\"filtersByParty\":{\"$probe\":{\"cumulative\":[{\"identifierFilter\":{\"TemplateFilter\":{\"value\":{\"templateId\":\"#overwrite-vault:Overwrite.Vault:Vault\",\"includeCreatedEventBlob\":true}}}}]}}}}"
    resp="$(curl -sS -X POST "$url/v2/state/active-contracts" -H 'content-type: application/json' -d "$body" 2>/dev/null)" || true
    case "$resp" in
      *PACKAGE_NAMES_NOT_FOUND*) echo -n "."; sleep 1 ;;
      \[*) echo " vetted."; return 0 ;;
      *) echo -n "?"; sleep 1 ;;
    esac
  done
  echo " TIMED OUT (package not vetted after 30s)." >&2; return 1
}

# shellcheck source=lib/verify.sh
. "$SCRIPT_DIR/lib/verify.sh"

case "${1:-}" in
  start)          cmd_start ;;
  stop)           cmd_stop ;;
  status)         cmd_status ;;
  logs)           cmd_logs "$@" ;;
  demo)           cmd_demo ;;
  seed)           cmd_seed ;;
  serve)          cmd_serve ;;
  web)            cmd_web ;;
  scheduler)      cmd_scheduler ;;
  seed-vault)     cmd_seed_vault ;;
  # Exposed for the deploy entrypoint, which boots the same sequence the verify gates
  # do and must not seed into the window where the synchronizer is connected but the
  # overwrite package is not yet vetted. Exported rather than copied: a second copy of
  # the poll would drift from this one.
  wait-vetted)    wait_vetted ;;
  engine)         cmd_engine ;;
  engine-stop)    cmd_engine_stop ;;
  verify)         cmd_verify ;;
  verify-itm)     cmd_verify_itm ;;
  verify-deposit) cmd_verify_deposit ;;
  *) echo "usage: $0 {start|stop|status|logs|demo|seed|serve|web|scheduler|seed-vault|wait-vetted|engine|engine-stop|verify|verify-itm|verify-deposit}" >&2; exit 2 ;;
esac
