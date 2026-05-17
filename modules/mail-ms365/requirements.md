# mail-ms365 -- Requirements

## Azure App Registration

1. Go to portal.azure.com -> App registrations -> New registration
2. Name: "Your AI System ([company name])"
3. Supported account types: "Accounts in this organizational directory only"
4. After registration, note the Application (client) ID and Directory (tenant) ID

## Required API Permissions (Microsoft Graph, Application type)

| Permission | Purpose |
|-----------|---------|
| Mail.ReadWrite | Read and organise email |
| Mail.Send | Send email on behalf of the account |
| Calendars.ReadWrite | Required if calendar module is also used |
| Files.ReadWrite.All | Required if files module is also used |

Click "Grant admin consent" after adding permissions.

## Client Secret

Go to Certificates & secrets -> New client secret.
Set expiry to 24 months. Copy the Value immediately (shown once only).

## Token Cache Permissions

The token cache file is stored at:
`/opt/pandoras-box/[company]/store/ms365-auth/.token-cache.json`

Permissions: `640` (owner: service account, readable by admin group)
