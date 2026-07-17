/* Estimación EXPERIMENTAL de NSE (Bajo/Medio/Alto) para zonas urbanizadas sin
 * AGEB 2020 — fraccionamientos construidos después del Censo, que hoy aparecen
 * en blanco en la capa NSE. Generada por scripts/build_denue_proxy.py: un
 * modelo calibrado contra los 373 AGEBs conocidos usando la mezcla de giros
 * de negocio del directorio DENUE (INEGI). Ver metodología y validación
 * completas en el modal "Acerca de".
 *
 * A propósito usa solo 3 niveles (no los 7 de la capa NSE censal) y un
 * paisaje de color distinto (violeta) con borde punteado — para que nunca se
 * confunda visualmente con un dato oficial. Capa superpuesta, independiente
 * de las 8 capas exclusivas.
 */

"use strict";

const DENUE_PROXY_COLORS = { "Alto": "#5b2a86", "Medio": "#9b6bc4", "Bajo": "#d9c2ec", "No estimado": "#9ca3af" };

function denueProxyEstilo(props) {
  const color = DENUE_PROXY_COLORS[props.nse_nivel_estimado || "No estimado"];
  return {
    color: "#3a1d54",
    weight: 1.5,
    dashArray: "5,4",
    fillColor: color,
    fillOpacity: props.excluido ? 0.25 : 0.55,
  };
}

function denueProxyPopup(p) {
  if (p.excluido) {
    return `
      <div class="popup-title">Zona sin AGEB — no estimada</div>
      <table class="popup-table">
        <tr><td>Negocios detectados</td><td><strong>${p.n_negocios}</strong></td></tr>
        <tr><td>Giro predominante</td><td>${p.actividad_top || "—"}</td></tr>
      </table>
      <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">No se estimó NSE aquí: ${p.excluido}.
        Fuente: DENUE INEGI ${DATA.denueProxy?.meta?.corte_denue || ""}.</div>`;
  }
  return `
    <div class="popup-title">⚠ NSE estimado (experimental): ${p.nse_nivel_estimado}</div>
    <table class="popup-table">
      <tr><td>Negocios detectados</td><td><strong>${p.n_negocios}</strong></td></tr>
      <tr><td>Giro predominante</td><td>${p.actividad_top || "—"}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">
      <strong>No es dato censal ni oficial.</strong> Modelo calibrado con negocios DENUE (INEGI),
      validado contra AGEBs conocidos con ~62% de acierto exacto en 3 niveles (ver "Acerca de").
      Zona sin AGEB del Censo 2020 — probable fraccionamiento nuevo.</div>`;
}

let denueProxyLayer = null;
let denueProxyVisible = false;

async function loadDenueProxy() {
  const resp = await fetch("../data/ags_denue_proxy.json");
  if (!resp.ok) return;
  const gj = await resp.json();
  DATA.denueProxy = gj;

  denueProxyLayer = L.geoJSON(gj, {
    style: denueProxyEstilo,
    onEachFeature: (f, layer) => layer.bindPopup(denueProxyPopup(f.properties), { maxWidth: 280 }),
  });

  const v = gj.meta.validacion_cruzada;
  document.getElementById("legend-denue-nota").innerHTML =
    `Validación cruzada contra AGEBs conocidos: correlación ${v.correlacion.toFixed(2)},
     acierto exacto ${v.acierto_exacto_3niveles_pct}% en 3 niveles (rara vez se confunde
     Bajo con Alto: ${v.error_grave_pct}%). <strong>No es dato censal.</strong>
     Fuente: DENUE INEGI, corte ${gj.meta.corte_denue}.`;

  // si el usuario (o un permalink) ya pidió verla antes de que terminara de cargar
  if (denueProxyVisible) denueProxyLayer.addTo(map);
}

const btnDenue = document.getElementById("btn-denue");
const legendDenue = document.getElementById("legend-denue");

btnDenue.addEventListener("click", () => {
  denueProxyVisible = !denueProxyVisible;
  btnDenue.classList.toggle("active", denueProxyVisible);
  legendDenue.classList.toggle("hidden", !denueProxyVisible);
  if (!denueProxyLayer) return; // aún cargando: loadDenueProxy() la añade sola al terminar
  if (denueProxyVisible) denueProxyLayer.addTo(map);
  else map.removeLayer(denueProxyLayer);
});

loadDenueProxy();
