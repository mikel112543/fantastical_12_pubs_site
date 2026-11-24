// Host-only endpoint. Needs the ADMIN_KEY environment variable set in Netlify.
// GET  /api/admin            (header x-admin-key)  -> all check-in records as JSON
// GET  /api/admin?format=csv&key=...                -> CSV download
// POST /api/admin {action:"delete-all"}             -> wipes every check-in
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function allRecords(store) {
  const { blobs } = await store.list();
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)));
  const key = (r) => r.pressedAt || r.at;
  return recs.filter(Boolean).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.at < b.at ? -1 : 1));
}

// latest action per person + pub (by press time); keep only pubs still ticked
function finalState(recs) {
  const last = new Map();
  recs.forEach((r) => last.set(r.device + "|" + r.pub, r));
  return [...last.values()].filter((r) => r.action !== "undo")
    .sort((a, b) => a.name.localeCompare(b.name) || a.pub - b.pub);
}

const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection (names etc.)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function nyTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "medium" });
  } catch { return iso; }
}

export default async (req) => {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return json({ error: "ADMIN_KEY is not set in Netlify environment variables" }, 503);

  const url = new URL(req.url);
  const given = req.headers.get("x-admin-key") || url.searchParams.get("key") || "";
  if (!sameKey(given, ADMIN_KEY)) return json({ error: "wrong key" }, 401);

  const store = getStore({ name: "checkins", consistency: "strong" });

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    if (body.action !== "delete-all") return json({ error: "unknown action" }, 400);
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    const people = getStore({ name: "people", consistency: "strong" });
    const p = await people.list();
    await Promise.all(p.blobs.map((b) => people.delete(b.key)));
    return json({ ok: true, deleted: blobs.length, people: p.blobs.length });
  }

  const recs = await allRecords(store);

  const fmt = url.searchParams.get("format");
  if (fmt === "csv" || fmt === "log") {
    const full = fmt === "log";
    const list = full ? recs : finalState(recs);
    const head = full
      ? ["pressed_new_york", "received_utc", "name", "device", "action", "pub_no", "pub", "verified", "distance_m", "gps_accuracy_m", "lat", "lng", "location_note"]
      : ["name", "pub_no", "pub", "checked_in_new_york", "verified", "distance_m", "gps_accuracy_m", "lat", "lng", "location_note", "device"];
    const rows = list.map((r) => (full
      ? [nyTime(r.pressedAt || r.at), r.at, r.name, r.device, r.action, r.pub + 1, r.pubName, r.verified, r.distance, r.accuracy, r.lat, r.lng, r.locationError]
      : [r.name, r.pub + 1, r.pubName, nyTime(r.pressedAt || r.at), r.verified, r.distance, r.accuracy, r.lat, r.lng, r.locationError, r.device]
    ).map(csvCell).join(","));
    return new Response([head.join(","), ...rows].join("\r\n") + "\r\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="' + (full ? "pub-crawl-full-log.csv" : "pub-crawl-checkins.csv") + '"',
        "cache-control": "no-store"
      }
    });
  }

  return json({ ok: true, records: recs });
};

export const config = { path: "/api/admin" };
