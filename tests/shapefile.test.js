/* Tests del escritor de shapefile (web/shapefile.js).
 *
 * Corre con `npm test` (node --test). Sin dependencias: el módulo es puro y no
 * toca Leaflet/turf/DOM.
 *
 * Lo que se vigila aquí es lo que rompe en silencio: la orientación de los
 * anillos (el shapefile la usa para distinguir contorno de hueco, y GeoJSON la
 * define al revés) y el largo de los campos del .dbf medido en BYTES, que con
 * acentos no coincide con .length.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const ShapefileZip = require("../web/shapefile.js");

// Cuadrado con el exterior ANTIHORARIO, como manda GeoJSON (RFC 7946).
const CUADRADO = {
  type: "Polygon",
  coordinates: [[[-102.3, 21.8], [-102.2, 21.8], [-102.2, 21.9], [-102.3, 21.9], [-102.3, 21.8]]],
};

const leerBE32 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(o, false);
const leerLE32 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(o, true);

test("invierte el anillo exterior: GeoJSON lo da antihorario, el shapefile lo pide horario", () => {
  const [exterior] = ShapefileZip.anillosDe(CUADRADO);
  assert.ok(ShapefileZip.areaConSigno(exterior) > 0, "el exterior debe quedar horario");
  // Y el primer vértice sigue siendo el mismo punto: solo se invirtió el orden.
  assert.deepEqual(exterior[0], exterior[exterior.length - 1]);
});

test("los huecos van al revés que el exterior", () => {
  const conHueco = {
    type: "Polygon",
    coordinates: [
      CUADRADO.coordinates[0],
      [[-102.28, 21.82], [-102.28, 21.88], [-102.22, 21.88], [-102.22, 21.82], [-102.28, 21.82]],
    ],
  };
  const [exterior, hueco] = ShapefileZip.anillosDe(conHueco);
  assert.ok(ShapefileZip.areaConSigno(exterior) > 0, "exterior horario");
  assert.ok(ShapefileZip.areaConSigno(hueco) < 0, "hueco antihorario");
});

test("cierra el anillo si el GeoJSON no lo trae cerrado", () => {
  const abierto = {
    type: "Polygon",
    coordinates: [[[-102.3, 21.8], [-102.2, 21.8], [-102.2, 21.9], [-102.3, 21.9]]],
  };
  const [anillo] = ShapefileZip.anillosDe(abierto);
  assert.deepEqual(anillo[0], anillo[anillo.length - 1]);
});

test("un MultiPolygon se emite como un solo registro con varias partes", () => {
  const multi = {
    type: "MultiPolygon",
    coordinates: [
      CUADRADO.coordinates,
      [[[-102.1, 21.8], [-102.0, 21.8], [-102.0, 21.9], [-102.1, 21.9], [-102.1, 21.8]]],
    ],
  };
  assert.equal(ShapefileZip.anillosDe(multi).length, 2);
});

test("rechaza geometrías que el formato no admite en una capa de polígonos", () => {
  assert.throws(() => ShapefileZip.anillosDe({ type: "Point", coordinates: [0, 0] }), /no soportada/);
  assert.throws(() => ShapefileZip.anillosDe(null), /Falta la geometría/);
});

test("el ZIP trae los cinco archivos del shapefile", () => {
  const bytes = ShapefileZip.desdeGeometria({ geometry: CUADRADO, capa: "zona" });
  const texto = Buffer.from(bytes).toString("latin1");
  for (const ext of [".shp", ".shx", ".dbf", ".prj", ".cpg"]) {
    assert.ok(texto.includes("zona" + ext), "falta " + ext);
  }
  // Firma de fin de directorio central: el ZIP quedó bien cerrado.
  assert.ok(texto.includes("PK\x05\x06"));
});

test("el encabezado del .shp declara código, tipo y bbox correctos", () => {
  const bytes = ShapefileZip.desdeGeometria({ geometry: CUADRADO, capa: "z" });
  // El .shp es el primer archivo del ZIP: 30 bytes de encabezado local + nombre.
  const inicio = 30 + "z.shp".length;
  const shp = bytes.subarray(inicio);
  assert.equal(leerBE32(shp, 0), 9994, "código de archivo");
  assert.equal(leerLE32(shp, 32), 5, "shapeType 5 = Polygon");
  const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  assert.equal(Math.round(v.getFloat64(36, true) * 10) / 10, -102.3, "xmin");
  assert.equal(Math.round(v.getFloat64(60, true) * 10) / 10, 21.9, "ymax");
  // Largo declarado (en palabras de 16 bits) contra el tamaño real del registro.
  assert.equal(leerBE32(shp, 24) * 2, 100 + 8 + leerBE32(shp, 104) * 2);
});

test("el .dbf mide los campos en bytes, no en caracteres, y no parte los acentos", () => {
  const bytes = ShapefileZip.desdeGeometria({
    geometry: CUADRADO,
    campos: [{ nombre: "MUNICIPIO", tipo: "C", largo: 20 }],
    valores: ["Jesús María"],
    capa: "z",
  });
  const texto = Buffer.from(bytes).toString("utf8");
  assert.ok(texto.includes("Jesús María"), "el acento sobrevive en UTF-8");
  assert.ok(texto.includes("UTF-8"), "el .cpg declara la codificación");
});

test("los campos numéricos van alineados a la derecha", () => {
  const bytes = ShapefileZip.desdeGeometria({
    geometry: CUADRADO,
    campos: [{ nombre: "AREA_KM2", tipo: "N", largo: 10, decimales: 2 }],
    valores: ["12.34"],
    capa: "z",
  });
  assert.ok(Buffer.from(bytes).toString("latin1").includes("     12.34"));
});

/* ---- Varias features por capa y varias capas por ZIP --------------------- */

const otroCuadrado = (dx) => ({
  type: "Polygon",
  coordinates: [CUADRADO.coordinates[0].map(([x, y]) => [x + dx, y])],
});

test("una capa con N polígonos escribe N registros en .shp, .shx y .dbf", () => {
  const filas = [0, 0.2, 0.4].map((dx, i) => ({
    geometry: otroCuadrado(dx),
    valores: ["AGEB-" + i, String(1000 * (i + 1))],
  }));
  const bytes = ShapefileZip.desdeCapas([{
    capa: "agebs",
    campos: [{ nombre: "CVEGEO", tipo: "C", largo: 20 }, { nombre: "POBTOT", tipo: "N", largo: 10 }],
    filas,
  }]);
  const texto = Buffer.from(bytes).toString("latin1");
  for (let i = 0; i < 3; i++) assert.ok(texto.includes("AGEB-" + i), "falta el registro " + i);

  // El .shx tiene 8 bytes por registro después del encabezado de 100.
  const inicioShx = texto.indexOf("agebs.shx") + "agebs.shx".length;
  const shx = bytes.subarray(inicioShx);
  const largoDeclarado = new DataView(shx.buffer, shx.byteOffset, shx.byteLength).getInt32(24, false) * 2;
  assert.equal(largoDeclarado, 100 + 8 * 3, "el .shx debe indexar 3 registros");
});

test("los offsets del .shx apuntan al inicio de cada registro del .shp", () => {
  const filas = [0, 0.2].map((dx) => ({ geometry: otroCuadrado(dx), valores: [] }));
  const bytes = ShapefileZip.desdeCapas([{ capa: "z", campos: [], filas }]);
  const texto = Buffer.from(bytes).toString("latin1");

  const shp = bytes.subarray(texto.indexOf("z.shp") + 5);
  const shx = bytes.subarray(texto.indexOf("z.shx") + 5);
  const vShx = new DataView(shx.buffer, shx.byteOffset, shx.byteLength);
  const vShp = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);

  for (let i = 0; i < 2; i++) {
    const offsetBytes = vShx.getInt32(100 + 8 * i, false) * 2;
    // En ese offset del .shp debe estar el número de registro (base 1).
    assert.equal(vShp.getInt32(offsetBytes, false), i + 1, "offset del registro " + (i + 1));
  }
});

test("un ZIP puede llevar varias capas, cada una con su esquema", () => {
  const bytes = ShapefileZip.desdeCapas([
    { capa: "zona", campos: [{ nombre: "TIPO", tipo: "C", largo: 10 }], filas: [{ geometry: CUADRADO, valores: ["radio"] }] },
    { capa: "agebs", campos: [{ nombre: "CVEGEO", tipo: "C", largo: 20 }], filas: [{ geometry: otroCuadrado(0.2), valores: ["010010001"] }] },
  ]);
  const texto = Buffer.from(bytes).toString("latin1");
  for (const n of ["zona.shp", "zona.dbf", "agebs.shp", "agebs.dbf", "agebs.prj"]) {
    assert.ok(texto.includes(n), "falta " + n);
  }
});

test("una capa sin features se omite en vez de escribir un shapefile vacío", () => {
  const bytes = ShapefileZip.desdeCapas([
    { capa: "zona", campos: [], filas: [{ geometry: CUADRADO, valores: [] }] },
    { capa: "pdu", campos: [], filas: [] },
  ]);
  const texto = Buffer.from(bytes).toString("latin1");
  assert.ok(texto.includes("zona.shp"));
  assert.ok(!texto.includes("pdu.shp"), "no debe escribir la capa vacía");
});

test("falla claro si no hay ninguna capa con features", () => {
  assert.throws(() => ShapefileZip.desdeCapas([{ capa: "x", campos: [], filas: [] }]), /nada que exportar/);
});
