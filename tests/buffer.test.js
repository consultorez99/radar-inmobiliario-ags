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
  const agebs = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "ags_agebs.geojson"), "utf8"));

  // mismo cálculo geométrico que web/buffer.js
  const LAT = 21.948892601256567, LNG = -102.29632586250825, R = 3;
  const circle = turf.circle([LNG, LAT], R, { steps: 96, units: "kilometers" });
  const bufferAreaKm2 = turf.area(circle) / 1e6;

  const rows = [];
  let agebAreaKm2 = 0;
  for (const f of agebs.features) {
    let inter = null;
    try { inter = turf.intersect(circle, f); } catch (err) { continue; }
    if (!inter) continue;
    const aIn = turf.area(inter) / 1e6;
    if (!(aIn > 0)) continue;
    const frac = Math.min(1, aIn / (turf.area(f) / 1e6));
    assert.ok(frac > 0 && frac <= 1, `fracción fuera de rango en ${f.properties.CVEGEO}`);
    rows.push({ frac, props: f.properties });
    agebAreaKm2 += aIn;
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
  const cov = BufferCore.coverageSinAgeb(agebAreaKm2, bufferAreaKm2);
  assert.ok(cov >= 0 && cov <= 100, `cobertura fuera de rango: ${cov}`);
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
