// POST /api/checkin  -> records one pub check-in (name, pub, time, optional location)
// GET  /api/checkin  -> health check, lets the site know check-ins are switched on
import { getStore } from "@netlify/blobs";
import yaml from "js-yaml";

let pubsCache = null;
let pubsCacheAt = 0;

async function loadPubs(req) {
  if (pubsCache && Date.now() - pubsCacheAt < 60_000) return pubsCache;
  const r = await fetch(new URL("/pubs.yaml", req.url), { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("could not read pubs.yaml");
  const data = yaml.load(await r.text()) || {};
  pubsCache = { pubs: Array.isArray(data.pubs) ? data.pubs : [], event: data.event || {} };
  pubsCacheAt = Date.now();
  return pubsCache;
}

function metres(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export default async (req) => {
  if (req.method === "GET") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const name = clean(body.name, 40);
  const device = clean(body.device, 40);
  const pubIndex = Number.isInteger(body.pub) ? body.pub : -1;
  const action = body.action === "undo" ? "undo" : "checkin";
  if (!name || !device) return json({ error: "name and device required" }, 400);

  let pubs, event;
  try { ({ pubs, event } = await loadPubs(req)); } catch { return json({ error: "pub list unavailable" }, 503); }
  if (pubIndex < 0 || pubIndex >= pubs.length) return json({ error: "unknown pub" }, 400);
  const pub = pubs[pubIndex] || {};

  // DONE is locked until event.done_unlocks_at (10 min grace for phones with a slightly fast clock)
  const unlock = event.done_unlocks_at ? Date.parse(String(event.done_unlocks_at)) : NaN;
  if (action === "checkin" && Number.isFinite(unlock) && Date.now() < unlock - 10 * 60_000) {
    return json({ error: "locked", unlocksAt: new Date(unlock).toISOString() }, 423);
  }

  const lat = num(body.lat), lng = num(body.lng), acc = num(body.accuracy);
  const radius = Number(event.verify_radius_m) || 150;
  let distance = null, verified = "no-location";
  if (action === "undo") {
    verified = "n/a";
  } else if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const plat = Number(pub.lat), plng = Number(pub.lng);
    if (Number.isFinite(plat) && Number.isFinite(plng)) {
      distance = Math.round(metres(lat, lng, plat, plng));
      // allow for the phone's own GPS uncertainty (capped so a wild reading can't verify)
      verified = distance <= radius + Math.min(acc || 0, 100) ? "yes" : "not-near";
    } else {
      verified = "pub-has-no-coords";
    }
  }

  const now = Date.now();
  // when the button was pressed on the phone (falls back to arrival time; sanity-limited to the last 2 days)
  const t = Number.isFinite(body.t) && body.t > now - 2 * 864e5 && body.t < now + 6e4 ? Math.round(body.t) : now;
  const rec = {
    at: new Date(now).toISOString(),
    pressedAt: new Date(t).toISOString(),
    device, name, action,
    pub: pubIndex, pubName: clean(pub.name, 80),
    lat, lng, accuracy: acc == null ? null : Math.round(acc),
    distance, verified,
    locationError: clean(body.locationError, 40) || null
  };

  const store = getStore({ name: "checkins", consistency: "strong" });
  // same client id => same key, so a retried send overwrites instead of duplicating
  const cid = clean(body.cid, 16).replace(/[^a-z0-9]/gi, "") || Math.random().toString(36).slice(2, 12);
  const key = device.replace(/[^a-z0-9]/gi, "") + "_" + pubIndex + "_" + cid;
  await store.setJSON(key, rec);

  // per-person tally for the public leaderboard (each phone only ever writes its own record)
  const people = getStore({ name: "people", consistency: "strong" });
  const pkey = device.replace(/[^a-z0-9]/gi, "") || "anon";
  const me = (await people.get(pkey, { type: "json" }).catch(() => null)) || { device, pubs: {} };
  const before = Object.keys(me.pubs).length;
  me.name = name;
  me.lastPress = me.lastPress || {};
  const stale = me.lastPress[pubIndex] && me.lastPress[pubIndex] > rec.pressedAt;
  if (!stale) {
    me.lastPress[pubIndex] = rec.pressedAt;
    if (action === "undo") delete me.pubs[pubIndex];
    else me.pubs[pubIndex] = { verified, at: rec.pressedAt, name: rec.pubName };
  }
  const after = Object.keys(me.pubs).length;
  if (after !== before) me.reachedAt = rec.pressedAt;
  if (!stale && action !== "undo") { me.lastPubName = rec.pubName; me.lastAt = rec.pressedAt; }
  else if (!stale) {
    const latest = Object.values(me.pubs).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
    me.lastPubName = latest ? latest.name || me.lastPubName : null;
    me.lastAt = latest ? latest.at : null;
  }
  await people.setJSON(pkey, me);

  return json({ ok: true, verified, distance });
};

export const config = { path: "/api/checkin" };
