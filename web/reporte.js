/* Reporte PDF de la zona de estudio dibujada.
 * Usa jsPDF + html2canvas (captura del mapa) + los charts de zona.js.
 */

"use strict";

const PAGE_W = 210, MARGIN = 14, CONTENT_W = PAGE_W - 2 * MARGIN;

function pdfHeader(doc, title) {
  doc.setFillColor(58, 31, 110);
  doc.rect(0, 0, PAGE_W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Radar Inmobiliario · Aguascalientes", MARGIN, 10);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(title, MARGIN, 17);
  doc.setTextColor(40, 40, 40);
}

function pdfFooter(doc, page, pages) {
  doc.setFontSize(7.5);
  doc.setTextColor(110, 100, 130);
  doc.text(
    "Datos abiertos: INEGI (Censo 2020, Marco Geoestadístico, DCAH) · Leyes de Ingresos 2026 de Aguascalientes y Jesús María · " +
    "IMPLAN (PDUCA 2040) · Estimaciones de mercado jul-2026. NO es un avalúo oficial. Proyecto independiente sin afiliación con Tinsa/RadarMX.",
    MARGIN, 288, { maxWidth: CONTENT_W });
  doc.text(`Página ${page} de ${pages}`, PAGE_W - MARGIN, 283, { align: "right" });
  doc.setTextColor(40, 40, 40);
}

async function generarReportePDF() {
  if (!currentStats) return null;
  const btn = document.getElementById("btn-report");
  btn.disabled = true;
  btn.textContent = "Generando…";

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const s = currentStats;
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const fmt = (n, d = 0) => n == null ? "s/d" : Number(n.toFixed(d)).toLocaleString("es-MX");

    // ---------------- página 1: resumen + mapa ----------------
    pdfHeader(doc, `Reporte de zona de estudio — ${hoy}`);
    let y = 32;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Indicadores de la zona", MARGIN, y);
    y += 3;

    const cards = [
      ["Superficie", `${fmt(s.areaKm2, 1)} km²`],
      ["Población (Censo 2020)", `${fmt(s.pop)} hab · ${s.nAgebs} AGEBs`],
      ["NSE predominante", `${s.nivelPred} (índice ${s.nseScore != null ? s.nseScore.toFixed(2) : "s/d"})`],
      ["Valor catastral promedio", s.catStats ? `${fmtMXN(s.catStats.avg)}/m²` : "s/d"],
      ["Rango catastral", s.catStats ? `${fmtMXN(s.catStats.min)} – ${fmtMXN(s.catStats.max)}/m² (${s.catStats.n} colonias)` : "s/d"],
      ["Viviendas 2+ recámaras", s.pct2dorm != null ? `${s.pct2dorm.toFixed(0)}%` : "s/d"],
      ["Viviendas 3+ cuartos", s.pct3cuart != null ? `${s.pct3cuart.toFixed(0)}%` : "s/d"],
      ["Mercado (aprox.)", s.priceZones.length
        ? s.priceZones.map((z) => `${z.zona} ${fmtMXN(z.precio_m2_min)}–${fmtMXN(z.precio_m2_max)}/m²`).join(" · ")
        : "fuera de zonas de mercado"],
    ];
    doc.setFontSize(9.5);
    for (let i = 0; i < cards.length; i += 2) {
      y += 8;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(110, 100, 130);
      doc.text(cards[i][0], MARGIN, y);
      if (cards[i + 1]) doc.text(cards[i + 1][0], MARGIN + CONTENT_W / 2, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      doc.text(String(cards[i][1]), MARGIN, y + 4.5, { maxWidth: CONTENT_W / 2 - 6 });
      if (cards[i + 1]) doc.text(String(cards[i + 1][1]), MARGIN + CONTENT_W / 2, y + 4.5, { maxWidth: CONTENT_W / 2 - 6 });
      y += 6;
    }

    // uso de suelo
    const pduTotal = Object.values(s.pduShares).reduce((a, b) => a + b, 0);
    if (pduTotal > 0) {
      y += 9;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(110, 100, 130);
      doc.text("Uso de suelo (PDUCA 2040)", MARGIN, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      const pduTxt = Object.entries(s.pduShares).sort((a, b) => b[1] - a[1])
        .map(([g, km]) => `${g} ${Math.round(km / pduTotal * 100)}%`).join(" · ");
      doc.text(pduTxt, MARGIN, y + 4.5, { maxWidth: CONTENT_W });
      y += 10;
    }

    // captura del mapa
    try {
      const canvas = await html2canvas(document.getElementById("map"), {
        useCORS: true, scale: 1, logging: false,
        ignoreElements: (el) => el.classList && (
          el.classList.contains("zone-panel") || el.classList.contains("compare-panel") ||
          el.classList.contains("legend") || el.classList.contains("layer-panel") ||
          el.classList.contains("leaflet-control-container")),
      });
      const img = canvas.toDataURL("image/jpeg", 0.82);
      const h = Math.min(120, CONTENT_W * canvas.height / canvas.width);
      doc.addImage(img, "JPEG", MARGIN, y + 4, CONTENT_W, h, undefined, "FAST");
    } catch (err) {
      doc.setFontSize(9);
      doc.text("(No se pudo capturar el mapa)", MARGIN, y + 10);
    }

    // ---------------- página 2: gráficos + tabla ----------------
    doc.addPage();
    pdfHeader(doc, "Composición de la zona");
    y = 30;
    const half = (CONTENT_W - 6) / 2;
    if (zoneCharts.nse) {
      doc.addImage(zoneCharts.nse.toBase64Image(), "PNG", MARGIN, y, half, half * 0.62, undefined, "FAST");
    }
    if (zoneCharts.cat) {
      doc.addImage(zoneCharts.cat.toBase64Image(), "PNG", MARGIN + half + 6, y, half, half * 0.62, undefined, "FAST");
    }
    y += half * 0.62 + 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Colonias con valor catastral en la zona (top ${Math.min(20, s.cols.length)} de ${s.cols.length})`, MARGIN, y);
    y += 6;
    doc.setFontSize(8.5);
    doc.setFillColor(237, 228, 247);
    doc.rect(MARGIN, y - 4, CONTENT_W, 6, "F");
    doc.text("Colonia", MARGIN + 2, y);
    doc.text("Municipio", MARGIN + 95, y);
    doc.text("CP", MARGIN + 130, y);
    doc.text("Valor $/m²", MARGIN + CONTENT_W - 2, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    for (const c of s.cols.slice(0, 20)) {
      y += 5.5;
      if (y > 272) break;
      const nom = `${c.TIPO !== "NINGUNO" ? c.TIPO + " " : ""}${c.NOM_ASEN}`;
      doc.text(nom.length > 52 ? nom.slice(0, 50) + "…" : nom, MARGIN + 2, y);
      doc.text(String(c.municipio || ""), MARGIN + 95, y);
      doc.text(String(c.CP || "—"), MARGIN + 130, y);
      doc.text(fmtMXN(c.valor_m2), MARGIN + CONTENT_W - 2, y, { align: "right" });
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      pdfFooter(doc, i, pages);
    }

    doc.save(`reporte-zona-ags-${new Date().toISOString().slice(0, 10)}.pdf`);
    return doc;
  } finally {
    btn.disabled = false;
    btn.textContent = "📄 Generar reporte PDF";
  }
}

document.getElementById("btn-report").addEventListener("click", generarReportePDF);
