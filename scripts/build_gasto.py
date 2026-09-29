#!/usr/bin/env python3
"""
Genera data/ags_gasto_ageb.json: gasto monetario estimado por hogar, por
AGEB y por categoría (alimentos, ropa, salud…), para calcular el "mercado
potencial en pesos" de un área (radio, isócrona o polígono).

Método (ver también la sección "Mercado potencial" del README):

1. Modelo lineal por categoría, ajustado con los hogares URBANOS de
   Aguascalientes de la ENIGH 2024 (mínimos cuadrados ponderados por el
   factor de expansión):
       gasto = b0 + b1·años_escolaridad_jefe + b2·internet + b3·computadora
                  + b4·automóvil + b5·servicios_completos + b6·ocupantes_por_cuarto
                  + b7·integrantes_del_hogar
   Son las MISMAS variables que el Censo 2020 publica por AGEB (como % o
   promedio). Por ser lineal, aplicar el modelo a los promedios de un AGEB da
   exactamente el promedio del modelo sobre sus hogares: no hay sesgo de
   agregación por pasar de hogar a AGEB.

2. Calibración: el Censo 2020 decide DÓNDE está el gasto (qué AGEB gasta más
   que otra) y la ENIGH 2024 decide CUÁNTO. Cada categoría se escala para que
   el promedio por hogar sobre todas las AGEBs (ponderado por viviendas)
   iguale el promedio ENIGH de los hogares urbanos de los municipios de
   Aguascalientes y Jesús María. Eso absorbe que entre 2020 y 2024 subió el
   % de hogares con internet, auto, etc.

3. Limitación conocida: un modelo lineal comprime los extremos. Las variables
   del Censo se saturan (en una AGEB A/B casi el 100% tiene auto e internet),
   así que el gasto de las zonas más altas probablemente se SUBESTIMA y el de
   las más bajas se sobreestima. Sirve para comparar zonas y dimensionar
   mercados, no como cifra de ventas.

4. Categorías con predicción negativa en AGEBs de muy bajos recursos se
   recortan a 0 (un gasto negativo no existe).

Salida: pesos de 2024 por hogar, TRIMESTRALES (como los publica la ENIGH);
la app los anualiza (×4) y multiplica por viviendas × hogares por vivienda.

Insumos: data/raw/enigh/{concentradohogar,hogares,viviendas}/*.csv
         (microdatos ENIGH 2024, https://www.inegi.org.mx/programas/enigh/nc/2024/#microdatos)
         data/ags_agebs.json (generado por build_nse.py)
Uso:     .venv/bin/python scripts/build_gasto.py
"""

import json
import os

import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data/raw/enigh")
AGEBS = os.path.join(BASE, "data/ags_agebs.json")
OUT = os.path.join(BASE, "data/ags_gasto_ageb.json")

# columna de concentradohogar -> (clave de salida, etiqueta para la app)
CATEGORIAS = [
    ("gasto_mon", "total", "Gasto monetario total"),
    ("ali_dentro", "alimentos_hogar", "Alimentos y bebidas para el hogar"),
    ("ali_fuera", "alimentos_fuera", "Alimentos fuera del hogar (restaurantes, fondas)"),
    ("vesti_calz", "ropa_calzado", "Vestido y calzado"),
    ("vivienda", "vivienda", "Vivienda, agua y energía"),
    ("limpieza", "limpieza_hogar", "Limpieza, enseres y cuidado de la casa"),
    ("salud", "salud", "Salud"),
    ("transporte", "transporte", "Transporte y comunicaciones"),
    ("educa_espa", "educacion_esparcimiento", "Educación y esparcimiento"),
    ("personales", "cuidado_personal", "Cuidado personal y otros gastos"),
]

# Subcategorías: no van en la tabla principal de la app (se traslaparían con
# su categoría), pero sirven para el "mercado por competidor": a una farmacia
# le corresponde el gasto en medicamentos, no todo el de salud; a una
# gasolinera, el de combustible, no todo el de transporte.
SUBCATEGORIAS = [
    ("medic_prod", "medicamentos", "Medicamentos sin receta y material de curación"),
    ("ambul_serv", "consultas", "Atención médica ambulatoria (consultas, estudios, medicamentos recetados)"),
    ("aten_hosp", "hospital", "Atención hospitalaria"),
    ("vestido", "vestido", "Vestido"),
    ("calzado", "calzado", "Calzado"),
    ("combus", "combustible", "Combustible para vehículos"),
    ("comunica", "comunicaciones", "Comunicaciones (telefonía, internet)"),
    ("educacion", "educacion", "Educación (colegiaturas, útiles, cursos)"),
    ("esparci", "esparcimiento", "Esparcimiento (deporte, cine, recreación)"),
    ("cuida_pers", "cuidados_personales", "Cuidados personales (estética, artículos de higiene)"),
]

VARIABLES = ["anios_esc", "inter", "pc", "auto", "serv", "ocup_cuarto", "integrantes"]

# nivel educativo del jefe (catálogo ENIGH educa_jefe) -> años aproximados de
# escolaridad. El Censo da el promedio de TODA la población de 15+ (GRAPROES);
# la diferencia de nivel entre jefes y población la absorbe la calibración.
ANIOS_EDUCA_JEFE = {1: 0, 2: 0, 3: 3, 4: 6, 5: 7.5, 6: 9, 7: 10.5, 8: 12, 9: 14, 10: 16, 11: 18}


def cargar_hogares():
    c = pd.read_csv(os.path.join(RAW, "concentradohogar/concentradohogar.csv"),
                    dtype={"folioviv": str, "ubica_geo": str}, low_memory=False)
    h = pd.read_csv(os.path.join(RAW, "hogares/hogares.csv"), dtype={"folioviv": str}, low_memory=False)
    v = pd.read_csv(os.path.join(RAW, "viviendas/viviendas.csv"), dtype={"folioviv": str}, low_memory=False)

    c["ubica_geo"] = c["ubica_geo"].str.zfill(5)
    c = c[c["ubica_geo"].str[:2] == "01"]
    num = lambda s: pd.to_numeric(s, errors="coerce").fillna(0)

    h["inter"] = (num(h["conex_inte"]) == 1).astype(float)
    h["pc"] = ((num(h["num_compu"]) + num(h["num_lap"]) + num(h["num_table"])) > 0).astype(float)
    h["auto"] = ((num(h["num_auto"]) + num(h["num_van"]) + num(h["num_pick"])) > 0).astype(float)

    # servicios completos como el Censo (VPH_C_SERV): electricidad, agua
    # entubada (dentro o en el terreno) y drenaje de cualquier tipo
    v["serv"] = ((num(v["disp_elect"]).between(1, 4)) &
                 (num(v["agua_ent"]).isin([1, 2])) &
                 (num(v["drenaje"]).between(1, 4))).astype(float)
    cuartos = num(v["num_cuarto"]).replace(0, np.nan)
    v["ocup_cuarto"] = num(v["tot_resid"]) / cuartos

    df = (c.merge(h[["folioviv", "foliohog", "inter", "pc", "auto"]], on=["folioviv", "foliohog"])
           .merge(v[["folioviv", "serv", "ocup_cuarto", "tot_hog"]], on="folioviv"))
    df["anios_esc"] = df["educa_jefe"].map(ANIOS_EDUCA_JEFE)
    df["integrantes"] = df["tot_integ"].astype(float)
    return df.dropna(subset=VARIABLES)


def wls(X, y, w):
    """Mínimos cuadrados ponderados: coeficientes con intercepto al inicio."""
    Xc = np.column_stack([np.ones(len(X)), X])
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(Xc * sw[:, None], y * sw, rcond=None)
    return beta


def r2(y, yhat, w):
    ybar = np.average(y, weights=w)
    return 1 - np.sum(w * (y - yhat) ** 2) / np.sum(w * (y - ybar) ** 2)


def r2_cv(X, y, w, k=5, seed=7):
    """R² fuera de muestra (k-fold): el modelo nunca ve el hogar que predice."""
    idx = np.random.default_rng(seed).permutation(len(y))
    pred = np.empty(len(y))
    for f in np.array_split(idx, k):
        train = np.setdiff1d(idx, f)
        b = wls(X[train], y[train], w[train])
        pred[f] = b[0] + X[f] @ b[1:]
    return r2(y, pred, w)


def r2_upm(urb, col, beta, minimo=4):
    """R² a nivel de UPM (unidad primaria de muestreo: conglomerado de
    viviendas vecinas). Es lo más parecido a un AGEB que tiene la ENIGH:
    compara el gasto promedio real de cada UPM contra el modelo aplicado a
    los PROMEDIOS de la UPM — justo lo que la app hace con cada AGEB."""
    g = urb.assign(_w=urb["factor"])
    filas = []
    for _, u in g.groupby("upm"):
        if len(u) < minimo:
            continue
        w = u["_w"].to_numpy(float)
        medias = np.average(u[VARIABLES].to_numpy(float), axis=0, weights=w)
        filas.append((np.average(u[col], weights=w), beta[0] + medias @ beta[1:], w.sum()))
    real, pred, peso = map(np.array, zip(*filas))
    return r2(real, pred, peso), len(filas)


def main():
    np.seterr(all="ignore")  # falsos avisos de overflow del BLAS de macOS en matmul; se valida abajo
    hog = cargar_hogares()
    urb = hog[hog["tam_loc"].isin([1, 2, 3])]  # localidades de 2,500+ hab: las AGEBs son urbanas
    X = urb[VARIABLES].to_numpy(float)
    w = urb["factor"].to_numpy(float)

    # objetivo de calibración: hogares urbanos de los municipios del mapa
    obj = urb[urb["ubica_geo"].isin(["01001", "01005"])]
    hog_por_viv = obj.groupby("folioviv")["factor"].first().sum()
    hog_por_viv = obj["factor"].sum() / hog_por_viv

    agebs = json.load(open(AGEBS, encoding="utf-8"))["features"]
    filas = []
    for f in agebs:
        p = f["properties"]
        filas.append({
            "CVEGEO": p["CVEGEO"], "viv": p.get("TVIVPARHAB") or 0,
            "anios_esc": p.get("GRAPROES"),
            "inter": None if p.get("pct_inter") is None else p["pct_inter"] / 100,
            "pc": None if p.get("pct_pc") is None else p["pct_pc"] / 100,
            "auto": None if p.get("pct_auto") is None else p["pct_auto"] / 100,
            "serv": None if p.get("pct_serv") is None else p["pct_serv"] / 100,
            "ocup_cuarto": p.get("PRO_OCUP_C"),
            # tamaño promedio del hogar: el alimento depende más de cuántos
            # comen que de cuánto ganan
            "integrantes": p["POBTOT"] / p["TVIVPARHAB"] if p.get("POBTOT") and p.get("TVIVPARHAB") else None,
        })
    ag = pd.DataFrame(filas)
    completos = ag[VARIABLES].notna().all(axis=1)
    Xa = ag.loc[completos, VARIABLES].to_numpy(float)
    viv = ag.loc[completos, "viv"].to_numpy(float)

    modelos, salida = {}, {cv: {} for cv in ag.loc[completos, "CVEGEO"]}
    print(f"Hogares urbanos Ags en la muestra: {len(urb)}  (objetivo 001+005: {len(obj)})")
    print(f"Hogares por vivienda (ENIGH, 001+005 urbano): {hog_por_viv:.3f}")
    print(f"AGEBs con las {len(VARIABLES)} variables: {completos.sum()} de {len(ag)}\n")
    print(f"{'categoría':<26}{'R² hogar':>9}{'R² CV':>8}{'R² UPM':>8}{'ENIGH $/trim':>14}{'factor':>8}{'AGEBs<0':>8}")
    todas = [(c, k, e, "categoria") for c, k, e in CATEGORIAS] + \
            [(c, k, e, "subcategoria") for c, k, e in SUBCATEGORIAS]
    for col, clave, etiqueta, nivel in todas:
        y = urb[col].to_numpy(float)
        beta = wls(X, y, w)
        pred = beta[0] + Xa @ beta[1:]
        assert np.isfinite(pred).all() and np.isfinite(beta).all(), col
        r2u, n_upm = r2_upm(urb, col, beta)
        negativos = int((pred < 0).sum())
        pred = np.clip(pred, 0, None)
        objetivo = np.average(obj[col], weights=obj["factor"])
        factor = objetivo / np.average(pred, weights=viv)
        pred = pred * factor
        modelos[clave] = {
            "etiqueta": etiqueta,
            "nivel": nivel,
            "columna_enigh": col,
            "coeficientes": dict(zip(["intercepto"] + VARIABLES, [round(float(b), 2) for b in beta])),
            "r2_hogar": round(float(r2(y, beta[0] + X @ beta[1:], w)), 3),
            "r2_validacion_cruzada": round(float(r2_cv(X, y, w)), 3),
            "r2_por_upm": round(float(r2u), 3),
            "upms_validacion": n_upm,
            "promedio_enigh_trim": round(float(objetivo), 0),
            "factor_calibracion": round(float(factor), 3),
            "agebs_recortadas_a_cero": negativos,
            # con R² < 0.1 entre conglomerados el modelo apenas distingue una
            # zona de otra: la app lo marca como orientativo
            "confianza": "baja" if r2u < 0.1 else "media",
        }
        for cv, val in zip(ag.loc[completos, "CVEGEO"], pred):
            salida[cv][clave] = round(float(val), 0)
        m = modelos[clave]
        print(f"{clave:<26}{m['r2_hogar']:>9.3f}{m['r2_validacion_cruzada']:>8.3f}{m['r2_por_upm']:>8.3f}"
              f"{objetivo:>14,.0f}{factor:>8.3f}{negativos:>8}")

    out = {
        "meta": {
            "fuente": "INEGI, ENIGH 2024 (microdatos) + Censo 2020 por AGEB urbana",
            "unidad": "pesos de 2024 por hogar, por trimestre (gasto monetario corriente)",
            "hogares_por_vivienda": round(float(hog_por_viv), 4),
            "metodo": ("Modelo lineal por categoría ajustado con hogares urbanos de Aguascalientes "
                       "(ENIGH 2024, ponderado por factor) sobre variables que el Censo 2020 publica "
                       "por AGEB; aplicado a los promedios de cada AGEB y calibrado para que el "
                       "promedio por hogar iguale el de la ENIGH en los hogares urbanos de "
                       "Aguascalientes y Jesús María."),
            "variables": VARIABLES,
            "muestra_hogares": int(len(urb)),
            "modelos": modelos,
        },
        "agebs": salida,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"\n{OUT}: {len(salida)} AGEBs, {os.path.getsize(OUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
