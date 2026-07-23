// Synthesizes one narration clip per scene via OpenAI TTS (gpt-4o-mini-tts).
// Reads OPENAI_API_KEY from the environment (pass via `node --env-file=...`).
// The key is never logged. Clips are cached: a scene is re-synthesized only when
// its narration text changes (tracked by a sidecar hash file).

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes.json'), 'utf8'))
const OUT = path.join(__dirname, 'out', 'audio')
fs.mkdirSync(OUT, { recursive: true })

const KEY = process.env.OPENAI_API_KEY
if (!KEY) {
  console.error('OPENAI_API_KEY is not set. Run: node --env-file=<path-to-.env> tts.mjs')
  process.exit(1)
}
const MODEL = 'gpt-4o-mini-tts'
const VOICE = process.env.TTS_VOICE || 'sage'
const INSTRUCTIONS =
  'Clear, confident product-demo narration. Even pace, no hard sell. Pronounce acronyms letter by letter.'

const hash = (t) => crypto.createHash('sha256').update(`${MODEL}|${VOICE}|${t}`).digest('hex').slice(0, 16)

async function synth(scene) {
  const mp3 = path.join(OUT, `${scene.id}.mp3`)
  const stamp = path.join(OUT, `${scene.id}.hash`)
  const want = hash(scene.narrate)
  if (fs.existsSync(mp3) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === want) {
    console.log(`  ${scene.id}: cached`)
    return
  }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: scene.narrate,
      instructions: INSTRUCTIONS,
      response_format: 'mp3',
    }),
  })
  if (!res.ok) {
    // Do not surface the request (it carries the auth header); status + body only.
    throw new Error(`OpenAI TTS ${res.status} for scene ${scene.id}: ${await res.text()}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(mp3, buf)
  fs.writeFileSync(stamp, want)
  console.log(`  ${scene.id}: ${(buf.length / 1024).toFixed(0)} KB`)
}

console.log(`Synthesizing ${scenes.length} narration clips (OpenAI ${MODEL}, voice=${VOICE})...`)
for (const s of scenes) await synth(s)
console.log('narration done ->', path.relative(process.cwd(), OUT))
