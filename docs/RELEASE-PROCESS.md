# Release process

Releases are built and signed by the GitHub Actions **Release** workflow
(`.github/workflows/release.yml`), triggered by pushing a `vX.Y.Z` tag.

## What the workflow does

1. Validates `modules/registry.json`.
2. Builds the installer tarball `pandoras-box-installer-<tag>.tar.gz` and a
   `SHA256SUMS` file.
3. **Signs** `SHA256SUMS` with the release key (SSH signature, namespace
   `pbox-release`) producing `SHA256SUMS.sig` -- only if the
   `RELEASE_SIGNING_KEY` secret is set (see below).
4. Publishes the tarball + `SHA256SUMS` + `SHA256SUMS.sig` as a GitHub Release.

## One-time signing-key setup

The release is signed with an ed25519 SSH key whose **public** half is listed in
[`scripts/allowed_signers`](../scripts/allowed_signers) under the identity
`zeus@ai-pandorasbox.co.uk`, namespace `pbox-release`.

To enable signed releases:

1. Generate (or reuse) the release keypair:
   ```bash
   ssh-keygen -t ed25519 -C "zeus@ai-pandorasbox.co.uk" -f pbox-release-key
   ```
2. Add the **public** key line to `scripts/allowed_signers` (if not already there):
   ```
   zeus@ai-pandorasbox.co.uk namespaces="pbox-release" ssh-ed25519 AAAA... 
   ```
3. Store the **private** key as a repo/org Actions secret named
   `RELEASE_SIGNING_KEY` (paste the full private key including the BEGIN/END
   lines). The workflow reads it only in memory and deletes it after signing.

If the secret is absent, releases still build and ship -- with checksums only,
no signature. The installer falls back to checksum-only verification in that case.

## Verifying a release (what users do)

```bash
# in the extracted release dir, with SHA256SUMS + SHA256SUMS.sig present:
bash scripts/verify-release.sh .
```

This checks the SSH signature against `scripts/allowed_signers` and then the
SHA256 checksums. The curl one-liner installer performs the same check
automatically when a `.sig` is published.

## Rotating / adding a signer

Add the new public key as an extra line in `scripts/allowed_signers` (multiple
signers are allowed -- any one valid signature verifies). Update the
`RELEASE_SIGNING_KEY` secret to the matching private key. Old signatures made by
a still-listed key continue to verify; remove a key's line to revoke it.
