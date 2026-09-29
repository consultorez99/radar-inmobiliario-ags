/* Bloque "Mercado potencial" de los paneles de análisis (radio, isócronas y
 * polígono): cuánto gastan al año los hogares del área, en total y por
 * categoría (alimentos, ropa, salud…), en pesos de 2024.
 *
 * El cálculo vive en buffer-core.js (mercadoPotencial, puro y probado); los
 * gastos por AGEB los genera scripts/build_gasto.py y main.js los fusiona en
 * las propiedades de cada AGEB. Aquí solo se presenta.
 *
 * Requiere: main.js (DATA.gasto), buffer-core.js.
 */

"use strict";

// "$1,234 M" / "$12.3 M" / "$2.1 mil M": millones de pesos al año
function gastoFmtM(x) {
  if (x == null) return "—";
  if (x >= 1e9) return `$${(x / 1e9).toLocaleString("es-MX", { maximumFractionDigits: 1 })} mil M`;
  return `$${(x / 1e6).toLocaleString("es-MX", { maximumFractionDigits: x >= 1e8 ? 0 : 1 })} M`;
}

window.GastoUI = {
  disponible: () => !!DATA.gasto,

  hogaresPorVivienda: () => DATA.gasto?.meta?.hogares_por_vivienda || 1,

  /* Categorías en orden de peso (sin "total"), con su etiqueta y si el
   * modelo es de confianza baja (apenas distingue zonas). */
  categorias() {
    const mod = DATA.gasto?.meta?.modelos || {};
    return Object.entries(mod).filter(([k]) => k !== "total")
      .sort((a, b) => b[1].promedio_enigh_trim - a[1].promedio_enigh_trim)
      .map(([k, m]) => ({ clave: k, etiqueta: m.etiqueta, baja: m.confianza === "baja" }));
  },

  /* rows: agebRows del área ({frac, props}); devuelve el resumen de
   * BufferCore.mercadoPotencial o null si el gasto no cargó. */
  calcular(rows) {
    if (!DATA.gasto) return null;
    return BufferCore.mercadoPotencial(rows, this.hogaresPorVivienda());
  },

  /* bandas: [{ label, mp }] con la exterior al final (una sola para radio y
   * polígono). */
  html(bandas) {
    if (!DATA.gasto || !bandas.length || !bandas[0].mp) return "";
    const ext = bandas[bandas.length - 1].mp;
    if (!ext.hogares) return "";
    const cats = this.categorias();
    const marca = (c) => (c.baja ? ` <span class="bf-pdu-prog" title="El modelo apenas distingue una zona de otra en esta categoría">(orientativo)</span>` : "");

    let cuerpo;
    if (bandas.length === 1) {
      const filas = cats.map((c) => `
        <tr><td>${c.etiqueta}${marca(c)}</td>
          <td>${gastoFmtM(ext.anual[c.clave])}</td>
          <td>${ext.anual.total ? Math.round((ext.anual[c.clave] / ext.anual.total) * 100) + "%" : ""}</td></tr>`).join("");
      cuerpo = `
        <div class="zone-cards">
          <div class="zone-card"><div class="zc-label">Mercado potencial</div>
            <div class="zc-value">${gastoFmtM(ext.anual.total)}</div>
            <div class="zc-sub">al año · ${Math.round(ext.hogares).toLocaleString("es-MX")} hogares</div></div>
          <div class="zone-card"><div class="zc-label">Gasto por hogar</div>
            <div class="zc-value">${fmtMXN(Math.round(ext.gastoAnualPorHogar / 12))}</div>
            <div class="zc-sub">al mes, promedio del área</div></div>
        </div>
        <div class="buffer-table-wrap iso-mercado-wrap"><table class="buffer-table iso-table iso-mercado gasto-tabla">
          <tr><th>Categoría</th><th>Al año</th><th>%</th></tr>${filas}
        </table></div>`;
    } else {
      // tres columnas de "$14.2 mil M" no caben en el panel: cifras en
      // millones sin adornos y la unidad una sola vez en el encabezado
      const mill = (x) => (x == null ? "—" : Math.round(x / 1e6).toLocaleString("es-MX"));
      const col = (fn) => bandas.map((b) => `<td>${fn(b.mp)}</td>`).join("");
      const filas = cats.map((c) => `
        <tr><td>${c.etiqueta}${marca(c)}</td>${col((mp) => mill(mp.anual[c.clave]))}</tr>`).join("");
      cuerpo = `
        <div class="buffer-table-wrap iso-mercado-wrap"><table class="buffer-table iso-table iso-mercado gasto-tabla">
          <tr><th>Millones de pesos al año</th>${bandas.map((b) => `<th>${b.label}</th>`).join("")}</tr>
          <tr><td><strong>Total</strong></td>${col((mp) => `<strong>${mill(mp.anual.total)}</strong>`)}</tr>
          ${filas}
          <tr><td>Por hogar al mes</td>${col((mp) => fmtMXN(Math.round((mp.gastoAnualPorHogar || 0) / 12)))}</tr>
        </table></div>`;
    }

    const cobertura = ext.coberturaPct != null && ext.coberturaPct < 95
      ? ` ${Math.round(100 - ext.coberturaPct)}% de las viviendas del área está en AGEBs sin estimación (datos confidenciales del Censo) y no se cuenta.`
      : "";
    return `
      <div class="zone-list"><strong>Mercado potencial</strong> <span class="bf-pdu-prog">gasto de los hogares, pesos de 2024</span></div>
      ${cuerpo}
      <div class="iso-sub">Estimación propia: modelo con la ENIGH 2024 aplicado a las viviendas del
        Censo 2020 (interpolación areal). Dimensiona el mercado y compara zonas; no es venta
        esperada, y en zonas A/B probablemente se subestima.${cobertura}</div>`;
  },
};
