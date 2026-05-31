// ${MODULE_HOME}/asset-assembly.mjs
// _examplebrand_VISUAL_PLAN_V1 -- Task 005: Asset assembly stub
//
// Walks the visual plan, calls dispatchBeat per entry, collects asset paths.
// Returns { beat_index: { image_path?, video_path?, layer_paths?, ffmpeg_spec?, svg_path? } }
//
// Does NOT assemble the final video. That is the job of examplebrand_episode_assemble (future module).
// Handoff document: staged/handoffs/visual-plan-to-assemble.md

import { dispatchBeat } from './dispatcher.mjs'

/**
 * Walk the plan and dispatch each beat.
 *
 * @param {Array}  plan           - Array of plan entries from dispatchVisualPlan
 * @param {string} episodeId      - e.g. 's01e03'
 * @param {string} narratorVoiceId - ElevenLabs voice ID (carried through to asset records)
 * @param {object} adapters       - { generateImage, veoGenerate }
 * @returns {object} assets keyed by beat_index string
 */
export async function assembleAssets (plan, episodeId, narratorVoiceId, adapters = {}) {
  const assets    = {}
  const errors    = []
  const veoJobs   = []   // collect async Veo operations for status reporting

  for (const entry of plan) {
    const result = await dispatchBeat(entry, episodeId, adapters)

    if (result.error) {
      errors.push({ beat_index: result.beat_index, error: result.error })
      assets[result.beat_index] = { error: result.error }
      continue
    }

    // Normalise the result into a standard asset record
    const record = buildAssetRecord(result, entry, narratorVoiceId)
    assets[result.beat_index] = record

    if (result.veo_operation) {
      veoJobs.push({ beat_index: result.beat_index, operation: result.veo_operation })
    }
  }

  const summary = {
    episode_id:       episodeId,
    total_beats:      plan.length,
    dispatched:       plan.length - errors.length,
    errors:           errors.length,
    veo_pending:      veoJobs.length,
    output_dir:       `/tmp/examplebrand-assets/${episodeId}`,
    handoff_note:     'Pass assets + plan to examplebrand_episode_assemble for final video composition.',
  }

  if (veoJobs.length > 0) {
    summary.veo_jobs = veoJobs
    summary.veo_note = 'Veo clips are async. Re-call examplebrand_visual_plan(mode=assets) after ~2min to retry pending beats, or pass veo_operation IDs to a polling step.'
  }

  if (errors.length > 0) {
    summary.error_beats = errors
  }

  return { assets, summary }
}

// ── Build a standardised asset record from dispatcher output ─────────────────

function buildAssetRecord (dispatchResult, planEntry, narratorVoiceId) {
  const { beat_index, visual_form, narration_text, start_s, end_s } = planEntry
  const record = {
    beat_index,
    visual_form,
    narration_text,
    start_s,
    end_s,
    narrator_voice_id: narratorVoiceId || null,
  }

  // Merge dispatcher result fields
  if (dispatchResult.image_path)   record.image_path   = dispatchResult.image_path
  if (dispatchResult.video_path)   record.video_path   = dispatchResult.video_path
  if (dispatchResult.video_url)    record.video_url    = dispatchResult.video_url
  if (dispatchResult.layer_paths)  record.layer_paths  = dispatchResult.layer_paths
  if (dispatchResult.ffmpeg_spec)  record.ffmpeg_spec  = dispatchResult.ffmpeg_spec
  if (dispatchResult.svg_path)     record.svg_path     = dispatchResult.svg_path
  if (dispatchResult.rasterize_cmd)record.rasterize_cmd= dispatchResult.rasterize_cmd
  if (dispatchResult.duration_s)   record.card_duration_s = dispatchResult.duration_s
  if (dispatchResult.veo_operation)record.veo_operation = dispatchResult.veo_operation
  if (dispatchResult.status)       record.status        = dispatchResult.status
  if (dispatchResult.note)         record.note          = dispatchResult.note

  return record
}
