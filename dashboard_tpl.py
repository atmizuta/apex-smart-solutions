"""Extrai e empacota o template do Dashboard de Produção (iframe srcdoc).

O template fica em base64 dentro do _template.html (constante PRODUCAO_DASHBOARD_TPL_B64).
Para editar:  python dashboard_tpl.py extrair   -> gera _dashboard_producao.html
              (editar o arquivo)
              python dashboard_tpl.py empacotar -> grava de volta no _template.html
_dashboard_producao.html é temporário (ignorado no git) — a fonte da verdade continua no _template.html.
"""
import base64
import re
import sys

TEMPLATE = "_template.html"
EXTRAIDO = "_dashboard_producao.html"
PADRAO = re.compile(r'(const PRODUCAO_DASHBOARD_TPL_B64 = ")([A-Za-z0-9+/=]+)(")')


def extrair():
    s = open(TEMPLATE, encoding="utf-8", newline="").read()
    m = PADRAO.search(s)
    if not m:
        sys.exit("PRODUCAO_DASHBOARD_TPL_B64 não encontrado")
    open(EXTRAIDO, "w", encoding="utf-8", newline="").write(base64.b64decode(m.group(2)).decode("utf-8"))
    print(f"OK — {EXTRAIDO} extraído")


def empacotar():
    s = open(TEMPLATE, encoding="utf-8", newline="").read()
    novo = base64.b64encode(open(EXTRAIDO, encoding="utf-8", newline="").read().encode("utf-8")).decode("ascii")
    s2, n = PADRAO.subn(lambda m: m.group(1) + novo + m.group(3), s, count=1)
    if n != 1:
        sys.exit("PRODUCAO_DASHBOARD_TPL_B64 não encontrado")
    open(TEMPLATE, "w", encoding="utf-8", newline="").write(s2)
    print(f"OK — {EXTRAIDO} empacotado no {TEMPLATE}")


if __name__ == "__main__":
    {"extrair": extrair, "empacotar": empacotar}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
