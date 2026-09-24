import json, re, unicodedata, math
from shapely.geometry import Point, Polygon

def normcity(s):
    if not s: return ''
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s

with open('kmz_fixa_polygons.json', encoding='utf-8') as f:
    by_city = json.load(f)

with open('geocode_results.json', encoding='utf-8') as f:
    geo = json.load(f)

RAIO = {'GPON': 150, 'HFC': 50}

def project(lon, lat, lon0, lat0):
    x = (lon - lon0) * 111320.0 * math.cos(math.radians(lat0))
    y = (lat - lat0) * 110540.0
    return (x, y)

resultado = {}
cidades_sem_kmz = set()

for linha, g in geo.items():
    if g['status'] != 'OK':
        resultado[linha] = {'viabilidade': None, 'motivo': 'geocodificacao_falhou'}
        continue
    lat0, lon0 = g['lat'], g['lng']
    cidade_norm = normcity(g.get('cidade_geo', ''))
    candidatos = by_city.get(cidade_norm)
    if not candidatos:
        cidades_sem_kmz.add(g.get('cidade_geo', '(vazio)'))
        resultado[linha] = {'viabilidade': None, 'motivo': 'sem_kmz_na_cidade', 'cidade_geo': g.get('cidade_geo')}
        continue

    min_dist = {'GPON': float('inf'), 'HFC': float('inf')}
    # filtro grosseiro por bbox (expandido ~0.005 grau ~500m) antes de projetar
    for cand in candidatos:
        minlon, minlat, maxlon, maxlat = cand['bbox']
        pad = 0.006
        if not (minlon - pad <= lon0 <= maxlon + pad and minlat - pad <= lat0 <= maxlat + pad):
            continue
        tec = cand['tecnologia']
        if min_dist[tec] <= 0:
            continue  # ja achou ponto dentro do poligono dessa tecnologia, nao precisa continuar
        for ring in cand['rings']:
            proj_ring = [project(lon, lat, lon0, lat0) for lon, lat in ring]
            try:
                poly = Polygon(proj_ring)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                d = poly.distance(Point(0, 0))
            except Exception:
                continue
            if d < min_dist[tec]:
                min_dist[tec] = d

    dist_gpon = min_dist['GPON']
    dist_hfc = min_dist['HFC']

    if dist_gpon <= RAIO['GPON']:
        viab = 'Fibra'
    elif dist_hfc <= RAIO['HFC']:
        viab = 'HFC'
    else:
        viab = 'NÃO'

    resultado[linha] = {
        'viabilidade': viab,
        'dist_gpon_m': None if dist_gpon == float('inf') else round(dist_gpon, 1),
        'dist_hfc_m': None if dist_hfc == float('inf') else round(dist_hfc, 1),
        'cidade_geo': g.get('cidade_geo'),
        'location_type': g.get('location_type'),
    }

with open('viabilidade_resultado.json', 'w', encoding='utf-8') as f:
    json.dump(resultado, f, ensure_ascii=False, indent=1)

from collections import Counter
cnt = Counter(v['viabilidade'] for v in resultado.values())
print('Resumo:', dict(cnt))
print()
print('Cidades geocodificadas sem KMZ carregado nesse arquivo:', sorted(cidades_sem_kmz))
print()
for linha in list(resultado.keys())[:8]:
    print(linha, resultado[linha])
