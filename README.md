# Radar Inmobiliario · Aguascalientes

Mapa web interactivo (Leaflet + OpenStreetMap) de **Aguascalientes, Ags.** con
dos capas choropleth:

1. **Nivel Socioeconómico (NSE) estimado** por AGEB — 7 niveles (A/B … E).
   Cubre los municipios de **Aguascalientes (001)** y **Jesús María (005)**.
2. **Zonas de precio aproximado ($/m²)** — 6 zonas de mercado (solo municipio
   de Aguascalientes; no hay investigación de mercado para Jesús María).
3. **Valor catastral de suelo ($/m²) por colonia** — valores oficiales 2026 de
   las Leyes de Ingresos de los municipios de Aguascalientes y Jesús María
   (base del predial), sobre polígonos de colonias de INEGI.
4. **Recámaras** — % de viviendas con 2+ recámaras por AGEB (Censo 2020).
5. **Tamaño de vivienda (proxy)** — % de viviendas con 3+ cuartos por AGEB
   (Censo 2020); proxy de superficie construida, no son m² catastrales.
6. **Planes de Desarrollo Urbano** — zonificación secundaria oficial de tres
   programas: PDUCA 2040 ev.2 (Aguascalientes), PDU de la ciudad de Jesús
   María 2015-2035 y el Programa Municipal de Jesús María 2017-2040 (cubre
   el resto del municipio: Margaritas, Maravillas, Colonia Nueva, etc.),
   todos extraídos de sus visores ArcGIS Online (SEGUOT/IMPLAN).

Las capas 4–6 replican (con datos abiertos) tres de los cuatro filtros de
pago de RadarMX; el cuarto, *Absorción de vivienda nueva*, se resuelve con
un estudio de mercado adquirido aparte (ver panel "Vivienda nueva" abajo).

Además, dos capas superpuestas (no exclusivas, se ven encima de cualquiera
de las anteriores):

7. **Proyectos de vivienda nueva** — pines de 9 desarrollos con absorción
   real, geocodificados por nombre.
8. **Puntos de interés** — 1,467 escuelas, hospitales/farmacias,
   supermercados, bancos, parques y gasolineras (OpenStreetMap, dato abierto).
9. **Tráfico en tiempo real** — flujo vehicular en vivo (TomTom Traffic,
   raster tiles). Única capa que no es dato oficial/abierto: es telemetría
   comercial; requiere la API key en `web/config.js` (plan gratuito de
   TomTom, 50,000 tiles/día; restringir la key por dominio en su portal,
   porque en una app estática queda visible en el código del sitio).

Herramientas interactivas:

- **Buscador** con autocomplete local sobre las 783 colonias oficiales
  (instantáneo) y respaldo Nominatim para direcciones exactas.
- **Zona de estudio**: dibuja un polígono (botón bajo el zoom) y obtén
  población, NSE predominante, estadísticas de valor catastral, rangos de
  mercado, % de uso de suelo del PDU y gráficos (composición NSE + histograma
  catastral). Cálculo 100% en el navegador con Turf.js.
- **Reporte PDF** de la zona dibujada (2 páginas: indicadores + captura del
  mapa, gráficos y tabla de colonias con fuentes y disclaimer).
- **Comparador**: botón "⚖️ Comparar" en los popups de la capa Catastral para
  contrastar hasta 4 colonias lado a lado.
- Panel de capas, leyendas flotantes y modal "Acerca de".

> ⚠️ **Proyecto independiente.** Sin afiliación con Tinsa, RadarMX ni AMAI.
> Todo lo que muestra son **estimaciones construidas con datos abiertos**, no
> avalúos oficiales ni el algoritmo propietario de NSE de AMAI.

## Cómo correrlo

Los GeoJSON se cargan con `fetch`, así que hace falta un servidor estático
(no funciona abriendo `index.html` con doble clic):

```bash
cd mapa
python3 -m http.server 8000
# abrir http://localhost:8000/web/
```

## Estructura

```
data/
  ags_agebs.geojson          # 373 AGEBs (332 Ags + 41 Jesús María) con nse_score, nse_nivel, zona y variables censales
  ags_price_zones.geojson    # 6 zonas: zona, precio_m2_min/max, plusvalia, nota
  ags_catastral.geojson      # 783 colonias (611 Ags + 172 JM) con valor_m2 oficial 2026, sector/plano y CP
  ags_pdu.geojson            # 1,284 polígonos: 32 PDUCA 2040 (Ags) + 392 PDU ciudad JM + 860 PM municipal JM (recortado)
  ags_poi.geojson            # 1,467 puntos de interés (OpenStreetMap/Overpass): educación, salud, abasto, bancos, parques, gasolineras
  raw/                       # insumos INEGI, Periódico Oficial y webmaps IMPLAN (no editar)
scripts/
  build_nse.py               # regenera agebs + price_zones desde los insumos
  build_catastral.py         # extrae el Anexo 1 de la Ley de Ingresos y lo cruza con colonias DCAH
  build_pdu.py               # convierte los webmaps ArcGIS de IMPLAN (Ags + Jesús María) a un solo GeoJSON
  build_poi.py               # consulta Overpass API y genera la capa de puntos de interés
  geocode_softec_proyectos.py # geocodifica por nombre los proyectos del panel Vivienda nueva
web/
  index.html, styles.css
  main.js                    # mapa, capas, buscador
  zona.js                    # zona de estudio (Leaflet.Draw + Turf) y comparador
  buffer.js                  # análisis de zona de influencia (buffer por punto + radio)
  buffer-core.js             # núcleo de cálculo del buffer (funciones puras, probadas en tests/)
  proyectos.js               # pines de proyectos de vivienda nueva (superpuesta)
  poi.js                     # puntos de interés (superpuesta, con checkboxes por categoría)
  reporte.js                 # reporte PDF (jsPDF + html2canvas)
tests/
  buffer.test.js             # tests del buffer: ponderación areal, límite municipal, cobertura
```

## Análisis de zona de influencia (botón "Radio")

Dado un punto (clic en el mapa o lat/lng manual) y un radio de 1/2/3/5 km
(default 3), la app dibuja el buffer circular, resalta las AGEBs
intersectadas y agrega todo lo que cae dentro, integrado al panel "Zona de
estudio":

- **Demográficos (Censo 2020)** por *interpolación areal*: cada AGEB
  parcialmente contenida aporta sus variables ponderadas por la fracción de
  su área dentro del círculo, **asumiendo distribución uniforme** dentro del
  AGEB. Población, viviendas habitadas, escolaridad (ponderada por
  población), % internet/computadora/automóvil/servicios completos,
  ocupantes por cuarto, % 2+ recámaras y % 3+ cuartos (ponderados por
  viviendas).
- **Distribución NSE** (% de población por nivel, proxy propio — no AMAI) y
  **% del área sin AGEB 2020** (fraccionamientos nuevos / rural), con
  advertencia visible cuando supera 25% porque los agregados subestiman.
- **Contexto inmobiliario**: colonias catastrales que intersectan
  (tabla + min/mediana/max $/m²), usos de suelo PDU (% del área por grupo,
  indicando programa de origen), proyectos de vivienda nueva con distancia
  al punto y conteo de POIs por categoría.
- **Salidas**: exportación CSV (una fila por métrica: nombre, valor, unidad,
  fuente, método) y sección completa en el reporte PDF con las mismas
  advertencias metodológicas.

Los resultados se cachean por (punto, radio). El cálculo corre 100% en el
navegador con el mismo turf.js del CDN. Los tests (`npm install && npm test`,
solo devDependencies) cubren la ponderación areal, un buffer que cruza el
límite municipal Aguascalientes/Jesús María y el % de cobertura sin AGEB.

## Fuentes de datos

| Dato | Fuente | Archivo |
|---|---|---|
| Polígonos AGEB urbana | INEGI, Marco Geoestadístico Censo 2020 ([ficha 889463807469](https://www.inegi.org.mx/app/biblioteca/ficha.html?upc=889463807469)) | `data/raw/mg/conjunto_de_datos/01a.shp` |
| Variables censales | INEGI, Censo 2020 — resultados por AGEB y manzana urbana ([datos abiertos](https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos)) | `data/raw/iter/.../conjunto_de_datos_ageb_urbana_01_cpv2020.csv` |
| Precios $/m² | Investigación de mercado jul 2026: SHF (Índice de Precios de la Vivienda 4T2025/1T2025), Líder Empresarial, DataSpot, Vid Casa, Muvia, Canterra | codificado en `scripts/build_nse.py` |
| Valores catastrales | Ley de Ingresos del Municipio de Aguascalientes 2026, Anexo 1 (Decreto 377, Periódico Oficial 26-dic-2025) | `data/raw/ley_ingresos_ags_2026.pdf` |
| Polígonos de colonias | INEGI, Delimitación de Colonias y otros Asentamientos Humanos (DCAH, nov-2023) | `data/raw/dcah/conjunto_de_datos/01as.shp` |
| Zonificación PDU Ags | IMPLAN Aguascalientes, PDUCA 2040 ev.2 — webmap ArcGIS Online del [visor público](https://www.arcgis.com/apps/View/index.html?appid=fdd1339456bb4d3889a11916cedb9831) (item `66d60c4f75b44365ae55f6656400da93`) | `data/raw/pduca_webmap.json` |
| Zonificación PDU ciudad Jesús María | Programa de Desarrollo Urbano de la Ciudad de Jesús María 2015-2035 — webmap ArcGIS Online del [visor público](https://www.arcgis.com/apps/View/index.html?appid=38199e163ac24c5d9cef8b65f1a7b406) (item `87779e642ad54f1cbceab3fdc1cfc281`, dueño `VISORWEBSEGUOT`) | `data/raw/pduca_jm_webmap.json` |
| Zonificación PDU municipal Jesús María | Programa Municipal de Desarrollo Urbano de Jesús María 2017-2040 (item `d536f0cad8aa441bb8e255338e2ea717`, mismo dueño). Cubre todo el municipio; se recorta contra el plan de la ciudad para no traslapar. | `data/raw/pdu_jm_municipal_webmap.json` |
| Recámaras / cuartos | Censo 2020 (mismo ITER de arriba): `VPH_2YMASD`, `VPH_3YMASC` | mismo CSV |
| Puntos de interés | OpenStreetMap contributors, vía [Overpass API](https://overpass-api.de/api/interpreter) (dato abierto ODbL) | generado por `scripts/build_poi.py`, no se guarda insumo crudo |

URLs de descarga directa usadas:

- `https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/geografia/marcogeo/889463807469/01_aguascalientes.zip`
- `https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/ageb_manzana/ageb_mza_urbana_01_cpv2020_csv.zip`
- `https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/geografia/delimitaciones/794551132180/01_aguascalientes.zip` (colonias DCAH)
- `https://eservicios2.aguascalientes.gob.mx/PeriodicoOficial/Archivos/10669.pdf` (Ley de Ingresos Mpio. Ags. 2026, 4ª sección del 26-dic-2025)

## Capa de valor catastral (cómo se construye)

`scripts/build_catastral.py`:

1. Extrae con PyMuPDF el **Anexo 1** del PDF (pp. 103–225): ~1,720 renglones
   únicos de "COLONIA O FRACCIONAMIENTO → $X/m²" organizados en 34 sectores
   catastrales. Se corrigen artefactos de fuente (`Ð`→`Ñ`) y se descartan
   renglones "sin delimitación oficial" y valores rústicos < $100/m².
2. Cruza cada polígono de colonias INEGI-DCAH (1,020 en el municipio) contra
   la tabla por nombre normalizado, en cascada: match exacto (tipo + nombre) →
   nombre base → canonizado (ordinales I/PRIMERA/1RA → 1) → sin sufijo de
   sección/etapa → slug sin conectivos → fuzzy (umbral 0.88). Si una colonia
   aparece en varios sectores, se promedia.
3. Resultado: **611 colonias con valor en la capital** (~87% de los
   asentamientos con nombre; el resto de polígonos DCAH son parques,
   equipamiento o condominios nuevos sin renglón en la ley). Los no cruzados
   se omiten (huecos grises), no se imputan.

**Jesús María:** su Ley de Ingresos 2026 (Novena Sección del mismo Periódico
Oficial, `https://eservicios2.aguascalientes.gob.mx/PeriodicoOficial/Archivos/10674.pdf`)
NO publica tabla de suelo por colonia: el Anexo 2 son *mapas* de zona por
localidad. Los planos originales en alta resolución están en el
[portal de transparencia municipal](http://transparencia.jesusmaria.gob.mx/?url=%27Transparencia%20Proactiva/Mapas%20de%20Zona%20Con%20Valor%20de%20Suelo%202026%27)
(descargados en `data/raw/jma_mapas/`). Las tablas de los 18 planos se
transcribieron manualmente a `data/raw/valores_catastrales_jma_2026.csv`
(~340 renglones) y se cruzan con el mismo pipeline → **172 colonias con valor**
en Jesús María. Si una colonia tiene varias zonas de valor, se promedian los
valores urbanos (≥ $100/m²; los valores rústicos de $2–$80/m² se descartan).

**Limitaciones:** el cruce por nombre es automático y puede tener falsos
positivos (revisar `match` en el GeoJSON); el valor catastral es base fiscal,
típicamente inferior al mercado; la ley se renueva cada año (buscar el nuevo
decreto en el Periódico Oficial cada diciembre y actualizar el PDF).

## Metodología del NSE estimado

Índice compuesto por AGEB. Cada variable se normaliza 0–1 (min-max sobre los
373 AGEBs de Aguascalientes + Jesús María) y se combina:

```
score = 0.25·norm(GRAPROES)            escolaridad promedio
      + 0.20·norm(% viv. con internet)  VPH_INTER / TVIVPARHAB
      + 0.15·norm(% viv. con computadora) VPH_PC / TVIVPARHAB
      + 0.15·norm(% viv. con automóvil)   VPH_AUTOM / TVIVPARHAB
      + 0.15·norm(% viv. con todos los servicios) VPH_C_SERV / TVIVPARHAB
      − 0.10·norm(PRO_OCUP_C)           ocupantes por cuarto (hacinamiento)
```

Clasificación por percentiles del score: ≥95 → A/B, 85–95 → C+, 65–85 → C,
45–65 → C-, 25–45 → D+, 10–25 → D, <10 → E. Los valores confidenciales de
INEGI (`*`, `N/D`) se imputan al punto medio (0.5) de la variable normalizada.

**Limitaciones:** es un proxy propio, no la regla AMAI (que usa variables del
hogar, no agregados por AGEB); los cortes por percentil fuerzan una
distribución relativa *dentro del municipio*; los datos censales son de 2020.

## Zonas de precio ($/m²)

No existe catastro público por AGEB. Cada AGEB se asigna a una de 6 zonas por
el rumbo/distancia de su centroide respecto al centro histórico (Plaza de la
Patria), y las zonas se disuelven en polígonos. Rangos (julio 2026):

| Zona | $/m² aprox. | Plusvalía |
|---|---|---|
| Centro | $26,000 – $32,000 | Estable |
| Norte | $23,000 – $29,000 | 6%–8% anual |
| Sur-Poniente | $20,000 – $25,000 | 13.8% acumulada en 12 años |
| Sur | $18,000 – $24,000 | Alta (2026) |
| Poniente | $17,000 – $21,000 | Moderada |
| Oriente | $15,000 – $20,000 | 7%–10% anual |

Promedio general de la ciudad: $18,000–$22,000 MXN/m² residencial; vivienda
promedio ~$1,500,000 MXN.

**Limitaciones:** los polígonos de zona son un trazo aproximado (agregación de
AGEBs, no límites oficiales); los rangos son estimaciones de mercado que
cambian trimestralmente — **volver a verificar las cifras si el proyecto se
retoma más adelante**.

## Regenerar los datos

```bash
python3 -m venv .venv
.venv/bin/pip install geopandas pandas
# descargar y descomprimir los dos zips de INEGI en data/raw/ (ver URLs arriba):
#   data/raw/mg/conjunto_de_datos/01a.shp   y   data/raw/iter/...csv
.venv/bin/python scripts/build_nse.py
```

Para actualizar al próximo censo/marco geoestadístico: cambiar las URLs por la
edición nueva, verificar nombres de columnas contra el descriptor de INEGI y
ajustar los rangos de precio en `PRICE_ZONES` dentro de `scripts/build_nse.py`.

## Geocoding

Usa la API pública de Nominatim acotada a Aguascalientes (`viewbox` +
`bounded=1`), solo al enviar la búsqueda (máx. 1 req/seg), conforme a su
[política de uso](https://operations.osmfoundation.org/policies/nominatim/).
Para uso intensivo o comercial se debe montar un geocoder propio.

## Panel "Vivienda nueva" (Softec DIME)

`web/softec.js` contiene cifras agregadas (precio $/m², absorción, éxito
comercial, inventario) transcritas del estudio **DIME Aguascalientes** de
Softec, Año 37 No. 4392, Febrero 2026 (corte 1T26) — un estudio de mercado
**adquirido por el despacho**, no un dato abierto.

- Es un panel de consulta (modal), no una capa geográfica del mapa: Softec
  no desglosa precio/absorción por zona en este reporte, solo por segmento
  (Social/Económica/Media/Residencial/Residencial Plus), tipo de producto
  (horizontal/vertical) y municipio. Ponerlo como choropleth implicaría
  inventar una distribución espacial que el estudio no da.
- El PDF original vive en `data/raw/softec/` (gitignorado, no se sube ni se
  despliega) — el aviso de derechos del propio estudio prohíbe reproducir
  su contenido/imágenes sin autorización. Solo se transcriben cifras
  agregadas al código, revisadas línea por línea contra el PDF.
- Al actualizar de trimestre: reemplazar el PDF en `data/raw/softec/` y
  editar a mano los objetos `SOFTEC_*` en `web/softec.js` con los nuevos
  valores de las páginas "Resumen de los principales indicadores... del
  mercado Horizontal/Vertical" y "Número de proyectos/unidades por
  municipio".

### Calculadora de accesibilidad

Dentro del mismo panel, una calculadora de crédito hipotecario (`web/softec.js`,
sección `SOFTEC_ACCESIBILIDAD_*` / `amortizar()`). Usa una fórmula estándar de
amortización con tasa/plazo editables — **no** replica la metodología del
estudio (verificado: el estudio no usa una sola combinación tasa/plazo, varía
por segmento). El campo "enganche %" por segmento sí se derivó y verificó
contra los montos reales de enganche de la página 36. La regla "ingreso
requerido = pago mensual ÷ 30%" se confirmó exacta en los 8 segmentos de la
fuente antes de codificarla.

### Proyectos de vivienda nueva (capa "Proyectos")

`web/proyectos.js` — pines de los principales desarrollos mencionados en el
estudio (p.23, "Principales desarrolladores"), con su absorción/inventario
real. De 30 proyectos listados en la fuente, solo 9 se geocodificaron con
confianza razonable vía Nominatim (`scripts/geocode_softec_proyectos.py`);
el resto se omitió — **no se inventan coordenadas**. Cada pin indica si la
ubicación es "exacta" (coincidencia de nombre en OSM) o "aproximada" (calle/
comercio cercano). Es una capa superpuesta (toggle independiente), no
exclusiva como las demás — se ve encima de cualquier capa activa.

## Despliegue en Render

El sitio es 100% estático (HTML/JS/CSS + GeoJSON pre-calculado), no necesita
build ni servidor propio.

1. En [render.com](https://render.com) → **New +** → **Static Site**.
2. Conecta este repositorio.
3. Si Render detecta `render.yaml` (Blueprint), toma la configuración
   automáticamente. Si prefieres configurarlo a mano:
   - **Publish directory**: `.` (raíz del repo, para que `web/` y `data/`
     queden ambos publicados).
   - **Build command**: (vacío).
4. La raíz del repo (`/index.html`) redirige automáticamente a `/web/`, que
   es donde vive la aplicación real.
5. `data/raw/` y `.venv/` están en `.gitignore` — no se despliegan (son
   insumos de build, no hacen falta en producción). Si necesitas regenerar
   los GeoJSON, hazlo localmente con los scripts de `scripts/` y sube los
   archivos `data/*.geojson` resultantes.
