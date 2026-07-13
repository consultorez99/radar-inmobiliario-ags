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

/* Captura el mapa con html2canvas y lo inserta en el PDF. Devuelve la nueva y. */
async function capturaMapaPDF(doc, y) {
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
    doc.addImage(img, "JPEG", MARGIN, y, CONTENT_W, h, undefined, "FAST");
    return y + h;
  } catch (err) {
    doc.setFontSize(9);
    doc.text("(No se pudo capturar el mapa)", MARGIN, y + 6);
    return y + 10;
  }
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
    await capturaMapaPDF(doc, y + 4);

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
    btn.textContent = "Generar reporte PDF";
  }
}

/* ------------------------------------------------------------------------
 * Reporte PDF del análisis de zona de influencia (buffer.js).
 * Mismas advertencias metodológicas que el panel: interpolación areal,
 * NSE proxy no-AMAI y cobertura AGEB.
 */
async function generarReporteBufferPDF() {
  const s = window.getBufferStats?.();
  if (!s) return null;
  const btn = document.getElementById("btn-report");
  btn.disabled = true;
  btn.textContent = "Generando…";

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const d = s.demo;
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const fmt = (n, dec = 0) => n == null ? "s/d" : Number(n.toFixed(dec)).toLocaleString("es-MX");
    const pct = (n, dec = 1) => n == null ? "s/d" : n.toFixed(dec) + "%";
    let y = 30;

    const salto = () => { doc.addPage(); pdfHeader(doc, "Zona de influencia — continuación"); y = 30; };
    const need = (mm) => { if (y + mm > 272) salto(); };
    // párrafo con salto de línea automático; devuelve avanzada la y
    const parrafo = (txt, x, size, extra = 1) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(txt, CONTENT_W - (x - MARGIN) - 2);
      need(lines.length * (size * 0.46) + extra);
      doc.setFontSize(size); // el salto de página resetea la fuente en pdfHeader
      doc.text(lines, x, y);
      y += lines.length * (size * 0.46) + extra;
    };

    // ---------------- página 1: demográficos + mapa ----------------
    pdfHeader(doc, `Zona de influencia ${s.radiusKm} km — ${hoy}`);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Punto central: ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}   ·   Radio: ${s.radiusKm} km   ·   ` +
      `Superficie: ${fmt(s.areaKm2, 1)} km²   ·   AGEBs intersectadas: ${s.agebRows.length}`,
      MARGIN, y, { maxWidth: CONTENT_W });
    y += 8;

    if (s.pctSinAgeb != null && s.pctSinAgeb > 25) {
      doc.setFillColor(254, 243, 226);
      doc.setDrawColor(245, 201, 138);
      doc.roundedRect(MARGIN, y - 4, CONTENT_W, 13, 1.5, 1.5, "FD");
      doc.setTextColor(138, 75, 8);
      doc.setFontSize(8.5);
      doc.text(
        `ADVERTENCIA: el ${fmt(s.pctSinAgeb)}% del área del radio no tiene AGEB urbana 2020 (fraccionamientos ` +
        `nuevos o zona rural en ese censo). Los agregados demográficos SUBESTIMAN la población y viviendas actuales.`,
        MARGIN + 2, y, { maxWidth: CONTENT_W - 4 });
      doc.setTextColor(40, 40, 40);
      y += 14;
    }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Indicadores demográficos (Censo 2020, interpolación areal)", MARGIN, y);
    y += 3;

    const cards = [
      ["Población estimada", `${fmt(d.pop)} hab`],
      ["Viviendas particulares habitadas", fmt(d.viviendas)],
      ["NSE predominante (por población)", d.nivelPred || "s/d"],
      ["Área del radio sin AGEB 2020", pct(s.pctSinAgeb, 0)],
      ["Escolaridad promedio", d.escolaridad != null ? d.escolaridad.toFixed(1) + " años" : "s/d"],
      ["Ocupantes por cuarto", d.ocupCuarto != null ? d.ocupCuarto.toFixed(2) : "s/d"],
      ["Viviendas con internet", pct(d.pctInter)],
      ["Viviendas con computadora", pct(d.pctPc)],
      ["Viviendas con automóvil", pct(d.pctAuto)],
      ["Viviendas con servicios completos", pct(d.pctServ)],
      ["Viviendas con 2+ recámaras", pct(d.pct2dorm)],
      ["Viviendas con 3+ cuartos", pct(d.pct3cuart)],
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

    y += 9;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 100, 130);
    doc.text("Distribución NSE (% de población — proxy propio, no AMAI)", MARGIN, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(40, 40, 40);
    const nseTxt = Object.keys(NSE_LABELS).filter((n) => d.nsePct[n] != null)
      .map((n) => `${n} ${d.nsePct[n].toFixed(1)}%`).join("   ·   ") || "s/d";
    doc.text(nseTxt, MARGIN, y + 4.5, { maxWidth: CONTENT_W });
    y += 12;

    await capturaMapaPDF(doc, y);

    // ---------------- página 2: contexto inmobiliario ----------------
    doc.addPage();
    pdfHeader(doc, "Zona de influencia — contexto inmobiliario");
    y = 30;
    const half = (CONTENT_W - 6) / 2;
    if (zoneCharts.nse || zoneCharts.cat) {
      if (zoneCharts.nse) doc.addImage(zoneCharts.nse.toBase64Image(), "PNG", MARGIN, y, half, half * 0.62, undefined, "FAST");
      if (zoneCharts.cat) doc.addImage(zoneCharts.cat.toBase64Image(), "PNG", MARGIN + half + 6, y, half, half * 0.62, undefined, "FAST");
      y += half * 0.62 + 10;
    }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Valor catastral de suelo 2026 — ${s.colonias.length} colonias intersectan el radio`, MARGIN, y);
    y += 5;
    if (s.catStats) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Mín ${fmtMXN(s.catStats.min)}/m²  ·  Mediana ${fmtMXN(Math.round(s.catStats.med))}/m²  ·  Máx ${fmtMXN(s.catStats.max)}/m²`,
        MARGIN, y);
      y += 6;
      doc.setFontSize(8.5);
      doc.setFillColor(232, 240, 246);
      doc.rect(MARGIN, y - 4, CONTENT_W, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.text("Colonia", MARGIN + 2, y);
      doc.text("Municipio", MARGIN + 95, y);
      doc.text("CP", MARGIN + 130, y);
      doc.text("Valor $/m²", MARGIN + CONTENT_W - 2, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      const maxCols = 18;
      for (const c of s.colonias.slice(0, maxCols)) {
        y += 5.5;
        if (y > 270) break;
        const nom = `${c.TIPO !== "NINGUNO" ? c.TIPO + " " : ""}${c.NOM_ASEN}`;
        doc.text(nom.length > 52 ? nom.slice(0, 50) + "…" : nom, MARGIN + 2, y);
        doc.text(String(c.municipio || ""), MARGIN + 95, y);
        doc.text(String(c.CP || "—"), MARGIN + 130, y);
        doc.text(fmtMXN(c.valor_m2), MARGIN + CONTENT_W - 2, y, { align: "right" });
      }
      if (s.colonias.length > maxCols) {
        y += 5.5;
        doc.setTextColor(110, 100, 130);
        doc.text(`… y ${s.colonias.length - maxCols} colonias más (ver exportación CSV)`, MARGIN + 2, y);
        doc.setTextColor(40, 40, 40);
      }
    } else {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text("Sin colonias con valor catastral dentro del radio.", MARGIN + 2, y);
    }
    y += 10;

    need(24);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Uso de suelo (PDU) — % del área del radio", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const pduEntries = Object.entries(s.pdu).sort((a, b) => b[1].km2 - a[1].km2);
    if (pduEntries.length) {
      for (const [g, v] of pduEntries) {
        const progs = Object.entries(v.programas).sort((a, b) => b[1] - a[1])
          .map(([p, km]) => `${p}: ${(km / s.areaKm2 * 100).toFixed(0)}%`).join(", ");
        parrafo(`${g} — ${(v.km2 / s.areaKm2 * 100).toFixed(0)}%   (${progs})`, MARGIN + 2, 9, 1.5);
      }
      const sinPdu = Math.max(0, 100 - s.pduAreaKm2 / s.areaKm2 * 100);
      if (sinPdu >= 1) parrafo(`Sin zonificación PDU — ${sinPdu.toFixed(0)}%`, MARGIN + 2, 9, 1.5);
    } else {
      parrafo("Sin cobertura de PDU en el radio.", MARGIN + 2, 9, 1.5);
    }
    y += 6;

    need(20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Proyectos de vivienda nueva en el radio — ${s.proyectos.length} (estudio 1T26)`, MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const maxProy = 15;
    if (s.proyectos.length) {
      for (const p of s.proyectos.slice(0, maxProy)) {
        parrafo(`${p.nombre} — ${p.tipo} — ${p.distKm.toFixed(2)} km del punto`, MARGIN + 2, 9, 1.2);
      }
      if (s.proyectos.length > maxProy) {
        parrafo(`… y ${s.proyectos.length - maxProy} proyectos más (ver exportación CSV)`, MARGIN + 2, 8.5, 1.2);
      }
    } else {
      parrafo("Sin proyectos del estudio dentro del radio.", MARGIN + 2, 9, 1.2);
    }
    y += 6;

    need(14);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Puntos de interés en el radio (OpenStreetMap)", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    parrafo(
      s.poisDisponibles
        ? Object.entries(s.pois).map(([cat, n]) => `${cat}: ${n}`).join("   ·   ")
        : "POIs no disponibles al generar el reporte.",
      MARGIN + 2, 9, 1.5);
    y += 6;

    need(34);
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.text("Metodología y advertencias", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 100, 130);
    const avisos = [
      "Interpolación areal: cada AGEB parcialmente contenida en el radio aporta sus variables censales ponderadas por la fracción de su área dentro del círculo, asumiendo distribución uniforme de población y viviendas dentro del AGEB.",
      "NSE: proxy propio calculado con variables del Censo 2020 (INEGI). NO es la metodología oficial de AMAI y puede diferir del NSE real.",
      `Cobertura: el ${pct(s.pctSinAgeb, 0)} del área del radio no tiene AGEB urbana 2020 (fraccionamientos posteriores al censo o zona rural); en esa superficie no hay dato demográfico y los agregados subestiman la zona.`,
      "Valores catastrales: oficiales (Leyes de Ingresos 2026), pero el cruce nombre-polígono es automático y el valor catastral suele ser menor al precio de mercado. Verificar en la ley antes de un trámite.",
      "Estimaciones con datos abiertos y un estudio de mercado de terceros (1T26). Este reporte NO es un avalúo.",
    ];
    for (const a of avisos) parrafo("· " + a, MARGIN, 8, 1.6);
    doc.setTextColor(40, 40, 40);

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      pdfFooter(doc, i, pages);
    }

    doc.save(`reporte-zona-influencia-${s.radiusKm}km-${new Date().toISOString().slice(0, 10)}.pdf`);
    return doc;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generar reporte PDF";
  }
}

document.getElementById("btn-report").addEventListener("click", () => {
  if (window.getBufferStats?.()) generarReporteBufferPDF();
  else generarReportePDF();
});
