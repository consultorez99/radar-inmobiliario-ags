#!/usr/bin/env python3
"""
Genera data/ags_catastral.geojson: polígonos de colonias (INEGI DCAH) con el
valor unitario de suelo ($/m²) de las Tablas de Valores Unitarios anexas a la
Ley de Ingresos del Municipio de Aguascalientes 2026 (Decreto 377, Periódico
Oficial del Estado, 26-dic-2025).

A diferencia de las otras capas, estos SÍ son valores oficiales (base del
impuesto predial), pero son valores CATASTRALES: normalmente por debajo del
precio de mercado real.

Insumos:
  data/raw/ley_ingresos_ags_2026.pdf     — Periódico Oficial (Anexo 1, p.102-225)
  data/raw/dcah/conjunto_de_datos/01as.shp — INEGI, Delimitación de Colonias y
                                             otros Asentamientos Humanos (2023)

Uso:  python scripts/build_catastral.py
"""

import csv
import os
import re
import unicodedata
from difflib import SequenceMatcher

import fitz
import geopandas as gpd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(BASE, "data/raw/ley_ingresos_ags_2026.pdf")
DCAH_SHP = os.path.join(BASE, "data/raw/dcah/conjunto_de_datos/01as.shp")
OUT = os.path.join(BASE, "data/ags_catastral.geojson")
OUT_CSV = os.path.join(BASE, "data/raw/valores_catastrales_2026.csv")
UNMATCHED_CSV = os.path.join(BASE, "data/raw/valores_sin_match.csv")

# Jesús María publica sus valores de suelo como MAPAS por localidad (Anexo 2
# de su Ley de Ingresos 2026 + portal de transparencia municipal). Las tablas
# de cada plano se transcribieron manualmente a este CSV. Ver README.md.
JMA_CSV = os.path.join(BASE, "data/raw/valores_catastrales_jma_2026.csv")

PAGES = range(101, 226)  # Anexo 1 (0-indexed): tablas por sector catastral

# Prefijos de tipo de asentamiento usados en la ley (orden: más largo primero)
TIPOS = [
    "UNIDAD HABITACIONAL INFONAVIT", "UNIDAD HABITACIONAL", "CONJUNTO HABITACIONAL",
    "CONJUNTO CONDOMINAL", "ASENTAMIENTO IRREGULAR", "POBLADO COMUNAL",
    "FRACCIONAMIENTO POR REGULARIZACION", "FRACCIONAMIENTO", "FRACCION",
    "CONDOMINIO", "COLONIA", "BARRIO", "PUEBLO", "VILLA", "CONGREGACION",
    "ZONA COMERCIAL", "ZONA INDUSTRIAL", "ZONA", "EJIDO", "RANCHERIA", "COMUNIDAD",
    "DELEGACION", "SUBDELEGACION", "PARQUE INDUSTRIAL", "GRANJA", "COTO", "PRIVADA",
    "PLAZA COMERCIAL", "SUBDIVISION", "AMPLIACION", "CERRADA", "RINCONADA",
]


def norm(s):
    """MAYÚSCULAS sin acentos, sin puntuación, espacios colapsados."""
    s = s.upper().replace("Ð", "Ñ")  # artefacto de fuente del Periódico Oficial
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn" or c == "̃")
    s = unicodedata.normalize("NFC", s)
    # conservar Ñ: normalizar de vuelta
    s = s.replace("N~", "Ñ")
    s = re.sub(r"[^A-ZÑ0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_tipo(name):
    """Separa el prefijo de tipo del nombre base."""
    for t in TIPOS:
        if name.startswith(t + " "):
            return t, name[len(t) + 1:]
    return "", name


ORDINALES = [
    (r"\bPRIMERA?\b|\b1RA\b|\b1A\b|\b1ERA\b|\bI\b", "1"),
    (r"\bSEGUNDA?\b|\b2DA\b|\b2A\b|\bII\b", "2"),
    (r"\bTERCERA?\b|\b3RA\b|\b3A\b|\bIII\b", "3"),
    (r"\bCUARTA?\b|\b4TA\b|\b4A\b|\bIV\b", "4"),
    (r"\bQUINTA?\b|\b5TA\b|\b5A\b|\bV\b", "5"),
    (r"\bSEXTA?\b|\b6TA\b|\b6A\b|\bVI\b", "6"),
]


def canon(s):
    """Canonicaliza ordinales y sufijos de sección/etapa para comparar."""
    s = re.sub(r"\bSECC\b", "SECCION", s)
    for pat, rep in ORDINALES:
        s = re.sub(pat, rep, s)
    # "SECCION 1" y "1 SECCION" → "SECCION 1"
    s = re.sub(r"\b(\d)\s+(SECCION|ETAPA|SECTOR)\b", r"\2 \1", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_seccion(s):
    """Quita sufijos de sección/etapa/número final: 'X SECCION 2' → 'X'."""
    s = re.sub(r"\b(SECCION|ETAPA|SECTOR)\s*\d*\b", " ", s)
    s = re.sub(r"\s+\d+$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def slug(s):
    """Clave laxa: sin conectivos, sin 'SUBDIVISION', sin espacios."""
    s = re.sub(r"\b(DE|DEL|LA|LAS|LOS|EL|Y|SUBDIVISION|ZONA)\b", " ", s)
    return s.replace(" ", "")


# ------------------------------------------------- 1. extraer tablas del PDF
def extract_ley():
    doc = fitz.open(PDF)
    rows = []
    sector = None
    name_buf = []
    for pno in PAGES:
        for raw in doc[pno].get_text().splitlines():
            line = raw.strip()
            if not line or line == "ARCHIVO PARA CONSULTA":
                continue
            m = re.match(r"(?:TABLA\s+)?SECTOR\s+(\d+)", line, re.I)
            if m:
                sector, name_buf = int(m.group(1)), []
                continue
            if re.match(r"^Pág\.|^PERIÓDICO|^Diciembre|^\(Cuarta", line):
                continue
            vm = re.search(r"\$\s*([\d,]+(?:\.\d+)?)\s*/\s*m", line)
            if vm:
                name = norm(" ".join(name_buf))
                # limpiar encabezados/índices pegados al nombre
                name = re.sub(r"^(COLONIA O FRACCIONAMIENTO )?(VALOR )?", "", name)
                name = re.sub(r"^\d{1,3} ", "", name)
                name = re.sub(r" TABLA .*$", "", name)
                val = float(vm.group(1).replace(",", ""))
                if name and "SIN DELIMITACION" not in name and val >= 100:
                    rows.append((sector, name, int(val)))
                name_buf = []
                continue
            if re.fullmatch(r"\d{1,3}", line):
                name_buf = []
                continue
            name_buf.append(line)

    # una colonia puede aparecer en 2+ sectores: promediar
    agg = {}
    for sector, name, val in rows:
        agg.setdefault(name, []).append((sector, val))
    result = {n: (vs[0][0], round(sum(v for _, v in vs) / len(vs)))
              for n, vs in agg.items()}
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["colonia", "sector", "valor_m2"])
        for n, (s, v) in sorted(result.items()):
            w.writerow([n, s, v])
    return result


# ----------------------------------------------- 2. cruzar con polígonos DCAH
def build_index(ley):
    """Índices variante→[(sector, valor)] con especificidad decreciente."""
    levels = [{} for _ in range(5)]  # full, base, canon, sin sección, slug

    def add(level, key, sv):
        if key:
            levels[level].setdefault(key, []).append(sv)

    for full, sv in ley.items():
        _, base = split_tipo(full)
        add(0, full, sv)
        add(1, base, sv)
        cb = canon(base)
        add(2, cb, sv)
        add(2, cb.replace(" ", ""), sv)
        # la ley antepone "UNIDAD HABITACIONAL" a INFONAVIT; DCAH suele usar
        # "INFONAVIT X" como nombre — indexar también esa forma
        if "INFONAVIT" in full and not base.startswith("INFONAVIT"):
            add(2, canon("INFONAVIT " + base), sv)
        ss = strip_seccion(cb)
        if ss != cb:
            add(3, ss, sv)
        add(4, slug(cb), sv)
        add(4, slug(strip_seccion(cb)), sv)
    return levels


def avg(svs):
    return (svs[0][0], round(sum(v for _, v in svs) / len(svs)))


def match(ley, gdf):
    """Asigna valor_m2 a cada polígono DCAH por nombre normalizado."""
    levels = build_index(ley)
    names = ["exacto", "base", "canon", "sin_seccion", "slug"]
    fuzzy_keys = list(levels[2].keys())

    matched, method = [], []
    for _, row in gdf.iterrows():
        nom = norm(str(row["NOM_ASEN"]))
        tipo = norm(str(row["TIPO"]))
        cn = canon(nom)
        sv = how = None
        for lvl in range(5):
            cands = None
            if lvl == 0:
                cands = levels[0].get(f"{tipo} {nom}".strip())
            elif lvl == 1:
                cands = levels[1].get(nom)
            elif lvl == 2:
                cands = levels[2].get(cn) or levels[2].get(cn.replace(" ", ""))
            elif lvl == 3:
                ss = strip_seccion(cn)
                cands = levels[3].get(ss) or levels[1].get(ss) or levels[2].get(ss)
            else:
                cands = levels[4].get(slug(cn)) or levels[4].get(slug(strip_seccion(cn)))
            if cands:
                sv, how = avg(cands), names[lvl]
                break
        if sv is None:
            best, best_r = None, 0.0
            for k in fuzzy_keys:
                if not k or abs(len(k) - len(cn)) > 6 or k[0] != (cn[:1] or " "):
                    continue
                r = SequenceMatcher(None, cn, k).ratio()
                if r > best_r:
                    best, best_r = k, r
            if best_r >= 0.88:
                sv, how = avg(levels[2][best]), f"fuzzy({best_r:.2f})→{best}"
        matched.append(sv)
        method.append(how)
    gdf["sector"] = [sv[0] if sv else None for sv in matched]
    gdf["valor_m2"] = [sv[1] if sv else None for sv in matched]
    gdf["match"] = method
    return gdf


def load_jma():
    """Carga la transcripción manual de los planos de Jesús María.

    Devuelve el mismo formato que extract_ley(): {nombre_norm: (sector, valor)}.
    El "sector" aquí es la localidad del plano (JM S1..S4, JGP, MV S1/3/4...).
    Valores < $100/m² son rústicos y se descartan, igual que en la capital.
    """
    agg = {}
    with open(JMA_CSV, newline="") as f:
        for row in csv.DictReader(f):
            val = float(row["valor_m2"])
            if val < 100:
                continue
            name = norm(row["colonia"])
            agg.setdefault(name, []).append((row["localidad"], val))
    return {n: (vs[0][0], round(sum(v for _, v in vs) / len(vs)))
            for n, vs in agg.items()}


def process_municipio(cve_mun, nombre, ley, dcah):
    gdf = dcah[dcah["CVE_MUN"] == cve_mun].copy().to_crs(epsg=4326)
    print(f"\n== {nombre} ({cve_mun}): {len(gdf)} polígonos DCAH, "
          f"{len(ley)} nombres en tablas ==")
    gdf = match(ley, gdf)
    gdf["municipio"] = nombre
    ok = gdf["valor_m2"].notna()
    print(f"Con valor asignado: {ok.sum()} ({ok.mean()*100:.0f}%)")
    from collections import Counter
    print(Counter(m.split("(")[0] if m else "sin match" for m in gdf["match"]))
    return gdf[ok]


def main():
    ley_ags = extract_ley()
    print(f"Colonias en la ley de la capital (únicas, urbanas): {len(ley_ags)}")
    ley_jma = load_jma()

    dcah = gpd.read_file(DCAH_SHP)
    ags = process_municipio("001", "Aguascalientes", ley_ags, dcah)
    jma = process_municipio("005", "Jesús María", ley_jma, dcah)

    import pandas as pd
    out = pd.concat([ags, jma])[
        ["CVEGEO", "NOM_ASEN", "TIPO", "CP", "municipio", "sector",
         "valor_m2", "geometry"]]
    out = gpd.GeoDataFrame(out, crs=ags.crs)
    out.to_file(OUT, driver="GeoJSON")
    print(f"\nEscrito {OUT} ({os.path.getsize(OUT)//1024} KB)")
    print(out.groupby("municipio")["valor_m2"].describe().round(0).to_string())


if __name__ == "__main__":
    main()
