/* Configuración de servicios externos.
 *
 * Regla de la casa: en un sitio 100% estático, TODO lo que esté en este
 * archivo viaja al navegador y es visible para cualquiera que abra el
 * inspector. Aquí solo van claves que el proveedor permita restringir por
 * dominio. Lo que no se pueda restringir, va en el servidor (ver proxy/).
 */

"use strict";

/* TOMTOM_API_KEY: clave del Developer Portal de TomTom
 * (https://developer.tomtom.com — plan gratuito: 50,000 tiles/día).
 * Alimenta la capa "Tráfico" (flujo vehicular en tiempo real) y el modo Auto
 * de la capa "Isócronas" (Routing API "Calculate Reachable Range" — usa tráfico
 * típico, por eso da áreas más realistas que ORS en velocidad libre).
 *
 * Es una clave de navegador y está pensada para ser pública, PERO eso solo es
 * seguro si está restringida por dominio. En el portal de TomTom
 * (Dashboard → la clave → Allowed Origins) deben estar SOLO:
 *   https://radar-inmobiliario-ags.onrender.com
 *   http://localhost:8000
 * Sin esa restricción, cualquiera puede copiarla del inspector y gastar la
 * cuota. Si se deja vacía, el botón Tráfico muestra las instrucciones de
 * configuración en lugar de la capa.
 */
const TOMTOM_API_KEY = "nCONdLiT2PF3t0aaB9TdbevIqBis8QAZ";

/* ORS_PROXY_URL: base del proxy propio que habla con OpenRouteService
 * (código en proxy/, desplegado como servicio web en Render — ver render.yaml).
 *
 * POR QUÉ HAY UN PROXY Y NO UNA CLAVE AQUÍ: ORS no permite restringir la clave
 * por dominio, a diferencia de TomTom. Puesta en este archivo quedaba a la
 * vista en un repo público y cualquiera podía agotar las 500 isócronas/día,
 * dejando el modo "A pie" muerto. Ahora la clave vive en la variable de
 * entorno ORS_API_KEY del servicio en Render y nunca llega al navegador.
 *
 * El proxy no es un reenviador ciego: solo acepta isócronas a pie, dentro de
 * Aguascalientes y con topes por IP y por día (ver proxy/validar.js).
 *
 * Vacío = modo "A pie" deshabilitado, con un mensaje que lo explica. El modo
 * Auto (TomTom) no depende de esto.
 */
const ORS_PROXY_URL = "https://radar-inmobiliario-ags-proxy.onrender.com";
