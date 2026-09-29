/* Núcleo del análisis de competencia: negocios DENUE de uno o varios giros
 * dentro de un área (radio, banda de isócrona o polígono dibujado).
 *
 * Funciones puras, sin Leaflet/turf/DOM, para probarlas en Node (tests/) y
 * usarlas en el navegador (competencia.js). Mismo patrón UMD que
 * buffer-core.js: window.CompetenciaCore en el navegador, module.exports en
 * Node.
 *
 * Trabaja sobre el formato compacto de data/ags_denue_negocios.json:
 *   actividades: [nombre del giro SCIAN, ...]
 *   tamanos:     ["0 a 5 personas", ...]
 *   negocios:    [[nombre, cat_idx, act_idx, tam_idx, lat, lon], ...]
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompetenciaCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // minúsculas y sin acentos: "farmacia" encuentra "Farmacias sin minisúper"
  function normalizar(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  /* Total de negocios por giro (índice de actividad -> conteo). */
  function totalesPorGiro(data) {
    const t = new Array(data.actividades.length).fill(0);
    for (const n of data.negocios) t[n[2]]++;
    return t;
  }

  /* Palabras de uso común que no aparecen en el nombre SCIAN del giro. Solo
   * donde la raíz cambia: "farmacia" o "pizza" ya encuentran su giro solos. */
  const SINONIMOS = {
    gimnasio: "acondicionamiento", gimnasios: "acondicionamiento", gym: "acondicionamiento",
    estetica: "belleza", esteticas: "belleza", peluqueria: "belleza", barberia: "belleza",
    panaderia: "panificacion", panaderias: "panificacion",
    carniceria: "carnes", carnicerias: "carnes",
    optica: "lentes", opticas: "lentes",
    cine: "exhibicion peliculas", cines: "exhibicion peliculas",
    super: "supermercados", conveniencia: "minisupers", oxxo: "minisupers",
    taller: "reparacion", mecanico: "reparacion mecanica",
    dentista: "dentales", dentistas: "dentales",
    gasolinera: "gasolina", gasolineras: "gasolina",
    banco: "banca", bancos: "banca",
    tortilleria: "tortillas", tortillerias: "tortillas",
    kinder: "preescolar",
  };

  /* Giros donde cada palabra buscada es el inicio de alguna palabra del
   * nombre ("bar" encuentra "Bares", no "abarrotes"), los más comunes primero
   * (el giro que uno busca casi siempre es el grande).
   * totales: salida de totalesPorGiro, precalculada por quien llama. */
  function buscarGiros(data, totales, query, limite = 12) {
    const palabras = normalizar(query).split(/[\s,]+/).filter((p) => p.length >= 2)
      .flatMap((p) => (SINONIMOS[p] || p).split(" "));
    if (!palabras.length) return [];
    const out = [];
    data.actividades.forEach((nombre, idx) => {
      if (!totales[idx]) return;
      const del = normalizar(nombre).split(/[^a-z0-9]+/);
      if (palabras.every((p) => del.some((w) => w.startsWith(p)))) {
        out.push({ idx, nombre, total: totales[idx] });
      }
    });
    out.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
    return out.slice(0, limite);
  }

  /* Negocios de los giros elegidos, como objetos legibles. */
  function negociosDeGiros(data, giros) {
    const set = giros instanceof Set ? giros : new Set(giros);
    const out = [];
    for (const [nombre, , actIdx, tamIdx, lat, lon] of data.negocios) {
      if (!set.has(actIdx)) continue;
      out.push({ nombre, actIdx, giro: data.actividades[actIdx], tamano: data.tamanos[tamIdx], lat, lon });
    }
    return out;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371.0088;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* Tamaño por personal ocupado, en tres grupos. Se lee el límite inferior
   * del rango que publica DENUE ("11 a 30 personas" -> 11) en vez de fiarse
   * del orden del arreglo. Micro <= 10 personas, pequeño 11-50, mediano o
   * grande 51+: es el corte que separa a la tiendita de la cadena. */
  function grupoTamano(etiqueta) {
    const li = parseInt(String(etiqueta || ""), 10);
    if (!Number.isFinite(li)) return "sd";
    if (li < 11) return "micro";
    if (li < 51) return "pequeno";
    return "grande";
  }

  /* Resumen de la competencia en un área.
   *   competidores: negocios (de negociosDeGiros) que caen dentro del área
   *   pop:          población estimada del área (Censo 2020), para saturación
   *   centro:       {lat, lng} del sitio analizado, o null (polígono libre):
   *                 sin centro no hay "más cercano" ni distancias. */
  function resumenCompetencia(competidores, { pop = null, centro = null } = {}) {
    const lista = competidores.map((c) => ({
      ...c,
      distKm: centro ? haversineKm(centro.lat, centro.lng, c.lat, c.lon) : null,
    }));
    if (centro) lista.sort((a, b) => a.distKm - b.distKm || a.nombre.localeCompare(b.nombre));
    else lista.sort((a, b) => a.nombre.localeCompare(b.nombre));

    const porTamano = { micro: 0, pequeno: 0, grande: 0, sd: 0 };
    for (const c of lista) porTamano[grupoTamano(c.tamano)]++;

    const n = lista.length;
    return {
      n,
      // habitantes por negocio: cuánta demanda le toca a cada competidor.
      // null si no hay competidores (no es "infinito", es "sin competencia").
      habPorNegocio: n > 0 && pop > 0 ? pop / n : null,
      por10kHab: pop > 0 ? (n / pop) * 10000 : null,
      masCercano: centro && n ? lista[0] : null,
      porTamano,
      lista,
    };
  }

  return {
    normalizar, totalesPorGiro, buscarGiros, negociosDeGiros,
    haversineKm, grupoTamano, resumenCompetencia,
  };
});
