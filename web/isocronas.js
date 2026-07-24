/* Isócronas: áreas alcanzables por tiempo de traslado desde un punto (clic en
 * el mapa o lat/lng manual), en tres bandas (5/10/15 min) por modo (Auto o A
 * pie). Sirve para demostrar conectividad: qué tan lejos se llega en X minutos
 * y qué se alcanza dentro de ese tiempo.
 *
 * A diferencia del análisis de Radio (buffer.js), que traza un círculo
 * geométrico con turf, aquí el contorno sigue la red vial real (grafo de
 * OpenStreetMap). Como el sitio es 100% estático, eso obliga a un motor de
 * ruteo externo: se usa el endpoint de isócronas de OpenRouteService, que
 * devuelve las tres bandas de tiempo en UNA sola llamada. La clave ORS_API_KEY
 * vive en config.js (gratuita; hay que registrarse en openrouteservice.org).
 * TomTom no sirve aquí: su "Reachable Range" es solo motorizado y rechaza el
 * modo a pie.
 *
 * Con las bandas ya calculadas se cuenta qué cae dentro de cada tiempo (POIs
 * por categoría y proyectos de vivienda nueva) como prueba de conectividad.
 *
 * Requiere: turf (CDN), main.js (map, DATA, drawnItems*), config.js
 * (ORS_API_KEY), poi.js (POI_ESTILO, DATA.poi) y proyectos.js
 * (PROYECTOS_SOFTEC). Es excluyente con el análisis de Radio (buffer.js) y de
 * polígono (zona.js): iniciar cualquiera limpia los otros.
 * (*drawnItems/currentZone/currentStats son globales de zona.js — scripts
 *  clásicos con scope compartido.)
 */

"use strict";

const ISO_MINUTES = [5, 10, 15]; // bandas de tiempo (min)
const ISO_MODES = {
  car:        { label: "Auto",  ors: "driving-car" },
  pedestrian: { label: "A pie", ors: "foot-walking" },
  // Para habilitar bici, agregar: cycling: { label: "Bici", ors: "cycling-regular" }
};
// Paleta tipo semáforo suave: verde = cerca en tiempo, rojo = lejos.
const ISO_COLORS = ["#2a9d8f", "#e9c46a", "#e76f51"]; // 5 / 10 / 15 min

let isoMode = "car";       // modo seleccionado
let isoState = null;       // análisis activo (null = sin isócronas)
let isoPicking = false;    // esperando clic en el mapa
window.isoPicking = false; // espejo público para main.js (layerClick)

const isoGroup = L.featureGroup().addTo(map);
const isoCache = new Map(); // "lat|lng|mode" -> state

const isoFmt = (n, d = 0) =>
  n == null ? "s/d" : Number(n.toFixed(d)).toLocaleString("es-MX");

// ------------------------------------------------------- OpenRouteService
// Las tres bandas (polígonos turf) en una sola llamada. ORS devuelve un
// Feature por cada valor de `range`; cada uno es el área COMPLETA alcanzable
// en ese tiempo (anidados: P5 ⊂ P10 ⊂ P15).
async function isoFetchBands(lat, lng, profile) {
  const resp = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
    method: "POST",
    headers: { "Authorization": ORS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [[lng, lat]],
      range: ISO_MINUTES.map((m) => m * 60), // segundos
      range_type: "time",
    }),
  });
  if (!resp.ok) {
    let detail = "";
    try { const j = await resp.json(); detail = j?.error?.message || (typeof j?.error === "string" ? j.error : ""); } catch (e) { /* cuerpo no-JSON */ }
    let msg = `OpenRouteService respondió ${resp.status}`;
    if (resp.status === 401 || resp.status === 403) msg += " — clave inválida o ausente (revisa ORS_API_KEY en config.js)";
    else if (resp.status === 429) msg += " — límite de peticiones excedido (máx. 20/min, 500/día)";
    throw new Error(msg + (detail ? `: ${detail}` : "."));
  }
  const gj = await resp.json();
  const feats = (gj.features || []).slice()
    .sort((a, b) => (a.properties?.value || 0) - (b.properties?.value || 0));
  if (feats.length < ISO_MINUTES.length) {
    throw new Error("OpenRouteService no devolvió todas las bandas para este punto.");
  }
  return feats; // Features<Polygon|MultiPolygon> ascendentes por tiempo
}

// --------------------------------------------------------------- análisis
async function analyzeIso(lat, lng, mode) {
  const key = `${lat.toFixed(6)}|${lng.toFixed(6)}|${mode}`;
  if (isoCache.has(key)) return isoCache.get(key);

  // polys[i] = área alcanzable en ISO_MINUTES[i] min (anidadas: P5 ⊂ P10 ⊂ P15).
  const polys = await isoFetchBands(lat, lng, ISO_MODES[mode].ors);

  // Bandas disjuntas para dibujar (anillo = polígono menos el interior) — así
  // los colores no se suman al traslaparse. Si turf.difference falla, se usa
  // el polígono completo (se verá el traslape, pero no rompe).
  const bands = ISO_MINUTES.map((min, i) => {
    let display = polys[i];
    if (i > 0) {
      try {
        const diff = turf.difference(polys[i], polys[i - 1]);
        if (diff) display = diff;
      } catch (e) { /* geometría problemática: dejar el polígono completo */ }
    }
    return { min, color: ISO_COLORS[i], display, full: polys[i], areaKm2: turf.area(polys[i]) / 1e6 };
  });

  const reach = analyzeReach(polys);
  const state = { lat, lng, mode, bands, reach };
  isoCache.set(key, state);
  if (isoCache.size > 20) isoCache.delete(isoCache.keys().next().value);
  return state;
}

function isoPointInPoly(lng, lat, poly) {
  try { return turf.booleanPointInPolygon(turf.point([lng, lat]), poly); }
  catch (e) { return false; }
}

// Conectividad: qué se alcanza dentro de cada banda (conteos acumulados).
function analyzeReach(polys) {
  // Índice de la banda más chica que contiene el punto (-1 = fuera de todo).
  const bandIndexFor = (lng, lat) => {
    for (let i = 0; i < polys.length; i++) if (isoPointInPoly(lng, lat, polys[i])) return i;
    return -1;
  };

  // POIs por categoría: [dentro de 5, dentro de 10, dentro de 15] acumulado.
  const poi = {};
  const poisDisponibles = !!DATA.poi;
  if (poisDisponibles) {
    for (const cat of Object.keys(POI_ESTILO)) poi[cat] = [0, 0, 0];
    for (const f of DATA.poi.features) {
      const [lng, lat] = f.geometry.coordinates;
      const bi = bandIndexFor(lng, lat);
      if (bi < 0) continue;
      const cat = f.properties.categoria;
      if (!poi[cat]) continue;
      for (let i = bi; i < ISO_MINUTES.length; i++) poi[cat][i]++;
    }
  }

  // Proyectos de vivienda nueva alcanzables, con el tiempo mínimo para llegar.
  const proyectos = [];
  for (const p of PROYECTOS_SOFTEC) {
    const bi = bandIndexFor(p.lon, p.lat);
    if (bi < 0) continue;
    proyectos.push({ nombre: p.nombre, tipo: p.tipo, minutos: ISO_MINUTES[bi] });
  }
  proyectos.sort((a, b) => a.minutos - b.minutos || a.nombre.localeCompare(b.nombre));

  return { poi, poisDisponibles, proyectos };
}

// ------------------------------------------------------------------ dibujo
function drawIso(state) {
  isoGroup.clearLayers();

  // De la banda mayor a la menor, para que la más chica (más oscura en
  // tiempo cercano) quede encima.
  for (let i = state.bands.length - 1; i >= 0; i--) {
    const b = state.bands[i];
    L.geoJSON(b.display, {
      interactive: false,
      style: { color: b.color, weight: 1.2, fillColor: b.color, fillOpacity: 0.34 },
    }).addTo(isoGroup);
  }
  // Contorno exterior marcado sobre la banda mayor.
  L.geoJSON(state.bands[state.bands.length - 1].full, {
    interactive: false,
    style: { color: "#1c2a3a", weight: 2, fill: false },
  }).addTo(isoGroup);

  // Marcador central arrastrable (recalcula al soltar). L.Marker soporta
  // draggable de forma nativa; se reutiliza el estilo del punto del buffer.
  const marker = L.marker([state.lat, state.lng], {
    icon: L.divIcon({ className: "buffer-center-marker", iconSize: [16, 16], iconAnchor: [8, 8] }),
    draggable: true,
    keyboard: false,
    title: "Arrastra para mover el punto",
  }).addTo(isoGroup);
  marker.on("dragend", (e) => {
    const { lat, lng } = e.target.getLatLng();
    runIsocronas(lat, lng, isoMode, { fit: false });
  });
}

// --------------------------------------------------------------- ejecución
function runIsocronas(lat, lng, mode, { fit = true } = {}) {
  if (typeof ORS_API_KEY !== "string" || !ORS_API_KEY) {
    renderIsoPanel(null, {
      error: 'Falta la clave de OpenRouteService. Regístrate gratis en ' +
        '<a href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener">openrouteservice.org</a> ' +
        'y pega tu clave en <code>ORS_API_KEY</code> (web/config.js).',
    });
    return;
  }
  stopIsoPicking();
  // Excluyente con Radio y con el polígono de Zona de estudio.
  window.clearBufferAnalysis?.(false);
  drawnItems.clearLayers();
  currentZone = null;
  currentStats = null;
  document.getElementById("zone-panel").classList.add("hidden");

  isoMode = mode;
  const btn = document.getElementById("btn-iso");
  btn.classList.add("active", "loading");
  renderIsoPanel(isoState, { loading: true });

  analyzeIso(lat, lng, mode)
    .then((state) => {
      isoState = state;
      drawIso(state);
      renderIsoPanel(state);
      // animate:false — un redibujo inmediato durante la animación de zoom deja
      // el mapa en un zoom incorrecto (mismo cuidado que en buffer.js).
      if (fit) map.fitBounds(isoGroup.getBounds(), { padding: [30, 30], animate: false });
      window.plActualizar?.();
    })
    .catch((err) => {
      isoState = null;
      isoGroup.clearLayers();
      renderIsoPanel(null, { error: err.message || "No se pudieron calcular las isócronas." });
      window.plActualizar?.();
    })
    .finally(() => btn.classList.remove("loading"));
}

window.getIsoState = () => isoState;

window.clearIsocronas = function (hidePanel = true) {
  isoGroup.clearLayers();
  isoState = null;
  stopIsoPicking();
  document.getElementById("btn-iso").classList.remove("active", "loading");
  if (hidePanel) document.getElementById("iso-panel").classList.add("hidden");
  window.plActualizar?.();
};

// ------------------------------------------------------- selección del punto
function onIsoMapClick(e) {
  if (!isoPicking) return;
  map.closePopup();
  runIsocronas(e.latlng.lat, e.latlng.lng, isoMode);
}
window.onIsoMapClick = onIsoMapClick;

function startIsoPicking() {
  isoPicking = true;
  window.isoPicking = true;
  document.body.classList.add("iso-picking");
  map.getContainer().style.cursor = "crosshair";
  map.on("click", onIsoMapClick);
}

function stopIsoPicking() {
  isoPicking = false;
  window.isoPicking = false;
  document.body.classList.remove("iso-picking");
  map.getContainer().style.cursor = "";
  map.off("click", onIsoMapClick);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isoPicking) stopIsoPicking();
});

const btnIso = document.getElementById("btn-iso");
btnIso.addEventListener("click", () => {
  if (isoState || isoPicking) {
    window.clearIsocronas();
    return;
  }
  btnIso.classList.add("active");
  // El panel muestra un análisis a la vez: quitar Radio y el polígono dibujado.
  window.clearBufferAnalysis?.(false);
  drawnItems.clearLayers();
  currentZone = null;
  currentStats = null;
  document.getElementById("zone-panel").classList.add("hidden");
  startIsoPicking();
  renderIsoPanel(null); // solo el formulario, sin resultados aún
});

// ------------------------------------------------------------------- panel
function isoFormHTML(s) {
  const lat = s ? s.lat.toFixed(6) : "";
  const lng = s ? s.lng.toFixed(6) : "";
  const seg = Object.entries(ISO_MODES).map(([k, v]) =>
    `<button class="iso-mode-btn ${k === isoMode ? "active" : ""}" data-mode="${k}">${v.label}</button>`).join("");
  return `
    <div class="buffer-form">
      <div class="iso-modes">${seg}</div>
      <div class="bf-row" style="margin-top:8px">
        <label>Lat <input id="iso-lat" type="number" step="any" placeholder="21.8823" value="${lat}"></label>
        <label>Lng <input id="iso-lng" type="number" step="any" placeholder="-102.2916" value="${lng}"></label>
        <button id="iso-go" title="Calcular isócronas">Calcular</button>
      </div>
      ${s ? "" : `<div class="bf-hint">Haz clic en el mapa para elegir el punto, o escribe las coordenadas. Se dibujan las bandas de 5, 10 y 15 minutos.</div>`}
    </div>`;
}

function isoResultsHTML(s) {
  const modeLabel = ISO_MODES[s.mode].label.toLowerCase();

  const cards = s.bands.map((b) => `
    <div class="zone-card">
      <div class="zc-label"><span class="legend-dot" style="background:${b.color}"></span> ${b.min} min ${modeLabel}</div>
      <div class="zc-value">${isoFmt(b.areaKm2, 1)} km²</div>
      <div class="zc-sub">área alcanzable</div>
    </div>`).join("");

  const r = s.reach;
  let poiBlock;
  if (r.poisDisponibles) {
    const rows = Object.entries(r.poi)
      .filter(([, c]) => c[2] > 0)
      .sort((a, b) => b[1][2] - a[1][2])
      .map(([cat, c]) => `
        <tr><td><span class="legend-dot" style="background:${POI_ESTILO[cat].color}"></span> ${cat}</td>
        <td>${c[0]}</td><td>${c[1]}</td><td>${c[2]}</td></tr>`).join("");
    poiBlock = rows
      ? `<div class="zone-list"><strong>Servicios alcanzables (POIs, acumulado):</strong></div>
         <div class="buffer-table-wrap"><table class="buffer-table iso-table">
           <tr><th>Categoría</th><th>≤5</th><th>≤10</th><th>≤15 min</th></tr>${rows}
         </table></div>`
      : `<div class="zone-list">Ningún POI dentro de las isócronas.</div>`;
  } else {
    poiBlock = `<div class="zone-list">Activa la capa <strong>POI</strong> para contar servicios alcanzables.</div>`;
  }

  const proyBlock = r.proyectos.length
    ? `<div class="zone-list"><strong>Vivienda nueva alcanzable (${r.proyectos.length}, estudio 1T26):</strong><br>` +
      r.proyectos.slice(0, 10).map((p) => `
        <span class="bf-nse"><span class="legend-dot" style="background:${p.tipo === "vertical" ? "#2f6690" : "#2a9d8f"}"></span>${p.nombre} <span class="bf-pdu-prog">${p.minutos} min</span></span>`).join(" ") +
      (r.proyectos.length > 10 ? `<div class="bf-more">… y ${r.proyectos.length - 10} proyectos más</div>` : "") +
      `</div>`
    : `<div class="zone-list">Sin proyectos de vivienda nueva (1T26) dentro de las isócronas.</div>`;

  return `
    <div class="zone-cards iso-cards">${cards}</div>
    ${poiBlock}
    ${proyBlock}
    <div class="zone-note">Isócronas calculadas sobre la red vial de OpenStreetMap con
      OpenRouteService. Cada banda es el área alcanzable en ≤ N minutos desde el punto, puerta a
      puerta y <strong>sin tráfico en vivo</strong> (tiempos aproximados). POIs de OpenStreetMap
      (ODbL); proyectos del estudio de mercado 1T26.</div>`;
}

function renderIsoPanel(s, { loading = false, error = null } = {}) {
  const panel = document.getElementById("iso-panel");
  const body = document.getElementById("iso-stats");

  let inner = isoFormHTML(s);
  if (loading) inner += `<div class="iso-loading">Calculando isócronas…</div>`;
  else if (error) inner += `<div class="buffer-warn">⚠ ${error}</div>`;
  else if (s) inner += isoResultsHTML(s);
  body.innerHTML = inner;
  panel.classList.remove("hidden");

  // Selector de modo (Auto / A pie)
  body.querySelectorAll(".iso-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.dataset.mode;
      if (m === isoMode && isoState) return;
      isoMode = m;
      body.querySelectorAll(".iso-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      if (isoState) runIsocronas(isoState.lat, isoState.lng, isoMode, { fit: false });
    });
  });

  // Calcular por coordenadas escritas
  const go = () => {
    const lat = parseFloat(document.getElementById("iso-lat").value);
    const lng = parseFloat(document.getElementById("iso-lng").value);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      alert("Coordenadas inválidas. Ejemplo: lat 21.8823, lng -102.2916");
      return;
    }
    runIsocronas(lat, lng, isoMode);
  };
  const goBtn = document.getElementById("iso-go");
  if (goBtn) goBtn.addEventListener("click", go);
  for (const id of ["iso-lat", "iso-lng"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
}

// Cerrar el panel (✕)
document.getElementById("iso-close").addEventListener("click", () => window.clearIsocronas());
