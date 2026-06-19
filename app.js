/* ============================================================
   Unsited — find local businesses with no website
   100% free, no API key, no billing account. Map tiles from
   CARTO (OpenStreetMap), business data from the Overpass API.
   The "no website" filter runs server-side in Overpass.
   ============================================================ */

"use strict";

// ----------------------------------------------------------------- config
// Public Overpass mirrors, tried in order on failure / rate limit.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const MAX_AREA_KM2 = 50;     // refuse sweeps larger than this (kind to the free service)
const MAX_RESULTS = 250;     // cap a single query's payload
const DEFAULT_CENTER = [45.4642, 9.19]; // Milan
const DEFAULT_ZOOM = 16;

// Tags that count as "has a website" — used server-side AND as a client double-check.
const WEBSITE_TAGS = ["website", "contact:website", "url", "contact:url", "website:en"];

// Each category maps to OpenStreetMap selectors. {k} alone = any value of that key;
// {k, v} = values matching the regex.
const CATEGORIES = [
  { id: "all",     label: "All",           sel: [{ k: "shop" }, { k: "craft" }, { k: "amenity", v: "restaurant|cafe|bar|pub|fast_food|ice_cream|pharmacy" }] },
  { id: "food",    label: "Restaurants",   sel: [{ k: "amenity", v: "restaurant|fast_food" }] },
  { id: "cafe",    label: "Cafés & bars",  sel: [{ k: "amenity", v: "cafe|bar|pub|ice_cream" }] },
  { id: "grocery", label: "Bakery & food", sel: [{ k: "shop", v: "bakery|greengrocer|butcher|pastry|deli|confectionery|cheese|seafood" }] },
  { id: "beauty",  label: "Hair & beauty", sel: [{ k: "shop", v: "hairdresser|beauty|nails|cosmetics" }] },
  { id: "shop",    label: "Shops",         sel: [{ k: "shop", v: "clothes|shoes|jewelry|gift|bag|boutique|fashion_accessories|leather" }] },
  { id: "florist", label: "Florists",      sel: [{ k: "shop", v: "florist|garden_centre" }] },
  { id: "auto",    label: "Auto",          sel: [{ k: "shop", v: "car|car_repair|tyres|motorcycle|car_parts" }] },
];

// ----------------------------------------------------------------- state
const state = {
  map: null,
  layer: null,
  category: "food",
  leads: new Map(),  // "type/id" -> { data, marker, card, index }
  scanning: false,
  abort: null,
};

// ----------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const el = {
  catChips: $("catChips"),
  areaOut: $("areaOut"),
  searchBtn: $("searchBtn"), searchProg: $("searchProg"), capNote: $("capNote"),
  results: $("results"), empty: $("empty"), countOut: $("countOut"),
  coordOut: $("coordOut"), zoomOut: $("zoomOut"),
  mapWrap: $("mapWrap"), toast: $("toast"),
  locateBtn: $("locateBtn"), leadTpl: $("leadTpl"),
};

// ----------------------------------------------------------------- boot
init();

function init() {
  buildChips();
  initMap();
  wireApp();
}

function initMap() {
  state.map = L.map("map", {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(state.map);

  state.layer = L.layerGroup().addTo(state.map);

  state.map.on("moveend", onMove);
  // Leaflet needs a size recalc once the fl/grid layout has settled.
  setTimeout(() => state.map.invalidateSize(), 0);
  window.addEventListener("resize", () => state.map.invalidateSize());
  onMove();
}

// ----------------------------------------------------------------- controls
function buildChips() {
  buildChipGroup(el.catChips, CATEGORIES, (d) => d.id === state.category, (d) => {
    state.category = d.id;
  });
}

// A proper ARIA radiogroup: single tab stop (roving tabindex), arrows move + select.
function buildChipGroup(container, defs, isChecked, onSelect) {
  const buttons = defs.map((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    const checked = isChecked(d);
    b.setAttribute("aria-checked", String(checked));
    b.tabIndex = checked ? 0 : -1;
    b.textContent = d.label;
    b.addEventListener("click", () => activate(b));
    container.appendChild(b);
    return b;
  });
  if (!buttons.some((b) => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;

  function activate(btn) {
    buttons.forEach((b) => { b.setAttribute("aria-checked", "false"); b.tabIndex = -1; });
    btn.setAttribute("aria-checked", "true");
    btn.tabIndex = 0;
    btn.focus();
    onSelect(defs[buttons.indexOf(btn)]);
  }

  container.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = buttons[(i + 1) % buttons.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = buttons[(i - 1 + buttons.length) % buttons.length];
    else if (e.key === "Home") next = buttons[0];
    else if (e.key === "End") next = buttons[buttons.length - 1];
    if (next) { e.preventDefault(); activate(next); }
  });
}

function wireApp() {
  el.searchBtn.addEventListener("click", onSearchClick);
  el.locateBtn.addEventListener("click", locate);
}

// ----------------------------------------------------------------- viewport readout + area guard
function onMove() {
  const c = state.map.getCenter();
  el.coordOut.textContent = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
  el.zoomOut.textContent = `z${state.map.getZoom()}`;
  updateEstimate();
}

function viewArea() {
  const b = state.map.getBounds();
  const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  const midLat = (n + s) / 2;
  const cosLat = Math.max(0.01, Math.cos(midLat * Math.PI / 180));
  const widthKm = Math.abs(e - w) * 111.32 * cosLat;
  const heightKm = Math.abs(n - s) * 111.32;
  return { bbox: { s, w, n, e }, km2: widthKm * heightKm };
}

function updateEstimate() {
  const { km2 } = viewArea();
  el.areaOut.textContent = km2 >= 10 ? `${km2.toFixed(0)} km²` : `${km2.toFixed(1)} km²`;

  const over = km2 > MAX_AREA_KM2;
  el.areaOut.classList.toggle("is-over", over);
  if (state.scanning) return; // leave the button (as Cancel) and the note alone mid-sweep

  el.searchBtn.disabled = over;
  el.capNote.hidden = !over;
  if (over) {
    el.capNote.className = "note note--warn";
    el.capNote.textContent = `This area is ${km2.toFixed(0)} km² — too big for one free query. Zoom in to under ${MAX_AREA_KM2} km².`;
  }
}

// ----------------------------------------------------------------- the sweep
function onSearchClick() {
  if (state.scanning) cancelSweep();
  else runSweep();
}

function cancelSweep() {
  if (state.abort) state.abort.abort();
}

async function runSweep() {
  if (state.scanning) return;
  const { bbox, km2 } = viewArea();
  if (km2 > MAX_AREA_KM2) return;

  clearLeads();
  setScanUI(true);
  state.abort = new AbortController();

  const cat = CATEGORIES.find((c) => c.id === state.category) || CATEGORIES[0];
  const query = buildQuery(bbox, cat);

  try {
    const elements = await fetchOverpass(query, state.abort.signal);
    const seen = new Set();
    for (const e of elements) {
      const id = `${e.type}/${e.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const lat = e.lat != null ? e.lat : (e.center && e.center.lat);
      const lng = e.lon != null ? e.lon : (e.center && e.center.lon);
      const tags = e.tags || {};
      if (lat == null || lng == null || !tags.name) continue;
      if (hasWebsite(tags)) continue; // client-side double-check
      addLead({ id, lat, lng, tags });
    }
    if (state.leads.size === 0) {
      toast("No website-less businesses here in OpenStreetMap for that category. Try another category or a different area.", false, 6000);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      toast("Sweep cancelled.", false, 2500);
    } else {
      console.error(err);
      toast(`Search failed: ${err.message}. The free Overpass service may be busy — wait a moment and try again.`, true, 8000);
    }
  } finally {
    setScanUI(false);
    state.abort = null;
  }
}

function buildQuery(bbox, cat) {
  const bb = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const noSite = WEBSITE_TAGS.map((t) => `[!"${t}"]`).join("");
  const clauses = cat.sel.map((sel) => {
    const tag = sel.v ? `[${sel.k}~"^(${sel.v})$"]` : `[${sel.k}]`;
    return `  nwr${tag}[name]${noSite}(${bb});`;
  }).join("\n");
  return `[out:json][timeout:25];\n(\n${clauses}\n);\nout center ${MAX_RESULTS};`;
}

async function fetchOverpass(query, signal) {
  let lastErr = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal,
      });
      if (res.status === 429 || res.status === 504) { lastErr = new Error("service busy"); continue; }
      if (!res.ok) { lastErr = new Error("HTTP " + res.status); continue; }
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("all Overpass mirrors unreachable");
}

function setScanUI(on) {
  state.scanning = on;
  el.mapWrap.classList.toggle("is-scanning", on);
  el.searchProg.hidden = !on;
  if (on) {
    el.searchBtn.disabled = false; // clickable as Cancel
    el.searchProg.textContent = "searching";
    el.searchBtn.querySelector(".btn__label").textContent = "Cancel";
  } else {
    el.searchBtn.querySelector(".btn__label").textContent = "Search this area";
    updateEstimate();
  }
}

function hasWebsite(tags) {
  return WEBSITE_TAGS.some((t) => tags[t]);
}

// ----------------------------------------------------------------- leads
function addLead(data) {
  const index = state.leads.size + 1;
  const marker = makeMarker(data, index);
  const card = makeCard(data, index);
  state.leads.set(data.id, { data, marker, card, index });

  if (el.empty) el.empty.hidden = true;
  el.results.appendChild(card);
  el.countOut.hidden = false;
  el.countOut.textContent = String(state.leads.size);
}

function makeMarker(data, index) {
  const icon = L.divIcon({
    className: "gpin-wrap",
    html: '<span class="gpin gpin-drop"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
  const marker = L.marker([data.lat, data.lng], { icon, title: `${data.tags.name} — no website`, riseOnHover: true });
  marker.on("click", () => focusLead(data.id, true));
  marker.addTo(state.layer);
  return marker;
}

function makeCard(data, index) {
  const t = data.tags;
  const node = el.leadTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = data.id;
  node.querySelector(".lead__idx").textContent = String(index).padStart(2, "0");
  node.querySelector(".lead__name").textContent = t.name || "Unnamed business";
  node.querySelector(".lead__type").textContent = humanizeType(t);

  const addr = buildAddress(t);
  const addrEl = node.querySelector(".lead__addr");
  if (addr) addrEl.textContent = addr; else addrEl.hidden = true;

  const phone = t.phone || t["contact:phone"] || t["contact:mobile"] || "";
  const tel = node.querySelector(".lead__tel");
  if (phone) {
    tel.hidden = false;
    tel.textContent = phone;
    tel.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
  }

  const [type, oid] = data.id.split("/");
  node.querySelector(".lead__maps").href =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((t.name || "") + " " + data.lat + "," + data.lng)}`;
  node.querySelector(".lead__osm").href = `https://www.openstreetmap.org/${type}/${oid}`;

  const copyBtn = node.querySelector(".lead__copy");
  copyBtn.addEventListener("click", () => {
    copy([t.name, humanizeType(t), addr, phone].filter(Boolean).join(" · "), copyBtn);
  });

  // Actions open links / copy — they must not also pan the map.
  node.querySelector(".lead__actions").addEventListener("click", (e) => e.stopPropagation());
  node.addEventListener("click", () => focusLead(data.id, false));
  return node;
}

function focusLead(id, fromMap) {
  const lead = state.leads.get(id);
  if (!lead) return;

  state.leads.forEach((l) => {
    l.card.classList.remove("is-active");
    const node = l.marker.getElement();
    if (node) node.classList.remove("is-active");
  });
  lead.card.classList.add("is-active");
  const node = lead.marker.getElement();
  if (node) node.classList.add("is-active");

  if (fromMap) {
    lead.card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    state.map.setView([lead.data.lat, lead.data.lng], Math.max(state.map.getZoom(), 17), { animate: true });
    // The marker may be offscreen (no DOM element yet) until the pan finishes.
    state.map.once("moveend", () => {
      const n = lead.marker.getElement();
      if (n) n.classList.add("is-active");
    });
  }
}

function clearLeads() {
  state.layer.clearLayers();
  state.leads.forEach((l) => l.card.remove());
  state.leads.clear();
  el.countOut.hidden = true;
  if (el.empty) el.empty.hidden = false;
}

// ----------------------------------------------------------------- formatting
function humanizeType(tags) {
  const raw = tags.shop || tags.amenity || tags.craft || tags.office || tags.tourism || "business";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildAddress(t) {
  const line = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  return [line, t["addr:city"]].filter(Boolean).join(", ");
}

// ----------------------------------------------------------------- geolocation
function locate() {
  if (!navigator.geolocation) { toast("Geolocation isn't available in this browser.", true); return; }
  el.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.locateBtn.disabled = false;
      state.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    },
    () => { el.locateBtn.disabled = false; toast("Couldn't get your location.", true); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ----------------------------------------------------------------- utilities
function copy(text, btn) {
  const done = () => {
    btn.classList.add("is-done");
    const prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.classList.remove("is-done"); btn.textContent = prev; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (_) { /* ignore */ }
  ta.remove();
}

let toastTimer = null;
function toast(msg, isError = false, ms = 4500) {
  el.toast.textContent = msg;
  el.toast.classList.toggle("toast--err", isError);
  el.toast.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.classList.remove("is-show"); }, ms);
}
