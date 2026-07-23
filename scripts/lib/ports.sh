#!/usr/bin/env bash
# Sandbox port configuration.
#
# Overridable so a machine with something already on 7575 (or 6865) can still run the
# stack. Defaults are unchanged, so every existing invocation behaves as it did before.
#
# GRPC_PORT and ADMIN_PORT used to be checked for collisions but never handed to
# `daml sandbox`, so the guard inspected ports the script did not control: overriding
# GRPC_PORT moved the check without moving the binding, and Canton took 6865 and 6866
# anyway. cmd_start passes both explicitly now.
#
# WHAT THIS DOES NOT DO: it does not let two sandboxes run side by side. `daml sandbox`
# starts a Canton topology whose internal nodes bind further ports that these three do
# not reach, and the sequencer's Admin API is pinned to 6868 regardless of --port.
# Verified 2026-07-20: with GRPC_PORT=7900 the startup still died on
# "Failed to bind to address /127.0.0.1:6868". So a second instance needs a custom
# Canton config, not another variable here. If you need to verify a candidate DAR
# while a sandbox is already serving the deployed one, stop the first sandbox.

JSON_PORT="${JSON_PORT:-7575}"
GRPC_PORT="${GRPC_PORT:-6865}"
ADMIN_PORT="${ADMIN_PORT:-6866}"
