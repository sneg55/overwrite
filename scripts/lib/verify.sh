#!/usr/bin/env bash
# The end-to-end verification runs: full lifecycles driven by the real three-process
# engine against a throwaway sandbox, each asserting a different half of it.
#
# Lifted out of sandbox.sh, which was at the file-size limit, and grouped here because
# "restart clean, seed, run the engine, assert, stop" is one responsibility repeated
# three times. Depends on sandbox.sh for STATE_DIR, ROOT, find_bun, cmd_stop/cmd_start,
# wait_vetted, cmd_seed_vault and cmd_engine, so it is sourced after those are defined
# rather than being runnable on its own.

# Full end-to-end: seed a bare vault, run the three-process engine, and assert two
# epochs complete with rolled positions, N receipts each, oracle observations, and no
# operator-side premium/oracle exercises. Restart clean first so stale parties or a
# prior run's epoch reports never poison the seed or the assertions.
cmd_verify() {
  cmd_stop || true
  cmd_start || return 1
  wait_vetted || return 1
  cmd_seed_vault || return 1
  cmd_engine || return 1
  local bun; bun="$(find_bun)"
  set -a; . "$STATE_DIR/demo.env"; set +a
  local status=0
  ( cd "$ROOT" && "$bun" scripts/verify-epochs ) || status=$?
  cmd_engine_stop
  return $status
}

# Full end-to-end ITM: seed a forced-ITM vault (the oracle steps its demo price up past
# the strike mid-epoch), run the three-process engine, and assert one epoch settles ITM
# with the close-and-distribute path (positions closed, nothing rolled forward).
cmd_verify_itm() {
  cmd_stop || true
  cmd_start || return 1
  wait_vetted || return 1
  local bun; bun="$(find_bun)"
  if [ -z "$bun" ]; then echo "bun not found (PATH + ~/.bun/bin)" >&2; return 1; fi
  ( cd "$ROOT" && LEDGER_API_URL="http://localhost:$JSON_PORT" "$bun" scripts/seed-vault itm ) || return 1
  cmd_engine || return 1
  set -a; . "$STATE_DIR/demo.env"; set +a
  local status=0
  ( cd "$ROOT" && "$bun" scripts/verify-epochs-itm ) || status=$?
  cmd_engine_stop
  return $status
}

# Plan 008 regression: a deposit that lands while the deposit window is open must not
# wedge the vault. Needs the engine, like verify, but the deposit is the point: no other
# check in this repo puts a spendable wallet and a running engine together, which is the
# combination that broke. The script pauses the scheduler on an open window, deposits as
# a fresh party, resumes, and requires the vault to reach two further epochs.
cmd_verify_deposit() {
  cmd_stop || true
  cmd_start || return 1
  wait_vetted || return 1
  cmd_seed_vault || return 1
  # A fresh sandbox is a fresh engine, so clear the control channel the way `seed` does.
  # seed-vault does not, and the check watches these files to find an open deposit
  # window: a status file left by the PREVIOUS run says "lastAction: Roll" from the
  # moment this one starts, so the check deposited into epoch 1 before the scheduler had
  # written anything at all, and then failed against a state it had misread.
  rm -f "$STATE_DIR/engine-status.json" "$STATE_DIR/engine-intent.json"
  cmd_engine || return 1
  local bun; bun="$(find_bun)"
  set -a; . "$STATE_DIR/demo.env"; set +a
  local status=0
  ( cd "$ROOT" && "$bun" scripts/verify-midwindow-deposit ) || status=$?
  cmd_engine_stop
  return $status
}

