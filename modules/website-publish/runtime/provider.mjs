// ${MODULE_HOME}/provider.mjs
//
// Pbox v2 T7-4 Stage 1 -- runtime extraction of mediapipeline's website FTP push pipeline
// into a shared module provider. Other producers (Iris exampleco website, Cassandra web
// design service, Autonomy persona blog) can consume by importing from here.
//
// Behaviour identical to the mediapipeline.mjs functions it replaces. Caller passes ctx
// with log + env so this module is not coupled to mediapipeline's globals.
//
// Stage 1 deploy: this provider is ADDED; mediapipeline.mjs imports + delegates.
// Stage 2/3: per-tenant module-cred-scope keychain pointer reads replace env vars
//            (mediapipeline_FTP_HOST/USER/PASSWORD become per-target).

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LFTP_BIN = '/opt/homebrew/bin/lftp'

/**
 * FTP push of a single MP3 to a remote dir.
 * Default behaviour matches mediapipeline's examplesite.co.uk/mp3/ pattern.
 *
 * @param {{ log?: function, env?: object }} ctx
 * @param {string} mp3Path           absolute local path
 * @param {string} remoteFilename    name to write at the remote
 * @param {object} [opts]            { host, user, password, remoteDir, returnUrlBase }
 * @returns {{ ok: boolean, remote: string }}
 */
export function uploadMp3ToWebsite (ctx, mp3Path, remoteFilename, opts = {}) {
  const log = (ctx && ctx.log) || (() => {})
  const env = (ctx && ctx.env) || process.env
  log('info', '[website-publish] uploadMp3ToWebsite', { mp3Path, remoteFilename })

  const host = opts.host || env.mediapipeline_FTP_HOST
  const user = opts.user || env.mediapipeline_FTP_USER
  const pass = opts.password || env.mediapipeline_FTP_PASSWORD
  if (!host || !user || !pass) throw new Error('FTP host/user/password not configured (opts or mediapipeline_FTP_* env)')

  const remoteDir = opts.remoteDir || ((env.mediapipeline_FTP_REMOTE_DIR || '/public_html') + '/mp3')
  const urlBase   = opts.returnUrlBase || 'https://examplesite.co.uk/mp3/'

  execFileSync(LFTP_BIN, [
    '-u', user + ',' + pass,
    host,
    '-e', 'mkdir -p ' + remoteDir + '; put ' + mp3Path + ' -o ' + remoteDir + '/' + remoteFilename + '; bye',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  return { ok: true, remote: urlBase + remoteFilename }
}

/**
 * Run the website's deploy script (Astro build + FTP push).
 * mediapipeline's deploy script lives at <baseDir>/website/deploy-ftp.sh.
 * Other producers may pass a different deployScript path.
 *
 * @param {{ log?: function }} ctx
 * @param {{ baseDir?: string, deployScript?: string }} [opts]
 * @returns {boolean}
 */
export function deployWebsite (ctx, opts = {}) {
  const log = (ctx && ctx.log) || (() => {})
  const deployScript = opts.deployScript || (opts.baseDir + '/website/deploy-ftp.sh')
  const cwd          = opts.cwd || (opts.baseDir + '/website')

  if (!existsSync(deployScript)) {
    log('warn', '[website-publish] deploy script not found, skipping', { deployScript })
    return false
  }
  try {
    log('info', '[website-publish] running deploy script...', { deployScript })
    execFileSync('bash', [deployScript], { stdio: 'inherit', cwd })
    log('info', '[website-publish] deploy complete')
    return true
  } catch (err) {
    log('warn', '[website-publish] deploy failed (non-blocking)', { err: err.message })
    return false
  }
}
