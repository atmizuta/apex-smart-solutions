create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  usuario text not null unique,
  senha_hash text not null,
  papel text not null check (papel in ('consultor', 'admin')),
  criado_em timestamptz not null default now()
);

create table if not exists cenarios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null,
  prompt_ia_cliente text not null,
  categoria text not null,
  ativo boolean not null default true
);

create table if not exists sessoes_pratica (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id),
  cenario_id uuid not null references cenarios(id),
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  nota integer,
  feedback text
);

create table if not exists mensagens (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references sessoes_pratica(id),
  remetente text not null check (remetente in ('consultor', 'ia')),
  texto text not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_sessoes_usuario on sessoes_pratica(usuario_id);
create index if not exists idx_mensagens_sessao on mensagens(sessao_id);
