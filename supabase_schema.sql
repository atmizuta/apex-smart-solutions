-- ============================================================
-- PAINEL DE CLIENTES APEX — schema Supabase
-- Execute este script inteiro em: Supabase > SQL Editor > New query > Run
-- É seguro rodar de novo mesmo se já tiver rodado antes (todo "create" usa
-- "if not exists" e toda policy dá "drop" antes de recriar) — então, se você
-- já rodou uma versão anterior deste script, é só rodar o arquivo inteiro de
-- novo pra pegar as tabelas/tabelas novas (ex.: funil de vendas, seção 4).
-- ============================================================

-- 1) PERFIS (dados extras de cada usuário, ligados ao Auth do Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  username text unique not null,
  role text not null default 'consultor' check (role in ('admin','supervisor','consultor')),
  created_at timestamptz not null default now()
);

-- 2) CLIENTES (base carregada a partir da planilha)
create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  cnpj text,
  razao_social text,
  tempo_contrato_voz numeric,
  linhas_voz numeric,
  linhas_fixas numeric,
  telefone_contato text,
  nome_admin text,
  cidade text,
  apto_renovacao text,
  cep text,
  tel1 text,
  tel2 text,
  email text,
  cep_cabeado text,
  valor_contrato numeric,
  arpu numeric,
  qtde_silentes numeric,
  ddd text,
  atualizado_em timestamptz not null default now()
);

-- se a tabela já existir de uma execução anterior deste script, garante a coluna nova
alter table public.clientes add column if not exists ddd text;

-- CNPJ é sempre salvo formatado (XX.XXX.XXX/XXXX-XX — ver cleanCNPJ() no upload da base), então
-- buscar digitando só números não batia com "cnpj.ilike" na busca de clientes (24/08/2026).
-- Coluna gerada automaticamente com só os dígitos do CNPJ, usada como alvo extra de busca —
-- funciona com ou sem pontuação, e mesmo com CNPJ parcial. Ver seção de busca no REGRAS_NEGOCIO.md.
alter table public.clientes add column if not exists cnpj_digits text
  generated always as (regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')) stored;

-- necessário para busca parcial rápida (ILIKE '%termo%') — precisa vir antes dos índices que o usam
create extension if not exists pg_trgm;

create index if not exists idx_clientes_razao on public.clientes using gin (razao_social gin_trgm_ops);
create index if not exists idx_clientes_admin on public.clientes using gin (nome_admin gin_trgm_ops);
create index if not exists idx_clientes_email on public.clientes (email);
create index if not exists idx_clientes_cnpj on public.clientes (cnpj);
create index if not exists idx_clientes_cnpj_digits on public.clientes (cnpj_digits);

-- 3) LOG DE CONSULTAS (uma linha por busca realizada)
create table if not exists public.consultas_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  termo text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_consultas_log_user on public.consultas_log(user_id);

-- View com o total de consultas e a última consulta de cada usuário (para a aba Consultores)
create or replace view public.consultas_resumo
with (security_invoker = true) as
  select user_id, count(*)::int as total, max(criado_em) as ultima_consulta
  from public.consultas_log
  group by user_id;

-- ============================================================
-- FUNÇÃO AUXILIAR: retorna o perfil (role) do usuário logado
-- ============================================================
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- RLS (regras de acesso por linha)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.clientes enable row level security;
alter table public.consultas_log enable row level security;

-- --- profiles ---
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using ( auth.uid() = id or public.get_my_role() in ('admin','supervisor') );

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles for insert
  with check (
    (auth.uid() = id and role = 'consultor')              -- autocadastro (usado no "criar usuário") sempre entra como consultor
    or public.get_my_role() = 'admin'                      -- admin pode inserir com qualquer perfil (inclusive admin)
    or (public.get_my_role() = 'supervisor' and role = 'consultor')  -- supervisor só cria consultor
  );

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (
    auth.uid() = id
    or (public.get_my_role() = 'admin' and role in ('admin','supervisor','consultor'))
    or (public.get_my_role() = 'supervisor' and role = 'consultor')
  )
  with check (
    auth.uid() = id
    or (public.get_my_role() = 'admin' and role in ('admin','supervisor','consultor'))
    or (public.get_my_role() = 'supervisor' and role = 'consultor')
  );

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles for delete
  using (
    (public.get_my_role() = 'admin' and role in ('admin','supervisor','consultor'))
    or (public.get_my_role() = 'supervisor' and role = 'consultor')
  );

-- --- clientes ---
drop policy if exists "clientes_select" on public.clientes;
create policy "clientes_select" on public.clientes for select
  using ( auth.role() = 'authenticated' );

drop policy if exists "clientes_write" on public.clientes;
create policy "clientes_write" on public.clientes for all
  using ( public.get_my_role() = 'admin' )
  with check ( public.get_my_role() = 'admin' );

-- --- consultas_log ---
drop policy if exists "log_insert" on public.consultas_log;
create policy "log_insert" on public.consultas_log for insert
  with check ( auth.uid() = user_id );

drop policy if exists "log_select" on public.consultas_log;
create policy "log_select" on public.consultas_log for select
  using ( auth.uid() = user_id or public.get_my_role() in ('admin','supervisor') );

create extension if not exists pgcrypto; -- necessário para gen_random_uuid()

-- 4) FUNIL DE VENDAS (kanban de propostas)
-- Estágios: lead -> proposta_enviada -> negociacao -> fechado_ganho | fechado_perdido
-- Um card pode voltar de fechado_ganho pra proposta_enviada quando surge uma nova negociação/nova
-- proposta pro mesmo cliente (o consultor usa o botão "Gerar nova proposta" dentro do próprio card,
-- em vez de criar um card duplicado). Toda movimentação de estágio é registrada em propostas_historico.
create table if not exists public.propostas (
  id uuid primary key default gen_random_uuid(),
  consultor_id uuid not null references auth.users(id) on delete cascade,
  cliente_nome text not null,
  cliente_cnpj text,
  cliente_cidade text,
  cliente_ddd text,
  origem text not null default 'lead' check (origem in ('base','avulsa','lead')),
  tipo_proposta text,
  valor_atual numeric,
  valor_proposto numeric,
  estagio text not null default 'lead' check (estagio in ('lead','proposta_enviada','negociacao','fechado_ganho','fechado_perdido')),
  estagio_entrada_em timestamptz not null default now(),
  motivo_perda text,
  observacoes text,
  dados jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_propostas_consultor on public.propostas(consultor_id);
create index if not exists idx_propostas_estagio on public.propostas(estagio);

create table if not exists public.propostas_historico (
  id bigint generated always as identity primary key,
  proposta_id uuid not null references public.propostas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  estagio_anterior text,
  estagio_novo text not null,
  nota text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_propostas_historico_proposta on public.propostas_historico(proposta_id);

alter table public.propostas enable row level security;
alter table public.propostas_historico enable row level security;

-- --- propostas: consultor só vê/mexe nas próprias, admin/supervisor veem e movem todas ---
drop policy if exists "propostas_select" on public.propostas;
create policy "propostas_select" on public.propostas for select
  using ( auth.uid() = consultor_id or public.get_my_role() in ('admin','supervisor') );

drop policy if exists "propostas_insert" on public.propostas;
create policy "propostas_insert" on public.propostas for insert
  with check ( auth.uid() = consultor_id );

drop policy if exists "propostas_update" on public.propostas;
create policy "propostas_update" on public.propostas for update
  using ( auth.uid() = consultor_id or public.get_my_role() in ('admin','supervisor') )
  with check ( auth.uid() = consultor_id or public.get_my_role() in ('admin','supervisor') );

drop policy if exists "propostas_delete" on public.propostas;
create policy "propostas_delete" on public.propostas for delete
  using ( public.get_my_role() = 'admin' );

-- --- propostas_historico: mesma visibilidade da proposta associada; insert só de quem pode ver/mexer ---
drop policy if exists "propostas_historico_select" on public.propostas_historico;
create policy "propostas_historico_select" on public.propostas_historico for select
  using (
    exists (
      select 1 from public.propostas p
      where p.id = proposta_id
        and (p.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'))
    )
  );

drop policy if exists "propostas_historico_insert" on public.propostas_historico;
create policy "propostas_historico_insert" on public.propostas_historico for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.propostas p
      where p.id = proposta_id
        and (p.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'))
    )
  );

-- 5) COBERTURA DE BANDA LARGA (pontos extraídos dos KMZ da operadora, por cidade)
-- O painel não guarda o .kmz em si — no upload (aba Base de Dados, só admin), o JS descompacta o
-- KMZ, lê o KML e extrai todo ponto de Point/LineString/Polygon (coordenadas), marcando se veio da
-- rede HFC ou GPON. Isso vira "pontos" (array [lat,lng,rede]). Na hora de checar um endereço, o
-- painel geocodifica CEP+número (Google Maps) e mede a distância até o ponto mais próximo dessa
-- cidade — é uma ESTIMATIVA por proximidade (os polígonos do KMZ são pequenos demais pra bater
-- ponto-a-ponto contra a margem de erro da geocodificação), não substitui a confirmação oficial.
create table if not exists public.cobertura_kmz (
  id bigint generated always as identity primary key,
  cidade text not null,              -- nome normalizado (maiúsculo, sem acento) usado pra casar com o cliente/CEP
  cidade_label text,                 -- nome como veio do arquivo, só pra exibição
  arquivo_nome text,
  pontos jsonb not null,             -- [[lat, lng, "HFC"|"GPON"], ...]
  total_pontos int,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_cobertura_kmz_cidade on public.cobertura_kmz(cidade);

alter table public.cobertura_kmz enable row level security;

drop policy if exists "cobertura_kmz_select" on public.cobertura_kmz;
create policy "cobertura_kmz_select" on public.cobertura_kmz for select
  using ( auth.role() = 'authenticated' );

drop policy if exists "cobertura_kmz_write" on public.cobertura_kmz;
create policy "cobertura_kmz_write" on public.cobertura_kmz for all
  using ( public.get_my_role() = 'admin' )
  with check ( public.get_my_role() = 'admin' );

-- 6) CONFIGURAÇÕES DO SISTEMA (chave-valor simples — hoje só guarda a chave da API do Google Maps,
-- usada na geocodificação de CEP+número pra verificar cobertura de banda larga). Fica em uma tabela
-- em vez de fixa no HTML pra dar pro admin trocar a chave sem precisar pedir um novo deploy.
create table if not exists public.config (
  chave text primary key,
  valor text,
  atualizado_em timestamptz not null default now()
);

alter table public.config enable row level security;

drop policy if exists "config_select" on public.config;
create policy "config_select" on public.config for select
  using ( auth.role() = 'authenticated' );

drop policy if exists "config_write" on public.config;
create policy "config_write" on public.config for all
  using ( public.get_my_role() = 'admin' )
  with check ( public.get_my_role() = 'admin' );

-- 7) MOVIMENTAÇÃO DA BASE (comparativo antes/depois a cada upload de planilha)
-- A cada upload novo (aba Base de Dados, só admin), o painel compara a base atual com a planilha
-- recebida usando o CNPJ (normalizado, só dígitos) como chave. Clientes cujo CNPJ some viram
-- "saida", CNPJ novo vira "entrada", e CNPJ que continua mas mudou algum campo rastreado (apto pra
-- renovação, linhas de voz/fixas, valor do contrato, cidade, se está cabeado) vira "mudanca".
-- Cada linha aqui é um evento detectado num upload específico — histórico permanente, nunca apagado.
create table if not exists public.clientes_movimentacao (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('saida','entrada','mudanca')),
  cnpj text not null,
  razao_social text,
  cidade text,
  dados_antes jsonb,
  dados_depois jsonb,
  campos_alterados text[],
  detectado_em timestamptz not null default now(),
  detectado_por uuid references auth.users(id) on delete set null
);
create index if not exists idx_clientes_mov_tipo on public.clientes_movimentacao(tipo);
create index if not exists idx_clientes_mov_detectado_em on public.clientes_movimentacao(detectado_em);
create index if not exists idx_clientes_mov_cnpj on public.clientes_movimentacao(cnpj);

alter table public.clientes_movimentacao enable row level security;

drop policy if exists "clientes_movimentacao_select" on public.clientes_movimentacao;
create policy "clientes_movimentacao_select" on public.clientes_movimentacao for select
  using ( public.get_my_role() = 'admin' );

drop policy if exists "clientes_movimentacao_insert" on public.clientes_movimentacao;
create policy "clientes_movimentacao_insert" on public.clientes_movimentacao for insert
  with check ( public.get_my_role() = 'admin' );

-- 8) RESUMO POR UPLOAD (um retrato agregado de cada comparação feita ao subir uma planilha nova)
-- Diferente de clientes_movimentacao (um evento por cliente que mudou), essa tabela guarda uma
-- linha só por upload, com os totais do que aconteceu naquela comparação específica — inclusive
-- "quantos permaneceram sem sair" (não dá pra saber isso só olhando os eventos individuais, porque
-- clientes sem mudança nenhuma não geram evento). "Renovaram" é quando o cliente estava apto pra
-- renovação e deixou de estar, mas continua na base — sinal positivo, quer dizer que provavelmente
-- fechamos a renovação com ele.
create table if not exists public.clientes_movimentacao_resumo (
  id bigint generated always as identity primary key,
  total_antes int,
  total_depois int,
  saidas int,
  entradas int,
  mudancas int,
  permaneceram int,
  renovaram int,
  detectado_em timestamptz not null default now(),
  detectado_por uuid references auth.users(id) on delete set null
);
create index if not exists idx_clientes_mov_resumo_detectado_em on public.clientes_movimentacao_resumo(detectado_em);

alter table public.clientes_movimentacao_resumo enable row level security;

drop policy if exists "clientes_movimentacao_resumo_select" on public.clientes_movimentacao_resumo;
create policy "clientes_movimentacao_resumo_select" on public.clientes_movimentacao_resumo for select
  using ( public.get_my_role() = 'admin' );

drop policy if exists "clientes_movimentacao_resumo_insert" on public.clientes_movimentacao_resumo;
create policy "clientes_movimentacao_resumo_insert" on public.clientes_movimentacao_resumo for insert
  with check ( public.get_my_role() = 'admin' );

-- 9) DASHBOARD DE PRODUÇÃO (Apex/Claro) — pedidos extraídos da exportação do NeoCRM
-- Substitui o fluxo antigo de gerar Dashapex.html numa conversa separada e subir por FTP: agora o
-- admin sobe a planilha de exportação (aba "Exportacao") direto na aba "Dashboard de Produção" do
-- painel, os dados são extraídos/categorizados no navegador (ver extractProducaoRecords em
-- _template.html) e substituem por completo o conteúdo desta tabela (delete + insert, igual ao
-- upload da base de clientes). Cada upload novo apaga e repõe tudo — não é incremental.
-- Cliente/CNPJ são LGPD-sensíveis: só admin e supervisor podem enxergar essas duas colunas no
-- detalhamento do dashboard (o painel só pede essas colunas ao Supabase quando o perfil logado é
-- admin/supervisor — ver producaoAdminMode() em _template.html); consultor nunca recebe esses
-- campos na resposta.
create table if not exists public.producao_pedidos (
  id bigint generated always as identity primary key,
  numero_pedido text,
  grupo text,
  usuario text,
  etapa text,
  cadastro timestamptz,
  atualizacao timestamptz,
  valor numeric not null default 0,
  quantidade numeric,
  produto text,
  cliente text,
  cnpj text,
  tag text,
  criado_em timestamptz not null default now(),
  -- data_portabilidade / data_instalacao (18/09/2026): datas de ativação usadas no relatório de
  -- Fechamento (comissionamento) — só passaram a vir preenchidas no export do NeoCRM a partir de
  -- ago/2026, por isso são nullable e o painel ignora qualquer pedido anterior a 01/08/2026 nesse
  -- relatório. data_portabilidade cobre TODO tipo de ativação de linha (Novo, Renovação,
  -- Titularidade, Portabilidade — não só portabilidade numérica), data_instalacao é só banda larga.
  -- Ver REGRAS_NEGOCIO.md seção 16.14.
  data_portabilidade timestamptz,
  data_instalacao timestamptz
);
create index if not exists idx_producao_pedidos_etapa on public.producao_pedidos(etapa);
create index if not exists idx_producao_pedidos_usuario on public.producao_pedidos(usuario);

alter table public.producao_pedidos enable row level security;

-- select liberado pra qualquer perfil logado (igual à base de clientes) — o painel decide, na
-- própria consulta, se pede ou não as colunas cliente/cnpj, dependendo do perfil de quem está logado.
drop policy if exists "producao_pedidos_select" on public.producao_pedidos;
create policy "producao_pedidos_select" on public.producao_pedidos for select
  using ( auth.role() = 'authenticated' );

-- upload (insert/delete/update) restrito a admin — consultor e supervisor não podem substituir os
-- dados do dashboard, só visualizá-lo.
drop policy if exists "producao_pedidos_write" on public.producao_pedidos;
create policy "producao_pedidos_write" on public.producao_pedidos for all
  using ( public.get_my_role() = 'admin' )
  with check ( public.get_my_role() = 'admin' );

-- 10) CONVERSÃO DE VENDAS (leads de campanhas Facebook/Instagram vindos de uma planilha do Google)
-- Diferente da base de clientes/produção (upload manual de arquivo), aqui o admin/supervisor clica
-- em "Atualizar agora" na aba "Conversão de Vendas" e a Edge Function sync-leads busca a planilha
-- direto do Google (server-side, sem problema de CORS) e faz upsert por "id" do lead — atualiza quem
-- já existe e insere quem é novo, sem apagar histórico (diferente do dashboard de produção, que
-- substitui tudo a cada upload). Ver edge_function_sync_leads.ts.
create table if not exists public.leads (
  id text primary key,                  -- id do lead, vem da planilha (ex.: "l:2055930361682530")
  criado_em_lead timestamptz,            -- created_time da planilha (quando o lead chegou no Facebook/Instagram)
  ad_id text,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  form_id text,
  form_name text,
  is_organic boolean default false,
  platform text,
  tipo_empresa text,
  qtd_linhas text,
  cnpj text,
  email text,
  full_name text,
  city text,
  state text,
  phone_number text,
  lead_status text,
  consultor text,                        -- coluna "CONSULTOR " da planilha (cabeçalho tem espaço sobrando)
  status text,                           -- coluna "STATUS" — status interno de atendimento do consultor
  categoria text not null default 'sem_contato' check (categoria in ('convertido','perdido','andamento','sem_contato')),
  obs text,
  converteu boolean not null default false,
  receita numeric not null default 0,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_leads_consultor on public.leads(consultor);
create index if not exists idx_leads_categoria on public.leads(categoria);
create index if not exists idx_leads_status on public.leads(status);

alter table public.leads enable row level security;

-- select liberado pra qualquer perfil autenticado (01/09/2026: consultor passou a ver a aba
-- "Digital" também — antes só admin/supervisor) — mesma visibilidade da aba "Digital" no painel.
drop policy if exists "leads_select" on public.leads;
create policy "leads_select" on public.leads for select
  using ( public.get_my_role() in ('admin','supervisor','consultor') );

-- write só pela Edge Function sync-leads, que usa a service_role key (ignora RLS) — não expomos
-- insert/update/delete direto pro cliente autenticado, nem pra admin, porque os dados vêm sempre da
-- planilha do Google, nunca digitados manualmente no painel.
drop policy if exists "leads_write" on public.leads;
create policy "leads_write" on public.leads for all
  using ( false )
  with check ( false );

-- ============================================================
-- RECONCILIAÇÃO NEOCRM (RPC pro consultor, 10/09/2026)
-- ============================================================
-- Function usada pelo card "Conversão confirmada no NeoCRM" (aba Digital, REGRAS_NEGOCIO.md seção
-- 17.10) quando quem está logado é consultor — faz o cruzamento CNPJ entre leads convertidos e
-- producao_pedidos inteiramente no servidor e NUNCA devolve CNPJ nem nome de cliente, só contagens
-- agregadas e numero_pedido/etapa/cadastro por categoria. admin/supervisor não usam essa function —
-- continuam com o cruzamento feito no navegador, porque já recebem CNPJ normalmente.
create or replace function public.reconciliacao_neocrm(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  with leads_conv as (
    select cnpj
    from leads
    where converteu = true
      and (
        (p_de is null and p_ate is null)
        or (
          criado_em_lead is not null
          and (p_de is null or (criado_em_lead at time zone 'America/Sao_Paulo')::date >= p_de)
          and (p_ate is null or (criado_em_lead at time zone 'America/Sao_Paulo')::date <= p_ate)
        )
      )
  ),
  leads_norm as (
    select regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') as cnpj_digits
    from leads_conv
  ),
  pedidos_norm as (
    select
      regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') as cnpj_digits,
      numero_pedido, etapa, cadastro, atualizacao,
      row_number() over (
        partition by regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')
        order by atualizacao desc nulls last
      ) as rn
    from producao_pedidos
    where cnpj is not null and cnpj <> ''
  ),
  pedidos_latest as (
    select cnpj_digits, numero_pedido, etapa, cadastro
    from pedidos_norm
    where rn = 1
  ),
  cruzado as (
    select
      pl.numero_pedido,
      pl.etapa,
      pl.cadastro,
      case
        when pl.etapa is null then 'sem_pedido'
        when pl.etapa = 'CONCLUIDO (NEOCRM)' then 'ganho'
        when pl.etapa = 'ENTREGA (NEOCRM)' then 'ganho'
        when pl.etapa = 'FATURAMENTO (NEOCRM)' then 'ganho'
        when pl.etapa = 'PORTABILIDADE EM ANDAMENTO (NEOCRM)' then 'ganho'
        when pl.etapa = 'VALIDAÇÃO ESIM (NEOCRM)' then 'ganho'
        when pl.etapa = 'VENDA PERDIDA (NEOCRM)' then 'perdido'
        when pl.etapa = 'DEVOLVIDO (NEOCRM)' then 'devolvido'
        else 'andamento'
      end as categoria
    from leads_norm ln
    left join pedidos_latest pl
      on pl.cnpj_digits = ln.cnpj_digits and ln.cnpj_digits <> ''
  )
  select jsonb_build_object(
    'total', (select count(*) from cruzado),
    'ganho', (select count(*) from cruzado where categoria = 'ganho'),
    'perdido', (select count(*) from cruzado where categoria = 'perdido'),
    'andamento', (select count(*) from cruzado where categoria in ('andamento', 'devolvido')),
    'semPedido', (select count(*) from cruzado where categoria = 'sem_pedido'),
    'pedidosGanho', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria = 'ganho'
    ), '[]'::jsonb),
    'pedidosPerdido', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria = 'perdido'
    ), '[]'::jsonb),
    'pedidosAndamento', coalesce((
      select jsonb_agg(jsonb_build_object('numero_pedido', numero_pedido, 'etapa', etapa, 'cadastro', cadastro))
      from cruzado where categoria in ('andamento', 'devolvido')
    ), '[]'::jsonb)
  ) into resultado;

  return resultado;
end;
$$;

revoke all on function public.reconciliacao_neocrm(date, date) from public;
grant execute on function public.reconciliacao_neocrm(date, date) to authenticated;

-- ============================================================
-- PRIMEIRO ADMINISTRADOR
-- ============================================================
-- Não precisa rodar nada aqui manualmente: publique as Edge Functions
-- "create-user" e "reset-password" e use o botão "Criar conta" no painel
-- uma única vez — o primeiro usuário criado no sistema já entra como
-- Administrador automaticamente. A partir da segunda conta, só um
-- Admin/Supervisor logado consegue criar novos usuários (pela aba
-- "Consultores" do painel).
