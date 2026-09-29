/* Competencia: negocios DENUE de los giros elegidos dentro del área que se
 * está analizando (radio, isócronas o polígono dibujado).
 *
 * No es un análisis aparte con su propio botón: es un bloque que cada panel
 * de análisis monta en su hueco `.comp-slot` con Competencia.montar(). Así el
 * mismo giro elegido (p. ej. "farmacias") se conserva al pasar de un radio a
 * una isócrona o a un polígono, y se puede comparar un sitio contra otro.
 *
 * Por cada área calcula: competidores, habitantes por negocio (saturación,
 * con la población del Censo 2020 que ya estimó el panel), el más cercano
 * al sitio y el reparto por tamaño (micro / pequeño / mediano o grande), y
 * pinta los competidores en el mapa a cualquier zoom.
 *
 * Requiere: turf (CDN), main.js (map), competencia-core.js y
 * denue_negocios.js (denueNegData, window.denueNegListo).
 */

"use strict";

const COMP_MAX_GIROS = 5;
const COMP_COLOR = "#c026d3";   // magenta: no choca con NSE, POIs ni bandas
const COMP_LISTA_MAX = 8;

const compGiros = new Set();    // índices de actividad (giro SCIAN) elegidos
let compPendientes = null;      // nombres de giro del permalink, antes de que cargue el DENUE
let compCtx = null;             // { slot, tipo, centro, bandas: [{ poly, pop, label }] }
let compResultado = null;       // último cálculo (lo lee el reporte PDF)
let compTotales = null;         // negocios por giro, para ordenar sugerencias

const compGroup = L.featureGroup().addTo(map);

const compEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const compFmt = (n, d = 0) =>
  n == null ? "—" : Number(n.toFixed(d)).toLocaleString("es-MX");
const compKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

function compDatos() {
  return typeof denueNegData !== "undefined" && denueNegData ? denueNegData : null;
}

// Los nombres que trajo el permalink se traducen a índices en cuanto hay datos.
function compResolverPendientes(data) {
  if (!compPendientes) return;
  for (const nombre of compPendientes) {
    const idx = data.actividades.indexOf(nombre);
    if (idx >= 0 && compGiros.size < COMP_MAX_GIROS) compGiros.add(idx);
  }
  compPendientes = null;
}

// ------------------------------------------------------------------ cálculo
function compDentro(lat, lon, poly, bbox) {
  if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) return false;
  try { return turf.booleanPointInPolygon([lon, lat], poly); } catch (e) { return false; }
}

/* Resumen por banda (la última es la exterior). De afuera hacia adentro:
 * un negocio fuera de la banda exterior no puede estar en las interiores. */
function compCalcular(data, ctx) {
  let candidatos = CompetenciaCore.negociosDeGiros(data, compGiros);
  const bandas = new Array(ctx.bandas.length);
  for (let i = ctx.bandas.length - 1; i >= 0; i--) {
    const b = ctx.bandas[i];
    const bbox = turf.bbox(b.poly);
    candidatos = candidatos.filter((c) => compDentro(c.lat, c.lon, b.poly, bbox));
    bandas[i] = {
      label: b.label,
      ...CompetenciaCore.resumenCompetencia(candidatos, { pop: b.pop, centro: ctx.centro }),
    };
  }
  return {
    tipo: ctx.tipo,
    giros: [...compGiros].map((i) => data.actividades[i]),
    centro: ctx.centro,
    bandas,
    corte: data.meta.corte,
  };
}

// ------------------------------------------------------------------- mapa
function compDibujar(res) {
  compGroup.clearLayers();
  if (!res) return;
  const ext = res.bandas[res.bandas.length - 1];
  for (const c of ext.lista) {
    L.circleMarker([c.lat, c.lon], {
      radius: 5.5, weight: 1.5, color: "#fff",
      fillColor: COMP_COLOR, fillOpacity: 0.95,
    })
      .bindPopup(`
        <div class="popup-title">${compEsc(c.nombre)}</div>
        <table class="popup-table">
          <tr><td>Giro</td><td>${compEsc(c.giro)}</td></tr>
          <tr><td>Tamaño</td><td>${compEsc(c.tamano)}</td></tr>
          ${c.distKm != null ? `<tr><td>Distancia</td><td><strong>${compKm(c.distKm)}</strong> en línea recta</td></tr>` : ""}
        </table>
        <div style="margin-top:5px;font-size:10.5px;color:var(--muted)">Competidor · DENUE, INEGI, corte ${compEsc(res.corte)}.</div>`,
      { maxWidth: 260 })
      .addTo(compGroup);
  }
  compGroup.bringToFront();
}

// ------------------------------------------------------------------- panel
function compResultadosHTML(res) {
  const ext = res.bandas[res.bandas.length - 1];
  const varias = res.bandas.length > 1;

  const tabla = varias
    ? `<div class="buffer-table-wrap iso-mercado-wrap"><table class="buffer-table iso-table iso-mercado">
        <tr><th></th>${res.bandas.map((b) => `<th>${compEsc(b.label)}</th>`).join("")}</tr>
        <tr><td>Competidores</td>${res.bandas.map((b) => `<td><strong>${b.n}</strong></td>`).join("")}</tr>
        <tr><td>Hab. por negocio</td>${res.bandas.map((b) => `<td>${compFmt(b.habPorNegocio)}</td>`).join("")}</tr>
       </table></div>`
    : `<div class="zone-cards">
        <div class="zone-card"><div class="zc-label">Competidores</div>
          <div class="zc-value" style="color:${COMP_COLOR}">${ext.n}</div>
          <div class="zc-sub">en ${compEsc(ext.label)}</div></div>
        <div class="zone-card"><div class="zc-label">Hab. por negocio</div>
          <div class="zc-value">${compFmt(ext.habPorNegocio)}</div>
          <div class="zc-sub">${ext.n ? "más alto = menos saturado" : "sin competencia en el área"}</div></div>
       </div>`;

  const cercano = ext.masCercano
    ? `<div class="comp-linea">Más cercano: <strong>${compEsc(ext.masCercano.nombre)}</strong>
        a ${compKm(ext.masCercano.distKm)} en línea recta</div>`
    : "";

  const t = ext.porTamano;
  const tamanos = ext.n
    ? `<div class="comp-linea">Por tamaño: micro (≤10 personas) <strong>${t.micro}</strong> ·
        pequeño (11–50) <strong>${t.pequeno}</strong> · mediano o grande (51+) <strong>${t.grande}</strong></div>`
    : "";

  const lista = ext.lista.slice(0, COMP_LISTA_MAX).map((c) => `
    <div class="bf-proy-row"><span class="legend-dot" style="background:${COMP_COLOR}"></span>
      ${compEsc(c.nombre)} <span class="bf-pdu-prog">${c.distKm != null ? compKm(c.distKm) : ""}</span></div>`).join("");
  const mas = ext.n > COMP_LISTA_MAX
    ? `<div class="bf-more">… y ${ext.n - COMP_LISTA_MAX} más (magenta en el mapa)</div>` : "";

  return `${tabla}${cercano}${tamanos}
    ${lista ? `<div class="comp-lista">${lista}${mas}</div>` : ""}
    <div class="iso-sub">DENUE ${compEsc(res.corte)} contra población del Censo 2020: la saturación es
      orientativa. Distancias en línea recta, no por calle.</div>`;
}

function compRender() {
  const ctx = compCtx;
  if (!ctx || !ctx.slot.isConnected) return;
  const data = compDatos();
  if (!data) {
    ctx.slot.innerHTML = `<div class="zone-list"><strong>Competencia (DENUE)</strong><br>Cargando el directorio de negocios…</div>`;
    window.denueNegListo?.then(() => { if (compCtx === ctx) compRender(); });
    return;
  }
  compResolverPendientes(data);
  if (!compTotales) compTotales = CompetenciaCore.totalesPorGiro(data);

  const chips = [...compGiros].map((i) => `
    <span class="comp-chip" title="${compEsc(data.actividades[i])}">
      ${compEsc(data.actividades[i])}
      <button class="comp-chip-x" data-idx="${i}" aria-label="Quitar giro">×</button>
    </span>`).join("");

  compResultado = compGiros.size ? compCalcular(data, ctx) : null;
  compDibujar(compResultado);

  ctx.slot.innerHTML = `
    <div class="zone-list"><strong>Competencia (DENUE)</strong></div>
    ${chips ? `<div class="comp-chips">${chips}</div>` : ""}
    ${compGiros.size < COMP_MAX_GIROS ? `
      <div class="comp-buscar">
        <input type="search" class="comp-input" placeholder="${compGiros.size ? "Agregar otro giro…" : "Giro: farmacia, cafetería, gimnasio…"}"
               autocomplete="off" aria-label="Buscar giro de negocio">
        <div class="comp-sugerencias hidden"></div>
      </div>` : ""}
    ${compResultado ? compResultadosHTML(compResultado)
      : `<div class="iso-sub">Elige el giro de tu negocio para contar competidores dentro del área,
          ver el más cercano y qué tan saturada está la zona.</div>`}`;

  compConectar(ctx, data);
}

function compConectar(ctx, data) {
  ctx.slot.querySelectorAll(".comp-chip-x").forEach((btn) => {
    btn.addEventListener("click", () => {
      compGiros.delete(Number(btn.dataset.idx));
      compRender();
      window.plActualizar?.();
    });
  });

  const input = ctx.slot.querySelector(".comp-input");
  const sug = ctx.slot.querySelector(".comp-sugerencias");
  if (!input) return;
  let opciones = [];

  const elegir = (idx) => {
    compGiros.add(idx);
    compRender();
    window.plActualizar?.();
    ctx.slot.querySelector(".comp-input")?.focus();
  };

  input.addEventListener("input", () => {
    opciones = CompetenciaCore.buscarGiros(data, compTotales, input.value, 8)
      .filter((g) => !compGiros.has(g.idx));
    if (!input.value.trim()) { sug.classList.add("hidden"); return; }
    sug.innerHTML = opciones.length
      ? opciones.map((g) => `
          <button class="comp-sug" data-idx="${g.idx}">
            ${compEsc(g.nombre)} <span class="bf-pdu-prog">${g.total.toLocaleString("es-MX")}</span>
          </button>`).join("")
      : `<div class="comp-sug-vacio">Sin giros con ese nombre. Prueba con otra palabra
          (el DENUE usa los nombres del SCIAN, p. ej. "abarrotes", "belleza", "consultorios").</div>`;
    sug.classList.remove("hidden");
    sug.querySelectorAll(".comp-sug").forEach((b) =>
      b.addEventListener("click", () => elegir(Number(b.dataset.idx))));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && opciones.length) { e.preventDefault(); elegir(opciones[0].idx); }
    if (e.key === "Escape") { input.value = ""; sug.classList.add("hidden"); }
  });
}

// ------------------------------------------------------------ API pública
window.Competencia = {
  /* slot: elemento .comp-slot del panel; ctx: { tipo, centro|null,
   * bandas: [{ poly (Feature Polygon/MultiPolygon), pop, label }] } con la
   * banda exterior al final. */
  montar(slot, ctx) {
    if (!slot) return;
    compCtx = { ...ctx, slot };
    compRender();
  },
  limpiar() {
    compCtx = null;
    compResultado = null;
    compGroup.clearLayers();
  },
  resultado: () => compResultado,
  // para el permalink: nombres (estables entre regeneraciones del DENUE), no índices
  nombresGiros() {
    const data = compDatos();
    if (!data) return compPendientes || [];
    return [...compGiros].map((i) => data.actividades[i]);
  },
  fijarGiros(nombres) {
    compGiros.clear();
    compPendientes = nombres.slice(0, COMP_MAX_GIROS);
    const data = compDatos();
    if (data) compResolverPendientes(data);
  },
};
