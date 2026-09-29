/* Isócronas: áreas alcanzables por tiempo de traslado desde un punto (clic en
 * el mapa o lat/lng manual), en tres bandas de tiempo ajustables (5/10/15 min
 * por defecto) por modo (Auto o A pie). Sirve para demostrar conectividad: qué
 * tan lejos se llega en X minutos y qué se alcanza dentro de ese tiempo.
 *
 * A diferencia del análisis de Radio (buffer.js), que traza un círculo
 * geométrico con turf, aquí el contorno sigue la red vial real. Como el sitio
 * es 100% estático, eso obliga a un motor de ruteo externo, y se usa uno
 * distinto por modo según cuál da resultados más realistas:
 *
 *   - Auto  -> TomTom "Calculate Reachable Range" (una llamada por banda). Usa
 *              condiciones de tráfico típicas, así que las áreas son mucho más
 *              conservadoras/realistas que las de ORS (que va en velocidad
 *              libre). Clave TOMTOM_API_KEY (config.js, restringida por dominio).
 *   - A pie -> OpenRouteService (una sola llamada trae las tres bandas). TomTom
 *              no puede: su "Reachable Range" es solo motorizado y rechaza el
 *              modo a pie. NO lleva clave en el navegador: pasa por el proxy
 *              propio (ORS_PROXY_URL en config.js, código en proxy/), porque
 *              la clave de ORS no admite restricción por dominio.
 *
 * El resto (banding, dibujo, conteo de conectividad) es igual sin importar el
 * motor: ambos devuelven polígonos anidados P5 ⊂ P10 ⊂ P15.
 *
 * Con las bandas ya calculadas se cuenta qué cae dentro de cada tiempo (POIs
 * por categoría y proyectos de vivienda nueva) como prueba de conectividad.
 *
 * Requiere: turf (CDN), main.js (map, DATA, drawnItems*), config.js
 * (TOMTOM_API_KEY y ORS_PROXY_URL), poi.js (POI_ESTILO, DATA.poi) y proyectos.js
 * (PROYECTOS_SOFTEC). Es excluyente con el análisis de Radio (buffer.js) y de
 * polígono (zona.js): iniciar cualquiera limpia los otros.
 * (*drawnItems/currentZone/currentStats son globales de zona.js — scripts
 *  clásicos con scope compartido.)
 */

"use strict";

const ISO_MODES = {
  car:        { label: "Auto",  engine: "tomtom", tomtom: "car" },
  pedestrian: { label: "A pie", engine: "ors",    ors: "foot-walking" },
  // Para habilitar bici (ORS): cycling: { label: "Bici", engine: "ors", ors: "cycling-regular" }
};
// Paleta tipo semáforo suave: verde = cerca en tiempo, rojo = lejos.
const ISO_COLORS = ["#2a9d8f", "#e9c46a", "#e76f51"]; // banda cercana / media / lejana

// Calibración del modo Auto contra Google Maps (jul 2026). El "Reachable Range"
// de TomTom es más optimista que la realidad: sus puntos de borde a "15 min"
// tardaban en promedio ~18.5 min según Google (medido en 4 direcciones desde el
// centro: N 18, Pte 19, Sur 19, Ote 18). O sea sobreestima el alcance ~1.23×.
// Para corregirlo se le pide a TomTom un presupuesto de tiempo dividido por este
// factor, de modo que la banda de "N min" refleje N minutos reales de manejo.
// Solo aplica a Auto (TomTom); el modo A pie (ORS) no lo necesita.
const ISO_CAR_CALIBRATION = 1.25;

// Suavizado del contorno: el borde crudo de ambos motores sigue cada vía y se ve
// muy "picudo". Se redondea con Chaikin (corta esquinas hacia adentro); no
// cambia el alcance, solo lo hace ver orgánico. Más iteraciones = más redondo.
const ISO_SMOOTH_ITER = 4;

// Bandas de tiempo AJUSTABLES: el usuario elige el tiempo de la banda exterior
// (isoMaxMin) con el slider del panel; las tres bandas son sus tercios. Con
// paso de 3 min los tercios siempre son enteros (15 -> 5/10/15, 9 -> 3/6/9,
// 30 -> 10/20/30). El modelo de ruteo sobreestima la velocidad para el gusto
// local, así que bajar este valor es la forma de calibrar a la realidad de la
// ciudad.
const ISO_MIN_MIN = 3;
const ISO_MAX_MIN = 30;
const ISO_STEP_MIN = 3;
let isoMaxMin = 15; // banda exterior seleccionada (min)
function isoBands() {
  return [isoMaxMin / 3, (isoMaxMin * 2) / 3, isoMaxMin].map((m) => Math.round(m));
}

let isoMode = "car";       // modo seleccionado
let isoState = null;       // análisis activo (null = sin isócronas)
let isoPicking = false;    // esperando clic en el mapa
window.isoPicking = false; // espejo público para main.js (layerClick)

const isoGroup = L.featureGroup().addTo(map);
const isoCache = new Map(); // "lat|lng|mode" -> state

const isoFmt = (n, d = 0) =>
  n == null ? "s/d" : Number(n.toFixed(d)).toLocaleString("es-MX");

// ------------------------------------------------------------------ TomTom
// Un contorno alcanzable (polígono turf) para un presupuesto de tiempo. TomTom
// solo hace modos motorizados, pero a cambio usa tráfico típico -> áreas
// realistas. Una llamada por banda.
async function isoFetchTomtom(lat, lng, travelMode, minutes) {
  const url = `https://api.tomtom.com/routing/1/calculateReachableRange/${lat},${lng}/json?` +
    new URLSearchParams({
      key: TOMTOM_API_KEY,
      travelMode,
      // presupuesto calibrado contra Google (ver ISO_CAR_CALIBRATION)
      timeBudgetInSec: String(Math.round((minutes * 60) / ISO_CAR_CALIBRATION)),
    });
  const resp = await fetch(url);
  if (!resp.ok) {
    let msg = `TomTom respondió ${resp.status}`;
    if (resp.status === 403) msg += " — la clave no tiene habilitado el API de Routing (Reachable Range)";
    else if (resp.status === 429) msg += " — límite de peticiones excedido, intenta en un momento";
    throw new Error(msg + ".");
  }
  const data = await resp.json();
  const boundary = data?.reachableRange?.boundary;
  if (!Array.isArray(boundary) || boundary.length < 3) {
    throw new Error("TomTom no devolvió un contorno válido para este punto.");
  }
  // boundary: [{latitude, longitude}] -> anillo GeoJSON [lng,lat], cerrado
  const ring = boundary.map((p) => [p.longitude, p.latitude]);
  ring.push(ring[0]);
  return turf.polygon([ring]);
}

// Las tres bandas por TomTom, en paralelo (una llamada cada una).
function isoFetchTomtomBands(lat, lng, travelMode, minutes) {
  return Promise.all(minutes.map((m) => isoFetchTomtom(lat, lng, travelMode, m)));
}

// --------------------------------------------------- despertar el proxy
/* El proxy corre en el plan gratuito de Render, que duerme el servicio tras
 * ~15 min sin tráfico; despertarlo tarda cerca de un minuto. Para que ese
 * minuto no se lo coma el usuario DESPUÉS de pedir el análisis, se manda un
 * GET /salud en cuanto se abre el panel o se elige "A pie": el contenedor
 * arranca mientras la persona todavía está eligiendo el punto en el mapa.
 *
 * Es solo un empujón, no una garantía: si el servicio estaba dormido y el
 * clic llega enseguida, la primera isócrona del día seguirá tardando. No se
 * espera la respuesta ni se reporta el fallo — no hay nada que el usuario
 * pueda hacer con ese dato. */
let isoUltimoPing = 0;
function isoDespertarProxy() {
  if (typeof ORS_PROXY_URL !== "string" || !ORS_PROXY_URL) return;
  const ahora = Date.now();
  if (ahora - isoUltimoPing < 120_000) return; // ya se despertó hace poco
  isoUltimoPing = ahora;
  fetch(`${ORS_PROXY_URL}/salud`, { method: "GET", mode: "cors" }).catch(() => {});
}

// ------------------------------------------------------- OpenRouteService
// Las tres bandas (polígonos turf) en una sola llamada. ORS devuelve un
// Feature por cada valor de `range`; cada uno es el área COMPLETA alcanzable
// en ese tiempo (anidados: P5 ⊂ P10 ⊂ P15).
async function isoFetchBands(lat, lng, profile, minutes) {
  // Va al proxy propio, no a ORS: la clave de ORS no admite restricción por
  // dominio, así que vive en el servidor (ver proxy/ y web/config.js). El
  // proxy arma el cuerpo real para ORS; aquí solo se manda lo mínimo.
  const resp = await fetch(`${ORS_PROXY_URL}/isocronas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, minutos: minutes, perfil: profile }),
  });
  if (!resp.ok) {
    // El proxy contesta {error} en español y ya traducido; si por lo que sea
    // no viene JSON, se cae a un mensaje genérico con el código.
    let detail = "";
    try { const j = await resp.json(); detail = typeof j?.error === "string" ? j.error : ""; } catch (e) { /* cuerpo no-JSON */ }
    if (detail) throw new Error(detail);
    let msg = `El servicio de isócronas a pie respondió ${resp.status}`;
    if (resp.status === 403) msg += " — el sitio no está en la lista de orígenes permitidos del proxy";
    else if (resp.status === 503) msg += " — al proxy le falta la clave ORS_API_KEY en su entorno";
    throw new Error(msg + ".");
  }
  const gj = await resp.json();
  const feats = (gj.features || []).slice()
    .sort((a, b) => (a.properties?.value || 0) - (b.properties?.value || 0));
  if (feats.length < minutes.length) {
    throw new Error("OpenRouteService no devolvió todas las bandas para este punto.");
  }
  return feats; // Features<Polygon|MultiPolygon> ascendentes por tiempo
}

// -------------------------------------------------------------- suavizado
// Chaikin sobre un anillo cerrado: cada arista se parte en dos puntos (1/4 y
// 3/4), redondeando las esquinas. El anillo entra y sale cerrado (primer punto
// repetido al final).
function isoChaikinRing(ring, iterations) {
  let pts = ring.slice(0, -1); // quitar el vértice de cierre duplicado
  if (pts.length < 3) return ring;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    pts = out;
  }
  pts.push(pts[0]); // re-cerrar
  return pts;
}

// Suaviza un Feature Polygon o MultiPolygon (todos sus anillos).
function isoSmoothPoly(feat, iterations) {
  const g = feat.geometry;
  try {
    if (g.type === "Polygon") {
      return turf.polygon(g.coordinates.map((r) => isoChaikinRing(r, iterations)));
    }
    if (g.type === "MultiPolygon") {
      return turf.multiPolygon(g.coordinates.map((poly) => poly.map((r) => isoChaikinRing(r, iterations))));
    }
  } catch (e) { /* geometría rara: devolver el original sin suavizar */ }
  return feat;
}

// --------------------------------------------------------------- análisis
async function analyzeIso(lat, lng, mode, minutes) {
  const key = `${lat.toFixed(6)}|${lng.toFixed(6)}|${mode}|${minutes.join(",")}`;
  if (isoCache.has(key)) return isoCache.get(key);

  // polys[i] = área alcanzable en minutes[i] min (anidadas: P0 ⊂ P1 ⊂ P2).
  // El motor depende del modo: Auto -> TomTom (con tráfico), A pie -> ORS.
  const cfg = ISO_MODES[mode];
  const raw = cfg.engine === "tomtom"
    ? await isoFetchTomtomBands(lat, lng, cfg.tomtom, minutes)
    : await isoFetchBands(lat, lng, cfg.ors, minutes);
  // Suavizar el contorno crudo (se ve muy "picudo" siguiendo cada vía). Se usa
  // el suavizado para dibujar y para contar, así lo que se ve y lo que se cuenta
  // coinciden.
  const polys = raw.map((p) => isoSmoothPoly(p, ISO_SMOOTH_ITER));

  // Bandas disjuntas para dibujar (anillo = polígono menos el interior) — así
  // los colores no se suman al traslaparse. Si turf.difference falla, se usa
  // el polígono completo (se verá el traslape, pero no rompe).
  const bands = minutes.map((min, i) => {
    let display = polys[i];
    if (i > 0) {
      try {
        const diff = turf.difference(polys[i], polys[i - 1]);
        if (diff) display = diff;
      } catch (e) { /* geometría problemática: dejar el polígono completo */ }
    }
    return { min, color: ISO_COLORS[i], display, full: polys[i], areaKm2: turf.area(polys[i]) / 1e6 };
  });

  const reach = analyzeReach(polys, minutes);
  const state = { lat, lng, mode, minutes, bands, reach };
  isoCache.set(key, state);
  if (isoCache.size > 20) isoCache.delete(isoCache.keys().next().value);
  return state;
}

function isoPointInPoly(lng, lat, poly) {
  try { return turf.booleanPointInPolygon(turf.point([lng, lat]), poly); }
  catch (e) { return false; }
}

// Conectividad: qué se alcanza dentro de cada banda (conteos acumulados).
function analyzeReach(polys, minutes) {
  // Índice de la banda más chica que contiene el punto (-1 = fuera de todo).
  const bandIndexFor = (lng, lat) => {
    for (let i = 0; i < polys.length; i++) if (isoPointInPoly(lng, lat, polys[i])) return i;
    return -1;
  };

  // POIs por categoría: conteo acumulado por banda [≤b0, ≤b1, ≤b2].
  const poi = {};
  const poisDisponibles = !!DATA.poi;
  if (poisDisponibles) {
    for (const cat of Object.keys(POI_ESTILO)) poi[cat] = polys.map(() => 0);
    for (const f of DATA.poi.features) {
      const [lng, lat] = f.geometry.coordinates;
      const bi = bandIndexFor(lng, lat);
      if (bi < 0) continue;
      const cat = f.properties.categoria;
      if (!poi[cat]) continue;
      for (let i = bi; i < polys.length; i++) poi[cat][i]++;
    }
  }

  // Proyectos de vivienda nueva alcanzables, con el tiempo mínimo para llegar.
  const proyectos = [];
  for (const p of PROYECTOS_SOFTEC) {
    const bi = bandIndexFor(p.lon, p.lat);
    if (bi < 0) continue;
    proyectos.push({ nombre: p.nombre, tipo: p.tipo, minutos: minutes[bi] });
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
  const cfg = ISO_MODES[mode];
  if (cfg.engine === "tomtom" && (typeof TOMTOM_API_KEY !== "string" || !TOMTOM_API_KEY)) {
    renderIsoPanel(null, { error: "Falta la clave de TomTom en <code>config.js</code> para el modo Auto." });
    return;
  }
  if (cfg.engine === "ors" && (typeof ORS_PROXY_URL !== "string" || !ORS_PROXY_URL)) {
    renderIsoPanel(null, {
      error: 'El modo A pie necesita el proxy de OpenRouteService. Configura ' +
        '<code>ORS_PROXY_URL</code> en <code>web/config.js</code> con la URL del ' +
        'servicio (ver <code>proxy/</code> y el README).',
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
  const minutes = isoBands();
  const btn = document.getElementById("btn-iso");
  btn.classList.add("active", "loading");
  renderIsoPanel(isoState, { loading: true });

  analyzeIso(lat, lng, mode, minutes)
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
  document.getElementById("btn-iso-report").classList.add("hidden");
  document.getElementById("btn-iso-png").classList.add("hidden");
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
  isoDespertarProxy(); // el modo A pie puede necesitarlo; ver isoDespertarProxy
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
      <div class="bf-slider-wrap">
        <div class="bf-slider-header">
          <span class="bf-slider-label">Tiempo máx.</span>
          <span class="bf-slider-value" id="iso-max-val">${isoMaxMin} min · bandas ${isoBands().join("/")}</span>
        </div>
        <input class="bf-slider iso-slider" id="iso-max" type="range"
               min="${ISO_MIN_MIN}" max="${ISO_MAX_MIN}" step="${ISO_STEP_MIN}" value="${isoMaxMin}">
        <div class="bf-slider-ticks"><span>3</span><span>9</span><span>15</span><span>21</span><span>30 min</span></div>
      </div>
      ${s ? "" : `<div class="bf-hint">Haz clic en el mapa para elegir el punto, o escribe las coordenadas. Ajusta el tiempo con el control: baja los minutos si el alcance se ve optimista para el tráfico real.</div>`}
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
    const m = s.minutes;
    poiBlock = rows
      ? `<div class="zone-list"><strong>Servicios alcanzables (POIs, acumulado):</strong></div>
         <div class="buffer-table-wrap"><table class="buffer-table iso-table">
           <tr><th>Categoría</th><th>≤${m[0]}</th><th>≤${m[1]}</th><th>≤${m[2]} min</th></tr>${rows}
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
    <div class="zone-note">${s.mode === "car"
      ? "Isócronas en auto: TomTom sobre la red vial real, con tráfico típico y <strong>calibrado contra Google Maps</strong> para Aguascalientes (×1.25)."
      : "Isócronas a pie: OpenRouteService sobre la red vial de OpenStreetMap (velocidad de caminata)."}
      Cada banda es el área alcanzable en ≤ N minutos desde el punto, puerta a puerta — útil para
      comparar conectividad entre zonas, no como hora de llegada exacta. POIs de OpenStreetMap
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

  // Exportaciones: solo con un análisis terminado (durante la carga `s` es el
  // resultado anterior, que ya no corresponde a lo dibujado).
  const hayResultados = !!s && !loading && !error;
  document.getElementById("btn-iso-report").classList.toggle("hidden", !hayResultados);
  document.getElementById("btn-iso-png").classList.toggle("hidden", !hayResultados);

  // Selector de modo (Auto / A pie)
  body.querySelectorAll(".iso-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.dataset.mode;
      if (m === isoMode && isoState) return;
      isoMode = m;
      if (ISO_MODES[m]?.engine === "ors") isoDespertarProxy();
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

  // Slider de tiempo máximo: arrastrar cambia las 3 bandas; al soltar, recalcula.
  const slider = document.getElementById("iso-max");
  const sliderVal = document.getElementById("iso-max-val");
  if (slider) {
    const setFill = () => slider.style.setProperty("--val", slider.value);
    setFill();
    slider.addEventListener("input", () => {
      isoMaxMin = Number(slider.value);
      sliderVal.textContent = `${isoMaxMin} min · bandas ${isoBands().join("/")}`;
      setFill();
    });
    slider.addEventListener("change", () => {
      isoMaxMin = Number(slider.value);
      if (isoState) runIsocronas(isoState.lat, isoState.lng, isoMode, { fit: false });
    });
  }
}

// Cerrar el panel (✕)
document.getElementById("iso-close").addEventListener("click", () => window.clearIsocronas());
