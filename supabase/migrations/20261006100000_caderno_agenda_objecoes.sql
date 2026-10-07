-- 06/10/2026 — Caderno de Ligação + Agenda + Objeções com IA. REGRAS_NEGOCIO.md §72. Aditiva.
-- Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md

-- 1) Anotações do Caderno (uma por atendimento; id gerado no navegador para o upsert não duplicar)
create table if not exists public.caderno_notas (
  id uuid primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  telefone text, chave_tel text,
  nome text, cpf text, cnpj text, cep text, email text, operadora_atual text, decisor text,
  qtd_linhas int check (qtd_linhas is null or qtd_linhas between 0 and 100000),
  valor_plano numeric(10,2) check (valor_plano is null or valor_plano >= 0),
  fidelidade_vence date,
  interesse text[] not null default '{}',
  objecoes text[] not null default '{}',
  texto text not null default '',
  resultado text check (resultado in ('atendeu','nao_atendeu','caixa_postal','sem_interesse','fechou')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists caderno_notas_tel_idx on public.caderno_notas (consultor_id, chave_tel);
create index if not exists caderno_notas_cnpj_idx on public.caderno_notas (consultor_id, cnpj);
create index if not exists caderno_notas_recentes_idx on public.caderno_notas (consultor_id, atualizado_em desc);

-- 2) Retornos da Agenda (data E hora)
create table if not exists public.agenda_retornos (
  id uuid primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  nota_id uuid references public.caderno_notas(id) on delete set null,
  nome text not null check (btrim(nome) <> ''),
  telefone text not null,
  chave_tel text,
  quando timestamptz not null,
  tipo text not null default 'ligacao' check (tipo in ('ligacao','whatsapp','reuniao','proposta')),
  qtd_linhas int check (qtd_linhas is null or qtd_linhas between 0 and 100000),
  valor_plano numeric(10,2) check (valor_plano is null or valor_plano >= 0),
  observacao text,
  origem text not null default 'manual' check (origem in ('manual','nao_atendeu','fidelidade')),
  status text not null default 'pendente' check (status in ('pendente','feito','cancelado')),
  feito_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists agenda_retornos_quando_idx on public.agenda_retornos (consultor_id, quando);
create index if not exists agenda_retornos_tel_idx on public.agenda_retornos (consultor_id, chave_tel) where status = 'pendente';

-- 3) Gatilhos: chave_tel, atualizado_em, dono imutável, feito_em
create or replace function public.caderno_agenda_preenche() returns trigger
language plpgsql set search_path = public as $$
begin
  new.chave_tel := public.chave_tel(new.telefone);
  new.atualizado_em := now();
  if tg_op = 'UPDATE' then
    new.consultor_id := old.consultor_id;
    new.criado_em := old.criado_em;
  end if;
  if tg_table_name = 'agenda_retornos' then
    if new.status = 'feito' and (tg_op = 'INSERT' or old.status <> 'feito') then new.feito_em := now(); end if;
    if new.status <> 'feito' then new.feito_em := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists caderno_notas_preenche on public.caderno_notas;
create trigger caderno_notas_preenche before insert or update on public.caderno_notas
  for each row execute function public.caderno_agenda_preenche();
drop trigger if exists agenda_retornos_preenche on public.agenda_retornos;
create trigger agenda_retornos_preenche before insert or update on public.agenda_retornos
  for each row execute function public.caderno_agenda_preenche();

-- 4) RLS: consultor só o que é dele; admin/supervisor leem tudo; ninguém apaga (retorno se cancela por status)
alter table public.caderno_notas enable row level security;
alter table public.agenda_retornos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['caderno_notas', 'agenda_retornos'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (consultor_id = auth.uid() or public.get_my_role() in (''admin'', ''supervisor''))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (consultor_id = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (consultor_id = auth.uid()) with check (consultor_id = auth.uid())', t);
    execute format('revoke delete on public.%1$s from anon, authenticated', t);
  end loop;
end $$;

-- 5) Biblioteca de objeções (texto de RASCUNHO: o Rafael aprova antes de publicar; sem preço em R$)
create table if not exists public.objecoes_respostas (
  chave text primary key check (chave ~ '^[a-z0-9_]{2,40}$'),
  rotulo text not null,
  fala text not null,
  pergunta text not null default '',
  alternativa text not null default '',
  ordem int not null default 100,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.objecoes_respostas enable row level security;
drop policy if exists objecoes_respostas_select on public.objecoes_respostas;
create policy objecoes_respostas_select on public.objecoes_respostas for select to authenticated using (true);
drop policy if exists objecoes_respostas_escrita on public.objecoes_respostas;
create policy objecoes_respostas_escrita on public.objecoes_respostas for all to authenticated
  using (public.get_my_role() in ('admin', 'supervisor')) with check (public.get_my_role() in ('admin', 'supervisor'));
insert into public.objecoes_respostas (chave, rotulo, fala, pergunta, alternativa, ordem) values
  ('caro', 'Tá caro',
   'Entendo. Pra eu comparar certo: hoje são quantas linhas e quanto de internet em cada uma? Muitas vezes, olhando por linha, a conta fica parecida e com mais franquia.',
   'Se o valor ficasse dentro do que o senhor paga hoje, faria sentido trocar?',
   'Desça um degrau mantendo as linhas: de 100GB para 70GB, ou de 70GB para 40GB.', 1),
  ('fidelidade', 'Tenho fidelidade/multa',
   'Faz sentido não querer pagar multa. Quando vence a sua fidelidade? Eu deixo tudo pronto e te ligo antes, pra trocar sem custo.',
   'Qual o mês de vencimento do contrato atual?',
   'Anote o vencimento no Caderno: o painel sugere o retorno 45 dias antes.', 2),
  ('pensar', 'Vou pensar',
   'Claro, é uma decisão importante. Pra eu te ajudar: o que ficou de dúvida, o valor, a franquia ou a troca em si?',
   'Se eu resolver essa dúvida agora, a gente consegue seguir hoje?',
   'Agende o retorno para amanhã com hora combinada com o cliente.', 3),
  ('socio', 'Preciso falar com o sócio',
   'Perfeito, é bom decidir junto. Vamos marcar um horário rápido com vocês dois? Assim eu explico direto e ninguém fica no telefone sem fio.',
   'Qual o melhor horário para falar com o senhor e o sócio juntos?',
   'Envie a proposta pelo WhatsApp e agende o retorno com o decisor.', 4),
  ('satisfeito', 'Já tenho operadora e estou satisfeito',
   'Que bom que está bem atendido. Não quero te tirar de algo que funciona: só me deixa ver se dá pra ter o mesmo pagando menos ou com mais internet. Leva dois minutos.',
   'O que o senhor mais gosta no plano de hoje?',
   'Pergunte linhas e franquia atuais e compare com 70GB e 100GB.', 5),
  ('manda', 'Me manda por WhatsApp/e-mail',
   'Mando sim, agora mesmo. Só pra proposta ir certinha: são quantas linhas e quanto de internet vocês usam hoje?',
   'Posso te ligar amanhã de manhã pra tirar as dúvidas da proposta?',
   'Mande a proposta e agende o retorno para o dia seguinte.', 6),
  ('sinal', 'Sinal da Claro é ruim aqui',
   'Obrigado por avisar, isso é importante. Me passa o CEP da empresa que eu confiro a cobertura agora; se não atender bem, eu mesmo te falo.',
   'O sinal ruim é dentro da empresa ou na região toda?',
   'Confira a cobertura pelo CEP antes de seguir.', 7),
  ('ocupado', 'Agora não posso falar',
   'Sem problema, não vou tomar seu tempo. Qual o melhor horário pra eu te ligar? É coisa de cinco minutos.',
   'Prefere de manhã ou à tarde?',
   'Agende o retorno no horário que o cliente disser.', 8),
  ('sem_interesse', 'Não tenho interesse',
   'Entendo. Só uma pergunta rápida pra eu não te ligar à toa: hoje a empresa usa quantas linhas de celular?',
   'Se eu mostrasse uma economia na conta de celular da empresa, valeria cinco minutos?',
   'Se o cliente insistir, marque "Sem interesse" e encerre com educação.', 9)
on conflict (chave) do nothing;

-- 6) Uso das respostas (para a Mesa saber o que aparece e o que funciona)
create table if not exists public.objecoes_uso (
  id bigint generated always as identity primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  objecao text not null,
  fonte text not null check (fonte in ('biblioteca','ia')),
  util boolean,
  nota_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists objecoes_uso_criado_idx on public.objecoes_uso (criado_em desc);
alter table public.objecoes_uso enable row level security;
drop policy if exists objecoes_uso_select on public.objecoes_uso;
create policy objecoes_uso_select on public.objecoes_uso for select to authenticated
  using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
drop policy if exists objecoes_uso_insert on public.objecoes_uso;
create policy objecoes_uso_insert on public.objecoes_uso for insert to authenticated with check (consultor_id = auth.uid());
revoke update, delete on public.objecoes_uso from anon, authenticated;

-- 7) Chamadas à IA (limite por consultor + log; escrita só pela Edge Function com service role; sem texto do cliente)
create table if not exists public.caderno_ia_chamadas (
  id bigint generated always as identity primary key,
  consultor_id uuid not null,
  objecao text,
  status text not null,
  ms int,
  criado_em timestamptz not null default now()
);
create index if not exists caderno_ia_chamadas_idx on public.caderno_ia_chamadas (consultor_id, criado_em desc);
alter table public.caderno_ia_chamadas enable row level security;
drop policy if exists caderno_ia_chamadas_select on public.caderno_ia_chamadas;
create policy caderno_ia_chamadas_select on public.caderno_ia_chamadas for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.caderno_ia_chamadas from anon, authenticated;

-- 8) Bloco "Retornos e objeções" da Mesa do Supervisor
create or replace function public.mesa_retornos_objecoes(p_ref date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cons jsonb; v_obj jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.atrasados desc, x.hoje desc, x.nome), '[]'::jsonb) into v_cons from (
    select p.id as profile_id, p.nome,
      count(*) filter (where r.status = 'pendente' and (r.quando at time zone 'America/Sao_Paulo')::date = p_ref) as hoje,
      count(*) filter (where r.status = 'pendente' and r.quando < now()) as atrasados,
      count(*) filter (where r.status = 'feito' and (r.quando at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref
                         and (r.feito_em at time zone 'America/Sao_Paulo')::date = (r.quando at time zone 'America/Sao_Paulo')::date) as feitos7,
      count(*) filter (where r.status <> 'cancelado' and (r.quando at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref) as total7
    from public.profiles p
    left join public.agenda_retornos r on r.consultor_id = p.id
    where p.role = 'consultor'
    group by p.id, p.nome
  ) x;
  select coalesce(jsonb_agg(y order by y.usos desc, y.objecao), '[]'::jsonb) into v_obj from (
    select u.objecao, count(*) as usos, count(*) filter (where u.util) as uteis
    from public.objecoes_uso u
    where (u.criado_em at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref
    group by u.objecao order by count(*) desc, u.objecao limit 5
  ) y;
  return jsonb_build_object('consultores', v_cons, 'objecoes', v_obj);
end $$;
revoke all on function public.mesa_retornos_objecoes(date) from public, anon;
grant execute on function public.mesa_retornos_objecoes(date) to authenticated;
