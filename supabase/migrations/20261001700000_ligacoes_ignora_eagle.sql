-- 01/10/2026 — ligações de usuários da Eagle (eagle.*) não fazem parte da operação da Apex. REGRAS_NEGOCIO.md seção 65.
-- (1) Gatilho que descarta qualquer ligação cujo usuário começa com "eagle" (mesmo padrão do producao_pedidos_ignora_gross:
--     vale até para quem estiver com o painel antigo aberto). (2) Apaga as que já foram importadas.
-- Em 01/10: 8.682 das 17.497 ligações eram da Eagle (19 usuários), 150 delas para números de lead da Apex — inflavam as
-- tentativas dos leads e a tabela "Todos os consultores". Os arquivos Excel originais continuam com o usuário.
create or replace function public.ligacoes_manuais_ignora_eagle()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if lower(btrim(coalesce(new.usuario, ''))) like 'eagle%' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists ligacoes_manuais_ignora_eagle on public.ligacoes_manuais;
create trigger ligacoes_manuais_ignora_eagle
  before insert or update on public.ligacoes_manuais
  for each row execute function public.ligacoes_manuais_ignora_eagle();

delete from public.ligacoes_manuais where lower(btrim(usuario)) like 'eagle%';
