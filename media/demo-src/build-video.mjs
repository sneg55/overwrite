// Assembles the final demo from scenes.json in a single ffmpeg pass:
//   - card/term scenes: the rendered PNG held for the scene length
//   - ui scenes: the testreel capture, extended (last frame held) to scene length
//   - per scene: narration time-stretched by a global factor so the whole video
//     lands under TARGET seconds, padded with silence to the scene length
// Output: out/demo.mp4 (1920x1080, H.264 + AAC).

import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes.json'), 'utf8'))
const CARDS = path.join(__dirname, 'out', 'cards')
const AUDIO = path.join(__dirname, 'out', 'audio')
const CAPS = path.join(__dirname, 'testreel-output')
const OUT = path.join(__dirname, 'out', 'demo.mp4')

// Knobs: TARGET is the runtime cap in seconds; TAIL is the per-scene breathing room
// after narration ends; BG is the pad color behind UI captures (match the card
// background). TARGET is 220 rather than a sub-3:00 number on purpose: the delivered
// cut is demo-1.25x.mp4, so the base is sized so the 1.25x pass lands near 2:55.
const W = 1920, H = 1080, FPS = 30, TAIL = 0.4, TARGET = 220, BG = '0x0a0c11'

// Captions are burned under the UI footage only: card and terminal scenes already
// carry their own text, so a caption there would only repeat it. Hackathon judges
// often watch a submission muted, so the UI scenes have to read without narration.
// They are PNG strips composited with `overlay`, not text drawn with `drawtext`: the
// ffmpeg on this machine is built without libfreetype and has no drawtext filter.
// render-cards.mjs renders them from cards/caption.html.
const CAPTIONS = path.join(__dirname, 'out', 'captions')

const probe = (f) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', f], { encoding: 'utf8' }).trim())

const latestCapture = (name) => {
  const files = fs.readdirSync(CAPS).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.mp4'))
  if (!files.length) throw new Error(`no capture for "${name}" in testreel-output/`)
  files.sort()
  return path.join(CAPS, files[files.length - 1])
}

// The concatenated narration's peak level in dBFS, from a cheap audio-only pass (no
// video decode). Uses the SAME per-scene chain as the real assembly (atempo, the
// silence pad, the per-scene trim) so the number matches what the final mix contains.
// spawnSync, not execFileSync, because volumedetect prints its summary to stderr.
const measureNarrationPeak = () => {
  const inp = []
  const flt = []
  const labels = []
  scenes.forEach((s, i) => {
    inp.push('-i', s._audio)
    flt.push(
      `[${i}:a]atempo=${factor.toFixed(4)},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${s._len.toFixed(3)},asetpts=N/SR/TB[a${i}]`
    )
    labels.push(`[a${i}]`)
  })
  // volumedetect goes INSIDE the complex graph: a stream fed by -filter_complex cannot
  // also take a simple -af filter (ffmpeg refuses to mix the two on one stream).
  flt.push(`${labels.join('')}concat=n=${scenes.length}:v=0:a=1[ac]`)
  flt.push('[ac]volumedetect[a]')
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', ...inp, '-filter_complex', flt.join(';'), '-map', '[a]', '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  const m = (r.stderr || '').match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
  if (!m) throw new Error('could not measure narration peak (volumedetect)')
  return parseFloat(m[1])
}

// Measure narration + compute the global speed factor.
let sumDa = 0
for (const s of scenes) {
  s._audio = path.join(AUDIO, `${s.id}.mp3`)
  if (!fs.existsSync(s._audio)) throw new Error(`missing narration for ${s.id}; run tts.mjs first`)
  s._da = probe(s._audio)
  sumDa += s._da
}
const factor = Math.max(1, sumDa / (TARGET - scenes.length * TAIL))
for (const s of scenes) s._len = s._da / factor + TAIL
const total = scenes.reduce((a, s) => a + s._len, 0)
console.log(`narration ${sumDa.toFixed(1)}s -> speed x${factor.toFixed(3)} -> final ~${total.toFixed(1)}s`)

// The caption strip PNG for a UI scene, or undefined when there is none to overlay.
// render-cards.mjs writes these; a missing file is not fatal, the scene just plays
// without a caption rather than failing the whole build.
const captionPng = (s) => {
  if (s.kind !== 'ui' || typeof s.caption !== 'string' || s.caption === '') return undefined
  const file = path.join(CAPTIONS, `${s.id}.png`)
  return fs.existsSync(file) ? file : undefined
}

// Build one ffmpeg invocation with paired (video, audio) inputs per scene.
const inputs = []
const filters = []
const concatLabels = []
let idx = 0
scenes.forEach((s, i) => {
  const L = s._len.toFixed(3)
  let vIdx
  if (s.kind === 'ui') {
    const cap = latestCapture(s.capture)
    const U = probe(cap)
    const hold = Math.max(0, s._len - U).toFixed(3)
    inputs.push('-i', cap)
    vIdx = idx++
    const base = `[${vIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=${BG},fps=${FPS},setsar=1,tpad=stop_mode=clone:stop_duration=${hold},format=yuv420p`
    const strip = captionPng(s)
    if (strip === undefined) {
      filters.push(`${base},trim=0:${L},setpts=PTS-STARTPTS[v${i}]`)
    } else {
      // The strip is looped for the scene length and composited over the footage.
      // `shortest=1` ends the overlay with the base rather than with the still.
      inputs.push('-loop', '1', '-t', L, '-i', strip)
      const cIdx = idx++
      filters.push(`${base}[base${i}]`)
      filters.push(
        `[base${i}][${cIdx}:v]overlay=0:${H - 150}:shortest=1,trim=0:${L},setpts=PTS-STARTPTS[v${i}]`
      )
    }
  } else {
    inputs.push('-loop', '1', '-t', L, '-i', path.join(CARDS, `${s.id}.png`))
    vIdx = idx++
    filters.push(
      `[${vIdx}:v]scale=${W}:${H},fps=${FPS},setsar=1,format=yuv420p,trim=0:${L},setpts=PTS-STARTPTS[v${i}]`
    )
  }
  inputs.push('-i', s._audio)
  const aIdx = idx++
  filters.push(
    `[${aIdx}:a]atempo=${factor.toFixed(4)},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${L},asetpts=N/SR/TB[a${i}]`
  )
  concatLabels.push(`[v${i}][a${i}]`)
})
filters.push(`${concatLabels.join('')}concat=n=${scenes.length}:v=1:a=1[v][araw]`)
// Raw TTS peaks around -14 dBFS, which plays as noticeably quiet next to any other
// video in a judging queue. Bring the whole mix up with ONE STATIC gain, measured so
// the loudest sample lands at -1 dBFS.
//
// Deliberately NOT loudnorm / dynaudnorm. Those are DYNAMIC: during the silence pads
// between and after narration they ramp the gain up to chase the loudness target and
// lift the TTS clips' -72 dB noise floor into audible white-noise hiss (measured: a
// pad region sat at -17 dB RMS under loudnorm). A single static gain leaves true
// silence silent and raises the noise floor by the same fixed amount (~13 dB, to
// about -59 dB, inaudible), so the speech gets loud and the gaps stay clean.
const peakDb = measureNarrationPeak()
const gainDb = (-1.0 - peakDb).toFixed(2)
console.log(`narration peak ${peakDb.toFixed(1)} dBFS -> static gain +${gainDb} dB`)
filters.push(`[araw]volume=${gainDb}dB[a]`)

const args = [
  '-y', '-loglevel', 'error',
  ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  OUT,
]
console.log('encoding...')
execFileSync('ffmpeg', args, { stdio: 'inherit' })
console.log(`done -> ${path.relative(process.cwd(), OUT)} (${probe(OUT).toFixed(1)}s)`)
