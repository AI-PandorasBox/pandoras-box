# browser-actions requirements

- **Node 22+**.
- **Playwright** + a **Chromium** build (the installer runs
  `npm install playwright` + `npx playwright install chromium`; ~150 MB).
- A **domain allowlist** (`BROWSER_ACTIONS_ALLOWLIST`) — navigation is denied
  until you set it.

Local headless browser; no cloud service or API key. The only network egress is
the sites you allowlist.
