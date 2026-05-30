# browser-actions

A full interactive browser surface your agents can drive: navigate, read, click,
type, and screenshot — backed by a **local headless Chromium** (Playwright). It
runs on localhost only and is bounded by three controls:

1. **Token** — every action needs the `x-pbox-token` header (a secret generated
   at install, stored in the module `.env`, chmod 600).
2. **Domain allowlist** — navigation is **denied by default**; only hosts in
   `BROWSER_ACTIONS_ALLOWLIST` are reachable.
3. **Audit** — every action is logged to `store/browser-audit.log`.

> Pages are untrusted. Text the browser returns can contain prompt-injection;
> the calling agent must treat it as data, and Argus / the content-classifier
> should review browser-derived content.

## Install

```bash
bash modules/browser-actions/install.sh   # installs Playwright + Chromium, generates a token
# then set the allowed domains:
#   echo 'BROWSER_ACTIONS_ALLOWLIST=example.com,wikipedia.org' >> <install>/browser-actions/.env
#   sudo launchctl kickstart -k system/com.pandoras-box.browser-actions   (or reload the plist)
```

## API (localhost:8483, header `x-pbox-token`)

```
POST /session
POST /navigate   {"url":"https://example.com"}     # allowlisted hosts only
POST /read       {"selector":"main"}                # omit selector for full body text
POST /click      {"selector":"text=Sign in"}
POST /type       {"selector":"#q","text":"hello","submit":true}
POST /screenshot {"full":true}                      # -> { path }
GET  /healthz
```

## Notes

- Local + offline (no cloud). Headless by default; `BROWSER_ACTIONS_HEADLESS=false` to watch it.
- This is the public, self-contained implementation of the browser capability
  (a single local Chromium), not the multi-machine queue/driver model.
