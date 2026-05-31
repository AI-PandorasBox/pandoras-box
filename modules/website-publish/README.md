# Website Publish

Publishes generated pages and assets to a website over FTP/SFTP. Credentials are per-site and never committed. Runs in dry-run until a live publish is explicitly authorised.

## Provides
- `website-publish`

## Requires
- `core`

## Configuration
- `SITE_FTP_HOST` — Target site FTP host
- `SITE_FTP_USER` — FTP user
- `SITE_FTP_PASS` — FTP password

## Enabling
Optional module. Ships disabled; enable per-agent in the activation matrix.
