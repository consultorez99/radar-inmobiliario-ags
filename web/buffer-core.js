/* Núcleo de cálculo del análisis de zona de influencia (buffer).
 *
 * Funciones puras, sin dependencias de Leaflet/turf/DOM, para poder probarlas
 * en Node (tests/) y usarlas en el navegador (buffer.js). En el navegador se
 * expone como window.BufferCore; en Node como module.exports.
 *
 * Método: interpolación areal simple — cada AGEB parcialmente contenida en el
 * buffer aporta sus variables ponderadas por la fracción de su área dentro
 * del círculo, ASUMIENDO DISTRIBUCIÓN UNIFORME de población/viviendas dentro
 * del AGEB. Es una estimación con datos abiertos, no un conteo exacto.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BufferCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Media ponderada de props[valueKey] con peso props[weightKey] * frac,
   * omitiendo filas sin valor o sin peso. null si no hay peso acumulado. */
  function weightedMean(rows, valueKey, weightKey) {
    let sum = 0, w = 0;
    for (const r of rows) {
      const v = r.props[valueKey];
      const base = r.props[weightKey];
      if (v == null || base == null || !(base > 0)) continue;
      const wi = base * r.frac;
      sum += v * wi;
      w += wi;
    }
    return w > 0 ? sum / w : null;
  }

  /* Agregados demográficos por interpolación areal.
   * rows: [{ frac: fracción (0-1] del área del AGEB dentro del buffer,
   *          props: propiedades del AGEB (POBTOT, TVIVPARHAB, GRAPROES...) }]
   */
  function aggregateDemographics(rows) {
    let pop = 0, viviendas = 0;
    const nsePop = {};
    for (const r of rows) {
      const p = (r.props.POBTOT || 0) * r.frac;
      pop += p;
      viviendas += (r.props.TVIVPARHAB || 0) * r.frac;
      const nivel = r.props.nse_nivel || "S/D";
      nsePop[nivel] = (nsePop[nivel] || 0) + p;
    }

    const nsePct = {};
    let nivelPred = null, best = -1;
    if (pop > 0) {
      for (const [nivel, p] of Object.entries(nsePop)) {
        nsePct[nivel] = (p / pop) * 100;
        if (p > best) { best = p; nivelPred = nivel; }
      }
    }

    return {
      pop,
      viviendas,
      // escolaridad es un promedio por persona: se pondera por población
      escolaridad: weightedMean(rows, "GRAPROES", "POBTOT"),
      // los % y promedios de vivienda se ponderan por viviendas habitadas
      ocupCuarto: weightedMean(rows, "PRO_OCUP_C", "TVIVPARHAB"),
      pctInter: weightedMean(rows, "pct_inter", "TVIVPARHAB"),
      pctPc: weightedMean(rows, "pct_pc", "TVIVPARHAB"),
      pctAuto: weightedMean(rows, "pct_auto", "TVIVPARHAB"),
      pctServ: weightedMean(rows, "pct_serv", "TVIVPARHAB"),
      pct2dorm: weightedMean(rows, "pct_2dorm", "TVIVPARHAB"),
      pct3cuart: weightedMean(rows, "pct_3cuart", "TVIVPARHAB"),
      nsePop, nsePct, nivelPred,
    };
  }

  /* % del área del buffer SIN cobertura de AGEB urbana 2020 (fraccionamientos
   * nuevos o zona rural en ese censo). Acotado a [0, 100]: pequeños traslapes
   * o el suavizado de geometrías pueden dar sumas ligeramente mayores. */
  function coverageSinAgeb(agebAreaKm2, bufferAreaKm2) {
    if (!(bufferAreaKm2 > 0)) return null;
    return Math.min(100, Math.max(0, (1 - agebAreaKm2 / bufferAreaKm2) * 100));
  }

  /* min / mediana / max / n de una lista de valores catastrales ($/m²). */
  function catastralStats(valores) {
    const v = valores.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = v.length / 2;
    const med = v.length % 2 ? v[Math.floor(mid)] : (v[mid - 1] + v[mid]) / 2;
    return { n: v.length, min: v[0], med, max: v[v.length - 1] };
  }

  return { aggregateDemographics, coverageSinAgeb, catastralStats, weightedMean };
});
