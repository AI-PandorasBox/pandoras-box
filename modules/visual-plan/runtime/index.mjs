// ${MODULE_HOME}/index.mjs
// _examplebrand_VISUAL_PLAN_V1
//
// Entry point for the examplebrand_visual_plan tool.
// Called from personalai.mjs with:
//   const _avpMod = await import('.../index.mjs')
//   return await _avpMod.dispatchVisualPlan(input, { generateImage, veoGenerate })
//
// Adapters are passed in so the module is decoupled from personalai's globals.

import { segmentBeats }     from './beat-segmenter.mjs'
import { selectVisualForm } from './selector.mjs'
import { dispatchBeat }     from './dispatcher.mjs'
import { assembleAssets }   from './asset-assembly.mjs'

const VALID_MODES = ['plan', 'assets']

export async function dispatchVisualPlan (input, adapters = {}) {
  const {
    script,
    mode = 'plan',
    narrator_voice_id,
    episode_id,
    target_duration_s = null,
    canon_ref_path    = null,
  } = (input || {})

  if (!script)      return { error: 'examplebrand_visual_plan: script is required' }
  if (!episode_id)  return { error: 'examplebrand_visual_plan: episode_id is required' }
  if (!VALID_MODES.includes(mode)) return { error: `examplebrand_visual_plan: mode must be one of ${VALID_MODES.join(', ')}` }

  // Normalise script to { text, word_timings? }
  const scriptObj = typeof script === 'string'
    ? { text: script, word_timings: null }
    : script

  if (!scriptObj.text || typeof scriptObj.text !== 'string') {
    return { error: 'examplebrand_visual_plan: script.text must be a non-empty string' }
  }

  // Step 1 -- beat segmentation
  const beats = segmentBeats(scriptObj.text, scriptObj.word_timings, target_duration_s)

  // Step 2 -- per-beat visual form selection
  const plan = []
  let prevForm     = null
  const contextStats = { veoBurstsUsed: 0, totalDuration: beats.reduce((s, b) => s + b.duration_s, 0) }

  for (const beat of beats) {
    const visual_form = selectVisualForm(beat, prevForm, contextStats)
    if (visual_form === 'full-Veo-motion-burst') contextStats.veoBurstsUsed++
    const asset_spec  = buildAssetSpec(beat, visual_form, narrator_voice_id, canon_ref_path)
    plan.push({
      beat_index:     beat.beat_index,
      start_s:        beat.start_s,
      end_s:          beat.end_s,
      narration_text: beat.narration_text,
      visual_form,
      asset_spec,
    })
    prevForm = visual_form
  }

  if (mode === 'plan') return { plan }

  // mode === 'assets' -- walk plan and dispatch each beat
  const assets = await assembleAssets(plan, episode_id, narrator_voice_id, adapters)
  return { plan, assets }
}

// Build the asset_spec for a beat without calling generators yet.
// This is what mode='plan' returns -- a declaration of intent that assistant can review.
function buildAssetSpec (beat, visual_form, narrator_voice_id, canon_ref_path) {
  const base = {
    visual_form,
    beat_type:    beat.type,
    duration_s:   beat.duration_s,
    narrator_voice_id: narrator_voice_id || null,
    canon_ref_path:    canon_ref_path    || null,
  }

  switch (visual_form) {
    case 'narrate-over-still':
      return { ...base, image_prompt: buildImagePrompt(beat, 'still'), style_preset: 'examplebrand_v1' }

    case 'still+Ken-Burns-zoom':
      return {
        ...base,
        image_prompt: buildImagePrompt(beat, 'detail-focus'),
        style_preset: 'examplebrand_v1',
        ffmpeg_transform: {
          type:       'ken_burns_zoom',
          zoom_from:  1.0,
          zoom_to:    1.15,
          duration_s: beat.duration_s,
        },
      }

    case 'static-art-parallax':
      return {
        ...base,
        layers: [
          { depth: 'background', image_prompt: buildImagePrompt(beat, 'bg'), style_preset: 'examplebrand_v1' },
          { depth: 'midground',  image_prompt: buildImagePrompt(beat, 'mid'), style_preset: 'examplebrand_v1' },
          { depth: 'foreground', image_prompt: buildImagePrompt(beat, 'fg'), style_preset: 'examplebrand_v1' },
        ],
        ffmpeg_transform: {
          type:        'parallax_composite',
          shift_px:    { background: 0, midground: 8, foreground: 16 },
          duration_s:  beat.duration_s,
        },
      }

    case 'full-Veo-motion-burst':
      return {
        ...base,
        video_prompt: buildVideoPrompt(beat),
        max_duration_s: Math.min(beat.duration_s, 5),
      }

    case 'transition-card':
      return {
        ...base,
        card_type:  beat.transition_card_type || 'chapter',
        svg_spec: {
          background: '#0a0a0a',
          rule_color: '#c9a84c',
          motif:      'greek_key',
          text:       beat.narration_text.trim(),
          font:       'Cormorant Garamond',
          duration_s: Math.min(beat.duration_s, 1.5),
        },
      }

    default:
      return base
  }
}

function buildImagePrompt (beat, layer) {
  const layerHint = layer === 'still'        ? ''
                  : layer === 'detail-focus' ? 'Close-up detail, textured surface. '
                  : layer === 'bg'           ? 'Wide atmospheric background layer, desaturated. '
                  : layer === 'mid'          ? 'Mid-ground figures or architecture, slightly detailed. '
                  : layer === 'fg'           ? 'Foreground element, sharp detail, translucent edges for compositing. '
                  : ''
  return `${layerHint}${beat.narration_text.slice(0, 200)}. Ancient Greek / Hellenic aesthetic. Timeless, painterly. Style: examplebrand_v1.`
}

function buildVideoPrompt (beat) {
  return `Short cinematic clip (3-5 seconds). ${beat.narration_text.slice(0, 200)}. Ancient Greek / Hellenic setting. Dramatic motion. Painterly filmic style.`
}
