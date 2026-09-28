const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { URL } = require("url");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const INGEST_TOKEN = defineSecret("INGEST_TOKEN");

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

// ── Agent ingest — add-only API for personal agents ─────
//
// Any agent (e.g. Muse) can add a link by POSTing:
//   POST https://<region>-<project>.cloudfunctions.net/addLink
//   Authorization: Bearer <INGEST_TOKEN>
//   Content-Type: application/json
//   { "url": "https://example.com/article", "title": "optional" }
//
// This surface is add-only: it can create links but never read,
// update, or delete them. Rotate INGEST_TOKEN to revoke access.

exports.addLink = onRequest(
  { secrets: [INGEST_TOKEN], region: "us-central1", cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method not allowed" });
    }

    if (!tokenIsValid(req.get("authorization"), INGEST_TOKEN.value())) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!rawUrl) {
      return res.status(400).json({ error: "missing url" });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      return res.status(400).json({ error: "invalid url" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ error: "url must be http(s)" });
    }

    const domain = parsed.hostname.replace(/^www\./, "");
    const providedTitle =
      typeof req.body?.title === "string" ? req.body.title.trim() : "";

    try {
      const ref = await db.collection("links").add({
        url: parsed.href,
        title: providedTitle || domain,
        domain,
        savedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "agent",
        folder: "Unread",
        isRead: false,
        tags: [],
      });
      return res.status(200).json({ ok: true, id: ref.id });
    } catch (err) {
      console.error("addLink save failed:", err);
      return res.status(500).json({ error: "save failed" });
    }
  }
);

// Constant-time bearer-token check. Rejects unless the header is
// exactly "Bearer <token>" and matches the configured secret.
function tokenIsValid(authHeader, expected) {
  if (!authHeader || !expected) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const secret = Buffer.from(expected);
  if (provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(provided, secret);
}

// ── Enricher — runs async after document is created ──────

exports.enrichLink = onDocumentCreated(
  { document: "links/{linkId}", region: "us-central1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const enrichable = data.source === "telegram" || data.source === "agent";
    if (!enrichable || data.title !== data.domain) return;

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