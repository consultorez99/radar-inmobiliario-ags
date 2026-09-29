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
 * Mercado por competidor: si hay estimación de gasto (gasto.js), el giro se
 * asocia al rubro de gasto que atiende (farmacias -> medicamentos,
 * gasolineras -> combustible; CompetenciaCore.rubroDeGiro) y se divide el
 * gasto anual de ese rubro en el área entre los competidores. El rubro se
 * puede cambiar a mano en el bloque.
 *
 * Si el usuario cargó su propio archivo ("Mis puntos", mispuntos.js), el
 * bloque también cuenta cuántos de SUS puntos caen en cada área: sucursales
 * propias (canibalización), clientes o sitios candidatos.
 *
 * Requiere: turf (CDN), main.js (map), competencia-core.js y
 * denue_negocios.js (denueNegData, window.denueNegListo). Opcional:
 * mispuntos-core.js y mispuntos.js (window.MisPuntos).
 */

"use strict";

const COMP_MAX_GIROS = 5;
const COMP_COLOR = "#c026d3";   // magenta: no choca con NSE, POIs ni bandas
const COMP_LISTA_MAX = 8;

const compGiros = new Set();    // índices de actividad (giro SCIAN) elegidos
let compPendientes = null;      // nombres de giro del permalink, antes de que cargue el DENUE
let compCtx = null;             // { slot, tipo, centro, bandas: [{ poly, pop, label }] }
let compResultado = null;       // último cálculo (lo lee el reporte PDF)
let compPropios = null;         // lo mismo para los puntos del usuario (Mis puntos)
let compTotales = null;         // negocios por giro, para ordenar sugerencias
let compRubroManual = null;     // rubro de gasto elegido a mano (null = automático por giro)

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

// "$1.2 M" arriba de un millón, "$850,000" abajo: el mercado por
// competidor de un giro muy atomizado cabe en miles
function compDinero(x) {
  if (x == null) return "—";
  if (x >= 1e6) return `$${(x / 1e6).toLocaleString("es-MX", { maximumFractionDigits: x >= 1e8 ? 0 : 1 })} M`;
  return fmtMXN(Math.round(x / 1000) * 1000);
}

// ------------------------------------------------------------------ cálculo
function compDentro(lat, lon, poly, bbox) {
  if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) return false;
  try { return turf.booleanPointInPolygon([lon, lat], poly); } catch (e) { return false; }
}

/* Resumen por banda (la última es la exterior). De afuera hacia adentro:
 * un punto fuera de la banda exterior no puede estar en las interiores. */
function compPorBandas(candidatos, ctx) {
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
  return bandas;
}

/* Rubro de gasto contra el que se mide la competencia: el elegido a mano o
 * el que corresponde a los giros. null si no hay estimación de gasto o el
 * giro no tiene un rubro claro (y nadie eligió uno). */
function compRubro(giros) {
  const modelos = DATA.gasto?.meta?.modelos;
  if (!modelos) return null;
  const auto = CompetenciaCore.rubroDeGiros(giros);
  const clave = compRubroManual && modelos[compRubroManual] ? compRubroManual : auto;
  if (!clave || !modelos[clave]) return { clave: null, auto };
  return {
    clave, auto,
    manual: clave !== auto,
    etiqueta: modelos[clave].etiqueta,
    baja: modelos[clave].confianza === "baja",
  };
}

function compCalcular(data, ctx) {
  const giros = [...compGiros].map((i) => data.actividades[i]);
  const rubro = compRubro(giros);
  const bandas = compPorBandas(CompetenciaCore.negociosDeGiros(data, compGiros), ctx);
  if (rubro?.clave) {
    bandas.forEach((b, i) => {
      const gasto = ctx.bandas[i].gasto?.anual?.[rubro.clave] ?? null;
      b.gastoRubro = gasto;
      Object.assign(b, CompetenciaCore.mercadoPorCompetidor(gasto, b.n));
    });
  }
  return { tipo: ctx.tipo, giros, rubro, centro: ctx.centro, bandas, corte: data.meta.corte };
}

function compCalcularPropios(ctx) {
  if (!window.MisPuntos?.hayDatos()) return null;
  const bandas = compPorBandas(window.MisPuntos.puntos(), ctx);
  const ext = bandas[bandas.length - 1];
  return {
    archivo: window.MisPuntos.archivo(),
    centro: ctx.centro,
    bandas,
    porGrupo: MisPuntosCore.conteoPorGrupo(ext.lista),
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
/* Selector de rubro + mercado por competidor. Vacío si no cargó el gasto. */
function compMercadoHTML(res) {
  if (!res.rubro) return "";
  const modelos = DATA.gasto.meta.modelos;
  const autoEtq = res.rubro.auto ? modelos[res.rubro.auto]?.etiqueta : null;
  const grupo = (nivel) => Object.entries(modelos)
    .filter(([, m]) => (m.nivel || "categoria") === nivel)
    .sort((a, b) => a[1].etiqueta.localeCompare(b[1].etiqueta))
    .map(([k, m]) => `<option value="${k}" ${res.rubro.manual && k === res.rubro.clave ? "selected" : ""}>${compEsc(m.etiqueta)}</option>`)
    .join("");
  const opciones = `<optgroup label="Rubros específicos">${grupo("subcategoria")}</optgroup>
    <optgroup label="Categorías amplias">${grupo("categoria")}</optgroup>`;
  const selector = `
    <label class="comp-rubro-label">Se compara contra el gasto en
      <select class="comp-rubro" aria-label="Rubro de gasto">
        <option value="" ${res.rubro.manual ? "" : "selected"}>${autoEtq ? `${compEsc(autoEtq)} (según el giro)` : "— elige un rubro —"}</option>
        ${opciones}
      </select></label>`;

  if (!res.rubro.clave) {
    return `<div class="comp-mercado">${selector}
      <div class="iso-sub">Este giro no tiene un rubro de gasto claro de los hogares; elige uno para
        calcular el mercado por competidor.</div></div>`;
  }

  const ext = res.bandas[res.bandas.length - 1];
  const varias = res.bandas.length > 1;
  const cifras = varias
    ? `<div class="buffer-table-wrap iso-mercado-wrap"><table class="buffer-table iso-table iso-mercado">
        <tr><th>Al año</th>${res.bandas.map((b) => `<th>${compEsc(b.label)}</th>`).join("")}</tr>
        <tr><td>Gasto del rubro</td>${res.bandas.map((b) => `<td>${compDinero(b.gastoRubro)}</td>`).join("")}</tr>
        <tr><td><strong>Por competidor</strong></td>${res.bandas.map((b) => `<td><strong>${b.n ? compDinero(b.porCompetidor) : "sin comp."}</strong></td>`).join("")}</tr>
        <tr><td>Si entra uno más</td>${res.bandas.map((b) => `<td>${compDinero(b.siEntraUnoMas)}</td>`).join("")}</tr>
       </table></div>`
    : `<div class="zone-cards">
        <div class="zone-card"><div class="zc-label">Gasto del rubro</div>
          <div class="zc-value">${compDinero(ext.gastoRubro)}</div>
          <div class="zc-sub">al año en ${compEsc(ext.label)}</div></div>
        <div class="zone-card"><div class="zc-label">Por competidor</div>
          <div class="zc-value" style="color:${COMP_COLOR}">${ext.n ? compDinero(ext.porCompetidor) : "—"}</div>
          <div class="zc-sub">${ext.n ? `al año, entre ${ext.n}` : "sin competidores: mercado sin atender"}</div></div>
       </div>
       <div class="comp-linea">Si entra uno más: <strong>${compDinero(ext.siEntraUnoMas)}</strong> al año
         para cada uno, repartido parejo entre ${ext.n + 1}.</div>`;

  const baja = res.rubro.baja
    ? ` El gasto en este rubro casi no varía entre zonas en la ENIGH: aquí el mercado depende sobre todo de cuántos hogares hay, no de su nivel.`
    : "";
  return `<div class="comp-mercado">${selector}${cifras}
    <div class="iso-sub">Gasto de los hogares del área (estimación ENIGH 2024), no ventas: parte se compra
      fuera del área y otros tipos de negocio también lo capturan${res.rubro.clave === "medicamentos"
        ? " (p. ej. supermercados venden medicamentos)" : ""}.${baja}</div></div>`;
}

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

  return `${tabla}${compMercadoHTML(res)}${cercano}${tamanos}
    ${lista ? `<div class="comp-lista">${lista}${mas}</div>` : ""}
    <div class="iso-sub">DENUE ${compEsc(res.corte)} contra población del Censo 2020: la saturación es
      orientativa. Distancias en línea recta, no por calle.</div>`;
}

function compPropiosHTML(p) {
  const ext = p.bandas[p.bandas.length - 1];
  const conteo = p.bandas.length > 1
    ? p.bandas.map((b) => `${compEsc(b.label)}: <strong>${b.n}</strong>`).join(" · ")
    : `<strong>${ext.n}</strong> en ${compEsc(ext.label)}`;
  const grupos = Object.keys(p.porGrupo).length > 1 || !p.porGrupo["Sin grupo"]
    ? `<div class="comp-linea">${Object.entries(p.porGrupo)
        .map(([g, n]) => `<span class="legend-dot" style="background:${window.MisPuntos.color({ grupo: g })}"></span>${compEsc(g)} ${n}`)
        .join(" · ")}</div>`
    : "";
  const lista = ext.lista.slice(0, 5).map((c) => `
    <div class="bf-proy-row"><span class="legend-dot" style="background:${window.MisPuntos.color(c)}"></span>
      ${compEsc(c.nombre)} <span class="bf-pdu-prog">${c.distKm != null ? compKm(c.distKm) : ""}</span></div>`).join("");
  return `
    <div class="zone-list"><strong>Tus puntos</strong> <span class="bf-pdu-prog">${compEsc(p.archivo)}</span></div>
    <div class="comp-linea">${conteo}</div>
    ${ext.n ? grupos : ""}
    ${lista ? `<div class="comp-lista">${lista}${ext.n > 5 ? `<div class="bf-more">… y ${ext.n - 5} más</div>` : ""}</div>` : ""}`;
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
  compPropios = compCalcularPropios(ctx);
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
          ver el más cercano y qué tan saturada está la zona.</div>`}
    ${compPropios ? compPropiosHTML(compPropios) : ""}`;

  compConectar(ctx, data);
}

function compConectar(ctx, data) {
  ctx.slot.querySelectorAll(".comp-chip-x").forEach((btn) => {
    btn.addEventListener("click", () => {
      compGiros.delete(Number(btn.dataset.idx));
      if (!compGiros.size) compRubroManual = null;
      compRender();
      window.plActualizar?.();
    });
  });

  ctx.slot.querySelector(".comp-rubro")?.addEventListener("change", (e) => {
    compRubroManual = e.target.value || null;
    compRender();
    window.plActualizar?.();
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
    compPropios = null;
    compGroup.clearLayers();
  },
  // recalcular con el área ya montada (p. ej. al cargar o quitar Mis puntos)
  refrescar() { if (compCtx) compRender(); },
  resultado: () => compResultado,
  propios: () => compPropios,
  // para el permalink: nombres (estables entre regeneraciones del DENUE), no índices
  nombresGiros() {
    const data = compDatos();
    if (!data) return compPendientes || [];
    return [...compGiros].map((i) => data.actividades[i]);
  },
  rubroManual: () => compRubroManual,
  fijarRubro(clave) { compRubroManual = clave || null; },
  fijarGiros(nombres) {
    compGiros.clear();
    compPendientes = nombres.slice(0, COMP_MAX_GIROS);
    const data = compDatos();
    if (data) compResolverPendientes(data);
  },
};
