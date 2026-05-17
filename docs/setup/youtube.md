# Setup — YouTube (the Media Production Pipeline publishing)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

The the Media Production Pipeline module can upload videos to a YouTube channel you own, with full metadata (title, description, tags, thumbnail). Setup is a one-time OAuth flow per channel.

## Prerequisites

- A YouTube channel you own (or have upload rights to via a Brand Account).
- Access to Google Cloud Console at https://console.cloud.google.com.

## Setup steps

### 1. Create a Google Cloud project (or reuse one)

If you already created a project for `setup-google-ai.md`, reuse it. Otherwise: https://console.cloud.google.com → new project → name it `Pandora's Box`.

### 2. Enable the YouTube Data API v3

In the project: APIs & Services → Library → search "YouTube Data API v3" → Enable.

### 3. Configure OAuth consent screen

APIs & Services → OAuth consent screen.

- **User type**: External (for personal accounts) or Internal (for Workspace).
- **App name**: `Pandora's Box — the Media Production Pipeline`
- **User support email**: your address
- **Developer contact**: your address
- **Scopes**: add the YouTube upload scope `https://www.googleapis.com/auth/youtube.upload`
- **Test users**: add your Google account (required for External apps in testing mode)

Save. If you're on External + Testing, you can use the app for ~100 days before needing to publish or verify it — for personal use that's usually fine.

### 4. Create OAuth credentials (Desktop app)

APIs & Services → Credentials → Create Credentials → OAuth client ID.

- **Application type**: Desktop app
- **Name**: `Pandora's Box CLI`
- Click Create.

Download the `client_secret_<long-string>.json` file. Save it temporarily.

### 5. Run the the Media Production Pipeline auth helper

The installer copies the JSON to the right place and starts the auth flow:

```
sudo bash /opt/pandoras-box/scripts/setup-youtube-oauth.sh ~/Downloads/client_secret_*.json
```

This prints a URL. Open it in a browser → sign in to YouTube → grant the upload scope. The CLI captures the token and writes a refresh token to:

```
/opt/pandoras-box/media-production/store/youtube-refresh-token.json
```

### 6. Verify

Ask your Personal AI:

```
media-production: upload the test video to my channel
```

the Media Production Pipeline (if installed) uses the test asset under `media-production/assets/test-upload.mp4`. You should see the new video appear in YouTube Studio (often as private by default — that's expected).

## Multi-channel scenarios

the Media Production Pipeline supports multiple channels per install. Re-run the setup helper with a different `client_secret_*.json` for each channel. The installer prompts you to label each channel.

## Cost

The YouTube Data API has a daily quota (10,000 units by default). Each upload costs 1,600 units. Worst-case: ~6 uploads/day before hitting quota. the Media Production Pipeline batches uploads to stay under this.

## Revoking access

Sign in to your Google account → https://myaccount.google.com/permissions → find "Pandora's Box — the Media Production Pipeline" → Revoke. Then delete `youtube-refresh-token.json`:

```
sudo rm /opt/pandoras-box/media-production/store/youtube-refresh-token.json
```

the Media Production Pipeline stops uploading until you re-auth.
