/* Validación del proxy de OpenRouteService.
 *
 * Funciones puras, sin red ni I/O, para poder probarlas en Node (tests/) igual
 * que web/buffer-core.js. Toda la política de "qué peticiones se aceptan" vive
 * aquí; server.js solo la aplica y habla con ORS.
 *
 * POR QUÉ ESTO EXISTE: la clave de ORS no se puede restringir por dominio (a
 * diferencia de la de TomTom), así que estaba en web/config.js a la vista de
 * cualquiera en un repo público. Moverla al servidor NO basta: un proxy que
 * reenvía lo que sea es solo un endpoint abierto nuevo, con la misma cuota de
 * 500 isócronas/día detrás. Lo que de verdad protege la cuota es que el proxy
 * acepte ÚNICAMENTE la petición que la app necesita hacer:
 *
 *   - el perfil lo fija el servidor, no lo manda el cliente;
 *   - el punto debe caer en Aguascalientes y alrededores;
 *   - los tiempos son minutos enteros, ascendentes, máximo 3 bandas de 30 min;
 *   - hay tope por IP y tope diario global.
 *
 * Quien robe la URL solo puede calcular isócronas a pie en Aguascalientes, con
 * cuota acotada: no le sirve de nada y no te tumba el servicio.
 */

"use strict";

/* Perfiles de ORS que el proxy acepta. Hoy la app solo usa "A pie" (el modo
 * Auto va por TomTom, ver web/isocronas.js). Si algún día se habilita bici
 * —el ISO_MODES de isocronas.js ya lo deja apuntado— basta agregar
 * "cycling-regular" a esta lista. */
const PERFILES = ["foot-walking"];

/* Aguascalientes (estado) con ~50 km de margen. Deliberadamente holgado: el
 * mapa deja hacer pan/zoom libre y el análisis puede caer en cualquier punto
 * del área metropolitana o de municipios vecinos. Lo que corta es el uso del
 * endpoint como servicio de isócronas de otras ciudades a costa de la cuota,
 * en la misma lógica que TRAFICO_BOUNDS en web/trafico.js. */
const BBOX = { latMin: 21.3, latMax: 22.8, lngMin: -103.3, lngMax: -101.4 };

const MAX_BANDAS = 3;
const MAX_MINUTOS = 30;  // = ISO_MAX_MIN en web/isocronas.js

const esFinito = (n) => typeof n === "number" && Number.isFinite(n);

/* Valida el cuerpo que manda la app y devuelve los datos ya normalizados.
 * No confía en nada del cliente: cualquier campo extra se ignora. */
function validarCuerpo(cuerpo) {
  const mal = (error) => ({ ok: false, status: 400, error });

  if (cuerpo === null || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return mal("El cuerpo debe ser un objeto JSON.");
  }
  const { lat, lng, minutos, perfil } = cuerpo;

  if (!esFinito(lat) || !esFinito(lng)) return mal("lat y lng deben ser números.");
  if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) {
    return mal("El punto está fuera de la zona de cobertura (Aguascalientes y alrededores).");
  }

  // El perfil es opcional; si viene, debe estar en la lista. Nunca se reenvía
  // un valor arbitrario del cliente a la URL de ORS.
  const perfilFinal = perfil === undefined ? PERFILES[0] : perfil;
  if (!PERFILES.includes(perfilFinal)) return mal("Perfil de ruteo no permitido.");

  if (!Array.isArray(minutos) || minutos.length < 1 || minutos.length > MAX_BANDAS) {
    return mal(`minutos debe ser un arreglo de 1 a ${MAX_BANDAS} elementos.`);
  }
  for (const m of minutos) {
    if (!esFinito(m) || !Number.isInteger(m)) return mal("Cada banda debe ser un número entero de minutos.");
    if (m < 1 || m > MAX_MINUTOS) return mal(`Cada banda debe estar entre 1 y ${MAX_MINUTOS} minutos.`);
  }
  // Ascendentes y sin repetir: ORS devuelve un Feature por banda y la app las
  // asume anidadas P1 ⊂ P2 ⊂ P3 (ver isoFetchBands en web/isocronas.js).
  for (let i = 1; i < minutos.length; i++) {
    if (minutos[i] <= minutos[i - 1]) return mal("Las bandas deben ir en orden ascendente y sin repetirse.");
  }

  return { ok: true, datos: { lat, lng, minutos, perfil: perfilFinal } };
}

/* Cuerpo que se le manda a ORS. Se construye aquí, no se reenvía el del
 * cliente: así el payload que llega a ORS siempre es exactamente este. */
function cuerpoORS({ lat, lng, minutos }) {
  return {
    locations: [[lng, lat]],
    range: minutos.map((m) => m * 60), // ORS espera segundos
    range_type: "time",
  };
}

/* Origen permitido. Sin Origin (curl, server-to-server) NO se acepta: el único
 * cliente legítimo es el navegador servido desde el sitio. No es una defensa
 * fuerte —un Origin se falsifica con curl— pero corta el caso realista de que
 * otro sitio web use el endpoint desde el navegador de sus visitantes. La
 * defensa real es el recorte de la petición y las cuotas de abajo. */
function origenPermitido(origen, lista) {
  if (typeof origen !== "string" || !origen) return false;
  return lista.includes(origen);
}

/* Dos topes a la vez:
 *   - porIP: ráfagas de un mismo visitante (ventana deslizante).
 *   - global: presupuesto diario, para que la cuota de ORS (500/día) no se
 *     pueda agotar aunque el tráfico venga repartido entre muchas IPs.
 * En memoria a propósito: es un solo proceso y perder el conteo al reiniciar
 * es aceptable —el peor caso es un día con el presupuesto reiniciado, no una
 * fuga de la clave. */
class Limitador {
  constructor({ porIP = 10, ventanaMs = 60_000, global = 300 } = {}) {
    this.porIP = porIP;
    this.ventanaMs = ventanaMs;
    this.global = global;
    this.hits = new Map();     // ip -> number[] (timestamps)
    this.dia = null;           // "YYYY-MM-DD" del conteo global vigente
    this.usadasHoy = 0;
  }

  /* ahora = Date (inyectable para poder probar sin esperar tiempo real). */
  permitir(ip, ahora = new Date()) {
    const t = ahora.getTime();

    const hoy = ahora.toISOString().slice(0, 10);
    if (this.dia !== hoy) { this.dia = hoy; this.usadasHoy = 0; }
    if (this.usadasHoy >= this.global) {
      return { ok: false, status: 429, error: "Se alcanzó el presupuesto diario de isócronas del sitio. Intenta mañana." };
    }

    const previas = (this.hits.get(ip) || []).filter((ts) => t - ts < this.ventanaMs);
    if (previas.length >= this.porIP) {
      this.hits.set(ip, previas);
      return { ok: false, status: 429, error: "Demasiadas isócronas seguidas. Espera un minuto." };
    }

    previas.push(t);
    this.hits.set(ip, previas);
    this.usadasHoy++;

    // Poda: sin esto el Map crece sin techo con cada IP que pasa.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (!v.some((ts) => t - ts < this.ventanaMs)) this.hits.delete(k);
      }
    }
    return { ok: true };
  }
}

module.exports = {
  PERFILES, BBOX, MAX_BANDAS, MAX_MINUTOS,
  validarCuerpo, cuerpoORS, origenPermitido, Limitador,
};
