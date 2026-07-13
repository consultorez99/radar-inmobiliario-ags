#!/usr/bin/env python3
"""
Genera los datos del mapa de geozonas de Aguascalientes:

  1. data/ags_agebs.geojson       — polígonos AGEB (INEGI MG Censo 2020) con un
                                    NSE ESTIMADO calculado a partir de variables
                                    del Censo 2020 (ITER por AGEB urbana).
  2. data/ags_price_zones.geojson — 6 zonas de precio aproximado ($/m²) obtenidas
                                    agrupando AGEBs por cuadrante geográfico
                                    respecto al centro histórico.

IMPORTANTE: el NSE aquí calculado es un PROXY PROPIO basado en datos abiertos.
NO es el algoritmo oficial de AMAI ni los datos propietarios de Tinsa/RadarMX.
Las zonas de precio son estimaciones de mercado (julio 2026), no valores
catastrales ni avalúos.

Insumos esperados (ver README.md para URLs de descarga):
  data/raw/mg/conjunto_de_datos/01a.shp
      Marco Geoestadístico Censo 2020, capa AGEB urbana, estado 01.
  data/raw/iter/ageb_mza_urbana_01_cpv2020/conjunto_de_datos/
      conjunto_de_datos_ageb_urbana_01_cpv2020.csv
      Censo 2020, resultados por AGEB y manzana urbana, estado 01.

Uso:  python scripts/build_nse.py
"""

import math
import os

import geopandas as gpd
import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = os.path.join(BASE, "data/raw/mg/conjunto_de_datos/01a.shp")
ITER_CSV = os.path.join(
    BASE,
    "data/raw/iter/ageb_mza_urbana_01_cpv2020/conjunto_de_datos/"
    "conjunto_de_datos_ageb_urbana_01_cpv2020.csv",
)
OUT_AGEBS = os.path.join(BASE, "data/ags_agebs.geojson")
OUT_ZONES = os.path.join(BASE, "data/ags_price_zones.geojson")

# Centro histórico de Aguascalientes (Plaza de la Patria, aprox.)
CENTER_LON, CENTER_LAT = -102.2958, 21.8794

# Municipios incluidos en la capa NSE. Las zonas de precio solo aplican a la
# ciudad de Aguascalientes (001): la investigación de mercado no cubre 005.
NSE_MUNICIPIOS = {"001": "Aguascalientes", "005": "Jesús María"}
PRICE_MUNICIPIO = "001"


# ---------------------------------------------------------------- geometría
def load_agebs():
    gdf = gpd.read_file(SHP)
    gdf = gdf[(gdf["CVE_ENT"] == "01") & (gdf["CVE_MUN"].isin(NSE_MUNICIPIOS))].copy()
    gdf["municipio"] = gdf["CVE_MUN"].map(NSE_MUNICIPIOS)
    gdf = gdf.to_crs(epsg=4326)
    return gdf


# ------------------------------------------------------------------- censo
def load_census():
    df = pd.read_csv(ITER_CSV, dtype=str)
    # Nivel AGEB (no manzana, no totales de localidad/municipio)
    muns = {int(m) for m in NSE_MUNICIPIOS}
    df = df[(df["NOM_LOC"] == "Total AGEB urbana") & (df["MUN"].astype(int).isin(muns))].copy()
    df["CVEGEO"] = (
        df["ENTIDAD"].str.zfill(2)
        + df["MUN"].str.zfill(3)
        + df["LOC"].str.zfill(4)
        + df["AGEB"].str.zfill(4)
    )

    # INEGI usa "*" (dato confidencial) y "N/D" — se convierten a NaN
    num_cols = [
        "POBTOT", "VIVTOT", "TVIVPARHAB", "GRAPROES", "PRO_OCUP_C",
        "VPH_INTER", "VPH_PC", "VPH_AUTOM", "VPH_C_SERV",
        "VPH_2YMASD", "VPH_3YMASC",  # 2+ recámaras / 3+ cuartos
    ]
    for c in num_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # Porcentajes sobre viviendas particulares habitadas
    viv = df["TVIVPARHAB"].replace(0, np.nan)
    df["pct_inter"] = df["VPH_INTER"] / viv
    df["pct_pc"] = df["VPH_PC"] / viv
    df["pct_auto"] = df["VPH_AUTOM"] / viv
    df["pct_serv"] = df["VPH_C_SERV"] / viv
    # capas "Recámaras" y "Tamaño de vivienda" (proxy censal de sup. construida)
    df["pct_2dorm"] = df["VPH_2YMASD"] / viv
    df["pct_3cuart"] = df["VPH_3YMASC"] / viv
    return df


def minmax(s):
    lo, hi = s.min(), s.max()
    if hi == lo:
        return pd.Series(0.5, index=s.index)
    return (s - lo) / (hi - lo)


# NSE estimado: índice compuesto (proxy propio, NO metodología AMAI)
WEIGHTS = {
    "GRAPROES": 0.25,   # grado promedio de escolaridad
    "pct_inter": 0.20,  # % viviendas con internet
    "pct_pc": 0.15,     # % viviendas con computadora
    "pct_auto": 0.15,   # % viviendas con automóvil
    "pct_serv": 0.15,   # % viviendas con todos los servicios
    "PRO_OCUP_C": -0.10,  # hacinamiento (resta)
}

# Clasificación por percentiles de la distribución del score
# (de mayor a menor nivel socioeconómico)
NSE_LEVELS = [
    ("A/B", 95),
    ("C+", 85),
    ("C", 65),
    ("C-", 45),
    ("D+", 25),
    ("D", 10),
    ("E", 0),
]


def compute_nse(df):
    score = pd.Series(0.0, index=df.index)
    for col, w in WEIGHTS.items():
        score = score + w * minmax(df[col]).fillna(0.5)
    df["nse_score"] = minmax(score).round(4)

    pct_rank = df["nse_score"].rank(pct=True) * 100
    def classify(p):
        for level, cutoff in NSE_LEVELS:
            if p >= cutoff:
                return level
        return "E"
    df["nse_nivel"] = pct_rank.apply(classify)
    return df


# ------------------------------------------------------------ zonas precio
# Estimaciones de mercado, julio 2026 (SHF, Líder Empresarial, DataSpot,
# Vid Casa, Muvia, Canterra). Ver README.md. NO son valores catastrales.
PRICE_ZONES = {
    "Centro": {
        "precio_m2_min": 26000, "precio_m2_max": 32000,
        "plusvalia": "Estable",
        "nota": "Zona histórica/comercial, oferta limitada",
    },
    "Norte": {
        "precio_m2_min": 23000, "precio_m2_max": 29000,
        "plusvalia": "6%–8% anual",
        "nota": "Mercado maduro y consolidado (Jardines de la Asunción, Bosques del Prado)",
    },
    "Poniente": {
        "precio_m2_min": 17000, "precio_m2_max": 21000,
        "plusvalia": "Moderada",
        "nota": "Mercado consolidado, oferta mixta",
    },
    "Oriente": {
        "precio_m2_min": 15000, "precio_m2_max": 20000,
        "plusvalia": "7%–10% anual",
        "nota": "Impulsado por parques industriales",
    },
    "Sur": {
        "precio_m2_min": 18000, "precio_m2_max": 24000,
        "plusvalia": "Alta (dinamismo residencial/industrial 2026)",
        "nota": "Mayor dinamismo residencial/industrial 2026",
    },
    "Sur-Poniente": {
        "precio_m2_min": 20000, "precio_m2_max": 25000,
        "plusvalia": "13.8% acumulada en 12 años",
        "nota": "Mayor demanda y plusvalía más consistente",
    },
}


def assign_zone(lon, lat):
    """Asigna zona por distancia/rumbo del centroide respecto al centro."""
    dx = (lon - CENTER_LON) * math.cos(math.radians(CENTER_LAT)) * 111.32  # km
    dy = (lat - CENTER_LAT) * 110.57  # km
    dist = math.hypot(dx, dy)
    if dist < 1.7:
        return "Centro"
    bearing = (math.degrees(math.atan2(dx, dy)) + 360) % 360  # 0=N, 90=E
    if bearing >= 315 or bearing < 50:
        return "Norte"
    if bearing < 145:
        return "Oriente"
    if bearing < 190:
        return "Sur"
    if bearing < 255:
        return "Sur-Poniente"
    return "Poniente"


def build_price_zones(gdf):
    cent = gdf.geometry.representative_point()
    gdf["zona"] = [assign_zone(p.x, p.y) for p in cent]
    # Jesús María queda fuera de las zonas de precio (sin dato de mercado)
    gdf.loc[gdf["CVE_MUN"] != PRICE_MUNICIPIO, "zona"] = "Jesús María"
    city = gdf[gdf["CVE_MUN"] == PRICE_MUNICIPIO]
    zones = city[["zona", "geometry"]].dissolve(by="zona").reset_index()
    for k, v in PRICE_ZONES.items():
        for prop, val in v.items():
            zones.loc[zones["zona"] == k, prop] = val
    # suavizar huecos entre AGEBs dentro de una misma zona
    zones["geometry"] = zones.geometry.buffer(0.0004).buffer(-0.0004)
    return zones


def main():
    gdf = load_agebs()
    print(f"AGEBs ({' + '.join(NSE_MUNICIPIOS.values())}): {len(gdf)}")
    print(gdf["municipio"].value_counts().to_string())

    census = compute_nse(load_census())
    keep = ["CVEGEO", "POBTOT", "TVIVPARHAB", "GRAPROES", "PRO_OCUP_C",
            "pct_inter", "pct_pc", "pct_auto", "pct_serv",
            "pct_2dorm", "pct_3cuart", "nse_score", "nse_nivel"]
    gdf = gdf.merge(census[keep], on="CVEGEO", how="left")
    matched = gdf["nse_score"].notna().sum()
    print(f"AGEBs con datos censales: {matched} / {len(gdf)}")
    gdf["nse_nivel"] = gdf["nse_nivel"].fillna("S/D")  # sin dato censal
    for c in ["pct_inter", "pct_pc", "pct_auto", "pct_serv", "pct_2dorm", "pct_3cuart"]:
        gdf[c] = (gdf[c] * 100).round(1)

    zones = build_price_zones(gdf)

    cols = ["CVEGEO", "CVE_AGEB", "municipio", "zona", "POBTOT", "TVIVPARHAB",
            "GRAPROES", "PRO_OCUP_C", "pct_inter", "pct_pc", "pct_auto",
            "pct_serv", "pct_2dorm", "pct_3cuart",
            "nse_score", "nse_nivel", "geometry"]
    gdf[cols].to_file(OUT_AGEBS, driver="GeoJSON")
    zones.to_file(OUT_ZONES, driver="GeoJSON")
    print(f"Escrito {OUT_AGEBS} ({os.path.getsize(OUT_AGEBS)//1024} KB)")
    print(f"Escrito {OUT_ZONES} ({os.path.getsize(OUT_ZONES)//1024} KB)")
    print("\nDistribución NSE:")
    print(gdf["nse_nivel"].value_counts().to_string())
    print("\nAGEBs por zona de precio:")
    print(gdf["zona"].value_counts().to_string())


if __name__ == "__main__":
    main()
