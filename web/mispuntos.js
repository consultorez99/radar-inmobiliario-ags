/* "Mis puntos": el usuario carga su propio archivo (sucursales, clientes,
 * sitios candidatos) y se pinta sobre el mapa; los análisis (radio,
 * isócronas, polígono) cuentan cuántos caen dentro, en el bloque de
 * competencia (competencia.js).
 *
 * Privacidad: el archivo se lee con FileReader dentro del navegador y nunca
 * se envía a ningún servidor ni se guarda (ni en localStorage): al recargar
 * la página se pierde. Por lo mismo no viaja en el permalink.
 *
 * Formatos: CSV (cualquier separador, UTF-8 o Windows-1252 como lo exporta
 * Excel en español), Excel .xlsx (SheetJS, se descarga solo si hace falta)
 * y GeoJSON de puntos. Requiere: main.js (map), mispuntos-core.js.
 */

"use strict";

const MP_COLOR = "#1e3a8a";
// grupos (columna "tipo"/"marca"…): hasta 6 colores distinguibles; más que
// eso, todos del mismo color y el grupo queda en el popup
const MP_PALETA = ["#1e3a8a", "#0891b2", "#65a30d", "#ea580c", "#7c3aed", "#be123c"];
const MP_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

let mpDatos = null;      // { archivo, puntos, descartados, invertidas, colores }
let mpVisible = false;
const mpCanvas = L.canvas({ padding: 0.3 });
const mpGroup = L.layerGroup();

const mpEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function mpColor(p) {
  return (mpDatos?.colores && p.grupo && mpDatos.colores[p.grupo]) || MP_COLOR;
}

// ------------------------------------------------------------------ lectura
async function mpCargarSheetJS() {
  if (window.XLSX) return;
  await new Promise((ok, fallo) => {
    const s = document.createElement("script");
    s.src = MP_SHEETJS;
    s.onload = ok;
    s.onerror = () => fallo(new Error("No se pudo cargar el lector de Excel. Guarda el archivo como CSV e inténtalo de nuevo."));
    document.head.appendChild(s);
  });
}

/* Excel en español guarda los CSV en Windows-1252: leído como UTF-8, las
 * "ñ" y acentos salen como U+FFFD. Si aparece alguno, se relee así. */
async function mpLeerTexto(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

async function mpInterpretar(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "geojson" || ext === "json") {
    let gj;
    try { gj = JSON.parse(await mpLeerTexto(file)); } catch (e) { throw new Error("El archivo JSON no es válido."); }
    return MisPuntosCore.desdeGeoJSON(gj);
  }
  if (ext === "xlsx" || ext === "xls") {
    await mpCargarSheetJS();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" })
      .filter((f) => f.some((c) => String(c).trim() !== ""));
    const [enc = [], ...resto] = filas;
    return MisPuntosCore.aPuntos(enc.map((h) => String(h).trim()), resto);
  }
  const { encabezados, filas } = MisPuntosCore.parseCSV(await mpLeerTexto(file));
  return MisPuntosCore.aPuntos(encabezados, filas);
}

async function mpCargarArchivo(file) {
  const estado = document.getElementById("mp-estado");
  estado.textContent = `Leyendo ${file.name}…`;
  let r;
  try {
    r = await mpInterpretar(file);
  } catch (e) {
    estado.innerHTML = `<span class="mp-error">⚠ ${mpEsc(e.message)}</span>`;
    return;
  }
  if (r.error || !r.puntos.length) {
    estado.innerHTML = `<span class="mp-error">⚠ ${mpEsc(r.error || "Ningún renglón con coordenadas válidas.")}</span>` +
      mpDescartadosHTML(r);
    return;
  }
  const grupos = Object.keys(MisPuntosCore.conteoPorGrupo(r.puntos)).filter((g) => g !== "Sin grupo");
  const colores = grupos.length && grupos.length <= MP_PALETA.length
    ? Object.fromEntries(grupos.map((g, i) => [g, MP_PALETA[i]])) : null;
  mpDatos = { archivo: file.name, ...r, colores };
  mpDibujar();
  mpRenderLeyenda();
  const b = L.latLngBounds(r.puntos.map((p) => [p.lat, p.lon]));
  map.fitBounds(b.pad(0.15), { maxZoom: 15, animate: false });
  window.Competencia?.refrescar();
}

function mpQuitar() {
  mpDatos = null;
  mpGroup.clearLayers();
  mpRenderLeyenda();
  window.Competencia?.refrescar();
}

// ------------------------------------------------------------------- mapa
function mpDibujar() {
  mpGroup.clearLayers();
  if (!mpDatos || !mpVisible) { map.removeLayer(mpGroup); return; }
  for (const p of mpDatos.puntos) {
    const filas = Object.entries(p.props).slice(0, 10)
      .map(([k, v]) => `<tr><td>${mpEsc(k)}</td><td>${mpEsc(v)}</td></tr>`).join("");
    L.circleMarker([p.lat, p.lon], {
      renderer: mpCanvas, radius: 6, weight: 2, color: "#fff",
      fillColor: mpColor(p), fillOpacity: 1,
    })
      .bindPopup(`<div class="popup-title">${mpEsc(p.nombre)}</div>
        <table class="popup-table">${filas}</table>
        <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Tu archivo: ${mpEsc(mpDatos.archivo)}</div>`,
        { maxWidth: 280 })
      .addTo(mpGroup);
  }
  if (!map.hasLayer(mpGroup)) mpGroup.addTo(map);
}

// ---------------------------------------------------------------- leyenda
function mpDescartadosHTML(r) {
  if (!r.descartados?.length) return "";
  const muestra = r.descartados.slice(0, 5)
    .map((d) => `renglón ${d.fila}: ${mpEsc(d.motivo)}`).join("<br>");
  const n = r.descartados.length;
  return `<div class="legend-note">${n} ${n === 1 ? "renglón descartado" : "renglones descartados"}:<br>${muestra}` +
    `${r.descartados.length > 5 ? "<br>…" : ""}</div>`;
}

function mpRenderLeyenda() {
  const estado = document.getElementById("mp-estado");
  const quitar = document.getElementById("mp-quitar");
  quitar.classList.toggle("hidden", !mpDatos);
  if (!mpDatos) {
    estado.innerHTML = `Carga un archivo con tus sucursales, clientes o sitios candidatos.`;
    return;
  }
  const conteo = MisPuntosCore.conteoPorGrupo(mpDatos.puntos);
  const grupos = mpDatos.colores
    ? Object.entries(conteo).map(([g, n]) => `
        <div class="legend-row"><span class="legend-dot" style="background:${mpDatos.colores[g] || MP_COLOR}"></span>
          ${mpEsc(g)} (${n})</div>`).join("")
    : "";
  estado.innerHTML = `
    <strong>${mpDatos.puntos.length.toLocaleString("es-MX")} puntos</strong> de ${mpEsc(mpDatos.archivo)}
    ${grupos ? `<div class="legend-rows">${grupos}</div>` : ""}
    ${mpDatos.invertidas ? `<div class="legend-note">${mpDatos.invertidas === 1 ? "1 punto tenía" : `${mpDatos.invertidas} puntos tenían`}
      latitud y longitud invertidas: se corrigió.</div>` : ""}
    ${mpDescartadosHTML(mpDatos)}`;
}

// ------------------------------------------------------------------ eventos
const btnMp = document.getElementById("btn-mispuntos");
const legendMp = document.getElementById("legend-mispuntos");
const inputMp = document.getElementById("mp-archivo");

btnMp.addEventListener("click", () => {
  mpVisible = !mpVisible;
  btnMp.classList.toggle("active", mpVisible);
  legendMp.classList.toggle("hidden", !mpVisible);
  mpDibujar();
  // la primera vez, directo al selector de archivo: es lo único que se puede hacer
  if (mpVisible && !mpDatos) inputMp.click();
});
document.getElementById("mp-cargar").addEventListener("click", () => inputMp.click());
document.getElementById("mp-quitar").addEventListener("click", mpQuitar);
inputMp.addEventListener("change", () => {
  const f = inputMp.files?.[0];
  inputMp.value = ""; // permite volver a elegir el mismo archivo tras editarlo
  if (f) mpCargarArchivo(f);
});

// ------------------------------------------------------------ API pública
window.MisPuntos = {
  hayDatos: () => !!mpDatos,
  archivo: () => mpDatos?.archivo || null,
  puntos: () => mpDatos?.puntos || [],
  color: mpColor,
};
