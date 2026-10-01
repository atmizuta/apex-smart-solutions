# Monitoramento Leads — ligações manuais x leads (aba Digital)

Data: 01/10/2026 · Branch: `feat/monitoramento-leads` (worktree `.worktrees/monitoramento-leads`, base `oficial/main` d59bc76)

## 1. Objetivo

A partir de outubro/2026 os leads das campanhas ficam com **4 pessoas**: Caio, Gabriel Macedo, Luria e Mariana. O Rafael precisa acompanhar de perto se elas **ligam, tratam e vendem**. A telefonia não tem API: o relatório de chamadas manuais chega em Excel. O painel passa a:

1. receber esse relatório por upload e guardá-lo (acumulando, sem duplicar);
2. cruzá-lo com a tabela `leads` pelo telefone;
3. mostrar ao admin/supervisor quem liga, quanto, para quais leads e com que qualidade;
4. mostrar a cada consultor os **próprios leads para tratar**, na aba Pedidos Parados.

Sucesso = abrir a aba e, em segundos, saber quem está ligando, vendendo e deixando lead parado.

Base empírica (cruzamento de setembro, feito à mão em 30/09): 8.490 ligações manuais, 3.598 (42%) para números de lead; 546 de 832 leads ligados; 286 (34%) nunca ligados; 5 usuários da telefonia com 553 ligações e nenhuma para lead; um consultor com 14 tentativas por lead e outro com 3.

## 2. Decisões já tomadas com o usuário

- Fica dentro de **Digital**, como sub-aba, no estilo de Visão Geral / Visão Diária do Dashboard.
- **Monitoramento Leads é só admin e supervisor.** O consultor **não** vê ligações de ninguém nem o monitoramento.
- Cada consultor vê **só os próprios leads**, dentro da aba **Pedidos Parados** (que já existe no `oficial/main`, seção 53 do REGRAS_NEGOCIO).
- Dentro do monitoramento, o bloco de ligações segue esta ordem: upload, fila sem ligação (ideia 1), cadência (2), placar do dia (4), qualidade (5), e só depois a tabela por consultor, com duas abas ("Todos" e "Os 4 de leads").
- Padrões iniciais de meta (ajustáveis): mínimo 3 tentativas por lead, teto 10, meta 80 ligações por dia, conversa boa = 60 s falados.

## 3. O que já existe e será reaproveitado (não refazer)

| Existe em `oficial/main` | Como entra aqui |
|---|---|
| Tabela `leads` com `aba` (SETEMBRO, AGOSTO, REPIQUE; OUTUBRO virá), `consultor`, `categoria`, `converteu`, `receita`, `phone_number` (seção 54) | Fonte dos cards. O mês do monitoramento = a `aba` escolhida. |
| Pílulas "Aba da planilha" na Digital (`conversaoAbaAtual`) | O monitoramento usa a mesma aba selecionada. |
| `leads_followups` + card "Meus leads e retornos" (seção 48) | Continua. Os leads para tratar do consultor usam os mesmos follow-ups. |
| `consultor_neo` e editor "Vínculo com o NeoCRM" (seção 53.2) | Padrão a copiar para o vínculo com a telefonia. |
| `fetchAllRows`, `escapeHtml`, `mostrarAviso`, `producaoAdminMode()`, `FUSO_SAO_PAULO`, SheetJS (`XLSX`), ExcelJS (export colorido, seção 48.4) | Reuso direto. |
| Pedidos Parados (NeoCRM, só do consultor) | Ganha uma seção nova; a lógica de pedidos não muda. |

## 4. Dados (migration aditiva `supabase/migrations/20261001000000_monitoramento_leads.sql`, com rollback)

Nada que o painel atual usa é alterado.

### 4.1 `ligacoes_manuais`
Uma linha por ligação do relatório da telefonia.

| Coluna | Origem no Excel |
|---|---|
| `id bigint primary key` | `ID` (único por ligação) |
| `usuario text` | `Usuario` (ex.: `apex.caiocosta`) |
| `telefone text`, `chave_tel text` | `Telefone`; `chave_tel` = DDD + 8 últimos dígitos |
| `gerada_em timestamptz` | `DataHora_Geracao` (horário de São Paulo, `-03:00`) |
| `atendida boolean` | `Status = 'ANSWERED'` |
| `seg_falados int` | `Tempo_Chamada` em segundos |
| `tabulacao text`, `transferido text`, `gravacao text` | `Última Tabulação`, `Transferido`, `Gravacao` |
| `importado_em timestamptz`, `importado_por uuid` | auditoria |

- Índices: `(chave_tel)`, `(usuario, gerada_em)`, `(gerada_em)`.
- A função `public.chave_tel(text)` (SQL, imutável) normaliza telefone nos dois lados (`leads.phone_number` vem como `p:+5512...`). Regra: só dígitos; se começar com 55 e tiver 12+ dígitos, tira o 55; chave = 2 primeiros + 8 últimos. Isso ignora o 9º dígito. Validada no cruzamento de setembro (832 leads, 3.598 casamentos).
- RLS: leitura e escrita só admin e supervisor. Consultor **nunca** lê a tabela; usa só a RPC da seção 6.3.

### 4.2 `leads_equipe` (quem recebe leads e como se liga a cada sistema)
`id`, `nome_planilha text` (como aparece em `leads.consultor`, comparado com a mesma normalização de `normalizarNomeConsultor`), `usuario_telefonia text` (comparação sem diferenciar maiúsculas), `profile_id uuid null` (login do painel), `monitorar boolean default true`, `desde date`.
- Semente: Caio / `apex.caiocosta`, Gabriel / `apex.gabrielM`, Luria / `Apex.luria`, Mariana / `apex.mariana`, todos com `monitorar = true`, `profile_id` nulo até o admin confirmar.
- Premissa a confirmar: na planilha de leads o Gabriel Macedo aparece só como "Gabriel". O outro Gabriel (`apex.gabriels`) não recebe lead.
- Editor (só admin) dentro da própria página Monitoramento Leads: lista, "ligar perfil", marcar/desmarcar monitorar. Por que existe: resolve nomes diferentes entre planilha, telefonia e login, e deixa o Rafael mudar a equipe de leads sem alterar código.

### 4.3 Metas
Chave `monitor_leads_metas` na tabela `config` (JSON): `min_tentativas` 3, `max_tentativas` 10, `meta_ligacoes_dia` 80, `conversa_boa_seg` 60. Editor (só admin) numa caixa recolhida no fim da página.

## 5. Navegação e permissões

- Digital ganha uma barra de sub-abas no topo: **Leads** (todo o conteúdo atual, inalterado) e **Monitoramento Leads** (botão criado só se `producaoAdminMode()`; o painel é removido do DOM para os demais, mesmo padrão da seção 48.1).
- O consultor não ganha sub-aba. Os leads dele ficam em **Pedidos Parados**.
- Visual: só tokens e classes existentes (`.card`, `.kpiGrid`, `.kpiCard`, `table.tbl`, `.filterPill`, `.badge`, `.btn`), sem hex fixo, sem mexer em sidebar, cabeçalho nem `ApexMotion` (regras do CLAUDE.md).

## 6. Monitoramento Leads (admin/supervisor)

Fluxo de dados: o navegador chama RPCs `security definer` (somente admin/supervisor, `search_path` fixo) que agregam no servidor. Motivo: o limite de 1.000 linhas do PostgREST (seção 36) e o volume de ligações (8,5 mil/mês) tornam inviável baixar tudo e cruzar no navegador.

### 6.1 Cabeçalho da página
- Mês (mesma `aba` da Digital, mostrada em texto) e indicador do relatório: "Relatório de ligações até DD/MM HH:MM · N ligações guardadas". Se o último dado tiver mais de 1 dia, um aviso "suba o relatório de hoje".
- **Upload do relatório** (botão + arrastar): lê o `.xlsx`/`.csv` com SheetJS, reconhece colunas pelo nome normalizado (sem acento, caixa ou espaços), recusa arquivo sem as colunas obrigatórias (`ID`, `Usuario`, `Telefone`, `DataHora_Geracao`, `Status`), faz upsert por `id` em lotes de 500 e mostra o resumo: lidas, novas, já existentes, período coberto, e usuários da telefonia sem vínculo. Sem apagar nada. Reenviar o mesmo arquivo não duplica.

### 6.2 Cards dos consultores monitorados (um por pessoa de `leads_equipe` com `monitorar`)
Do mês (aba escolhida), a partir de `leads`:
- Leads recebidos · Vendas (convertidos, regra 17.3/54.1) · **Taxa de conversão** · Perdidos · Em andamento · Sem contato · Receita (com ticket médio).
- Extras do cruzamento: **Leads sem nenhuma ligação** e **ligações para lead hoje** (do placar). Barra de conversão como nos cards atuais.
- Clique no card filtra os blocos abaixo por aquele consultor.

### 6.3 Bloco de ligações — nesta ordem
1. **Fila de leads sem ligação** (ideia 1): leads da aba, de consultores monitorados, sem nenhuma ligação manual para o telefone, do mais antigo para o mais novo, com há quantas horas/dias entraram, consultor e status na planilha. Destaque vermelho acima de um SLA (padrão 24 h; valor entra em `monitor_leads_metas` como `sla_primeira_ligacao_h`). Botão copiar telefone; exportar Excel.
2. **Cadência** (ideia 2): dois quadros — leads **abaixo do mínimo** de tentativas (e ainda em aberto) e leads **acima do teto** sem avançar. Mostra o status da planilha ao lado.
3. **Placar do dia** (ideia 4): por consultor monitorado, ligações para lead hoje, atendidas, minutos falados, leads tocados e % da meta diária, com a hora da última ligação (alerta "parado há X h" no horário comercial). Atualiza ao reabrir ou subir arquivo (os dados só chegam por upload).
4. **Qualidade** (ideia 5): por consultor, duração média falada, nº de conversas boas (≥ `conversa_boa_seg`), % de ligações atendidas, ligações atendidas com tabulação "SEM CONTATO" (suspeita de tabulação errada) e link para a gravação quando houver.
5. **Inconsistências** (extra, simples e de alto valor): lead "sem contato" na planilha com 3+ ligações (planilha desatualizada); lead "cliente não responde" com menos que o mínimo de tentativas (perdido cedo demais); lead com venda na planilha e nenhuma ligação (pode ter vindo por WhatsApp — só sinaliza).
6. **Tabela por consultor**, com duas abas (pílulas):
   - **Todos os consultores** (todos os usuários da telefonia no relatório);
   - **Os 4 de leads** (os `monitorar`).
   Colunas: ligações manuais (todas) · ligações para números de lead · **% do total** · atendidas · taxa de atendimento · **leads distintos** ligados · **tentativas por lead** · minutos falados · e as janelas **Hoje · Ontem · 7 dias · 30 dias · Data escolhida** (campo de data, igual ao filtro "De/Até" da Digital). Cada janela conta as ligações **para lead**; a coluna "Data escolhida" aceita um dia ou intervalo.
   - "Número de lead" = telefone presente em qualquer aba de `leads` (igual ao cruzamento de setembro). Usuário sem vínculo aparece pelo login da telefonia.
   - Ordenável; exportar Excel (ExcelJS, como em 48.4: título, legenda, cabeçalho congelado, linha colorida).

### 6.4 RPCs (todas `security definer`, `stable`, só `authenticated`; conferem `get_my_role() in ('admin','supervisor')`)
- `monitor_leads_cards(p_aba text)` → por consultor da equipe: contagens por categoria, receita, leads sem ligação.
- `monitor_leads_fila(p_aba text)` → leads sem ligação e leads com tentativas fora da faixa, já com o que a tela precisa.
- `monitor_ligacoes_por_consultor(p_ref date, p_de date, p_ate date)` → linhas por usuário da telefonia com todas as janelas, usando `p_ref` (hoje em São Paulo vindo do navegador) para hoje/ontem/7/30.
- O upload não usa RPC: faz `upsert` direto em `ligacoes_manuais` (RLS admin/supervisor).

## 7. Pedidos Parados — "Meus leads para tratar" (consultor)

Nova seção no topo do que já existe em `panel-pedidosparados`, **só para o consultor** (`canSeePedidosParados()`), acima dos pedidos do NeoCRM:
- Lista os leads do consultor ainda em aberto (`categoria` em `andamento` ou `sem_contato`), de **todas as abas**, com selo da aba.
- Por lead: nome, telefone (copiar/WhatsApp), status da planilha, dias desde a entrada, **nº de tentativas** e data/hora da **última ligação**, e o retorno agendado (de `leads_followups`), com os botões já existentes de agendar e concluir retorno.
- Ordem de urgência: sem nenhuma ligação → retorno atrasado → esfriando (sem toque há 5+ dias) → retorno hoje → resto.
- Chips de resumo no topo da seção: sem ligação, atrasados, esfriando, para hoje.
- **Quem é o consultor:** `leads_equipe.profile_id = auth.uid()` ⇒ `nome_planilha` ⇒ `leads.consultor`. Isso resolve nome diferente entre planilha e login (ex.: "Gabriel" × "Gabriel Macedo Martins"). Consultor sem vínculo vê "seu usuário ainda não foi ligado à equipe de leads".
- **Privacidade:** a RPC `meus_leads_para_tratar()` roda no servidor por `auth.uid()` e devolve só os leads dele, com tentativas e última ligação. Ele nunca lê `ligacoes_manuais` nem número de outros consultores.
- Se a tabela `ligacoes_manuais` estiver vazia, a seção funciona normalmente e mostra "ligações: sem dados".

## 8. Fora do escopo (por ora)
- API da telefonia / importação automática (hoje só upload).
- Consultor ver o próprio placar de ligações (pode vir depois, com o mesmo RPC).
- Avisos por Slack/WhatsApp.
- Ajustar o card "Meus leads e retornos" da Digital para usar `leads_equipe` (hoje compara só pelo nome do perfil).
- Qualquer mudança em Pedidos em Alerta (admin) ou na lógica de pedidos do NeoCRM.

## 9. Testes (estilo jsdom, dados **fictícios** — o repositório é público: nenhum telefone, nome ou CNPJ real)
- `test_monitoramento_leads.js`: `chave_tel` (55, 9º dígito, formatos `p:+55…` e `(19) 98128-0203`); leitura do Excel (colunas, cabeçalho com acento/caixa diferente, arquivo inválido); upsert sem duplicar; cards (contagens e conversão); fila e cadência (fronteiras do mínimo/teto/SLA); janelas hoje/ontem/7/30/data no fuso de São Paulo; tabelas "Todos" × "Os 4"; permissões (consultor não vê a sub-aba nem chama RPC de admin; admin vê); seção "Meus leads para tratar" (só do vínculo, ordem de urgência, sem vínculo, sem ligações); export Excel.
- Regressão: `test_conversao_vendas.js`, `test_digital_abas.js`, `test_leads_followups.js`, `test_pedidos_parados.js`, `test_reorganizacao_abas.js` e o `run_tests.sh` completo.
- SQL: script de verificação com tabelas pequenas fictícias, simulando cada papel (admin, supervisor, consultor vinculado, consultor sem vínculo, anônimo).

## 10. Entrega e riscos
- Edita só `_template.html` e gera `painel_clientes_apex.html` com `python build_painel.py`; atualiza `REGRAS_NEGOCIO.md` (próxima seção livre, `git fetch oficial` antes) e `COORDENACAO.md` se existir.
- **Migration: escrita no Supabase `apex` (produção) só com OK explícito do Rafael**, aplicada antes de publicar o painel (sem ela as novas telas mostram "não foi possível carregar" e o resto não quebra).
- **Publicação só com autorização do Rafael naquele momento**; antes, baixar o painel no ar e comparar; backup e conferência de MD5 como nas seções 48.8 e 54.4.
- Riscos: (a) o 9º dígito/formato de telefone — mitigado pela chave DDD + 8 dígitos; (b) o relatório da telefonia pode mudar de colunas — o upload valida e recusa com mensagem clara; (c) o nome "Gabriel" ambíguo — resolvido pelo vínculo editável; (d) outras sessões mexem em `_template.html` (linha base64 conflita) — um worktree por sessão e `git fetch oficial` antes de qualquer merge.
