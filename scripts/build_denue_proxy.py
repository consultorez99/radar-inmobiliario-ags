#!/usr/bin/env python3
"""
Genera data/ags_denue_proxy.json: estimación EXPERIMENTAL de nivel socioeconómico
(Bajo/Medio/Alto) para zonas urbanizadas que quedan en blanco en la capa NSE porque
no tienen polígono de AGEB (fraccionamientos construidos después del Censo 2020).

Metodología, en resumen:
  1. Se cruza el directorio DENUE (INEGI) con los 373 AGEBs conocidos y se calculan,
     por AGEB, variables derivadas de la mezcla de giros de negocio (densidad,
     % comercio básico, % servicios profesionales/salud/educación, % industria,
     % negocios grandes).
  2. Se entrena un modelo (Gradient Boosting) que predice el nse_score real del AGEB
     a partir de esas variables, y se valida con 5-fold cross-validation — es decir,
     se mide qué tan bien predice AGEBs que el modelo NUNCA vio durante el entrenamiento.
  3. Los puntos DENUE que caen fuera de todo AGEB pero dentro de una colonia catastral
     reconocida (zona urbanizada real, no campo abierto) se agrupan en clusters
     geográficos (DBSCAN) — cada cluster es un "hueco" distinto, no se trata la
     ciudad completa como una sola bolsa.
  4. A cada cluster se le aplican las mismas variables y el mismo modelo. Clusters con
     pocos negocios, con perfil claramente industrial/agropecuario, o dominados por un
     solo giro se EXCLUYEN de la estimación (se listan igual, marcados, no se ocultan).

IMPORTANTE — esto es un modelo, no un censo. La validación cruzada (ver "validacion"
en el JSON de salida) muestra una correlación moderada (~0.7) y ~62% de acierto exacto
en 3 niveles — es una señal orientativa, no una medición. Nunca se usan los 7 niveles
A/B..E de la capa NSE censal para esta capa, precisamente para no aparentar la misma
precisión que un dato real.

Insumos:
  data/raw/denue/denue_01_csv.zip  — DENUE Aguascalientes, datos abiertos INEGI
                                      (descarga: https://www.inegi.org.mx/app/descarga/
                                       ?ti=6, Área geográfica: Aguascalientes → DENUE)
  data/ags_agebs.json               — ya generado por build_nse.py

Uso:  .venv/bin/python scripts/build_denue_proxy.py   (requiere pandas, shapely,
      scikit-learn, pyproj — ya en .venv)
"""

import glob
import json
import os
import warnings
import zipfile

import numpy as np
import pandas as pd
import pyproj
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
from sklearn.cluster import DBSCAN
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import KFold, cross_val_predict

warnings.filterwarnings("ignore")  # advertencias numéricas benignas de sklearn en folds pequeños

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_ZIP_GLOB = os.path.join(BASE, "data/raw/denue/denue_01*.zip")
AGEBS_PATH = os.path.join(BASE, "data/ags_agebs.json")
CATASTRAL_PATH = os.path.join(BASE, "data/ags_catastral.json")
OUT = os.path.join(BASE, "data/ags_denue_proxy.json")

MUNICIPIOS = ["Aguascalientes", "Jesús María"]
SECTOR_GROUPS = {
    "comercio_menor": ["46"], "alimentos_alojamiento": ["72"], "otros_servicios": ["81"],
    "salud": ["62"], "educacion": ["61"], "prof_financiero_inmobiliario": ["54", "52", "53"],
    "industria": ["31", "32", "33"], "comercio_mayor": ["43"], "esparcimiento": ["71"],
}
EMP_GRANDE = {"31 a 50 personas", "51 a 100 personas", "101 a 250 personas", "251 y más personas"}
FEATURE_COLS = ["densidad_km2"] + [f"pct_{g}" for g in SECTOR_GROUPS] + ["pct_empleo_grande"]
NIVELES3 = ["Bajo", "Medio", "Alto"]

MIN_NEGOCIOS = 8          # bajo este número, la señal es demasiado ruidosa
MAX_PCT_NO_RESIDENCIAL = 0.35  # industria+agropecuario+minería por encima de esto: no es zona habitacional
DBSCAN_EPS_M = 180        # radio de vecindad para agrupar puntos en un mismo cluster
DBSCAN_MIN_SAMPLES = 6
BUFFER_PUNTO_M = 90       # buffer por punto al construir la geometría del cluster

to_metros = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:6372", always_xy=True).transform
to_grados = pyproj.Transformer.from_crs("EPSG:6372", "EPSG:4326", always_xy=True).transform


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
            with z.open(meta_name) as f:
                texto = f.read().decode("latin-1")
            for linea in texto.splitlines():
                if linea.strip().startswith("Modified:"):
                    anio, mes, _ = linea.split(":", 1)[1].strip().split("-")
                    corte = f"{mes}/{anio}"
                    break

    df = df[df["municipio"].isin(MUNICIPIOS)].copy()
    df["lat"] = df["latitud"].astype(float)
    df["lon"] = df["longitud"].astype(float)
    df["sector"] = df["codigo_act"].astype(str).str[:2]
    return df, ruta, corte


def features_de(sub, area_km2):
    n = len(sub)
    row = {"n_negocios": n, "densidad_km2": (n / area_km2) if area_km2 > 0 else 0}
    for g, secs in SECTOR_GROUPS.items():
        row[f"pct_{g}"] = sub["sector"].isin(secs).mean() if n else 0.0
    row["pct_empleo_grande"] = sub["per_ocu"].isin(EMP_GRANDE).mean() if n else 0.0
    return row


def main():
    denue, ruta_insumo, corte_denue = cargar_denue()
    print(f"Insumo: {ruta_insumo}  ({len(denue)} negocios en {'/'.join(MUNICIPIOS)})")

    agebs = json.load(open(AGEBS_PATH))
    catastral = json.load(open(CATASTRAL_PATH))
    ageb_polys = [shape(f["geometry"]) for f in agebs["features"]]
    ageb_props = [f["properties"] for f in agebs["features"]]
    tree_ageb = STRtree(ageb_polys)
    union_cat = unary_union([shape(f["geometry"]) for f in catastral["features"]])

    pts = [Point(lon, lat) for lon, lat in zip(denue["lon"], denue["lat"])]
    ageb_idx = np.full(len(pts), -1, dtype=int)
    for i, p in enumerate(pts):
        idxs = tree_ageb.query(p, predicate="within")
        if len(idxs) > 0:
            ageb_idx[i] = idxs[0]
    denue["ageb_idx"] = ageb_idx

    # ---------------------------------------------------- 1) features por AGEB conocido
    filas_train = []
    for i, (poly, props) in enumerate(zip(ageb_polys, ageb_props)):
        area_km2 = transform(to_metros, poly).area / 1e6
        sub = denue[denue["ageb_idx"] == i]
        if len(sub) == 0:
            continue
        row = features_de(sub, area_km2)
        row["nse_score"] = props["nse_score"]
        filas_train.append(row)
    train = pd.DataFrame(filas_train)
    X_train = train[FEATURE_COLS].fillna(0).values
    y_train = train["nse_score"].values
    print(f"AGEBs con negocios DENUE para calibrar: {len(train)} / {len(ageb_polys)}")

    # ---------------------------------------------------- 2) validar (k-fold) y entrenar final
    modelo_cv = GradientBoostingRegressor(n_estimators=150, max_depth=2, learning_rate=0.05, random_state=42)
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    pred_cv = cross_val_predict(modelo_cv, X_train, y_train, cv=kf)
    r2 = 1 - np.sum((y_train - pred_cv) ** 2) / np.sum((y_train - y_train.mean()) ** 2)
    corr = float(np.corrcoef(y_train, pred_cv)[0, 1])
    cortes3 = np.quantile(y_train, [1 / 3, 2 / 3]).tolist()
    real3 = np.digitize(y_train, cortes3)
    pred3 = np.digitize(pred_cv, cortes3)
    exactitud3 = float((real3 == pred3).mean())
    error_grave = float((np.abs(real3 - pred3) >= 2).mean())  # confundir Bajo con Alto o viceversa
    print(f"Validación cruzada: R²={r2:.3f}  corr={corr:.3f}  acierto_3niveles={exactitud3*100:.1f}%  error_grave={error_grave*100:.1f}%")

    modelo = GradientBoostingRegressor(n_estimators=150, max_depth=2, learning_rate=0.05, random_state=42)
    modelo.fit(X_train, y_train)

    # ---------------------------------------------------- 3) puntos del "hueco real"
    fuera_ageb_mask = ageb_idx == -1
    idx_fuera = np.where(fuera_ageb_mask)[0]
    dentro_cat = np.array([union_cat.contains(pts[i]) for i in idx_fuera])
    idx_hueco = idx_fuera[dentro_cat]
    hueco = denue.iloc[idx_hueco].copy()
    print(f"Negocios en el hueco real (colonia sí, AGEB no): {len(hueco)}")

    # ---------------------------------------------------- 4) clusterizar el hueco
    pts_hueco_m = [transform(to_metros, pts[i]) for i in idx_hueco]
    coords_m = np.array([[p.x, p.y] for p in pts_hueco_m])
    db = DBSCAN(eps=DBSCAN_EPS_M, min_samples=DBSCAN_MIN_SAMPLES).fit(coords_m)
    hueco["cluster"] = db.labels_
    n_clusters = len(set(db.labels_)) - (1 if -1 in db.labels_ else 0)
    print(f"Clusters geográficos encontrados: {n_clusters}")

    # ---------------------------------------------------- 5) puntuar cada cluster
    features_out = []
    for cid, sub in hueco[hueco["cluster"] >= 0].groupby("cluster"):
        n = len(sub)
        pts_m = [transform(to_metros, Point(lon, lat)) for lon, lat in zip(sub["lon"], sub["lat"])]
        blob_m = unary_union([p.buffer(BUFFER_PUNTO_M) for p in pts_m]).buffer(0)
        area_km2 = blob_m.area / 1e6
        blob_deg = transform(to_grados, blob_m).simplify(0.00005)
        centro_deg = transform(to_grados, blob_m.centroid)

        row = features_de(sub, area_km2)
        pct_no_res = row["pct_industria"] + sub["sector"].isin(["11", "21"]).mean()
        top = sub["nombre_act"].value_counts()
        top_pct = (top.iloc[0] / n) if len(top) else 0

        excluido = None
        if n < MIN_NEGOCIOS:
            excluido = "muy pocos negocios para estimar con confianza"
        elif pct_no_res > MAX_PCT_NO_RESIDENCIAL:
            excluido = "perfil industrial/agropecuario, no parece zona habitacional"
        elif top_pct > 0.5 and n < 20:
            excluido = f"dominado por un solo giro ({top.index[0]}), poco representativo"

        score = None
        nivel = None
        if excluido is None:
            X = pd.DataFrame([row])[FEATURE_COLS].fillna(0).values
            score = float(modelo.predict(X)[0])
            nivel = NIVELES3[int(np.digitize(score, cortes3))]

        features_out.append({
            "type": "Feature",
            "geometry": mapping(blob_deg),
            "properties": {
                "cluster_id": int(cid),
                "n_negocios": n,
                "lat": round(centro_deg.y, 6),
                "lon": round(centro_deg.x, 6),
                "nse_score_estimado": round(score, 3) if score is not None else None,
                "nse_nivel_estimado": nivel,
                "actividad_top": top.index[0] if len(top) else None,
                "excluido": excluido,
            },
        })

    incluidos = sum(1 for f in features_out if f["properties"]["excluido"] is None)
    print(f"Clusters publicados con estimación: {incluidos} / {len(features_out)}")

    salida = {
        "type": "FeatureCollection",
        "meta": {
            "fuente": "Estimación experimental propia, calibrada con DENUE (INEGI, datos abiertos) "
                      "contra los AGEBs del Censo 2020. NO es un dato censal ni oficial.",
            "url_denue": "https://www.inegi.org.mx/app/descarga/?ti=6",
            "corte_denue": corte_denue,
            "metodologia": "Gradient Boosting entrenado con la mezcla de giros de negocio DENUE por "
                            "AGEB conocido, aplicado a clusters de negocios (DBSCAN) que quedan fuera "
                            "de todo AGEB pero dentro de una colonia catastral reconocida. Solo 3 "
                            "niveles (Bajo/Medio/Alto), no los 7 de la capa NSE censal.",
            "validacion_cruzada": {
                "r2": round(float(r2), 3),
                "correlacion": round(corr, 3),
                "acierto_exacto_3niveles_pct": round(exactitud3 * 100, 1),
                "error_grave_pct": round(error_grave * 100, 1),
                "nota": "Medido con 5-fold cross-validation sobre los 370 AGEBs con negocios DENUE: "
                        "el modelo nunca ve el AGEB que está prediciendo en cada fold.",
            },
        },
        "features": features_out,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK → {OUT}")


if __name__ == "__main__":
    main()
