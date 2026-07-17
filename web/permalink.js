/* Permalinks: codifica la vista actual en el hash de la URL para poder
 * compartir un análisis con solo copiar la barra de direcciones.
 *
 *   #map=Z/LAT/LNG            vista (zoom/centro), estilo openstreetmap.org
 *   &capa=pdu                 capa exclusiva activa (omitida si es NSE, "no" si ninguna)
 *   &ov=proy,poi              capas superpuestas encendidas
 *   &buf=LAT,LNG,R            análisis de radio (km)
 *   &pol=LAT,LNG;LAT,LNG;...  polígono dibujado (excluyente con buf)
 *
 * Se actualiza en vivo con history.replaceState (sin ensuciar el historial) y
 * se restaura al cargar: la vista de inmediato, y capa/overlays/análisis al
 * final de loadData() (main.js llama a plRestaurar cuando los datos existen).
 * Debe cargarse al final de index.html: usa globals de main/zona/buffer/
 * poi/proyectos (scripts clásicos con scope compartido).
 */

"use strict";

function plParse() {
  const out = {};
  for (const parte of location.hash.replace(/^#/, "").split("&")) {
    const i = parte.indexOf("=");
    if (i > 0) out[parte.slice(0, i)] = decodeURIComponent(parte.slice(i + 1));
  }
  return out;
}

// ---- vista inicial: aplicarla ya (main.js creó `map`; su fitBounds por
// defecto se salta solo si el hash trae map=, ver loadData)
(function () {
  const p = plParse();
  if (!p.map) return;
  const [z, lat, lng] = p.map.split("/").map(Number);
  if ([z, lat, lng].every(Number.isFinite)) map.setView([lat, lng], z, { animate: false });
})();

// ---- serialización (debounced; inactiva hasta que plRestaurar corre para
// no pisar el hash compartido antes de haberlo leído)
let plListo = false;
let plTimer = null;

function plActualizar() {
  if (!plListo) return;
  clearTimeout(plTimer);
  plTimer = setTimeout(() => {
    const c = map.getCenter();
    const partes = [`map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`];
    if (activeLayerName !== "nse") partes.push(`capa=${activeLayerName || "no"}`);
    const ov = [];
    if (proyectosVisible) ov.push("proy");
    if (poiVisible) ov.push("poi");
    if (denueProxyVisible) ov.push("denue");
    if (denueNegVisible) ov.push("negdenue");
    if (ov.length) partes.push(`ov=${ov.join(",")}`);
    const bs = window.getBufferStats?.();
    if (bs) {
      partes.push(`buf=${bs.lat.toFixed(5)},${bs.lng.toFixed(5)},${bs.radiusKm}`);
    } else if (currentZone) {
      // GeoJSON repite el primer vértice al final: se omite. Un polígono con
      // demasiados vértices haría una URL impráctica — se comparte sin él.
      const anillo = currentZone.geometry.coordinates[0].slice(0, -1);
      if (anillo.length >= 3 && anillo.length <= 60) {
        partes.push(`pol=${anillo.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";")}`);
      }
    }
    history.replaceState(null, "", "#" + partes.join("&"));
  }, 250);
}
window.plActualizar = plActualizar;

// ---- restauración del resto del estado (main.js la llama al final de
// loadData; el PDU y los análisis manejan su propia carga diferida)
window.plRestaurar = function () {
  const p = plParse();
  if (p.capa && p.capa !== activeLayerName) {
    if (p.capa === "no") setLayer(activeLayerName); // click en la activa la apaga
    else if (LAYERS[p.capa]) setLayer(p.capa);
  }
  if (p.ov) {
    const ov = p.ov.split(",");
    if (ov.includes("proy") && !proyectosVisible) document.getElementById("btn-proyectos").click();
    if (ov.includes("poi") && !poiVisible) document.getElementById("btn-poi").click();
    if (ov.includes("denue") && !denueProxyVisible) document.getElementById("btn-denue").click();
    if (ov.includes("negdenue") && !denueNegVisible) document.getElementById("btn-denue-neg").click();
  }
  if (p.buf) {
    const [lat, lng, r] = p.buf.split(",").map(Number);
    if ([lat, lng, r].every(Number.isFinite) && r > 0 && r <= 20) {
      runBufferAnalysis(lat, lng, r, { fit: !p.map }); // con map= se respeta la vista compartida
    }
  } else if (p.pol) {
    const pts = p.pol.split(";")
      .map((s) => s.split(",").map(Number))
      .filter((a) => a.length === 2 && a.every(Number.isFinite));
    if (pts.length >= 3) {
      const capa = L.polygon(pts);
      drawnItems.clearLayers();
      drawnItems.addLayer(capa);
      setZone(capa.toGeoJSON());
    }
  }
  plListo = true;
  plActualizar();
};

map.on("moveend", plActualizar);
map.on("zoomend", plActualizar);
for (const id of ["btn-proyectos", "btn-poi", "btn-denue", "btn-denue-neg"]) {
  document.getElementById(id).addEventListener("click", plActualizar);
}
