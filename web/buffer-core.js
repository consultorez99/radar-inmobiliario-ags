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

  /* Nota de metodología de los cortes de edad: el ITER urbano no trae
   * quinquenios completos (no existe ningún corte entre 25 y 29 años), así
   * que la partición estándar de reporte 0-14/15-29/30-59/60+ NO es
   * reproducible exacta con este dato. Se usa la partición más fina posible
   * sin traslapes ni huecos: 0-14 y 60+ son exactos; 15-24 sustituye a
   * "15-29" (falta el quinquenio 25-29) y 25-59 sustituye a "30-59"
   * (absorbe el 25-29 que no se pudo separar). Ver scripts/build_nse.py. */
  const CORTES_EDAD_NOTA =
    "El Censo 2020 (ITER urbano) no publica el quinquenio 25-29 por AGEB, así " +
    "que los cortes 0-14 y 60+ son exactos, pero 15-29 se reporta como 15-24 " +
    "(sin el tramo 25-29) y 30-59 se reporta como 25-59 (absorbe ese tramo). " +
    "No se inventa ninguna desagregación que el dato no soporte.";

  // Mismo orden que NSE_LABELS (main.js) — solo se necesitan las claves para
  // iterar el CSV en un orden estable; las etiquetas/colores de UI se quedan
  // en main.js, que es lo único con acceso al DOM.
  const NSE_NIVELES_ORDEN = ["A/B", "C+", "C", "C-", "D+", "D", "E", "S/D"];

  const NOTA_METODO_BUFFER =
    "Estimaciones con datos abiertos, no un avalúo ni conteo exacto. Las variables " +
    "censales se ponderan por la fracción del área de cada AGEB dentro del radio " +
    "(interpolación areal), asumiendo distribución uniforme dentro del AGEB. El NSE " +
    "es un proxy propio con Censo 2020 (INEGI), no la metodología AMAI.";

  /* Agregados demográficos por interpolación areal.
   * rows: [{ frac: fracción (0-1] del área del AGEB dentro del buffer,
   *          props: propiedades del AGEB (POBTOT, TVIVPARHAB, GRAPROES...) }]
   */
  function aggregateDemographics(rows) {
    let pop = 0, viviendas = 0;
    let popFem = 0, popMas = 0;
    let pob0a14 = 0, pob15a24 = 0, pob25a59 = 0, pob60mas = 0, popDiscapacidad = 0;
    let vivTotal = 0, vivParticulares = 0;
    const nsePop = {};
    for (const r of rows) {
      const p = (r.props.POBTOT || 0) * r.frac;
      pop += p;
      viviendas += (r.props.TVIVPARHAB || 0) * r.frac;
      const nivel = r.props.nse_nivel || "S/D";
      nsePop[nivel] = (nsePop[nivel] || 0) + p;

      popFem += (r.props.POBFEM || 0) * r.frac;
      popMas += (r.props.POBMAS || 0) * r.frac;
      pob0a14 += (r.props.pob_0_14 || 0) * r.frac;
      pob15a24 += (r.props.pob_15_24 || 0) * r.frac;
      pob25a59 += (r.props.pob_25_59 || 0) * r.frac;
      pob60mas += (r.props.pob_60_mas || 0) * r.frac;
      popDiscapacidad += (r.props.pob_discapacidad || 0) * r.frac;
      vivTotal += (r.props.VIVTOT || 0) * r.frac;
      vivParticulares += (r.props.TVIVPAR || 0) * r.frac;
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
      popFem, popMas,
      pob0a14, pob15a24, pob25a59, pob60mas, popDiscapacidad,
      vivTotal, vivParticulares,
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
      pctDeshabitadas: weightedMean(rows, "pct_deshabitadas", "TVIVPAR"),
      pctPisoFirme: weightedMean(rows, "pct_piso_firme", "TVIVPARHAB"),
      pctElectricidad: weightedMean(rows, "pct_electricidad", "TVIVPARHAB"),
      pctSanitario: weightedMean(rows, "pct_sanitario", "TVIVPARHAB"),
      pctDrenaje: weightedMean(rows, "pct_drenaje", "TVIVPARHAB"),
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

  const round0 = (n) => (n == null || !isFinite(n)) ? null : Math.round(n);
  const round1 = (n) => (n == null || !isFinite(n)) ? null : Number(n.toFixed(1));
  const round2 = (n) => (n == null || !isFinite(n)) ? null : Number(n.toFixed(2));
  const round6 = (n) => (n == null || !isFinite(n)) ? null : Number(n.toFixed(6));

  /* Objeto intermedio canónico del análisis de zona de influencia: TODOS los
   * números finales (ya redondeados) se calculan aquí UNA sola vez. El CSV
   * (buffer.js) y el JSON (buildZonaEstudioJSON, más abajo) derivan de este
   * mismo objeto para garantizar paridad de cifras por construcción — no hay
   * dos caminos de cálculo que puedan desalinearse. Ver
   * CONTRATO_ZONA_ESTUDIO.md para el esquema documentado del JSON.
   *
   * s: el objeto `stats` que devuelve analyzeBuffer() en buffer.js (lat, lng,
   * radiusKm, areaKm2, agebRows, pctSinAgeb, demo, colonias, catStats, pdu,
   * pduAreaKm2, proyectos, pois, poisDisponibles, poblacionMunicipios).
   */
  function buildZonaAgregados(s) {
    const d = s.demo;

    const nseDistribucion = {};
    for (const [nivel, pct] of Object.entries(d.nsePct)) nseDistribucion[nivel] = round1(pct);
    nseDistribucion.nivel_predominante = d.nivelPred || null;

    const pduUsos = {};
    for (const [g, v] of Object.entries(s.pdu)) {
      const programas = {};
      for (const [prog, km] of Object.entries(v.programas)) {
        programas[prog] = round1((km / s.areaKm2) * 100);
      }
      pduUsos[g] = { pct: round1((v.km2 / s.areaKm2) * 100), programas };
    }
    const sinPduPct = round1(Math.max(0, 100 - s.pduAreaKm2 / s.areaKm2 * 100));

    const colonias = s.colonias.map((c) => ({
      nombre: `${c.TIPO !== "NINGUNO" ? c.TIPO + " " : ""}${c.NOM_ASEN}`,
      municipio: c.municipio || null,
      cp: c.CP || null,
      valor_m2: c.valor_m2 ?? null,
    }));

    const proyectos = s.proyectos.map((p) => ({
      nombre: p.nombre, tipo: p.tipo, distancia_km: round2(p.distKm),
    }));

    return {
      punto: { lat: round6(s.lat), lng: round6(s.lng) },
      radioKm: s.radiusKm,
      areaBufferKm2: round2(s.areaKm2),
      agebsIntersectadas: s.agebRows.length,
      // % del área del radio SÍ cubierta por AGEB urbana 2020 (complemento de
      // pctSinAgeb, que es la métrica interna "% SIN cobertura", conservada
      // tal cual para no romper el CSV existente)
      coberturaAgebPct: s.pctSinAgeb != null ? round1(100 - s.pctSinAgeb) : null,
      pctSinAgeb: round1(s.pctSinAgeb),
      cortesEdadNota: CORTES_EDAD_NOTA,

      demografia: {
        poblacionTotal: round0(d.pop),
        poblacionFemenina: round0(d.popFem),
        poblacionMasculina: round0(d.popMas),
        gruposEdad: {
          "0_14": round0(d.pob0a14),
          "15_24": round0(d.pob15a24),
          "25_59": round0(d.pob25a59),
          "60_mas": round0(d.pob60mas),
        },
        poblacionConDiscapacidad: round0(d.popDiscapacidad),
        escolaridadPromedioAnios: round2(d.escolaridad),
        ocupantesPorCuartoPromedio: round2(d.ocupCuarto),
      },

      vivienda: {
        viviendasTotales: round0(d.vivTotal),
        viviendasParticulares: round0(d.vivParticulares),
        viviendasParticularesHabitadas: round0(d.viviendas),
        viviendasDeshabitadasPct: round1(d.pctDeshabitadas),
        pctConInternet: round1(d.pctInter),
        pctConComputadora: round1(d.pctPc),
        pctConAutomovil: round1(d.pctAuto),
        pctConServiciosCompletos: round1(d.pctServ),
        pctConPisoFirme: round1(d.pctPisoFirme),
        pctConElectricidad: round1(d.pctElectricidad),
        pctConSanitario: round1(d.pctSanitario),
        pctConDrenaje: round1(d.pctDrenaje),
        pct2masRecamaras: round1(d.pct2dorm),
        pct3masCuartos: round1(d.pct3cuart),
        ocupantes3masPorCuartoNota:
          "El ITER urbano no publica % de viviendas con 3+ ocupantes por cuarto " +
          "a nivel AGEB; se usa como proxy el promedio de ocupantes por cuarto " +
          "(ver demografia.ocupantes_por_cuarto_promedio en el JSON, u ocupantes_por_cuarto en el CSV).",
      },

      nseDistribucion,

      catastral: s.catStats ? {
        coloniasN: s.catStats.n,
        minM2: s.catStats.min,
        medianaM2: round0(s.catStats.med),
        maxM2: s.catStats.max,
        colonias,
      } : { coloniasN: 0, minM2: null, medianaM2: null, maxM2: null, colonias: [] },

      pduUsos: { ...pduUsos, sin_zonificacion_pct: sinPduPct },

      proyectos,

      poiConteos: s.poisDisponibles ? s.pois : null,

      poblacionProyeccionMunicipio: s.poblacionMunicipios,
    };
  }

  /* Construye el JSON público del contrato (ver CONTRATO_ZONA_ESTUDIO.md).
   * schema_version sube si cambia la forma del esquema (no en cada tweak de
   * redondeo/orden). Deriva de buildZonaAgregados: mismos números que el CSV.
   *
   * v2: crecimiento_poblacion_municipio (un solo % 2010→2020) se reemplaza
   * por poblacion_proyeccion_municipio (serie completa 1990-2040, CONAPO) —
   * cambio de forma, no aditivo, por eso sube la versión. */
  const ZONA_ESTUDIO_SCHEMA_VERSION = 2;

  function buildZonaEstudioJSON(s, { now } = {}) {
    const a = buildZonaAgregados(s);

    const advertencias = [];
    if (a.pctSinAgeb != null && a.pctSinAgeb > 25) {
      advertencias.push(
        `El ${a.pctSinAgeb}% del área del radio no tiene AGEB urbana 2020 ` +
        "(fraccionamientos nuevos o zona rural en ese censo): los agregados " +
        "demográficos subestiman la población y viviendas actuales.");
    }
    advertencias.push(a.cortesEdadNota);
    advertencias.push(NOTA_METODO_BUFFER);

    return {
      schema_version: ZONA_ESTUDIO_SCHEMA_VERSION,
      generado: (now instanceof Date ? now : new Date()).toISOString(),
      punto: a.punto,
      radio_km: a.radioKm,
      area_buffer_km2: a.areaBufferKm2,
      agebs_intersectadas: a.agebsIntersectadas,
      cobertura_ageb_pct: a.coberturaAgebPct,
      cortes_edad_nota: a.cortesEdadNota,
      demografia: {
        poblacion_total: a.demografia.poblacionTotal,
        poblacion_femenina: a.demografia.poblacionFemenina,
        poblacion_masculina: a.demografia.poblacionMasculina,
        grupos_edad: a.demografia.gruposEdad,
        poblacion_con_discapacidad: a.demografia.poblacionConDiscapacidad,
        escolaridad_promedio_anios: a.demografia.escolaridadPromedioAnios,
        ocupantes_por_cuarto_promedio: a.demografia.ocupantesPorCuartoPromedio,
      },
      vivienda: {
        viviendas_totales: a.vivienda.viviendasTotales,
        viviendas_particulares: a.vivienda.viviendasParticulares,
        viviendas_particulares_habitadas: a.vivienda.viviendasParticularesHabitadas,
        viviendas_deshabitadas_pct: a.vivienda.viviendasDeshabitadasPct,
        pct_con_internet: a.vivienda.pctConInternet,
        pct_con_computadora: a.vivienda.pctConComputadora,
        pct_con_automovil: a.vivienda.pctConAutomovil,
        pct_con_servicios_completos: a.vivienda.pctConServiciosCompletos,
        pct_con_piso_firme: a.vivienda.pctConPisoFirme,
        pct_con_electricidad: a.vivienda.pctConElectricidad,
        pct_con_sanitario: a.vivienda.pctConSanitario,
        pct_con_drenaje: a.vivienda.pctConDrenaje,
        pct_2mas_recamaras: a.vivienda.pct2masRecamaras,
        pct_3mas_cuartos: a.vivienda.pct3masCuartos,
        ocupantes_3mas_por_cuarto_nota: a.vivienda.ocupantes3masPorCuartoNota,
      },
      nse_distribucion: a.nseDistribucion,
      catastral: {
        colonias_n: a.catastral.coloniasN,
        min_m2: a.catastral.minM2,
        mediana_m2: a.catastral.medianaM2,
        max_m2: a.catastral.maxM2,
        colonias: a.catastral.colonias,
      },
      pdu_usos: a.pduUsos,
      proyectos: a.proyectos,
      poi_conteos: a.poiConteos,
      poblacion_proyeccion_municipio: a.poblacionProyeccionMunicipio ? {
        fuente: a.poblacionProyeccionMunicipio.fuente,
        nota: a.poblacionProyeccionMunicipio.nota,
        municipios: Object.fromEntries(
          Object.entries(a.poblacionProyeccionMunicipio.municipios).map(([mun, v]) => [mun, {
            serie: v.serie,
            anio_comparacion_fin: v.anioComparacionFin,
            cambio_2020_fin_pct: v.cambio2020FinPct,
          }])),
      } : null,
      fuentes: [
        "INEGI Censo 2020 (AGEB urbana) — demografía, vivienda, NSE",
        "CONAPO — Proyecciones de Población de los Municipios de México 1990-2040",
        "Leyes de Ingresos 2026 de Aguascalientes y Jesús María — valor catastral de suelo",
        "PDUCA 2040 ev.2 / PDU Ciudad de Jesús María 2015-2035 / PMDU Jesús María 2017-2040 — uso de suelo",
        "Estudio de mercado de terceros, corte 1T26 — proyectos de vivienda nueva",
        "OpenStreetMap contributors (ODbL) — puntos de interés",
      ],
      advertencias,
    };
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /* Filas [metrica, valor, unidad, fuente, metodo] del CSV exportable. Deriva
   * de buildZonaAgregados — MISMOS números/redondeos que buildZonaEstudioJSON
   * (ver tests/buffer.test.js, sección de paridad CSV↔JSON). `s` es el mismo
   * objeto `stats` de analyzeBuffer() en buffer.js. */
  function bufferCSVRows(s) {
    const a = buildZonaAgregados(s);
    const F_CENSO = "INEGI Censo 2020 (AGEB urbana)";
    const M_AREAL = "interpolación areal: variable ponderada por fracción de área del AGEB dentro del radio (asume distribución uniforme)";
    const M_GEO = "geometría del buffer circular";
    const rows = [["metrica", "valor", "unidad", "fuente", "metodo"]];
    const add = (m, v, u, f, met) => rows.push([m, v ?? "s/d", u, f, met]);
    const fx = (n, d) => n == null ? null : n.toFixed(d); // formatea un número YA redondeado en `a`

    // --- campos existentes: mismo nombre, mismo orden, mismo formato ---
    add("punto_lat", fx(a.punto.lat, 6), "grados", "usuario", "punto central del análisis");
    add("punto_lng", fx(a.punto.lng, 6), "grados", "usuario", "punto central del análisis");
    add("radio", a.radioKm, "km", "usuario", "radio del buffer");
    add("area_buffer", fx(a.areaBufferKm2, 2), "km²", "cálculo propio", M_GEO);
    add("agebs_intersectadas", a.agebsIntersectadas, "AGEBs", F_CENSO, "AGEBs con intersección no vacía con el buffer");
    add("pct_area_sin_ageb", fx(a.pctSinAgeb, 1), "% del área del buffer", F_CENSO,
      "área del buffer no cubierta por AGEB urbana 2020; si es alto, los agregados subestiman la zona");

    add("poblacion_estimada", a.demografia.poblacionTotal, "habitantes", F_CENSO, M_AREAL);
    add("viviendas_habitadas_estimadas", a.vivienda.viviendasParticularesHabitadas, "viviendas particulares habitadas", F_CENSO, M_AREAL);
    add("escolaridad_promedio", fx(a.demografia.escolaridadPromedioAnios, 2), "años", F_CENSO, M_AREAL + "; ponderada por población");
    add("ocupantes_por_cuarto", fx(a.demografia.ocupantesPorCuartoPromedio, 2), "ocupantes/cuarto", F_CENSO, M_AREAL + "; ponderado por viviendas");
    const pcts = [
      ["pct_viviendas_internet", a.vivienda.pctConInternet], ["pct_viviendas_computadora", a.vivienda.pctConComputadora],
      ["pct_viviendas_automovil", a.vivienda.pctConAutomovil], ["pct_viviendas_servicios_completos", a.vivienda.pctConServiciosCompletos],
      ["pct_viviendas_2mas_recamaras", a.vivienda.pct2masRecamaras], ["pct_viviendas_3mas_cuartos", a.vivienda.pct3masCuartos],
    ];
    for (const [m, v] of pcts) add(m, fx(v, 1), "% de viviendas habitadas", F_CENSO, M_AREAL + "; ponderado por viviendas");

    for (const nivel of NSE_NIVELES_ORDEN) {
      if (a.nseDistribucion[nivel] == null) continue;
      add(`nse_${nivel}_pct_poblacion`, fx(a.nseDistribucion[nivel], 1), "% de población",
        "NSE proxy propio con Censo 2020 (no AMAI)", M_AREAL);
    }

    const F_CAT = "Leyes de Ingresos 2026 (Aguascalientes y Jesús María)";
    const M_CAT = "colonias cuyo polígono intersecta el buffer (cruce nombre-polígono automático)";
    if (a.catastral.coloniasN > 0) {
      add("catastral_colonias", a.catastral.coloniasN, "colonias", F_CAT, M_CAT);
      add("catastral_min", a.catastral.minM2, "$/m² de suelo", F_CAT, M_CAT);
      add("catastral_mediana", a.catastral.medianaM2, "$/m² de suelo", F_CAT, M_CAT);
      add("catastral_max", a.catastral.maxM2, "$/m² de suelo", F_CAT, M_CAT);
    }
    for (const c of a.catastral.colonias) {
      add(`colonia: ${c.nombre} (${c.municipio})`, c.valor_m2, "$/m² de suelo", F_CAT, M_CAT);
    }

    const F_PDU = "PDUCA 2040 ev.2 / PDU Cd. Jesús María 2015-2035 / PMDU Jesús María 2017-2040";
    const pduGrupos = Object.entries(a.pduUsos).filter(([g]) => g !== "sin_zonificacion_pct")
      .sort((x, y) => y[1].pct - x[1].pct);
    for (const [g, v] of pduGrupos) {
      for (const [prog, pct] of Object.entries(v.programas)) {
        add(`uso_suelo: ${g} — ${prog}`, fx(pct, 1), "% del área del buffer",
          F_PDU, "área de intersección de la zonificación con el buffer");
      }
    }
    add("uso_suelo: sin zonificación PDU", fx(a.pduUsos.sin_zonificacion_pct, 1),
      "% del área del buffer", F_PDU, "resto del área del buffer sin polígono de PDU");

    const F_SOFTEC = "estudio de mercado de terceros, corte 1T26 (coordenada oficial por proyecto)";
    add("proyectos_vivienda_nueva", a.proyectos.length, "proyectos", F_SOFTEC, "puntos dentro del radio");
    for (const p of a.proyectos) {
      add(`proyecto: ${p.nombre} (${p.tipo})`, fx(p.distancia_km, 2), "km al punto central", F_SOFTEC,
        "distancia geodésica al punto central");
    }

    const F_POI = "OpenStreetMap contributors (ODbL)";
    for (const [cat, n] of Object.entries(s.pois)) {
      add(`poi_${cat.toLowerCase()}`, a.poiConteos ? n : null, "puntos", F_POI, "puntos dentro del radio");
    }

    const F_CONAPO_POB = "CONAPO — Proyecciones de Población de los Municipios de México 1990-2040";
    const M_POB = "reconstrucción histórica (1990-2020) y proyección oficial (2021-2040) de CONAPO; dato de contexto del municipio completo, no específico del radio";
    if (a.poblacionProyeccionMunicipio) {
      for (const [mun, v] of Object.entries(a.poblacionProyeccionMunicipio.municipios)) {
        add(`poblacion_proyeccion_cambio_2020_${v.anioComparacionFin}: ${mun}`, v.cambio2020FinPct,
          "% (municipio completo)", F_CONAPO_POB, M_POB);
        for (const [anio, pob] of Object.entries(v.serie)) {
          add(`poblacion_proyeccion: ${mun} ${anio}`, pob, "habitantes (municipio completo)", F_CONAPO_POB, M_POB);
        }
      }
    }

    // --- campos nuevos (entregable 1): se agregan AL FINAL, antes de la nota ---
    const M_AREAL_POB = M_AREAL; // misma ponderación por fracción de área, sobre población
    const M_AREAL_VIV = "interpolación areal: variable ponderada por fracción de área del AGEB dentro del radio, ponderado por viviendas (asume distribución uniforme)";

    add("poblacion_femenina", a.demografia.poblacionFemenina, "habitantes", F_CENSO, M_AREAL_POB);
    add("poblacion_masculina", a.demografia.poblacionMasculina, "habitantes", F_CENSO, M_AREAL_POB);
    add("poblacion_0_14", a.demografia.gruposEdad["0_14"], "habitantes", F_CENSO, M_AREAL_POB + `. ${a.cortesEdadNota}`);
    add("poblacion_15_24", a.demografia.gruposEdad["15_24"], "habitantes", F_CENSO,
      M_AREAL_POB + `. Sustituye al corte "15-29" del formato de reporte. ${a.cortesEdadNota}`);
    add("poblacion_25_59", a.demografia.gruposEdad["25_59"], "habitantes", F_CENSO,
      M_AREAL_POB + `. Sustituye al corte "30-59" del formato de reporte. ${a.cortesEdadNota}`);
    add("poblacion_60_mas", a.demografia.gruposEdad["60_mas"], "habitantes", F_CENSO, M_AREAL_POB);
    add("poblacion_con_discapacidad", a.demografia.poblacionConDiscapacidad, "habitantes", F_CENSO, M_AREAL_POB);

    add("viviendas_totales", a.vivienda.viviendasTotales, "viviendas (incluye colectivas)", F_CENSO, M_AREAL_POB);
    add("viviendas_particulares", a.vivienda.viviendasParticulares, "viviendas particulares", F_CENSO, M_AREAL_POB);
    add("pct_viviendas_deshabitadas", fx(a.vivienda.viviendasDeshabitadasPct, 1), "% de viviendas particulares",
      F_CENSO, "interpolación areal, ponderado por viviendas particulares totales (mismo campo que la capa Vacantes)");
    add("pct_viviendas_piso_firme", fx(a.vivienda.pctConPisoFirme, 1), "% de viviendas habitadas", F_CENSO, M_AREAL_VIV);
    add("pct_viviendas_electricidad", fx(a.vivienda.pctConElectricidad, 1), "% de viviendas habitadas", F_CENSO, M_AREAL_VIV);
    add("pct_viviendas_sanitario", fx(a.vivienda.pctConSanitario, 1), "% de viviendas habitadas", F_CENSO, M_AREAL_VIV);
    add("pct_viviendas_drenaje", fx(a.vivienda.pctConDrenaje, 1), "% de viviendas habitadas", F_CENSO, M_AREAL_VIV);
    add("viviendas_3mas_ocupantes_por_cuarto_nota", a.vivienda.ocupantes3masPorCuartoNota, "", F_CENSO, "");

    rows.push(["nota_metodologica", NOTA_METODO_BUFFER, "", "", ""]);
    return rows;
  }

  return {
    aggregateDemographics, coverageSinAgeb, catastralStats, weightedMean,
    CORTES_EDAD_NOTA, NOTA_METODO_BUFFER, NSE_NIVELES_ORDEN,
    buildZonaAgregados, buildZonaEstudioJSON, ZONA_ESTUDIO_SCHEMA_VERSION,
    csvEscape, bufferCSVRows,
  };
});
