/* Tests de "Mis puntos" (web/mispuntos-core.js): lectura del archivo del
 * usuario y lo que se descarta, con archivos como los que exporta Excel. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../web/mispuntos-core.js");

test("CSV de Excel en español: BOM, punto y coma, coma decimal, acentos en encabezados", () => {
  const csv = "﻿Nombre;Latitud;Longitud;Tipo\r\n" +
    "Sucursal Centro;21,8823;-102,2916;Propia\r\n" +
    "Sucursal Norte;21,9489;-102,2963;Franquicia\r\n";
  const { encabezados, filas } = M.parseCSV(csv);
  assert.deepEqual(encabezados, ["Nombre", "Latitud", "Longitud", "Tipo"]);
  const r = M.aPuntos(encabezados, filas);
  assert.equal(r.puntos.length, 2);
  assert.equal(r.puntos[0].lat, 21.8823);
  assert.equal(r.puntos[0].lon, -102.2916);
  assert.equal(r.puntos[0].nombre, "Sucursal Centro");
  assert.equal(r.puntos[1].grupo, "Franquicia");
  assert.deepEqual(M.conteoPorGrupo(r.puntos), { Propia: 1, Franquicia: 1 });
});

test("comillas: separador y saltos de línea dentro de un campo", () => {
  const csv = 'name,lat,lng,notas\n"Tienda, Plaza Patria",21.88,-102.29,"dos\nrenglones"\n';
  const { encabezados, filas } = M.parseCSV(csv);
  const r = M.aPuntos(encabezados, filas);
  assert.equal(r.puntos.length, 1);
  assert.equal(r.puntos[0].nombre, "Tienda, Plaza Patria");
  assert.equal(r.puntos[0].props.notas, "dos\nrenglones");
});

test("lat/lng invertidas se corrigen y se cuentan; basura se descarta con motivo y renglón", () => {
  const csv = "id,lat,lon\n" +
    "a,-102.29,21.88\n" +   // invertida
    "b,,\n" +               // vacía
    "c,0,0\n" +             // fuera de México
    "d,2438000,1000000\n" + // proyectada en metros
    "e,21.9,-102.3\n";
  const { encabezados, filas } = M.parseCSV(csv);
  const r = M.aPuntos(encabezados, filas);
  assert.equal(r.invertidas, 1);
  assert.deepEqual(r.puntos.map((p) => p.nombre), ["a", "e"]);
  assert.equal(r.puntos[0].lat, 21.88);
  assert.deepEqual(r.descartados.map((d) => d.fila), [3, 4, 5]);
  assert.match(r.descartados[0].motivo, /vacías/);
});

test("sin columnas de coordenadas: error claro, ningún punto inventado", () => {
  const { encabezados, filas } = M.parseCSV("nombre,direccion\nA,Av. Madero 100\n");
  const r = M.aPuntos(encabezados, filas);
  assert.equal(r.puntos.length, 0);
  assert.match(r.error, /lat/);
});

test("detección de columnas: exactas primero, luego por prefijo; X/Y también valen", () => {
  assert.deepEqual(M.detectarColumnas(["X", "Y", "Sucursal"]), { lat: 1, lon: 0, nombre: 2, grupo: -1 });
  assert.equal(M.detectarColumnas(["latitud_gps", "longitud_gps"]).lat, 0);
  assert.equal(M.detectarColumnas(["latitud_gps", "longitud_gps"]).lon, 1);
});

test("números: coma decimal sí, separador de miles o texto no", () => {
  assert.equal(M.aNumero("21,5"), 21.5);
  assert.equal(M.aNumero(" -102.3 "), -102.3);
  assert.ok(Number.isNaN(M.aNumero("21°52'")));
  assert.ok(Number.isNaN(M.aNumero("1,234.5")));
  assert.equal(M.aNumero(21.5), 21.5);
});

test("GeoJSON: solo puntos, propiedades conservadas", () => {
  const r = M.desdeGeoJSON({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [-102.29, 21.88] }, properties: { nombre: "A", marca: "X" } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} },
    ],
  });
  assert.equal(r.puntos.length, 1);
  assert.equal(r.puntos[0].grupo, "X");
  assert.match(r.descartados[0].motivo, /Polygon/);
});
