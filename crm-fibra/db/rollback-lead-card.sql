-- crm-fibra/db/rollback-lead-card.sql
-- Desfaz a entrega "card de lead + proposta": apaga as três tabelas novas
-- (e, com elas, todas as propostas salvas) e devolve a view ao formato anterior.
-- `create or replace view` não consegue remover colunas, por isso drop + create.

drop table if exists crm_fibra.proposta_itens;
drop table if exists crm_fibra.propostas;
drop table if exists crm_fibra.catalogo_planos;

drop view if exists crm_fibra.leads_segmentados;

create view crm_fibra.leads_segmentados as
select
  c.cnpj_digits,
  c.razao_social,
  c.cidade,
  c.ddd,
  c.tel1,
  c.tel2,
  c.telefone_contato,
  c.email,
  c.arpu,
  c.apto_renovacao,
  c.cep_cabeado,
  c.linhas_fixas,
  case
    when c.cep_cabeado = 'CEP Cabeado' and coalesce(c.linhas_fixas, 0) = 0
      then 'fibra_candidato'
    else null
  end as camada_fibra,
  case
    when c.tempo_contrato_voz > 15 then 'apto_agora'
    when c.tempo_contrato_voz = 15 then 'apto_1_mes'
    when c.tempo_contrato_voz = 14 then 'apto_2_meses'
    else null
  end as camada_renovacao,
  a.consultor_id as dono_consultor_id,
  a.status_contato,
  a.atribuido_em,
  a.ultimo_contato_em
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits
where c.cnpj_digits is not null and c.cnpj_digits <> '';

grant select on crm_fibra.leads_segmentados to service_role;
