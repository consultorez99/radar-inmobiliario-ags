/* Núcleo de "Mis puntos": convierte el archivo del usuario (sucursales,
 * clientes, sitios candidatos…) en puntos del mapa.
 *
 * Funciones puras, sin DOM, para probarlas en Node (tests/) y usarlas en el
 * navegador (mispuntos.js). Mismo patrón UMD que buffer-core.js.
 *
 * El archivo nunca sale del navegador: aquí solo se interpreta texto/filas
 * que ya leyó el navegador. Lo que no se puede interpretar se descarta con
 * un motivo, no se adivina: un punto mal ubicado en un análisis de mercado
 * es peor que un punto faltante.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MisPuntosCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Caja amplia de México: sirve para descartar basura (0,0; celdas vacías;
  // coordenadas proyectadas en metros) y para detectar lat/lng invertidas.
  const MX = { latMin: 14, latMax: 33, lonMin: -119, lonMax: -86 };

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/[\s.\-]+/g, "_");

  const COLUMNAS = {
    lat: ["lat", "latitud", "latitude", "y", "coord_y", "lat_y"],
    lon: ["lon", "lng", "long", "longitud", "longitude", "x", "coord_x", "lon_x"],
    nombre: ["nombre", "name", "sucursal", "tienda", "punto", "sitio", "cliente", "razon_social", "id", "clave"],
    grupo: ["tipo", "categoria", "grupo", "marca", "segmento", "clase", "estatus", "status"],
  };

  /* Separador más probable mirando la primera línea (fuera de comillas). */
  function detectarSeparador(texto) {
    const linea = texto.split(/\r?\n/, 1)[0] || "";
    let mejor = ",", max = -1;
    for (const sep of [",", ";", "\t", "|"]) {
      let n = 0, dentro = false;
      for (const ch of linea) {
        if (ch === '"') dentro = !dentro;
        else if (ch === sep && !dentro) n++;
      }
      if (n > max) { max = n; mejor = sep; }
    }
    return mejor;
  }

  /* CSV con comillas (RFC 4180): campos con separador, comillas dobles
   * escapadas y saltos de línea dentro de comillas. Quita el BOM de Excel. */
  function parseCSV(texto, sep = detectarSeparador(texto)) {
    const t = String(texto).replace(/^﻿/, "");
    const filas = [];
    let fila = [], campo = "", dentro = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (dentro) {
        if (ch === '"') {
          if (t[i + 1] === '"') { campo += '"'; i++; }
          else dentro = false;
        } else campo += ch;
      } else if (ch === '"') dentro = true;
      else if (ch === sep) { fila.push(campo); campo = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && t[i + 1] === "\n") i++;
        fila.push(campo); campo = "";
        if (fila.some((c) => c.trim() !== "")) filas.push(fila);
        fila = [];
      } else campo += ch;
    }
    fila.push(campo);
    if (fila.some((c) => c.trim() !== "")) filas.push(fila);
    const [encabezados = [], ...resto] = filas;
    return { encabezados: encabezados.map((h) => h.trim()), filas: resto };
  }

  /* Índice de columna para lat, lon, nombre y grupo (-1 si no hay). Se
   * prefiere coincidencia exacta; si no, una columna que empiece así
   * ("latitud_gps"). */
  function detectarColumnas(encabezados) {
    const n = encabezados.map(norm);
    const out = {};
    for (const [clave, nombres] of Object.entries(COLUMNAS)) {
      let idx = n.findIndex((h) => nombres.includes(h));
      if (idx < 0 && (clave === "lat" || clave === "lon")) {
        idx = n.findIndex((h) => nombres.some((c) => c.length > 2 && h.startsWith(c)));
      }
      out[clave] = idx;
    }
    return out;
  }

  /* "21,8823" (coma decimal) y "21.8823" valen igual; "1,234.5" no aplica a
   * coordenadas. Devuelve NaN si no es un número limpio. */
  function aNumero(v) {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim().replace(/\s/g, "");
    if (!s) return NaN;
    const limpio = /^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s;
    return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
  }

  const enMexico = (lat, lon) =>
    lat >= MX.latMin && lat <= MX.latMax && lon >= MX.lonMin && lon <= MX.lonMax;

  /* Filas -> puntos. `filas` son arreglos alineados con `encabezados`.
   * Devuelve { puntos, descartados: [{ fila, motivo }], invertidas, columnas }.
   * `fila` es el número de renglón como lo ve el usuario en Excel (el
   * encabezado es el 1). */
  function aPuntos(encabezados, filas) {
    const cols = detectarColumnas(encabezados);
    if (cols.lat < 0 || cols.lon < 0) {
      return {
        puntos: [], descartados: [], invertidas: 0, columnas: cols,
        error: "No se encontraron columnas de coordenadas. El archivo necesita una columna " +
          '"lat" (o "latitud") y otra "lon" (o "lng", "longitud").',
      };
    }
    const puntos = [], descartados = [];
    let invertidas = 0;
    filas.forEach((f, i) => {
      const renglon = i + 2;
      let lat = aNumero(f[cols.lat]), lon = aNumero(f[cols.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        descartados.push({ fila: renglon, motivo: "coordenadas vacías o no numéricas" });
        return;
      }
      if (!enMexico(lat, lon) && enMexico(lon, lat)) {
        [lat, lon] = [lon, lat];
        invertidas++;
      }
      if (!enMexico(lat, lon)) {
        descartados.push({ fila: renglon, motivo: `coordenadas fuera de México (${lat}, ${lon})` });
        return;
      }
      const props = {};
      encabezados.forEach((h, j) => {
        if (j !== cols.lat && j !== cols.lon && h) props[h] = f[j] ?? "";
      });
      puntos.push({
        lat, lon,
        nombre: cols.nombre >= 0 && String(f[cols.nombre] ?? "").trim()
          ? String(f[cols.nombre]).trim() : `Punto ${renglon}`,
        grupo: cols.grupo >= 0 ? String(f[cols.grupo] ?? "").trim() || null : null,
        props,
      });
    });
    return { puntos, descartados, invertidas, columnas: cols };
  }

  /* GeoJSON (FeatureCollection de puntos) -> mismo formato que aPuntos. */
  function desdeGeoJSON(gj) {
    const feats = gj?.type === "FeatureCollection" ? gj.features : gj?.type === "Feature" ? [gj] : null;
    if (!Array.isArray(feats)) {
      return { puntos: [], descartados: [], invertidas: 0, error: "El GeoJSON no es una FeatureCollection." };
    }
    const puntos = [], descartados = [];
    feats.forEach((f, i) => {
      if (f?.geometry?.type !== "Point") {
        descartados.push({ fila: i + 1, motivo: `geometría ${f?.geometry?.type || "vacía"}, solo se aceptan puntos` });
        return;
      }
      const [lon, lat] = f.geometry.coordinates;
      if (!enMexico(lat, lon)) {
        descartados.push({ fila: i + 1, motivo: "coordenadas fuera de México" });
        return;
      }
      const props = { ...(f.properties || {}) };
      const claves = Object.keys(props);
      const cols = detectarColumnas(claves);
      puntos.push({
        lat, lon,
        nombre: cols.nombre >= 0 ? String(props[claves[cols.nombre]]) : `Punto ${i + 1}`,
        grupo: cols.grupo >= 0 ? String(props[claves[cols.grupo]] ?? "") || null : null,
        props,
      });
    });
    return { puntos, descartados, invertidas: 0 };
  }

  /* Conteo por grupo ({ grupo: n }), "Sin grupo" para los vacíos. */
  function conteoPorGrupo(puntos) {
    const out = {};
    for (const p of puntos) {
      const g = p.grupo || "Sin grupo";
      out[g] = (out[g] || 0) + 1;
    }
    return out;
  }

  return {
    detectarSeparador, parseCSV, detectarColumnas, aNumero, aPuntos,
    desdeGeoJSON, conteoPorGrupo, MX,
  };
});
