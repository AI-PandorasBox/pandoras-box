# Release signing

Pandora's Box release artifacts are signed with an ed25519 SSH key. Each release
ships a `SHA256SUMS` manifest and an `SHA256SUMS.sig` detached signature.

Verify a download:

```
bash scripts/verify-release.sh /path/to/release-dir
```

This checks the signature (key in `scripts/allowed_signers`, namespace `pbox-release`)
then the SHA-256 checksums. Commits and tags in this repository are also SSH-signed
and show GitHub's "Verified" badge.
