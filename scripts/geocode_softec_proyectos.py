#!/usr/bin/env python3
"""Geocodifica los proyectos de vivienda nueva listados en el estudio Softec
DIME (pag. 23, "Principales desarrolladores") vía Nominatim, respetando 1
req/seg. Solo conserva resultados con especificidad razonable (no el
centroide de toda la ciudad/estado) y dentro del área metropolitana.
"""
import json, time, urllib.request, urllib.parse

UA = "radar-inmobiliario-ags-research/1.0 (uso interno, geocoding puntual)"
BBOX = "-102.42,21.75,-102.15,21.98"  # lonMin,latMin,lonMax,latMax amplio AGS+JM

PROYECTOS = [
    ("Paseos del Sur CD", "horizontal", 500, 2400, 27.8),
    ("Paseos del Sur", "horizontal", 861, 2039, 25.3),
    ("Villas de Montecasino", "horizontal", 130, 320, 12.8),
    ("La Nueva Estancia", "horizontal", 130, 370, 12.1),
    ("Real del Sol", "horizontal", 83, 297, 10.8),
    ("Castelo San Francisco", "horizontal", 18, 323, 10.0),
    ("Villas de Montecasino Circuito Benedicto Sur", "horizontal", 4, 196, 7.4),
    ("Vista Serena", "horizontal", 18, 82, 7.3),
    ("Landa Residencial Cotos Alondras Golondrinas", "horizontal", 505, 68, 6.5),
    ("Vista Serena CS", "horizontal", 4, 96, 6.0),
    ("Gran Reserva Los Angeles", "horizontal", 500, 150, 6.0),
    ("Viñedos Ribier", "horizontal", 30, 153, 4.4),
    ("Xaramá Residencial", "horizontal", 80, 320, 4.4),
    ("Ferrara Residencial Gaibana", "horizontal", 204, 141, 4.2),
    ("Reserva San Matías Residencial", "horizontal", 49, 79, 4.0),
    ("Torres Villa Canto", "vertical", 5, 85, 6.7),
    ("Diana Tower Aguascalientes", "vertical", 8, 35, 2.4),
    ("VilaNova Residencial Rancho Santa Monica Aguascalientes", "vertical", 8, 64, 2.1),
    ("Punto Portia Aguascalientes", "vertical", 90, 60, 1.9),
    ("Torre Cadaques Aguascalientes", "vertical", 81, 50, 1.4),
    ("Distrito Kaure Aguascalientes", "vertical", 6, 35, 1.0),
    ("San Javier 240 Aguascalientes", "vertical", 13, 19, 1.0),
    ("Montecristo Torre Bosco Aguascalientes", "vertical", 20, 20, 0.9),
    ("Torre Elite Aguascalientes", "vertical", 10, 19, 0.9),
    ("Aunna Aguascalientes", "vertical", 42, 28, 0.8),
    ("Torre Mezquite Aguascalientes", "vertical", 1, 11, 0.7),
    ("SoHma Urban Living Aguascalientes", "vertical", 76, 8, 0.7),
    ("Garza Sada 128 Aguascalientes", "vertical", 2, 28, 0.7),
    ("Torre Universidad Residencial Aguascalientes", "vertical", 11, 16, 0.7),
    ("Tremezzo Departamentos Aguascalientes", "vertical", 24, 24, 0.7),
]


def geocode(name):
    q = urllib.parse.urlencode({
        "q": name if "Aguascalientes" in name else f"{name}, Aguascalientes, Mexico",
        "format": "json", "viewbox": BBOX, "bounded": 1, "limit": 3,
    })
    req = urllib.request.Request(f"https://nominatim.openstreetmap.org/search?{q}",
                                  headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


results = []
for nombre, tipo, inv, vend, absorcion in PROYECTOS:
    try:
        hits = geocode(nombre)
    except Exception as e:
        hits = []
        print(f"ERROR {nombre}: {e}")
    best = hits[0] if hits else None
    results.append({
        "nombre": nombre, "tipo": tipo, "inventario": inv, "vendidas": vend,
        "absorcion": absorcion,
        "geocode_class": best.get("class") if best else None,
        "geocode_type": best.get("type") if best else None,
        "geocode_display": best.get("display_name") if best else None,
        "lat": float(best["lat"]) if best else None,
        "lon": float(best["lon"]) if best else None,
        "importance": best.get("importance") if best else None,
    })
    print(f"{'OK ' if best else 'SIN'} {nombre[:45]:45s} -> {best.get('display_name','')[:70] if best else ''}")
    time.sleep(1.1)

with open("/Users/earvinzuniga/mapa/data/raw/softec_proyectos_geocoded.json", "w") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("\nEscrito data/raw/softec_proyectos_geocoded.json")
