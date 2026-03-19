# Gmail Integration Setup

This guide sets up Gmail OAuth so CACC Writer can send emails on your behalf (as crescicharles@gmail.com).

## Prerequisites

- Google account: **crescicharles@gmail.com**
- `googleapis` npm package (installed with Google Sheets: `npm install googleapis`)

---

## Step 1: Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select (or create) the **"CACC Writer"** project — same one used for Google Sheets
3. If creating new: click **New Project** → name it "CACC Writer" → Create

---

## Step 2: Enable Gmail API

1. In the left sidebar → **APIs & Services** → **Library**
2. Search for **"Gmail API"**
3. Click **Gmail API** → **Enable**

---

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - User type: **External** (or Internal if using Google Workspace)
   - App name: **CACC Writer**
   - Support email: crescicharles@gmail.com
   - Add scope: `https://www.googleapis.com/auth/gmail.send`
   - Add test user: crescicharles@gmail.com
4. Back in Create OAuth client ID:
   - Application type: **Web application**
   - Name: **CACC Writer Gmail**
   - Authorized redirect URIs: `http://localhost:5178/api/gmail/callback`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

---

## Step 4: Add to .env

Open `.env` in the cacc-writer folder and add:

```
GMAIL_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret-here
```

Restart the server after saving.

---

## Step 5: Authorize in the App

1. Go to CACC Writer → **System** tab
2. Find the **Gmail Integration** card
3. Click **Connect Gmail** (opens Google consent screen)
4. Sign in as crescicharles@gmail.com
5. Grant permission to send email
6. You'll see "✅ Gmail Connected!" — done!

---

## Usage

Once connected, you can:

- **From the app**: Use the Gmail card on the System tab
- **Via Telegram**: Say "send an email to X about Y" — the assistant will draft and send it
- **Templates**: Common appraisal emails (inspection requests, report delivery, etc.) are pre-built

### Available Templates

| Template | Description | Params |
|---|---|---|
| `inspectionRequest` | Schedule property inspection | borrower, address, phone |
| `reportDelivery` | Deliver completed report | clientName, address, value |
| `mredApiRequest` | Request MRED API credentials | (none) |
| `orderFollowUp` | Follow up on appraisal order | clientName, address, orderDate |
| `infoRequest` | Request additional info/docs | clientName, address, itemsNeeded |

---

## Security Notes

- Only `gmail.send` scope is requested — the app cannot read your email
- Token is saved locally at `credentials/gmail-token.json`
- Tokens auto-refresh when expired
- Click **Disconnect** in the System tab to revoke access

---

## Troubleshooting

**"Gmail not configured"** — GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not in .env  
**"Access blocked: App not verified"** — Add yourself as a test user in OAuth consent screen  
**Token expired / refresh fails** — Click Disconnect then Connect Gmail again  
**"googleapis not found"** — Run `npm install googleapis` in the cacc-writer folder
