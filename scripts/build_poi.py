#!/usr/bin/env python3
"""
Genera data/ags_poi.json: puntos de interés (escuelas, salud, abasto,
bancos, parques, gasolineras) de OpenStreetMap vía Overpass API, para el
área de Aguascalientes + Jesús María + San Francisco de los Romo.

Dato abierto (ODbL) — a diferencia del estudio Softec, esta capa sí se
puede regenerar libremente sin restricciones de licencia.

Uso:  python scripts/build_poi.py
"""

import json
import os
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data/ags_poi.json")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
UA = "radar-inmobiliario-ags/1.0 (uso interno, capa POI)"
# sur,oeste,norte,este — cubre Aguascalientes, Jesús María, San Francisco de los Romo
BBOX = "21.75,-102.42,21.98,-102.15"

# categoria -> [(clave, valor), ...] de OSM; primer match gana
CATEGORIAS = {
    "Educación": [("amenity", "school"), ("amenity", "university"), ("amenity", "college")],
    "Salud": [("amenity", "hospital"), ("amenity", "clinic"), ("amenity", "pharmacy")],
    "Abasto": [("shop", "supermarket"), ("shop", "mall")],
    "Bancos": [("amenity", "bank")],
    "Parques": [("leisure", "park")],
    "Gasolineras": [("amenity", "fuel")],
}


def build_query():
    filtros = []
    for pares in CATEGORIAS.values():
        for k, v in pares:
            filtros.append(f'node["{k}"="{v}"]({BBOX});')
            filtros.append(f'way["{k}"="{v}"]({BBOX});')
    return f"[out:json][timeout:90];\n(\n  " + "\n  ".join(filtros) + "\n);\nout center;"


def categoria_de(tags):
    for cat, pares in CATEGORIAS.items():
        for k, v in pares:
            if tags.get(k) == v:
                return cat, k, v
    return None, None, None


def main():
    query = build_query()
    req = urllib.request.Request(
        OVERPASS_URL, data=query.encode("utf-8"),
        headers={"Content-Type": "text/plain", "User-Agent": UA})
    print("Consultando Overpass API...")
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)

    feats = []
    vistos = set()
    for el in data["elements"]:
        tags = el.get("tags", {})
        nombre = tags.get("name", "")
        cat, k, v = categoria_de(tags)
        if not cat:
            continue
        if el["type"] == "node":
            lon, lat = el["lon"], el["lat"]
        else:
            c = el.get("center")
            if not c:
                continue
            lon, lat = c["lon"], c["lat"]
        key = (round(lat, 5), round(lon, 5), cat)
        if key in vistos:
            continue
        vistos.add(key)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "categoria": cat, "tipo_osm": f"{k}={v}",
                "nombre": nombre or f"{cat} sin nombre",
            },
        })

    gj = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w") as f:
        json.dump(gj, f, ensure_ascii=False)
    print(f"Escrito {OUT} ({os.path.getsize(OUT)//1024} KB), {len(feats)} puntos")
    from collections import Counter
    print(Counter(f["properties"]["categoria"] for f in feats).most_common())


if __name__ == "__main__":
    main()
