# Shared demo deployment

Hosting recipe for the public demo: one container on one box, running the whole stack
against a local Canton sandbox, wiped every 6 hours.

Live at **https://overwrite.sawinyh.com** on the veodyn box, alongside cal.diy,
warpdrive and watanabe.

## What visitors get

- The real lifecycle, not a mock: Canton sandbox, the same DAR the devnet lineage
  carries, the three-process engine (scheduler, oracle, mm) driving deposit, lock,
  write, pay, settle, record and roll on a compressed clock.
- A **writable** demo. Anyone can switch parties, deposit from a funded wallet, queue a
  withdrawal, and pause or step the engine from the operator control room.
- The privacy reveal is real here: switching to `observer` produces an empty view on the
  server because that party genuinely sees nothing, not because a filter hid it.

Everything is labeled as it is in the product: the market maker and the price feed are
simulated, premium figures are demo parameters, and the demo parties are backend-owned
and custodial.

## Why one container

The REST server and the scheduler are separate processes that exchange pause and step
through files in `ENGINE_CONTROL_DIR`. Split them across containers and the Pause button
writes an intent no scheduler ever reads. The Canton sandbox holds the whole ledger in
memory, so it cannot scale to zero either. One box, one container, no serverless.

## Why the ledger is a sandbox and not devnet

We own no devnet node. The SSO login there is a single non-admin party that cannot
allocate parties (403), and DAR upload is a manual step through the noders admins. This
demo needs operator, oracle, mm, three depositors and an observer, allocated at seed
time. The local sandbox makes the container its own participant admin, so all of that
just works. Devnet remains the place where the real CBTC registry is proven.

## Reset behavior

`OVERWRITE_RESET_INTERVAL_MINUTES` (default 360) sets a round-clock cadence: the wipe
lands at 00:00, 06:00, 12:00 and 18:00 UTC. At the boundary the entrypoint stops the
stack and exits 0; compose's `restart: unless-stopped` brings the container back on a
fresh in-memory ledger, and the boot reseeds. Expect roughly a minute or two of downtime
per wipe, most of it Canton starting up.

A boot that lands within 10 minutes of a boundary skips to the next one, so a demo is
never wiped seconds after it came up.

The engine watchdog is the other half of "writable": a visitor who pauses the engine and
closes the tab would otherwise leave the vault frozen for everyone after them. Once a
pause outlives `OVERWRITE_AUTO_RESUME_SECONDS` (default 600), the entrypoint resumes it
through the REST route.

## First deploy on the box

```sh
ssh deploy@<box>
sudo mkdir -p /opt/overwrite-demo && sudo chown deploy:deploy /opt/overwrite-demo
git clone https://github.com/sneg55/overwrite.git /opt/overwrite-demo
cd /opt/overwrite-demo
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f
```

The first build downloads the Daml SDK (about 1 GB), installs bun deps, builds the DAR
and builds Next. Later builds reuse those layers.

The container is healthy once Next answers on its port. That is later than it looks:
Canton has to start, the synchronizer has to connect, the `overwrite-vault` package has
to be vetted, and only then does the seed run.

## Caddy vhost (native, on the host)

The box runs Caddy under systemd and it owns 80/443. TLS stays on the host so cert
renewal survives container rebuilds.

```
overwrite.sawinyh.com {
	reverse_proxy 127.0.0.1:3200
	encode gzip
}
```

Then `sudo systemctl reload caddy`. DNS for `overwrite.sawinyh.com` is an A record at
the box, DNS-only (not proxied), so Caddy can answer the ACME challenge itself.

Port 3200 is this stack's slot on a shared box: 3000 is cal.diy, 3001 is warpdrive,
3100 is watanabe, 8080 is the warpdrive websocket, 9000 is MinIO.

## Operating it

```sh
cd /opt/overwrite-demo
# Wipe right now instead of waiting for the boundary
docker compose -f deploy/docker-compose.prod.yml restart
# Logs: the entrypoint's own narration
docker compose -f deploy/docker-compose.prod.yml logs -f
# Logs: one service inside the container
docker exec overwrite-demo tail -f /app/.sandbox/scheduler.log   # or canton, oracle, mm
# Ship a change
git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build
```

## Resource notes

Canton gets a 3 GB heap (`_JAVA_OPTIONS`), and the container is capped at 6 GB and 4
CPUs. The cap is deliberate: this box also serves a production CRM, so a runaway JVM has
to fail its own container rather than push a neighbor into the OOM killer.

## What this is not

- **Not persistent.** The sandbox is in-memory. Every wipe is total, by design.
- **Not authenticated.** The acting party is a client-set cookie, which is a demo
  control and not an auth boundary. Anyone can act as the operator. The 6-hour wipe and
  the auto-resume watchdog are what bound the damage.
- **Not isolated per visitor.** Everyone shares one ledger within a window and can see
  each other's effects, subject to the same on-ledger privacy every party gets.
