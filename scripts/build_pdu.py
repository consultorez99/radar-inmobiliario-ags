#!/usr/bin/env python3
"""
Genera data/ags_pdu.json: zonificación secundaria de los Programas de
Desarrollo Urbano de Aguascalientes y Jesús María, publicados por SEGUOT /
IMPLAN Aguascalientes en sus visores ArcGIS Online.

Insumos (webmaps de ArcGIS Online con los polígonos embebidos como
featureCollection en Web Mercator EPSG:3857):
  - data/raw/pduca_webmap.json          — PDUCA 2040 ev.2 (Aguascalientes),
    item 66d60c4f75b44365ae55f6656400da93. Combina dos planos oficiales:
    MP37 "Zonificación secundaria" (toda la ciudad) y MP36 "...para zona
    urbana a consolidar y densificar" (subdivide el polígono central de MP37).
  - data/raw/pduca_jm_webmap.json       — Programa de Desarrollo Urbano de
    la CIUDAD de Jesús María 2015-2035 ("JM3"), item
    87779e642ad54f1cbceab3fdc1cfc281. Un solo plano de zonificación
    secundaria (capa "..._ZS"), cubre solo la mancha urbana central.
  - data/raw/pdu_jm_municipal_webmap.json — Programa MUNICIPAL de Desarrollo
    Urbano de Jesús María 2017-2040 ("JM1"), item
    d536f0cad8aa441bb8e255338e2ea717. Cubre todo el territorio municipal
    (1,253 polígonos) — mucho más amplio que JM3 pero menos detallado en
    la zona urbana. Se recorta para excluir el área que JM3 ya cubre con
    más detalle (evita traslape/doble clasificación de un mismo predio) y
    así solo aporta las localidades fuera de la ciudad (Margaritas,
    Maravillas, Colonia Nueva, Paseos de Aguascalientes, etc.).

Uso:  python scripts/build_pdu.py
"""

import json
import os
import re

import geopandas as gpd
from arcgis2geojson import arcgis2geojson
from shapely.geometry import shape
from shapely.ops import unary_union

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data/ags_pdu.json")

AGS_WEBMAP = os.path.join(BASE, "data/raw/pduca_webmap.json")
AGS_LAYER_DETAIL = "PDUCA 2040 ev2 : Zonificación secundaria para zona urbana a consolidar y densificar"
AGS_LAYER_GENERAL = "PDUCA 2040 ev2 : Zonificación secundaria"
# el polígono de MP37 que MP36 subdivide (se excluye para no duplicar)
AGS_GENERAL_SKIP = "ZONA URBANA A CONSOLIDAR Y DENSIFICAR"

JM_WEBMAP = os.path.join(BASE, "data/raw/pduca_jm_webmap.json")
JM_LAYER = "PCP_JM3_Jesús María_2015-2035_ZS"

JM_MUN_WEBMAP = os.path.join(BASE, "data/raw/pdu_jm_municipal_webmap.json")
JM_MUN_LAYER = "PM_JM1_2017-2040_Zonificación"

# Agrupación de las categorías oficiales (de ambos municipios y sus varios
# programas) en grupos para la leyenda. El texto oficial completo se
# conserva en la propiedad `uso`. Incluye variantes/erratas tal cual
# aparecen en la fuente (p.ej. "Cosolidación", "Ecoturístico").
GRUPOS = [
    (r"POPULAR|MEDIO|RESIDENCIAL|CONDOMINIO|DENSIDAD|REGULARIZACION|REGULARIZACIÓN|CONSOLIDACION|CONSOLIDACIÓN|COSOLIDACION|COSOLIDACIÓN", "Habitacional"),
    (r"MIXTO|MICROINDUSTRIAL|CORREDOR ESTRATEGICO|CORREDOR ESTRATÉGICO", "Mixto"),
    (r"COMERCIO|COMERCIAL", "Comercial / Servicios"),
    (r"AGROPECUARIO|AGRICOLA|AGRÍCOLA", "Agropecuario"),
    (r"INDUSTRIA", "Industrial"),
    (r"CONSERVACI|PRESERVACI|ECOL|ECOTUR|FORESTAL|REGENERACION|REGENERACIÓN", "Conservación / Ecológico"),
    (r"CRECIMIENTO|EXPANSION|EXPANSIÓN", "Crecimiento futuro"),
    (r"RIESGO|ESPECIAL", "Especial"),
]


def grupo(uso):
    for pat, g in GRUPOS:
        if re.search(pat, uso.upper()):
            return g
    return "Otro"


def ags_features(webmap):
    def layer_feats(title, field, skip=None):
        layer = next(l for l in webmap["operationalLayers"] if l["title"] == title)
        feats = []
        for sub in layer["featureCollection"]["layers"]:
            for f in sub["featureSet"]["features"]:
                uso = (f["attributes"].get(field) or "").strip()
                if not uso or (skip and uso.upper().startswith(skip)):
                    continue
                geom = shape(arcgis2geojson(f["geometry"]))
                feats.append({
                    "municipio": "Aguascalientes",
                    "programa": "PDUCA 2040 ev.2",
                    "uso": uso,
                    "grupo": grupo(uso),
                    "hectareas": round(f["attributes"].get("HECTÁREAS", 0), 1),
                    "plano": field,
                    "geometry": geom,
                })
        return feats

    feats = layer_feats(AGS_LAYER_GENERAL, "Z2_MP37", skip=AGS_GENERAL_SKIP)
    feats += layer_feats(AGS_LAYER_DETAIL, "Z2_MP36")
    return feats


def jm_features(webmap):
    layer = next(l for l in webmap["operationalLayers"] if l["title"] == JM_LAYER)
    feats = []
    for sub in layer["featureCollection"]["layers"]:
        for f in sub["featureSet"]["features"]:
            uso = (f["attributes"].get("Zoni_Sec") or "").strip()
            if not uso:
                continue
            geom = shape(arcgis2geojson(f["geometry"]))
            feats.append({
                "municipio": "Jesús María",
                "programa": "PDU Jesús María 2015-2035",
                "uso": uso,
                "grupo": grupo(uso),
                "hectareas": round(f["attributes"].get("Ha", 0), 1),
                "plano": f["attributes"].get("CLAVE", ""),
                "geometry": geom,
            })
    return feats


def jm_municipal_features(webmap, ciudad_union):
    """Zonificación del programa MUNICIPAL de Jesús María (JM1), recortada
    para excluir el área que el plan de la ciudad (JM3) ya cubre en detalle.
    """
    layer = next(l for l in webmap["operationalLayers"] if l["title"] == JM_MUN_LAYER)
    feats = []
    for sub in layer["featureCollection"]["layers"]:
        for f in sub["featureSet"]["features"]:
            uso = (f["attributes"].get("Zonificaci") or "").strip()
            if not uso:
                continue
            geom = shape(arcgis2geojson(f["geometry"]))
            if not geom.is_valid:
                geom = geom.buffer(0)
            resto = geom.difference(ciudad_union)
            if resto.is_empty or resto.area < 1:
                continue
            feats.append({
                "municipio": "Jesús María",
                "programa": "PM Jesús María 2017-2040 (municipal)",
                "uso": uso,
                "grupo": grupo(uso),
                "hectareas": round(f["attributes"].get("Hectáreas", 0), 1),
                "plano": f["attributes"].get("ID", ""),
                "geometry": resto,
            })
    return feats


def main():
    feats = ags_features(json.load(open(AGS_WEBMAP)))
    jm_city = jm_features(json.load(open(JM_WEBMAP)))
    feats += jm_city

    jm_city_union = unary_union([f["geometry"] for f in jm_city])
    feats += jm_municipal_features(json.load(open(JM_MUN_WEBMAP)), jm_city_union)

    gdf = gpd.GeoDataFrame(feats, geometry="geometry", crs="EPSG:3857")
    # sanear auto-intersecciones y simplificar (~5 m) para aligerar el archivo
    gdf["geometry"] = gdf.geometry.buffer(0).simplify(5, preserve_topology=True)
    gdf = gdf.to_crs(epsg=4326)
    gdf.to_file(OUT, driver="GeoJSON")
    print(f"Escrito {OUT} ({os.path.getsize(OUT)//1024} KB), {len(gdf)} polígonos")
    print(gdf.groupby(["municipio", "programa"])["hectareas"].agg(["count", "sum"]).round(0).to_string())
    print()
    print(gdf.groupby("grupo")["hectareas"].agg(["count", "sum"]).round(0).to_string())


if __name__ == "__main__":
    main()
