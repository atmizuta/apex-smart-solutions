import re, json, unicodedata

def normcity(s):
    if not s: return ''
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)  # remove tudo que nao for letra/numero (espaço, apostrofo, hifen...)
    return s

with open('/tmp/kmz_check/doc.kml', 'r', encoding='utf-8') as f:
    content = f.read()

placemarks = re.findall(r'<Placemark>(.*?)</Placemark>', content, re.S)
print('total placemarks:', len(placemarks))

by_city = {}
count_tec = {}
for pm in placemarks:
    tec_m = re.search(r'<SimpleData name="TECNOLOGIA">([^<]*)</SimpleData>', pm)
    tec = tec_m.group(1) if tec_m else None
    if tec not in ('GPON', 'HFC'):
        continue
    cidade_m = re.search(r'<SimpleData name="CIDADE">([^<]*)</SimpleData>', pm)
    cidade = cidade_m.group(1) if cidade_m else ''
    cidade_norm = normcity(cidade)
    count_tec[tec] = count_tec.get(tec, 0) + 1

    # extrai todos os aneis de coordenadas (outerBoundaryIs/LinearRing/coordinates) dentro de Polygon/MultiGeometry
    rings = []
    for coord_txt in re.findall(r'<outerBoundaryIs><LinearRing><coordinates>([^<]*)</coordinates>', pm):
        pts = []
        for tri in coord_txt.strip().split():
            parts = tri.split(',')
            if len(parts) >= 2:
                lon = float(parts[0]); lat = float(parts[1])
                pts.append([lon, lat])
        if len(pts) >= 3:
            rings.append(pts)
    if not rings:
        continue
    # bbox de todos os aneis do placemark
    all_pts = [p for r in rings for p in r]
    minlon = min(p[0] for p in all_pts); maxlon = max(p[0] for p in all_pts)
    minlat = min(p[1] for p in all_pts); maxlat = max(p[1] for p in all_pts)

    by_city.setdefault(cidade_norm, []).append({
        'cidade_label': cidade,
        'tecnologia': tec,
        'rings': rings,
        'bbox': [minlon, minlat, maxlon, maxlat],
    })

print('contagem por tecnologia (com geometria valida):', count_tec)
print('cidades distintas:', len(by_city))

with open('kmz_fixa_polygons.json', 'w', encoding='utf-8') as f:
    json.dump(by_city, f)

import os
print('tamanho do json:', os.path.getsize('kmz_fixa_polygons.json'), 'bytes')
