# Demo video source

Source for the Overwrite submission video. `scenes.json` is the single source of
truth: it holds every scene's narration, caption, and either a card block or the
name of a testreel capture. Three inputs land on one timeline (real UI footage,
rendered cards, TTS narration) and one ffmpeg pass assembles them.

Delivered artefact: **`../overwrite-demo-1.25x.mp4`**, 2:56, 1920x1080, H.264 + AAC.
The base cut (`out/demo.mp4`, 3:40) is the same video before the 1.25x pass.

## Pipeline

```bash
npm install                  # testreel + playwright, then: npx playwright install chromium
npm run capture:ui           # records every ui/*.json -> testreel-output/
npm run cards                # scenes.json -> out/cards/*.png + out/captions/*.png
npm run tts                  # narration -> out/audio/*.mp3   (needs the OpenAI key)
npm run build                # -> out/demo.mp4
npm run speed                # -> out/overwrite-demo-1.25x.mp4   (the deliverable)
```

Every stage is cached, so a narration edit is `npm run tts && npm run build`.

## README schematics

`schematics/` renders the diagrams embedded in the root README to
`../schematics/*.png`. Each diagram is a plain `.html` file linking `base.css`, which
mirrors the app's design tokens so a diagram reads as the same product as the UI. The
screenshot is taken of the `.slide` element, so a diagram's height follows its content
and none of them need a hand-tuned clip rectangle.

```bash
npm run schematics           # -> ../schematics/{epoch-lifecycle,privacy-model,architecture}.png
```

No ledger, no network and no key: edit the HTML, re-run, commit the PNGs.

## The app has to be running first

The UI scenes are recordings of the real app against a local Canton sandbox, not
mockups. Bring the stack up before `capture:ui`:

```bash
./scripts/sandbox.sh start
./scripts/sandbox.sh seed-vault      # bare vault; the engine drives the lifecycle
./scripts/sandbox.sh engine          # scheduler + oracle + mm, 15s epochs
PORT=3002 ./scripts/sandbox.sh serve
cd web && bun run build && OVERWRITE_API_URL=http://localhost:3002 \
  OVERWRITE_DEMO_DEFAULT_PARTY=operator PORT=3000 bun run start
```

Record against a **production** web build, not `next dev`: the dev-mode Next.js
indicator badge sits in the bottom-left corner of every frame otherwise.

`inspect-selectors.mjs` screenshots each route and dumps every interactive element
with a selector that actually resolves. Run it before editing any `ui/*.json`;
this app has no `data-testid` attributes, so steps are written against real
selectors (`#party`, `#amountCbtc`, `button:has-text("Step")`).

## Recording order matters

Two constraints, learned the hard way:

1. **Record the operator scenes before the deposit scene.** This used to be a hard
   requirement: a deposit made while the window was open left the operator holding two
   CBTC holdings, the scheduler locked only the largest one, `LockCollateral` started
   failing, and the engine wedged, so everything filmed after that point showed a stuck
   engine. The scheduler now consolidates the pool before locking, and
   `sandbox.sh verify-deposit` is the regression gate for it, but recording in this
   order still gives the cleanest footage.
2. **The deposit needs a funded wallet and an open window.** `seed-vault` puts every
   depositor's CBTC straight into the pool, so alice has nothing to deposit; run
   `fund-alice.mjs` to give her a wallet holding. The window is only open for one
   tick per epoch, so pause the engine on it first by watching
   `.sandbox/engine-status.json` for `"lastAction": "Roll"` and then writing
   `{"paused": true, "stepSeq": <current>}` to `.sandbox/engine-intent.json`
   (the same control channel the operator's Pause button uses).

The local sandbox also degrades after roughly 15 epochs: the active-contract set
outgrows the JSON API's payload limit and every ACS read returns HTTP 413. Reseed
rather than filming through it.

## Two things this machine needs

- **No `drawtext`.** The Homebrew ffmpeg here is built without libfreetype, so
  captions are PNG strips rendered from `cards/caption.html` and composited with
  `overlay`, not text drawn by ffmpeg.
- **The OpenAI key** is read by the `tts` script from `.env` in this directory (copy
  `.env.example` and fill it in). That file is gitignored and must stay that way; the
  key is never committed. A symlink to a key kept elsewhere works too.

## Honesty rails

The same rails as the README and the decks, and they are on camera, not just in the
script: the outro card states that the market maker and price feed are simulated and
that premium figures are demo parameters. The narration says the devnet proof covers
deposit-and-lock and that the rest of the lifecycle runs on a local sandbox. No APY
or yield claim appears anywhere.
