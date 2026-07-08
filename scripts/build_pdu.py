#!/usr/bin/env python3
"""
Genera data/ags_pdu.geojson: zonificación secundaria del Programa de
Desarrollo Urbano de la Ciudad de Aguascalientes 2040 (PDUCA 2040, ev. 2),
publicada por IMPLAN Aguascalientes en su visor ArcGIS Online.

Insumo: data/raw/pduca_webmap.json — webmap de ArcGIS Online (item
66d60c4f75b44365ae55f6656400da93, referenciado por el visor público de
IMPLAN). Los polígonos vienen embebidos como featureCollection en Web
Mercator (EPSG:3857).

Se combinan dos planos oficiales:
  - MP37 "Zonificación secundaria" (toda la ciudad), y
  - MP36 "Zonificación secundaria para zona urbana a consolidar y densificar",
    que subdivide el gran polígono central de MP37.

Uso:  python scripts/build_pdu.py
"""

import json
import os
import re

import geopandas as gpd
from arcgis2geojson import arcgis2geojson
from shapely.geometry import shape

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBMAP = os.path.join(BASE, "data/raw/pduca_webmap.json")
OUT = os.path.join(BASE, "data/ags_pdu.geojson")

LAYER_DETAIL = "PDUCA 2040 ev2 : Zonificación secundaria para zona urbana a consolidar y densificar"
LAYER_GENERAL = "PDUCA 2040 ev2 : Zonificación secundaria"
# el polígono de MP37 que MP36 subdivide (se excluye para no duplicar)
GENERAL_SKIP = "ZONA URBANA A CONSOLIDAR Y DENSIFICAR"

# Agrupación de las categorías oficiales en grupos para la leyenda.
# El texto oficial completo se conserva en la propiedad `uso`.
GRUPOS = [
    (r"POPULAR|MEDIO|RESIDENCIAL|CONDOMINIO|DENSIDAD|REGULARIZACION|REGULARIZACIÓN", "Habitacional"),
    (r"MIXTO", "Mixto"),
    (r"COMERCIO|COMERCIAL", "Comercial / Servicios"),
    (r"INDUSTRIAL", "Industrial"),
    (r"CONSERVACI|PRESERVACI|ECOL", "Conservación / Ecológico"),
    (r"CRECIMIENTO", "Crecimiento futuro"),
    (r"ESPECIAL", "Especial"),
]


def grupo(uso):
    for pat, g in GRUPOS:
        if re.search(pat, uso.upper()):
            return g
    return "Otro"


def layer_features(webmap, title, field, skip=None):
    layer = next(l for l in webmap["operationalLayers"] if l["title"] == title)
    feats = []
    for sub in layer["featureCollection"]["layers"]:
        for f in sub["featureSet"]["features"]:
            uso = (f["attributes"].get(field) or "").strip()
            if not uso or (skip and uso.upper().startswith(skip)):
                continue
            geom = shape(arcgis2geojson(f["geometry"]))
            feats.append({
                "uso": uso,
                "grupo": grupo(uso),
                "hectareas": round(f["attributes"].get("HECTÁREAS", 0), 1),
                "plano": field,
                "geometry": geom,
            })
    return feats


def main():
    webmap = json.load(open(WEBMAP))
    feats = layer_features(webmap, LAYER_GENERAL, "Z2_MP37", skip=GENERAL_SKIP)
    feats += layer_features(webmap, LAYER_DETAIL, "Z2_MP36")

    gdf = gpd.GeoDataFrame(feats, geometry="geometry", crs="EPSG:3857")
    # sanear auto-intersecciones y simplificar (~5 m) para aligerar el archivo
    gdf["geometry"] = gdf.geometry.buffer(0).simplify(5, preserve_topology=True)
    gdf = gdf.to_crs(epsg=4326)
    gdf.to_file(OUT, driver="GeoJSON")
    print(f"Escrito {OUT} ({os.path.getsize(OUT)//1024} KB), {len(gdf)} polígonos")
    print(gdf.groupby("grupo")["hectareas"].agg(["count", "sum"]).round(0).to_string())


if __name__ == "__main__":
    main()
