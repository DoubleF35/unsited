# Unsited

**Find local businesses that have no website — on the map.**

Unsited sweeps any area you can see on the map and surfaces the businesses that
**don't have a website**. They show up as gold pins and as a list of leads with
name, type, address and phone. It's built for anyone who sells websites and
wants to find the businesses that still need one.

It's a single static page — no server, no build step. It runs entirely in your
browser and talks to Google directly.

🔗 **Live:** `https://<your-user>.github.io/unsited/` (after you enable Pages, see below)

---

## How it works

There is **no Google parameter for "has no website."** So Unsited:

1. Splits the visible map area into a grid of small circles.
2. Runs a Google **Nearby Search** on each circle (max 20 results each, no paging).
3. Merges and de-duplicates the results.
4. Keeps only the places where Google returns **no website**, and maps them.

It uses the Maps JavaScript API's `Place.searchNearby` (the supported way to do
Places from a browser) — never the REST endpoint, which isn't meant for
client-side use.

---

## Setup (about 2 minutes)

You need a Google Maps Platform API key. The key lives **only in your browser**
(`localStorage`) — it is never committed to this repo or sent anywhere else.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   or create a project. A **billing account** must be attached (Google requires
   a card even within the free tier).
2. In **APIs & Services → Library**, enable **both**:
   - **Maps JavaScript API**
   - **Places API (New)** ← note: *not* the older "Places API".
3. In **APIs & Services → Credentials → Create credentials → API key**, copy the key.
4. Click the key to edit it:
   - **Application restrictions → Websites** → add your site, including the scheme
     and a trailing wildcard, e.g. `https://<your-user>.github.io/*`
     (and `http://localhost:*/*` if you want to test locally).
   - **API restrictions → Restrict key** → select the two APIs above.
5. Open Unsited and paste the key when prompted.

> The key is readable in the browser even when restricted — that's normal for a
> client-side Maps key. The website restriction limits *which sites* can use it,
> which is what protects you. Don't reuse a key you also use server-side.

---

## Cost — read this

Detecting "no website" means asking Google for the `websiteURI` field, which
puts every call on Google's **Enterprise** tier.

| Thing | Rate |
|---|---|
| Nearby Search (Enterprise) | **~$0.035 / call** (~$35 per 1,000) |
| Free allowance | **1,000 Enterprise calls / month** |
| Maps load | ~$0.007 / load, 10,000 free / month |

- **One sweep = one call per grid cell.** Unsited shows the cell count and cost
  estimate *before* you run it, and caps a single sweep at **60 cells**.
- At "Standard" resolution a city block is a handful of cells; a wide view can be
  dozens. ~1,000 free calls ≈ **20 sweeps of 50 cells per month**.
- The old **$200/month credit is gone** (since March 2025) — budget against the
  per-tier free allowances instead.

Tips to spend less: use a **denser grid only where you need it** (zoom in), pick a
specific category instead of "All", and don't re-sweep the same area repeatedly.

---

## Deploy to GitHub Pages

This repo is already a static site, so:

1. Push it to GitHub (done if you cloned from there).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick branch `main`, folder `/ (root)`, **Save**.
4. Wait a minute, then open `https://<your-user>.github.io/unsited/`.
5. Make sure that exact URL is in your API key's **website restrictions**.

To run locally instead, serve the folder over http (not `file://`, the Maps
loader needs http):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

---

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure, onboarding, templates |
| `styles.css` | The whole theme |
| `app.js` | Map, area sweep, tiling, filtering, leads |

## Limits & honesty

- Nearby Search returns **at most 20 results per cell with no pagination**, so
  very dense blocks can still hide places — use the **Dense** grid there.
- Google's "no website" data isn't perfect; a business may have a site Google
  doesn't know about (or vice-versa). Treat results as leads, not gospel.
- `DEMO_MAP_ID` is used for the map style. It's fine for personal use; create a
  real Map ID in the console for production.

## License

MIT — see [LICENSE](LICENSE).
