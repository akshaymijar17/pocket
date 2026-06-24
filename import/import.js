/**
 * One-time import script: Instapaper CSV → Firestore
 * 
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" → save the JSON file
 *   3. Put it in this directory as `serviceAccountKey.json`
 *   4. Put your Instapaper export CSV in this directory as `export.csv`
 * 
 * Run:
 *   cd import
 *   npm install
 *   node import.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// --- Config ---
const CSV_FILE = path.join(__dirname, "export.csv");
const SERVICE_ACCOUNT = path.join(__dirname, "serviceAccountKey.json");

// --- Initialize Firebase ---
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(
    "\n❌ Missing serviceAccountKey.json\n" +
    "   Go to Firebase Console → Project Settings → Service Accounts\n" +
    "   Click 'Generate new private key' and save it here.\n"
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// --- CSV Parser (handles quoted fields with commas) ---
function parseCSV(text) {
  const result = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current);
    result.push(fields);
  }
  return result;
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

async function main() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`\n❌ Missing export CSV at ${CSV_FILE}\n`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_FILE, "utf-8");
  const rows = parseCSV(raw);

  // First row is headers: URL, Title, Selection, Folder, Timestamp, Tags
  const headers = rows.shift();
  console.log(`📄 Parsed ${rows.length} links from CSV`);

  // Firestore batch writes (max 500 per batch, we have 362)
  const batch = db.batch();
  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const [url, title, selection, folder, timestamp, tags] = row;

    if (!url || !url.startsWith("http")) {
      skipped++;
      continue;
    }

    const domain = extractDomain(url);
    const savedAt = timestamp
      ? new Date(parseInt(timestamp) * 1000)
      : new Date();

    const doc = {
      url: url.trim(),
      title: title?.trim() || domain, // fallback to domain if no title
      domain,
      savedAt: admin.firestore.Timestamp.fromDate(savedAt),
      source: "import",
      folder: folder?.trim() || "Unread",
      isRead: folder?.trim() === "Archive",
      tags: [],
    };

    const ref = db.collection("links").doc();
    batch.set(ref, doc);
    count++;
  }

  console.log(`🚀 Writing ${count} links to Firestore (skipped ${skipped})...`);
  await batch.commit();
  console.log(`✅ Done! ${count} links imported.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Import failed:", err.message);
  process.exit(1);
});
