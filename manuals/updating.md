# Updating Pandora's Box

Your install checks for updates once a week and shows a desktop notification when
a new release is available. The dashboard's **Update** card also shows the current
and latest version. Updates are never applied automatically — you choose when.

## Commands

The installer puts `pbox-update` on your PATH (it lives at
`<install>/scripts/pbox-update.sh`).

```bash
pbox-update --check-only     # check for a new release; no changes
pbox-update --apply          # download, verify, back up, and install the latest
pbox-update                  # same as --apply
pbox-update --rollback       # restore the most recent pre-update backup
pbox-update --rollback <ts>  # restore a specific backup (timestamp)
```

## What `--apply` does

1. Fetches the latest GitHub release tarball.
2. **Verifies its SHA256 against the release's published `SHA256SUMS`.** If the
   release has no checksums, or they do not match, the update **aborts** — an
   unverified tarball is never installed.
3. Backs up your current install to `<install>-rollback-<timestamp>` (your
   `data/`, `store/`, and `.env` are preserved across the swap).
4. Installs the new version in place and updates the `VERSION` anchor.
5. Logs the upgrade. If anything looks wrong, `pbox-update --rollback`.

## Notes

- The dashboard is localhost-only and read-only; it shows the command rather than
  applying updates from the browser, so nothing on your machine can trigger an
  install without you running it.
- Clone-from-source installs anchor to the latest published release so update
  checks still notify you.
- A `GET /api/update-status` endpoint on the dashboard returns the current/latest
  JSON if you want to script around it.
