// ${MODULE_HOME}/provider.mjs
//
// Shared website-publish provider: pushes a built site / asset to a configured
// deploy target over FTP. Caller passes ctx with log + env so this module is not
// coupled to any one producer's globals. Any producer that needs to publish a
// built site can import from here.

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Resolve lftp at runtime so this works across macOS (Homebrew) and Linux.
function resolveBin (name, fallback) {
  try {
    return execFileSync('command', ['-v', name], { shell: true }).toString().trim() || fallback
  } catch {
    return fallback
  }
}
const LFTP_BIN = process.env.PBOX_LFTP_BIN || resolveBin('lftp', 'lftp')

/**
 * FTP push of a single MP3 to a remote dir.
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

  const host = opts.host || env.WEBSITE_PUBLISH_FTP_HOST
  const user = opts.user || env.WEBSITE_PUBLISH_FTP_USER
  const pass = opts.password || env.WEBSITE_PUBLISH_FTP_PASSWORD
  if (!host || !user || !pass) throw new Error('FTP host/user/password not configured (opts or WEBSITE_PUBLISH_FTP_* env)')

  const remoteDir = opts.remoteDir || ((env.WEBSITE_PUBLISH_FTP_REMOTE_DIR || '/public_html') + '/mp3')
  const urlBase   = opts.returnUrlBase || 'https://example.com/mp3/'

  execFileSync(LFTP_BIN, [
    '-u', user + ',' + pass,
    host,
    '-e', 'mkdir -p ' + remoteDir + '; put ' + mp3Path + ' -o ' + remoteDir + '/' + remoteFilename + '; bye',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  return { ok: true, remote: urlBase + remoteFilename }
}

/**
 * Run the website's deploy script (site build + FTP push).
 * By default the deploy script is expected at <baseDir>/website/deploy-ftp.sh.
 * A producer may pass a different deployScript path.
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
