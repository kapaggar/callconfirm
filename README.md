# 🧘 Vipassana Call Tracker + DIPI Scraper

Personal PWA for Dhamma Sudha course attendance confirmation calls.

## Files

```
index.html      ← Call Tracker app (PWA)
scraper.js      ← DIPI scraper (loaded by bookmarklet)
setup.html      ← One-time bookmarklet installer
manifest.json   ← PWA config
sw.js           ← Offline support
```

## Deploy

```bash
gh repo create callconfirm --public --clone
cd callconfirm
# Copy all 5 files here
git add -A && git commit -m "init" && git push
# Settings → Pages → Source: main, root → Save
```

Live at: `https://kapaggar.github.io/callconfirm/`

## Setup (one-time)

1. Open `.../callconfirm/setup.html` on your phone
2. Copy the bookmarklet → save as a Safari bookmark

## Usage

**Tap 1:** Open any DIPI page → tap "DIPI Scraper" bookmark
→ Shows upcoming Dhamma Sudha courses → pick one → navigates to search page

**Tap 2:** Tap bookmark again on search results
→ Scrapes all applicants (Expected + Confirmed) with phone numbers
→ "Open Tracker" → start calling
