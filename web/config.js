/* Configuración de servicios externos.
 *
 * TOMTOM_API_KEY: clave del Developer Portal de TomTom
 * (https://developer.tomtom.com — plan gratuito: 50,000 tiles/día).
 * Alimenta la capa "Tráfico" (flujo vehicular en tiempo real).
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
