# Unsited

**Find local businesses that have no website — on the map. Free, no API key.**

Unsited sweeps any area you can see on the map and surfaces the businesses that
**don't have a website**. They show up as gold pins and as a list of leads with
name, type, address and phone. It's built for anyone who sells websites and
wants to find the businesses that still need one.

It's a single static page — no server, no build step, **no account, no API key,
nothing to pay**. Map tiles come from CARTO, business data from OpenStreetMap.

🔗 **Live:** https://doublef35.github.io/unsited/

---

## How it works

Open the page, pan to a neighbourhood, pick a category, press **Search this
area**. Unsited asks the **Overpass API** (OpenStreetMap's query service) for the
businesses in the visible map box that have **no `website` tag**, and maps them.

Unlike Google, OpenStreetMap lets you filter for the *absence* of a website
right in the query — so there's no download-everything-then-filter, no result
caps, and no tiling. One query per search.

```
[out:json][timeout:25];
( nwr[amenity~"^(restaurant|fast_food)$"][name][!"website"][!"contact:website"][!url](bbox); );
out center 250;
```

## Why this is free (and stays free)

| Piece | Source | Cost |
|---|---|---|
| Map tiles | CARTO dark basemap (OpenStreetMap) | Free, no key |
| Business data | Overpass API | Free, no key |
| Map library | Leaflet (vendored in `vendor/`) | Free, MIT |

No billing account, no credit card, no quota you can accidentally blow past.
The previous Google Maps version is gone precisely because Google requires a
billing account and charges once you pass the free tier.

**Be a good citizen:** the public Overpass servers are donated infrastructure.
Unsited runs one query per button press (never automatically), caps the area to
50 km², and falls back across mirrors if one is busy. Don't hammer it.

---

## Use it

Just open https://doublef35.github.io/unsited/ — there's nothing to set up.

- **Category** — narrow to restaurants, cafés, shops, hair & beauty, etc.
- **Search this area** — sweeps the visible map; the button becomes **Cancel**
  while it runs.
- **Leads** — click a card to fly to its pin; click a pin to highlight its card.
  Each lead has **Call**, **Maps ↗** (Google), **OSM ↗** (the source), and **Copy**.
- **Visible area** — shown live; zoom in if it's over 50 km².

## Honest limitations

- **Coverage = whatever is in OpenStreetMap.** In Italian cities it's good, but
  it's community-mapped, so some businesses are missing and the "no website"
  flag only reflects what OSM knows. Treat results as **leads**, not gospel.
- A business with no `website` tag in OSM might still have a site (just unmapped),
  and vice-versa. Verify before pitching.

---

## Run locally / deploy

It's a static site. Serve the folder over http (Leaflet/tiles need http, not
`file://`):

```bash
python -m http.server 8000   # then open http://localhost:8000
```

Already deployed on **GitHub Pages** (Settings → Pages → Deploy from branch
`main`, root). Pages redeploys automatically on every push to `main`.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure, templates |
| `styles.css` | The whole theme |
| `app.js` | Map, area sweep, Overpass query, leads |
| `vendor/leaflet.*` | Leaflet 1.9.4 (vendored, no CDN dependency) |

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
(ODbL). Basemap © [CARTO](https://carto.com/attributions). Maps by
[Leaflet](https://leafletjs.com/).

## License

MIT — see [LICENSE](LICENSE). (Note: the MIT license covers Unsited's own code,
not the OpenStreetMap data, which is ODbL.)
