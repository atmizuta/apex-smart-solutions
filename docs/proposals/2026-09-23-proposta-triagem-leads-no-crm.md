# Proposta: triagem automática de leads dentro do painel

**De:** Rafael (desenvolvimento e planejamento)
**Assunto:** adicionar classificação automática de CNPJ e viabilidade dos leads no painel de clientes (mesmo projeto Supabase)

## O problema

- Hoje investimos ~R$1.000/dia em Meta Ads. No funil móvel, a conversão geral é ~27%, mas varia de **11% a 40%** dependendo do consultor — não tem processo padrão.
- No funil de Fibra, quase **metade dos leads** morre por falta de viabilidade técnica no endereço — descoberto só depois que o anúncio já foi clicado, o formulário preenchido e um consultor já gastou tempo checando manualmente.
- Às vezes passa CNPJ inválido ou pessoa física se passando por empresa, mesmo com a pergunta de qualificação no formulário.

## O que estou propondo

Adicionar ao painel (mesmo projeto Supabase que você já mantém) uma automação que, assim que um lead novo aparece na planilha de origem:

1. Valida o CNPJ de verdade (API gratuita da Receita Federal).
2. Para leads de Fibra, verifica viabilidade técnica (o mesmo portal que já usamos manualmente).
3. Classifica o lead: **Qualificado**, **Sem viabilidade**, **CNPJ inválido** ou **Duplicado**.
4. Mostra isso numa aba nova do painel — **"Leads Qualificados"** — já com o plano sugerido (seguindo a régua de preço que fechei com o time) e um link pronto pra abrir a conversa no WhatsApp.

Fiz uma prévia visual de como ficaria (mockup, dados de exemplo, mesmo estilo visual do painel atual) — te mostro na hora, ou posso compartilhar o link.

## O que isso toca no seu projeto

- Tabela `leads`: só **colunas novas** adicionadas (nada existente é removido ou alterado).
- Uma Edge Function nova, ou uma extensão da `sync-leads` — rodando num Cron do Supabase em vez de depender do clique manual em "Atualizar agora".
- Uma aba nova no painel. As abas e funcionalidades existentes não mudam.

## O que não muda

- O fluxo manual de hoje (planilha + WhatsApp) continua funcionando exatamente igual — isso só adiciona informação, não substitui nada.
- Nenhuma tabela, política de acesso (RLS) ou tela existente é alterada.
- Nenhum dado é apagado.

## O que eu preciso de você

- Seu OK pra mexer no mesmo projeto Supabase / mesmo código do painel.
- Combinar como evitar que um sobrescreva o trabalho do outro no deploy — hoje trabalhamos em cópias separadas do mesmo arquivo; talvez valha a pena um repositório Git compartilhado antes de eu começar a mexer.
- Confirmar se meu acesso ao portal de viabilidade é suficiente pra eu documentar a chamada exata (endpoint/parâmetros) que a automação vai usar.
