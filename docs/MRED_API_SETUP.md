# MRED API Setup Guide

Connect Appraisal Agent to MRED (connectMLS) for live comp searches directly from the app.

---

## Step 1: Request API Credentials

Email **retssupport@mredllc.com** with the subject line:

> **API Access Request - Appraiser**

Include in the body:
- Your name and company (Charles Cresci, Cresci Appraisal & Consulting Company)
- That you need RESO Web API access for appraisal purposes
- Your redirect URI: **`http://localhost:5178/api/mred/callback`**

They typically respond within **3 business days** with your Client ID and Client Secret.

Phone: **(630) 955-2755** if you need to follow up.

---

## Step 2: Add Credentials to .env

Once you receive credentials, add these to your `.env` file:

```env
MRED_CLIENT_ID=your_client_id_here
MRED_CLIENT_SECRET=your_client_secret_here
```

---

## Step 3: Authorize the App

1. Start Appraisal Agent (`npm start`)
2. Go to the **System** tab
3. Find the **MRED Integration** card
4. Click **ðŸ”´ Connect MRED**
5. A browser window opens â†’ log in with your MRED credentials â†’ click Allow
6. You're redirected back to the app automatically
7. Status changes to **ðŸŸ¢ Connected**

The access token is saved to `data/mred-token.json` and used automatically.

---

## How It Works

### OAuth 2.0 / OpenID Connect Flow
1. You click "Connect MRED" â†’ app opens the MRED authorize URL
2. You log in at MRED's site â†’ MRED redirects to `http://localhost:5178/api/mred/callback?code=...`
3. App exchanges the code for an access token
4. Token saved locally â€” you stay connected until it expires

### Live Comp Search
Once connected, from any case workspace:
- Click **Search Comps** in the Comps section
- Enter search criteria (price range, GLA, city, beds)
- Results load directly from MRED's live database
- Select comps to import into your case

### RESO API Endpoints
- **Base:** `https://connectmls-api.mredllc.com/reso/odata`
- **Authorize:** `https://connectmls-api.mredllc.com/oid/authorize`
- **Token:** `https://connectmls-api.mredllc.com/oid/token`
- **Protocol:** OData queries
- **Example:** `GET /reso/odata/Property?$filter=MlsStatus eq 'Closed' and City eq 'Bloomington'`

---

## CSV Export (Alternative â€” No API Key Needed)

Until you have API credentials, export comp searches from MRED as CSV:

1. In connectMLS, run your comp search
2. Select all results â†’ **Export â†’ CSV**
3. In Appraisal Agent, go to a case â†’ **Comps** section â†’ **Upload MRED CSV**
4. Comps are parsed and saved to the case automatically

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Not connected" after authorizing | Check `MRED_CLIENT_ID` is in `.env` and matches what MRED issued |
| Token expired | Click "Connect MRED" again to re-authorize |
| Redirect fails | Confirm the redirect URI you gave MRED matches exactly: `http://localhost:5178/api/mred/callback` |
| 401 errors on searches | Token expired â€” reconnect |
| No results returned | Try widening search criteria (price range, date range, city) |

---

## Security Notes

- `data/mred-token.json` is in `.gitignore` â€” never committed
- Your MRED credentials only access MRED data â€” not the rest of your system
- To disconnect: System tab â†’ **Disconnect MRED** (clears the token file)

