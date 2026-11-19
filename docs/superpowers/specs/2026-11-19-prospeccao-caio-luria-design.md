# Subaba "Prospecção" em Meus leads, só Caio e Lúria (§161)

**Data:** 19/11/2026 · **Pedido:** Rafael ("esse link se transforme em uma subaba lá no painel, porém apenas mostrando para
o Caio e para a Lúria"; "faça uma consulta no Nova Vida [...] o número principal da pessoa, que tenha WhatsApp";
"um mini Kanban [...] temporário"; "NÃO É NECESSÁRIO FAZER UMA INTEGRAÇÃO COM A PLANILHA, QUERO QUE VOCÊ APENAS PORTE
TODO O CONTEÚDO DA PLANILHA PARA O PAINEL")
**Seção do REGRAS:** §161 (próxima livre na `oficial/main` em 19/11; conferir com `git fetch oficial` antes de escrever)
**Repositórios:** painel e banco no oficial (`atmizuta/apex-smart-solutions`). O robô da Nova Vida **não muda**.
Os dois repositórios são **públicos**: nenhum CNPJ, razão social, nome de sócio, telefone ou id da planilha em código,
teste, migration, log ou commit. Os dados entram no banco só pelo SQL de carga, rodado fora do repo.

## 1. Por que

O Rafael tem uma planilha Google com clientes para o Caio e a Lúria trabalharem. Ela tem duas guias:

- **CAIO**, com 18 clientes da base Claro (45 colunas: CNPJ formatado, razão, fantasia, contato, telefone, celular,
  WhatsApp, e-mail, endereço, cidade, segmento, porte, `campanha_obs` "Ativou móvel em…" etc.). 15 têm telefone.
- **LURIA**, com 161 CNPJs (linha, cnpj, observação, resultado "Encontrado/Não encontrado", id_horus, razão social e
  telefone na 11ª coluna, sem cabeçalho). Só 8 têm telefone, 24 são "Não encontrado" e 25 têm a razão vazia ou `#ERROR!`.

São 179 CNPJs, todos diferentes, sem nenhum em comum entre as guias. Uns 156 estão sem telefone. A aba é **temporária**.

## 2. Decisões do Rafael (19/11)

| Tema | Decisão |
|---|---|
| Onde | Subaba **"Prospecção"** na barra do Meus leads (`#kbAbas`), ao lado de Equipe, Hoje, Quadro, Lista e Conversão |
| Quem vê | **Só Caio e Lúria** (`leads_equipe` ids 1 e 3) e o admin |
| Integração | **Nenhuma.** Cópia única do conteúdo das duas guias, sem leitura nem escrita posterior na planilha |
| Divisão | **Fila única**: os 179 entram sem dono em "Livres" e cada um clica em **Pegar**. O nome do dono aparece no cartão. Uma trava no banco impede que os dois peguem o mesmo cliente |
| Colunas | **Livres → Em contato → Retornar (data/hora) → Venda / Sem interesse / Sem contato**, com observação em todos |
| Telefone | Para quem está sem telefone, consulta na Nova Vida e escolhe **só o número principal com WhatsApp** (regra no §4.3). Telefone que já está na planilha fica como está |
| WhatsApp | O botão abre `wa.me` com **texto pronto** e editável: *"Olá, {sócio}! Aqui é {consultor}, da Claro Empresas. Estou entrando em contato sobre a {razão social}: temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?"* |
| Ligar | Mesmo padrão do Meus leads (§121): copia o número e abre a aba do ProContact |

## 3. Fora do escopo

Integração com a planilha, sincronização com o funil de leads (`leads`), relatórios, distribuição automática,
consulta de todos os sócios, histórico por ação, exportar Excel e abrir para outros consultores.

## 4. Banco

### 4.1 Tabelas (migration `20261119180000_prospeccao.sql`, só estrutura)

`public.prospec_acesso`
- `profile_id uuid primary key references profiles(id)`
- Carga: Caio e Lúria (`leads_equipe.profile_id` dos ids 1 e 3), inserida pela migration por **subselect em
  `leads_equipe`**, sem uuid no código.

`public.prospec_clientes`
- `id bigserial primary key`
- `cnpj text not null unique check (cnpj ~ '^[0-9]{14}$')`
- `aba_origem text not null check (aba_origem in ('CAIO','LURIA'))`
- `razao_social text`, `cidade text`, `uf text`, `segmento text`, `porte text`, `obs_planilha text`
- `dados jsonb not null default '{}'` guarda **todas as colunas originais** da linha (cabeçalho → valor), com
  `#ERROR!` e `########` virando nulo
- `telefone_planilha text` (só dígitos)
- `telefone_nv text`, `whatsapp boolean`, `socio_nome text`
- `nv_status text not null default 'nao_precisa' check (nv_status in ('nao_precisa','pendente','ok','sem_socios','sem_telefone','erro'))`
- `nv_consulta_id bigint references socios_consultas(id) on delete set null`
- `etapa text not null default 'livre' check (etapa in ('livre','contato','retornar','venda','sem_interesse','sem_contato'))`
- `retorno_em timestamptz`, `obs text`
- `dono_id uuid references profiles(id)`, `dono_em timestamptz`
- `atualizado_por uuid`, `atualizado_em timestamptz not null default now()`
- check: `etapa = 'livre'` se e só se `dono_id is null`
- check: `etapa = 'retornar'` exige `retorno_em`

RLS **ligada e sem policy** nas duas tabelas: ninguém lê nem escreve direto. Tudo passa pelas RPCs abaixo
(`security definer`, `search_path = public`, `revoke all from public, anon`, `grant execute to authenticated`).

### 4.2 RPCs

- `prospec_pode() returns boolean`: verdadeiro se `auth.uid()` está em `prospec_acesso` ou é admin, com
  `coalesce(get_my_role(), '') = 'admin'`, o mesmo padrão das RPCs do Meus leads (`leads_redistribuir`).
- `prospec_listar() returns jsonb`: devolve todos os 179, com o nome do dono e o **telefone efetivo**
  (`coalesce(telefone_planilha, telefone_nv)`), mais o `dados` da linha. Fora do acesso: erro `42501`.
- `prospec_pegar(p_id bigint) returns jsonb`: faz `update … set dono_id = auth.uid(), etapa = 'contato', dono_em = now()
  where id = p_id and dono_id is null`. Se nenhuma linha mudar, responde `{ok:false, motivo:'ja_tem_dono', dono}`.
- `prospec_mover(p_id, p_etapa, p_retorno_em, p_obs) returns jsonb`: aceita só do dono ou do admin. `p_etapa = 'livre'`
  equivale a soltar (dono nulo e retorno nulo) e mantém a obs. Valida `retornar` com data. Recusa 22023 com mensagem clara.

O volume é de 179 linhas, então `prospec_listar` devolve tudo de uma vez e o painel filtra no navegador.

### 4.3 Escolha do número (`prospec_escolher_numero(p_resultado jsonb)`, imutável)

1. Sócios do `resultado->'socios'` em ordem de `participacao` decrescente; no empate, a ordem do array.
2. No **primeiro sócio que tiver algum telefone**: 1º celular com `whatsapp = true` → senão 1º celular (`whatsapp = false`)
   → senão 1º fixo (`whatsapp = false`).
3. Se nenhum sócio tiver telefone, `nv_status = 'sem_telefone'`.
4. Devolve `{numero, whatsapp, socio_nome}`, com o número só em dígitos.

Uma função `prospec_aplicar_nv()` (só admin/SQL) percorre as linhas `pendente` cuja consulta terminou e grava
número, WhatsApp, sócio e `nv_status`. O status vem de `pronto` → `ok` ou `sem_telefone`, de `sem_socios` →
`sem_socios` e de `erro` → `erro`. Pode rodar quantas vezes for preciso, porque é idempotente.

## 5. Carga (uma vez, fora do repo)

1. Baixar as duas guias em CSV (a planilha é pública) para o scratchpad.
2. Um script Python local (`-I`, fora do repo) normaliza o CNPJ (14 dígitos), o telefone (só dígitos) e as colunas
   principais. Na guia CAIO o CNPJ sai de `NR_CPF_CNPJ_ASSINANTE`, porque a coluna `cnpj` está em notação científica.
   O telefone da planilha é `celular`/`whatsapp`/`telefone`, nessa ordem. Na guia LURIA o telefone é a 11ª coluna.
   O script gera um único `insert … on conflict (cnpj) do nothing`, rodado com `execute_sql` **com ok do Rafael**.
   Quem tem telefone recebe `nv_status = 'nao_precisa'` e quem não tem recebe `pendente`.
3. Conferir: 179 linhas, 18 CAIO, 161 LURIA, ~156 pendentes.

## 6. Nova Vida (uma vez, com ok do Rafael, **depois das 21h**)

- **Reuso:** se já existe `socios_consultas` com `pronto` ou `sem_socios` com menos de 30 dias para o CNPJ, ela é
  vinculada sem consultar de novo. Em 19/11 já há uma consulta pronta para um CNPJ da guia LURIA.
- **Resto:** um `insert into socios_consultas (cnpj_digits, origem, pedido_por, status) values (…, 'prospeccao',
  <profile do Rafael>, 'pendente')` para cada pendente, gravando o id em `prospec_clientes.nv_consulta_id`. Em seguida
  `select socios_disparar_robo()`.
- **Rodadas:** o robô pega 10 CNPJs por vez durante 7 min (uns 10 s por CNPJ, mais as páginas dos sócios), e o que não
  foi pego fica `pendente`. Quando a rodada termina, disparo o robô de novo até a fila zerar: são ~4 a 6 rodadas,
  menos de 1 hora. O `concurrency: novavida` garante um por vez.
- **Por que depois das 21h:**
  - o login da Nova Vida é compartilhado e provavelmente de sessão única (§156), então rodar no expediente derrubaria
    quem estiver usando;
  - a contagem do limite de 20/dia (`socios_pedir*`) soma toda linha com `pedido_por` do dia, sem olhar a origem. Rodando
    à noite, o Rafael fica sem consultas próprias só até a meia-noite. A contagem **não muda** nesta seção.
- As 156 consultas aparecem em "Minhas consultas" do Rafael na aba Consultar sócios. É aceitável, e o resultado fica
  30 dias, valendo para qualquer consultor.
- No fim: `select prospec_aplicar_nv()` e conferir quantos ficaram `ok` com WhatsApp, `ok` sem WhatsApp,
  `sem_telefone`, `sem_socios` e `erro`. Os de erro podem ganhar uma rodada a mais.

## 7. Painel (`_template.html`)

- Botão `data-kb-aba="prospec"` ("Prospecção") no `#kbAbas`, `hidden` por padrão. Depois do login, `prospec_pode()`
  decide se ele aparece. Painel `#kbProspec` dentro de `#panel-meusleads`, seguindo `kbTrocarAba`.
- **Barra:** Meus / Todos (padrão Todos, porque a fila é única), busca por razão, CNPJ, telefone ou sócio, e contadores
  por coluna.
- **Quadro:** seis colunas com rolagem própria e as classes do Kanban do Meus leads (`--ml-*`, `.kbBtn`), sem visual novo.
  Os cartões mostram:
  - razão social (sem razão, o CNPJ formatado), cidade/UF e segmento;
  - sócio e telefone, com selo **WhatsApp** (`var(--st-ganho)`, o único verde permitido) ou "sem WhatsApp", ou "sem telefone" / "consulta com erro";
  - o chip do **dono** (primeiro nome) ou, nos Livres, o botão **Pegar**;
  - os botões **WhatsApp** e **Ligar**, quando há número. Retornar mostra a data/hora, em vermelho se já passou.
- **Ficha** (clique no cartão, na mesma gaveta do Meus leads): botões de etapa, data/hora de retorno (obrigatória em
  Retornar), observação, "Soltar" (volta para Livres) e a tabela com **todas as colunas originais** (`dados`). Quem não
  é dono vê a ficha só para leitura.
- **WhatsApp:** `https://wa.me/55{numero}?text={texto}`, com o texto do §2 e o nome do consultor logado. Sem sócio, usa
  "Olá!" e, sem razão, omite o trecho da empresa. Abre em aba nova. Para número de 10 dígitos (fixo), o botão fica oculto.
- **Atualização:** recarrega depois de cada ação e a cada 60 s só com a subaba visível, parando ao sair da aba ou no logout.
- Toda a lógica pura (escolher o rótulo do telefone, montar o link do wa.me, filtrar e agrupar por coluna) fica em funções
  `prospec*` testáveis com node.

## 8. Testes

- `supabase/tests/prospeccao_check.sql`, em transação com rollback e dados fictícios. Casos:
  1. usuário fora do acesso recebe 42501 em listar, pegar e mover;
  2. pegar livre funciona, e um segundo pegar recebe `ja_tem_dono`;
  3. mover por quem não é o dono é recusado, e o admin pode;
  4. `retornar` sem data é recusado;
  5. soltar volta para livre e limpa o dono;
  6. `prospec_escolher_numero` cobre as ordens (participação, celular com WhatsApp, celular, fixo, sem telefone,
     empate de participação);
  7. `prospec_aplicar_nv` mapeia os status e é idempotente.
- `test_prospeccao.js` (node): link do wa.me (codificação, falta de sócio ou de razão), rótulo do telefone,
  agrupamento e busca.
- A suíte inteira (`bash run_tests.sh`) antes de publicar, com as falhas já conhecidas na `oficial/main` aceitas.

## 9. Publicação e retirada

Cada passo tem ok do Rafael na hora, nesta ordem: migration → carga → Nova Vida à noite → publicar o painel (fluxo
padrão: comparar com o ar, backup, MD5 no mesmo comando, vigia) → REGRAS §161 → push na oficial.

**Retirada:**
- `delete from prospec_acesso` esconde a subaba sem publicar;
- depois de o Rafael confirmar, remover o botão e o painel do `_template.html` e apagar as tabelas e funções `prospec_*`
  (seção nova no REGRAS).

## 10. Riscos

- **Sessão única da Nova Vida:** a carga noturna pode derrubar alguém logado fora de hora. Avisar o time.
- **Telefone errado ou antigo:** a Nova Vida pode trazer número desatualizado. A coluna "Sem contato" cobre isso, sem
  consulta automática de outro sócio.
- **Volume:** são 179 linhas, então ler tudo a cada 60 s por 2 a 3 pessoas não pesa no Micro.
