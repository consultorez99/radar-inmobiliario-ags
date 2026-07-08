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

function buildTraficoLayer() {
  return L.tileLayer(
    `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}&thickness=10`,
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
