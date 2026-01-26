# UGC Finder Setup Guide

Step-by-step instructions to get the UGC Finder workflow running.

---

## Prerequisites

- [ ] n8n instance (cloud or self-hosted)
- [ ] Apify account with API key and credits
- [ ] Anthropic API key with credits
- [ ] Supabase project
- [ ] Google account with Sheets access

---

## Step 1: Import Workflow into n8n

### Option A: Via n8n UI (Recommended)
1. Open your n8n instance
2. Click **"Add Workflow"** → **"Import from File"**
3. Select `/workflows/UGC_Finder_v2_Fixed.json`
4. Workflow will appear with red nodes (credentials needed)

### Option B: Via n8n API
```bash
curl -X POST "https://your-n8n-instance/api/v1/workflows" \
  -H "X-N8N-API-KEY: your-api-key" \
  -H "Content-Type: application/json" \
  -d @workflows/UGC_Finder_v2_Fixed.json
```

---

## Step 2: Configure Credentials

### 2.1 Apify API

1. Go to [Apify Console](https://console.apify.com/account/integrations)
2. Copy your **API token**
3. In n8n: **Settings** → **Credentials** → **Add Credential**
4. Select **"HTTP Query Auth"**
5. Configure:
   - **Name:** `Apify account`
   - **Parameter Name:** `token`
   - **Value:** Your API token

### 2.2 Anthropic API

1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create or copy your **API key**
3. In n8n: **Settings** → **Credentials** → **Add Credential**
4. Select **"HTTP Header Auth"**
5. Configure:
   - **Name:** `Anthropic API Key`
   - **Header Name:** `x-api-key`
   - **Value:** Your API key

### 2.3 Supabase

1. Go to your Supabase project → **Settings** → **API**
2. Copy **Project URL** and **anon/public key**
3. In n8n: **Settings** → **Credentials** → **Add Credential**
4. Select **"Supabase API"**
5. Configure:
   - **Host:** Your project URL (e.g., `https://xxxxx.supabase.co`)
   - **API Key:** Your anon key

### 2.4 Google Sheets

1. In n8n: **Settings** → **Credentials** → **Add Credential**
2. Select **"Google Sheets OAuth2 API"**
3. Follow the OAuth flow to connect your Google account
4. Grant access to Google Sheets

---

## Step 3: Create Database Table

1. Open your Supabase project
2. Go to **SQL Editor**
3. Copy and paste the contents of `/supabase_schema_v2.sql`
4. Click **Run**
5. Verify table created: **Table Editor** → `profiles`

---

## Step 4: Prepare Google Sheet

### Option A: Use Existing Sheet
The workflow is configured for: [21Draw UGC Candidates](https://docs.google.com/spreadsheets/d/1HqsIaxnz3elGDOAd4njxkUkFqF-OBljY-bkYWMtdWvM/edit)

Update the sheet ID in the Sheets node if using a different sheet.

### Option B: Create New Sheet
Create a new Google Sheet with these column headers in Row 1:

```
Handle | Followers | Engagement % | Profile Score | Niche Score | Engagement Score | Style | Art Content | Avg Duration | Source | Top Video 1 | Top Video 2 | Top Video 3 | AI Notes | Review Notes | Priority | Status | Date Added
```

Then update the Sheets node with your new sheet ID.

---

## Step 5: Connect Credentials to Nodes

After importing, you need to assign credentials to each node:

| Node | Credential Type | Credential Name |
|------|-----------------|-----------------|
| Apify: Tagged Posts | HTTP Query Auth | Apify account |
| Apify: Profile | HTTP Query Auth | Apify account |
| Claude Analysis | HTTP Header Auth | Anthropic API Key |
| Check DB | Supabase API | Supabase account |
| Save DB | Supabase API | Supabase account |
| Sheets | Google Sheets OAuth2 | Google Sheets account |

Click each node → **Credentials** → Select the appropriate credential.

---

## Step 6: Test Run

### 6.1 Configure for Testing
Edit the **Settings** node:

```javascript
const COMPETITORS = ['prokotv'];  // Just one competitor
const POSTS_PER_COMPETITOR = 3;    // Minimal posts
```

### 6.2 Execute
1. Click **"Execute Workflow"**
2. Watch each node execute
3. Check for errors (red nodes)

### 6.3 Verify Output
- **Supabase:** Check `profiles` table for new records
- **Google Sheets:** Check for new rows
- **Console:** Check for any logged errors

---

## Step 7: Production Configuration

Once testing passes, update Settings for production:

```javascript
const COMPETITORS = [
  'prokotv',
  'marcbrunet', 
  'sinixdesign',
  'ethanmbecker',
  'rossdraws'
];
const POSTS_PER_COMPETITOR = 10;
```

---

## Troubleshooting

### "Authentication failed" on Apify
- Verify API token is correct
- Check Apify account has credits
- Ensure token has correct permissions

### "401 Unauthorized" on Claude
- Verify API key is correct
- Check header name is exactly `x-api-key`
- Ensure Anthropic account has credits

### "Connection refused" on Supabase
- Verify project URL is correct (include `https://`)
- Check anon key is correct
- Verify `profiles` table exists

### "Permission denied" on Google Sheets
- Re-authenticate OAuth connection
- Verify sheet is shared with your Google account
- Check sheet ID is correct in node

### "No data returned" from Apify
- Verify competitor username exists
- Check competitor has tagged posts
- Try different competitor

---

## Scheduling (Optional)

To run automatically:

1. Replace **Start** node with **Schedule Trigger**
2. Configure schedule (e.g., weekly on Monday 9am)
3. Activate workflow

---

## Support

- **n8n Community:** community.n8n.io
- **Apify Docs:** docs.apify.com
- **Anthropic Docs:** docs.anthropic.com
- **Supabase Docs:** supabase.com/docs
