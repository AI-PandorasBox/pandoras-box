# relay-whatsapp -- Requirements

| Requirement | Value |
|-------------|-------|
| WhatsApp account | Required (used for the relay) |
| Node.js 18+ | Required |
| whatsapp-web.js | Installed by the script |
| Terms of Service | Review before use: whatsapp.com/legal/terms-of-service |

## Authentication

On first run, a QR code is displayed in the conductor log. Scan it with WhatsApp on
your phone (WhatsApp -> Linked Devices -> Link a Device). The session is then stored
locally and re-used until it expires or is logged out.
