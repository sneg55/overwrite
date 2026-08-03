# Overwrite shared-demo image: the whole stack in one container.
#
# Build:  docker compose -f deploy/docker-compose.prod.yml up -d --build
# Runs:   Canton sandbox (JVM) + scheduler + oracle + mm + REST backend + Next.js prod.
#
# One container, not six, because the REST server and the scheduler share pause/step
# state through files in ENGINE_CONTROL_DIR. Split them across containers and the
# operator control room writes an intent no scheduler ever reads.
#
# Targets linux/amd64: the Daml 3.4.11 release publishes linux-x86_64 and
# linux-aarch64, and the box this is written for (veodyn-cal) is x86_64. On an arm64
# host, pass --build-arg DAML_ARCH=aarch64.

FROM eclipse-temurin:17-jdk-noble

# MUST match daml/daml.yaml sdk-version. If they drift, the image builds the DAR with
# one SDK and the sandbox serves it under another: every command submission comes back
# PACKAGE_NAMES_NOT_FOUND and the engine sits there dispatching nothing.
ARG DAML_SDK_VERSION=3.4.11
ARG DAML_ARCH=x86_64
ARG BUN_VERSION=1.3.5

# jq: the entrypoint's engine watchdog reads the control channel with it.
# lsof + procps: sandbox.sh uses both to find and stop the Canton process.
# tini: reaps the backgrounded engine processes on container stop.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates git jq procps lsof tini unzip \
 && rm -rf /var/lib/apt/lists/*

# Daml SDK from the GitHub release tarball. get.daml.com serves the 2.x line, not 3.x.
# Do NOT set DAML_HOME: daml-helper reads it as the install root and builds paths like
# $DAML_HOME/bin/bin/daml. Put the installer's own bin dir on PATH and leave it alone.
ENV PATH="/root/.daml/bin:/usr/local/bun/bin:${PATH}"
RUN curl -fsSL "https://github.com/digital-asset/daml/releases/download/v${DAML_SDK_VERSION}/daml-sdk-${DAML_SDK_VERSION}-linux-${DAML_ARCH}.tar.gz" \
      -o /tmp/daml-sdk.tar.gz \
 && tar xzf /tmp/daml-sdk.tar.gz -C /tmp \
 && "/tmp/sdk-${DAML_SDK_VERSION}/install.sh" \
 && rm -rf /tmp/daml-sdk.tar.gz "/tmp/sdk-${DAML_SDK_VERSION}"

ENV BUN_INSTALL=/usr/local/bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"

WORKDIR /app

# Manifests first so the dependency layer caches across source edits. Root package.json
# declares the workspaces, so the install must run from the root: backend and web
# resolve each other's types through the workspace links, not through npmjs.
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN bun install --frozen-lockfile

COPY . .

# Build the DAR in-image rather than shipping one: daml/.daml is gitignored, and this
# build also re-runs the upgrade validation against daml/baseline, so an incompatible
# template change fails the image build instead of the ledger at boot.
RUN cd daml && daml build

# Next.js production build. The app reads OVERWRITE_API_URL at request time in server
# components, so the backend URL is a runtime env var and not baked in here.
RUN cd web && bun run build

# The demo's own knobs. Every one is overridable from the compose file.
ENV OVERWRITE_RESET_INTERVAL_MINUTES=360
ENV OVERWRITE_AUTO_RESUME_SECONDS=600
ENV BACKEND_PORT=3001
ENV WEB_PORT=3000
# Canton wants a real heap. Left unset, the JVM takes ~25% of container RAM and the
# sandbox dies mid-cycle reading package archives. _JAVA_OPTIONS rather than JAVA_OPTS:
# daml-helper launches canton.jar with a plain `java -jar` that does not forward
# JAVA_OPTS, while _JAVA_OPTIONS is honored by every JVM unconditionally.
ENV _JAVA_OPTIONS="-Xms512m -Xmx3g -XX:+ExitOnOutOfMemoryError"

# Only the web port is published by compose. The ledger (7575/6865) and the REST API
# (3001) stay inside: nothing in the browser talks to either one directly.
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint.sh"]
