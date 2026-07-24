/* Configuración de servicios externos.
 *
 * TOMTOM_API_KEY: clave del Developer Portal de TomTom
 * (https://developer.tomtom.com — plan gratuito: 50,000 tiles/día).
 * Alimenta la capa "Tráfico" (flujo vehicular en tiempo real) y el modo Auto
 * de la capa "Isócronas" (Routing API "Calculate Reachable Range" — usa tráfico
 * típico, por eso da áreas más realistas que ORS en velocidad libre).
 *
 * NOTA: al ser una app 100% estática, esta clave es visible para cualquiera
 * que inspeccione el sitio. En el portal de TomTom, restringe la clave por
 * dominio (allowed origins) a radar-inmobiliario-ags.onrender.com y
 * localhost para que no pueda usarse desde otros sitios, y vigila el
 * consumo en su dashboard. Si se deja vacía, el botón Tráfico muestra
 * las instrucciones de configuración en lugar de la capa.
 */

"use strict";

const TOMTOM_API_KEY = "nCONdLiT2PF3t0aaB9TdbevIqBis8QAZ";

/* ORS_API_KEY: clave del panel de OpenRouteService
 * (https://openrouteservice.org/dev/#/signup — plan gratuito: 500 isócronas/día,
 * 20/min). Alimenta el modo "A pie" de la capa "Isócronas" (una sola llamada
 * trae las tres bandas, sobre la red vial de OpenStreetMap).
 *
 * El modo Auto NO usa ORS sino TomTom: ORS calcula en velocidad libre (sin
 * tráfico) y sus áreas de auto salían poco realistas; TomTom usa tráfico típico.
 * Pero TomTom no puede caminar (su "Reachable Range" es solo motorizado, rechaza
 * el modo a pie), así que el "A pie" sí depende de ORS.
 *
 * NOTA: al ser una app 100% estática, esta clave viaja al navegador y es visible
 * para cualquiera que inspeccione el sitio (igual que la de TomTom). ORS no
 * permite restringir por dominio, así que la protección real es la cuota diaria
 * y vigilar el consumo en el dashboard de ORS. Si se deja vacía, el botón
 * Isócronas explica cómo obtener la clave en lugar de fallar.
 */
const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImQwYTg2MjM5ODIyMDQyZmM4MjNkNzQyOGM0ZWExODNhIiwiaCI6Im11cm11cjY0In0=";
