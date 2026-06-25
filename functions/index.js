const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { URL } = require("url");

admin.initializeApp();
const db = admin.firestore();

const BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

// ── Webhook — fast, no outbound HTTP ─────────────────────

exports.telegramWebhook = onRequest(
  { secrets: [BOT_TOKEN], region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(200).send("ok");

    const message = req.body?.message;
    if (!message?.text) return res.status(200).send("ok");

    const text = message.text.trim();
    const match = text.match(/https?:\/\/[^\s]+/);
    if (!match) return res.status(200).send("ok");

    const url = match[0];

    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, "");

      await db.collection("links").add({
        url,
        title: domain,
        domain,
        savedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "telegram",
        folder: "Unread",
        isRead: false,
        tags: [],
      });
    } catch (err) {
      console.error("Save failed:", err);
    }

    return res.status(200).send("ok");
  }
);

// ── Enricher — runs async after document is created ──────

exports.enrichLink = onDocumentCreated(
  { document: "links/{linkId}", region: "us-central1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (data.source !== "telegram" || data.title !== data.domain) return;

    const title = await fetchTitle(data.url);
    if (title && title !== data.domain) {
      await snap.ref.update({ title });
      console.log(`Enriched: ${data.domain} → ${title}`);
    } else {
      console.log(`No title found for ${data.url}`);
    }
  }
);

// ── Title fetcher using native fetch (Node 20) ──────────

async function fetchTitle(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? decodeEntities(m[1].trim().replace(/\s+/g, " ")) : null;
  } catch (err) {
    console.error("fetchTitle error:", err.message);
    return null;
  }
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}