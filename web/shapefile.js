/* Escritor de shapefile (.shp/.shx/.dbf/.prj/.cpg) empaquetado en ZIP.
 *
 * Sin dependencias: el sitio es estático y no se compila, así que en vez de
 * sumar una librería de CDN se escriben los cinco archivos a mano. Son
 * formatos viejos pero cortos, y aquí solo hay que emitir UN polígono (la zona
 * dibujada o el círculo de radio), no una capa arbitraria.
 *
 * Funciones puras, sin Leaflet/turf/DOM, para poder probarlas en Node
 * (tests/shapefile.test.js) y usarlas en el navegador. Se expone como
 * window.ShapefileZip; en Node como module.exports.
 *
 * Dos trampas del formato que están resueltas aquí:
 *   1. ORIENTACIÓN DE ANILLOS. El shapefile pide el anillo exterior en sentido
 *      HORARIO y los huecos en ANTIHORARIO — exactamente al revés que GeoJSON
 *      (RFC 7946). Sin invertir, QGIS dibuja el polígono como si fuera un
 *      hueco. Ver anilloHorario().
 *   2. LARGO DE CAMPO EN BYTES. El .dbf mide los campos en bytes, no en
 *      caracteres, y el nombre del campo tope a 10. Con acentos en UTF-8 un
 *      "á" ocupa 2 bytes: medir en .length corrompe el registro.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShapefileZip = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TIPO_POLIGONO = 5; // shapeType 5 = Polygon (2D)

  // WKT de EPSG:4326. Sin .prj, QGIS pregunta el sistema de referencia al
  // abrir y ArcGIS lo da por desconocido.
  const PRJ_WGS84 =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  // EPSG:32613 — WGS 84 / UTM zona 13N, que es la que cubre Aguascalientes.
  const PRJ_UTM13N =
    'PROJCS["WGS_1984_UTM_Zone_13N",' + PRJ_WGS84 + ',PROJECTION["Transverse_Mercator"],' +
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],' +
    'PARAMETER["Central_Meridian",-105.0],PARAMETER["Scale_Factor",0.9996],' +
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

  const utf8 = (s) => new TextEncoder().encode(String(s == null ? "" : s));

  /* --- Proyección a UTM ----------------------------------------------------
   *
   * Serie clásica de Transverse Mercator (Snyder / USGS Professional Paper
   * 1395) sobre el elipsoide WGS84. Con milímetros de error hasta ~3° del
   * meridiano central; Aguascalientes está a 2.7° del de la zona 13 (-105°),
   * así que sobra. Se implementa a mano porque el sitio es estático: meter
   * proj4js por CDN para una sola fórmula no se justifica.
   *
   * OJO: solo sirve para la zona 13 norte. Un dato fuera de esa franja saldría
   * con una distorsión creciente, por eso valida el rango de longitud.
   */
  const UTM13N = (() => {
    const a = 6378137.0;                 // semieje mayor WGS84
    const f = 1 / 298.257223563;         // achatamiento
    const e2 = f * (2 - f);              // primera excentricidad al cuadrado
    const ep2 = e2 / (1 - e2);           // segunda excentricidad
    const k0 = 0.9996;                   // factor de escala de UTM
    const lon0 = (-105 * Math.PI) / 180; // meridiano central de la zona 13
    const FE = 500000;                   // falso este

    return function proyectar(lon, lat) {
      const phi = (lat * Math.PI) / 180;
      const dLon = ((lon * Math.PI) / 180) - lon0;
      const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);

      const N = a / Math.sqrt(1 - e2 * sin * sin);
      const T = tan * tan;
      const C = ep2 * cos * cos;
      const A = dLon * cos;

      // Arco de meridiano desde el ecuador hasta phi.
      const M = a * (
        (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi
        - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi)
        + ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi)
        - ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi)
      );

      const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;
      const este = FE + k0 * N * (
        A + ((1 - T + C) * A3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120
      );
      const norte = k0 * (M + N * tan * (
        A2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A4) / 24
        + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720
      ));
      return [este, norte];
    };
  })();

  /* Sistemas de referencia disponibles para la exportación. `proyectar` null
   * = las coordenadas ya vienen en ese sistema (grados). */
  const CRS = {
    utm13n: {
      nombre: "EPSG:32613 — WGS 84 / UTM zona 13N (metros)",
      prj: PRJ_UTM13N,
      proyectar: UTM13N,
      // Rango útil de la zona 13 (108°O a 102°O) más un margen: Aguascalientes
      // y Jesús María caen dentro, pero conviene fallar fuerte si algún día se
      // exporta un dato de otra franja en vez de dibujarlo desplazado.
      valido: (lon) => lon >= -111 && lon <= -99,
    },
    wgs84: {
      nombre: "EPSG:4326 — WGS 84 (grados)",
      prj: PRJ_WGS84,
      proyectar: null,
      valido: () => true,
    },
  };

  /* --- Geometría ----------------------------------------------------------- */

  /* Área con signo (fórmula del zapato). Positiva = sentido horario en
   * coordenadas geográficas con Y hacia arriba. */
  function areaConSigno(anillo) {
    let suma = 0;
    for (let i = 0, n = anillo.length - 1; i < n; i++) {
      suma += (anillo[i + 1][0] - anillo[i][0]) * (anillo[i + 1][1] + anillo[i][1]);
    }
    return suma;
  }

  /* Devuelve el anillo en el sentido que pide el shapefile: exterior horario,
   * hueco antihorario. */
  function anilloHorario(anillo, esHueco) {
    const cerrado = anillo.slice();
    const primero = cerrado[0];
    const ultimo = cerrado[cerrado.length - 1];
    if (primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) cerrado.push(primero);
    const horario = areaConSigno(cerrado) > 0;
    return horario === !esHueco ? cerrado : cerrado.reverse();
  }

  /* Normaliza Polygon / MultiPolygon a una lista de anillos ya orientados y ya
   * proyectados al CRS de salida. En un MultiPolygon todos los anillos van al
   * mismo registro: el shapefile no distingue "multi" — un polígono con varias
   * partes ES el multipolígono.
   *
   * La orientación se decide DESPUÉS de proyectar. UTM conserva el sentido de
   * giro, así que da igual, pero medir sobre las coordenadas que realmente se
   * escriben evita depender de esa propiedad. */
  function anillosDe(geometry, crs = CRS.wgs84) {
    if (!geometry) throw new Error("Falta la geometría");
    const poligonos =
      geometry.type === "Polygon" ? [geometry.coordinates]
      : geometry.type === "MultiPolygon" ? geometry.coordinates
      : null;
    if (!poligonos) throw new Error("Geometría no soportada: " + geometry.type);

    const proyectar = crs.proyectar
      ? ([lon, lat]) => {
          if (!crs.valido(lon)) {
            throw new Error(`Longitud ${lon} fuera del alcance de ${crs.nombre}`);
          }
          return crs.proyectar(lon, lat);
        }
      : (p) => p;

    const anillos = [];
    for (const poligono of poligonos) {
      poligono.forEach((anillo, i) => anillos.push(anilloHorario(anillo.map(proyectar), i > 0)));
    }
    if (anillos.length === 0) throw new Error("El polígono no tiene anillos");
    return anillos;
  }

  function bbox(anillos) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const anillo of anillos) {
      for (const [x, y] of anillo) {
        if (x < xmin) xmin = x;
        if (y < ymin) ymin = y;
        if (x > xmax) xmax = x;
        if (y > ymax) ymax = y;
      }
    }
    return [xmin, ymin, xmax, ymax];
  }

  /* --- .shp y .shx --------------------------------------------------------- */

  /* Los dos comparten el mismo encabezado de 100 bytes; solo cambia el largo
   * total declarado (en palabras de 16 bits, big endian — herencia del formato). */
  function encabezado(largoPalabras, caja) {
    const buf = new ArrayBuffer(100);
    const v = new DataView(buf);
    v.setInt32(0, 9994, false); // código de archivo
    v.setInt32(24, largoPalabras, false);
    v.setInt32(28, 1000, true); // versión
    v.setInt32(32, TIPO_POLIGONO, true);
    v.setFloat64(36, caja[0], true);
    v.setFloat64(44, caja[1], true);
    v.setFloat64(52, caja[2], true);
    v.setFloat64(60, caja[3], true);
    return new Uint8Array(buf);
  }

  /* Escribe el .shp de N registros (uno por feature). Devuelve también el
   * índice (offset y largo de cada registro) porque el .shx lo necesita. */
  function escribirShp(registros) {
    const cajaTotal = bbox(registros.flat());
    const tamanos = registros.map((anillos) => {
      const nPuntos = anillos.reduce((t, a) => t + a.length, 0);
      // tipo(4) + caja(32) + numParts(4) + numPoints(4) + partes + puntos
      return 4 + 32 + 4 + 4 + 4 * anillos.length + 16 * nPuntos;
    });
    const total = 100 + tamanos.reduce((t, n) => t + 8 + n, 0);

    const buf = new ArrayBuffer(total);
    const v = new DataView(buf);
    new Uint8Array(buf).set(encabezado(total / 2, cajaTotal), 0);

    const indice = [];
    let o = 100;
    registros.forEach((anillos, i) => {
      indice.push({ offsetPalabras: o / 2, largoPalabras: tamanos[i] / 2 });
      v.setInt32(o, i + 1, false); o += 4; // número de registro (base 1)
      v.setInt32(o, tamanos[i] / 2, false); o += 4;

      const caja = bbox([anillos]);
      const nPuntos = anillos.reduce((t, a) => t + a.length, 0);
      v.setInt32(o, TIPO_POLIGONO, true); o += 4;
      for (const c of caja) { v.setFloat64(o, c, true); o += 8; }
      v.setInt32(o, anillos.length, true); o += 4;
      v.setInt32(o, nPuntos, true); o += 4;

      let desde = 0;
      for (const anillo of anillos) { v.setInt32(o, desde, true); o += 4; desde += anillo.length; }
      for (const anillo of anillos) {
        for (const [x, y] of anillo) {
          v.setFloat64(o, x, true); o += 8;
          v.setFloat64(o, y, true); o += 8;
        }
      }
    });
    return { bytes: new Uint8Array(buf), indice, caja: cajaTotal };
  }

  function escribirShx(indice, caja) {
    const total = 100 + 8 * indice.length;
    const buf = new ArrayBuffer(total);
    const v = new DataView(buf);
    new Uint8Array(buf).set(encabezado(total / 2, caja), 0);
    indice.forEach((r, i) => {
      v.setInt32(100 + 8 * i, r.offsetPalabras, false);
      v.setInt32(104 + 8 * i, r.largoPalabras, false);
    });
    return new Uint8Array(buf);
  }

  /* --- .dbf ---------------------------------------------------------------- */

  /* campos: [{ nombre, tipo: "C"|"N", largo, decimales }] — nombre <= 10 bytes.
   * filas:  [[v1, v2, …], …] en el mismo orden que `campos`. */
  function escribirDbf(campos, filas) {
    const largoRegistro = 1 + campos.reduce((t, c) => t + c.largo, 0);
    const largoEncabezado = 32 + 32 * campos.length + 1;
    const total = largoEncabezado + largoRegistro * filas.length + 1; // +1 = fin (0x1A)

    const buf = new ArrayBuffer(total);
    const v = new DataView(buf);
    const b = new Uint8Array(buf);
    const hoy = new Date();

    b[0] = 0x03; // dBase III sin memo
    b[1] = hoy.getFullYear() - 1900;
    b[2] = hoy.getMonth() + 1;
    b[3] = hoy.getDate();
    v.setUint32(4, filas.length, true);
    v.setUint16(8, largoEncabezado, true);
    v.setUint16(10, largoRegistro, true);

    campos.forEach((campo, i) => {
      const base = 32 + 32 * i;
      const nombre = utf8(campo.nombre).slice(0, 10);
      b.set(nombre, base); // el resto queda en 0 = terminador nulo
      b[base + 11] = campo.tipo.charCodeAt(0);
      b[base + 16] = campo.largo;
      b[base + 17] = campo.decimales || 0;
    });
    b[largoEncabezado - 1] = 0x0d; // fin de descriptores

    let o = largoEncabezado;
    for (const fila of filas) {
      b[o++] = 0x20; // marca de "no borrado"
      campos.forEach((campo, i) => {
        const texto = utf8(fila[i]).slice(0, campo.largo);
        const relleno = campo.largo - texto.length;
        // Convención dBase: numéricos alineados a la derecha, texto a la izquierda.
        if (campo.tipo === "N") {
          b.fill(0x20, o, o + relleno);
          b.set(texto, o + relleno);
        } else {
          b.set(texto, o);
          b.fill(0x20, o + texto.length, o + campo.largo);
        }
        o += campo.largo;
      });
    }
    b[o] = 0x1a;
    return b;
  }

  /* --- ZIP (método "store", sin compresión) -------------------------------- */

  const TABLA_CRC = (() => {
    const tabla = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[i] = c;
    }
    return tabla;
  })();

  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function zip(archivos) {
    const entradas = archivos.map((a) => ({
      nombre: utf8(a.nombre),
      datos: a.datos,
      crc: crc32(a.datos),
    }));
    const bytesLocales = entradas.reduce((t, e) => t + 30 + e.nombre.length + e.datos.length, 0);
    const bytesCentral = entradas.reduce((t, e) => t + 46 + e.nombre.length, 0);

    const buf = new ArrayBuffer(bytesLocales + bytesCentral + 22);
    const v = new DataView(buf);
    const b = new Uint8Array(buf);
    let o = 0;

    for (const e of entradas) {
      e.offset = o;
      v.setUint32(o, 0x04034b50, true);
      v.setUint16(o + 4, 20, true); // versión mínima
      v.setUint16(o + 6, 0x0800, true); // nombres en UTF-8
      v.setUint16(o + 8, 0, true); // método 0 = almacenado
      v.setUint32(o + 14, e.crc, true);
      v.setUint32(o + 18, e.datos.length, true);
      v.setUint32(o + 22, e.datos.length, true);
      v.setUint16(o + 26, e.nombre.length, true);
      o += 30;
      b.set(e.nombre, o); o += e.nombre.length;
      b.set(e.datos, o); o += e.datos.length;
    }

    const inicioCentral = o;
    for (const e of entradas) {
      v.setUint32(o, 0x02014b50, true);
      v.setUint16(o + 4, 20, true);
      v.setUint16(o + 6, 20, true);
      v.setUint16(o + 8, 0x0800, true);
      v.setUint16(o + 10, 0, true);
      v.setUint32(o + 16, e.crc, true);
      v.setUint32(o + 20, e.datos.length, true);
      v.setUint32(o + 24, e.datos.length, true);
      v.setUint16(o + 28, e.nombre.length, true);
      v.setUint32(o + 42, e.offset, true);
      o += 46;
      b.set(e.nombre, o); o += e.nombre.length;
    }

    v.setUint32(o, 0x06054b50, true);
    v.setUint16(o + 8, entradas.length, true);
    v.setUint16(o + 10, entradas.length, true);
    v.setUint32(o + 12, bytesCentral, true);
    v.setUint32(o + 16, inicioCentral, true);
    return b;
  }

  /* --- API ----------------------------------------------------------------- */

  /* Archivos de UNA capa (un .shp con N polígonos).
   *   capa      nombre base dentro del ZIP
   *   campos    [{ nombre, tipo, largo, decimales }]
   *   filas     [{ geometry, valores: [...] }] — un renglón por polígono
   * Un shapefile admite una sola geometría y un solo esquema de atributos, por
   * eso cada capa es un archivo aparte y no todas juntas. */
  function archivosDeCapa({ capa, campos = [], filas = [] }, crs = CRS.wgs84) {
    if (filas.length === 0) return [];
    const registros = filas.map((f) => anillosDe(f.geometry, crs));
    const shp = escribirShp(registros);
    return [
      { nombre: capa + ".shp", datos: shp.bytes },
      { nombre: capa + ".shx", datos: escribirShx(shp.indice, shp.caja) },
      { nombre: capa + ".dbf", datos: escribirDbf(campos, filas.map((f) => f.valores)) },
      { nombre: capa + ".prj", datos: utf8(crs.prj) },
      { nombre: capa + ".cpg", datos: utf8("UTF-8") },
    ];
  }

  /* ZIP con varias capas. Las capas vacías se omiten (no tiene sentido un
   * shapefile de cero features, y algunos lectores lo rechazan).
   * `crs` por defecto UTM 13N: es lo que piden los gestores locales, y en
   * metros las mediciones de área y distancia salen directo del archivo. */
  function desdeCapas(capas, extras = [], crs = CRS.utm13n) {
    const archivos = capas.flatMap((c) => archivosDeCapa(c, crs));
    if (archivos.length === 0) throw new Error("No hay nada que exportar");
    return zip(archivos.concat(extras));
  }

  /* Atajo para el caso de un solo polígono con un solo renglón de atributos. */
  function desdeGeometria({ geometry, campos = [], valores = [], capa = "zona", crs }) {
    return desdeCapas([{ capa, campos, filas: [{ geometry, valores }] }], [], crs || CRS.utm13n);
  }

  return {
    desdeCapas, desdeGeometria, archivosDeCapa,
    anillosDe, anilloHorario, areaConSigno, crc32,
    CRS, PRJ_WGS84, PRJ_UTM13N,
  };
});
