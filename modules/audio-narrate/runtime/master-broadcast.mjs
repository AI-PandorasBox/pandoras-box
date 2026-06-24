// _AUDIO_NARRATE_V1 — master-broadcast.mjs
// Output spec: broadcast_wav = 48 kHz 24-bit stereo WAV, peak −3 dBFS.
// Destination: ${MODULE_HOME}/master-broadcast.mjs
//
// No dynamic range compression — YouTube re-masters anyway.
// Peak normalise only: limit to −3 dBFS to leave headroom for video mixer.

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
 * masterBroadcastWav — transcode ElevenLabs MP3 to 48 kHz 24-bit WAV.
 * Peak normalise to −3 dBFS. No compression.
 *
 * @param {Buffer} mp3Buf   Raw MP3 bytes from ElevenLabs
 * @param {string} outPath  Destination .wav file path
 * @returns {{ path: string, duration_s: number }}
 */
export async function masterBroadcastWav (mp3Buf, outPath) {
  const tmpIn = join(tmpdir(), `anin-${randomUUID()}.mp3`)
  writeFileSync(tmpIn, mp3Buf)

  try {
    // Two-pass: probe peak, then normalise
    // Pass 1 — volumedetect to find max_volume
    const { stderr: probeOut } = await execFileAsync(FFMPEG, [
      '-i', tmpIn,
      '-af', 'volumedetect',
      '-vn',
      '-f', 'null',
      '/dev/null'
    ])

    const peakMatch = probeOut.match(/max_volume:\s*([-\d.]+)\s*dB/)
    const peakDb    = peakMatch ? parseFloat(peakMatch[1]) : 0
    const targetDb  = -3
    const gainDb    = targetDb - peakDb  // may be negative (attenuation) or positive

    // Pass 2 — apply gain, upsample to 48 kHz, encode as 24-bit PCM WAV
    await execFileAsync(FFMPEG, [
      '-y',
      '-i', tmpIn,
      '-af', `volume=${gainDb.toFixed(2)}dB`,
      '-ar', '48000',
      '-ac', '2',        // stereo
      '-sample_fmt', 's32',  // 24-bit stored as 32-bit container (standard WAV 24-bit)
      '-bits_per_raw_sample', '24',
      '-f', 'wav',
      outPath
    ])

    // Duration from file size: WAV header is 44 bytes; data = bytes - 44
    const bytes = statSync(outPath).size
    const dataSamples = (bytes - 44) / (48000 * 2 * 3)  // 3 bytes/sample for 24-bit
    const duration_s = dataSamples

    return { path: outPath, duration_s: Math.round(duration_s * 100) / 100 }
  } finally {
    try { unlinkSync(tmpIn) } catch {}
  }
}
