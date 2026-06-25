# Pocket Clone

## What This Is
A personal read-it-later app replacing Pocket/Instapaper, hosted entirely on Firebase. Single user, no auth — private by obscurity via non-guessable URL.

## Architecture
1. **Telegram Bot → Cloud Function (webhook)** — drop a URL in Telegram, Cloud Function extracts URL, writes to Firestore with domain as temporary title. Returns 200 immediately with no outbound HTTP.
2. **Firestore-triggered enricher (`enrichLink`)** — fires on new document creation, fetches the real page title using Node 20 native `fetch`, updates the document. Decoupled from webhook to avoid timeouts.
3. **Firestore (database)** — each saved link is a document in the `links` collection.
4. **Firebase Hosting (frontend)** — static SPA reading from Firestore client-side, rendering links as a flat list.

## Firebase Project
- **Project name:** am-pocket-clone
- **Plan:** Blaze (pay-as-you-go, effectively $0/month at current usage)
- **Firestore location:** nam5
- **Cloud Functions region:** us-central1
- **Local project path:** `~/pocket-clone/`
- **Custom domain:** `pocket.akshaymijar.com`
- **Default hosting URL:** `am-pocket-clone.web.app`
- **GitHub repo:** `git@github.com:akshaymijar17/pocket.git` (private, SSH)
- **SSH key for GitHub:** `~/.ssh/pocket_key` (no passphrase)

## Firestore Data Model
Collection: `links/{auto-id}`

```json
{
  "url": "string — full URL",
  "title": "string — page title (falls back to domain if fetch fails)",
  "domain": "string — extracted hostname, e.g. 'nytimes.com'",
  "savedAt": "timestamp — when it was saved",
  "source": "'import' | 'telegram' | 'manual'",
  "folder": "'Unread' | 'Archive'",
  "isRead": "boolean — true if folder === 'Archive'",
  "tags": "string[] — empty for now"
}
```

## Firestore Rules
Read and write are open (acceptable for private single-user app):
```
allow read: if true;
allow write: if true;
```

## Cloud Functions

### telegramWebhook (HTTP, 2nd Gen)
- Receives POST from Telegram webhook
- Extracts first URL from message text via regex
- Writes to Firestore with domain as temporary title
- Returns 200 immediately — NO outbound HTTP calls
- Bot token stored as Firebase secret: `TELEGRAM_BOT_TOKEN`
- Auth: allows unauthenticated invocations (required for Telegram webhook)

### enrichLink (Firestore-triggered, 2nd Gen)
- Fires on `links/{linkId}` document creation
- Only processes documents where `source === "telegram"` and `title === domain`
- Fetches page title using Node 20 native `fetch` with 10s abort timeout
- Updates the document's `title` field
- Decodes HTML entities in titles

### Why this architecture?
The webhook and enricher were originally one function, but outbound HTTP from Cloud Functions caused consistent 60s timeouts (504s). Decoupling into two functions solved this — the webhook returns instantly, and the enricher runs async with no one waiting on it.

## Frontend
- Single `index.html` with inline CSS/JS
- Flat list layout — no cards, no thumbnails, registry/ledger aesthetic
- **IBM Plex Sans Light (300)** typeface, white/black minimalist interface
- Search across title and domain (real-time filtering)
- Domain filter dropdown (sorted by frequency)
- Folder toggle: unread / archive / all
- Mark as read/unread toggle per link (writes to Firestore)
- Click row to open link in new tab
- `/` keyboard shortcut to focus search
- Responsive down to mobile
- Firebase config: `config.js` (gitignored) for local dev, `/__/firebase/init.js` auto-init on Firebase Hosting

## Tech Stack
- No framework — vanilla JS with Firebase SDK (compat mode)
- Firebase client SDK for reads and writes
- Firebase Hosting (static)
- Cloud Functions: Node.js 20, firebase-functions v5, firebase-admin v12
- ESLint: minimal config (`.eslintrc.js` in `functions/`, NOT Google style guide)

## Project File Structure
```
~/pocket-clone/
├── import/                  # one-time import (done)
│   ├── import.js
│   ├── export.csv
│   ├── serviceAccountKey.json  # gitignored, NOT tracked
│   └── package.json
├── functions/               # Cloud Functions
│   ├── index.js             # webhook + enricher
│   ├── package.json
│   ├── package-lock.json
│   └── .eslintrc.js         # minimal config (dotfile, not visible in Finder)
├── public/                  # Frontend
│   ├── index.html           # main SPA
│   ├── config.js            # Firebase config (gitignored)
│   └── config.example.js    # blank template (checked in)
├── .gitignore
├── CLAUDE.md
├── firebase.json
├── firestore.rules
└── firestore.indexes.json
```

## .gitignore
```
public/config.js
import/serviceAccountKey.json
node_modules/
.firebase/
.DS_Store
```

## Deploy Commands
```bash
firebase serve --only hosting          # local dev
firebase deploy --only hosting         # push frontend
firebase deploy --only functions       # push cloud functions
firebase deploy --only firestore:rules # push rules
firebase functions:log --only telegramWebhook  # check webhook logs
firebase functions:log --only enrichLink       # check enricher logs
git add . && git commit -m "msg" && git push   # push to GitHub
```

## Git Push Notes
- Use SSH key: `GIT_SSH_COMMAND="ssh -i ~/.ssh/pocket_key" git push` if default SSH fails
- GitHub push protection blocks commits containing secrets — if `serviceAccountKey.json` ends up in a commit, squash with `git reset --soft origin/main` before pushing
- The service account key file must NEVER be committed

## Data Profile
- ~368 links total
- 362 imported from Instapaper CSV (source: "import", titles already populated)
- ~6 added via Telegram (source: "telegram")
- Some telegram-added links still have domain-only titles (from before enricher was deployed)
- Top domains: qz.com, nytimes.com, bbc.com, economist.com, theatlantic.com

## Design Direction
- Minimalist white/black — machine-optimized listing interface
- IBM Plex Sans Light (300) throughout, 400/500 for emphasis only
- Flat rows with hairline separators, no cards, no shadows
- Read items dim to gray
- Registry/ledger aesthetic — a reading list, not a feed

## Known Issues / Gotchas
- Cloud Functions on Firebase require Blaze plan and use Google Cloud infrastructure (IAM, Cloud Run, Eventarc, Secret Manager)
- 2nd gen Cloud Functions default to requiring authentication — must explicitly allow unauthenticated invocations for webhook
- ESLint config must be a dotfile (`.eslintrc.js`) — macOS Finder won't let you create dotfiles, use Terminal
- Node 20 is deprecated (Oct 30, 2026 deadline) — will need runtime upgrade eventually
- `enrichLink` uses Node 20 native `fetch` — raw `http/https` modules hung indefinitely in this environment
- Eventarc Service Agent needs explicit IAM permissions for Firestore-triggered functions

## Backlog / Future Ideas
- Backfill titles for existing telegram links where `title === domain`
- Tags / categorization
- Telegram bot confirmation reply (currently silent — saves without replying)
- Reading view / article extraction
