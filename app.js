/* ============================================================
   Unsited — find local businesses with no website
   Pure client-side. Talks to Google via the Maps JavaScript API
   "places" library (Place.searchNearby), never the REST endpoint.
   ============================================================ */

"use strict";

// ----------------------------------------------------------------- config
const KEY_STORE = "unsited.apikey";
const SESSION_STORE = "unsited.sessioncalls";

const ENTERPRISE_RATE = 0.035; // USD per call when websiteURI is requested
const FREE_MONTHLY = 1000;     // free Enterprise calls / month
const MAX_TILES = 60;          // safety cap per sweep
const POOL = 6;                // concurrent tile requests

// websiteURI forces the Enterprise SKU; the rest ride along at no extra tier.
const PLACE_FIELDS = [
  "id", "displayName", "location", "websiteURI",
  "formattedAddress", "nationalPhoneNumber",
  "primaryTypeDisplayName", "googleMapsURI",
];

const CATEGORIES = [
  { id: "all",     label: "All",            types: [] },
  { id: "food",    label: "Restaurants",    types: ["restaurant"] },
  { id: "cafe",    label: "Cafés & bars",   types: ["cafe", "bar"] },
  { id: "grocery", label: "Bakery & food",  types: ["bakery", "grocery_store"] },
  { id: "beauty",  label: "Hair & beauty",  types: ["hair_salon", "beauty_salon"] },
  { id: "shop",    label: "Shops",          types: ["clothing_store", "shoe_store", "store"] },
  { id: "florist", label: "Florists",       types: ["florist"] },
  { id: "auto",    label: "Auto",           types: ["car_repair", "car_dealer"] },
];

const RADII = [
  { id: "dense",    label: "Dense",    radius: 180 },
  { id: "standard", label: "Standard", radius: 400 },
  { id: "wide",     label: "Wide",     radius: 1000 },
];

const DEFAULT_CENTER = { lat: 45.4642, lng: 9.19 }; // Milan
const DEFAULT_ZOOM = 15;

// ----------------------------------------------------------------- state
const state = {
  map: null,
  Place: null,
  AdvancedMarkerElement: null,
  category: "food",
  radius: 400,
  leads: new Map(),     // placeId -> { place, marker, card, index }
  gridCircles: [],
  generation: 0,        // bumps each sweep to discard stale results
  scanning: false,
  sessionCalls: Number(localStorage.getItem(SESSION_STORE) || 0),
};

// ----------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const el = {
  gate: $("gate"), app: $("app"), keyForm: $("keyForm"), keyInput: $("keyInput"),
  setupLink: $("setupLink"), setupHelp: $("setupHelp"),
  catChips: $("catChips"), radiusChips: $("radiusChips"),
  tileOut: $("tileOut"), costOut: $("costOut"), sessionOut: $("sessionOut"),
  searchBtn: $("searchBtn"), searchProg: $("searchProg"), capNote: $("capNote"),
  results: $("results"), empty: $("empty"), countOut: $("countOut"),
  coordOut: $("coordOut"), zoomOut: $("zoomOut"),
  mapWrap: $("mapWrap"), scanline: $("scanline"), toast: $("toast"),
  locateBtn: $("locateBtn"), keyBtn: $("keyBtn"), leadTpl: $("leadTpl"),
};

// ----------------------------------------------------------------- boot
init();

function init() {
  buildChips();
  wireGate();
  updateSessionReadout();

  const key = localStorage.getItem(KEY_STORE);
  if (key) {
    startApp(key);
  } else {
    el.gate.hidden = false;
  }
}

// ----------------------------------------------------------------- onboarding
function wireGate() {
  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = el.keyInput.value.trim();
    if (!key) return;
    localStorage.setItem(KEY_STORE, key);
    el.gate.hidden = true;
    startApp(key);
  });
  el.setupLink.addEventListener("click", (e) => {
    e.preventDefault();
    el.setupHelp.open = true;
    el.setupHelp.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

// ----------------------------------------------------------------- maps bootstrap
function bootstrapMaps(key) {
  // Official Google inline Dynamic Library Import loader, fed the user's key.
  (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a); })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)); })({ key, v: "weekly" });
}

async function startApp(key) {
  // Google calls this if the key is rejected or mis-restricted.
  window.gm_authFailure = () => {
    toast("That API key was rejected. Check it's valid and that both Maps JavaScript API and Places API (New) are enabled and the site is allowed.", true, 9000);
    localStorage.removeItem(KEY_STORE);
    setTimeout(() => { el.app.hidden = true; el.gate.hidden = false; el.keyInput.value = key; }, 600);
  };

  bootstrapMaps(key);

  try {
    const [{ Map }, { AdvancedMarkerElement }, { Place }] = await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("marker"),
      google.maps.importLibrary("places"),
    ]);
    state.Place = Place;
    state.AdvancedMarkerElement = AdvancedMarkerElement;

    state.map = new Map($("map"), {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapId: "DEMO_MAP_ID",          // required for AdvancedMarkerElement
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "greedy",
    });

    state.map.addListener("idle", onIdle);

    el.app.hidden = false;
    wireApp();
    onIdle();
  } catch (err) {
    console.error(err);
    toast("Couldn't load Google Maps. Check your connection and that the key allows this site.", true, 9000);
    el.app.hidden = true;
    el.gate.hidden = false;
  }
}

// ----------------------------------------------------------------- controls
function buildChips() {
  buildChipGroup(el.catChips, CATEGORIES, (d) => d.id === state.category, (d) => {
    state.category = d.id;
  });
  buildChipGroup(el.radiusChips, RADII, (d) => d.radius === state.radius, (d) => {
    state.radius = d.radius;
    updateEstimate();
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
  el.keyBtn.addEventListener("click", changeKey);
  el.locateBtn.addEventListener("click", locate);
}

// ----------------------------------------------------------------- viewport readout + estimate
function onIdle() {
  const c = state.map.getCenter();
  if (c) el.coordOut.textContent = `${c.lat().toFixed(4)}, ${c.lng().toFixed(4)}`;
  el.zoomOut.textContent = `z${state.map.getZoom()}`;
  updateEstimate();
}

function planTiles() {
  const b = state.map.getBounds();
  if (!b) return { tiles: [], cols: 0, rows: 0 };
  const ne = b.getNorthEast(), sw = b.getSouthWest();
  const north = ne.lat(), south = sw.lat();
  const west = sw.lng();
  let east = ne.lng();
  if (east < west) east += 360; // viewport crosses the antimeridian

  const midLat = (north + south) / 2;
  const cosLat = Math.max(0.01, Math.cos(midLat * Math.PI / 180)); // guard near the poles

  const widthM = (east - west) * 111320 * cosLat;
  const heightM = (north - south) * 111320;
  const cell = state.radius * Math.SQRT2; // square a circle of radius R fully covers

  const cols = Math.max(1, Math.ceil(widthM / cell));
  const rows = Math.max(1, Math.ceil(heightM / cell));
  const dLng = (east - west) / cols;
  const dLat = (north - south) / rows;

  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const lng = ((west + (cIdx + 0.5) * dLng + 540) % 360) - 180; // wrap to [-180, 180]
      tiles.push({ lat: south + (r + 0.5) * dLat, lng });
    }
  }
  return { tiles, cols, rows };
}

function updateEstimate() {
  const { tiles, cols, rows } = planTiles();
  const n = tiles.length;
  if (!n) return;

  el.tileOut.textContent = `${n} cells (${cols}×${rows})`;

  const over = n > MAX_TILES;
  const cost = n * ENTERPRISE_RATE;
  el.costOut.textContent = `${n} · ~$${cost.toFixed(2)}`;
  el.costOut.classList.toggle("is-over", over);

  if (!state.scanning) el.searchBtn.disabled = over; // stays enabled (as Cancel) mid-sweep
  el.capNote.hidden = !over;
  if (over) {
    el.capNote.className = "note note--warn";
    el.capNote.textContent = `${n} cells is over the ${MAX_TILES}-cell limit. Zoom in, or pick a wider grid resolution.`;
  }
}

function updateSessionReadout() {
  el.sessionOut.textContent = state.sessionCalls
    ? `This session: ${state.sessionCalls} call${state.sessionCalls === 1 ? "" : "s"}.`
    : "";
}

// ----------------------------------------------------------------- the sweep
function onSearchClick() {
  if (state.scanning) cancelSweep();
  else runSweep();
}

function cancelSweep() {
  state.generation++;          // invalidates the in-flight sweep; pending cells won't fire
  finishSweep();
  toast("Sweep cancelled — partial results kept.", false, 3000);
}

async function runSweep() {
  if (state.scanning) return;
  const { tiles } = planTiles();
  if (!tiles.length) return;
  if (tiles.length > MAX_TILES) return;

  const gen = ++state.generation;
  clearLeads();
  state.scanning = true;
  el.mapWrap.classList.add("is-scanning");
  el.searchBtn.disabled = false; // clickable as Cancel during the sweep
  el.searchProg.hidden = false;
  el.searchBtn.querySelector(".btn__label").textContent = "Cancel";

  drawGrid(tiles);

  const cat = CATEGORIES.find((c) => c.id === state.category);
  const includedTypes = cat ? cat.types : [];
  const seen = new Set();
  let done = 0;
  let firstError = null;

  el.searchProg.textContent = `0/${tiles.length}`;

  await runPool(tiles, POOL, async (t) => {
    if (gen !== state.generation) return;
    try {
      const places = await searchTile(t, includedTypes);
      state.sessionCalls++;
      if (gen !== state.generation) return;
      for (const place of places) {
        if (place.websiteURI) continue;          // has a site → skip
        if (seen.has(place.id)) continue;         // dedupe across overlapping cells
        seen.add(place.id);
        addLead(place);
      }
    } catch (err) {
      if (!firstError) firstError = err;
      console.error("tile failed", t, err);
    } finally {
      done++;
      el.searchProg.textContent = `${done}/${tiles.length}`;
    }
  });

  localStorage.setItem(SESSION_STORE, String(state.sessionCalls));
  updateSessionReadout();

  if (gen !== state.generation) return; // a newer sweep or a cancel took over

  finishSweep();

  if (firstError) {
    const msg = (firstError && firstError.message) ? firstError.message : "Some areas failed to load.";
    toast(`Search error: ${msg}`, true, 9000);
  } else if (state.leads.size === 0) {
    toast("No website-less businesses found in this area for that category. Try a different category or a denser grid.", false, 6000);
  }
}

function searchTile(center, includedTypes) {
  const req = {
    fields: PLACE_FIELDS,
    locationRestriction: { center, radius: state.radius },
    maxResultCount: 20,
  };
  if (includedTypes.length) req.includedTypes = includedTypes;
  return state.Place.searchNearby(req).then((res) => res.places || []);
}

function finishSweep() {
  state.scanning = false;
  el.mapWrap.classList.remove("is-scanning");
  el.searchProg.hidden = true;
  el.searchBtn.querySelector(".btn__label").textContent = "Search this area";
  setTimeout(clearGrid, 450);
  updateEstimate();
}

// ----------------------------------------------------------------- leads
function addLead(place) {
  const index = state.leads.size + 1;
  const marker = makeMarker(place, index);
  const card = makeCard(place, index);
  state.leads.set(place.id, { place, marker, card, index });

  if (el.empty) el.empty.hidden = true;
  el.results.appendChild(card);
  el.countOut.hidden = false;
  el.countOut.textContent = String(state.leads.size);
}

function makeMarker(place, index) {
  const anchor = document.createElement("div");
  anchor.className = "gpin-anchor gpin-drop";
  const pin = document.createElement("div");
  pin.className = "gpin";
  anchor.appendChild(pin);

  const marker = new state.AdvancedMarkerElement({
    map: state.map,
    position: place.location,
    title: `${place.displayName || "Business"} — no website`,
    content: anchor,
    gmpClickable: true,
  });
  marker.addListener("gmp-click", () => focusLead(place.id, true));
  return marker;
}

function makeCard(place, index) {
  const node = el.leadTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = place.id;
  node.querySelector(".lead__idx").textContent = String(index).padStart(2, "0");
  node.querySelector(".lead__name").textContent = place.displayName || "Unnamed business";

  const typeEl = node.querySelector(".lead__type");
  typeEl.textContent = place.primaryTypeDisplayName || "Business";

  const addr = place.formattedAddress || "";
  node.querySelector(".lead__addr").textContent = addr;

  const tel = node.querySelector(".lead__tel");
  if (place.nationalPhoneNumber) {
    tel.hidden = false;
    tel.textContent = place.nationalPhoneNumber;
    tel.href = `tel:${place.nationalPhoneNumber.replace(/[^\d+]/g, "")}`;
  }

  const maps = node.querySelector(".lead__maps");
  const safeMaps = /^https:\/\//i.test(place.googleMapsURI || "") ? place.googleMapsURI : null;
  maps.href = safeMaps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName || "")}`;

  const copyBtn = node.querySelector(".lead__copy");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = [place.displayName, place.primaryTypeDisplayName, addr, place.nationalPhoneNumber]
      .filter(Boolean).join(" · ");
    copy(text, copyBtn);
  });

  node.addEventListener("click", () => focusLead(place.id, false));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusLead(place.id, false); }
  });
  return node;
}

function focusLead(id, fromMap) {
  const lead = state.leads.get(id);
  if (!lead) return;

  state.leads.forEach((l) => {
    l.card.classList.remove("is-active");
    l.marker.content.classList.remove("is-active");
  });
  lead.card.classList.add("is-active");
  lead.marker.content.classList.add("is-active");

  if (fromMap) {
    lead.card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    state.map.panTo(lead.place.location);
    if (state.map.getZoom() < 16) state.map.setZoom(16);
  }
}

function clearLeads() {
  state.leads.forEach((l) => { l.marker.map = null; l.card.remove(); });
  state.leads.clear();
  el.countOut.hidden = true;
  if (el.empty) el.empty.hidden = false;
}

// ----------------------------------------------------------------- grid overlay
function drawGrid(tiles) {
  clearGrid();
  tiles.forEach((t) => {
    state.gridCircles.push(new google.maps.Circle({
      map: state.map,
      center: t,
      radius: state.radius,
      strokeColor: "#4FB7A6",
      strokeOpacity: 0.5,
      strokeWeight: 1,
      fillColor: "#4FB7A6",
      fillOpacity: 0.04,
      clickable: false,
    }));
  });
}

function clearGrid() {
  state.gridCircles.forEach((c) => c.setMap(null));
  state.gridCircles = [];
}

// ----------------------------------------------------------------- key / geo
function changeKey() {
  if (!confirm("Replace your saved API key? The page will reload.")) return;
  localStorage.removeItem(KEY_STORE);
  location.reload();
}

function locate() {
  if (!navigator.geolocation) { toast("Geolocation isn't available in this browser.", true); return; }
  el.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.locateBtn.disabled = false;
      state.map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      state.map.setZoom(16);
    },
    () => { el.locateBtn.disabled = false; toast("Couldn't get your location.", true); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ----------------------------------------------------------------- utilities
async function runPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function copy(text, btn) {
  const done = () => {
    btn.classList.add("is-done");
    const prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.classList.remove("is-done"); btn.textContent = prev; }, 1400);
  };
  if (navigator.clipboard?.writeText) {
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
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}
