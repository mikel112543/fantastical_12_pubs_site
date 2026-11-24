// GET /api/leaderboard -> public high-score table: names + pub counts only (no locations, no current pub, no device ids)
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const tagFor = (device) => createHash("sha256").update(String(device)).digest("hex").slice(0, 10);

export default async () => {
  const people = getStore({ name: "people", consistency: "strong" });
  const { blobs } = await people.list();
  const all = await Promise.all(blobs.map((b) => people.get(b.key, { type: "json" }).catch(() => null)));

  const rows = all.filter(Boolean).map((p) => {
    const ticks = Object.values(p.pubs || {});
    return {
      name: p.name,
      tag: tagFor(p.device),
      pubs: ticks.length,
      verified: ticks.filter((t) => t.verified === "yes").length,
      reachedAt: p.reachedAt || p.lastAt || null // when they reached their current count (tie-break)
    };
  }).filter((r) => r.pubs > 0);

  rows.sort((a, b) =>
    b.pubs - a.pubs ||
    b.verified - a.verified ||
    String(a.reachedAt).localeCompare(String(b.reachedAt)) ||
    a.name.localeCompare(b.name));

  return new Response(JSON.stringify({ ok: true, updated: new Date().toISOString(), rows }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=0, must-revalidate",
      // Netlify's CDN serves the same answer to everyone for 20s, so the function runs at most ~3x a minute
      "netlify-cdn-cache-control": "public, s-maxage=20, stale-while-revalidate=40"
    }
  });
};

export const config = { path: "/api/leaderboard" };
