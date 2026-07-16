#!/usr/bin/env python3
"""
Genera los datos del mapa de geozonas de Aguascalientes:

  1. data/ags_agebs.json             — polígonos AGEB (INEGI MG Censo 2020) con:
                                          - NSE estimado (proxy propio, no AMAI)
                                          - % viviendas deshabitadas
                                          - Densidad de población (hab/km²)
                                          - Población por sexo, grupos de edad
                                            (0-14/15-24/25-59/60+ — ver nota de
                                            cortes en el docstring de load_census),
                                            discapacidad, vivienda y calidad de
                                            vivienda (piso/electricidad/sanitario/
                                            drenaje)
                                          - Marginación urbana 2020 (CONAPO,
                                            oficial — ver load_conapo_marginacion)
  2. data/ags_price_zones.json       — 6 zonas de precio aproximado ($/m²)
  3. data/ags_poblacion_proyeccion.json — serie de población por municipio
                                          1990-2040 (CONAPO, histórico +
                                          proyección oficial; ver
                                          build_poblacion_proyeccion)

IMPORTANTE: el NSE aquí calculado es un PROXY PROPIO basado en datos abiertos.
NO es el algoritmo oficial de AMAI ni los datos propietarios de Tinsa/RadarMX.
La marginación de CONAPO sí es un índice oficial. Las zonas de precio son
estimaciones de mercado (julio 2026), no valores catastrales ni avalúos.

Insumos esperados:
  data/raw/mg/conjunto_de_datos/01a.shp
  data/raw/iter/ageb_mza_urbana_01_cpv2020/conjunto_de_datos/
      conjunto_de_datos_ageb_urbana_01_cpv2020.csv
  data/raw/conapo/IMU_2020.xls
      (Índice de Marginación Urbana 2020, CONAPO — nacional, solo se usa AGS+JM)
  data/raw/conapo/pobproy_ggrupos.csv
      (Proyecciones de población CONAPO por municipio, grupos grandes de edad)

Uso:  python scripts/build_nse.py
"""

import json
import math
import os

import geopandas as gpd
import numpy as np
import pandas as pd
import xlrd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = os.path.join(BASE, "data/raw/mg/conjunto_de_datos/01a.shp")
ITER_CSV = os.path.join(
    BASE,
    "data/raw/iter/ageb_mza_urbana_01_cpv2020/conjunto_de_datos/"
    "conjunto_de_datos_ageb_urbana_01_cpv2020.csv",
)
CONAPO_IMU_XLS = os.path.join(BASE, "data/raw/conapo/IMU_2020.xls")
CONAPO_POBPROY_CSV = os.path.join(BASE, "data/raw/conapo/pobproy_ggrupos.csv")
OUT_AGEBS = os.path.join(BASE, "data/ags_agebs.json")
OUT_ZONES = os.path.join(BASE, "data/ags_price_zones.json")
OUT_POB_PROYECCION = os.path.join(BASE, "data/ags_poblacion_proyeccion.json")

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
#
# NOTA SOBRE CORTES DE EDAD: el ITER urbano NO trae quinquenios completos —
# solo P_0A2, P_3A5, P_6A11, P_12A14, P_15A17, P_18A24, P_60YMAS (más un
# P_8A14 que SE TRASLAPA con P_6A11/P_12A14 y no debe sumarse con ellos) y
# el bucket ya calculado POB0_14. No existe ningún corte entre 25 y 29, así
# que la partición 0-14/15-29/30-59/60+ que pide el formato de reporte NO es
# reproducible exacta con este dato. La partición más fina que SÍ es exacta
# y sin traslapes es:
#   pob_0_14   = POB0_14                              (exacto)
#   pob_15_24  = P_15A17 + P_18A24                     (sustituye "15-29",
#                                                        falta el quinquenio
#                                                        25-29)
#   pob_25_59  = POBTOT − pob_0_14 − pob_15_24 − 60+   (sustituye "30-59",
#                                                        absorbe el 25-29
#                                                        que no se pudo
#                                                        separar)
#   pob_60_mas = P_60YMAS                              (exacto; OJO: no
#                                                        confundir con
#                                                        POB65_MAS, que
#                                                        subcontaría)
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
        "POBTOT", "POBFEM", "POBMAS",
        "VIVTOT", "TVIVPAR", "TVIVPARHAB", "VIVPAR_DES", "VIVPAR_HAB",
        "GRAPROES", "PRO_OCUP_C",
        "VPH_INTER", "VPH_PC", "VPH_AUTOM", "VPH_C_SERV",
        "VPH_2YMASD", "VPH_3YMASC",
        "VPH_PISODT", "VPH_C_ELEC", "VPH_EXCSA", "VPH_DRENAJ",
        "POB0_14", "P_15A17", "P_18A24", "P_60YMAS", "PCON_DISC",
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
    df["pct_piso_firme"]   = df["VPH_PISODT"] / viv
    df["pct_electricidad"] = df["VPH_C_ELEC"] / viv
    df["pct_sanitario"]    = df["VPH_EXCSA"] / viv
    df["pct_drenaje"]      = df["VPH_DRENAJ"] / viv

    # --- Viviendas deshabitadas ---
    # VIVPAR_DES / TVIVPAR: deshabitadas sobre total de particulares
    # (TVIVPAR = VIVPAR_HAB + VIVPAR_DES + VIVPAR_UT)
    tvivpar = df["TVIVPAR"].replace(0, np.nan)
    df["pct_deshabitadas"] = (df["VIVPAR_DES"] / tvivpar * 100).round(1)

    # --- Grupos de edad (ver nota arriba: sustituto documentado de 15-29/30-59) ---
    df["pob_0_14"] = df["POB0_14"]
    df["pob_15_24"] = df["P_15A17"] + df["P_18A24"]
    df["pob_60_mas"] = df["P_60YMAS"]
    df["pob_25_59"] = df["POBTOT"] - df["pob_0_14"] - df["pob_15_24"] - df["pob_60_mas"]

    return df


# --------------------------------------------------------------- CONAPO
def load_conapo_marginacion():
    """Índice y grado de Marginación Urbana 2020 de CONAPO, por AGEB.

    Fuente oficial (no un proxy propio como nse_score/nse_nivel arriba) —
    correlaciona con el NSE (r≈0.84 en pruebas) pero no es redundante: hay
    divergencias reales entre ambos índices. Se cruza por CVEGEO: el campo
    "CVE_AGEB" de este archivo de CONAPO es, pese al nombre, el CVEGEO
    completo de 13 dígitos (mismo formato que ya usamos).

    ~10 de 373 AGEBs (todas con <60 habitantes) no tienen dato porque CONAPO
    las excluye del cálculo del índice por baja confiabilidad estadística —
    mismo criterio que ya aplicamos para marcar "S/D" en nse_nivel.
    """
    wb = xlrd.open_workbook(CONAPO_IMU_XLS)
    sh = wb.sheet_by_name("IMU_2020")
    header = [sh.cell_value(0, c) for c in range(sh.ncols)]
    idx = {h: i for i, h in enumerate(header)}
    muns = {int(m) for m in NSE_MUNICIPIOS}

    rows = []
    for r in range(1, sh.nrows):
        ent = sh.cell_value(r, idx["ENT"])
        mun = sh.cell_value(r, idx["MUN"])
        try:
            if int(ent) != 1 or int(mun) not in muns:
                continue
        except (ValueError, TypeError):
            continue
        rows.append({
            "CVEGEO": str(sh.cell_value(r, idx["CVE_AGEB"])).strip(),
            "conapo_im": sh.cell_value(r, idx["IM_2020"]) or None,
            "conapo_grado": sh.cell_value(r, idx["GM_2020"]) or None,
            "conapo_imn": sh.cell_value(r, idx["IMN_2020"]) or None,
        })
    return pd.DataFrame(rows)


def build_poblacion_proyeccion():
    """Serie de población TOTAL por municipio, 1990-2040 (CONAPO): 1990-2020
    es reconstrucción demográfica histórica, 2021-2040 es proyección oficial.

    Mismo nivel geográfico (municipio completo) que crec_mun_2010_2020, pero
    con 51 puntos anuales en vez de solo dos años — reemplaza ese cálculo de
    2 puntos con una serie real para graficar tendencia en el panel de zona/
    buffer. Se guarda aparte (no por AGEB): repetirla en cada una de las 373
    AGEBs sería puro desperdicio para un dato que no varía dentro del
    municipio.
    """
    df = pd.read_csv(CONAPO_POBPROY_CSV, dtype=str)
    df = df[(df["CLAVE_ENT"] == "1") & (df["NOM_MUN"].isin(NSE_MUNICIPIOS.values()))].copy()
    df["ANO"] = df["ANO"].astype(int)
    df["POB_TOTAL"] = pd.to_numeric(df["POB_TOTAL"], errors="coerce")
    agg = df.groupby(["NOM_MUN", "ANO"], as_index=False)["POB_TOTAL"].sum()

    municipios = {}
    for mun in NSE_MUNICIPIOS.values():
        sub = agg[agg["NOM_MUN"] == mun].sort_values("ANO")
        if sub.empty:
            continue
        municipios[mun] = {int(row.ANO): int(row.POB_TOTAL) for row in sub.itertuples()}

    return {
        "fuente": "CONAPO — Conciliación demográfica 1950-2019 y Proyecciones "
                  "de la Población de México y las Entidades Federativas "
                  "2020-2070 (corte municipal, grupos grandes de edad)",
        "nota": "1990-2020: reconstrucción demográfica histórica. 2021-2040: "
                "proyección oficial CONAPO. Nivel municipio completo (no por "
                "AGEB ni zona) — mismo alcance que antes tenía "
                "crec_mun_2010_2020, con muchos más puntos.",
        "anio_min": int(df["ANO"].min()),
        "anio_max": int(df["ANO"].max()),
        "municipios": municipios,
    }


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
    keep = ["CVEGEO", "POBTOT", "POBFEM", "POBMAS", "TVIVPARHAB",
            "VIVTOT", "TVIVPAR",
            "GRAPROES", "PRO_OCUP_C",
            "pct_inter", "pct_pc", "pct_auto", "pct_serv",
            "pct_2dorm", "pct_3cuart", "nse_score", "nse_nivel",
            "pct_deshabitadas",
            "pct_piso_firme", "pct_electricidad", "pct_sanitario", "pct_drenaje",
            "pob_0_14", "pob_15_24", "pob_25_59", "pob_60_mas", "PCON_DISC",
            "MUN"]
    gdf = gdf.merge(census[keep], on="CVEGEO", how="left")
    matched = gdf["nse_score"].notna().sum()
    print(f"AGEBs con datos censales: {matched} / {len(gdf)}")
    gdf["nse_nivel"] = gdf["nse_nivel"].fillna("S/D")
    pct_cols = ["pct_inter", "pct_pc", "pct_auto", "pct_serv", "pct_2dorm", "pct_3cuart",
                "pct_piso_firme", "pct_electricidad", "pct_sanitario", "pct_drenaje"]
    for c in pct_cols:
        gdf[c] = (gdf[c] * 100).round(1)
    gdf = gdf.rename(columns={"PCON_DISC": "pob_discapacidad"})

    # --- Densidad de población (hab/km²) ---
    # Proyectamos a EPSG:6372 (MTM México, unidades en metros) para áreas reales
    gdf_proj = gdf.to_crs(epsg=6372)
    gdf["densidad_hab_km2"] = (
        gdf["POBTOT"] / (gdf_proj.geometry.area / 1e6)
    ).round(0)

    # --- Marginación urbana 2020 (CONAPO) ---
    conapo = load_conapo_marginacion()
    print(f"AGEBs con dato de marginación CONAPO: {len(conapo)} / {len(gdf)}")
    gdf = gdf.merge(conapo, on="CVEGEO", how="left")

    zones = build_price_zones(gdf)

    cols = ["CVEGEO", "CVE_AGEB", "municipio", "zona",
            "POBTOT", "TVIVPARHAB",
            "GRAPROES", "PRO_OCUP_C", "pct_inter", "pct_pc", "pct_auto",
            "pct_serv", "pct_2dorm", "pct_3cuart",
            "nse_score", "nse_nivel",
            "pct_deshabitadas", "densidad_hab_km2",
            # --- campos agregados para la tabla "Población/Vivienda en la
            # zona de influencia" de los estudios de mercado (ver nota de
            # cortes de edad arriba de load_census) ---
            "POBFEM", "POBMAS",
            "pob_0_14", "pob_15_24", "pob_25_59", "pob_60_mas",
            "pob_discapacidad",
            "VIVTOT", "TVIVPAR",
            "pct_piso_firme", "pct_electricidad", "pct_sanitario", "pct_drenaje",
            # --- marginación urbana 2020 (CONAPO, oficial — ver load_conapo_marginacion) ---
            "conapo_im", "conapo_grado", "conapo_imn",
            "geometry"]
    gdf[cols].to_file(OUT_AGEBS, driver="GeoJSON")
    zones.to_file(OUT_ZONES, driver="GeoJSON")
    print(f"Escrito {OUT_AGEBS} ({os.path.getsize(OUT_AGEBS)//1024} KB)")
    print(f"Escrito {OUT_ZONES} ({os.path.getsize(OUT_ZONES)//1024} KB)")

    pob_proyeccion = build_poblacion_proyeccion()
    with open(OUT_POB_PROYECCION, "w", encoding="utf-8") as f:
        json.dump(pob_proyeccion, f, ensure_ascii=False, indent=2)
    print(f"Escrito {OUT_POB_PROYECCION} ({os.path.getsize(OUT_POB_PROYECCION)//1024} KB)")
    print("Proyección de población por municipio:")
    for mun, serie in pob_proyeccion["municipios"].items():
        anios_muestra = sorted(serie.keys())
        print(f"  {mun}: {anios_muestra[0]}={serie[anios_muestra[0]]:,} … {anios_muestra[-1]}={serie[anios_muestra[-1]]:,} ({len(serie)} puntos)")

    print("\nDistribución de marginación CONAPO (grado):")
    print(gdf["conapo_grado"].value_counts(dropna=False).to_string())
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
