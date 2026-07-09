/* Capa "Tráfico": flujo vehicular en TIEMPO REAL de TomTom Traffic
 * (raster tiles sobre el mapa base). Requiere TOMTOM_API_KEY en config.js.
 *
 * Estilo "relative": color por velocidad actual relativa al flujo libre
 * (verde = fluido, naranja = lento, rojo = congestionado, guinda = parado).
 * Los tiles se piden directo a TomTom desde el navegador — el plan gratuito
 * (50,000 tiles/día) sobra para el uso de esta app.
 *
 * A diferencia del resto de capas (datos oficiales/censales estáticos),
 * esta es telemetría comercial en vivo de un tercero; si TomTom cambia su
 * plan gratuito o la clave se agota, la capa deja de cargar sin afectar
 * lo demás.
 */

"use strict";

let traficoLayer = null;
let traficoVisible = false;
let traficoSegmento = null;  // polyline resaltada del último clic

// Con la capa activa, un clic consulta el Flow Segment Data de TomTom
// (velocidad actual vs. flujo libre del tramo más cercano). Es una petición
// "non-tile" (plan gratuito: 2,500/día — de sobra para clics manuales).
const FRC_NOMBRES = {
  FRC0: "Autopista", FRC1: "Carretera principal", FRC2: "Carretera",
  FRC3: "Avenida principal", FRC4: "Avenida", FRC5: "Calle colectora", FRC6: "Calle local",
};

function nivelTrafico(actual, libre) {
  if (!libre) return ["Sin dato", "#9ca3af"];
  const r = actual / libre;
  if (r >= 0.9) return ["Fluido", "#2ecc40"];
  if (r >= 0.7) return ["Lento", "#ff851b"];
  if (r >= 0.4) return ["Congestionado", "#ff4136"];
  return ["Detenido", "#85144b"];
}

async function consultarSegmento(e) {
  if (!traficoVisible) return;
  const { lat, lng } = e.latlng;
  try {
    const r = await fetch(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json` +
      `?point=${lat.toFixed(6)},${lng.toFixed(6)}&unit=KMPH&key=${TOMTOM_API_KEY}`);
    if (!r.ok) return;
    const d = (await r.json()).flowSegmentData;
    if (!d || !d.coordinates) return;

    // solo si el tramo devuelto está razonablemente cerca del clic (<250 m);
    // si no, el usuario pulsó lejos de una vialidad con datos: no estorbar
    const coords = d.coordinates.coordinate.map((c) => L.latLng(c.latitude, c.longitude));
    const distMin = Math.min(...coords.map((c) => e.latlng.distanceTo(c)));
    if (distMin > 250) return;

    if (traficoSegmento) map.removeLayer(traficoSegmento);
    traficoSegmento = L.polyline(coords, { color: "#3a1f6e", weight: 6, opacity: 0.75 }).addTo(map);

    const [nivel, color] = d.roadClosure ? ["Vía cerrada", "#85144b"] : nivelTrafico(d.currentSpeed, d.freeFlowSpeed);
    const demora = d.currentTravelTime - d.freeFlowTravelTime;
    L.popup({ maxWidth: 250 })
      .setLatLng(e.latlng)
      .setContent(`
        <div class="popup-title">${FRC_NOMBRES[d.frc] || "Vialidad"}</div>
        <span class="popup-badge" style="background:${color}">${nivel}</span>
        <table class="popup-table" style="margin-top:6px">
          <tr><td>Velocidad actual</td><td><strong>${d.currentSpeed} km/h</strong></td></tr>
          <tr><td>Flujo libre</td><td>${d.freeFlowSpeed} km/h</td></tr>
          <tr><td>Demora en el tramo</td><td>${demora > 0 ? "+" + demora + " s" : "sin demora"}</td></tr>
        </table>
        <div style="margin-top:5px;font-size:10.5px;color:#6b5f85">Tramo más cercano al clic (resaltado en morado). Tráfico en vivo © TomTom.</div>`)
      .openOn(map);
  } catch (err) { /* sin red o sin dato: no estorbar */ }
}

map.on("click", consultarSegmento);
map.on("popupclose", () => {
  if (traficoSegmento) { map.removeLayer(traficoSegmento); traficoSegmento = null; }
});

function buildTraficoLayer() {
  return L.tileLayer(
    `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}&thickness=6`,
    {
      maxZoom: 19,
      opacity: 0.85,
      attribution: 'Tráfico © <a href="https://www.tomtom.com">TomTom</a>',
    }
  );
}

const btnTrafico = document.getElementById("btn-trafico");
const legendTrafico = document.getElementById("legend-trafico");

btnTrafico.addEventListener("click", () => {
  if (!TOMTOM_API_KEY) {
    alert(
      "La capa de tráfico necesita una API key gratuita de TomTom.\n\n" +
      "1. Crea una cuenta en developer.tomtom.com (plan gratuito, sin tarjeta).\n" +
      "2. Copia tu API key.\n" +
      "3. Pégala en web/config.js (TOMTOM_API_KEY) y vuelve a desplegar."
    );
    return;
  }
  traficoVisible = !traficoVisible;
  btnTrafico.classList.toggle("active", traficoVisible);
  legendTrafico.classList.toggle("hidden", !traficoVisible);
  if (traficoVisible) {
    if (!traficoLayer) traficoLayer = buildTraficoLayer();
    traficoLayer.addTo(map);
  } else if (traficoLayer) {
    map.removeLayer(traficoLayer);
  }
});
