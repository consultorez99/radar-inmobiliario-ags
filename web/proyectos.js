/* Pines de proyectos individuales de vivienda nueva, con datos reales de
 * absorción/inventario de un estudio de mercado de terceros (1T26).
 *
 * El estudio reporta 72 proyectos vigentes en la plaza (45 horizontal + 27
 * vertical, ver softec.js) y trae una ficha individual por proyecto —con
 * longitud/latitud oficiales— en su "Reporte Especializado de Proyectos"
 * (págs. 40-59 del PDF fuente). Los 72 están geolocalizados con esas
 * coordenadas oficiales (confianza "exacta"). No se inventan coordenadas.
 */

"use strict";

const PROYECTOS_SOFTEC = [
  { nombre: "Paseos del Sur", tipo: "horizontal", inventario: 861, vendidas: 2039, absorcion: 25.3, lat: 21.810341, lon: -102.271835, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Paseos del Sur CD", tipo: "horizontal", inventario: 500, vendidas: 2400, absorcion: 27.8, lat: 21.811329, lon: -102.271889, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torres Villa Canto", tipo: "vertical", inventario: 5, vendidas: 85, absorcion: 6.7, lat: 21.913289, lon: -102.231788, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Vista Serena CD", tipo: "horizontal", inventario: 18, vendidas: 82, absorcion: 7.3, lat: 21.963194, lon: -102.251287, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Vista Serena CS", tipo: "horizontal", inventario: 4, vendidas: 96, absorcion: 6.0, lat: 21.96354, lon: -102.251143, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Arroyo Brunet", tipo: "horizontal", inventario: 88, vendidas: 18, absorcion: 1.5, lat: 21.950759, lon: -102.342087, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Arroyo San Emilion", tipo: "horizontal", inventario: 54, vendidas: 53, absorcion: 1.1, lat: 21.951548, lon: -102.338764, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Cantelli Etapa II Coto", tipo: "horizontal", inventario: 9, vendidas: 27, absorcion: 1.2, lat: 21.848531, lon: -102.336203, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Carena Residencial", tipo: "horizontal", inventario: 2, vendidas: 81, absorcion: 2.4, lat: 21.883237, lon: -102.347502, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Castelo San Francisco", tipo: "horizontal", inventario: 18, vendidas: 323, absorcion: 10.0, lat: 21.973552, lon: -102.267012, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Colinas de San Patricio", tipo: "horizontal", inventario: 8, vendidas: 60, absorcion: 2.1, lat: 21.886702, lon: -102.235755, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Ferrara Entorno", tipo: "horizontal", inventario: 204, vendidas: 141, absorcion: 4.2, lat: 21.971835, lon: -102.299958, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Fraccionamiento Gran", tipo: "horizontal", inventario: 500, vendidas: 150, absorcion: 6.0, lat: 21.954352, lon: -102.273751, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "La Cartuja Etapa V", tipo: "horizontal", inventario: 248, vendidas: 58, absorcion: 5.1, lat: 21.990427, lon: -102.33767, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "La Nueva Stacia Etapas", tipo: "horizontal", inventario: 130, vendidas: 370, absorcion: 12.1, lat: 21.966373, lon: -102.30268, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Landa Residencial Cotos", tipo: "horizontal", inventario: 505, vendidas: 68, absorcion: 6.5, lat: 21.98524, lon: -102.335796, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Lucerna Residencial", tipo: "horizontal", inventario: 35, vendidas: 140, absorcion: 3.6, lat: 21.815357, lon: -102.289739, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Punto Portia", tipo: "vertical", inventario: 90, vendidas: 60, absorcion: 1.9, lat: 21.952781, lon: -102.341532, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Real del Sol Sector VII", tipo: "horizontal", inventario: 83, vendidas: 297, absorcion: 10.8, lat: 21.890806, lon: -102.236788, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Reserva San Matías", tipo: "horizontal", inventario: 49, vendidas: 79, absorcion: 4.0, lat: 21.829037, lon: -102.273765, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Residencial Cholula 665", tipo: "vertical", inventario: 25, vendidas: 10, absorcion: 0.5, lat: 21.886361, lon: -102.304678, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Mezquite", tipo: "vertical", inventario: 1, vendidas: 11, absorcion: 0.7, lat: 21.935078, lon: -102.31632, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Oporto 11Jr", tipo: "vertical", inventario: 8, vendidas: 1, absorcion: 0.0, lat: 21.939153, lon: -102.338413, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Toscana San Gerardo", tipo: "horizontal", inventario: 17, vendidas: 146, absorcion: 2.1, lat: 21.801677, lon: -102.299391, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Tremezzo", tipo: "vertical", inventario: 24, vendidas: 24, absorcion: 0.7, lat: 21.951096, lon: -102.339729, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "VilaNova Residencial CS", tipo: "horizontal", inventario: 101, vendidas: 84, absorcion: 2.8, lat: 21.828309, lon: -102.320364, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "VilaNova Residencial", tipo: "vertical", inventario: 8, vendidas: 64, absorcion: 2.1, lat: 21.828374, lon: -102.32009, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Villas de Montecasino", tipo: "horizontal", inventario: 130, vendidas: 320, absorcion: 12.8, lat: 21.995751, lon: -102.306818, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Villas de Montecassino", tipo: "horizontal", inventario: 4, vendidas: 196, absorcion: 7.4, lat: 21.995955, lon: -102.312272, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Zekkei", tipo: "horizontal", inventario: 5, vendidas: 113, absorcion: 4.0, lat: 21.800813, lon: -102.297802, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Zekkei II", tipo: "horizontal", inventario: 76, vendidas: 60, absorcion: 2.9, lat: 21.801922, lon: -102.297856, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Abada Residencial Etapa", tipo: "horizontal", inventario: 35, vendidas: 145, absorcion: 3.0, lat: 21.942957, lon: -102.344596, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Albaserrada Habitacional", tipo: "horizontal", inventario: 66, vendidas: 17, absorcion: 0.7, lat: 21.872396, lon: -102.322318, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Amandra", tipo: "horizontal", inventario: 30, vendidas: 36, absorcion: 1.5, lat: 21.942845, lon: -102.311352, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Amura Residencial", tipo: "horizontal", inventario: 229, vendidas: 123, absorcion: 2.4, lat: 21.824245, lon: -102.32023, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Andrea Residencial", tipo: "horizontal", inventario: 30, vendidas: 52, absorcion: 1.3, lat: 21.945859, lon: -102.313513, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Aunna", tipo: "vertical", inventario: 42, vendidas: 28, absorcion: 0.8, lat: 21.949707, lon: -102.324261, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Burdeos Residencial", tipo: "horizontal", inventario: 10, vendidas: 10, absorcion: 0.3, lat: 21.839201, lon: -102.323285, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Caranday II Sector Betel", tipo: "horizontal", inventario: 15, vendidas: 99, absorcion: 3.3, lat: 21.821366, lon: -102.323846, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Caranday II Sector II", tipo: "horizontal", inventario: 62, vendidas: 19, absorcion: 1.4, lat: 21.822388, lon: -102.324562, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Diana Tower", tipo: "vertical", inventario: 8, vendidas: 35, absorcion: 2.4, lat: 21.879279, lon: -102.301348, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Distrito Kauré Etapa I", tipo: "vertical", inventario: 6, vendidas: 35, absorcion: 1.0, lat: 21.93622, lon: -102.31879, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Ébano Carmel", tipo: "horizontal", inventario: 1, vendidas: 19, absorcion: 0.6, lat: 21.857669, lon: -102.370908, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Ébano Carmel", tipo: "horizontal", inventario: 9, vendidas: 11, absorcion: 0.4, lat: 21.858881, lon: -102.372515, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Garza Sada 128", tipo: "vertical", inventario: 2, vendidas: 28, absorcion: 0.7, lat: 21.916137, lon: -102.33222, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Hacienda el Cobano", tipo: "horizontal", inventario: 6, vendidas: 33, absorcion: 1.2, lat: 21.904787, lon: -102.278398, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Kerarta Residencial", tipo: "horizontal", inventario: 10, vendidas: 62, absorcion: 1.9, lat: 21.807928, lon: -102.288726, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Lindavista Deptos", tipo: "vertical", inventario: 3, vendidas: 7, absorcion: 0.4, lat: 21.86944, lon: -102.289267, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Lúzia Residencial Etapa I", tipo: "horizontal", inventario: 60, vendidas: 60, absorcion: 2.1, lat: 21.82523, lon: -102.317616, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Maranta 07 AMK", tipo: "vertical", inventario: 5, vendidas: 1, absorcion: 0.2, lat: 21.905642, lon: -102.335618, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Marengo Gran Vivir", tipo: "horizontal", inventario: 29, vendidas: 26, absorcion: 4.8, lat: 21.911901, lon: -102.285537, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Misión 208", tipo: "vertical", inventario: 6, vendidas: 18, absorcion: 0.5, lat: 21.931863, lon: -102.30995, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Monte Blanco High", tipo: "vertical", inventario: 8, vendidas: 0, absorcion: 0.0, lat: 21.923599, lon: -102.301908, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Montecristo Desarrollo", tipo: "vertical", inventario: 20, vendidas: 20, absorcion: 0.9, lat: 21.92875, lon: -102.319415, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Olena Residencial Etapa", tipo: "horizontal", inventario: 148, vendidas: 88, absorcion: 2.9, lat: 21.962181, lon: -102.309058, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Punta del Cielo Privada", tipo: "horizontal", inventario: 155, vendidas: 59, absorcion: 1.5, lat: 21.901914, lon: -102.351291, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Punta del Cielo Torre III", tipo: "vertical", inventario: 33, vendidas: 3, absorcion: 0.5, lat: 21.906824, lon: -102.353729, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Reserva Xaramá", tipo: "horizontal", inventario: 82, vendidas: 0, absorcion: 0.0, lat: 21.875655, lon: -102.325866, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "San Javier 240 Torre l", tipo: "vertical", inventario: 13, vendidas: 19, absorcion: 1.0, lat: 21.85862, lon: -102.335247, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "SoHma Urban Living", tipo: "vertical", inventario: 76, vendidas: 8, absorcion: 0.7, lat: 21.935131, lon: -102.341806, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "St Charbel", tipo: "vertical", inventario: 3, vendidas: 37, absorcion: 0.6, lat: 21.905171, lon: -102.334925, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Cadaqués", tipo: "vertical", inventario: 81, vendidas: 50, absorcion: 1.4, lat: 21.930213, lon: -102.307921, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Elite", tipo: "vertical", inventario: 10, vendidas: 19, absorcion: 0.9, lat: 21.919564, lon: -102.312499, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Sentzia", tipo: "vertical", inventario: 32, vendidas: 15, absorcion: 0.6, lat: 21.955155, lon: -102.308023, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Trigales", tipo: "vertical", inventario: 2, vendidas: 10, absorcion: 0.3, lat: 21.925937, lon: -102.311601, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Torre Universidad", tipo: "vertical", inventario: 11, vendidas: 16, absorcion: 0.7, lat: 21.905837, lon: -102.3069, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Vértika", tipo: "vertical", inventario: 3, vendidas: 15, absorcion: 0.4, lat: 21.935791, lon: -102.305659, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Viñedos Ribier Etapa I", tipo: "horizontal", inventario: 30, vendidas: 153, absorcion: 4.4, lat: 21.974912, lon: -102.286349, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Vivanta Residencial", tipo: "horizontal", inventario: 100, vendidas: 275, absorcion: 3.6, lat: 21.938706, lon: -102.293071, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Xaramá Residencial", tipo: "horizontal", inventario: 80, vendidas: 320, absorcion: 4.4, lat: 21.875224, lon: -102.325898, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Zatae", tipo: "vertical", inventario: 7, vendidas: 2, absorcion: 0.1, lat: 21.928235, lon: -102.306392, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
  { nombre: "Rinconada Jacarandas", tipo: "horizontal", inventario: 6, vendidas: 14, absorcion: 0.7, lat: 21.9359, lon: -102.31113, confianza: "exacta", geocode: "Coordenada oficial del estudio Softec (reporte de proyectos, pag. 40-59)" },
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
  const confTxt = "Ubicación oficial (coordenada del estudio de mercado).";
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
