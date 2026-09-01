/* Tema visual compartido de las gráficas (panel lateral + PDF).
 *
 * Reglas de composición adaptadas de lieflat-charts, con una desviación
 * deliberada: esa guía es monocroma y aquí NO se puede serlo. El color de la
 * dona de NSE y del histograma catastral tiene que ser exactamente el de la
 * leyenda del mapa; si la gráfica pinta el mismo dato de otro color, el lector
 * pierde la correspondencia entre el polígono que acaba de dibujar y el
 * resumen que lee abajo. Lo que sí se adopta:
 *
 *   - el título dice la conclusión, no el tipo de gráfica
 *   - subtítulo con el encuadre: universo, unidad y periodo
 *   - línea de fuente en versalitas al pie, siempre presente
 *   - rejilla tenue, sin marcos, sin sombras, sin degradados
 *   - una jerarquía tipográfica fija, no tamaños ad hoc por gráfica
 *
 * Además resuelve el problema de nitidez del PDF: las gráficas del panel miden
 * ~300x170 px y se colocaban a 88 mm de ancho (~87 DPI) con una relación de
 * aspecto distinta a la del hueco, así que salían borrosas y estiradas.
 * RadarCharts.exportImage() las vuelve a dibujar fuera de pantalla a 300 DPI
 * con la proporción exacta del hueco de jsPDF.
 */

"use strict";

const RadarCharts = (function () {
  const T = {
    ink: "#1c2430",
    muted: "#64707c",
    grid: "rgba(28, 36, 48, 0.07)",
    panel: "#ffffff",
    borde: "#dfe3e7",
    fuente: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  };

  /* Clona la config antes de entregársela a Chart.js: la librería normaliza y
   * muta el objeto que recibe (mete _meta, escalas resueltas, etc.), así que
   * guardar la referencia original no sirve para volver a dibujar. JSON no
   * vale porque hay callbacks (ticks.callback, segment.borderDash). */
  function cloneCfg(v) {
    if (Array.isArray(v)) return v.map(cloneCfg);
    if (v && typeof v === "object" && v.constructor === Object) {
      const o = {};
      for (const k of Object.keys(v)) o[k] = cloneCfg(v[k]);
      return o;
    }
    return v;
  }

  /* ----------------------------------------------- plugin: línea de fuente */
  const pluginFuente = {
    id: "fuente",
    beforeInit(chart, args, opts) {
      if (!opts || !opts.text) return;
      const pad = chart.options.layout.padding;
      const alto = (opts.size || 8) + 8;
      if (typeof pad === "object") pad.bottom = (pad.bottom || 0) + alto;
      else chart.options.layout.padding = { top: pad, right: pad, bottom: pad + alto, left: pad };
    },
    afterDraw(chart, args, opts) {
      if (!opts || !opts.text) return;
      const ctx = chart.ctx;
      const size = opts.size || 8;
      // se alinea con el título (borde de la tarjeta), no con el área de trazo:
      // si se usara chartArea.left la fuente quedaría sangrada por el ancho de
      // las etiquetas del eje Y y desalineada respecto al encabezado
      const pad = chart.options.layout.padding;
      const x = (typeof pad === "object" ? (pad.left || 0) : pad) || 0;
      ctx.save();
      ctx.font = `600 ${size}px ${T.fuente}`;
      ctx.fillStyle = opts.color || T.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      // letterSpacing no existe en navegadores viejos; sin él solo se pierde
      // el aire entre versalitas, el texto se dibuja igual
      try { ctx.letterSpacing = "0.04em"; } catch (err) { /* noop */ }
      ctx.fillText(String(opts.text).toUpperCase(), x, chart.height - 3);
      ctx.restore();
    },
  };

  /* ------------------------------------- plugin: dato central de las donas */
  const pluginDonaCentro = {
    id: "donaCentro",
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.valor) return;
      const arcos = chart.getDatasetMeta(0).data;
      if (!arcos.length) return;
      const { x, y } = arcos[0];
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = opts.color || T.ink;
      ctx.font = `700 ${opts.size || 17}px ${T.fuente}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(opts.valor), x, y + (opts.etiqueta ? 1 : 6));
      if (opts.etiqueta) {
        ctx.font = `500 8.5px ${T.fuente}`;
        ctx.fillStyle = T.muted;
        ctx.textBaseline = "top";
        ctx.fillText(String(opts.etiqueta), x, y + 4);
      }
      ctx.restore();
    },
  };

  /* Marca el punto donde una serie deja de ser dato observado y pasa a ser
   * proyección. `indice` es la posición en el eje de categorías, no el valor
   * de la etiqueta: CategoryScale.getPixelForValue() espera el índice. */
  const pluginCorteX = {
    id: "corteX",
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts || opts.indice == null) return;
      const ex = chart.scales.x, ey = chart.scales.y;
      if (!ex || !ey) return;
      const px = ex.getPixelForValue(opts.indice);
      if (!isFinite(px)) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = opts.color || "rgba(28, 36, 48, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, ey.top);
      ctx.lineTo(px, ey.bottom);
      ctx.stroke();
      if (opts.etiqueta) {
        ctx.setLineDash([]);
        ctx.font = `600 8px ${T.fuente}`;
        ctx.fillStyle = opts.color || T.muted;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(opts.etiqueta, px + 3, ey.top + 1);
      }
      ctx.restore();
    },
  };

  /* Fondo blanco solo al exportar: en el panel el canvas transparente hereda
   * el color de la tarjeta, pero un PNG con alfa dentro del PDF depende del
   * visor. */
  const pluginFondo = {
    id: "fondoExport",
    beforeDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

  function aplicarDefaults() {
    if (typeof Chart === "undefined") return;
    Chart.register(pluginFuente, pluginDonaCentro, pluginCorteX);

    Chart.defaults.font.family = T.fuente;
    Chart.defaults.font.size = 9.5;
    Chart.defaults.color = T.muted;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.layout.padding = { top: 2, right: 4, bottom: 2, left: 2 };

    // título = conclusión, alineado a la izquierda como encabezado de tarjeta
    Object.assign(Chart.defaults.plugins.title, {
      display: true, align: "start", color: T.ink,
      font: { size: 11.5, weight: "700", family: T.fuente, lineHeight: 1.2 },
      padding: { top: 0, bottom: 2 },
    });
    Object.assign(Chart.defaults.plugins.subtitle, {
      display: true, align: "start", color: T.muted,
      font: { size: 9, weight: "500", family: T.fuente, lineHeight: 1.25 },
      padding: { top: 0, bottom: 8 },
    });
    Object.assign(Chart.defaults.plugins.legend.labels, {
      boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle",
      padding: 8, color: T.muted, font: { size: 9, family: T.fuente },
    });
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: T.panel, titleColor: T.ink, bodyColor: T.ink,
      borderColor: T.borde, borderWidth: 1, cornerRadius: 6,
      padding: 8, displayColors: true, boxPadding: 4,
      titleFont: { size: 10, weight: "600", family: T.fuente },
      bodyFont: { size: 10, family: T.fuente },
    });

    // rejilla: solo horizontales, muy tenue, sin marco ni marcas de tick
    Object.assign(Chart.defaults.scale.grid, {
      color: T.grid, drawTicks: false, tickLength: 0,
    });
    Chart.defaults.scale.border = { display: false };
    Chart.defaults.scale.ticks = Object.assign({}, Chart.defaults.scale.ticks, {
      color: T.muted, padding: 6, font: { size: 8.5, family: T.fuente },
    });
    if (Chart.defaults.scales) {
      if (Chart.defaults.scales.category) {
        Chart.defaults.scales.category.grid = { display: false, drawTicks: false };
      }
      if (Chart.defaults.scales.linear) {
        Chart.defaults.scales.linear.grid = { color: T.grid, drawTicks: false, tickLength: 0 };
      }
    }
  }

  /* Crea la gráfica y conserva una copia intacta de la config para poder
   * volver a dibujarla en alta resolución al exportar. */
  function crear(canvas, cfg) {
    const el = typeof canvas === "string" ? document.getElementById(canvas) : canvas;
    if (!el) return null;
    const pristina = cloneCfg(cfg);
    const ch = new Chart(el, cfg);
    ch.$cfg = pristina;
    return ch;
  }

  /* Redibuja la gráfica fuera de pantalla con la proporción del hueco del PDF
   * (wMm x hMm) y suficiente densidad para 300 DPI. Se mantiene un ancho
   * lógico fijo para que la tipografía pese lo mismo en todas las gráficas del
   * reporte, y la densidad se sube con devicePixelRatio en vez de agrandar el
   * lienzo (agrandarlo dejaría las letras diminutas frente a la gráfica). */
  function exportImage(chart, wMm, hMm, opts) {
    if (!chart) return null;
    if (!chart.$cfg || typeof Chart === "undefined") return chart.toBase64Image();

    const o = opts || {};
    const dpi = o.dpi || 300;
    const anchoLogico = o.anchoLogico || 620;
    const altoLogico = Math.max(80, Math.round(anchoLogico * (hMm / wMm)));
    const dpr = Math.min(4, Math.max(1, ((wMm / 25.4) * dpi) / anchoLogico));

    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none;" +
      `width:${anchoLogico}px;height:${altoLogico}px;`;
    const cv = document.createElement("canvas");
    cv.width = anchoLogico;
    cv.height = altoLogico;
    host.appendChild(cv);
    document.body.appendChild(host);

    let url = null;
    let tmp = null;
    try {
      const cfg = cloneCfg(chart.$cfg);
      cfg.options = cfg.options || {};
      cfg.options.responsive = false;
      cfg.options.maintainAspectRatio = false;
      cfg.options.animation = false;
      cfg.options.devicePixelRatio = dpr;
      cfg.plugins = (cfg.plugins || []).concat([pluginFondo]);
      tmp = new Chart(cv, cfg);
      url = tmp.toBase64Image("image/png", 1);
    } catch (err) {
      console.warn("exportImage: se usa el canvas del panel como respaldo", err);
      url = chart.toBase64Image();
    } finally {
      if (tmp) tmp.destroy();
      host.remove();
    }
    return url;
  }

  /* Coloca una gráfica en el PDF ocupando exactamente el hueco indicado. */
  function alPdf(doc, chart, xMm, yMm, wMm, hMm) {
    if (!chart) return false;
    const img = exportImage(chart, wMm, hMm);
    if (!img) return false;
    doc.addImage(img, "PNG", xMm, yMm, wMm, hMm, undefined, "FAST");
    return true;
  }

  return { T, aplicarDefaults, crear, exportImage, alPdf, cloneCfg };
})();

RadarCharts.aplicarDefaults();
