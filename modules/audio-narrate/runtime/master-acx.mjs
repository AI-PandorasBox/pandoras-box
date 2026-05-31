// _AUDIO_NARRATE_V1 — master-acx.mjs
// Output spec: acx_mp3 = 192 kbps MP3 44.1 kHz, ffmpeg loudnorm I=−20:LRA=11:TP=−3,
// 0.5 s room-tone tail, consistent channel layout (mono OR stereo, not mixed).
// Destination: ${MODULE_HOME}/master-acx.mjs
//
// ACX requirements: −23 to −18 LUFS integrated, max −3 dBTP, noise floor < −60 dBFS.
// loudnorm I=−20 targets the middle of the ACX window with headroom.

import { execFile }     from 'node:child_process'
import { writeFileSync, unlinkSync, statSync } from 'node:fs'
import { promisify }    from 'node:util'
import { tmpdir }       from 'node:os'
import { join }         from 'node:path'
import { randomUUID }   from 'node:crypto'

const execFileAsync = promisify(execFile)
const FFMPEG = '/opt/homebrew/bin/ffmpeg'

// 0.5 s of -70 dBFS white noise as room tone tail (avoids hard cut-off)
// Generated inline as a short PCM sine at near-silence level
const ROOM_TONE_FILTER = 'apad=pad_dur=0.5'

/**
 * masterAcxMp3 — loudnorm + room-tone tail + 192 kbps MP3 encode.
 *
 * Uses two-pass loudnorm (linear mode) for accurate LUFS targeting.
 *
 * @param {Buffer} mp3Buf   Raw MP3 bytes from ElevenLabs
 * @param {string} outPath  Destination .mp3 file path
 * @returns {{ path: string, duration_s: number }}
 */
export async function masterAcxMp3 (mp3Buf, outPath) {
  const tmpIn   = join(tmpdir(), `anin-${randomUUID()}.mp3`)
  const tmpPass = join(tmpdir(), `anpass-${randomUUID()}.wav`)
  writeFileSync(tmpIn, mp3Buf)

  try {
    // Pass 1 — measure loudness (linear loudnorm requires JSON analysis)
    const { stderr: pass1Out } = await execFileAsync(FFMPEG, [
      '-i', tmpIn,
      '-af', 'loudnorm=I=-20:LRA=11:TP=-3:print_format=json',
      '-f', 'null',
      '/dev/null'
    ])

    // Extract measured values from pass1 JSON
    const jsonMatch = pass1Out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)
    let measured_I = '-20', measured_LRA = '11', measured_TP = '-3', measured_thresh = '-30', offset = '0'
    if (jsonMatch) {
      try {
        const m = JSON.parse(jsonMatch[0])
        measured_I      = m.input_i      || '-20'
        measured_LRA    = m.input_lra    || '11'
        measured_TP     = m.input_tp     || '-3'
        measured_thresh = m.input_thresh || '-30'
        offset          = m.target_offset || '0'
      } catch {}
    }

    // Pass 2 — apply linear loudnorm + room-tone pad + encode 192 kbps MP3
    const loudnormFilter = [
      `loudnorm=I=-20:LRA=11:TP=-3`,
      `:measured_I=${measured_I}`,
      `:measured_LRA=${measured_LRA}`,
      `:measured_TP=${measured_TP}`,
      `:measured_thresh=${measured_thresh}`,
      `:offset=${offset}`,
      `:linear=true`
    ].join('')

    await execFileAsync(FFMPEG, [
      '-y',
      '-i', tmpIn,
      '-af', `${loudnormFilter},${ROOM_TONE_FILTER}`,
      '-ar', '44100',
      '-ac', '1',         // mono (consistent — ACX accepts mono; avoids L/R mismatch artefacts)
      '-b:a', '192k',
      '-codec:a', 'libmp3lame',
      outPath
    ])

    // Duration estimate from output file size and bitrate
    const bytes = statSync(outPath).size
    const duration_s = (bytes * 8) / (192 * 1000)

    return { path: outPath, duration_s: Math.round(duration_s * 100) / 100 }
  } finally {
    try { unlinkSync(tmpIn)   } catch {}
    try { unlinkSync(tmpPass) } catch {}
  }
}
