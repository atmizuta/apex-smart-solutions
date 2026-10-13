# CRM Fibra — Card de Lead em Tela Cheia (Sub-projeto 2) — Design

## Contexto

Sub-projeto 2 de 5 do redesign do CRM Fibra (ver
`docs/superpowers/specs/2026-10-01-crm-fibra-dashboard-redesign-design.md` para o sub-projeto 1,
já publicado). Quando o consultor clica num CNPJ na Carteira de Leads, hoje ele cai em
`/leads/[cnpj]` — uma página real (não modal), já "tela cheia" no sentido que o pedido original
descreve. Essa página hoje mostra: dados básicos do cliente, botão de atribuir lead (quando sem
dono), e histórico de mensagens de contato.

Este sub-projeto reestrutura essa página em abas e adiciona a funcionalidade central pedida:
montar uma proposta comercial linha por linha, usando um catálogo real de planos Claro-empresas.

As abas de "Abordagem gerada por IA" (sub-projeto 3) e "Exportar comparativo de fatura"
(sub-projeto 5) **não** fazem parte desta entrega — nenhuma aba placeholder para elas; aparecem
quando esses sub-projetos forem implementados.

## Decisão de dados: por que o catálogo é necessário

O banco (`public.clientes`, de onde vem a view `crm_fibra.leads_segmentados`) só guarda contagens
agregadas por cliente (`linhas_fixas`, `linhas_voz`) e um valor total de contrato (`valor_contrato`,
`arpu`) — não existe registro por linha individual (número, plano atual, valor daquela linha).
Não há, portanto, como pré-popular "a proposta" a partir de dados existentes linha a linha.

A proposta é construída pelo consultor escolhendo, para cada linha que ele quer propor, um item de
um catálogo fixo de planos Claro-empresas (confirmado com o usuário a partir da tabela de preços
vigente — ver seção Catálogo), ou digitando uma oferta avulsa em texto livre quando não há item
correspondente no catálogo.

## Arquitetura

**Rota existente, reestruturada em abas.** `app/(protected)/leads/[cnpj]/page.tsx` continua sendo
o ponto de entrada (já linkado a partir da Carteira de Leads — `app/(protected)/leads/page.tsx:90`).
Em vez de uma única coluna de conteúdo, a página passa a ter três abas (shadcn `Tabs`):

- **Cliente** — o que já existe hoje: razão social, CNPJ, cidade, ARPU, CEP cabeado, badge de
  renovação, botão "Atribuir" (quando sem dono), aviso quando atribuído a outro consultor,
  formulário de nova mensagem e histórico de mensagens. Comportamento idêntico ao atual, só
  reorganizado dentro da aba.
- **Linhas** — somente leitura: linhas fixas, linhas de voz, valor do contrato atual, badges de
  camada de fibra/renovação (reaproveita `CamadaBadges`, já existe de `components/camada-badges.tsx`).
- **Proposta** — o construtor de proposta: lista de itens adicionados (cada um com descrição e
  valor), campo para adicionar um novo item (select agrupado por categoria do catálogo, ou opção
  "Oferta avulsa" que libera um campo de texto + valor), total calculado, botão salvar. Propostas
  salvas anteriormente para este lead aparecem listadas (mais recente primeiro), com a mais recente
  destacada pelo selo "Mais recente".

Nenhuma rota nova é criada. O layout `(protected)/layout.tsx` e a guarda de sessão não mudam.

## Modelo de dados (schema `crm_fibra`, mesmo projeto Supabase já em uso)

```sql
create table crm_fibra.catalogo_planos (
  id uuid primary key default gen_random_uuid(),
  categoria text not null
    check (categoria in ('convergente', 'pos_nacional', 'pos_regional', 'banda_larga', 'adicional')),
  nome text not null,
  valor numeric not null,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table crm_fibra.propostas (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  criado_em timestamptz not null default now()
);

create index idx_propostas_cnpj on crm_fibra.propostas(cnpj_digits);

create table crm_fibra.proposta_itens (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references crm_fibra.propostas(id) on delete cascade,
  catalogo_plano_id uuid references crm_fibra.catalogo_planos(id),
  descricao text not null,
  valor numeric not null,
  ordem integer not null default 0
);

create index idx_proposta_itens_proposta on crm_fibra.proposta_itens(proposta_id);

alter table crm_fibra.catalogo_planos enable row level security;
alter table crm_fibra.propostas enable row level security;
alter table crm_fibra.proposta_itens enable row level security;
```

Mesmo padrão de segurança das tabelas existentes (`consultores`, `atribuicoes`, `mensagens`): RLS
ligado, zero políticas para `anon`/`authenticated`, acesso só pelo cliente service-role do servidor
Next.js. `catalogo_plano_id` é nulo quando o item é uma oferta avulsa (texto livre) — `descricao` e
`valor` são sempre preenchidos no momento da escolha (copiados do catálogo ou digitados), então a
proposta salva permanece correta mesmo que o catálogo mude depois.

A view `crm_fibra.leads_segmentados` ganha duas colunas que hoje faltam:

```sql
create or replace view crm_fibra.leads_segmentados as
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
  a.ultimo_contato_em,
  c.linhas_voz,
  c.valor_contrato
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits
where c.cnpj_digits is not null and c.cnpj_digits <> '';
```

`linhas_voz` e `valor_contrato` entram **no fim** da lista de colunas: o `create or replace view` do
Postgres só aceita colunas novas depois das existentes (mesmos nomes, ordem e tipos antes delas).
`create or replace view` preserva as permissões já concedidas — não precisa re-conceder grants.

## Catálogo — conteúdo inicial

22 itens, confirmados com o usuário a partir da tabela de preços Claro-empresas vigente
(pré-Black Friday). Seed via migration idempotente (`insert ... on conflict do nothing`, chave de
conflito em `(categoria, nome)` com índice único).

**convergente**
| nome | valor | observação |
|---|---|---|
| Fibra 1 Giga + Pós 65GB (regional RSC/RSI/RRS/RRE/RCO/RNO) | 194.89 | — |
| Fibra 1 Giga + Pós 80GB (regional RMG/RPS/RBS/RNE + DDDs 55,27,62,64,98,19) | 194.89 | — |
| Fibra 800 Mega + Pós 62GB | 149.89 | — |
| Fibra 800 Mega + Pós 90GB | 164.89 | — |
| Fibra 600 Mega + Pós 71GB (Grupos Padrão Especial/Especial+) | 99.89 | Por 3 meses, depois R$129,89 (boleto) / R$124,89 (DCC) |
| Fibra 600 Mega + Pós 71GB (Mercados em Desenvolvimento/Redes Neutras) | 94.89 | Por 6 meses, depois R$124,89 (boleto) / R$119,89 (DCC) |

**pos_nacional**
| nome | valor | observação |
|---|---|---|
| Pós 12GB | 39.99 | por linha |
| Pós 40GB | 54.99 | por linha |
| Pós 70GB | 74.99 | por linha |
| Pós 100GB | 89.99 | por linha |
| Pós 150GB | 149.99 | por linha |

**pos_regional**
| nome | valor | observação |
|---|---|---|
| Pós 30GB (regional RMG/RPS/RBS/RRS/RRE/RCO/RNO + DDDs 55,27,62,64,98,19) | 44.99 | por linha |

**banda_larga**
| nome | valor | observação |
|---|---|---|
| 400 Mega (G1 Padrão) | 79.90 | single/combinado/convergência |
| 400 Mega (G4 Especial+) | 84.90 | single |
| 600 Mega (G1 Padrão) | 59.90 | Por 3 meses, depois R$99,90 |
| 600 Mega (G3A Especial+ com oferta) | 59.90 | Por 3 meses, depois R$89,90 |
| 600 Mega (G4, single) | 64.90 | Por 6 meses, depois R$104,90 |
| 600 Mega (G4, combinado/convergência) | 54.90 | Por 6 meses, depois R$84,90 |
| 800 Mega (todos os grupos) | 109.90 | single/combinado/convergência |
| 1 Giga (single/combinado) | 199.90 | — |
| 1 Giga (convergência) | 149.90 | — |

**adicional**
| nome | valor | observação |
|---|---|---|
| Claro Monitor | 5.00 | — |

O item "Pós 15GB regional — R$44,90" foi deliberadamente excluído (pedido explícito do usuário).

## Admin — gerenciar catálogo

Nova página `/catalogo`, visível só para `papel === "admin"` (mesmo padrão de
`deveMostrarAdministracao` já usado para `/consultores` e `/atualizar-base`), adicionada ao grupo
"Administração" da sidebar. Lista os itens agrupados por categoria, com:

- editar valor e observação de um item existente (os dois únicos campos que mudam com frequência —
  promoções trocam preço/condição, não trocam o nome do plano);
- ativar/desativar um item (desativado some do select da aba Proposta, mas itens de propostas já
  salvas continuam mostrando a descrição/valor que foi escolhido na hora, porque ficam copiados em
  `proposta_itens`);
- adicionar um novo item (categoria, nome, valor, observação opcional).

Sem exclusão física de item do catálogo — só desativação — para nunca invalidar uma referência de
`proposta_itens.catalogo_plano_id` já salva.

## Fluxo da aba Proposta

1. Página carrega as propostas já existentes para o CNPJ (mais recente primeiro) e os itens de
   catálogo ativos, agrupados por categoria.
2. O construtor fica sempre visível e sempre começa vazio (propostas salvas não são reabertas — ver
   nota de escopo abaixo). O consultor vai adicionando linhas: escolhe categoria → plano (preenche
   descrição/valor automaticamente) ou escolhe "Oferta avulsa" (digita descrição e valor).
3. Cada linha adicionada aparece na lista com botão de remover; total soma em tempo real.
4. "Salvar proposta" grava `propostas` + `proposta_itens` em uma única operação no servidor (Server
   Action). Confirmação visual simples (toast/mensagem), sem redirecionamento.

**Nota de escopo:** esta entrega trata cada proposta salva como imutável depois de criada (sem
edição posterior de uma proposta já salva) — simples e suficiente para o caso de uso ("gerar nova
proposta" é o padrão já usado no funil antigo, `public.propostas`, para o mesmo cenário). O
consultor que quiser mudar algo cria uma nova proposta; as antigas ficam no histórico da aba.

**Quem pode salvar:** qualquer consultor ativo pode salvar uma proposta para qualquer lead (não exige
ser o dono, ao contrário de registrar mensagem); `propostas.consultor_id` guarda quem criou.
Propostas são sempre linhas novas, então dois consultores salvando para o mesmo CNPJ nunca se
sobrescrevem.

**Atomicidade:** o cliente Supabase não tem transação multi-tabela, então salvar grava o cabeçalho e
depois os itens; se os itens falharem, o cabeçalho recém-criado é apagado (limpeza compensatória) e
o erro é propagado.

## Testes

Segue o padrão TDD já estabelecido no projeto (Vitest). Cobertura mínima:

- `lib/catalogo.ts`: listar itens ativos agrupados por categoria, criar item, editar valor/observação,
  ativar/desativar.
- `lib/propostas.ts`: criar proposta com itens, listar propostas por CNPJ (mais recente primeiro),
  cálculo de total.
- Lógica do construtor da aba Proposta (`lib/proposta-rascunho.ts`, funções puras testadas em Node —
  o projeto não tem infra de teste de DOM; mesmo padrão de `lib/camadas.ts`): adicionar linha de
  catálogo preenche descrição/valor; adicionar oferta avulsa exige descrição e valor; remover linha
  atualiza o total; salvar com zero linhas é bloqueado (proposta vazia não faz sentido). O
  componente React fica fino, só liga essas funções ao estado e à Server Action.

## Review Focus

- **CNPJ sem nenhuma proposta ainda**: a aba Proposta deve abrir vazia/com builder pronto para a
  primeira proposta, não quebrar nem mostrar "erro ao carregar".
- **Catálogo sem itens ativos numa categoria** (ex.: admin desativa todos os itens de uma
  categoria): o select dessa categoria não trava a tela — mostra a categoria sem opções em vez de
  erro.
- **Valor do item do catálogo com observação de preço escalonado** (ex.: "por 3 meses, depois
  R$99,90"): a proposta salva o valor promocional atual e a observação completa como texto, para
  quem for ler a proposta depois entender a condição — não só o número.
- **Dois consultores diferentes abrindo a mesma `[cnpj]` ao mesmo tempo**: ambos devem conseguir
  salvar sua própria proposta sem um sobrescrever a do outro (cada proposta é uma linha nova, nunca
  um update na proposta de outro consultor).
- **Admin edita o valor de um item de catálogo depois que já existe proposta usando esse item**: a
  proposta antiga não muda de valor — ela guarda sua própria cópia em `proposta_itens.valor`/`descricao`.

---

**Pendências explicitamente fora de escopo deste sub-projeto:** aba de abordagem gerada por IA
(sub-projeto 3), exportação de comparativo de fatura em PNG/Word/PDF e botão de WhatsApp
(sub-projeto 5), upload de planilha para atualizar `public.clientes` (sub-projeto 4, inclui também
os campos `linhas_voz`/`valor_contrato` que este sub-projeto passa a exibir — hoje populados pela
carga de dados existente, sem mudança de pipeline aqui).
