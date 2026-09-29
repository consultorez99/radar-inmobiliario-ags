/* Proxy de OpenRouteService para el modo "A pie" de las isócronas.
 *
 * Existe por una sola razón: la clave de ORS no se puede restringir por
 * dominio, así que no puede vivir en el navegador (web/config.js es público).
 * Aquí la clave está en la variable de entorno ORS_API_KEY y nunca sale del
 * servidor: el navegador le pide isócronas a este servicio y este las pide a
 * ORS. Toda la política de qué se acepta está en validar.js.
 *
 * Sin dependencias (http y fetch nativos de Node): menos superficie que
 * auditar y arranque más rápido, que en el plan gratuito de Render importa
 * porque el servicio se duerme tras ~15 min sin tráfico.
 *
 * Endpoints:
 *   GET  /salud      -> 200 {ok:true}. Sirve para despertar el servicio: la
 *                       app lo llama al abrir el panel de isócronas para que
 *                       el arranque en frío ocurra mientras el usuario elige
 *                       el punto, no cuando ya pidió el análisis.
 *   POST /isocronas  -> {lat, lng, minutos:[..]} -> GeoJSON de ORS.
 */

"use strict";

const http = require("node:http");
const { validarCuerpo, cuerpoORS, origenPermitido, Limitador } = require("./validar.js");

/* PORT vacío -> 8787. Se distingue "no definido" de "0" a propósito: 0 es
 * puerto efímero (lo usan los tests) y con `Number(x) || 8787` se perdía. */
const PUERTO = process.env.PORT ? Number(process.env.PORT) : 8787;
const CLAVE = process.env.ORS_API_KEY || "";

/* Orígenes con permiso, separados por coma. En Render se configura
 * ORIGENES_PERMITIDOS con la URL del sitio; en local vale el default. */
const ORIGENES = (process.env.ORIGENES_PERMITIDOS ||
  "http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

const limitador = new Limitador({
  porIP: Number(process.env.LIMITE_POR_IP) || 10,
  global: Number(process.env.LIMITE_DIARIO) || 300,
});

const MAX_CUERPO = 4 * 1024; // el cuerpo legítimo son ~100 bytes

/* Nota: se drena la petición (req.resume()) antes de contestar. Sin esto, al
 * cortar un POST temprano —origen no permitido, cuota, ruta desconocida— el
 * cuerpo que el cliente sigue enviando se queda sin leer y Node cierra el
 * socket: el navegador vería un error de red en vez del 403/404 con su
 * mensaje. Lo detectó tests/proxy.test.js ("cualquier otra ruta es 404"). */
function responder(req, res, status, obj, origen) {
  req.resume();
  const cuerpo = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  // Solo se refleja un origen ya validado; nunca "*" ni lo que venga en el header.
  if (origen) {
    headers["Access-Control-Allow-Origin"] = origen;
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = "";
    req.on("data", (c) => {
      datos += c;
      if (datos.length > MAX_CUERPO) { reject(new Error("cuerpo demasiado grande")); req.destroy(); }
    });
    req.on("end", () => resolve(datos));
    req.on("error", reject);
  });
}

/* IP del visitante. Render va detrás de proxy, así que la real viene en
 * X-Forwarded-For (primer elemento de la cadena). */
function ipDe(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "desconocida";
}

const servidor = http.createServer(async (req, res) => {
  const origen = req.headers.origin;
  const permitido = origenPermitido(origen, ORIGENES) ? origen : null;
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    if (!permitido) return responder(req, res, 403, { error: "Origen no permitido." });
    req.resume();
    res.writeHead(204, {
      "Access-Control-Allow-Origin": permitido,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    });
    return res.end();
  }

  // Sin CORS: es para el health check de Render y para el ping de despertar.
  if (req.method === "GET" && url.pathname === "/salud") {
    return responder(req, res, 200, { ok: true, clave: Boolean(CLAVE) }, permitido);
  }

  if (req.method !== "POST" || url.pathname !== "/isocronas") {
    return responder(req, res, 404, { error: "No encontrado." }, permitido);
  }
  if (!permitido) {
    return responder(req, res, 403, { error: "Origen no permitido." });
  }
  if (!CLAVE) {
    console.error("Falta ORS_API_KEY en el entorno.");
    return responder(req, res, 503, { error: "El servicio de isócronas a pie no está configurado." }, permitido);
  }

  const cupo = limitador.permitir(ipDe(req));
  if (!cupo.ok) return responder(req, res, cupo.status, { error: cupo.error }, permitido);

  let cuerpo;
  try {
    cuerpo = JSON.parse(await leerCuerpo(req) || "null");
  } catch (err) {
    return responder(req, res, 400, { error: "JSON inválido." }, permitido);
  }

  const v = validarCuerpo(cuerpo);
  if (!v.ok) return responder(req, res, v.status, { error: v.error }, permitido);

  try {
    const r = await fetch(`https://api.openrouteservice.org/v2/isochrones/${v.datos.perfil}`, {
      method: "POST",
      headers: { "Authorization": CLAVE, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoORS(v.datos)),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    if (!r.ok) {
      // El detalle de ORS se registra pero NO se le devuelve al navegador:
      // sus mensajes de error pueden incluir la clave.
      console.error(`ORS respondió ${r.status}: ${texto.slice(0, 500)}`);
      const msg = r.status === 429
        ? "Se alcanzó el límite de isócronas de OpenRouteService. Intenta más tarde."
        : "OpenRouteService no pudo calcular las isócronas para este punto.";
      return responder(req, res, r.status === 429 ? 429 : 502, { error: msg }, permitido);
    }
    req.resume();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": permitido,
      "Vary": "Origin",
      "Cache-Control": "no-store",
    });
    res.end(texto);
  } catch (err) {
    console.error("Error hablando con ORS:", err.message);
    responder(req, res, 504, { error: "No hubo respuesta de OpenRouteService. Intenta de nuevo." }, permitido);
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Proxy ORS escuchando en :${PUERTO} — orígenes: ${ORIGENES.join(", ")}`);
  if (!CLAVE) console.warn("AVISO: ORS_API_KEY vacía; /isocronas responderá 503.");
});

module.exports = servidor;
