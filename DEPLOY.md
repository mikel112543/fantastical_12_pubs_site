# Fantastical 12 Pubs of 2026: how to deploy

```
fantastical-12-pubs/
├── site/                  <- the public website
│   ├── index.html
│   ├── pubs.yaml          <- EDIT THIS: pubs, rules, date, start time, host name
│   ├── header.jpg
│   └── admin.html         <- your private Host HQ page (needs your admin key)
├── netlify/functions/     <- check-in, leaderboard + admin code (runs on Netlify)
├── package.json
└── netlify.toml
```

## One-time setup (about 10 minutes)

1. **Install Node.js** (the "LTS" version) from https://nodejs.org if you don't have it.
2. **Unzip** this folder and open a terminal *inside* it
   (Mac: right-click the folder → "New Terminal at Folder". Windows: open the folder, type `cmd` in the address bar, press Enter).
3. Run these, one at a time:

```
npm install
npx netlify-cli login
npx netlify-cli link
```

`link` asks which site to use. If you already made the site with drag-and-drop, choose
**"Search by full or partial project name"** and pick it. Otherwise run
`npx netlify-cli sites:create --name fantastical12pubs` instead of `link`.

4. **Pick your secret admin key** (any long password you'll remember) and save it to Netlify:

```
npx netlify-cli env:set ADMIN_KEY "pick-something-long-and-silly"
```

5. **Deploy:**

```
npx netlify-cli deploy --build --prod
```

## Check it worked

- Open `https://YOUR-SITE.netlify.app/api/checkin`. It should say `{"ok":true}`.
- Open the site on your phone, tick **DONE** on any pub, enter a name, allow location.
  You should see "✅ checked in" (or ❓ if you're not at that pub).
- Open `https://YOUR-SITE.netlify.app/admin.html`, type your admin key, and you'll see the grid.
  Untick the test pub afterwards, or use "Delete all check-in data" before the night.

## Making changes later

Edit `site/pubs.yaml` (or anything else), then run the deploy command again:

```
npx netlify-cli deploy --build --prod
```

Each production deploy uses 15 of the free plan's 300 monthly credits. Credits reset on the 1st,
so do your final deploy on or after **December 1**.

## DONE lock (until 3 PM on the day)

The DONE buttons are locked until `done_unlocks_at` in `pubs.yaml` (set to 3:00 PM New York time, Dec 5).
They unlock by themselves on everyone's phone at that time, no refresh needed. The server also refuses
check-ins before then (with 10 minutes of slack for phones whose clocks run a bit fast).

**Testing before the day:** on a *draft* deploy, change `done_unlocks_at` to a past date, deploy the draft
(`npx netlify-cli deploy --build`, no `--prod`), test, then put it back. Your production site keeps its own copy,
so it stays locked. Delete the test check-ins in Host HQ afterwards.

To switch the lock off completely, delete the `done_unlocks_at` line.

## Live leaderboard

Once check-ins are live, a **HIGH SCORES** board appears on the site (names and pub counts only,
never locations). It updates every ~30 seconds. To hide it, set `leaderboard: false` in
`site/pubs.yaml` and redeploy.

## Turning check-ins off

Set `checkins: false` in `site/pubs.yaml` and redeploy. Ticking DONE then goes back to
working only on each person's own phone.

## After the crawl

Open Host HQ → **Download CSV** → then type `DELETE` and press **Delete all check-in data**.

- **Download CSV**: one row per person per pub they're ticked at. Accidental taps, un-ticks and
  spam-pressing are already sorted out (the phone only sends the final state of a burst of taps,
  and everything is ordered by when it was pressed, even if it arrived late).
- **Full log CSV**: every single press, in case you need to settle an argument.
