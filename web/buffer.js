/* Análisis de zona de influencia: buffer circular alrededor de un punto
 * (clic en el mapa o lat/lng manual) con radio de 1/2/3/5 km.
 *
 * Calcula, para todo lo que cae dentro del círculo:
 *   - Demográficos del Censo 2020 por interpolación areal (cada AGEB aporta
 *     sus variables ponderadas por la fracción de su área dentro del buffer,
 *     asumiendo distribución uniforme). Ver web/buffer-core.js.
 *   - Distribución de población por NSE (proxy propio, no AMAI).
 *   - % del área del buffer sin AGEB urbana 2020 (advertencia si supera 25%).
 *   - Colonias catastrales que intersectan, con valor de suelo 2026.
 *   - Usos de suelo PDU (% del área por grupo, indicando programa de origen).
 *   - Proyectos de vivienda nueva y POIs dentro del radio.
 *
 * Se integra al panel "Zona de estudio" (zona.js) y al PDF (reporte.js).
 * Requiere turf (CDN), main.js (map, DATA), poi.js (POI_ESTILO, DATA.poi) y
 * proyectos.js (PROYECTOS_SOFTEC). Los resultados se cachean por
 * (lat, lng, radio) para no recalcular al alternar radios o capas.
 */

"use strict";

const BUFFER_RADII = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
let bufferRadius = 3;          // radio seleccionado (km)
let bufferStats = null;        // análisis activo (null = sin buffer)
let bufferPicking = false;     // esperando clic en el mapa
window.bufferPicking = false;  // espejo público para main.js

const bufferGroup = L.featureGroup().addTo(map);
const bufferCache = new Map(); // "lat|lng|radio" -> stats
let bufferDragPreview = null; // círculo ligero mostrado mientras se arrastra el centro

// Vive en buffer-core.js (single source of truth, la usa también el JSON)
const NOTA_METODO_BUFFER = BufferCore.NOTA_METODO_BUFFER;

// --------------------------------------------------------------- geometría
function bufferCircle(lat, lng, radiusKm) {
  return turf.circle([lng, lat], radiusKm, { steps: 96, units: "kilometers" });
}

function featureBbox(f) {
  if (!f.__bbox) f.__bbox = turf.bbox(f);
  return f.__bbox;
}

function bboxesOverlap(a, b) {
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

function analyzeBuffer(lat, lng, radiusKm) {
  const key = `${lat.toFixed(6)}|${lng.toFixed(6)}|${radiusKm}`;
  if (bufferCache.has(key)) return bufferCache.get(key);

  const circle = bufferCircle(lat, lng, radiusKm);
  const circleBbox = turf.bbox(circle);
  const areaKm2 = turf.area(circle) / 1e6;
  const centerPt = turf.point([lng, lat]);

  // AGEBs: intersección con fracción de área (interpolación areal)
  const agebRows = [];
  let agebAreaKm2 = 0;
  for (const f of DATA.agebs.features) {
    if (!bboxesOverlap(featureBbox(f), circleBbox)) continue;
    let inter = null;
    try { inter = turf.intersect(circle, f); } catch (err) { continue; }
    if (!inter) continue;
    const aIn = turf.area(inter) / 1e6;
    if (!(aIn > 0)) continue;
    const aTot = turf.area(f) / 1e6;
    agebRows.push({
      frac: aTot > 0 ? Math.min(1, aIn / aTot) : 0,
      areaKm2: aIn,
      props: f.properties,
      feature: f,
    });
    agebAreaKm2 += aIn;
  }
  const demo = BufferCore.aggregateDemographics(agebRows);
  const pctSinAgeb = BufferCore.coverageSinAgeb(agebAreaKm2, areaKm2);

  // Proyección de población (CONAPO 1990-2040): dato de contexto a nivel
  // MUNICIPIO completo (no varía dentro del municipio), para los municipios
  // que toca el buffer.
  const poblacionMunicipios = resolvePoblacionMunicipios([...new Set(agebRows.map((r) => r.props.municipio))]);

  // Colonias catastrales que intersectan el buffer
  const colonias = [];
  for (const f of DATA.cat.features) {
    if (!bboxesOverlap(featureBbox(f), circleBbox)) continue;
    try {
      if (turf.booleanIntersects(f, circle)) colonias.push(f.properties);
    } catch (err) { /* geometría problemática: omitir */ }
  }
  colonias.sort((a, b) => (b.valor_m2 || 0) - (a.valor_m2 || 0));
  const catStats = BufferCore.catastralStats(colonias.map((c) => c.valor_m2));

  // Usos de suelo PDU: km² por grupo dentro del buffer, desglosado por programa
  const pdu = {};
  let pduAreaKm2 = 0;
  for (const f of DATA.pdu.features) {
    if (!bboxesOverlap(featureBbox(f), circleBbox)) continue;
    let inter = null;
    try { inter = turf.intersect(circle, f); } catch (err) { continue; }
    if (!inter) continue;
    const km2 = turf.area(inter) / 1e6;
    if (!(km2 > 0)) continue;
    const g = f.properties.grupo || "Otro";
    if (!pdu[g]) pdu[g] = { km2: 0, programas: {} };
    pdu[g].km2 += km2;
    const prog = f.properties.programa || "—";
    pdu[g].programas[prog] = (pdu[g].programas[prog] || 0) + km2;
    pduAreaKm2 += km2;
  }

  // Proyectos de vivienda nueva dentro del radio (distancia geodésica al centro)
  const proyectos = PROYECTOS_SOFTEC
    .map((p) => ({
      nombre: p.nombre, tipo: p.tipo,
      distKm: turf.distance(centerPt, turf.point([p.lon, p.lat])),
    }))
    .filter((p) => p.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm);

  // POIs por categoría dentro del radio
  const pois = {};
  for (const cat of Object.keys(POI_ESTILO)) pois[cat] = 0;
  const poisDisponibles = !!DATA.poi;
  if (poisDisponibles) {
    for (const f of DATA.poi.features) {
      if (turf.distance(centerPt, f) > radiusKm) continue;
      const cat = f.properties.categoria;
      if (pois[cat] != null) pois[cat]++;
    }
  }

  const stats = {
    lat, lng, radiusKm, areaKm2, agebRows, agebAreaKm2, pctSinAgeb,
    demo, poblacionMunicipios, colonias, catStats, pdu, pduAreaKm2, proyectos, pois, poisDisponibles,
  };
  bufferCache.set(key, stats);
  if (bufferCache.size > 30) bufferCache.delete(bufferCache.keys().next().value);
  return stats;
}

// ------------------------------------------------------------------ dibujo
function drawBuffer(stats) {
  bufferGroup.clearLayers();

  // resaltado ligero de las AGEBs intersectadas
  for (const r of stats.agebRows) {
    L.geoJSON(r.feature, {
      interactive: false,
      style: {
        color: "#2f6690", weight: 1.3, dashArray: "4 3",
        fillColor: "#2f6690", fillOpacity: 0.07,
      },
    }).addTo(bufferGroup);
  }

  L.geoJSON(bufferCircle(stats.lat, stats.lng, stats.radiusKm), {
    interactive: false,
    style: { color: "#1c2a3a", weight: 2.5, fillColor: "#2f6690", fillOpacity: 0.05 },
  }).addTo(bufferGroup);

  // L.circleMarker es un Path (SVG): Leaflet core no lo hace arrastrable sin
  // el plugin Path.Drag. Se usa un L.Marker con un icono que se ve igual —
  // L.Marker sí soporta `draggable` de forma nativa.
  const centerMarker = L.marker([stats.lat, stats.lng], {
    icon: L.divIcon({ className: "buffer-center-marker", iconSize: [16, 16], iconAnchor: [8, 8] }),
    draggable: true,
    keyboard: false,
    title: "Arrastra para mover el radio",
  }).addTo(bufferGroup);
  centerMarker.on("dragstart", onBufferCenterDragStart);
  centerMarker.on("drag", onBufferCenterDrag);
  centerMarker.on("dragend", onBufferCenterDragEnd);
}

// arrastrar el punto central: mueve el radio a la nueva ubicación. Durante el
// arrastre se muestra un círculo simple (barato) en vez de recalcular todo en
// cada frame; el análisis completo se recalcula solo al soltar.
function onBufferCenterDragStart(e) {
  bufferDragPreview = L.circle(e.target.getLatLng(), {
    radius: bufferRadius * 1000,
    interactive: false,
    color: "#1c2a3a", weight: 2, dashArray: "5 4", fillColor: "#2f6690", fillOpacity: 0.05,
  }).addTo(bufferGroup);
}

function onBufferCenterDrag(e) {
  if (bufferDragPreview) bufferDragPreview.setLatLng(e.target.getLatLng());
}

function onBufferCenterDragEnd(e) {
  if (bufferDragPreview) { bufferGroup.removeLayer(bufferDragPreview); bufferDragPreview = null; }
  const { lat, lng } = e.target.getLatLng();
  runBufferAnalysis(lat, lng, bufferRadius, { fit: false });
}

// --------------------------------------------------------------- ejecución
function runBufferAnalysis(lat, lng, radiusKm, { fit = true } = {}) {
  if (!DATA.agebs || !DATA.cat) {
    alert("Los datos del mapa aún se están cargando. Intenta en unos segundos.");
    return;
  }
  if (!DATA.pdu) {
    // el PDU se descarga bajo demanda: pedirlo y reintentar el análisis al llegar
    window.ensurePdu()
      .then(() => runBufferAnalysis(lat, lng, radiusKm, { fit }))
      .catch((err) => alert(err.message));
    return;
  }
  stopBufferPicking();
  // el panel muestra un análisis a la vez: quitar el polígono dibujado y las
  // isócronas si las hay
  window.clearIsocronas?.();
  drawnItems.clearLayers();
  currentZone = null;
  currentStats = null;

  bufferRadius = radiusKm;
  document.getElementById("btn-buffer").classList.add("active");
  bufferStats = analyzeBuffer(lat, lng, radiusKm);
  drawBuffer(bufferStats);
  renderBufferPanel(bufferStats);
  // animate:false — un redibujo inmediato (p.ej. cambiar de radio) durante la
  // animación de zoom deja el mapa en un estado de zoom incorrecto
  if (fit) map.fitBounds(bufferGroup.getBounds(), { padding: [30, 30], animate: false });
  window.plActualizar?.();
}

window.getBufferStats = () => bufferStats;

window.clearBufferAnalysis = function (hidePanel = true) {
  bufferGroup.clearLayers();
  bufferStats = null;
  stopBufferPicking();
  document.getElementById("btn-buffer").classList.remove("active");
  document.getElementById("btn-csv").classList.add("hidden");
  document.getElementById("btn-json").classList.add("hidden");
  document.getElementById("btn-png").classList.add("hidden");
  if (hidePanel && !currentZone) {
    document.getElementById("zone-panel").classList.add("hidden");
  }
  window.plActualizar?.();
};

// ------------------------------------------------------- selección del punto
function onBufferMapClick(e) {
  if (!bufferPicking) return;
  map.closePopup();
  runBufferAnalysis(e.latlng.lat, e.latlng.lng, bufferRadius);
}
window.onBufferMapClick = onBufferMapClick;

function startBufferPicking() {
  bufferPicking = true;
  window.bufferPicking = true;
  document.body.classList.add('buffer-picking');
  map.getContainer().style.cursor = "crosshair";
  map.on("click", onBufferMapClick);
}

function stopBufferPicking() {
  bufferPicking = false;
  window.bufferPicking = false;
  document.body.classList.remove('buffer-picking');
  map.getContainer().style.cursor = "";
  map.off("click", onBufferMapClick);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && bufferPicking) stopBufferPicking();
});

const btnBuffer = document.getElementById("btn-buffer");
btnBuffer.addEventListener("click", () => {
  if (bufferStats || bufferPicking) {
    window.clearBufferAnalysis();
    return;
  }
  btnBuffer.classList.add("active");
  // quitar el polígono dibujado y las isócronas: el panel muestra un análisis a la vez
  window.clearIsocronas?.();
  drawnItems.clearLayers();
  currentZone = null;
  currentStats = null;
  startBufferPicking();
  renderBufferPanel(null); // solo el formulario, sin resultados aún
});

// ------------------------------------------------------------------- panel
const bfFmt = (n, d = 0) =>
  n == null ? "s/d" : Number(n.toFixed(d)).toLocaleString("es-MX");
const bfPct = (n, d = 1) => (n == null ? "s/d" : n.toFixed(d) + "%");

function bufferFormHTML(s) {
  const lat = s ? s.lat.toFixed(6) : "";
  const lng = s ? s.lng.toFixed(6) : "";
  const r = bufferRadius;
  return `
    <div class="buffer-form">
      <div class="bf-row">
        <label>Lat <input id="buf-lat" type="number" step="any" placeholder="21.9489" value="${lat}"></label>
        <label>Lng <input id="buf-lng" type="number" step="any" placeholder="-102.2963" value="${lng}"></label>
        <button id="buf-go" title="Analizar estas coordenadas">Analizar</button>
      </div>
      <div class="bf-slider-wrap">
        <div class="bf-slider-header">
          <span class="bf-slider-label">Radio</span>
          <span class="bf-slider-value" id="buf-radius-val">${r} km</span>
        </div>
        <input class="bf-slider" id="buf-radius" type="range"
               min="0.5" max="10" step="0.5" value="${r}">
        <div class="bf-slider-ticks">
          <span>0.5</span><span>2.5</span><span>5</span><span>7.5</span><span>10 km</span>
        </div>
      </div>
      ${s ? "" : `<div class="bf-hint">Haz clic en el mapa para colocar el punto, o escribe las coordenadas.</div>`}
    </div>`;
}

function bufferResultsHTML(s) {
  const d = s.demo;

  const warn = s.pctSinAgeb != null && s.pctSinAgeb > 25 ? `
    <div class="buffer-warn">⚠ El ${bfFmt(s.pctSinAgeb)}% del área del radio no tiene
      AGEB urbana 2020 (fraccionamientos nuevos o zona rural en ese censo): los
      agregados demográficos <strong>subestiman</strong> la población actual de la zona.</div>` : "";

  const nseRows = Object.keys(NSE_LABELS)
    .filter((n) => d.nsePct[n] != null)
    .map((n) => `<span class="bf-nse"><span class="legend-dot" style="background:${NSE_COLORS[n]}"></span>${n} ${bfPct(d.nsePct[n], 0)}</span>`)
    .join(" ");

  const catTable = s.colonias.length ? `
    <div class="buffer-table-wrap"><table class="buffer-table">
      <tr><th>Colonia</th><th>Mpio.</th><th>$/m²</th></tr>
      ${s.colonias.slice(0, 12).map((c) => `
        <tr><td>${c.TIPO !== "NINGUNO" ? c.TIPO + " " : ""}${c.NOM_ASEN}</td>
        <td>${(c.municipio || "").slice(0, 3)}.</td>
        <td><strong>${fmtMXN(c.valor_m2)}</strong></td></tr>`).join("")}
    </table>${s.colonias.length > 12 ? `<div class="bf-more">… y ${s.colonias.length - 12} colonias más (ver CSV/PDF)</div>` : ""}</div>`
    : `<div class="zone-list">Sin colonias con valor catastral en el radio.</div>`;

  const pduTxt = Object.entries(s.pdu).sort((a, b) => b[1].km2 - a[1].km2)
    .map(([g, v]) => {
      const progs = Object.entries(v.programas).sort((a, b) => b[1] - a[1])
        .map(([p, km]) => `${p}: ${bfPct(km / s.areaKm2 * 100, 0)}`).join(", ");
      return `<div class="bf-pdu-row"><strong>${g}</strong> ${bfPct(v.km2 / s.areaKm2 * 100, 0)}
        <span class="bf-pdu-prog">(${progs})</span></div>`;
    }).join("");
  const sinPdu = Math.max(0, 100 - s.pduAreaKm2 / s.areaKm2 * 100);

  const proyTxt = s.proyectos.length ? s.proyectos.map((p) => `
    <div class="bf-proy-row"><span class="legend-dot" style="background:${p.tipo === "vertical" ? "#2f6690" : "#2a9d8f"}"></span>
      ${p.nombre} <span class="bf-pdu-prog">${p.tipo} · ${p.distKm.toFixed(2)} km</span></div>`).join("")
    : `<div class="zone-list">Sin proyectos del estudio 1T26 en el radio.</div>`;

  const poiTxt = s.poisDisponibles
    ? Object.entries(s.pois).map(([cat, n]) => `${cat} <strong>${n}</strong>`).join(" · ")
    : "POIs aún no cargados";

  const pobTxt = s.poblacionMunicipios
    ? Object.entries(s.poblacionMunicipios.municipios)
        .map(([m, v]) => `${m}: ${v.cambio2020FinPct >= 0 ? "+" : ""}${v.cambio2020FinPct}% (2020→${v.anioComparacionFin})`)
        .join(" · ")
    : "s/d";

  return `
    ${warn}
    <div class="zone-cards">
      <div class="zone-card"><div class="zc-label">Población estimada</div>
        <div class="zc-value">${bfFmt(d.pop)}</div>
        <div class="zc-sub">${s.agebRows.length} AGEBs (interp. areal)</div></div>
      <div class="zone-card"><div class="zc-label">Viviendas habitadas</div>
        <div class="zc-value">${bfFmt(d.viviendas)}</div>
        <div class="zc-sub">estimadas en el radio</div></div>
      <div class="zone-card"><div class="zc-label">NSE predominante</div>
        <div class="zc-value" style="color:${NSE_COLORS[d.nivelPred] || "#333"}">${d.nivelPred || "—"}</div>
        <div class="zc-sub">por población</div></div>
      <div class="zone-card"><div class="zc-label">Sin AGEB 2020</div>
        <div class="zc-value">${bfPct(s.pctSinAgeb, 0)}</div>
        <div class="zc-sub">del área del radio</div></div>
      <div class="zone-card"><div class="zc-label">Escolaridad promedio</div>
        <div class="zc-value">${d.escolaridad != null ? d.escolaridad.toFixed(1) + " años" : "s/d"}</div></div>
      <div class="zone-card"><div class="zc-label">Ocupantes por cuarto</div>
        <div class="zc-value">${d.ocupCuarto != null ? d.ocupCuarto.toFixed(2) : "s/d"}</div></div>
    </div>
    <div class="zone-list bf-grid2">
      <span>Con internet <strong>${bfPct(d.pctInter)}</strong></span>
      <span>Con computadora <strong>${bfPct(d.pctPc)}</strong></span>
      <span>Con automóvil <strong>${bfPct(d.pctAuto)}</strong></span>
      <span>Servicios completos <strong>${bfPct(d.pctServ)}</strong></span>
      <span>2+ recámaras <strong>${bfPct(d.pct2dorm)}</strong></span>
      <span>3+ cuartos <strong>${bfPct(d.pct3cuart)}</strong></span>
    </div>
    <div class="zone-list"><strong>NSE (% de población):</strong><br>${nseRows || "s/d"}</div>
    <div class="zone-list"><strong>Valor catastral suelo 2026</strong>
      ${s.catStats ? `· ${s.catStats.n} colonias · min ${fmtMXN(s.catStats.min)} ·
      mediana ${fmtMXN(Math.round(s.catStats.med))} · max ${fmtMXN(s.catStats.max)} /m²` : ""}
    </div>
    ${catTable}
    <div class="zone-list"><strong>Uso de suelo (PDU, % del radio):</strong>
      ${pduTxt || "Sin cobertura de PDU"}
      ${sinPdu >= 1 ? `<div class="bf-pdu-row">Sin zonificación: ${bfPct(sinPdu, 0)}</div>` : ""}
    </div>
    <div class="zone-list"><strong>Vivienda nueva (${s.proyectos.length} proyectos, 1T26):</strong>${proyTxt}</div>
    <div class="zone-list"><strong>POIs en el radio:</strong><br>${poiTxt}</div>
    <div class="zone-list"><strong>Proyección de población (CONAPO)</strong> — dato del municipio
      completo, no del radio: ${pobTxt}</div>
    <div class="zone-note">${NOTA_METODO_BUFFER}</div>`;
}

function renderBufferPanel(s) {
  const el = document.getElementById("zone-stats");
  el.innerHTML = bufferFormHTML(s) + (s ? bufferResultsHTML(s) : "");
  document.getElementById("btn-csv").classList.toggle("hidden", !s);
  document.getElementById("btn-json").classList.toggle("hidden", !s);
  document.getElementById("btn-png").classList.toggle("hidden", !s);
  document.getElementById("zone-panel").classList.remove("hidden");

  // interacción del formulario
  const go = () => {
    const lat = parseFloat(document.getElementById("buf-lat").value);
    const lng = parseFloat(document.getElementById("buf-lng").value);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      alert("Coordenadas inválidas. Ejemplo: lat 21.9489, lng -102.2963");
      return;
    }
    runBufferAnalysis(lat, lng, bufferRadius);
  };
  document.getElementById("buf-go").addEventListener("click", go);
  for (const id of ["buf-lat", "buf-lng"]) {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  }
  // Slider de radio
  const slider = el.querySelector('#buf-radius');
  const valLabel = el.querySelector('#buf-radius-val');

  function updateSliderFill(s) {
    s.style.setProperty('--val', s.value);
  }
  updateSliderFill(slider); // inicializar color del track

  slider.addEventListener('input', () => {
    bufferRadius = Number(slider.value);
    valLabel.textContent = bufferRadius % 1 === 0 ? bufferRadius + ' km' : bufferRadius.toFixed(1) + ' km';
    updateSliderFill(slider);
  });
  slider.addEventListener('change', () => {
    bufferRadius = Number(slider.value);
    if (bufferStats) {
      runBufferAnalysis(bufferStats.lat, bufferStats.lng, bufferRadius, { fit: true });
    }
  });

  renderBufferCharts(s);
}

function renderBufferCharts(s) {
  // reutiliza los canvas y el registro zoneCharts de zona.js (el PDF los lee)
  for (const k of Object.keys(zoneCharts)) {
    if (zoneCharts[k]) { zoneCharts[k].destroy(); zoneCharts[k] = null; }
  }
  if (!s) return;

  const niveles = Object.keys(NSE_LABELS).filter((n) => s.demo.nsePct[n] != null);
  if (niveles.length) {
    zoneCharts.nse = new Chart(document.getElementById("chart-nse"), {
      type: "doughnut",
      data: {
        labels: niveles,
        datasets: [{
          data: niveles.map((n) => Number(s.demo.nsePct[n].toFixed(1))),
          backgroundColor: niveles.map((n) => NSE_COLORS[n]),
          borderWidth: 1,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: "Población por NSE (%, interp. areal)", font: { size: 11 } },
          legend: { position: "right", labels: { boxWidth: 10, font: { size: 9 } } },
        },
      },
    });
  }

  if (s.catStats) {
    const binSize = 1000;
    const bins = {};
    for (const c of s.colonias) {
      if (c.valor_m2 == null) continue;
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

// --------------------------------------------------------------------- CSV
// bufferCSVRows/buildZonaAgregados/buildZonaEstudioJSON viven en
// buffer-core.js (pure, testeables en Node) — aquí solo se consumen.
const csvEscape = BufferCore.csvEscape;
const bufferCSVRows = BufferCore.bufferCSVRows;

function exportBufferCSV() {
  if (!bufferStats) return;
  const csv = bufferCSVRows(bufferStats)
    .map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `zona-influencia_${bufferStats.lat.toFixed(5)}_${bufferStats.lng.toFixed(5)}_${bufferStats.radiusKm}km.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

document.getElementById("btn-csv").addEventListener("click", exportBufferCSV);

// --------------------------------------------------------------------- JSON
// Mismo objeto (buildZonaAgregados) que arma el CSV — ver
// CONTRATO_ZONA_ESTUDIO.md para el esquema documentado y schema_version.
function exportBufferJSON() {
  if (!bufferStats) return;
  const json = BufferCore.buildZonaEstudioJSON(bufferStats);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `zona-influencia_${bufferStats.lat.toFixed(5)}_${bufferStats.lng.toFixed(5)}_${bufferStats.radiusKm}km.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

document.getElementById("btn-json").addEventListener("click", exportBufferJSON);
