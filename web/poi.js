/* Puntos de interés (escuelas, salud, abasto, bancos, parques, gasolineras)
 * de OpenStreetMap, vía scripts/build_poi.py (Overpass API). Dato abierto
 * (ODbL) — a diferencia del panel Vivienda nueva, sin restricción de fuente.
 *
 * Capa superpuesta (independiente de las 6 capas exclusivas), con checkboxes
 * por categoría en la leyenda.
 */

"use strict";

const POI_ESTILO = {
  "Educación": { color: "#1d4ed8" },
  "Salud": { color: "#dc2626" },
  "Abasto": { color: "#ea580c" },
  "Bancos": { color: "#065f46" },
  "Parques": { color: "#16a34a" },
  "Gasolineras": { color: "#57534e" },
};

let poiLayers = {};   // categoria -> L.layerGroup
let poiVisible = false;

function poiIcon(cat) {
  const est = POI_ESTILO[cat];
  return L.divIcon({
    className: "",
    html: `<div class="poi-pin" style="background:${est.color}"></div>`,
    iconSize: [11, 11],
    iconAnchor: [5, 5],
    popupAnchor: [0, -6],
  });
}

function poiPopup(p) {
  return `
    <div class="popup-title">${p.nombre}</div>
    <table class="popup-table">
      <tr><td>Categoría</td><td><strong>${p.categoria}</strong></td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">OpenStreetMap contributors (ODbL).</div>`;
}

async function loadPOI() {
  const resp = await fetch("../data/ags_poi.geojson");
  if (!resp.ok) return;
  const gj = await resp.json();

  for (const cat of Object.keys(POI_ESTILO)) poiLayers[cat] = L.layerGroup();

  for (const f of gj.features) {
    const p = f.properties;
    if (!poiLayers[p.categoria]) continue;
    const [lon, lat] = f.geometry.coordinates;
    L.marker([lat, lon], { icon: poiIcon(p.categoria) })
      .bindPopup(poiPopup(p), { maxWidth: 240 })
      .addTo(poiLayers[p.categoria]);
  }

  const rows = document.getElementById("legend-poi-rows");
  rows.innerHTML = Object.entries(POI_ESTILO).map(([cat, est], i) => `
    <label class="legend-row poi-check">
      <input type="checkbox" data-cat="${cat}" checked>
      <span class="legend-dot" style="background:${est.color}"></span>
      <span>${cat}</span>
    </label>`).join("");

  rows.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    chk.addEventListener("change", () => {
      const cat = chk.dataset.cat;
      if (chk.checked) { if (poiVisible) poiLayers[cat].addTo(map); }
      else map.removeLayer(poiLayers[cat]);
    });
  });
}

const btnPoi = document.getElementById("btn-poi");
const legendPoi = document.getElementById("legend-poi");

btnPoi.addEventListener("click", () => {
  poiVisible = !poiVisible;
  btnPoi.classList.toggle("active", poiVisible);
  legendPoi.classList.toggle("hidden", !poiVisible);
  for (const [cat, layer] of Object.entries(poiLayers)) {
    const chk = legendPoi.querySelector(`input[data-cat="${cat}"]`);
    const wants = !chk || chk.checked;
    if (poiVisible && wants) layer.addTo(map);
    else map.removeLayer(layer);
  }
});

loadPOI();
