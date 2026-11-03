# Equipe: placar do dia e relatório do dia por consultor — design

Data: 03/11/2026 · Seção do REGRAS_NEGOCIO: **§134** · DADOS FICTÍCIOS nos exemplos (repo público).

## Pedido e objetivo

Pedido do Rafael: *"no final do dia, na aba equipe, quando eu clicar em algum dos consultores, me gerar um relatório de como aquele consultor agiu aquele dia, quantos leads pegou, quantas vendas, quantas ligações e etc"*. Também foi pedido um **placar do dia**, para comparar os consultores.

- **Quem usa:** só admin e supervisor, na aba **Equipe** de Meus leads. O consultor não vê nada disso.
- **Onde:** tudo na tela, sem PDF.
- **Período:** hoje e dias anteriores, escolhidos por um campo de data.
- **Para que serve:** o gestor acompanha e cobra cada consultor com números do dia (volume, resultado, velocidade e disciplina) e vê quem está à frente.
- **Ficam para outras specs:** o resumo automático das 21h (item 3 da lista de ideias) e a nota do lead (item 7). O resumo vai reaproveitar a função `leads_dia_equipe` daqui.

## O que muda na tela (Equipe)

### Placar

- **Seletor e data:** a tabela de consultores ganha um seletor **Dia / Mês** (`kbSeg`) e, no modo Dia, um campo **data**, que começa em hoje e não aceita data futura.
  - **Mês:** a tabela de hoje, sem nenhuma mudança. É o modo em que a Equipe abre da primeira vez.
  - **Dia** (hoje ou o dia escolhido): colunas do dia.
  - A última escolha fica salva no navegador (`localStorage kbEqModo`, com try/catch).
- **Colunas do dia:**

  | Coluna | Mostra |
  |---|---|
  | Posição | 1º, 2º… |
  | Consultor | nome |
  | Pegos | pegou + recebeu, ex.: "8 + 3" |
  | Contatos | ligações / atendidas e, se houver, "· N WhatsApp" |
  | Min falados | minutos |
  | 1ª ligação | mediana, ex.: "6 min" |
  | Sem ligar | número, em vermelho se > 0 |
  | Classificados / OBS | dois números |
  | Retornos | feitos / atrasados |
  | Vendas | número |
  | Receita | valor |
  | Jornada | "13:04–20:51" |

- **Ordem:** mais vendas primeiro; no empate, mais ligações atendidas; depois o nome.
- **Dia passado:** o semáforo "Agora", o mapa por hora e a chave "Pega leads" são do momento atual, então somem nesse modo. Os números de sem contato, em andamento etc. continuam no modo Mês.
- **Avisos acima da tabela:**
  - **Hoje:** "Ligações chegam do ProContact de hora em hora; podem estar até 1 h atrasadas."
  - **Dia anterior a 27/10/2026:** "Pegos, classificados e vendas só existem a partir de 27/10/2026."

### Relatório do consultor

- **Como abre:** clicando no **nome** do consultor, abaixo da tabela, no lugar da lista de leads quando ela estiver aberta. Usa o estilo do Raio-X do Discador (§96), com as classes existentes e só variáveis de cor. Os números da linha continuam abrindo a lista com seleção (§126.3/§133).
- **Título:** "Nome · dia dd/mm" e botão **Fechar**.
- **Cartões:** os números do placar, cada um com a média da equipe no dia e ▲/▼ quando estiver acima ou abaixo.
- **Ritmo:**
  - barras de ligações e atendidas por hora, das 13h às 21h;
  - lista "Parado" com cada intervalo de mais de 30 min sem atividade dentro do expediente, por exemplo "15:10–16:02 (52 min)".
- **Leads do dia:** um por linha, para cada lead pego ou recebido no dia, com:
  - nome (clicar abre a ficha);
  - "pegou" ou "recebeu de X", com a hora;
  - tempo até o 1º contato, ou "sem contato";
  - número de ligações no dia;
  - status no fim do dia;
  - "venda R$ …" quando vendeu.
- **Perdidos no dia:** os leads que saíram dele por redistribuição, com a hora e para quem foram.
- **Ficou para trás (agora):** retornos atrasados e leads sem contato que ele tem neste momento. A lista é do momento atual, não do dia.

## Regras dos números

- **Dia:** 00:00 a 23:59 no horário de São Paulo.
- **Consultores:** os de `leads_equipe` com `profile_id`.
- **Ligações do consultor:** `ligacoes_manuais` com `lower(btrim(usuario)) = lower(btrim(leads_equipe.usuario_telefonia))`, igual à `leads_atividade_equipe2`. Consultor sem usuário de telefonia fica com ligações "—".

| Número | Regra |
|---|---|
| **pegos** | `leads_historico` com `acao='pegar'` e `por = consultor` no dia |
| **recebidos** | `leads_historico` com `acao='redistribuir'` e `depois->>'dono_id' = consultor` no dia |
| **perdidos** | `leads_historico` com `acao='redistribuir'` e `antes->>'dono_id' = consultor` e outro dono depois, no dia; mais as devoluções aos Livres (`acao='devolver'`, `antes->>'dono_id' = consultor`) |
| **ligacoes / atendidas** | ligações do consultor no dia / as com `atendida` verdadeiro |
| **min_falados** | `sum(seg_falados) / 60`, arredondado |
| **whatsapp** | `leads_contatos` com `profile_id = consultor`, `canal = 'whatsapp'`, no dia |
| **primeiro contato de um lead** | o que vier primeiro depois do pegar ou receber: ligação do consultor para o lead (`chave_tel(ligacao) = chave_tel(leads.phone_number)`, mesma regra da ficha) ou clique em `leads_contatos` do consultor naquele lead |
| **1ª ligação (placar)** | mediana, em minutos, do tempo até o primeiro contato, só entre os leads do dia que tiveram contato |
| **sem_ligar** | leads pegos ou recebidos no dia sem primeiro contato até o fim do dia (ou até agora, se o dia é hoje) |
| **classificados** | `acao='classificar'` com `por = consultor` no dia |
| **obs** | classificações que mudaram a OBS para um texto não vazio diferente do anterior (regra da `leads_atividade_equipe2`) |
| **retornos_feitos** | `agenda_retornos` do consultor com `quando` no dia e `status='feito'` |
| **retornos_atrasados** | `agenda_retornos` do consultor com `quando` no dia, ainda `pendente` e `quando` já passado |
| **vendas / receita** | classificações do consultor no dia em que `depois->>'converteu'` é verdadeiro e `antes->>'converteu'` não era / soma de `depois->>'receita'` dessas. Se no mesmo dia uma classificação posterior do mesmo lead desmarca a venda, ela não conta. |
| **jornada** | menor e maior horário do dia entre ligações, cliques, pegar e classificar do consultor |
| **por_hora** | 8 posições, das 13h às 20h (cada uma é a hora inteira): ligações e atendidas |
| **parados** | dentro do expediente (13h–21h, seg–sex): intervalos de mais de 30 min sem atividade, contando do início do expediente ou da última atividade. Hoje, conta só até agora |
| **media_equipe** | média de cada número entre os consultores com alguma atividade no dia. A da 1ª ligação é a mediana de todos os leads da equipe |

- **Atribuição da venda:** a venda conta para quem marcou no painel (`por`). Em 03/11 havia só 2 classificações feitas por alguém que não era o dono.
- **Ordem do placar:** `vendas desc, atendidas desc, nome`.

## Banco

Uma migration nova (`supabase/migrations/20261103xxxxxx_leads_dia.sql`), sem DROP, sem tabela nova e sem alterar função existente. Os números são calculados na hora, a partir de `leads_historico`, `ligacoes_manuais`, `leads_contatos`, `agenda_retornos`, `leads` e `leads_equipe`. Os índices atuais bastam: em 03/11 eram cerca de 20 mil ligações e cerca de 740 linhas de histórico.

- **`leads_dia_equipe(p_dia date default (now() at time zone 'America/Sao_Paulo')::date)`**
  - Devolve uma tabela com: `dono_id`, `nome`, `tem_telefonia`, `pegos`, `recebidos`, `perdidos`, `ligacoes`, `atendidas`, `min_falados`, `whatsapp`, `primeiro_contato_mediana_min`, `sem_ligar`, `classificados`, `obs`, `retornos_feitos`, `retornos_atrasados`, `vendas`, `receita`, `jornada_inicio`, `jornada_fim` e `posicao`, já na ordem do placar.
- **`leads_dia_consultor(p_dono uuid, p_dia date)`**
  - Devolve um jsonb com:
    - `dia`;
    - `historico_desde` ('2026-10-27');
    - `numeros` (a linha do consultor);
    - `media_equipe`;
    - `por_hora` (`[{h, ligacoes, atendidas}]`);
    - `parados` (`[{de, ate, min}]`);
    - `leads` (`[{aba, lead_id, nome, como: 'pegou'|'recebeu', de_nome, em, primeiro_contato_min, ligacoes, status, vendeu, receita}]`);
    - `perdidos` (`[{aba, lead_id, nome, em, para_nome}]`);
    - `pendencias` (`{retornos_atrasados: [...], sem_contato: [...]}`, do momento atual).
- **Comum às duas:**
  - `security definer`, `stable` e `search_path public`.
  - A primeira linha recusa quem não for admin ou supervisor com `42501`.
  - `p_dia` maior que hoje → erro `22023` "data no futuro".
  - `revoke` de public e anon; `grant` para authenticated.
- **Conferência:** `supabase/tests/leads_dia_check.sql`, em `begin … rollback`, com dados fictícios. Cobre:
  - consultor que pega e recebe;
  - ligações atendidas e não atendidas;
  - WhatsApp;
  - classificar com e sem OBS nova;
  - venda e venda desmarcada no mesmo dia;
  - retorno feito e retorno atrasado;
  - lead sem contato;
  - intervalo parado de mais de 30 min;
  - ordem do ranking com empate em vendas;
  - recusa para consultor;
  - data futura.
- **Aplicação:** no banco de produção (mdgfboijyqfkggcrhptn), só com o ok do Rafael, por `execute_sql` em `begin/commit` (ver nota sobre SQL grande no conector).

## Painel (`_template.html`)

- **Estado:** `kbEstado.equipeModo` ('mes' | 'dia'), `kbEstado.equipeDia` ('AAAA-MM-DD'), `kbEstado.diaEquipe` (linhas da função) e `kbEstado.relatorio` (`{dono, dados}` ou null).
- **Carga:**
  - No modo dia, `kbCarregarEquipe` chama `leads_dia_equipe(p_dia)` junto com o que já carrega.
  - Se a função não existir (erro), `kbEstado.diaDisponivel = false` e o seletor não aparece. A Equipe segue como hoje.
  - Trocar a data recarrega só `leads_dia_equipe` e, se estiver aberto, o relatório.
- **Render:**
  - `kbTabelaDiaHtml(linhas, opc)`: função pura, testável.
  - `kbRelatorioHtml(dados)`: função pura.
  - `kbRenderEquipe` escolhe a tabela pelo modo.
  - O nome na tabela vira `button.kbLink[data-kb-relatorio="<dono>"]`.
  - O relatório substitui o bloco `lista` quando aberto. Abrir uma lista fecha o relatório, e vice-versa.
  - O `[data-kb-pode-pegar]` continua com prioridade no clique.
- **Funções puras:** `kbMedianaMin`, `kbFmtMin` (ex.: "6 min", "1 h 12 min", "—") e `kbSetaMedia(valor, media, maiorMelhor)`.
- **Visual:** reaproveitar `.kbEqTabela`, `.kbEqKpi`, `.kbCalor`/barras e `.kbSeg`, e as classes do Raio-X quando servirem. Sem cor fixa e sem mexer no bloco "SISTEMA VISUAL SINAL DE ÁPICE".
- **Atualização:** o modo "Hoje" atualiza junto com a Equipe (mesmo timer). Dia passado não atualiza sozinho.

## Erros

- **Função do dia falhou na hora** (rede): o aviso `mostrarAviso('Não foi possível carregar o dia agora.', 'erro')` e a tabela do Mês continua.
- **Relatório falhou:** mensagem no lugar do relatório, com o botão Fechar.
- **Consultor sem atividade no dia:** a linha aparece com zeros, e o relatório diz "Sem atividade registrada neste dia."

## Testes

- **`test_leads_dia.js`** (JSDOM, dados fictícios, mesmo modelo do `test_meus_leads_fase3.js`):
  - funções puras (mediana, formatação, setas);
  - seletor Hoje/Mês e data;
  - colunas e ordem com posição;
  - aviso de 1 h e aviso antes de 27/10;
  - clique no nome abre o relatório com cartões, ritmo, parados e leads;
  - Fechar;
  - abrir uma lista fecha o relatório;
  - sem a função nova, a Equipe continua igual;
  - erro na carga do dia mostra o aviso;
  - a chave "Pega leads" não abre o relatório.
- **Suíte inteira** (`bash run_tests.sh`): só as falhas que já existem no `oficial/main`, conferidas lado a lado.
- **Banco:** `leads_dia_check.sql`.

## Publicação

1. Worktree `feat/equipe-dia` a partir do `oficial/main`.
2. Ok para aplicar o banco.
3. Ok para publicar o painel:
   - comparar com o ar;
   - backup;
   - MD5 no mesmo comando do envio;
   - conferir com e sem `www`.
4. §134 no REGRAS_NEGOCIO, push no oficial e `vigia_painel.ps1 -Aceitar`.

**Reverter:**
- **Painel:** copiar o backup de volta.
- **Banco:** as funções podem ficar, porque o painel antigo não as usa. Para tirar, `drop function` das duas.

## Fora do escopo

- Resumo automático das 21h.
- Nota do lead.
- Visão para o consultor ou Modo TV.
- PDF ou exportação.
- Congelar dias passados numa tabela.
- Período de vários dias.
- Mudar a atribuição de vendas.
