/* Zona de estudio: dibujar un polígono sobre el mapa y calcular estadísticas
 * de las capas (AGEBs/NSE, catastral, zonas de precio, PDU) dentro de él.
 * Requiere Leaflet.Draw, Turf y Chart.js (cargados en index.html) y las
 * variables globales de main.js (map, DATA, NSE_COLORS...).
 */

"use strict";

const drawnItems = new L.FeatureGroup().addTo(map);
let zoneCharts = { nse: null, cat: null, pob: null };
let currentZone = null;   // Feature<Polygon> dibujado
let currentStats = null;  // resultado de analyzeZone

const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#2f6690", weight: 2.5, fillOpacity: 0.06 },
    },
    polyline: false, rectangle: false, circle: false,
    marker: false, circlemarker: false,
  },
  edit: { featureGroup: drawnItems, edit: false, remove: false },
});
map.addControl(drawControl);

L.drawLocal.draw.toolbar.buttons.polygon = "Dibujar zona de estudio";
L.drawLocal.draw.handlers.polygon.tooltip = {
  start: "Haz clic para empezar a dibujar la zona",
  cont: "Haz clic para continuar el trazo",
  end: "Haz clic en el primer punto para cerrar la zona",
};

map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers();
  drawnItems.addLayer(e.layer);
  setZone(e.layer.toGeoJSON());
});

document.getElementById("zone-close").addEventListener("click", clearZone);

function clearZone() {
  drawnItems.clearLayers();
  currentZone = null;
  currentStats = null;
  window.clearBufferAnalysis?.(false);
  document.getElementById("btn-png").classList.add("hidden");
  document.getElementById("zone-panel").classList.add("hidden");
}

function setZone(polygon) {
  // el panel muestra un análisis a la vez: quitar el buffer si lo hay
  window.clearBufferAnalysis?.(false);
  currentZone = polygon;
  currentStats = analyzeZone(polygon);
  renderZonePanel(currentStats);
}

// ------------------------------------------------------------- estadísticas
function featuresInZone(collection, polygon, mode) {
  const zoneBbox = turf.bbox(polygon);
  const out = [];
  for (const f of collection.features) {
    const fb = turf.bbox(f);
    if (fb[0] > zoneBbox[2] || fb[2] < zoneBbox[0] ||
        fb[1] > zoneBbox[3] || fb[3] < zoneBbox[1]) continue;
    try {
      if (mode === "point") {
        if (turf.booleanPointInPolygon(turf.pointOnFeature(f), polygon)) out.push(f);
      } else {
        if (turf.booleanIntersects(f, polygon)) out.push(f);
      }
    } catch (err) { /* geometría problemática: omitir */ }
  }
  return out;
}

function analyzeZone(polygon) {
  const areaKm2 = turf.area(polygon) / 1e6;

  // AGEBs (por intersección; el NSE/población se toma completo por AGEB)
  const agebs = featuresInZone(DATA.agebs, polygon, "intersects").map((f) => f.properties);
  const pop = agebs.reduce((s, p) => s + (p.POBTOT || 0), 0);
  const nseCounts = {};
  let scoreSum = 0, scoreW = 0, d2 = 0, c3 = 0, nPct = 0;
  for (const p of agebs) {
    nseCounts[p.nse_nivel || "S/D"] = (nseCounts[p.nse_nivel || "S/D"] || 0) + 1;
    if (p.nse_score != null && p.POBTOT) { scoreSum += p.nse_score * p.POBTOT; scoreW += p.POBTOT; }
    if (p.pct_2dorm != null) { d2 += p.pct_2dorm; c3 += p.pct_3cuart || 0; nPct++; }
  }
  // nivel predominante por población
  const popByNivel = {};
  for (const p of agebs) {
    popByNivel[p.nse_nivel] = (popByNivel[p.nse_nivel] || 0) + (p.POBTOT || 0);
  }
  const nivelPred = Object.entries(popByNivel).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  // Colonias con valor catastral (por punto representativo dentro de la zona)
  const cols = featuresInZone(DATA.cat, polygon, "point").map((f) => f.properties);
  const vals = cols.map((c) => c.valor_m2).sort((a, b) => a - b);
  const catStats = vals.length ? {
    n: vals.length,
    min: vals[0],
    max: vals[vals.length - 1],
    avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
    med: vals[Math.floor(vals.length / 2)],
  } : null;

  // Zonas de precio de mercado que tocan la zona
  const priceZones = featuresInZone(DATA.zones, polygon, "intersects").map((f) => f.properties);

  // Usos de suelo (PDU): % del área de la zona por grupo
  const pduShares = {};
  for (const f of featuresInZone(DATA.pdu, polygon, "intersects")) {
    try {
      const inter = turf.intersect(polygon, f);
      if (inter) {
        const g = f.properties.grupo;
        pduShares[g] = (pduShares[g] || 0) + turf.area(inter) / 1e6;
      }
    } catch (err) { /* omitir intersección fallida */ }
  }

  // Proyección de población (CONAPO 1990-2040): dato de contexto a nivel
  // MUNICIPIO completo (no varía dentro del municipio), para los municipios
  // que toca la zona.
  const poblacionMunicipios = resolvePoblacionMunicipios([...new Set(agebs.map((p) => p.municipio))]);

  return {
    areaKm2, nAgebs: agebs.length, pop, nivelPred,
    nseScore: scoreW ? scoreSum / scoreW : null,
    nseCounts, pct2dorm: nPct ? d2 / nPct : null, pct3cuart: nPct ? c3 / nPct : null,
    cols: cols.sort((a, b) => b.valor_m2 - a.valor_m2), catStats,
    priceZones, pduShares, poblacionMunicipios,
  };
}

// ------------------------------------------------------------------- panel
function renderZonePanel(s) {
  const el = document.getElementById("zone-stats");
  const fmt = (n, d = 0) => n == null ? "s/d" : Number(n.toFixed(d)).toLocaleString("es-MX");

  const priceTxt = s.priceZones.length
    ? s.priceZones.map((z) => `${z.zona}: ${fmtMXN(z.precio_m2_min)}–${fmtMXN(z.precio_m2_max)}/m²`).join("<br>")
    : "Fuera de las zonas de mercado";

  const pduTotal = Object.values(s.pduShares).reduce((a, b) => a + b, 0);
  const pduTxt = pduTotal > 0
    ? Object.entries(s.pduShares).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([g, km]) => `${g}: ${Math.round(km / pduTotal * 100)}%`).join(" · ")
    : "Sin cobertura del PDU";

  const pobTxt = s.poblacionMunicipios
    ? Object.entries(s.poblacionMunicipios.municipios)
        .map(([m, v]) => `${m}: ${v.cambio2020FinPct >= 0 ? "+" : ""}${v.cambio2020FinPct}% (2020→${v.anioComparacionFin})`)
        .join(" · ")
    : "s/d";

  el.innerHTML = `
    <div class="zone-cards">
      <div class="zone-card"><div class="zc-label">Superficie</div>
        <div class="zc-value">${fmt(s.areaKm2, 1)} km²</div></div>
      <div class="zone-card"><div class="zc-label">Población (Censo 2020)</div>
        <div class="zc-value">${fmt(s.pop)}</div>
        <div class="zc-sub">${s.nAgebs} AGEBs</div></div>
      <div class="zone-card"><div class="zc-label">NSE predominante</div>
        <div class="zc-value" style="color:${NSE_COLORS[s.nivelPred] || "#333"}">${s.nivelPred}</div>
        <div class="zc-sub">índice ${s.nseScore != null ? s.nseScore.toFixed(2) : "s/d"}</div></div>
      <div class="zone-card"><div class="zc-label">Valor catastral suelo</div>
        <div class="zc-value">${s.catStats ? fmtMXN(s.catStats.avg) : "s/d"}</div>
        <div class="zc-sub">${s.catStats ? `${fmtMXN(s.catStats.min)} – ${fmtMXN(s.catStats.max)} · ${s.catStats.n} colonias` : "sin colonias con valor"}</div></div>
      <div class="zone-card"><div class="zc-label">Viviendas 2+ recámaras</div>
        <div class="zc-value">${s.pct2dorm != null ? s.pct2dorm.toFixed(0) + "%" : "s/d"}</div></div>
      <div class="zone-card"><div class="zc-label">Viviendas 3+ cuartos</div>
        <div class="zc-value">${s.pct3cuart != null ? s.pct3cuart.toFixed(0) + "%" : "s/d"}</div></div>
    </div>
    <div class="zone-list"><strong>Mercado:</strong><br>${priceTxt}</div>
    <div class="zone-list"><strong>Uso de suelo (PDU):</strong> ${pduTxt}</div>
    <div class="zone-list"><strong>Proyección de población (CONAPO)</strong> — dato del municipio
      completo, no de la zona: ${pobTxt}</div>`;

  // mostrar el panel ANTES de crear los charts: con el panel oculto los
  // canvas miden 0x0 y las imágenes para el PDF salen corruptas
  document.getElementById("btn-csv").classList.add("hidden");
  document.getElementById("btn-json").classList.add("hidden");
  document.getElementById("btn-png").classList.remove("hidden");
  document.getElementById("zone-panel").classList.remove("hidden");
  renderZoneCharts(s);
}

function renderZoneCharts(s) {
  for (const k of Object.keys(zoneCharts)) {
    if (zoneCharts[k]) { zoneCharts[k].destroy(); zoneCharts[k] = null; }
  }

  // composición NSE (dona)
  const niveles = Object.keys(NSE_LABELS).filter((n) => s.nseCounts[n]);
  if (niveles.length) {
    zoneCharts.nse = new Chart(document.getElementById("chart-nse"), {
      type: "doughnut",
      data: {
        labels: niveles,
        datasets: [{
          data: niveles.map((n) => s.nseCounts[n]),
          backgroundColor: niveles.map((n) => NSE_COLORS[n]),
          borderWidth: 1,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: "AGEBs por nivel socioeconómico", font: { size: 11 } },
          legend: { position: "right", labels: { boxWidth: 10, font: { size: 9 } } },
        },
      },
    });
  }

  // histograma de valores catastrales
  if (s.catStats) {
    const binSize = 1000;
    const bins = {};
    for (const c of s.cols) {
      const b = Math.floor(c.valor_m2 / binSize) * binSize;
      bins[b] = (bins[b] || 0) + 1;
    }
    const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
    zoneCharts.cat = new Chart(document.getElementById("chart-cat"), {
      type: "bar",
      data: {
        labels: keys.map((k) => "$" + (k / 1000) + "k"),
        datasets: [{ data: keys.map((k) => bins[k]), backgroundColor: "#3182bd" }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: "Colonias por valor catastral ($/m²)", font: { size: 11 } },
          legend: { display: false },
        },
        scales: { y: { ticks: { precision: 0 } } },
      },
    });
  }

  zoneCharts.pob = renderPoblacionChart("chart-pob", s.poblacionMunicipios);
}

// ---------------------------------------------------------------- comparador
const compareList = [];

window.addCompare = function (cvegeo) {
  if (compareList.length >= 4) {
    alert("Máximo 4 colonias en el comparador. Quita alguna primero.");
    return;
  }
  if (compareList.some((c) => c.CVEGEO === cvegeo)) return;
  const f = DATA.cat.features.find((x) => x.properties.CVEGEO === cvegeo);
  if (!f) return;
  const p = { ...f.properties };
  // NSE del AGEB que contiene la colonia
  try {
    const pt = turf.pointOnFeature(f);
    const ageb = DATA.agebs.features.find((a) => turf.booleanPointInPolygon(pt, a));
    p.nse = ageb ? ageb.properties.nse_nivel : "—";
  } catch (err) { p.nse = "—"; }
  compareList.push(p);
  renderCompare();
  map.closePopup();
};

function removeCompare(i) {
  compareList.splice(i, 1);
  renderCompare();
}

function renderCompare() {
  const panel = document.getElementById("compare-panel");
  if (!compareList.length) { panel.classList.add("hidden"); return; }
  const rows = compareList.map((c, i) => `
    <tr>
      <td>${c.TIPO !== "NINGUNO" ? c.TIPO + " " : ""}${c.NOM_ASEN}</td>
      <td>${c.municipio}</td>
      <td><strong>${fmtMXN(c.valor_m2)}/m²</strong></td>
      <td><span class="popup-badge" style="background:${NSE_COLORS[c.nse] || "#9ca3af"}">${c.nse}</span></td>
      <td>${c.CP || "—"}</td>
      <td><button class="cmp-x" onclick="window.removeCompareIdx(${i})">✕</button></td>
    </tr>`).join("");
  document.getElementById("compare-table").innerHTML = `
    <table>
      <tr><th>Colonia</th><th>Municipio</th><th>Catastral</th><th>NSE</th><th>CP</th><th></th></tr>
      ${rows}
    </table>`;
  panel.classList.remove("hidden");
}

window.removeCompareIdx = removeCompare;
document.getElementById("compare-close").addEventListener("click", () => {
  compareList.length = 0;
  renderCompare();
});
