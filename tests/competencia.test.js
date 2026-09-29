/* Tests del análisis de competencia (web/competencia-core.js), con un
 * fixture sintético y una pasada contra el DENUE real del repo. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../web/competencia-core.js");

const FIXTURE = {
  actividades: ["Farmacias sin minisúper", "Farmacias con minisúper", "Cafeterías", "Sin negocios"],
  tamanos: ["0 a 5 personas", "6 a 10 personas", "11 a 30 personas", "51 a 100 personas"],
  negocios: [
    ["FARMACIA A", 0, 0, 0, 21.8800, -102.2900],
    ["FARMACIA B", 0, 0, 2, 21.8900, -102.2900],
    ["SUPERFARMA", 0, 1, 3, 21.8850, -102.2950],
    ["CAFE X", 0, 2, 1, 21.8810, -102.2910],
  ],
};

test("búsqueda de giros: sin acentos, todas las palabras, más comunes primero", () => {
  const tot = C.totalesPorGiro(FIXTURE);
  assert.deepEqual(tot, [2, 1, 1, 0]);
  const r = C.buscarGiros(FIXTURE, tot, "FARMACIA");
  assert.deepEqual(r.map((g) => g.idx), [0, 1]);
  assert.deepEqual(C.buscarGiros(FIXTURE, tot, "farmacias minisuper con").map((g) => g.idx), [1]);
  // un giro sin negocios no se ofrece
  assert.deepEqual(C.buscarGiros(FIXTURE, tot, "sin negocios"), []);
  // una sola letra no busca (evita listas enormes al primer tecleo)
  assert.deepEqual(C.buscarGiros(FIXTURE, tot, "f"), []);
});

test("negocios de varios giros a la vez", () => {
  const n = C.negociosDeGiros(FIXTURE, [0, 1]);
  assert.equal(n.length, 3);
  assert.equal(n[2].giro, "Farmacias con minisúper");
  assert.equal(n[2].tamano, "51 a 100 personas");
});

test("tamaño por personal: se lee el límite inferior, no la posición", () => {
  assert.equal(C.grupoTamano("0 a 5 personas"), "micro");
  assert.equal(C.grupoTamano("6 a 10 personas"), "micro");
  assert.equal(C.grupoTamano("11 a 30 personas"), "pequeno");
  assert.equal(C.grupoTamano("31 a 50 personas"), "pequeno");
  assert.equal(C.grupoTamano("251 y más personas"), "grande");
  assert.equal(C.grupoTamano(undefined), "sd");
});

test("resumen con centro: ordena por distancia y calcula saturación", () => {
  const comp = C.negociosDeGiros(FIXTURE, [0, 1]);
  const r = C.resumenCompetencia(comp, { pop: 30000, centro: { lat: 21.8801, lng: -102.2901 } });
  assert.equal(r.n, 3);
  assert.equal(r.masCercano.nombre, "FARMACIA A");
  assert.ok(r.masCercano.distKm < 0.02);
  assert.deepEqual(r.lista.map((c) => c.nombre), ["FARMACIA A", "SUPERFARMA", "FARMACIA B"]);
  assert.equal(r.habPorNegocio, 10000);
  assert.equal(r.por10kHab, 1);
  assert.deepEqual(r.porTamano, { micro: 1, pequeno: 1, grande: 1, sd: 0 });
});

test("resumen sin competidores ni centro: nulos, no NaN ni Infinity", () => {
  const r = C.resumenCompetencia([], { pop: 5000 });
  assert.equal(r.n, 0);
  assert.equal(r.habPorNegocio, null);
  assert.equal(r.por10kHab, 0);
  assert.equal(r.masCercano, null);
  const r2 = C.resumenCompetencia(C.negociosDeGiros(FIXTURE, [2]), {});
  assert.equal(r2.lista[0].distKm, null);
  assert.equal(r2.habPorNegocio, null);
});

test("haversine: 1 grado de latitud ≈ 111 km", () => {
  const d = C.haversineKm(21, -102, 22, -102);
  assert.ok(Math.abs(d - 111.2) < 0.5, d);
});

test("DENUE real: 'farmacia' encuentra los giros de farmacia con cientos de negocios", () => {
  const data = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "ags_denue_negocios.json"), "utf8"));
  const tot = C.totalesPorGiro(data);
  assert.equal(tot.reduce((a, b) => a + b, 0), data.meta.total);
  const giros = C.buscarGiros(data, tot, "farmacia");
  assert.ok(giros.length >= 1);
  assert.ok(giros.every((g) => C.normalizar(g.nombre).includes("farmacia")));
  assert.ok(giros[0].total > 100, `${giros[0].nombre}: ${giros[0].total}`);
  // palabras de uso común que no están en el nombre SCIAN
  assert.match(C.buscarGiros(data, tot, "gimnasio")[0].nombre, /acondicionamiento físico/);
  assert.match(C.buscarGiros(data, tot, "estética")[0].nombre, /belleza/);
  // inicio de palabra: "bar" no es "abarrotes", "reparación" no es "preparación"
  assert.ok(C.buscarGiros(data, tot, "bar").every((g) => !/abarrotes/i.test(g.nombre)));
  assert.ok(C.buscarGiros(data, tot, "reparación").every((g) => !/preparación/i.test(g.nombre)));
  // todos los rangos de tamaño del DENUE caen en un grupo conocido
  for (const t of data.tamanos) assert.notEqual(C.grupoTamano(t), "sd", t);
});

// ------------------------------------------------ mercado por competidor
test("rubro por giro: el gasto que atiende cada negocio, específico antes que general", () => {
  assert.equal(C.rubroDeGiro("Farmacias sin minisúper"), "medicamentos");
  assert.equal(C.rubroDeGiro("Comercio al por menor de gasolina y diesel"), "combustible");
  assert.equal(C.rubroDeGiro("Restaurantes con servicio de preparación de tacos y tortas"), "alimentos_fuera");
  assert.equal(C.rubroDeGiro("Comercio al por menor en tiendas de abarrotes, ultramarinos y misceláneas"), "alimentos_hogar");
  assert.equal(C.rubroDeGiro("Salones y clínicas de belleza y peluquerías"), "cuidados_personales");
  assert.equal(C.rubroDeGiro("Centros de acondicionamiento físico del sector privado"), "esparcimiento");
  assert.equal(C.rubroDeGiro("Escuelas de deporte del sector privado"), "esparcimiento");
  assert.equal(C.rubroDeGiro("Escuelas de educación primaria del sector privado"), "educacion");
  assert.equal(C.rubroDeGiro("Consultorios dentales del sector privado"), "consultas");
  assert.equal(C.rubroDeGiro("Comercio al por menor de ropa, excepto de bebé y lencería"), "vestido");
  assert.equal(C.rubroDeGiro("Comercio al por menor de calzado"), "calzado");
});

test("rubro por giro: mayoreo, industria y giros sin rubro claro no inventan mercado", () => {
  assert.equal(C.rubroDeGiro("Comercio al por mayor de abarrotes"), null);
  assert.equal(C.rubroDeGiro("Fabricación de equipo no electrónico para uso médico, dental y para laboratorio"), null);
  assert.equal(C.rubroDeGiro("Servicios veterinarios para mascotas prestados por el sector privado"), null);
  assert.equal(C.rubroDeGiro("Agencias de anuncios publicitarios"), null);
  assert.equal(C.rubroDeGiros(["Agencias de anuncios publicitarios", "Farmacias con minisúper"]), "medicamentos");
  assert.equal(C.rubroDeGiros([]), null);
});

test("mercado por competidor: reparto actual y con un competidor más", () => {
  assert.deepEqual(C.mercadoPorCompetidor(1000, 4), { porCompetidor: 250, siEntraUnoMas: 200 });
  // sin competencia: todo el mercado para el que entre, y no se divide entre cero
  assert.deepEqual(C.mercadoPorCompetidor(1000, 0), { porCompetidor: null, siEntraUnoMas: 1000 });
  assert.deepEqual(C.mercadoPorCompetidor(0, 3), { porCompetidor: null, siEntraUnoMas: null });
});

test("DENUE real: los giros más comunes de comercio y servicios al consumidor tienen rubro", () => {
  const data = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "ags_denue_negocios.json"), "utf8"));
  const gasto = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "ags_gasto_ageb.json"), "utf8"));
  const tot = C.totalesPorGiro(data);
  // todo rubro asignado existe en el archivo de gasto (una errata dejaría el bloque vacío)
  for (const nombre of data.actividades) {
    const r = C.rubroDeGiro(nombre);
    if (r) assert.ok(gasto.meta.modelos[r], `${nombre} -> ${r} no existe en ags_gasto_ageb.json`);
  }
  for (const q of ["farmacia", "abarrotes", "belleza", "cafeterias", "ropa", "papeleria"].slice(0, 5)) {
    const g = C.buscarGiros(data, tot, q)[0];
    assert.ok(C.rubroDeGiro(g.nombre), `${g.nombre} sin rubro`);
  }
});
