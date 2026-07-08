/* Pines de proyectos individuales de vivienda nueva, con datos reales de
 * absorción/inventario de un estudio de mercado de terceros (1T26).
 *
 * Geocodificados por nombre vía Nominatim (OpenStreetMap) contra el estudio
 * — de 30 proyectos mencionados en la fuente, solo 9 tuvieron una coincidencia
 * razonablemente específica y verificable; el resto se omite (no se inventan
 * coordenadas). Cada pin indica su nivel de confianza en la ubicación.
 */

"use strict";

const PROYECTOS_SOFTEC = [
  { nombre: "Real del Sol Sector VII", tipo: "horizontal", inventario: 83, vendidas: 297, absorcion: 10.8, lat: 21.88901, lon: -102.23777, confianza: "aproximada", geocode: "Parque Real del Sol" },
  { nombre: "Castelo San Francisco Etapa I-III", tipo: "horizontal", inventario: 18, vendidas: 323, absorcion: 10.0, lat: 21.97420, lon: -102.26890, confianza: "exacta", geocode: "Castelo San Francisco, La Ribera, San Francisco de los Romo" },
  { nombre: "Viñedos Ribier Etapa I", tipo: "horizontal", inventario: 30, vendidas: 153, absorcion: 4.4, lat: 21.97424, lon: -102.28716, confianza: "aproximada", geocode: "Av. Viñedos Ribier, San Francisco de los Romo" },
  { nombre: "Punto Portia", tipo: "vertical", inventario: 90, vendidas: 60, absorcion: 1.9, lat: 21.95302, lon: -102.34127, confianza: "aproximada", geocode: "Complejo Punto Portia" },
  { nombre: "Torre Cadaqués", tipo: "vertical", inventario: 81, vendidas: 50, absorcion: 1.4, lat: 21.93050, lon: -102.30789, confianza: "exacta", geocode: "Torre Cadaqués, Calzada Los Mezquitales" },
  { nombre: "Distrito Kauré Etapa I Torre Kova", tipo: "vertical", inventario: 6, vendidas: 35, absorcion: 1.0, lat: 21.93643, lon: -102.31903, confianza: "exacta", geocode: "Distrito Kauré, Maravillas, Jesús María" },
  { nombre: "San Javier 240 Torre I", tipo: "vertical", inventario: 13, vendidas: 19, absorcion: 1.0, lat: 21.81973, lon: -102.27448, confianza: "aproximada", geocode: "Calle San Javier" },
  { nombre: "Torre Mezquite", tipo: "vertical", inventario: 1, vendidas: 11, absorcion: 0.7, lat: 21.93270, lon: -102.30720, confianza: "exacta", geocode: "Mezquite Torre Residencial, Calzada Los Mezquitales" },
  { nombre: "Garza Sada 128", tipo: "vertical", inventario: 2, vendidas: 28, absorcion: 0.7, lat: 21.93111, lon: -102.34036, confianza: "aproximada", geocode: "Av. Eugenio Garza Sada, Pocitos" },
];

const PROYECTOS_COLOR = { horizontal: "#2a9d8f", vertical: "#5b2d8e" };

function proyectoIcon(p) {
  const color = PROYECTOS_COLOR[p.tipo];
  const dashed = p.confianza === "aproximada" ? "3,2" : "none";
  return L.divIcon({
    className: "",
    html: `<svg width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="8" fill="${color}" fill-opacity="0.85"
        stroke="#fff" stroke-width="2" stroke-dasharray="${dashed}"/>
    </svg>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -8],
  });
}

function proyectoPopup(p) {
  const confTxt = p.confianza === "exacta"
    ? "Ubicación exacta (coincidencia de nombre en OpenStreetMap)."
    : "Ubicación aproximada (calle/comercio cercano, no el predio exacto).";
  return `
    <div class="popup-title">${p.nombre}</div>
    <table class="popup-table">
      <tr><td>Tipo</td><td><strong>${p.tipo === "horizontal" ? "Casas" : "Departamentos"}</strong></td></tr>
      <tr><td>Unidades vendidas</td><td>${p.vendidas}</td></tr>
      <tr><td>Inventario disponible</td><td>${p.inventario}</td></tr>
      <tr><td>Absorción</td><td><strong>${p.absorcion.toFixed(1)} u/mes</strong></td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:#6b5f85">${confTxt} Estudio de mercado de
      terceros, corte 1T26 — cifras del desarrollo, no de una unidad individual.</div>`;
}

const proyectosLayer = L.layerGroup(
  PROYECTOS_SOFTEC.map((p) => L.marker([p.lat, p.lon], { icon: proyectoIcon(p) }).bindPopup(proyectoPopup(p), { maxWidth: 260 }))
);

let proyectosVisible = false;
const btnProyectos = document.getElementById("btn-proyectos");
const legendProyectos = document.getElementById("legend-proyectos");

btnProyectos.addEventListener("click", () => {
  proyectosVisible = !proyectosVisible;
  btnProyectos.classList.toggle("active", proyectosVisible);
  legendProyectos.classList.toggle("hidden", !proyectosVisible);
  if (proyectosVisible) proyectosLayer.addTo(map);
  else map.removeLayer(proyectosLayer);
});
