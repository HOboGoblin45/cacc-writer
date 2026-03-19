# Google Sheets Integration — Setup Guide

This guide walks you through connecting CACC Writer to your Google Sheet so new appraisal jobs are automatically logged.

**Sheet ID:** `1at6WdnjEZ6fyauC-IsoSGO2TQWDUirgbZ9WlQPIntEU`

---

## Prerequisites

Before starting, make sure `googleapis` is installed:

```bash
npm install googleapis
```

---

## Step-by-Step Setup

### 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top → **New Project**
3. Name it `CACC Writer` → click **Create**
4. Wait for it to be created, then select it from the project dropdown

### 2. Enable the Google Sheets API

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for `Google Sheets API`
3. Click it → click **Enable**

### 3. Create a Service Account

1. In the left sidebar, go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → Service Account**
3. Name: `cacc-writer-sheets` (any name is fine)
4. Click **Create and Continue** → skip role assignment → click **Done**

### 4. Download the Service Account Key

1. On the Credentials page, find your new service account under "Service Accounts"
2. Click the service account name to open it
3. Go to the **Keys** tab
4. Click **Add Key → Create new key → JSON** → click **Create**
5. A JSON file downloads automatically — save it as:
   ```
   credentials/google-service-account.json
   ```
   (inside the cacc-writer project folder)

> ⚠️ **Never commit this file to git.** The `credentials/` folder is already in `.gitignore`.

### 5. Share Your Spreadsheet with the Service Account

1. Open the downloaded JSON file, find the `client_email` field — it looks like:
   ```
   cacc-writer-sheets@cacc-writer-xxxxx.iam.gserviceaccount.com
   ```
2. Open your Google Sheet: `https://docs.google.com/spreadsheets/d/1at6WdnjEZ6fyauC-IsoSGO2TQWDUirgbZ9WlQPIntEU`
3. Click **Share** (top right)
4. Paste the `client_email` address
5. Set permission to **Editor**
6. Click **Send** (ignore the "can't notify" warning)

### 6. Set Up the Sheet Header Row

In your Google Sheet, make sure row 1 has these headers (in this exact order):

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Date | Order ID | Borrower | Address | Form Type | Fee | Lender | Transaction Type | Delivery Date | Pipeline Stage |

> If the sheet is empty, CACC Writer will write to row 1 automatically. You may want to add the header manually first.

### 7. Add Environment Variables to `.env`

Add these lines to your `.env` file (already done for Sheet ID):

```env
GOOGLE_SHEET_ID=1at6WdnjEZ6fyauC-IsoSGO2TQWDUirgbZ9WlQPIntEU
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/google-service-account.json
```

---

## How It Works

- **Every new order intake** (PDF or XML) automatically logs a row to the sheet
- **CSV backup** at `data/job-log.csv` always runs, even without credentials
- If credentials aren't configured, intake still works — just logs to CSV only
- The **Pipeline Stage** column (J) updates as jobs move through the workflow

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `google-sheets:auth-failed` in logs | Check that `GOOGLE_SERVICE_ACCOUNT_PATH` points to the correct JSON file |
| `google-sheets:append-failed` | Make sure the sheet is shared with the `client_email` from your JSON |
| `googleapis not found` | Run `npm install googleapis` in the project folder |
| Rows appending to wrong sheet tab | Rename your sheet tab to `Appraisals` or `Sheet1` |

---

## Security Notes

- The `credentials/` folder is in `.gitignore` — the key file will never be committed
- The service account only has access to sheets you explicitly share with it
- You can revoke access anytime in Google Cloud Console → APIs & Services → Credentials
