/* Tests del análisis de zona de influencia (web/buffer-core.js).
 *
 * Corre con `npm test` (node --test). @turf/turf es devDependency SOLO para
 * estos tests: es la misma versión 6.5.0 que el navegador carga del CDN, y
 * permite probar en Node la misma geometría (intersección buffer × AGEB)
 * contra los datos reales de data/ags_agebs.geojson.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const turf = require("@turf/turf");
const BufferCore = require("../web/buffer-core.js");

const LISBOA = { lat: 21.948892601256567, lng: -102.29632586250825, radiusKm: 3 };

/* Reconstruye agebRows/pctSinAgeb reales para el caso Lisboa Residence,
 * mismo cálculo geométrico que web/buffer.js (intersección círculo×AGEB con
 * turf, fracción de área). Reutilizado por varios tests. */
function buildLisboaAgebRows() {
  const agebs = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "ags_agebs.geojson"), "utf8"));
  const circle = turf.circle([LISBOA.lng, LISBOA.lat], LISBOA.radiusKm, { steps: 96, units: "kilometers" });
  const bufferAreaKm2 = turf.area(circle) / 1e6;

  const agebRows = [];
  let agebAreaKm2 = 0;
  for (const f of agebs.features) {
    let inter = null;
    try { inter = turf.intersect(circle, f); } catch (err) { continue; }
    if (!inter) continue;
    const aIn = turf.area(inter) / 1e6;
    if (!(aIn > 0)) continue;
    const frac = Math.min(1, aIn / (turf.area(f) / 1e6));
    agebRows.push({ frac, props: f.properties, feature: f });
    agebAreaKm2 += aIn;
  }
  const pctSinAgeb = BufferCore.coverageSinAgeb(agebAreaKm2, bufferAreaKm2);
  return { agebRows, bufferAreaKm2, agebAreaKm2, pctSinAgeb };
}

/* Objeto `stats` completo (como el que arma analyzeBuffer() en buffer.js)
 * para el caso Lisboa Residence, con AGEBs reales y catastral/PDU/proyectos
 * sintéticos pero con la misma forma que produce el código real — suficiente
 * para probar el esquema JSON y la paridad CSV↔JSON sin reimplementar en el
 * test la intersección de las 4 capas completas. */
function buildLisboaStats() {
  const { agebRows, bufferAreaKm2, pctSinAgeb } = buildLisboaAgebRows();
  const demo = BufferCore.aggregateDemographics(agebRows);
  // Proyección de población CONAPO 1990-2040 — fixture sintético con la
  // misma forma que resolvePoblacionMunicipios() en web/main.js, con
  // valores reales tomados de data/ags_poblacion_proyeccion.json.
  const poblacionMunicipios = {
    fuente: "CONAPO — Conciliación demográfica 1950-2019 y Proyecciones de la Población de México y las Entidades Federativas 2020-2070 (corte municipal, grupos grandes de edad)",
    nota: "1990-2020: reconstrucción demográfica histórica. 2021-2040: proyección oficial CONAPO. Nivel municipio completo (no por AGEB ni zona).",
    municipios: {
      Aguascalientes: {
        serie: { "1990": 499839, "2000": 660045, "2010": 814163, "2020": 968960, "2030": 1083798, "2040": 1164986 },
        anioComparacionFin: 2040,
        cambio2020FinPct: 20.2,
      },
      "Jesús María": {
        serie: { "1990": 43145, "2000": 66443, "2010": 101839, "2020": 132642, "2030": 149350, "2040": 161381 },
        anioComparacionFin: 2040,
        cambio2020FinPct: 21.7,
      },
    },
  };
  return {
    lat: LISBOA.lat, lng: LISBOA.lng, radiusKm: LISBOA.radiusKm,
    areaKm2: bufferAreaKm2, agebRows, pctSinAgeb, demo, poblacionMunicipios,
    colonias: [
      { TIPO: "FRACCIONAMIENTO", NOM_ASEN: "PASEOS DE AGUASCALIENTES", municipio: "Aguascalientes", CP: "20916", valor_m2: 5200 },
      { TIPO: "FRACCIONAMIENTO", NOM_ASEN: "VIÑEDOS", municipio: "Jesús María", CP: "20915", valor_m2: 4100 },
    ],
    catStats: { n: 2, min: 4100, med: 4650, max: 5200 },
    pdu: {
      Habitacional: { km2: 10.5, programas: { "PDUCA 2040 ev.2": 8.2, "PM Jesús María 2017-2040 (municipal)": 2.3 } },
      "Crecimiento futuro": { km2: 7.1, programas: { "PDUCA 2040 ev.2": 7.1 } },
    },
    pduAreaKm2: 17.6,
    proyectos: [
      { nombre: "Vivanta Residencial", tipo: "horizontal", distKm: 1.18 },
      { nombre: "Torre Sentzia", tipo: "vertical", distKm: 1.39 },
    ],
    pois: { Educación: 30, Salud: 17, Abasto: 29, Bancos: 8, Parques: 28, Gasolineras: 21 },
    poisDisponibles: true,
  };
}

// ---------------------------------------------------- 1. ponderación areal
test("interpolación areal: AGEB 50% dentro aporta 50% de su población y viviendas", () => {
  const rows = [{
    frac: 0.5,
    props: { POBTOT: 1000, TVIVPARHAB: 400, GRAPROES: 12, nse_nivel: "C+" },
  }];
  const d = BufferCore.aggregateDemographics(rows);
  assert.equal(d.pop, 500);
  assert.equal(d.viviendas, 200);
  // la fracción escala el peso pero no el valor promedio: escolaridad intacta
  assert.equal(d.escolaridad, 12);
  assert.equal(d.nivelPred, "C+");
  assert.equal(d.nsePct["C+"], 100);
});

test("interpolación areal: porcentajes ponderados por viviendas × fracción", () => {
  const rows = [
    // peso = 100 viviendas × 1.0 = 100
    { frac: 1.0, props: { POBTOT: 300, TVIVPARHAB: 100, pct_inter: 100, nse_nivel: "A/B" } },
    // peso = 200 viviendas × 0.5 = 100
    { frac: 0.5, props: { POBTOT: 8000, TVIVPARHAB: 200, pct_inter: 40, nse_nivel: "D" } },
  ];
  const d = BufferCore.aggregateDemographics(rows);
  // pesos iguales -> promedio simple de 100 y 40
  assert.equal(d.pctInter, 70);
  // población: 300×1 + 8000×0.5 = 4300; NSE por población
  assert.equal(d.pop, 4300);
  assert.equal(d.nivelPred, "D");
  assert.ok(Math.abs(d.nsePct["A/B"] - (300 / 4300) * 100) < 1e-9);
  assert.ok(Math.abs(d.nsePct["D"] - (4000 / 4300) * 100) < 1e-9);
});

test("interpolación areal: variables nulas no envenenan el agregado", () => {
  const rows = [
    { frac: 1.0, props: { POBTOT: 1000, TVIVPARHAB: 300, GRAPROES: 10, pct_inter: 80, nse_nivel: "C" } },
    { frac: 1.0, props: { POBTOT: null, TVIVPARHAB: null, GRAPROES: null, pct_inter: null, nse_nivel: "S/D" } },
  ];
  const d = BufferCore.aggregateDemographics(rows);
  assert.equal(d.pop, 1000);
  assert.equal(d.escolaridad, 10);
  assert.equal(d.pctInter, 80);
});

test("interpolación areal: AGEB 50% dentro aporta 50% de su población femenina/masculina/edad/discapacidad", () => {
  const rows = [{
    frac: 0.5,
    props: {
      POBTOT: 1000, POBFEM: 520, POBMAS: 480,
      pob_0_14: 200, pob_15_24: 150, pob_25_59: 500, pob_60_mas: 150,
      pob_discapacidad: 80,
      VIVTOT: 400, TVIVPAR: 380, TVIVPARHAB: 340,
      pct_deshabitadas: 10, pct_piso_firme: 95, pct_electricidad: 98,
      pct_sanitario: 96, pct_drenaje: 94,
      nse_nivel: "C",
    },
  }];
  const d = BufferCore.aggregateDemographics(rows);
  assert.equal(d.popFem, 260, "50% de 520 mujeres");
  assert.equal(d.popMas, 240, "50% de 480 hombres");
  assert.equal(d.pob0a14, 100, "50% de 200 en 0-14");
  assert.equal(d.pob15a24, 75, "50% de 150 en 15-24");
  assert.equal(d.pob25a59, 250, "50% de 500 en 25-59");
  assert.equal(d.pob60mas, 75, "50% de 150 en 60+");
  assert.equal(d.popDiscapacidad, 40, "50% de 80 con discapacidad");
  assert.equal(d.vivTotal, 200, "50% de 400 viviendas totales");
  assert.equal(d.vivParticulares, 190, "50% de 380 viviendas particulares");
  // los % (piso/electricidad/sanitario/drenaje/deshabitadas) son promedios
  // ponderados, no cuentas — la fracción no los divide a la mitad, solo
  // escala el PESO de este único AGEB (que sigue siendo el único dato, así
  // que el promedio ponderado da el mismo % que trae el AGEB)
  assert.equal(d.pctPisoFirme, 95);
  assert.equal(d.pctElectricidad, 98);
  assert.equal(d.pctSanitario, 96);
  assert.equal(d.pctDrenaje, 94);
  assert.equal(d.pctDeshabitadas, 10);
});

test("interpolación areal: variables nuevas nulas no envenenan el agregado (AGEB con confidencialidad censal)", () => {
  const rows = [
    { frac: 1.0, props: {
      POBTOT: 1000, POBFEM: 520, POBMAS: 480,
      pob_0_14: 200, pob_15_24: 150, pob_25_59: 500, pob_60_mas: 150,
      pob_discapacidad: 80, VIVTOT: 400, TVIVPAR: 380, TVIVPARHAB: 340,
      pct_piso_firme: 95, nse_nivel: "C",
    }},
    // AGEB pequeña con edad/discapacidad suprimidas por INEGI (como las 6
    // reales que aparecen en data/ags_agebs.geojson) — no debe romper ni
    // restar de más al agregado
    { frac: 1.0, props: {
      POBTOT: 19, POBFEM: 10, POBMAS: 9,
      pob_0_14: 4, pob_15_24: null, pob_25_59: null, pob_60_mas: null,
      pob_discapacidad: null, VIVTOT: 8, TVIVPAR: 8, TVIVPARHAB: 7,
      pct_piso_firme: null, nse_nivel: "E",
    }},
  ];
  const d = BufferCore.aggregateDemographics(rows);
  assert.equal(d.popFem, 530);
  assert.equal(d.popMas, 489);
  assert.equal(d.pob0a14, 204);
  // los campos null del segundo AGEB no se cuentan (tratados como 0), no
  // tiran el agregado a null ni lo dejan en NaN
  assert.equal(d.pob15a24, 150);
  assert.equal(d.popDiscapacidad, 80);
  // pctPisoFirme: weightedMean salta la fila con valor null, así que el
  // resultado es el promedio ponderado SOLO del primer AGEB
  assert.equal(d.pctPisoFirme, 95);
});

// ------------------------------------------------- 2. cobertura sin AGEB
test("cobertura: área AGEB de la mitad del buffer da 50% sin cobertura", () => {
  const bufferArea = Math.PI * 3 * 3; // círculo de 3 km
  const cov = BufferCore.coverageSinAgeb(bufferArea / 2, bufferArea);
  assert.ok(Math.abs(cov - 50) < 1e-9);
});

test("cobertura: acotada a [0, 100] y null sin área de buffer", () => {
  assert.equal(BufferCore.coverageSinAgeb(28.27, 28.27), 0);
  assert.equal(BufferCore.coverageSinAgeb(30, 28.27), 0);    // traslapes leves no dan negativo
  assert.equal(BufferCore.coverageSinAgeb(0, 28.27), 100);
  assert.equal(BufferCore.coverageSinAgeb(10, 0), null);
});

// ---------------------------------------------------- 3. límite municipal
test("buffer de 3 km en Lisboa Residence agrega AGEBs de ambos municipios sin duplicar", () => {
  const { agebRows: rows, bufferAreaKm2, agebAreaKm2, pctSinAgeb } = buildLisboaAgebRows();
  for (const r of rows) {
    assert.ok(r.frac > 0 && r.frac <= 1, `fracción fuera de rango en ${r.props.CVEGEO}`);
  }

  // cruza el límite: hay AGEBs de los dos municipios
  const municipios = new Set(rows.map((r) => r.props.municipio));
  assert.ok(municipios.has("Aguascalientes"), "faltan AGEBs de Aguascalientes");
  assert.ok(municipios.has("Jesús María"), "faltan AGEBs de Jesús María");

  // sin duplicados (cada AGEB entra una sola vez)
  const cvegeos = rows.map((r) => r.props.CVEGEO);
  assert.equal(new Set(cvegeos).size, cvegeos.length, "hay AGEBs duplicadas");

  // la ponderación areal reduce el agregado respecto a contar AGEBs completas
  const d = BufferCore.aggregateDemographics(rows);
  const popCompleta = rows.reduce((s, r) => s + (r.props.POBTOT || 0), 0);
  assert.ok(d.pop > 0, "población estimada debe ser positiva");
  assert.ok(d.pop < popCompleta, "la interpolación areal debe pesar menos que las AGEBs completas");

  // cobertura válida y coherente con la zona (corredor norte: hay huecos sin AGEB)
  assert.ok(pctSinAgeb >= 0 && pctSinAgeb <= 100, `cobertura fuera de rango: ${pctSinAgeb}`);
  void bufferAreaKm2; void agebAreaKm2; // ya usados dentro del helper
});

// ------------------------------------------------------------ 4. catastral
test("catastral: min/mediana/max con n impar y par", () => {
  assert.deepEqual(BufferCore.catastralStats([3000, 1000, 2000]),
    { n: 3, min: 1000, med: 2000, max: 3000 });
  assert.deepEqual(BufferCore.catastralStats([4000, 1000, 2000, 3000]),
    { n: 4, min: 1000, med: 2500, max: 4000 });
  assert.equal(BufferCore.catastralStats([]), null);
  assert.deepEqual(BufferCore.catastralStats([5000, null]),
    { n: 1, min: 5000, med: 5000, max: 5000 });
});

// -------------------------------------------------- 5. esquema JSON estable
test("JSON del contrato: forma estable (schema_version=2, claves de cada sección)", () => {
  const stats = buildLisboaStats();
  const j = BufferCore.buildZonaEstudioJSON(stats, { now: new Date("2026-07-14T12:00:00Z") });

  assert.equal(j.schema_version, BufferCore.ZONA_ESTUDIO_SCHEMA_VERSION);
  assert.equal(j.schema_version, 2, "si esto falla intencionalmente, hay que subir ZONA_ESTUDIO_SCHEMA_VERSION y documentarlo en CONTRATO_ZONA_ESTUDIO.md");

  assert.deepEqual(Object.keys(j).sort(), [
    "advertencias", "agebs_intersectadas", "area_buffer_km2", "catastral",
    "cobertura_ageb_pct", "cortes_edad_nota", "poblacion_proyeccion_municipio",
    "demografia", "fuentes", "generado", "nse_distribucion", "pdu_usos",
    "poi_conteos", "proyectos", "punto", "radio_km", "schema_version", "vivienda",
  ].sort());

  assert.deepEqual(Object.keys(j.poblacion_proyeccion_municipio).sort(),
    ["fuente", "municipios", "nota"].sort());
  for (const [mun, v] of Object.entries(j.poblacion_proyeccion_municipio.municipios)) {
    assert.deepEqual(Object.keys(v).sort(), ["anio_comparacion_fin", "cambio_2020_fin_pct", "serie"].sort(),
      `forma inesperada para ${mun}`);
    assert.equal(typeof v.serie, "object");
    assert.equal(typeof v.cambio_2020_fin_pct, "number");
  }

  assert.deepEqual(Object.keys(j.punto).sort(), ["lat", "lng"]);

  assert.deepEqual(Object.keys(j.demografia).sort(), [
    "escolaridad_promedio_anios", "grupos_edad", "ocupantes_por_cuarto_promedio",
    "poblacion_con_discapacidad", "poblacion_femenina", "poblacion_masculina",
    "poblacion_total",
  ].sort());
  assert.deepEqual(Object.keys(j.demografia.grupos_edad).sort(), ["0_14", "15_24", "25_59", "60_mas"]);

  assert.deepEqual(Object.keys(j.vivienda).sort(), [
    "ocupantes_3mas_por_cuarto_nota", "pct_2mas_recamaras", "pct_3mas_cuartos",
    "pct_con_automovil", "pct_con_computadora", "pct_con_drenaje",
    "pct_con_electricidad", "pct_con_internet", "pct_con_piso_firme",
    "pct_con_sanitario", "pct_con_servicios_completos", "viviendas_deshabitadas_pct",
    "viviendas_particulares", "viviendas_particulares_habitadas", "viviendas_totales",
  ].sort());

  assert.deepEqual(Object.keys(j.catastral).sort(),
    ["colonias", "colonias_n", "max_m2", "mediana_m2", "min_m2"].sort());
  assert.ok(Array.isArray(j.catastral.colonias));
  if (j.catastral.colonias.length) {
    assert.deepEqual(Object.keys(j.catastral.colonias[0]).sort(),
      ["cp", "municipio", "nombre", "valor_m2"].sort());
  }

  assert.ok(Array.isArray(j.proyectos));
  if (j.proyectos.length) {
    assert.deepEqual(Object.keys(j.proyectos[0]).sort(), ["distancia_km", "nombre", "tipo"].sort());
  }

  // pdu_usos: claves dinámicas (dependen de qué zonificación toca el radio),
  // pero cada grupo (salvo el sentinel) debe tener la forma {pct, programas}
  for (const [k, v] of Object.entries(j.pdu_usos)) {
    if (k === "sin_zonificacion_pct") { assert.equal(typeof v, "number"); continue; }
    assert.deepEqual(Object.keys(v).sort(), ["pct", "programas"]);
    assert.equal(typeof v.pct, "number");
    assert.equal(typeof v.programas, "object");
  }

  // nse_distribucion: claves dinámicas + nivel_predominante siempre presente
  assert.ok("nivel_predominante" in j.nse_distribucion);

  assert.ok(Array.isArray(j.fuentes) && j.fuentes.length > 0);
  assert.ok(j.fuentes.every((f) => typeof f === "string"));
  assert.ok(Array.isArray(j.advertencias));
  assert.ok(j.advertencias.every((a) => typeof a === "string"));

  assert.equal(typeof j.generado, "string");
  assert.ok(!isNaN(Date.parse(j.generado)), "generado debe ser ISO8601 parseable");
});

// ------------------------------------------------- 6. paridad CSV <-> JSON
test("paridad CSV↔JSON: mismos números, mismos redondeos (caso Lisboa Residence)", () => {
  const stats = buildLisboaStats();
  const rows = BufferCore.bufferCSVRows(stats);
  const j = BufferCore.buildZonaEstudioJSON(stats);

  const csvByName = {};
  for (const [metrica, valor] of rows.slice(1)) csvByName[metrica] = valor; // slice(1): salta el header

  // compara un valor de CSV (string de punto fijo o "s/d") contra el valor
  // numérico correspondiente del JSON — deben representar el MISMO número
  const parEq = (csvMetrica, jsonValor, msg) => {
    const csvValor = csvByName[csvMetrica];
    assert.notEqual(csvValor, undefined, `falta la fila '${csvMetrica}' en el CSV`);
    if (jsonValor == null) { assert.equal(csvValor, "s/d", msg); return; }
    assert.ok(
      Math.abs(parseFloat(csvValor) - jsonValor) < 1e-9,
      `${msg}: CSV=${csvValor} vs JSON=${jsonValor}`);
  };

  parEq("poblacion_estimada", j.demografia.poblacion_total, "población total");
  parEq("viviendas_habitadas_estimadas", j.vivienda.viviendas_particulares_habitadas, "viviendas habitadas");
  parEq("escolaridad_promedio", j.demografia.escolaridad_promedio_anios, "escolaridad");
  parEq("ocupantes_por_cuarto", j.demografia.ocupantes_por_cuarto_promedio, "ocupantes por cuarto");
  parEq("pct_viviendas_internet", j.vivienda.pct_con_internet, "% internet");
  parEq("pct_viviendas_computadora", j.vivienda.pct_con_computadora, "% computadora");
  parEq("pct_viviendas_automovil", j.vivienda.pct_con_automovil, "% automóvil");
  parEq("pct_viviendas_servicios_completos", j.vivienda.pct_con_servicios_completos, "% servicios");
  parEq("pct_viviendas_2mas_recamaras", j.vivienda.pct_2mas_recamaras, "% 2+ recámaras");
  parEq("pct_viviendas_3mas_cuartos", j.vivienda.pct_3mas_cuartos, "% 3+ cuartos");

  // --- entregable 1: variables censales nuevas ---
  parEq("poblacion_femenina", j.demografia.poblacion_femenina, "población femenina");
  parEq("poblacion_masculina", j.demografia.poblacion_masculina, "población masculina");
  parEq("poblacion_0_14", j.demografia.grupos_edad["0_14"], "población 0-14");
  parEq("poblacion_15_24", j.demografia.grupos_edad["15_24"], "población 15-24");
  parEq("poblacion_25_59", j.demografia.grupos_edad["25_59"], "población 25-59");
  parEq("poblacion_60_mas", j.demografia.grupos_edad["60_mas"], "población 60+");
  parEq("poblacion_con_discapacidad", j.demografia.poblacion_con_discapacidad, "población con discapacidad");
  parEq("viviendas_totales", j.vivienda.viviendas_totales, "viviendas totales");
  parEq("viviendas_particulares", j.vivienda.viviendas_particulares, "viviendas particulares");
  parEq("pct_viviendas_deshabitadas", j.vivienda.viviendas_deshabitadas_pct, "% deshabitadas");
  parEq("pct_viviendas_piso_firme", j.vivienda.pct_con_piso_firme, "% piso firme");
  parEq("pct_viviendas_electricidad", j.vivienda.pct_con_electricidad, "% electricidad");
  parEq("pct_viviendas_sanitario", j.vivienda.pct_con_sanitario, "% sanitario");
  parEq("pct_viviendas_drenaje", j.vivienda.pct_con_drenaje, "% drenaje");

  // catastral (sin per-colonia, solo el resumen — las filas por colonia usan
  // otro formato de nombre de métrica, ya cubierto por catastral_n>0 arriba)
  parEq("catastral_min", j.catastral.min_m2, "catastral mínimo");
  parEq("catastral_mediana", j.catastral.mediana_m2, "catastral mediana");
  parEq("catastral_max", j.catastral.max_m2, "catastral máximo");
  assert.equal(csvByName["catastral_colonias"], j.catastral.colonias_n);

  // NSE por nivel
  for (const nivel of BufferCore.NSE_NIVELES_ORDEN) {
    if (j.nse_distribucion[nivel] == null) continue;
    parEq(`nse_${nivel}_pct_poblacion`, j.nse_distribucion[nivel], `NSE ${nivel}`);
  }

  // proyección de población por municipio: cambio resumen + cada año de la serie
  for (const [m, v] of Object.entries(j.poblacion_proyeccion_municipio.municipios)) {
    assert.equal(
      Number(csvByName[`poblacion_proyeccion_cambio_2020_${v.anio_comparacion_fin}: ${m}`]),
      v.cambio_2020_fin_pct, `cambio poblacional ${m}`);
    for (const [anio, pob] of Object.entries(v.serie)) {
      assert.equal(Number(csvByName[`poblacion_proyeccion: ${m} ${anio}`]), pob, `población ${m} ${anio}`);
    }
  }

  // proyectos: cuenta y distancia de cada uno
  assert.equal(Number(csvByName["proyectos_vivienda_nueva"]), j.proyectos.length);
  for (const p of j.proyectos) {
    parEq(`proyecto: ${p.nombre} (${p.tipo})`, p.distancia_km, `distancia de ${p.nombre}`);
  }
});
