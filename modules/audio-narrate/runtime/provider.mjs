// _AUDIO_NARRATE_V1 — provider.mjs
// ElevenLabs raw audio fetch + mux_pcm mastering (24 kHz 16-bit raw PCM).
// Destination: ${MODULE_HOME}/provider.mjs
//
// mux_pcm is the streaming path: no encoding, just resample via ffmpeg to
// 24 kHz / 16-bit / mono PCM to match the streamElevenLabsTTS pipeline.

import { execFile, execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, statSync } from 'node:fs'
import { promisify }    from 'node:util'
import { tmpdir }       from 'node:os'
import { join }         from 'node:path'
import { randomUUID }   from 'node:crypto'

const execFileAsync = promisify(execFile)
// Resolve ffmpeg at runtime so this works on macOS (Homebrew) and Linux.
function resolveBin (name, fallback) {
  try {
    return execFileSync('command', ['-v', name], { shell: true }).toString().trim() || fallback
  } catch {
    return fallback
  }
}
const FFMPEG = process.env.PBOX_FFMPEG_BIN || resolveBin('ffmpeg', 'ffmpeg')

/**
 * masterMuxPcm — convert raw ElevenLabs MP3 buffer to 24 kHz 16-bit mono PCM.
 * Used by the assistant call streaming path.
 *
 * @param {Buffer} mp3Buf   Raw MP3 bytes from ElevenLabs
 * @param {string} outPath  Destination .pcm file path
 * @returns {{ path: string, duration_s: number }}
 */
export async function masterMuxPcm (mp3Buf, outPath) {
  const tmpIn = join(tmpdir(), `anin-${randomUUID()}.mp3`)
  writeFileSync(tmpIn, mp3Buf)

  try {
    // Resample to 24 kHz mono signed 16-bit little-endian PCM
    // execFile (not exec) — no shell injection risk; all args are literals or UUIDs
    await execFileAsync(FFMPEG, [
      '-y',
      '-i', tmpIn,
      '-ar', '24000',
      '-ac', '1',
      '-f', 's16le',
      outPath
    ])

    // Bytes / (sampleRate * channels * bytesPerSample)
    const bytes = statSync(outPath).size
    const duration_s = bytes / (24000 * 1 * 2)

    return { path: outPath, duration_s: Math.round(duration_s * 100) / 100 }
  } finally {
    try { unlinkSync(tmpIn) } catch {}
  }
}
