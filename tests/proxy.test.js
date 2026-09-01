/* Tests del proxy de OpenRouteService (proxy/validar.js y proxy/server.js).
 *
 * El punto de estos tests no es "el proxy responde", sino que RECHACE lo que
 * debe: un proxy que reenvía cualquier cosa no protege la clave, solo la
 * esconde detrás de un endpoint abierto nuevo. Por eso casi todo lo que se
 * prueba aquí son casos que deben fallar.
 *
 * No hay red: las rutas que se prueban del servidor son las que cortan ANTES
 * de llamar a ORS (origen, cuota, validación). Corre con `npm test`.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarCuerpo, cuerpoORS, origenPermitido, Limitador, BBOX } = require("../proxy/validar.js");

const PUNTO = { lat: 21.8853, lng: -102.2916 }; // centro de Aguascalientes
const ok = (extra = {}) => ({ ...PUNTO, minutos: [5, 10, 15], ...extra });

// ------------------------------------------------------------ validarCuerpo
test("acepta la petición que hace la app", () => {
  const r = validarCuerpo(ok());
  assert.equal(r.ok, true);
  assert.deepEqual(r.datos.minutos, [5, 10, 15]);
  assert.equal(r.datos.perfil, "foot-walking", "el perfil por defecto lo pone el servidor");
});

test("rechaza un punto fuera de Aguascalientes en vez de gastar cuota", () => {
  const cdmx = validarCuerpo(ok({ lat: 19.4326, lng: -99.1332 }));
  assert.equal(cdmx.ok, false);
  assert.equal(cdmx.status, 400);
  const madrid = validarCuerpo(ok({ lat: 40.4168, lng: -3.7038 }));
  assert.equal(madrid.ok, false);
});

test("el bbox es holgado: el área metropolitana completa entra", () => {
  // Jesús María y Pabellón de Arteaga, extremos del uso real de la app
  assert.equal(validarCuerpo(ok({ lat: 21.9611, lng: -102.3436 })).ok, true);
  assert.equal(validarCuerpo(ok({ lat: 22.1461, lng: -102.2761 })).ok, true);
});

test("no se puede pedir un perfil arbitrario (ni colarlo en la URL de ORS)", () => {
  assert.equal(validarCuerpo(ok({ perfil: "driving-car" })).ok, false);
  assert.equal(validarCuerpo(ok({ perfil: "../../matrix" })).ok, false);
  assert.equal(validarCuerpo(ok({ perfil: "foot-walking" })).ok, true);
});

test("las bandas van acotadas en número y en minutos", () => {
  assert.equal(validarCuerpo(ok({ minutos: [5, 10, 15, 20] })).ok, false, "máximo 3 bandas");
  assert.equal(validarCuerpo(ok({ minutos: [] })).ok, false, "al menos 1");
  assert.equal(validarCuerpo(ok({ minutos: [120] })).ok, false, "máximo 30 min");
  assert.equal(validarCuerpo(ok({ minutos: [0] })).ok, false);
  assert.equal(validarCuerpo(ok({ minutos: [-5] })).ok, false);
  assert.equal(validarCuerpo(ok({ minutos: [7.5] })).ok, false, "enteros");
});

test("las bandas deben ser ascendentes: la app las asume anidadas", () => {
  assert.equal(validarCuerpo(ok({ minutos: [15, 10, 5] })).ok, false);
  assert.equal(validarCuerpo(ok({ minutos: [5, 5] })).ok, false);
  assert.equal(validarCuerpo(ok({ minutos: [5, 10] })).ok, true);
});

test("rechaza basura sin reventar", () => {
  for (const malo of [null, undefined, "texto", 42, [], { lat: "21", lng: -102 },
                      { lat: NaN, lng: -102, minutos: [5] }, ok({ minutos: "5,10" })]) {
    const r = validarCuerpo(malo);
    assert.equal(r.ok, false, `debería rechazar: ${JSON.stringify(malo)}`);
    assert.equal(typeof r.error, "string");
  }
});

test("los campos extra del cliente se ignoran, no se reenvían", () => {
  const r = validarCuerpo(ok({ options: { avoid_polygons: {} }, locations: [[0, 0]] }));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.datos).sort(), ["lat", "lng", "minutos", "perfil"]);
});

// ---------------------------------------------------------------- cuerpoORS
test("el cuerpo a ORS se construye aquí: lng/lat en ese orden y segundos", () => {
  const body = cuerpoORS({ lat: 21.88, lng: -102.29, minutos: [5, 10] });
  assert.deepEqual(body, {
    locations: [[-102.29, 21.88]], // GeoJSON: lng primero
    range: [300, 600],             // minutos -> segundos
    range_type: "time",
  });
});

// ----------------------------------------------------------- origenPermitido
test("solo pasan los orígenes de la lista", () => {
  const lista = ["https://radar-inmobiliario-ags.onrender.com", "http://localhost:8000"];
  assert.equal(origenPermitido("https://radar-inmobiliario-ags.onrender.com", lista), true);
  assert.equal(origenPermitido("https://otro-sitio.com", lista), false);
  assert.equal(origenPermitido(undefined, lista), false, "sin Origin no pasa");
  assert.equal(origenPermitido("", lista), false);
  assert.equal(origenPermitido("https://radar-inmobiliario-ags.onrender.com.malo.com", lista), false,
    "no basta con que empiece igual");
});

// ------------------------------------------------------------------ cuotas
test("corta la ráfaga de una misma IP", () => {
  const l = new Limitador({ porIP: 3, global: 100 });
  const t = new Date("2026-08-24T12:00:00Z");
  for (let i = 0; i < 3; i++) assert.equal(l.permitir("1.1.1.1", t).ok, true);
  const cuarta = l.permitir("1.1.1.1", t);
  assert.equal(cuarta.ok, false);
  assert.equal(cuarta.status, 429);
  assert.equal(l.permitir("2.2.2.2", t).ok, true, "otra IP no queda castigada");
});

test("la ventana por IP se libera al pasar el minuto", () => {
  const l = new Limitador({ porIP: 2, ventanaMs: 60_000, global: 100 });
  const t0 = new Date("2026-08-24T12:00:00Z");
  l.permitir("1.1.1.1", t0); l.permitir("1.1.1.1", t0);
  assert.equal(l.permitir("1.1.1.1", t0).ok, false);
  const t1 = new Date(t0.getTime() + 61_000);
  assert.equal(l.permitir("1.1.1.1", t1).ok, true);
});

test("el tope diario global protege la cuota de ORS aunque cambien las IPs", () => {
  const l = new Limitador({ porIP: 100, global: 5 });
  const t = new Date("2026-08-24T12:00:00Z");
  for (let i = 0; i < 5; i++) assert.equal(l.permitir(`ip-${i}`, t).ok, true);
  const sexta = l.permitir("ip-nueva", t);
  assert.equal(sexta.ok, false, "cada IP traía cupo propio, pero el global ya se acabó");
  assert.equal(sexta.status, 429);
});

test("el presupuesto diario se reinicia al cambiar de día", () => {
  const l = new Limitador({ porIP: 100, global: 2 });
  const hoy = new Date("2026-08-24T23:59:00Z");
  l.permitir("1.1.1.1", hoy); l.permitir("1.1.1.1", hoy);
  assert.equal(l.permitir("1.1.1.1", hoy).ok, false);
  assert.equal(l.permitir("1.1.1.1", new Date("2026-08-25T00:01:00Z")).ok, true);
});

// ------------------------------------------------------------------ servidor
// Se levanta el servidor real en un puerto efímero. Todos estos casos cortan
// antes de llamar a ORS, así que no hay red ni se necesita clave.
async function conServidor(fn, env = {}) {
  const previo = { ...process.env };
  Object.assign(process.env, { ORIGENES_PERMITIDOS: "https://sitio-bueno.com", PORT: "0", ...env });
  delete require.cache[require.resolve("../proxy/server.js")];
  const servidor = require("../proxy/server.js");
  await new Promise((r) => (servidor.listening ? r() : servidor.once("listening", r)));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try { await fn(base); } finally {
    await new Promise((r) => servidor.close(r));
    process.env = previo;
    delete require.cache[require.resolve("../proxy/server.js")];
  }
}

test("un origen ajeno recibe 403 y nunca llega a ORS", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/isocronas`, {
      method: "POST",
      headers: { "Origin": "https://sitio-malo.com", "Content-Type": "application/json" },
      body: JSON.stringify(ok()),
    });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("access-control-allow-origin"), null, "no se refleja el origen no permitido");
  }, { ORS_API_KEY: "clave-de-prueba" });
});

test("sin cabecera Origin tampoco pasa (curl directo)", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/isocronas`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ok()),
    });
    assert.equal(r.status, 403);
  }, { ORS_API_KEY: "clave-de-prueba" });
});

test("con el origen bueno pero cuerpo inválido: 400, sin gastar cuota de ORS", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/isocronas`, {
      method: "POST",
      headers: { "Origin": "https://sitio-bueno.com", "Content-Type": "application/json" },
      body: JSON.stringify(ok({ lat: 19.4326, lng: -99.1332 })), // CDMX
    });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://sitio-bueno.com");
    assert.match((await r.json()).error, /fuera de la zona/i);
  }, { ORS_API_KEY: "clave-de-prueba" });
});

test("si falta la clave en el entorno responde 503, no 200 en blanco", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/isocronas`, {
      method: "POST",
      headers: { "Origin": "https://sitio-bueno.com", "Content-Type": "application/json" },
      body: JSON.stringify(ok()),
    });
    assert.equal(r.status, 503);
  }, { ORS_API_KEY: "" });
});

test("/salud responde sin origen y dice si hay clave configurada", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/salud`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, clave: true });
  }, { ORS_API_KEY: "clave-de-prueba" });
});

test("el preflight OPTIONS solo autoriza al origen de la lista", async () => {
  await conServidor(async (base) => {
    const bueno = await fetch(`${base}/isocronas`, { method: "OPTIONS", headers: { Origin: "https://sitio-bueno.com" } });
    assert.equal(bueno.status, 204);
    assert.equal(bueno.headers.get("access-control-allow-origin"), "https://sitio-bueno.com");
    const malo = await fetch(`${base}/isocronas`, { method: "OPTIONS", headers: { Origin: "https://sitio-malo.com" } });
    assert.equal(malo.status, 403);
  }, { ORS_API_KEY: "clave-de-prueba" });
});

test("cualquier otra ruta es 404 (no es un proxy de propósito general)", async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/v2/directions/driving-car`, {
      method: "POST", headers: { Origin: "https://sitio-bueno.com", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(r.status, 404);
  }, { ORS_API_KEY: "clave-de-prueba" });
});
