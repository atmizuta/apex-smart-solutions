# §146.1: monta o SQL de conferência: begin + migrations (sem begin/commit) + fixture + check.
# O check termina com raise exception 'RESULTADO: ...' -> tudo é desfeito. Uso:
#   python supabase/tests/leads_dist_montar.py SAIDA.sql [MIG1.sql MIG2.sql ...] -- CHECK.sql   (sem migration = banco como está)
import pathlib, sys

def corpo(p):
    linhas = pathlib.Path(p).read_text(encoding='utf-8').splitlines()
    return '\n'.join(l for l in linhas if l.strip().lower() not in ('begin;', 'commit;'))

args = sys.argv[1:]
if len(args) < 3 or '--' not in args:
    sys.exit('uso: leads_dist_montar.py SAIDA.sql [MIG1.sql ...] -- CHECK.sql')
saida, resto = args[0], args[1:]
i = resto.index('--')
migs, check = resto[:i], resto[i + 1]
aqui = pathlib.Path(__file__).parent
partes = ['begin;'] + [corpo(m) for m in migs] + [corpo(aqui / 'leads_dist_fixture.sql'), corpo(check)]
texto = '\n\n'.join(partes) + '\n'
pathlib.Path(saida).write_text(texto, encoding='utf-8')
print(f'{saida}: {len(texto.encode("utf-8"))} bytes')
