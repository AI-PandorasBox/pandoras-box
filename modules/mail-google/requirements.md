# mail-google -- Requirements

## Google Cloud Project

1. Go to console.cloud.google.com
2. Create a new project for this company
3. Enable APIs: Gmail API, Google Calendar API (if calendar module used), Google Drive API (if files module used)

## OAuth Credentials

1. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
2. Application type: Desktop app
3. Download the JSON -- extract `client_id` and `client_secret`

## Required OAuth Scopes

| Scope | Purpose |
|-------|---------|
| https://www.googleapis.com/auth/gmail.modify | Read and manage email |
| https://www.googleapis.com/auth/gmail.send | Send email |
| https://www.googleapis.com/auth/calendar | Required if calendar module used |
| https://www.googleapis.com/auth/drive | Required if files module used |

## OAuth Consent Screen

Set to "Internal" if the account belongs to a Google Workspace organisation.
If "External", tokens expire after 7 days unless the project is published.
