#!/usr/bin/env python3
"""
Genera los datos del mapa de geozonas de Aguascalientes:

  1. data/ags_agebs.geojson       — polígonos AGEB (INEGI MG Censo 2020) con:
                                    - NSE estimado (proxy propio, no AMAI)
                                    - % viviendas deshabitadas
                                    - Densidad de población (hab/km²)
                                    - Crecimiento poblacional 2010–2020
                                      (nivel municipio del ITER 2010 nacional)
  2. data/ags_price_zones.geojson — 6 zonas de precio aproximado ($/m²)

IMPORTANTE: el NSE aquí calculado es un PROXY PROPIO basado en datos abiertos.
NO es el algoritmo oficial de AMAI ni los datos propietarios de Tinsa/RadarMX.
Las zonas de precio son estimaciones de mercado (julio 2026), no valores
catastrales ni avalúos.

Insumos esperados:
  data/raw/mg/conjunto_de_datos/01a.shp
  data/raw/iter/ageb_mza_urbana_01_cpv2020/conjunto_de_datos/
      conjunto_de_datos_ageb_urbana_01_cpv2020.csv
  data/raw/iter_2010/iter_00_cpv2010/conjunto_de_datos/iter_00_cpv2010.csv
      (ITER 2010 nacional — solo se usan totales municipales)

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
ITER_2010_CSV = os.path.join(
    BASE,
    "data/raw/iter_2010/iter_00_cpv2010/conjunto_de_datos/iter_00_cpv2010.csv",
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
        "POBTOT", "VIVTOT", "TVIVPARHAB", "VIVPAR_DES", "VIVPAR_HAB",
        "GRAPROES", "PRO_OCUP_C",
        "VPH_INTER", "VPH_PC", "VPH_AUTOM", "VPH_C_SERV",
        "VPH_2YMASD", "VPH_3YMASC",
        "MUN",
    ]
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # Porcentajes sobre viviendas particulares habitadas
    viv = df["TVIVPARHAB"].replace(0, np.nan)
    df["pct_inter"] = df["VPH_INTER"] / viv
    df["pct_pc"]    = df["VPH_PC"]    / viv
    df["pct_auto"]  = df["VPH_AUTOM"] / viv
    df["pct_serv"]  = df["VPH_C_SERV"] / viv
    df["pct_2dorm"]  = df["VPH_2YMASD"] / viv
    df["pct_3cuart"] = df["VPH_3YMASC"] / viv

    # --- Viviendas deshabitadas ---
    # VIVPAR_DES / TVIVPAR: deshabitadas sobre total de particulares
    # (TVIVPAR = VIVPAR_HAB + VIVPAR_DES + VIVPAR_UT)
    tvivpar = pd.to_numeric(df["TVIVPAR"], errors="coerce").replace(0, np.nan)
    df["pct_deshabitadas"] = (df["VIVPAR_DES"] / tvivpar * 100).round(1)

    return df


# --------------------------------------------------------- crecimiento 2010
def load_mun_pop_2020():
    """Extrae población TOTAL municipal 2020 (fila 'Total del municipio',
    LOC=0000) del mismo ITER_CSV ya usado para el resto del script.

    Ojo: no sirve sumar POBTOT de las AGEBs urbanas de `gdf` para esto — esa
    capa excluye localidades rurales, así que el municipio quedaría
    subestimado frente al total 2010 (sobre todo en Jesús María, que tiene
    población rural real fuera de la mancha urbana).
    """
    df = pd.read_csv(ITER_CSV, dtype=str)
    muns = {int(m) for m in NSE_MUNICIPIOS}
    tot = df[(df["NOM_LOC"] == "Total del municipio") & (df["MUN"].astype(int).isin(muns))]
    return {
        row["MUN"].zfill(3): int(str(row["POBTOT"]).replace(",", ""))
        for _, row in tot.iterrows()
    }


def load_mun_pop_2010():
    """Extrae población total municipal del ITER 2010 (nivel Total del Municipio).
    Retorna dict {cve_mun_str: pobtot_2010}.
    Solo para municipios de Aguascalientes (entidad 01).
    """
    mun_pop = {}
    try:
        # utf-8-sig strips the BOM automatically
        df10 = pd.read_csv(ITER_2010_CSV, dtype=str, encoding="utf-8-sig")
        df10.columns = [c.strip().strip('"') for c in df10.columns]

        ent_col_matches = [c for c in df10.columns if c.lower() == "entidad"]
        if not ent_col_matches:
            raise ValueError(f"Columna 'entidad' no encontrada. Columnas: {list(df10.columns[:10])}")
        ent_col = ent_col_matches[0]

        current_ent = None
        for _, row in df10.iterrows():
            raw_ent = str(row.get(ent_col, "")).strip()
            if raw_ent and raw_ent not in ("", "nan"):
                try:
                    current_ent = str(int(raw_ent)).zfill(2)
                except ValueError:
                    pass
            if current_ent != "01":
                continue
            mun = str(row.get("mun", "")).strip().zfill(3)
            loc = str(row.get("loc", "")).strip().zfill(4)
            if mun != "000" and loc == "0000":
                try:
                    mun_pop[mun] = int(str(row["pobtot"]).replace(",", ""))
                except Exception:
                    pass
    except Exception as e:
        print(f"  Advertencia: no se pudo leer ITER 2010 ({e}). Crecimiento = N/D.")
    return mun_pop


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
            "pct_2dorm", "pct_3cuart", "nse_score", "nse_nivel",
            "pct_deshabitadas", "MUN"]
    gdf = gdf.merge(census[keep], on="CVEGEO", how="left")
    matched = gdf["nse_score"].notna().sum()
    print(f"AGEBs con datos censales: {matched} / {len(gdf)}")
    gdf["nse_nivel"] = gdf["nse_nivel"].fillna("S/D")
    for c in ["pct_inter", "pct_pc", "pct_auto", "pct_serv", "pct_2dorm", "pct_3cuart"]:
        gdf[c] = (gdf[c] * 100).round(1)

    # --- Densidad de población (hab/km²) ---
    # Proyectamos a EPSG:6372 (MTM México, unidades en metros) para áreas reales
    gdf_proj = gdf.to_crs(epsg=6372)
    gdf["densidad_hab_km2"] = (
        gdf["POBTOT"] / (gdf_proj.geometry.area / 1e6)
    ).round(0)

    # --- Crecimiento poblacional 2010–2020 (nivel municipio, municipio
    # completo en ambos años — ver nota en load_mun_pop_2020) ---
    mun_pop_2010 = load_mun_pop_2010()
    mun_pop_2020 = load_mun_pop_2020()
    print("Población municipal 2010:", mun_pop_2010)
    print("Población municipal 2020:", mun_pop_2020)

    crec_map = {}
    for mun, pop2020 in mun_pop_2020.items():
        pop2010 = mun_pop_2010.get(mun)
        if pop2010 and pop2010 > 0:
            crec_map[mun] = round((pop2020 - pop2010) / pop2010 * 100, 1)
    print("Crecimiento municipal 2010-2020:", crec_map)

    gdf["crec_mun_2010_2020"] = gdf["CVE_MUN"].map(crec_map)

    zones = build_price_zones(gdf)

    cols = ["CVEGEO", "CVE_AGEB", "municipio", "zona",
            "POBTOT", "TVIVPARHAB",
            "GRAPROES", "PRO_OCUP_C", "pct_inter", "pct_pc", "pct_auto",
            "pct_serv", "pct_2dorm", "pct_3cuart",
            "nse_score", "nse_nivel",
            "pct_deshabitadas", "densidad_hab_km2", "crec_mun_2010_2020",
            "geometry"]
    gdf[cols].to_file(OUT_AGEBS, driver="GeoJSON")
    zones.to_file(OUT_ZONES, driver="GeoJSON")
    print(f"Escrito {OUT_AGEBS} ({os.path.getsize(OUT_AGEBS)//1024} KB)")
    print(f"Escrito {OUT_ZONES} ({os.path.getsize(OUT_ZONES)//1024} KB)")
    print("\nDistribución NSE:")
    print(gdf["nse_nivel"].value_counts().to_string())
    print("\nAGEBs por zona de precio:")
    print(gdf["zona"].value_counts().to_string())
    print("\nEstadísticas densidad (hab/km²):")
    print(gdf["densidad_hab_km2"].describe().to_string())
    print("\nEstadísticas viviendas deshabitadas (%):")
    print(gdf["pct_deshabitadas"].describe().to_string())


if __name__ == "__main__":
    main()
