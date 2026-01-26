# UGC Finder for 21Draw

Automated Instagram scraping workflow to discover UGC creators for 21Draw's art education platform.

[![n8n](https://img.shields.io/badge/n8n-workflow-orange)](https://n8n.io)
[![Claude](https://img.shields.io/badge/Claude-AI-blue)](https://anthropic.com)
[![Supabase](https://img.shields.io/badge/Supabase-database-green)](https://supabase.com)

---

## 🎯 What It Does

1. **Scrapes** tagged posts from art education competitors (Proko, Marc Brunet, etc.)
2. **Filters** creators by follower count and video content
3. **Analyzes** profiles using Claude AI for niche relevance and engagement quality
4. **Outputs** qualified leads to Google Sheets for manual review

---

## 🚀 Quick Start

```bash
# 1. Import workflow into n8n
# Upload: workflows/UGC_Finder_v2_Fixed.json

# 2. Run Supabase schema
# Execute: supabase_schema_v2.sql

# 3. Configure credentials in n8n
# - Apify API (HTTP Query Auth)
# - Anthropic API (HTTP Header Auth)  
# - Supabase
# - Google Sheets OAuth

# 4. Test run
# Set POSTS_PER_COMPETITOR = 3 and execute
```

---

## 📁 Files

```
├── workflows/
│   └── UGC_Finder_v2_Fixed.json    # Main n8n workflow
├── docs/
│   ├── UGC_FINDER.md               # Full documentation
│   ├── SETUP.md                    # Setup guide
│   └── CHANGELOG.md                # Version history
├── supabase_schema_v2.sql          # Database schema
└── README.md                       # This file
```

---

## 📊 Output

The workflow outputs to:

1. **Supabase** - `profiles` table with all data
2. **Google Sheets** - Formatted for manual review

### Google Sheet Columns
| Handle | Followers | Engagement % | Profile Score | Priority | Top Videos | Status |
|--------|-----------|--------------|---------------|----------|------------|--------|

---

## ⚙️ Configuration

Edit the **Settings** node in n8n:

```javascript
const COMPETITORS = [
  'prokotv',        // Proko
  'marcbrunet',     // Marc Brunet
  'sinixdesign',    // Sinix
  'ethanmbecker',   // Ethan Becker
  'rossdraws'       // Ross Tran
];

const POSTS_PER_COMPETITOR = 10;
const MIN_FOLLOWERS = 5000;
const MAX_FOLLOWERS = 100000;
```

---

## 💡 Important Notes

### Claude AI Limitations
Claude analyzes **text data only** (bio, captions, hashtags). It **cannot**:
- Watch videos
- Hear audio
- Assess speaking ability

All recommendations require **manual video review**.

### Cost Estimate
~$5.50 per run (50 profiles):
- Apify: ~$4.25
- Claude: ~$1.25

---

## 📖 Documentation

- [Full Documentation](docs/UGC_FINDER.md)
- [Setup Guide](docs/SETUP.md)
- [Changelog](docs/CHANGELOG.md)
- [Notion Docs](https://www.notion.so/2f45ed39b54f81d68f3edf707773bf0b)

---

## 🔗 Links

- **Google Sheet:** [21Draw UGC Candidates](https://docs.google.com/spreadsheets/d/1HqsIaxnz3elGDOAd4njxkUkFqF-OBljY-bkYWMtdWvM/edit)
- **n8n:** [n8n.io](https://n8n.io)
- **Apify:** [apify.com](https://apify.com)

---

## 📝 Version

**Current:** v2.0.0 (2026-01-26)

See [CHANGELOG.md](docs/CHANGELOG.md) for version history.
