-- Desfaz 20260930300000_leads_por_aba.sql (aba Digital por aba da planilha).
-- ATENÇÃO: a chave volta a ser só o `id`. Se o MESMO id existir em duas abas, a troca da chave falha: nesse
-- caso apague antes a linha repetida (por exemplo a da aba REPIQUE) ou mantenha a chave (aba, id).
-- Reverta o PAINEL antes (o painel novo lê a coluna `aba`) e reimplante a versão antiga da Edge Function sync-leads
-- (que usa onConflict "id").
alter table public.leads drop constraint if exists leads_pkey;
alter table public.leads add constraint leads_pkey primary key (id);
drop index if exists public.idx_leads_aba;
alter table public.leads drop column if exists aba;

-- volta a reconciliação sem o parâmetro de aba
drop function if exists public.reconciliacao_neocrm(date, date, text);
-- (recriar a versão de 2 parâmetros: conteúdo em supabase_schema.sql / histórico do Supabase "reconciliacao_neocrm")
-- A categoria dos novos status de "perdido" NÃO é revertida aqui de propósito (é a regra nova; a próxima
-- sincronização com a função antiga os devolveria a "andamento").
