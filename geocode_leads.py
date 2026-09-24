import json, time, urllib.request, urllib.parse
import openpyxl

KEY = 'AIzaSyCUSLrdnCeWcopObJnTuQt0eRcPtawcFS4'

wb = openpyxl.load_workbook('/sessions/affectionate-eloquent-bohr/mnt/uploads/LeadsFibraVendaGross.xlsx', data_only=True)
ws = wb['Planilha1']

def geocode(query):
    url = 'https://maps.googleapis.com/maps/api/geocode/json?' + urllib.parse.urlencode({'address': query, 'key': KEY, 'region': 'br'})
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

results = {}
rows = list(ws.iter_rows(min_row=2, values_only=False))
print('total linhas:', len(rows))

for row in rows:
    linha = row[0].row
    cep = row[20].value
    rua = row[21].value
    nro = row[22].value
    bairro = row[23].value
    cidade = row[25].value
    uf = row[26].value

    partes = []
    if rua: partes.append(str(rua).strip() + (f', {nro}' if nro else ''))
    if bairro: partes.append(str(bairro).strip())
    if cidade: partes.append(str(cidade).strip())
    if uf: partes.append(str(uf).strip())
    cep_fmt = None
    if cep:
        cepd = ''.join(c for c in str(cep) if c.isdigit())
        if len(cepd) == 8:
            cep_fmt = cepd[:5] + '-' + cepd[5:]
    if cep_fmt: partes.append(cep_fmt)
    partes.append('Brasil')
    query = ', '.join(partes)

    try:
        resp = geocode(query)
        status = resp.get('status')
        if status == 'OK' and resp.get('results'):
            r0 = resp['results'][0]
            loc = r0['geometry']['location']
            localityComp = next((c for c in r0['address_components'] if 'locality' in c['types']), None)
            admin2Comp = next((c for c in r0['address_components'] if 'administrative_area_level_2' in c['types']), None)
            cidade_geo = (localityComp or admin2Comp or {}).get('long_name', '')
            results[linha] = {
                'status': 'OK', 'lat': loc['lat'], 'lng': loc['lng'],
                'formatted': r0['formatted_address'], 'cidade_geo': cidade_geo,
                'location_type': r0['geometry'].get('location_type'), 'query': query,
            }
        else:
            results[linha] = {'status': status, 'query': query, 'error': resp.get('error_message')}
    except Exception as e:
        results[linha] = {'status': 'EXCEPTION', 'query': query, 'error': str(e)}

with open('geocode_results.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=1)

ok = sum(1 for v in results.values() if v['status'] == 'OK')
print(f'geocodificados com sucesso: {ok}/{len(results)}')
for linha, v in list(results.items())[:5]:
    print(linha, v.get('status'), v.get('formatted', v.get('error')))
