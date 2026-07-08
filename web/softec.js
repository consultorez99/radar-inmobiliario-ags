/* Panel "Vivienda nueva" con datos del estudio de mercado DIME de Softec
 * (Aguascalientes, Año 37, No. 4392, Febrero 2026 — corte 1T26).
 *
 * Estudio de mercado ADQUIRIDO por el despacho, no es dato abierto. Aquí solo
 * se transcriben las cifras agregadas (precio, absorción, inventario) —no el
 * documento ni su texto— para uso de consulta interna en este mapa.
 *
 * Cobertura del estudio: municipios de Aguascalientes, Rincón de Romos,
 * Jesús María, Pabellón de Arteaga y San Francisco de los Romo (la "plaza"
 * DIME). Los datos de precio/absorción son agregados de TODA la plaza por
 * segmento y tipo de producto — Softec no desglosa estas cifras por zona
 * geográfica en este reporte (esa vista existe como reporte especializado
 * aparte, no incluido aquí). Por eso esta información se presenta como panel
 * de consulta, no como capa geográfica.
 */

"use strict";

const SOFTEC_FUENTE = "Estudio de mercado de terceros, corte 1T26";

const SOFTEC_RESUMEN = {
  periodo: "1T26", anterior: "4T25",
  proyectos: [72, 83], unidades: [15017, 15761], inventario: [5374, 7242],
  vendidas: [9643, 8519], absorcionProm: [3.3, 2.8], mesesVenta: [30.0, 28.2],
  mesesInventario: [29.2, 33.6], exitoComercial: [2.3, 2.3],
};

// Precio y absorción por segmento — Vivienda Horizontal, 1T26 (fuente: p.12)
const SOFTEC_HORIZONTAL = [
  { seg: "S", nombre: "Social", proyectos: 2, unidades: 5800, precioM2Min: 14916, precioM2Prom: 16210, precioM2Max: 17504, absorcion: 26.6, exito: 0.9, mesesInv: 26 },
  { seg: "E", nombre: "Económica", proyectos: 2, unidades: 200, precioM2Min: 15792, precioM2Prom: 16420, precioM2Max: 17048, absorcion: 6.7, exito: 6.7, mesesInv: 2 },
  { seg: "M", nombre: "Media", proyectos: 20, unidades: 5050, precioM2Min: 12854, precioM2Prom: 19611, precioM2Max: 27112, absorcion: 5.1, exito: 2.3, mesesInv: 25 },
  { seg: "R", nombre: "Residencial", proyectos: 20, unidades: 2794, precioM2Min: 16025, precioM2Prom: 20903, precioM2Max: 27970, absorcion: 2.1, exito: 2.0, mesesInv: 32 },
  { seg: "RP", nombre: "Residencial Plus", proyectos: 1, unidades: 20, precioM2Min: 22192, precioM2Prom: 22192, precioM2Max: 22192, absorcion: 0.7, exito: 3.3, mesesInv: 9 },
];

// Precio y absorción por segmento — Vivienda Vertical (departamentos), 1T26
const SOFTEC_VERTICAL = [
  { seg: "E", nombre: "Económica", proyectos: 1, unidades: 90, precioM2Min: 17673, precioM2Prom: 17673, precioM2Max: 17673, absorcion: 6.7, exito: 7.5, mesesInv: 1 },
  { seg: "M", nombre: "Media", proyectos: 6, unidades: 326, precioM2Min: 26823, precioM2Prom: 29698, precioM2Max: 33571, absorcion: 1.0, exito: 2.3, mesesInv: 50 },
  { seg: "R", nombre: "Residencial", proyectos: 20, unidades: 737, precioM2Min: 32928, precioM2Prom: 41328, precioM2Max: 54743, absorcion: 0.7, exito: 2.2, mesesInv: 30 },
];

// Proyectos y unidades vigentes por municipio, 1T26 (horizontal + vertical)
// Verificado: suma de municipios coincide exacto con los totales de plaza
// (13,864 unidades horizontal; 1,153 unidades vertical; 45 y 27 proyectos).
const SOFTEC_MUNICIPIOS = [
  { nombre: "Aguascalientes", proyectosH: 28, unidadesH: 9339, proyectosV: 21, unidadesV: 788 },
  { nombre: "Jesús María", proyectosH: 13, unidadesH: 3334, proyectosV: 6, unidadesV: 365 },
  { nombre: "San Francisco de los Romo", proyectosH: 4, unidadesH: 1191, proyectosV: 0, unidadesV: 0 },
];

function fmtNum(n) { return Number(n).toLocaleString("es-MX"); }

function softecFilaHTML(r) {
  return `<tr>
    <td>${r.nombre}</td>
    <td>${r.proyectos}</td>
    <td>${fmtNum(r.unidades)}</td>
    <td>${fmtMXN(r.precioM2Min)} – ${fmtMXN(r.precioM2Max)}</td>
    <td><strong>${fmtMXN(r.precioM2Prom)}</strong></td>
    <td>${r.absorcion.toFixed(1)}</td>
    <td>${r.exito.toFixed(1)}%</td>
    <td>${r.mesesInv}</td>
  </tr>`;
}

function buildSoftecPanel() {
  const el = document.getElementById("softec-content");
  const r = SOFTEC_RESUMEN;
  const chip = (curr, prev, suffix = "", digits = 1) => {
    const c = Number(curr).toFixed(digits), p = Number(prev).toFixed(digits);
    const arrow = c === p ? { s: "→", col: "#9ca3af" } : c > p ? { s: "▲", col: "#1a9850" } : { s: "▼", col: "#d73027" };
    return `${c}${suffix} <span style="color:${arrow.col}">${arrow.s}</span>`;
  };

  el.innerHTML = `
    <p class="softec-cobertura">Cobertura: municipios de Aguascalientes, Rincón de Romos, Jesús María,
      Pabellón de Arteaga y San Francisco de los Romo ("la plaza"). Vivienda nueva terminada en venta.</p>

    <h3>Resumen de la plaza — ${r.periodo} (vs. ${r.anterior})</h3>
    <div class="softec-cards">
      <div class="softec-card"><span>Proyectos vigentes</span><strong>${chip(r.proyectos[0], r.proyectos[1], "", 0)}</strong></div>
      <div class="softec-card"><span>Unidades en mercado</span><strong>${chip(r.unidades[0], r.unidades[1], "", 0)}</strong></div>
      <div class="softec-card"><span>Inventario disponible</span><strong>${chip(r.inventario[0], r.inventario[1], "", 0)}</strong></div>
      <div class="softec-card"><span>Absorción prom. (u/mes/proy.)</span><strong>${chip(r.absorcionProm[0], r.absorcionProm[1])}</strong></div>
      <div class="softec-card"><span>Meses de inventario</span><strong>${chip(r.mesesInventario[0], r.mesesInventario[1])}</strong></div>
      <div class="softec-card"><span>Éxito comercial</span><strong>${chip(r.exitoComercial[0], r.exitoComercial[1], "%")}</strong></div>
    </div>

    <h3>Vivienda Horizontal (casas) por segmento — ${r.periodo}</h3>
    <div class="softec-table-wrap"><table class="softec-table">
      <tr><th>Segmento</th><th>Proyectos</th><th>Unidades</th><th>Rango $/m²</th><th>Prom. $/m²</th>
        <th>Absorción<br>(u/mes)</th><th>Éxito<br>comercial</th><th>Meses<br>inventario</th></tr>
      ${SOFTEC_HORIZONTAL.map(softecFilaHTML).join("")}
    </table></div>

    <h3>Vivienda Vertical (departamentos) por segmento — ${r.periodo}</h3>
    <div class="softec-table-wrap"><table class="softec-table">
      <tr><th>Segmento</th><th>Proyectos</th><th>Unidades</th><th>Rango $/m²</th><th>Prom. $/m²</th>
        <th>Absorción<br>(u/mes)</th><th>Éxito<br>comercial</th><th>Meses<br>inventario</th></tr>
      ${SOFTEC_VERTICAL.map(softecFilaHTML).join("")}
    </table></div>

    <h3>Proyectos vigentes por municipio — ${r.periodo}</h3>
    <div class="softec-table-wrap"><table class="softec-table">
      <tr><th>Municipio</th><th>Proyectos H</th><th>Unidades H</th><th>Proyectos V</th><th>Unidades V</th></tr>
      ${SOFTEC_MUNICIPIOS.map((m) => `<tr>
        <td>${m.nombre}</td><td>${m.proyectosH}</td><td>${fmtNum(m.unidadesH)}</td>
        <td>${m.proyectosV}</td><td>${fmtNum(m.unidadesV)}</td>
      </tr>`).join("")}
    </table></div>

    <p class="softec-fuente">Fuente: ${SOFTEC_FUENTE}. Estudio de mercado adquirido por el despacho —
      cifras agregadas de toda la plaza, no desglosadas por zona geográfica dentro de este reporte.
      "Absorción" = unidades vendidas por proyecto al mes (promedio). "Éxito comercial" = % de unidades
      vendidas del total mensual. Para trámites o decisiones de inversión, consultar el estudio completo.</p>`;
}

const softecModal = document.getElementById("softec-modal");
document.getElementById("softec-btn").addEventListener("click", () => {
  buildSoftecPanel();
  softecModal.classList.remove("hidden");
});
document.getElementById("softec-close").addEventListener("click", () => softecModal.classList.add("hidden"));
softecModal.addEventListener("click", (e) => { if (e.target === softecModal) softecModal.classList.add("hidden"); });
