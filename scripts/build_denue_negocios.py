#!/usr/bin/env python3
"""
Genera data/ags_denue_negocios.json: los 57,931 negocios activos de DENUE
(INEGI) en Aguascalientes y Jesús María, para la capa "Negocios" del mapa —
a diferencia de build_denue_proxy.py, esta es una capa de dato crudo (sin
modelo, sin estimación), el directorio completo tal cual lo publica INEGI.

Formato compacto (arrays posicionales, no objetos) porque son ~58k filas:
  categorias: ["Comercio", ...]                    índice -> nombre de categoría
  actividades: ["Comercio al por menor en...", ...] índice -> giro específico (SCIAN)
  tamanos: ["0 a 5 personas", ...]                  índice -> rango de empleados
  negocios: [[nombre, cat_idx, act_idx, tam_idx, lat, lon], ...]

Insumo:  data/raw/denue/denue_01_csv.zip  (mismo insumo que build_denue_proxy.py)
Uso:     .venv/bin/python scripts/build_denue_negocios.py
"""

import glob
import json
import os
import zipfile

import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_ZIP_GLOB = os.path.join(BASE, "data/raw/denue/denue_01*.zip")
OUT = os.path.join(BASE, "data/ags_denue_negocios.json")

MUNICIPIOS = ["Aguascalientes", "Jesús María"]

# sector SCIAN (2 dígitos) -> categoría de la capa. Cualquier sector no
# listado cae en "Otros" (gobierno, medios, minería, agricultura, servicios
# públicos — juntos suman <1% del total).
CATEGORIA_POR_SECTOR = {
    "46": "Comercio", "43": "Comercio mayoreo",
    "72": "Restaurantes y hospedaje",
    "81": "Servicios personales",
    "62": "Salud", "61": "Educación",
    "54": "Profesional y financiero", "52": "Profesional y financiero",
    "53": "Profesional y financiero", "55": "Profesional y financiero", "56": "Profesional y financiero",
    "31": "Industria y construcción", "32": "Industria y construcción",
    "33": "Industria y construcción", "23": "Industria y construcción",
    "48": "Transporte", "49": "Transporte",
    "71": "Esparcimiento",
}


def cargar_denue():
    candidatos = sorted(glob.glob(RAW_ZIP_GLOB))
    if not candidatos:
        raise SystemExit(f"No hay insumo. Descarga el DENUE de Aguascalientes a {RAW_ZIP_GLOB}")
    ruta = candidatos[-1]
    with zipfile.ZipFile(ruta) as z:
        csv_name = next(n for n in z.namelist() if n.endswith(".csv") and "conjunto_de_datos" in n)
        with z.open(csv_name) as f:
            df = pd.read_csv(f, encoding="latin-1", dtype=str)
        corte = os.path.basename(ruta)
        meta_name = next((n for n in z.namelist() if n.endswith("metadatos_denue.txt")), None)
        if meta_name:
            texto = z.read(meta_name).decode("latin-1")
            for linea in texto.splitlines():
                if linea.strip().startswith("Modified:"):
                    anio, mes, _ = linea.split(":", 1)[1].strip().split("-")
                    corte = f"{mes}/{anio}"
                    break
    df = df[df["municipio"].isin(MUNICIPIOS)].copy()
    return df, corte


def main():
    df, corte = cargar_denue()
    df["sector"] = df["codigo_act"].astype(str).str[:2]
    df["categoria"] = df["sector"].map(CATEGORIA_POR_SECTOR).fillna("Otros")
    print(f"Negocios en {'/'.join(MUNICIPIOS)}: {len(df)}")
    print(df["categoria"].value_counts().to_string())

    categorias = sorted(df["categoria"].unique())
    cat_idx = {c: i for i, c in enumerate(categorias)}
    actividades = sorted(df["nombre_act"].unique())
    act_idx = {a: i for i, a in enumerate(actividades)}
    tamanos = sorted(df["per_ocu"].unique(), key=lambda s: (len(s), s))
    tam_idx = {t: i for i, t in enumerate(tamanos)}

    negocios = [
        [
            row["nom_estab"].strip() if isinstance(row["nom_estab"], str) and row["nom_estab"].strip() else row["nombre_act"],
            cat_idx[row["categoria"]],
            act_idx[row["nombre_act"]],
            tam_idx[row["per_ocu"]],
            round(float(row["latitud"]), 6),
            round(float(row["longitud"]), 6),
        ]
        for _, row in df.iterrows()
    ]

    salida = {
        "meta": {
            "fuente": "INEGI — Directorio Estadístico Nacional de Unidades Económicas (DENUE), "
                      "datos abiertos (Libre Uso MX)",
            "url": "https://www.inegi.org.mx/app/descarga/?ti=6",
            "corte": corte,
            "total": len(negocios),
            "esquema": "negocios: [nombre, categoria_idx, actividad_idx, tamano_idx, lat, lon]",
        },
        "categorias": categorias,
        "actividades": actividades,
        "tamanos": tamanos,
        "negocios": negocios,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK → {OUT}")


if __name__ == "__main__":
    main()
