# CRM de Leads — Fibra & Renovação

**Data:** 2026-09-25
**Responsável:** conversa entre o usuário (gestor comercial) e Claude
**Escopo:** ferramenta nova e separada para consultores selecionados trabalharem os
segmentos de fibra viável e renovação extraídos da base de clientes existente
(`APEX_202609.xlsb` → tabela `public.clientes` no Supabase). Não inclui, por
enquanto, o botão de acesso a partir do painel atual (fica para uma fase
posterior, ver seção 11).

## 1. Contexto

A Apex já opera um painel de clientes (`crm/painel_clientes_apex.html`, ~6.900
linhas, app único de HTML/JS) com Supabase Auth, papéis (`admin`/`supervisor`/
`consultor`), e um kanban de propostas (`public.propostas`) com os estágios
`lead → proposta_enviada → negociacao → fechado_ganho/fechado_perdido`. Esse
painel é hospedado como arquivo estático (Hostinger, `public_html/`) e é
mantido também por um colega, Rafael, que tem uma proposta separada de
triagem automática de leads de tráfego pago (Meta Ads) — documentada em
`docs/proposals/2026-09-23-proposta-triagem-leads-no-crm.md` e
`docs/superpowers/specs/2026-09-23-captacao-leads-claro-design.md`. Aquela
proposta mexe na tabela `public.leads` (leads de anúncio) e reserva
explicitamente "CRM completo e dashboards internos" como sub-projeto futuro —
este documento é esse sub-projeto, para uma frente diferente (a base de
clientes existente, não os leads de anúncio).

Análise da base (`APEX_202609.xlsb`, aba `BASE`, 6.532 CNPJs, já espelhada em
`public.clientes`) identificou:

- 191 CNPJs prontos para vender fibra agora (CEP cabeado, sem banda larga
  contratada, comercialmente liberados, com capacidade de rede)
- 260 liberados comercialmente, aguardando checagem de capacidade
- 485 com viabilidade mas sem classificação comercial no sistema
- 1.498 clientes aptos a renovar nos próximos 60 dias
- 54 no combo renovação + fibra viável
- 94,7% da base ativa sem consultor nomeado
- 201 CNPJs com situação cadastral irregular ainda na régua comercial

Essas 5 listas (exportadas como CSV durante a análise) e as 8 estratégias de
abordagem (documentadas no PDF `Estrategia_Fibra_Renovacao_Apex.pdf`, também
já entregue) são o ponto de partida funcional deste sistema — o sistema é a
versão operacional, viva e multiusuário daquele PDF.

## 2. Objetivo

Dar a consultores selecionados uma ferramenta dedicada para:

1. Ver, com dono claro, os leads de fibra e renovação segmentados por
   prontidão.
2. Receber sugestões de abordagem prontas (geradas por IA, personalizadas por
   lead) e mandar pelo WhatsApp em um clique.
3. Montar uma proposta (renovação ou incremento de linhas) e gerar PDF/imagem
   com a identidade visual da marca.
4. Acompanhar tudo isso num kanban e num dashboard com métricas reais.

## 3. Não-objetivos (fora de escopo agora)

- Botão de acesso dentro do painel atual — só depois que este sistema estiver
  validado (seção 11).
- Book de planos real — o usuário vai enviar depois; por enquanto o cadastro
  de planos é populado com poucos exemplos genéricos, só para o fluxo de
  proposta não ficar bloqueado.
- Integração com WhatsApp Business API/webhooks — o envio é via link
  `wa.me` pré-preenchido (abre o WhatsApp do consultor), não uma API de
  disparo/recebimento automatizado.
- Frente TIM/Eagle Sales, leads de tráfego pago (Meta Ads) e a automação de
  triagem do Rafael — sistemas e tabelas diferentes, sem sobreposição.
- Reativação/regularização de CNPJ irregular — o sistema só sinaliza e tira
  esses CNPJs da régua ativa (Estratégia 7 do PDF); o processo de verificação
  em si continua manual.
- Alteração de qualquer tabela, política de RLS ou tela do painel atual.

## 4. Usuários e papéis

- **admin** — cria/desativa login de consultor, vê todos os leads e
  propostas, vê o dashboard completo e o ranking.
- **consultor** — vê os leads atribuídos a ele (e o pool de leads sem dono,
  para se atribuir), monta propostas, envia mensagens, vê seu próprio
  desempenho no dashboard.

Time de referência inicial (visto no documento do Rafael): Caio, Gabriel,
Giovanna, Manuela, Rafael, Victoria — usado só como sugestão de seed inicial;
o admin decide quem realmente recebe login neste sistema.

## 5. Decisão de arquitetura (já validada com o usuário)

- **Mesmo projeto Supabase do painel atual** (`apex`, ref
  `mdgfboijyqfkggcrhptn`), em um **schema novo** (`crm_fibra`), isolado de
  `public` por schema e por RLS. Nenhuma tabela existente é alterada.
- A base de clientes continua sendo `public.clientes` — lida diretamente
  (via uma view no schema novo), nunca copiada. Isso resolve "base sempre
  atualizada" sem nenhum job de sincronização.
- **App novo**, código e deploy separados do painel atual: Next.js (mesmo
  padrão já usado em `pratica-vendas/`), deploy no Vercel, domínio próprio.
- **Login totalmente separado** do Supabase Auth do painel — autenticação
  própria (usuário/senha com hash bcrypt, sessão via JWT assinado em cookie
  httpOnly), seguindo o mesmo padrão de segurança já validado em
  `pratica-vendas/` (inclusive hash dummy pré-computado para evitar
  timing attack no login, como já foi corrigido lá).

Alternativas consideradas e descartadas: projeto Supabase 100% isolado
(rejeitado — exigiria job de sincronização da base, contradiz "base viva sem
reimportação"); nova aba dentro do painel atual (rejeitado — usuário pediu
explicitamente sistema e login separados, e o arquivo do painel já é grande
e é mantido também pelo Rafael).

## 6. Modelo de dados (schema `crm_fibra`, tudo aditivo)

```sql
create schema if not exists crm_fibra;

-- Login e consultores deste sistema (independente de auth.users do painel)
create table crm_fibra.consultores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  username text not null unique,
  password_hash text not null,
  papel text not null default 'consultor' check (papel in ('admin','consultor')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz
);

-- Quem é dono de qual CNPJ, e status de contato (Estratégia 1 do PDF)
create table crm_fibra.atribuicoes (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,              -- casa com clientes.cnpj_digits
  consultor_id uuid not null references crm_fibra.consultores(id),
  status_contato text not null default 'nao_contatado'
    check (status_contato in ('nao_contatado','tentativa_1','tentativa_2','tentativa_3','respondeu','sem_resposta')),
  atribuido_em timestamptz not null default now(),
  ultimo_contato_em timestamptz,
  unique (cnpj_digits)                    -- um dono por CNPJ nesta campanha
);

-- Histórico de mensagens (o que já foi mandado, por quem, se foi IA)
create table crm_fibra.mensagens (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','ligacao','email')),
  conteudo text not null,
  gerado_por_ia boolean not null default false,
  abordagem_tipo text,                    -- ex: 'direta' | 'tecnica' | 'urgencia'
  enviado_em timestamptz not null default now()
);

-- Cache das sugestões de IA por lead (custo/latência)
create table crm_fibra.abordagens_ia_cache (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  camada text not null,                   -- 'fibra_pronta' | 'fibra_verificar_capacidade' | ...
  sugestao_direta text,
  sugestao_tecnica text,
  sugestao_urgencia text,
  gerado_em timestamptz not null default now(),
  unique (cnpj_digits, camada)
);

-- Planos disponíveis (placeholder até o book real chegar)
create table crm_fibra.planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('renovacao','incremento')),
  linhas_min int,
  linhas_max int,
  valor_linha numeric,
  descricao text,
  ativo boolean not null default true
);

-- Kanban de propostas desta campanha (separado do public.propostas do painel)
create table crm_fibra.propostas (
  id uuid primary key default gen_random_uuid(),
  consultor_id uuid not null references crm_fibra.consultores(id),
  cnpj_digits text not null,
  cliente_nome text,
  tipo_proposta text not null check (tipo_proposta in ('renovacao','incremento')),
  linhas jsonb,                           -- [{quantidade, plano_id, valor}]
  valor_atual numeric,
  valor_proposto numeric,
  estagio text not null default 'rascunho'
    check (estagio in ('rascunho','enviada','negociacao','fechado_ganho','fechado_perdido')),
  motivo_perda text,
  observacoes text,
  pdf_url text,
  imagem_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table crm_fibra.propostas_historico (
  id bigint generated always as identity primary key,
  proposta_id uuid not null references crm_fibra.propostas(id),
  consultor_id uuid not null references crm_fibra.consultores(id),
  estagio_anterior text,
  estagio_novo text not null,
  nota text,
  criado_em timestamptz not null default now()
);

-- Segmentação ao vivo, direto em cima de public.clientes (zero cópia)
create view crm_fibra.leads_segmentados as
select
  c.cnpj_digits,
  c.razao_social,
  c.cidade,
  c.ddd,
  c.tel1, c.tel2, c.telefone_contato, c.email,
  c.arpu,
  c.apto_renovacao,
  c.cep_cabeado,
  c.linhas_fixas,
  case
    when c.cep_cabeado = 'CEP Cabeado' and coalesce(c.linhas_fixas,0) = 0
      then 'fibra_candidato'
    else null
  end as elegivel_fibra,
  -- camadas de prontidão de fibra e pipeline de renovação replicam
  -- exatamente a lógica usada na análise em Python (ver scripts da sessão
  -- de 2026-09-25); a query completa entra no plano de implementação.
  a.consultor_id as dono_consultor_id,
  a.status_contato
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits;
```

Notas:

- `cnpj_digits` é a chave de junção com `public.clientes` (coluna gerada já
  existente lá) — evita problemas de formatação de CNPJ (pontos/traços).
- Nenhuma FK aponta para `auth.users` ou para qualquer tabela de `public`
  além de uma leitura (`select`) em `public.clientes` — o app novo nunca
  escreve em `public`.
- A view `leads_segmentados` acima está simplificada para o desenho; a
  lógica completa das camadas (fibra pronta / aguardando capacidade /
  aguardando status / pipeline de renovação / CNPJ irregular / bloqueado)
  precisa reproduzir fielmente os cruzamentos já validados em Python
  (`CEP CABEADO?`, banda larga contratada, `DSC_SITUACAO_COMERCIAL`,
  `HP LIVRE VENDA`, `APTO RENOVAÇÃO`, `situacaoCadastral`) — isso vira SQL
  explícito no plano de implementação, não é decisão de design em aberto.

### RLS (regra geral)

Todas as tabelas de `crm_fibra` têm RLS habilitado. Como o app usa
autenticação própria (não Supabase Auth), o acesso do frontend passa por uma
API própria do Next.js usando a **service role key** do Supabase no servidor
(nunca exposta ao navegador) — o RLS aqui é uma segunda camada de defesa,
não o mecanismo principal de controle de acesso (que é a sessão JWT validada
no servidor Next.js). Isso é o mesmo modelo que `pratica-vendas` já usa para
o próprio Postgres.

## 7. Autenticação

- Tela de login própria (identidade "Sinal de Ápice"): usuário + senha.
- `POST /api/login`: busca `crm_fibra.consultores` por `username`, compara
  hash com bcrypt (usando um hash dummy pré-computado quando o usuário não
  existe, para não vazar por timing se o username existe ou não — mesmo
  cuidado já aplicado em `pratica-vendas`), emite JWT assinado (lib `jose`),
  grava em cookie httpOnly, atualiza `ultimo_login`.
- Middleware do Next.js protege todas as rotas exceto `/login`.
- Aba **Consultores** (só `papel = 'admin'`): criar login (gera senha
  temporária ou o admin define), desativar (`ativo = false`, sessão futura
  é recusada mesmo com JWT válido — checagem no middleware consulta o banco,
  não confia só no conteúdo do token), resetar senha.

## 8. Telas

1. **Login**
2. **Dashboard** — KPIs ao vivo (equivalentes aos do PDF: prontos agora,
   aguardando capacidade, aguardando status, pipeline de renovação, combo,
   sem dono), gráfico de funil, ranking semanal de consultores (leads
   tocados, propostas enviadas/fechadas — Estratégia 8 do PDF). Admin vê o
   time todo; consultor vê o próprio desempenho + os agregados gerais.
3. **Carteira de leads** — lista filtrável pelas mesmas camadas das 5 listas
   (fibra pronta / aguardando capacidade / aguardando status / renovação /
   irregular), indicador de dono, busca por nome/cidade/CNPJ. Um lead sem
   dono pode ser "assumido" por um consultor (grava em `atribuicoes`).
4. **Card do lead** — dados do cliente, histórico de `mensagens`, as 3
   sugestões de abordagem por IA (editáveis), botão "enviar por WhatsApp"
   (abre `wa.me/<telefone>?text=<mensagem>` com o texto — depois de aberto,
   grava a mensagem em `crm_fibra.mensagens` como enviada), botão "nova
   proposta", botão "atribuir a mim" quando ainda não tem dono.
5. **Nova proposta** — formulário: tipo (renovação/incremento), quantidade
   de linhas, plano (lista de `crm_fibra.planos`), valores. Ao salvar: cria
   `crm_fibra.propostas` (estágio inicial `rascunho` ou `enviada`, conforme
   o consultor escolher), gera PDF e imagem com a identidade visual (mesmo
   pipeline usado no PDF de estratégia: HTML com os tokens de marca + render
   para PDF/PNG no servidor), grava as URLs geradas.
6. **Kanban de propostas** — colunas pelos estágios (`rascunho` fica fora do
   quadro até "enviada", refletindo o funil real), drag-and-drop, modal de
   motivo ao mover para `fechado_perdido`, histórico por card.
7. **Consultores** (admin) — CRUD de login.

## 9. Motor de abordagens por IA

- Provedor: Gemini (mesmo já usado em `pratica-vendas`, evita nova conta/
  custo de configuração).
- Entrada do prompt: dados do lead (cidade, camada/segmento, ARPU, se já
  teve fixa, tempo de contrato) + o guia de tom de voz da marca já
  documentado no manual "Sinal de Ápice" (Direto / Técnico / Próximo, com os
  exemplos de "sim"/"não" do manual) como instrução de estilo fixa no
  prompt.
- Saída: sempre 3 variações rotuladas (`direta`, `tecnica`, `urgencia`),
  curtas (o mesmo padrão de frase curta, verbo na frente, usado nos scripts
  do PDF).
- Cache em `crm_fibra.abordagens_ia_cache` por `(cnpj_digits, camada)` — se
  já existe sugestão gerada e o lead não mudou de camada, reaproveita em vez
  de chamar a IA de novo. Botão "gerar de novo" força uma nova chamada.
- Se a chamada à IA falhar (erro de rede, limite de cota), cai para um
  conjunto de 3 textos fixos por camada (os mesmos scripts do PDF) — nunca
  deixa o consultor sem nada pra mandar.

## 10. Geração de proposta (PDF e imagem)

Reaproveita o mesmo pipeline de marca já construído para o PDF de
estratégia (HTML com os tokens de cor/tipografia "Sinal de Ápice" +
renderização para PDF). No servidor Next.js (rota de API/edge function),
monta o HTML da proposta com os dados escolhidos (linhas, plano, valores) e
gera:

- um **PDF** (documento completo, para anexar/imprimir)
- uma **imagem** (PNG, recorte único tipo "cartão de oferta", pensado para
  mandar direto na conversa do WhatsApp)

Ambos ficam armazenados (Supabase Storage, bucket novo `crm-fibra-propostas`)
e as URLs são salvas em `crm_fibra.propostas`.

## 11. Botão no painel atual (fase futura, não neste projeto)

Quando este sistema estiver validado, adicionar um link simples no painel
atual apontando para o domínio deste app novo — sem nenhuma outra mudança no
painel. Fica registrado aqui só para não ser esquecido.

## 12. Riscos e pontos em aberto

- **Book de planos real**: cadastro de `crm_fibra.planos` começa com poucos
  exemplos genéricos; precisa ser atualizado quando o usuário enviar o book
  real (não bloqueia o desenvolvimento).
- **Formatação de telefone para `wa.me`**: `clientes.tel1`/`tel2` não têm
  formato garantido (viu-se no CSV telefones sem DDD, com `0.0`, etc.) — o
  plano de implementação precisa de uma normalização defensiva antes de
  montar o link, com fallback manual se não for possível validar.
- **Custo/latência de IA**: Gemini por lead tem custo pequeno mas real; o
  cache mitiga, mas o plano deve incluir um limite simples de geração (ex.:
  não regenerar em menos de X minutos) para evitar abuso acidental.
- **RLS em `crm_fibra`**: como o acesso principal é via service role no
  servidor, as políticas de RLS são uma camada de segurança adicional, não
  a única — o plano de implementação deve deixar claro que a rota de API do
  Next.js é a fronteira de autorização real.
- **Seed inicial de consultores**: os nomes vistos no documento do Rafael
  são só sugestão; a lista real de quem recebe login é uma decisão do
  usuário, feita pela aba Consultores depois do sistema no ar.

## 13. Critério de sucesso

- Os 191 leads "prontos agora" têm dono e pelo menos uma mensagem registrada
  em até 1 semana do sistema no ar.
- Toda proposta criada nesta campanha gera PDF e imagem sem erro.
- Dashboard reflete, ao vivo, os mesmos números já validados na análise da
  base (191 / 260 / 485 / 1.498 / 54 / 201) no momento em que o sistema
  entra no ar.
