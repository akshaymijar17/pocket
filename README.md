# Pocket Clone

Mozilla killed my beloved Pocket sometime in late 2025. I'd been a loyal user since 2014 — it was one of the apps I used most on my phone. I'd drop copious amounts of links through the weeks, things I found interesting, things I wanted to archive for later. Over time, that list became a thing. It became a personal directory of ideas that expanded how I think.

I didn't like the alternatives. Instapaper felt dated, and I didn't want to pay for what is fundamentally a simple link management service.

So I built my own.

## What This Is

A personal, cross-platform read-it-later app. Instead of listing it on the App Store, I use a Telegram bot as the input layer — I drop a link in a chat, and it shows up in my reading list hosted on Firebase. Works from my phone, works from my browser, works from anywhere Telegram runs.

Built in an afternoon with Claude.

## How It Works

1. **Save a link** — send any URL to my Telegram bot
2. **Webhook** — a Cloud Function picks up the message, extracts the URL, and writes it to Firestore
3. **Enrichment** — a second Cloud Function fires async, fetches the page title, and updates the entry
4. **Read** — a minimal frontend at `pocket.akshaymijar.com` renders the full list with search, filtering, and read/unread toggling

## Stack

- Firebase Hosting (static SPA)
- Cloud Firestore (database)
- Cloud Functions (Telegram webhook + async title enricher)
- Telegram Bot API (input layer)
- Vanilla JS
  
## Design

Minimalist white/black interface. IBM Plex Sans Light. Flat rows with hairline separators.
