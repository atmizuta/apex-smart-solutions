-- Desfaz 20261016150000_discador_raiox.sql (§96). Depois, recriar discador_consultores sem as colunas novas rodando o trecho
-- "create or replace function public.discador_consultores" de supabase/migrations/20261015210000_discador_operacao.sql (+ grants).
drop function if exists public.discador_consultor_raiox(int, date, date, text);
drop function if exists public.discador_consultores(date, date, text);
drop function if exists public.discador_pausas(date, date, text, int);
update public.config set valor = (valor::jsonb - 'pausa_min' - 'curta_seg')::text, atualizado_em = now() where chave = 'discador';
