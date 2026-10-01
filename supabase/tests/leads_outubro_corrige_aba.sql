-- Manutenção pontual de 01/10/2026 (REGRAS_NEGOCIO.md seção 60.3). Rodar SÓ DEPOIS de:
--   1) reimplantar a sync-leads com o SHEET_TABS novo (OUTUBRO = gid 1292366194, SETEMBRO = gid 1519521435);
--   2) clicar "Atualizar agora" na aba Digital (os leads de outubro passam a existir com aba = 'OUTUBRO').
-- Os leads de outubro que a sync antiga gravou como SETEMBRO ficam duplicados (mesmo id nas duas abas).
-- Este script apaga só a cópia errada em SETEMBRO — só de quem já existe em OUTUBRO. Nada mais é tocado.
-- leads_followups liga por lead_id (sem aba), então os retornos agendados continuam valendo.

-- Passo A (só leitura): o que vai sair.
select s.id, s.consultor, s.criado_em_lead
  from public.leads s join public.leads o on o.id = s.id and o.aba = 'OUTUBRO'
 where s.aba = 'SETEMBRO'
 order by s.criado_em_lead;

-- Passo B (escrita, com ok do Rafael): apaga as cópias erradas e confere em seguida.
begin;
delete from public.leads s using public.leads o
 where s.aba = 'SETEMBRO' and o.aba = 'OUTUBRO' and o.id = s.id;
select aba, count(*) from public.leads group by aba order by aba;
-- conferir os números e então: commit;  (ou rollback; se algo estiver estranho)
