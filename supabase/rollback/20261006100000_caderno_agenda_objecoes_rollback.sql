-- Desfaz 20261006100000_caderno_agenda_objecoes.sql (§72). APAGA as anotações e retornos: só usar antes de ter dados reais
-- ou depois de exportar as tabelas.
drop function if exists public.mesa_retornos_objecoes(date);
drop table if exists public.caderno_ia_chamadas;
drop table if exists public.objecoes_uso;
drop table if exists public.objecoes_respostas;
drop table if exists public.agenda_retornos;
drop table if exists public.caderno_notas;
drop function if exists public.caderno_agenda_preenche();
