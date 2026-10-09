-- Desfaz 20261009200000_operacao_campinas.sql (§78). Publique ANTES o painel anterior (ele não lê profiles.operacao
-- nem chama vendedores_operacao); com o painel novo no ar, sem a função todo mundo vira Apex e aparece um aviso de erro.
drop function if exists public.vendedores_operacao();
drop trigger if exists trg_profiles_trava_operacao on public.profiles;
drop function if exists public.profiles_trava_operacao();
alter table public.profiles drop constraint if exists profiles_operacao_check;
alter table public.profiles drop column if exists operacao;
-- Vínculos dos 4 consultores de Campinas com o NeoCRM: só apague se for desfazer a operação inteira
-- (sem eles a aba Pedidos Parados desses consultores fica vazia).
-- delete from public.consultor_neo where neo_usuario_id in (103626, 103627, 103628, 103629);
-- O cargo do Jaime (supervisor) não volta para admin aqui de propósito.
