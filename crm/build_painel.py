"""
Script de build do painel_clientes_apex.html a partir de _template.html.

Sempre use este script para regenerar o painel — ele garante que TODOS os
placeholders sejam substituídos. Uma regeneração manual/parcial já causou
um bug em produção (05/08/2026): substituiu só os logos e esqueceu de
preencher SUPABASE_URL/SUPABASE_ANON_KEY, deixando o painel com os
placeholders literais no ar e quebrando o login de todos os usuários.

Uso:
    python3 build_painel.py

Requer, na mesma pasta ou em /tmp:
  - _template.html (fonte)
  - logo da Apex e da Claro em base64 (recupera automaticamente do
    painel_clientes_apex.html atual, se /tmp/*.txt não existir)
"""
import re
import sys

SUPABASE_URL = "https://mdgfboijyqfkggcrhptn.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZ2Zib2lqeXFma2dnY3JocHRuIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzMyODEsImV4cCI6MjEwMTM0OTI4MX0."
    "DuwpVXtzYqjE3XwGveHMK2cGS6j8jzyX2ovDZB19yBA"
)

PLACEHOLDERS = {
    "__SUPABASE_URL__": lambda: SUPABASE_URL,
    "__SUPABASE_ANON_KEY__": lambda: SUPABASE_ANON_KEY,
    "__APEX_LOGO_B64__": None,   # resolvido dinamicamente (ver main)
    "__CLARO_LOGO_B64__": None,  # resolvido dinamicamente (ver main)
}


def read_or_recover_logo(tmp_path, pattern, current_file="painel_clientes_apex.html"):
    """Tenta ler o base64 de /tmp; se não existir, recupera do painel já publicado."""
    try:
        with open(tmp_path, encoding="utf-8") as f:
            b64 = f.read().strip()
            if b64:
                return b64
    except FileNotFoundError:
        pass
    with open(current_file, encoding="utf-8") as f:
        html = f.read()
    m = re.search(pattern, html)
    if not m:
        raise RuntimeError(f"não foi possível recuperar o logo (padrão {pattern}) nem de /tmp nem do painel atual")
    b64 = m.group(1)
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(b64)
    return b64


def main():
    with open("_template.html", encoding="utf-8") as f:
        tpl = f.read()

    apex_b64 = read_or_recover_logo("/tmp/apex_logo_b64.txt", r"data:image/png;base64,([A-Za-z0-9+/=]+)")
    claro_b64 = read_or_recover_logo("/tmp/claro_logo_b64.txt", r"data:image/jpeg;base64,([A-Za-z0-9+/=]+)")

    out = tpl
    out = out.replace("__SUPABASE_URL__", SUPABASE_URL)
    out = out.replace("__SUPABASE_ANON_KEY__", SUPABASE_ANON_KEY)
    out = out.replace("__APEX_LOGO_B64__", apex_b64)
    out = out.replace("__CLARO_LOGO_B64__", claro_b64)

    # trava de segurança: falha alto e claro se sobrar QUALQUER placeholder __X__ — EXCETO os do
    # Dashboard de Produção, que são de propósito preenchidos em tempo real no navegador (ver
    # loadProducaoDashboard() em _template.html), não neste build. Eles aparecem como texto literal
    # dentro das chamadas .replace(...) do JS, não dentro do template embutido (que está em base64).
    RUNTIME_PLACEHOLDERS = {"__DATA__", "__ADMIN_MODE__", "__ADMIN_BADGE__", "__UPDATED_AT__"}
    leftover = sorted(set(re.findall(r"__[A-Z_]+__", out)) - RUNTIME_PLACEHOLDERS)
    if leftover:
        print(f"ERRO: sobraram placeholders não substituídos: {leftover}", file=sys.stderr)
        sys.exit(1)

    with open("painel_clientes_apex.html", "w", encoding="utf-8") as f:
        f.write(out)

    print(f"OK — painel_clientes_apex.html gerado ({len(out.encode('utf-8'))} bytes), sem placeholders pendentes.")


if __name__ == "__main__":
    main()
