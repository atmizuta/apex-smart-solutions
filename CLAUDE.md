# Painel de Clientes Apex — regras para o Claude

Este repositório é o **painel de clientes (CRM) da Apex Smart Solutions**, publicado em
https://apexsmart.com.br/painel_clientes_apex.html. Documentação completa das regras de negócio:
`REGRAS_NEGOCIO.md` (documento vivo — registre nele toda mudança).

## Antes de qualquer alteração

1. **Parta sempre da versão atual deste repositório** (`git pull origin main`). Nunca altere a partir de
   uma cópia antiga — de conversas anteriores, de outra pasta ou do computador. Foi isso que fez o
   design sumir do ar várias vezes em setembro/2026 (ver `REGRAS_NEGOCIO.md` seção 45).
2. Confira que está na versão com o design atual: `_template.html` tem `data-apex-visual` na tag `<html>`
   ou o menu `<aside class="sidebar">`, e as fontes Barlow. Se não tiver, **pare e avise** — é uma versão antiga.

## O design não muda sem pedido explícito

O painel segue o manual de identidade **"Sinal de Ápice"** (Apex + Claro empresas). Ao fazer alterações
de funcionalidade, **não mexa** em:

- o bloco `<style>` do `_template.html` ("SISTEMA VISUAL SINAL DE ÁPICE", seções 1 a 7);
- o menu lateral (`aside.sidebar`, `nav#tabsNav`, `#sbIndicator`, grupos `.navGroupLabel`) e o cabeçalho
  de página (`#pageHead`, `#pageTitle`, `#pageSub`);
- o módulo de animação `ApexMotion`, `mostrarAviso` e `fecharOverlay`.

Para telas, campos ou modais novos:

- reaproveite as classes existentes: `.card`, `.kpiGrid`/`.kpiCard`, `table.tbl`, `.btn` (`.btn-sm`,
  `.btn-outline`, `.btn-danger`), `.field`, `.badge`, `.filterPill`, `.overlay`/`.modal`;
- cores só por variável (`var(--c-sinal)`, `var(--c-bordo)`, `var(--muted)`, `var(--st-ganho)` etc.) —
  **nunca cor fixa em hex**; o único verde permitido é o de "ganho" (`--st-ganho`);
- aba nova: um `<button data-tab="…" data-sub="subtítulo">` dentro de `<nav id="tabsNav">`, no mesmo
  formato das outras (`<svg …>` + `<span class="sbLabel">Nome</span>`), no grupo certo;
- avisos ao usuário com `mostrarAviso(msg, 'ok'|'erro'|'info')`, não `alert()`; fechar modal com
  `fecharOverlay(el)`.

## Gerar, testar e publicar

1. Edite só o `_template.html`. O `painel_clientes_apex.html` é gerado: `python build_painel.py`
   (nunca edite o painel gerado à mão).
2. Rode os testes: `bash run_tests.sh` (precisa do `node_modules` com `jsdom`, `jspdf`, `jszip`, `xlsx`,
   `papaparse`). Tudo tem que passar; "pulado" só é aceitável para testes que dependem de planilhas reais.
3. **Antes de publicar**, baixe o painel que está no ar e compare com o gerado aqui. Se o do ar tiver algo
   que o repositório não tem, alguém publicou por fora: **junte as duas versões, nunca sobrescreva**.
4. Depois de publicar: atualize o `REGRAS_NEGOCIO.md`, faça commit e `git push origin main`.

## Segurança — este repositório é público

- **Nunca** coloque senha, token ou chave privada em arquivo do repositório (inclusive scripts de deploy).
  Use variáveis de ambiente ou arquivos locais listados no `.gitignore`.
- **Nunca** coloque dados de clientes ou leads (bases, planilhas, faturas reais, CPF/CNPJ, telefones).
  O `.gitignore` já bloqueia os nomes conhecidos (`base_clientes*`, `LeadsFibra*`, `deploy_*.py` etc.).
- A chave "anon" do Supabase no `build_painel.py` é pública por natureza (fica no navegador); a proteção
  dos dados é feita pelas regras de acesso (RLS) no Supabase.
