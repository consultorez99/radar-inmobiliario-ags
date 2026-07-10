/* Pines de proyectos individuales de vivienda nueva, con datos reales de
 * absorción/inventario de un estudio de mercado de terceros (1T26).
 *
 * El estudio reporta 72 proyectos vigentes en la plaza (45 horizontal + 27
 * vertical, ver softec.js), pero solo nombra individualmente a los 30 de
 * mayor absorción (top 15 horizontal + top 15 vertical, gráfica "Principales
 * desarrolladores", pág. 23 del PDF fuente) — el resto solo aparece en
 * tablas agregadas por segmento/tamaño/municipio, sin nombre propio en
 * ningún lugar del documento, así que no se pueden ubicar.
 *
 * De esos 30: 9 se geocodificaron por nombre vía Nominatim (OpenStreetMap,
 * confianza "exacta"/"aproximada" según especificidad del match) y 21 se
 * ubicaron a mano con coordenadas proporcionadas por el despacho (confianza
 * "exacta"). No se inventan coordenadas — cada pin indica su nivel de
 * confianza en la ubicación.
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
  { nombre: "Paseos del Sur CD", tipo: "horizontal", inventario: 500, vendidas: 2400, absorcion: 27.8, lat: 21.81089, lon: -102.27125, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Paseos del Sur", tipo: "horizontal", inventario: 861, vendidas: 2039, absorcion: 25.3, lat: 21.81089, lon: -102.27125, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Villas de Montecasino", tipo: "horizontal", inventario: 130, vendidas: 320, absorcion: 12.8, lat: 21.996609, lon: -102.307115, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "La Nueva Estancia", tipo: "horizontal", inventario: 130, vendidas: 370, absorcion: 12.1, lat: 21.938764, lon: -102.323651, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Villas de Montecasino Circuito Benedicto Sur", tipo: "horizontal", inventario: 4, vendidas: 196, absorcion: 7.4, lat: 21.996609, lon: -102.307115, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Vista Serena", tipo: "horizontal", inventario: 18, vendidas: 82, absorcion: 7.3, lat: 21.963402, lon: -102.251408, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Torres Villa Canto", tipo: "vertical", inventario: 5, vendidas: 85, absorcion: 6.7, lat: 21.913481, lon: -102.231610, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Landa Residencial Cotos Alondras Golondrinas", tipo: "horizontal", inventario: 505, vendidas: 68, absorcion: 6.5, lat: 21.985329, lon: -102.335796, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Vista Serena CS", tipo: "horizontal", inventario: 4, vendidas: 96, absorcion: 6.0, lat: 21.963402, lon: -102.251408, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Gran Reserva Los Angeles", tipo: "horizontal", inventario: 500, vendidas: 150, absorcion: 6.0, lat: 21.954447, lon: -102.273774, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Xaramá Residencial", tipo: "horizontal", inventario: 80, vendidas: 320, absorcion: 4.4, lat: 21.875391, lon: -102.325678, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Ferrara Residencial Gaibana", tipo: "horizontal", inventario: 204, vendidas: 141, absorcion: 4.2, lat: 21.972513, lon: -102.300443, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Reserva San Matías Residencial", tipo: "horizontal", inventario: 49, vendidas: 79, absorcion: 4.0, lat: 21.828030, lon: -102.274484, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Diana Tower", tipo: "vertical", inventario: 8, vendidas: 35, absorcion: 2.4, lat: 21.878142, lon: -102.301581, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "VilaNova Residencial Rancho Santa Mónica", tipo: "vertical", inventario: 8, vendidas: 64, absorcion: 2.1, lat: 21.828280, lon: -102.319999, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Montecristo Torre Bosco", tipo: "vertical", inventario: 20, vendidas: 20, absorcion: 0.9, lat: 21.928909, lon: -102.319383, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Torre Elite", tipo: "vertical", inventario: 10, vendidas: 19, absorcion: 0.9, lat: 21.919699, lon: -102.312463, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Aunna", tipo: "vertical", inventario: 42, vendidas: 28, absorcion: 0.8, lat: 21.949677, lon: -102.324754, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "SoHma Urban Living", tipo: "vertical", inventario: 76, vendidas: 8, absorcion: 0.7, lat: 21.935240, lon: -102.341763, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Torre Universidad Residencial", tipo: "vertical", inventario: 11, vendidas: 16, absorcion: 0.7, lat: 21.906132, lon: -102.307270, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
  { nombre: "Tremezzo Departamentos", tipo: "vertical", inventario: 24, vendidas: 24, absorcion: 0.7, lat: 21.951394, lon: -102.338933, confianza: "exacta", geocode: "Coordenada proporcionada por el despacho" },
];

const PROYECTOS_COLOR = { horizontal: "#2a9d8f", vertical: "#2f6690" };

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
  const confTxt = p.geocode === "Coordenada proporcionada por el despacho"
    ? "Ubicación exacta (coordenada proporcionada por el despacho)."
    : p.confianza === "exacta"
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
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">${confTxt} Estudio de mercado de
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
