# Contrato JSON — Zona de estudio (análisis de zona de influencia)

Esquema estable del JSON que exporta el botón **"Descargar JSON"** del panel
"Zona de estudio" (análisis por radio/buffer, `web/buffer.js`). Otro proyecto
(el generador de documentos) consume este archivo — **el esquema no cambia
sin subir `schema_version`**. Este documento es la referencia autoritativa;
si hay divergencia entre este archivo y el código, el código gana pero es un
bug a corregir.

## Versión actual: `schema_version: 1`

## Cómo se genera

El sitio es **100% estático** (Render sirve archivos planos, sin backend —
ver `render.yaml`). No existe un endpoint `GET /api/zona-estudio`. El único
camino para obtener este JSON es:

1. **Manual, en el navegador**: abrir el mapa, activar "Radio", elegir punto
   y radio, clic en "Descargar JSON". El archivo se genera client-side con
   `BufferCore.buildZonaEstudioJSON()` (`web/buffer-core.js`) y se descarga
   directo — no hay llamada de red de por medio.
2. **Reproducir el cálculo externamente** (sin usar el navegador): el motor
   de cálculo es JavaScript puro sin dependencias del DOM
   (`web/buffer-core.js`, funciones `aggregateDemographics`,
   `buildZonaAgregados`, `buildZonaEstudioJSON`). Un proceso externo con
   Node.js puede:
   - Cargar `web/buffer-core.js` (`require("./web/buffer-core.js")` — usa
     UMD, funciona en Node y en navegador).
   - Descargar `data/ags_agebs.geojson`, `data/ags_catastral.geojson`,
     `data/ags_pdu.geojson` (públicos, sin autenticación).
   - Intersectar un círculo de `radio_km` alrededor de `(lat, lng)` contra
     esas capas con una librería de geometría (el sitio usa
     [turf.js](https://turfjs.org/) 6.5.0 — `turf.circle`, `turf.intersect`,
     `turf.area`, `turf.booleanIntersects`, `turf.distance`), construyendo
     por AGEB `{ frac: <fracción de área dentro del círculo>, props: <properties del AGEB> }`.
   - Llamar `BufferCore.aggregateDemographics(agebRows)` para los agregados
     censales, y `BufferCore.buildZonaEstudioJSON(stats)` para el JSON final,
     donde `stats` es el mismo objeto que arma `analyzeBuffer()` en
     `web/buffer.js` (ver ese archivo como referencia exacta de la forma que
     debe tener `stats`: `lat, lng, radiusKm, areaKm2, agebRows, pctSinAgeb,
     demo, colonias, catStats, pdu, pduAreaKm2, proyectos, pois,
     poisDisponibles, crecMunicipios`).
   - Este es el mismo código que corre en el navegador — no hay una segunda
     implementación del cálculo que pueda desviarse.

No se expone un endpoint HTTP porque el proyecto es deliberadamente estático
(ver README.md, sección de arquitectura). Si en el futuro se agrega backend,
la ruta natural es `GET /api/zona-estudio?lat=&lng=&radio=` devolviendo
exactamente este mismo JSON — pero eso no está implementado hoy.

## Paridad con el CSV

El botón "Exportar CSV" (mismo panel) reporta los mismos agregados en
formato de filas `[metrica, valor, unidad, fuente, metodo]`. **Los números
coinciden exactamente** entre CSV y JSON: ambos se derivan de la misma
función `BufferCore.buildZonaAgregados(stats)`, que calcula y redondea cada
valor una sola vez (`web/buffer-core.js`). El CSV solo re-formatea esos
números ya redondeados a texto de punto fijo (p. ej. `10.70`); el JSON los
deja como `number` nativo (`10.7`) — mismo valor, distinta serialización.
Ver `tests/buffer.test.js` para el test explícito de esta paridad.

## Caché

El cálculo caro (intersección geométrica AGEB×buffer) se cachea por
`(lat, lng, radio)` en `bufferCache` (`web/buffer.js`). El JSON y el CSV se
construyen a partir de ese resultado cacheado — recalcular el JSON de un
punto/radio ya analizado es prácticamente gratis.

## Esquema completo

```jsonc
{
  "schema_version": 1,
  "generado": "2026-07-14T22:10:00.000Z",   // ISO 8601, momento de generación del archivo
  "punto": { "lat": 21.948893, "lng": -102.296326 },  // 6 decimales
  "radio_km": 3,
  "area_buffer_km2": 28.32,
  "agebs_intersectadas": 32,                 // n de AGEBs con intersección no vacía
  "cobertura_ageb_pct": 48.8,                // % del área del buffer SÍ cubierta por AGEB urbana 2020
                                              // (100 − el % "sin AGEB" que muestra el panel/advertencia)
  "cortes_edad_nota": "El Censo 2020 (ITER urbano) no publica el quinquenio 25-29 por AGEB...",

  "demografia": {
    "poblacion_total": 62259,
    "poblacion_femenina": 32010,
    "poblacion_masculina": 30249,
    "grupos_edad": {
      // 0-14 y 60_mas son cortes EXACTOS del Censo 2020.
      // 15_24 sustituye al corte de reporte "15-29" (falta el quinquenio 25-29).
      // 25_59 sustituye al corte de reporte "30-59" (absorbe ese quinquenio faltante).
      // Ver "cortes_edad_nota" arriba y scripts/build_nse.py para el detalle.
      "0_14": 15234,
      "15_24": 10877,
      "25_59": 28553,
      "60_mas": 7595
    },
    "poblacion_con_discapacidad": 3102,
    "escolaridad_promedio_anios": 12.9,       // ponderada por población
    "ocupantes_por_cuarto_promedio": 0.72     // ponderado por viviendas habitadas; proxy de hacinamiento
  },

  "vivienda": {
    "viviendas_totales": 21456,               // VIVTOT: incluye colectivas
    "viviendas_particulares": 20811,          // TVIVPAR
    "viviendas_particulares_habitadas": 18773,// TVIVPARHAB (mismo denominador que los % de abajo)
    "viviendas_deshabitadas_pct": 13.2,       // % sobre viviendas particulares totales (capa "Vacantes")
    "pct_con_internet": 84.0,
    "pct_con_computadora": 75.4,
    "pct_con_automovil": 83.9,
    "pct_con_servicios_completos": 99.7,
    "pct_con_piso_firme": 99.5,               // piso distinto de tierra
    "pct_con_electricidad": 99.8,
    "pct_con_sanitario": 99.6,                // excusado/servicio sanitario
    "pct_con_drenaje": 99.4,
    "pct_2mas_recamaras": 80.7,
    "pct_3mas_cuartos": 96.7,
    "ocupantes_3mas_por_cuarto_nota": "El ITER urbano no publica % de viviendas con 3+ ocupantes por cuarto a nivel AGEB; se usa como proxy el promedio de ocupantes por cuarto (ver demografia.ocupantes_por_cuarto_promedio)."
  },

  // % de POBLACIÓN por nivel NSE (proxy propio, NO metodología AMAI) +
  // el nivel con más población dentro del radio
  "nse_distribucion": {
    "A/B": 10.3, "C+": 25.7, "C": 41.9, "C-": 22.1,
    "nivel_predominante": "C"
  },

  "catastral": {
    "colonias_n": 119,
    "min_m2": 100,
    "mediana_m2": 4700,
    "max_m2": 8800,
    "colonias": [
      { "nombre": "CENTRO DE ABASTOS VIÑEDOS SAN MARCOS", "municipio": "Jesús María", "cp": "20915", "valor_m2": 8800 }
      // ... una entrada por colonia cuyo polígono intersecta el buffer
    ]
  },

  // % del ÁREA DEL BUFFER por grupo de uso de suelo PDU, desglosado por
  // el programa de origen (PDUCA Ags / PDU ciudad JM / PMDU JM municipal)
  "pdu_usos": {
    "Habitacional": { "pct": 35.6, "programas": { "PDUCA 2040 ev.2": 23.8, "PM Jesús María 2017-2040 (municipal)": 11.2, "PDU Jesús María 2015-2035": 0.6 } },
    "Crecimiento futuro": { "pct": 25.2, "programas": { "...": "..." } },
    "sin_zonificacion_pct": 3.1   // resto del buffer sin polígono PDU
  },

  "proyectos": [
    { "nombre": "Vivanta Residencial", "tipo": "horizontal", "distancia_km": 1.18 }
    // ... ordenado por distancia al punto central; estudio de mercado 1T26
  ],

  // conteo de POIs (OpenStreetMap) por categoría dentro del radio; null si
  // la capa de POIs no había cargado al momento de generar el análisis
  "poi_conteos": { "Educación": 30, "Salud": 17, "Abasto": 29, "Bancos": 8, "Parques": 28, "Gasolineras": 21 },

  // % de crecimiento poblacional 2010→2020 — dato de CONTEXTO A NIVEL
  // MUNICIPIO COMPLETO (no del radio específico), una entrada por cada
  // municipio que toca el buffer. Fuente: INEGI Censo 2010 y 2020, fila
  // "Total del municipio" (no solo AGEB urbana).
  "crecimiento_poblacion_municipio": { "Aguascalientes": 19.1, "Jesús María": 30.5 },

  "fuentes": [
    "INEGI Censo 2020 (AGEB urbana) — demografía, vivienda, NSE",
    "INEGI Censo 2010 y Censo 2020, Total del municipio — crecimiento poblacional",
    "Leyes de Ingresos 2026 de Aguascalientes y Jesús María — valor catastral de suelo",
    "PDUCA 2040 ev.2 / PDU Ciudad de Jesús María 2015-2035 / PMDU Jesús María 2017-2040 — uso de suelo",
    "Estudio de mercado de terceros, corte 1T26 — proyectos de vivienda nueva",
    "OpenStreetMap contributors (ODbL) — puntos de interés"
  ],

  // lista de advertencias metodológicas aplicables a ESTE análisis en
  // particular (varía: la de cobertura AGEB solo aparece si supera 25%)
  "advertencias": [
    "El 51.2% del área del radio no tiene AGEB urbana 2020 (fraccionamientos nuevos o zona rural en ese censo): los agregados demográficos subestiman la población y viviendas actuales.",
    "El Censo 2020 (ITER urbano) no publica el quinquenio 25-29 por AGEB...",
    "Estimaciones con datos abiertos, no un avalúo ni conteo exacto. Las variables censales se ponderan por la fracción del área de cada AGEB dentro del radio (interpolación areal), asumiendo distribución uniforme dentro del AGEB. El NSE es un proxy propio con Censo 2020 (INEGI), no la metodología AMAI."
  ]
}
```

## Notas de tipos

- Todos los campos numéricos son `number` de JSON (no strings). `null`
  significa "sin dato" (AGEB con confidencialidad censal, capa sin cargar,
  etc.) — nunca se sustituye por `0` para no falsear un promedio o total.
- `grupos_edad`, `nse_distribucion` (salvo `nivel_predominante`), `pdu_usos`
  (salvo `sin_zonificacion_pct`) y `poi_conteos` son objetos con claves
  dinámicas (varían según qué categorías/programas realmente toca el radio).
  Un radio muy pequeño en una zona sin cierto uso de suelo simplemente no
  tendrá esa clave.
- `catastral.colonias` y `proyectos` son arreglos vacíos (`[]`), no `null`,
  cuando no hay elementos.

## Política de versionado

- Cambios que **agregan** una clave nueva sin tocar las existentes: no
  requieren subir `schema_version` (son aditivos, seguros para un consumidor
  que ignore claves desconocidas).
- Cualquier cambio que **renombre, elimine, cambie el tipo, o cambie el
  significado** de una clave existente (incluida la redefinición de un corte
  de edad si INEGI publica un censo con quinquenios completos) **debe** subir
  `schema_version` y documentarse en este archivo.
