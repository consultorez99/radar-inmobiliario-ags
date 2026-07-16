/* Radar Inmobiliario · Aguascalientes
 * Mapa Leaflet con dos capas choropleth (NSE estimado por AGEB y zonas de
 * precio $/m²) generadas desde datos abiertos INEGI. Ver README.md.
 */

"use strict";

// ---------------------------------------------------------------- constantes
const AGS_CENTER = [21.8823, -102.2916];
const AGS_ZOOM = 12;

// Caja aprox. del municipio de Aguascalientes para acotar el geocoding
// (lonMin, latMin, lonMax, latMax)
const AGS_VIEWBOX = "-102.45,21.70,-102.10,22.05";

// Escala NSE (7 niveles + sin dato). Verde = alto, rojo = bajo.
const NSE_COLORS = {
  "A/B": "#006837",
  "C+": "#1a9850",
  "C": "#66bd63",
  "C-": "#fee08b",
  "D+": "#fdae61",
  "D": "#f46d43",
  "E": "#d73027",
  "S/D": "#9ca3af",
};

const NSE_LABELS = {
  "A/B": "A/B — Alto",
  "C+": "C+ — Medio-alto",
  "C": "C — Medio",
  "C-": "C- — Medio bajo",
  "D+": "D+ — Bajo con carencias",
  "D": "D — Bajo",
  "E": "E — Muy bajo",
  "S/D": "Sin dato censal",
};

// Escala de precio por precio_m2_max de la zona (tonos morados, alto = oscuro)
const PRICE_BINS = [
  { min: 26000, color: "#3f007d", label: "≥ $26,000 /m²" },
  { min: 23000, color: "#6a51a3", label: "$23,000 – $26,000 /m²" },
  { min: 21000, color: "#807dba", label: "$21,000 – $23,000 /m²" },
  { min: 18000, color: "#9e9ac8", label: "$18,000 – $21,000 /m²" },
  { min: 0, color: "#bcbddc", label: "< $18,000 /m²" },
];

// Escala de valor catastral de suelo (azules, oficial 2026)
const CAT_BINS = [
  { min: 6500, color: "#08306b", label: "≥ $6,500 /m²" },
  { min: 5000, color: "#08519c", label: "$5,000 – $6,500 /m²" },
  { min: 4000, color: "#3182bd", label: "$4,000 – $5,000 /m²" },
  { min: 3000, color: "#6baed6", label: "$3,000 – $4,000 /m²" },
  { min: 2000, color: "#9ecae1", label: "$2,000 – $3,000 /m²" },
  { min: 0, color: "#c6dbef", label: "< $2,000 /m²" },
];

// Tamaño de vivienda: % con 3+ cuartos (naranjas)
const SUP_BINS = [
  { min: 95, color: "#d94801", label: "≥ 95%" },
  { min: 90, color: "#f16913", label: "90% – 95%" },
  { min: 80, color: "#fdae6b", label: "80% – 90%" },
  { min: 70, color: "#fdd0a2", label: "70% – 80%" },
  { min: 0, color: "#fee6ce", label: "< 70%" },
];

// Densidad de población: hab/km² por AGEB (magentas)
const DENS_BINS = [
  { min: 20000, color: "#7a0177", label: "≥ 20,000 hab/km²" },
  { min: 15000, color: "#ae017e", label: "15,000 – 20,000 hab/km²" },
  { min: 10000, color: "#dd3497", label: "10,000 – 15,000 hab/km²" },
  { min: 5000, color: "#f768a1", label: "5,000 – 10,000 hab/km²" },
  { min: 0, color: "#fcc5c0", label: "< 5,000 hab/km²" },
];

// Viviendas deshabitadas: % por AGEB (rojos — señal de alerta/sobreoferta)
const DESH_BINS = [
  { min: 20, color: "#99000d", label: "≥ 20%" },
  { min: 15, color: "#cb181d", label: "15% – 20%" },
  { min: 10, color: "#fb6a4a", label: "10% – 15%" },
  { min: 5, color: "#fcae91", label: "5% – 10%" },
  { min: 0, color: "#fee5d9", label: "< 5%" },
];

// Marginación urbana 2020 (CONAPO, índice oficial — NO es el NSE proxy
// propio). Azul = mejor, rojo = peor; escala distinta a NSE (verde/rojo)
// a propósito, para no confundir ambas capas de un vistazo.
const MARG_COLORS = {
  "Muy bajo": "#2b6a9e",
  "Bajo": "#6ba3c9",
  "Medio": "#f2c14e",
  "Alto": "#e8871e",
  "Muy alto": "#c1272d",
  "S/D": "#9ca3af",
};

const MARG_LABELS = {
  "Muy bajo": "Muy bajo — mejor",
  "Bajo": "Bajo",
  "Medio": "Medio",
  "Alto": "Alto",
  "Muy alto": "Muy alto — peor",
  "S/D": "Sin dato (AGEB muy pequeña, excluida por CONAPO)",
};

// PDU: color por grupo de zonificación
const PDU_COLORS = {
  "Habitacional": "#f2c14e",
  "Mixto": "#e8871e",
  "Comercial / Servicios": "#d64550",
  "Industrial": "#7d6b91",
  "Agropecuario": "#8d6e63",
  "Conservación / Ecológico": "#2a9d8f",
  "Crecimiento futuro": "#c3b1e1",
  "Especial": "#457b9d",
  "Otro": "#9ca3af",
};

const fmtMXN = (n) => "$" + Number(n).toLocaleString("es-MX");

// --------------------------------------------------------------------- mapa
const map = L.map("map", { zoomControl: false }).setView(AGS_CENTER, AGS_ZOOM);
L.control.zoom({ position: "topleft" }).addTo(map);
// solo métrico (km/m) — el sitio no usa unidades imperiales en ningún otro lado.
// También aparece en el export PNG de la zona de estudio (ver reporte.js).
L.control.scale({ position: "bottomright", imperial: false }).addTo(map);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  crossOrigin: true,  // necesario para capturar el mapa en el reporte PDF
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// GeoJSON crudos compartidos con zona.js / reporte.js
const DATA = { agebs: null, zones: null, cat: null, pdu: null, poblacionProyeccion: null };

let nseLayer = null;
let priceLayer = null;
let catLayer = null;
let supLayer = null;
let pduLayer = null;
let densLayer = null;
let deshLayer = null;
let margLayer = null;
let activeLayerName = "nse";

// ------------------------------------------------------------------- estilos
function nseStyle(feature) {
  const nivel = feature.properties.nse_nivel || "S/D";
  return {
    fillColor: NSE_COLORS[nivel] || NSE_COLORS["S/D"],
    fillOpacity: 0.62,
    color: "#ffffff",
    weight: 0.7,
  };
}

function marginacionStyle(feature) {
  const grado = feature.properties.conapo_grado || "S/D";
  return {
    fillColor: MARG_COLORS[grado] || MARG_COLORS["S/D"],
    fillOpacity: 0.62,
    color: "#ffffff",
    weight: 0.7,
  };
}

function priceColor(pmax) {
  for (const bin of PRICE_BINS) {
    if (pmax >= bin.min) return bin.color;
  }
  return PRICE_BINS[PRICE_BINS.length - 1].color;
}

function priceStyle(feature) {
  return {
    fillColor: priceColor(feature.properties.precio_m2_max || 0),
    fillOpacity: 0.55,
    color: "#1c2a3a",
    weight: 1.6,
  };
}

function catColor(v) {
  for (const bin of CAT_BINS) {
    if (v >= bin.min) return bin.color;
  }
  return CAT_BINS[CAT_BINS.length - 1].color;
}

function binColor(bins, v) {
  for (const b of bins) {
    if (v >= b.min) return b.color;
  }
  return bins[bins.length - 1].color;
}

function pctStyle(bins, prop) {
  return (feature) => ({
    fillColor: feature.properties[prop] != null
      ? binColor(bins, feature.properties[prop])
      : "#9ca3af",
    fillOpacity: 0.65,
    color: "#ffffff",
    weight: 0.7,
  });
}

function pduStyle(feature) {
  return {
    fillColor: PDU_COLORS[feature.properties.grupo] || PDU_COLORS["Otro"],
    fillOpacity: 0.55,
    color: "#4a5568",
    weight: 1,
  };
}

function catStyle(feature) {
  return {
    fillColor: catColor(feature.properties.valor_m2 || 0),
    fillOpacity: 0.68,
    color: "#ffffff",
    weight: 0.6,
  };
}

// -------------------------------------------------------------------- popups
function nsePopup(p) {
  const nivel = p.nse_nivel || "S/D";
  const color = NSE_COLORS[nivel] || NSE_COLORS["S/D"];
  return `
    <div class="popup-title">AGEB ${p.CVE_AGEB} · ${p.municipio === "Jesús María" ? "Jesús María" : "zona " + (p.zona || "—")}</div>
    <span class="popup-badge" style="background:${color}">NSE ${nivel}</span>
    <table class="popup-table" style="margin-top:6px">
      <tr><td>Índice NSE (0–1)</td><td><strong>${p.nse_score != null ? p.nse_score.toFixed(2) : "s/d"}</strong></td></tr>
      <tr><td>Población</td><td>${p.POBTOT != null ? p.POBTOT.toLocaleString("es-MX") : "s/d"}</td></tr>
      <tr><td>Escolaridad promedio</td><td>${p.GRAPROES != null ? p.GRAPROES + " años" : "s/d"}</td></tr>
      <tr><td>Viviendas con internet</td><td>${p.pct_inter != null ? p.pct_inter + "%" : "s/d"}</td></tr>
      <tr><td>Viviendas con auto</td><td>${p.pct_auto != null ? p.pct_auto + "%" : "s/d"}</td></tr>
      <tr><td>Ocupantes por cuarto</td><td>${p.PRO_OCUP_C != null ? p.PRO_OCUP_C : "s/d"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Estimación propia con Censo 2020 (INEGI). No es dato AMAI/Tinsa.</div>`;
}

function pricePopup(p) {
  return `
    <div class="popup-title">Zona ${p.zona}</div>
    <table class="popup-table">
      <tr><td>Precio aprox.</td><td><strong>${fmtMXN(p.precio_m2_min)} – ${fmtMXN(p.precio_m2_max)} /m²</strong></td></tr>
      <tr><td>Plusvalía</td><td>${p.plusvalia || "—"}</td></tr>
    </table>
    <div style="margin-top:4px;font-size:12px">${p.nota || ""}</div>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Estimación de mercado (jul 2026). No es valor catastral ni avalúo.</div>`;
}

function catPopup(p) {
  return `
    <div class="popup-title">${p.TIPO !== "NINGUNO" ? p.TIPO + " " : ""}${p.NOM_ASEN}</div>
    <table class="popup-table">
      <tr><td>Valor catastral suelo</td><td><strong>${fmtMXN(p.valor_m2)} /m²</strong></td></tr>
      <tr><td>Municipio</td><td>${p.municipio || "—"}</td></tr>
      <tr><td>Sector / plano</td><td>${p.sector ?? "—"}</td></tr>
      <tr><td>Código postal</td><td>${p.CP || "—"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Ley de Ingresos 2026 del municipio correspondiente. Valor oficial base del predial; suele ser menor al precio de mercado. Cruce automático — verificar en la ley para trámites.</div>
    <button class="popup-cmp-btn" onclick="window.addCompare('${p.CVEGEO}')">Comparar</button>`;
}

function supPopup(p) {
  return `
    <div class="popup-title">AGEB ${p.CVE_AGEB} · ${p.municipio}</div>
    <table class="popup-table">
      <tr><td>Viviendas con 3+ cuartos</td><td><strong>${p.pct_3cuart != null ? p.pct_3cuart + "%" : "s/d"}</strong></td></tr>
      <tr><td>Viviendas con 2+ recámaras</td><td>${p.pct_2dorm != null ? p.pct_2dorm + "%" : "s/d"}</td></tr>
      <tr><td>Ocupantes por cuarto</td><td>${p.PRO_OCUP_C ?? "s/d"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Proxy censal del tamaño de vivienda (Censo 2020). No son m² catastrales.</div>`;
}

function densPopup(p) {
  return `
    <div class="popup-title">AGEB ${p.CVE_AGEB} · ${p.municipio}</div>
    <table class="popup-table">
      <tr><td>Densidad de población</td><td><strong>${p.densidad_hab_km2 != null ? Math.round(p.densidad_hab_km2).toLocaleString("es-MX") + " hab/km²" : "s/d"}</strong></td></tr>
      <tr><td>Población</td><td>${p.POBTOT != null ? p.POBTOT.toLocaleString("es-MX") : "s/d"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Población entre área del polígono AGEB (Censo 2020, INEGI).</div>`;
}

function deshPopup(p) {
  return `
    <div class="popup-title">AGEB ${p.CVE_AGEB} · ${p.municipio}</div>
    <table class="popup-table">
      <tr><td>Viviendas deshabitadas</td><td><strong>${p.pct_deshabitadas != null ? p.pct_deshabitadas + "%" : "s/d"}</strong></td></tr>
      <tr><td>Población</td><td>${p.POBTOT != null ? p.POBTOT.toLocaleString("es-MX") : "s/d"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Censo 2020 (INEGI). Incluye tanto vivienda nueva sin vender/ocupar como vivienda abandonada — el censo no distingue el motivo.</div>`;
}

function marginacionPopup(p) {
  const grado = p.conapo_grado || "S/D";
  const color = MARG_COLORS[grado] || MARG_COLORS["S/D"];
  return `
    <div class="popup-title">AGEB ${p.CVE_AGEB} · ${p.municipio}</div>
    <span class="popup-badge" style="background:${color}">Marginación ${grado}</span>
    <table class="popup-table" style="margin-top:6px">
      <tr><td>Índice de marginación (CONAPO)</td><td><strong>${p.conapo_im != null ? p.conapo_im.toFixed(1) : "s/d"}</strong></td></tr>
      <tr><td>NSE (proxy propio, referencia)</td><td>${p.nse_nivel || "s/d"}</td></tr>
      <tr><td>Población</td><td>${p.POBTOT != null ? p.POBTOT.toLocaleString("es-MX") : "s/d"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Índice de Marginación Urbana 2020, CONAPO — dato oficial (no es el NSE proxy propio de este sitio, aunque correlacionan). AGEBs muy pequeñas quedan sin dato por confidencialidad censal.</div>`;
}

function pduPlanoTxt(p) {
  if (p.plano === "Z2_MP36") return "MP36 (zona a consolidar)";
  if (p.plano === "Z2_MP37") return "MP37 (zonificación secundaria)";
  return p.plano || "—";
}

function pduPopup(p) {
  return `
    <div class="popup-title">${p.grupo} · ${p.municipio}</div>
    <table class="popup-table">
      <tr><td>Uso de suelo</td><td><strong>${p.uso}</strong></td></tr>
      <tr><td>Superficie</td><td>${p.hectareas != null ? p.hectareas.toLocaleString("es-MX") + " ha" : "—"}</td></tr>
      <tr><td>Clave/plano</td><td>${pduPlanoTxt(p)}</td></tr>
      <tr><td>Programa</td><td>${p.programa}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Programa de Desarrollo Urbano oficial de cada municipio (IMPLAN Aguascalientes / Jesús María). Verificar con el municipio correspondiente para trámites.</div>`;
}

// Helper: cuando bufferPicking está activo, el click en cualquier polígono
// se redirige al análisis de radio en lugar de abrir el popup.
function layerClick(e) {
  if (window.bufferPicking) {
    L.DomEvent.stopPropagation(e); // evita que Leaflet abra el popup
    map.closePopup();
    window.onBufferMapClick({ latlng: e.latlng });
    return;
  }
}

// ------------------------------------------------------------ carga de datos
// El PDU (~3.4 MB, el archivo más pesado) no se descarga al inicio: lo trae
// ensurePdu() cuando algo lo necesita (capa PDU, análisis de radio o de zona),
// con un prefetch en segundo plano una vez pintado el mapa.
async function loadData() {
  const [agebsResp, zonesResp, catResp] = await Promise.all([
    fetch("../data/ags_agebs.json"),
    fetch("../data/ags_price_zones.json"),
    fetch("../data/ags_catastral.json"),
  ]);
  if (!agebsResp.ok || !zonesResp.ok || !catResp.ok) {
    throw new Error("No se pudieron cargar los GeoJSON. Sirve el proyecto con un servidor estático (ver README).");
  }
  const [agebs, zones, cat] = await Promise.all([agebsResp.json(), zonesResp.json(), catResp.json()]);
  Object.assign(DATA, { agebs, zones, cat });
  buildColoniaIndex(cat);

  // Serie de población por municipio (CONAPO, 1990-2040) — dato de contexto
  // para el panel de Zona/Buffer, no crítico: si falla, el resto del mapa
  // sigue funcionando sin la gráfica de tendencia.
  try {
    const proyResp = await fetch("../data/ags_poblacion_proyeccion.json");
    if (proyResp.ok) DATA.poblacionProyeccion = await proyResp.json();
  } catch (err) { console.warn("No se pudo cargar la proyección de población:", err); }

  nseLayer = L.geoJSON(agebs, {
    style: nseStyle,
    onEachFeature: (f, layer) => {
      layer.bindPopup(nsePopup(f.properties), { maxWidth: 290 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2.2, color: "#1c2a3a" }); });
      layer.on("mouseout",  () => nseLayer.resetStyle(layer));
    },
  });

  priceLayer = L.geoJSON(zones, {
    style: priceStyle,
    onEachFeature: (f, layer) => {
      layer.bindPopup(pricePopup(f.properties), { maxWidth: 290 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ fillOpacity: 0.72 }); });
      layer.on("mouseout",  () => priceLayer.resetStyle(layer));
    },
  });

  catLayer = L.geoJSON(cat, {
    style: catStyle,
    onEachFeature: (f, layer) => {
      layer.bindPopup(catPopup(f.properties), { maxWidth: 300 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2, color: "#08306b" }); });
      layer.on("mouseout",  () => catLayer.resetStyle(layer));
    },
  });

  supLayer = L.geoJSON(agebs, {
    style: pctStyle(SUP_BINS, "pct_3cuart"),
    onEachFeature: (f, layer) => {
      layer.bindPopup(supPopup(f.properties), { maxWidth: 290 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2.2, color: "#8c3200" }); });
      layer.on("mouseout",  () => supLayer.resetStyle(layer));
    },
  });

  densLayer = L.geoJSON(agebs, {
    style: pctStyle(DENS_BINS, "densidad_hab_km2"),
    onEachFeature: (f, layer) => {
      layer.bindPopup(densPopup(f.properties), { maxWidth: 290 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2.2, color: "#49006a" }); });
      layer.on("mouseout",  () => densLayer.resetStyle(layer));
    },
  });

  deshLayer = L.geoJSON(agebs, {
    style: pctStyle(DESH_BINS, "pct_deshabitadas"),
    onEachFeature: (f, layer) => {
      layer.bindPopup(deshPopup(f.properties), { maxWidth: 290 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2.2, color: "#67000d" }); });
      layer.on("mouseout",  () => deshLayer.resetStyle(layer));
    },
  });

  margLayer = L.geoJSON(agebs, {
    style: marginacionStyle,
    onEachFeature: (f, layer) => {
      layer.bindPopup(marginacionPopup(f.properties), { maxWidth: 300 });
      layer.on("click",     layerClick);
      layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ weight: 2.2, color: "#1c2a3a" }); });
      layer.on("mouseout",  () => margLayer.resetStyle(layer));
    },
  });

  nseLayer.addTo(map);
  map.fitBounds(nseLayer.getBounds(), { padding: [20, 20] });
  buildLegends();

  // Prefetch del PDU una vez pintado el mapa: no compite con la carga inicial
  // pero en la práctica ya está descargado cuando el usuario lo pide.
  setTimeout(() => { ensurePdu().catch(() => {}); }, 2500);
}

// Carga diferida del PDU. Memoizada: el primer interesado (botón PDU, análisis
// de radio en buffer.js o de zona en zona.js) dispara la descarga y los demás
// esperan la misma promesa. Si falla, se limpia para poder reintentar.
let pduPromise = null;
function ensurePdu() {
  if (!pduPromise) {
    pduPromise = fetch("../data/ags_pdu.json")
      .then((resp) => {
        if (!resp.ok) throw new Error("No se pudo cargar la capa PDU. Intenta de nuevo.");
        return resp.json();
      })
      .then((pdu) => {
        DATA.pdu = pdu;
        pduLayer = L.geoJSON(pdu, {
          style: pduStyle,
          onEachFeature: (f, layer) => {
            layer.bindPopup(pduPopup(f.properties), { maxWidth: 310 });
            layer.on("click",     layerClick);
            layer.on("mouseover", () => { if (!window.bufferPicking) layer.setStyle({ fillOpacity: 0.72 }); });
            layer.on("mouseout",  () => pduLayer.resetStyle(layer));
          },
        });
      })
      .catch((err) => { pduPromise = null; throw err; });
  }
  return pduPromise;
}
window.ensurePdu = ensurePdu;

// ------------------------------------------------------------------ leyendas
function buildLegends() {
  const nseRows = document.getElementById("legend-nse-rows");
  nseRows.innerHTML = Object.entries(NSE_LABELS)
    .map(([k, label]) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${NSE_COLORS[k]}"></span>
        <span>${label}</span>
      </div>`)
    .join("");

  const priceRows = document.getElementById("legend-price-rows");
  priceRows.innerHTML = PRICE_BINS
    .map((b) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${b.color}"></span>
        <span>${b.label}</span>
      </div>`)
    .join("");

  const catRows = document.getElementById("legend-cat-rows");
  catRows.innerHTML = CAT_BINS
    .map((b) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${b.color}"></span>
        <span>${b.label}</span>
      </div>`)
    .join("");

  const binRow = (b) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${b.color}"></span>
        <span>${b.label}</span>
      </div>`;
  document.getElementById("legend-sup-rows").innerHTML = SUP_BINS.map(binRow).join("");
  document.getElementById("legend-pdu-rows").innerHTML = Object.entries(PDU_COLORS)
    .filter(([g]) => g !== "Otro")
    .map(([g, color]) => binRow({ color, label: g }))
    .join("");
  document.getElementById("legend-dens-rows").innerHTML = DENS_BINS.map(binRow).join("");
  document.getElementById("legend-desh-rows").innerHTML = DESH_BINS.map(binRow).join("");
  document.getElementById("legend-marg-rows").innerHTML = Object.entries(MARG_LABELS)
    .map(([g, label]) => binRow({ color: MARG_COLORS[g], label }))
    .join("");
}

// ------------------------------------------------------------ cambio de capa
const LAYERS = {
  nse: () => nseLayer,
  price: () => priceLayer,
  cat: () => catLayer,
  sup: () => supLayer,
  pdu: () => pduLayer,
  dens: () => densLayer,
  desh: () => deshLayer,
  marg: () => margLayer,
};

let pduLayerPending = false; // click en PDU mientras descarga: activarla al llegar

function setLayer(name) {
  if (!nseLayer) return; // datos base aún cargando
  if (name !== "pdu") pduLayerPending = false; // el usuario cambió de opinión

  if (name === "pdu" && !pduLayer) {
    if (pduLayerPending) return; // descarga ya en camino
    pduLayerPending = true;
    const btn = document.getElementById("btn-pdu");
    btn.classList.add("loading");
    ensurePdu()
      .then(() => { if (pduLayerPending) { pduLayerPending = false; setLayer("pdu"); } })
      .catch((err) => { pduLayerPending = false; alert(err.message); })
      .finally(() => btn.classList.remove("loading"));
    return;
  }

  const turningOff = name === activeLayerName;
  activeLayerName = turningOff ? null : name;

  for (const key of Object.keys(LAYERS)) {
    const isActive = !turningOff && key === name;
    document.getElementById(`btn-${key}`).classList.toggle("active", isActive);
    document.getElementById(`legend-${key}`).classList.toggle("hidden", !isActive);
    const layer = LAYERS[key]();
    if (!layer) continue; // pdu aún no descargado
    if (isActive) layer.addTo(map);
    else map.removeLayer(layer);
  }
}

for (const key of ["nse", "price", "cat", "sup", "pdu", "dens", "desh", "marg"]) {
  document.getElementById(`btn-${key}`).addEventListener("click", () => setLayer(key));
}
document.getElementById("btn-home").addEventListener("click", () => {
  if (nseLayer) map.fitBounds(nseLayer.getBounds(), { padding: [20, 20] });
  else map.setView(AGS_CENTER, AGS_ZOOM);
});

// ------------------------------------------------------------------ buscador
// 1) Autocomplete local sobre las 783 colonias con nombre oficial (instantáneo).
// 2) Nominatim como respaldo para direcciones exactas: máx. 1 req/seg y solo
//    al enviar. https://operations.osmfoundation.org/policies/nominatim/
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchMarker = null;
let lastSearchAt = 0;
let coloniaIndex = [];

const normalize = (s) => s.toUpperCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function buildColoniaIndex(cat) {
  coloniaIndex = cat.features.map((f) => ({
    nombre: `${f.properties.TIPO !== "NINGUNO" ? f.properties.TIPO + " " : ""}${f.properties.NOM_ASEN}`,
    key: normalize(`${f.properties.TIPO} ${f.properties.NOM_ASEN}`),
    municipio: f.properties.municipio,
    cvegeo: f.properties.CVEGEO,
    feature: f,
  }));
}

function localMatches(q) {
  const nq = normalize(q);
  if (nq.length < 2) return [];
  return coloniaIndex.filter((c) => c.key.includes(nq)).slice(0, 8);
}

function goToColonia(item) {
  searchResults.classList.add("hidden");
  searchInput.value = item.nombre;
  const bounds = L.geoJSON(item.feature).getBounds();
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: false });
  // abrir el popup del polígono si la capa catastral está visible
  if (catLayer && map.hasLayer(catLayer)) {
    catLayer.eachLayer((l) => {
      if (l.feature.properties.CVEGEO === item.cvegeo) l.openPopup();
    });
  }
}

function showSuggestions() {
  const q = searchInput.value.trim();
  const matches = localMatches(q);
  if (!q || (q.length < 2)) { searchResults.classList.add("hidden"); return; }
  searchResults.innerHTML = "";
  for (const m of matches) {
    const li = document.createElement("li");
    li.className = "sr-local";
    li.textContent = `${m.nombre} · ${m.municipio}`;
    li.addEventListener("click", () => goToColonia(m));
    searchResults.appendChild(li);
  }
  const osm = document.createElement("li");
  osm.className = "sr-osm";
  osm.textContent = `Buscar "${q}" como dirección (OpenStreetMap)…`;
  osm.addEventListener("click", () => { if (q.length >= 3) geocode(q); });
  searchResults.appendChild(osm);
  searchResults.classList.remove("hidden");
}

searchInput.addEventListener("input", showSuggestions);

async function geocode(query) {
  const now = Date.now();
  if (now - lastSearchAt < 1100) return; // respeta 1 req/seg
  lastSearchAt = now;

  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    format: "json",
    q: query + ", Aguascalientes, Aguascalientes, México",
    viewbox: AGS_VIEWBOX,
    bounded: "1",
    limit: "5",
    "accept-language": "es",
  });

  searchResults.innerHTML = "<li>Buscando…</li>";
  searchResults.classList.remove("hidden");

  try {
    const resp = await fetch(url);
    const results = await resp.json();
    if (!results.length) {
      searchResults.innerHTML = "<li>Sin resultados dentro de Aguascalientes</li>";
      return;
    }
    searchResults.innerHTML = "";
    results.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r.display_name;
      li.addEventListener("click", () => {
        goToResult(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
        searchResults.classList.add("hidden");
      });
      searchResults.appendChild(li);
    });
  } catch (err) {
    searchResults.innerHTML = "<li>Error al buscar. Intenta de nuevo.</li>";
  }
}

function goToResult(lat, lon, label) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(label).openPopup();
  map.setView([lat, lon], 16);
}

function submitSearch() {
  const q = searchInput.value.trim();
  const matches = localMatches(q);
  if (matches.length) goToColonia(matches[0]);
  else if (q.length >= 3) geocode(q);
}

document.getElementById("search-btn").addEventListener("click", submitSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSearch();
  if (e.key === "Escape") searchResults.classList.add("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-box")) searchResults.classList.add("hidden");
});

// --------------------------------------------- proyección de población (CONAPO)
// Compartida por zona.js (polígono) y buffer.js (radio): resuelve la serie
// 1990-2040 de los municipios tocados por la zona/buffer. Dato de contexto a
// nivel MUNICIPIO COMPLETO (no varía por AGEB/zona) — reemplaza al viejo
// cálculo de 2 puntos (2010→2020) con la serie oficial completa.
function resolvePoblacionMunicipios(municipiosTocados) {
  const proy = DATA.poblacionProyeccion;
  if (!proy) return null;
  const municipios = {};
  for (const mun of municipiosTocados) {
    const serie = proy.municipios[mun];
    if (!serie) continue;
    const anios = Object.keys(serie).map(Number).sort((a, b) => a - b);
    const anioFin = anios[anios.length - 1];
    const pop2020 = serie["2020"];
    const popFin = serie[String(anioFin)];
    municipios[mun] = {
      serie,
      anioComparacionFin: anioFin,
      cambio2020FinPct: (pop2020 > 0 && popFin != null)
        ? Number((((popFin - pop2020) / pop2020) * 100).toFixed(1))
        : null,
    };
  }
  if (!Object.keys(municipios).length) return null;
  return { fuente: proy.fuente, nota: proy.nota, municipios };
}

// Gráfica de línea con la serie de población 1990-2040 por municipio (CONAPO).
// Compartida por zona.js y buffer.js — mismo canvas id "chart-pob" en ambos
// paneles. El tramo 2021-2040 es proyección oficial, no dato observado; se
// aclara en el título de la gráfica y en las notas metodológicas del panel/PDF.
const POB_CHART_COLORS = ["#2f6690", "#2a9d8f", "#e8871e", "#c1272d"];

function renderPoblacionChart(canvasId, poblacionMunicipios) {
  if (!poblacionMunicipios) return null;
  const entries = Object.entries(poblacionMunicipios.municipios);
  if (!entries.length) return null;
  const anios = Object.keys(entries[0][1].serie).map(Number).sort((a, b) => a - b);

  return new Chart(document.getElementById(canvasId), {
    type: "line",
    data: {
      labels: anios,
      datasets: entries.map(([mun, v], i) => ({
        label: mun,
        data: anios.map((a) => v.serie[String(a)] ?? null),
        borderColor: POB_CHART_COLORS[i % POB_CHART_COLORS.length],
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
      })),
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Población municipal 1990–2040 (CONAPO; 2021+ es proyección)", font: { size: 10.5 } },
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 9 } } },
      },
      scales: {
        y: { ticks: { callback: (v) => Number(v).toLocaleString("es-MX") } },
      },
    },
  });
}

// ------------------------------------------------------------- modal Acerca
const aboutModal = document.getElementById("about-modal");
document.getElementById("about-btn").addEventListener("click", () => aboutModal.classList.remove("hidden"));
document.getElementById("about-close").addEventListener("click", () => aboutModal.classList.add("hidden"));
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) aboutModal.classList.add("hidden");
});

// ---------------------------------------------------------------------- init
loadData().catch((err) => {
  console.error(err);
  alert(err.message);
});
