/* Directorio completo DENUE (INEGI): 57,931 negocios en Aguascalientes y
 * Jesús María — capa de dato crudo, sin modelo (para la estimación de NSE
 * en zonas nuevas ver denue_proxy.js). Dato abierto, actualización semestral.
 *
 * 58k puntos es demasiado para tener todos como L.circleMarker activos a la
 * vez — construirlos y añadirlos todos de golpe (incluso con L.canvas())
 * congela el hilo principal varios segundos. En vez de eso, esta capa se
 * reconstruye en cada pan/zoom mostrando solo los puntos dentro del
 * viewport actual (+ margen) — en la práctica nunca son más que unos
 * cientos a la vez, aunque el archivo tenga 58k. Por debajo del zoom 14
 * se oculta del todo: a nivel ciudad sería una mancha ilegible.
 */

"use strict";

const DENUE_ZOOM_MIN = 15;   // a 14, la zona comercial densa del centro pasa de 15k puntos: ~1s de bloqueo
const DENUE_MAX_PUNTOS = 4000; // red de seguridad: alguna zona densa puntual podría superar esto incluso a zoom 15

const DENUE_NEG_COLORES = {
  "Comercio": "#ea580c",
  "Comercio mayoreo": "#9a3412",
  "Restaurantes y hospedaje": "#dc2626",
  "Servicios personales": "#db2777",
  "Salud": "#0d9488",
  "Educación": "#2563eb",
  "Profesional y financiero": "#4338ca",
  "Industria y construcción": "#78716c",
  "Transporte": "#0891b2",
  "Esparcimiento": "#ca8a04",
  "Otros": "#6b7280",
};

const denueNegCanvas = L.canvas({ padding: 0.3 });
const denueNegCapa = L.layerGroup(); // se limpia y reconstruye en cada refresco
let denueNegVisible = false;
let denueNegData = null;
let denueNegCategoriasActivas = new Set();
let denueNegTimer = null;

function denueNegPopup(nombre, categoria, actividad, tamano, corte) {
  return `
    <div class="popup-title">${nombre}</div>
    <table class="popup-table">
      <tr><td>Categoría</td><td><strong>${categoria}</strong></td></tr>
      <tr><td>Giro</td><td>${actividad}</td></tr>
      <tr><td>Tamaño</td><td>${tamano}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">DENUE, INEGI — dato abierto, corte ${corte}.</div>`;
}

async function loadDenueNegocios() {
  const resp = await fetch("../data/ags_denue_negocios.json");
  if (!resp.ok) return;
  const d = await resp.json();
  denueNegData = d;
  denueNegCategoriasActivas = new Set(d.categorias);

  const conteoPorCategoria = Object.fromEntries(d.categorias.map((c) => [c, 0]));
  for (const [, catIdx] of d.negocios) conteoPorCategoria[d.categorias[catIdx]]++;

  const rows = document.getElementById("legend-denue-neg-rows");
  rows.innerHTML = d.categorias.map((cat) => `
    <label class="legend-row poi-check">
      <input type="checkbox" data-cat="${cat}" checked>
      <span class="legend-dot" style="background:${DENUE_NEG_COLORES[cat] || "#6b7280"}"></span>
      <span>${cat} (${conteoPorCategoria[cat].toLocaleString("es-MX")})</span>
    </label>`).join("");

  rows.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (chk.checked) denueNegCategoriasActivas.add(chk.dataset.cat);
      else denueNegCategoriasActivas.delete(chk.dataset.cat);
      refrescarDenueNeg();
    });
  });

  document.getElementById("legend-denue-neg-total").textContent =
    `${d.meta.total.toLocaleString("es-MX")} negocios en total · DENUE INEGI, corte ${d.meta.corte}`;

  refrescarDenueNeg(); // por si ya estaba activada (permalink) antes de terminar de cargar
}

// Reconstruye la capa con solo los puntos del viewport actual — nunca los
// 58k de golpe. Debounced: un pan/zoom rápido no debe recalcular en cada frame.
function refrescarDenueNeg() {
  clearTimeout(denueNegTimer);
  denueNegTimer = setTimeout(_refrescarDenueNegYa, 120);
}

function _refrescarDenueNegYa() {
  const hint = document.getElementById("denue-neg-zoom-hint");
  denueNegCapa.clearLayers();

  const ocultarTodo = () => { hint.classList.add("hidden"); if (map.hasLayer(denueNegCapa)) map.removeLayer(denueNegCapa); };

  if (!denueNegVisible || !denueNegData) { ocultarTodo(); return; }
  if (map.getZoom() < DENUE_ZOOM_MIN) {
    hint.textContent = `Acércate para ver los negocios (zoom ≥ ${DENUE_ZOOM_MIN})`;
    hint.classList.remove("hidden");
    if (map.hasLayer(denueNegCapa)) map.removeLayer(denueNegCapa);
    return;
  }

  // primera pasada: filtrar y contar antes de construir nada. Alguna zona
  // puntualmente muy densa (p.ej. un mercado) podría rebasar el tope de
  // puntos incluso ya con el zoom mínimo — mejor pedir más zoom que
  // bloquear el hilo principal ~1s construyendo miles de círculos.
  const b = map.getBounds().pad(0.1);
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const d = denueNegData;
  const filtrados = [];
  for (const fila of d.negocios) {
    const [, catIdx, , , lat, lon] = fila;
    if (lat < sw.lat || lat > ne.lat || lon < sw.lng || lon > ne.lng) continue;
    if (!denueNegCategoriasActivas.has(d.categorias[catIdx])) continue;
    filtrados.push(fila);
  }

  if (filtrados.length > DENUE_MAX_PUNTOS) {
    hint.textContent = `Demasiados negocios aquí (${filtrados.length.toLocaleString("es-MX")}) — acércate más`;
    hint.classList.remove("hidden");
    if (map.hasLayer(denueNegCapa)) map.removeLayer(denueNegCapa);
    return;
  }
  hint.classList.add("hidden");

  for (const [nombre, catIdx, actIdx, tamIdx, lat, lon] of filtrados) {
    const categoria = d.categorias[catIdx];
    L.circleMarker([lat, lon], {
      renderer: denueNegCanvas, radius: 3.5, weight: 0,
      fillColor: DENUE_NEG_COLORES[categoria] || "#6b7280", fillOpacity: 0.75,
    })
      .bindPopup(() => denueNegPopup(nombre, categoria, d.actividades[actIdx], d.tamanos[tamIdx], d.meta.corte), { maxWidth: 260 })
      .addTo(denueNegCapa);
  }
  if (!map.hasLayer(denueNegCapa)) denueNegCapa.addTo(map);
}

const btnDenueNeg = document.getElementById("btn-denue-neg");
const legendDenueNeg = document.getElementById("legend-denue-neg");

btnDenueNeg.addEventListener("click", () => {
  denueNegVisible = !denueNegVisible;
  btnDenueNeg.classList.toggle("active", denueNegVisible);
  legendDenueNeg.classList.toggle("hidden", !denueNegVisible);
  if (!denueNegVisible) map.removeLayer(denueNegCapa);
  refrescarDenueNeg();
});

map.on("zoomend moveend", refrescarDenueNeg);

loadDenueNegocios();
