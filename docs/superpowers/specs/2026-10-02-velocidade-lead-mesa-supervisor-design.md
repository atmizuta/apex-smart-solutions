# Velocidade do lead ("Atender agora") + Mesa do Supervisor

**Data:** 02/10/2026
**Responsável:** Rafael
**Branch:** `feat/velocidade-lead-mesa-supervisor` (worktree `.worktrees/velocidade-mesa`, base `oficial/main` 466fd5b)
**Status:** spec para revisão (nada construído)

## 1. Objetivo e critérios de sucesso

O pedido de 02/10 tem dois objetivos: **aumentar a conversão dos consultores** e **dar praticidade ao supervisor**. A partir do brainstorming, foram escolhidas as ideias 1 e 5.

1. **"Atender agora"**: todo lead novo chega ao consultor com um relógio de minutos úteis. O primeiro contato é registrado sozinho, quando o consultor clica em WhatsApp ou Ligar, e também pela telefonia. Quem atende devagar fica visível.
2. **Mesa do Supervisor**: uma aba única com o semáforo de cada consultor e a ação de cobrar em 1 clique, no lugar de abrir Digital, Monitoramento, Pedidos em Alerta e Funil.

**Sucesso:**
- O supervisor abre a Mesa e, em menos de 10 s, sabe quem está com lead esperando, retorno atrasado, proposta parada ou pedido em risco. Daí manda a cobrança em 1 clique.
- O consultor vê o lead novo no painel em até 10 min da entrada na planilha, com o relógio correndo.
- Depois de 30 dias, a % de leads atendidos em até 15 min úteis é medida por consultor e sobe em relação à linha de base.
- A Mesa mostra a conversão por faixa de tempo até o 1º contato. Com isso a hipótese "rápido converte mais" passa a ser validada com dado da própria operação.

## 2. Base empírica (Supabase `apex`, leitura em 02/10/2026)

| Fato | Número |
|---|---|
| Lead com 1ª ligação em menos de 15 min, contra o resto (Set+Out, ~600 leads ligados) | 31,7% de conversão contra 13–15% |
| Mesmo corte, só leads que chegaram em dia útil entre 08h e 18h | menos de 15 min: 36% (n=25); 15 min a 1 h: 12,8% (n=39) |
| Leads que chegam fora do horário (19h–07h ou fim de semana) | ~40%. O pico é às 21h |
| Leads em horário comercial sem nenhuma ligação no ProContact | 133 de 344, com 39,8% de conversão. Foram atendidos pelo WhatsApp ou por fora |
| Propostas em `proposta_enviada` | 74, paradas há 26 dias em média |
| `leads_followups` (retornos) | 0 linhas: o botão da seção 64 não está sendo usado |
| Pedidos NeoSales desde setembro | 159 perdidos, 49 devolvidos, 63 em biometria |

**Conclusões que moldam o desenho:**
- O indício de que velocidade importa é forte, mas a amostra é pequena. Por isso a feature mede a própria hipótese (seção 6.5).
- O relógio **não pode contar a noite**, senão 40% dos leads nasceriam vermelhos (minutos úteis, seção 4.2).
- A ligação sozinha não mede o 1º contato, porque boa parte é pelo WhatsApp. É preciso registrar o **clique** (seção 4.1).
- Os atrasos do caminho de dados:
  - o lead entra no banco pelo `sync-leads` a cada 30 min (seção 62);
  - a ligação chega pelo robô de hora em hora (seção 67).

  Um SLA de 15 min só é observável com o clique registrado na hora e o sync de leads mais frequente (seção 4.4).

## 3. O que já existe e é reaproveitado

| Existe em `oficial/main` | Uso aqui |
|---|---|
| `leads` (PK `aba,id`; `consultor`, `categoria`, `converteu`, `criado_em_lead`, `phone_number`) | Fonte dos leads e do relógio |
| `ligacoes_manuais` + `chave_tel()` + robô horário (seções 59, 65, 67) | 1º contato pela telefonia |
| `leads_equipe` (`nome_planilha` ↔ `usuario_telefonia` ↔ `profile_id`) | Liga o nome da planilha ao login |
| `meus_leads_nomes()`, `norm_nome()` (seção 60) | Saber se o lead é do consultor logado |
| `leads_followups` (retornos, por `consultor_id`) | Retornos atrasados na Mesa |
| `propostas` (`consultor_id`, `estagio`, `estagio_entrada_em`) | Propostas paradas na Mesa |
| `producao_pedidos_neo.usuario_id` + `consultor_neo` + `producao_etapa_historico` (seção 53) | Pedidos em risco por consultor |
| `PP_FAIXAS`, `ppNivel`, `ppDiasUteisDesde`, `ppFeriados` (Pedidos Parados) | Nível do pedido em risco, idêntico ao Pedidos Parados |
| `metas_consultor`, `config.monitor_leads_metas`, `meu_placar_ligacoes` | Meta do mês e ligações de hoje |
| "Meus leads para tratar" (`plLista`, botão WhatsApp `plWhats`, `plMensagemWhats`) | Recebe o card "Atender agora" e o registro do clique |
| `producaoAdminMode()`, `mostrarAviso`, `fetchAllRows`, `escapeHtml`, ExcelJS sob demanda | Reuso direto |

## 4. Dados (migration aditiva `supabase/migrations/20261002100000_velocidade_lead_mesa.sql`, com rollback)

Nada do que o painel usa hoje muda de assinatura.

### 4.1 Tabela `leads_contatos`: registro do 1º contato pelo painel
| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `bigint generated always as identity` PK | |
| `lead_aba`, `lead_id` | `text not null` | Chave do lead (`leads.aba`, `leads.id`) |
| `profile_id` | `uuid not null` | Quem clicou (`auth.uid()`) |
| `canal` | `text not null` check in (`whatsapp`, `ligar`, `manual`) | `manual` = botão "Já falei com ele" |
| `em` | `timestamptz not null default now()` | |

- Índices: `(lead_aba, lead_id, em)` e `(profile_id, em)`.
- RLS ligado e **sem policy de escrita direta**. O insert é feito só pela RPC `registrar_contato_lead`. A leitura também é só por RPC.
- Sem FK para `leads`, porque o sync da planilha pode reescrever linhas. O vínculo é lógico, como em `leads_followups`.
- Um insert por clique. A RPC ignora o mesmo `(lead, profile, canal)` repetido em menos de 2 min, para o clique duplo não poluir.

### 4.2 Relógio em minutos úteis (regra)
- Configuração em `config.velocidade_lead` (JSON), com padrão:
  `{"seg_sex":["08:00","18:00"], "sabado":["08:00","12:00"], "verde_min":5, "amarelo_min":15, "janela_dias":7}`.
- **Início do relógio** = `criado_em_lead`. Se o lead chegou fora do expediente, o relógio começa na **próxima abertura**. Domingo e feriados nacionais (os mesmos de `ppFeriados`) não contam.
- **Fim do relógio** = 1º contato. Contato é o primeiro de três sinais:
  - o primeiro clique em `leads_contatos`;
  - a primeira ligação manual para o `chave_tel` do lead com `gerada_em >= criado_em_lead - 1 h`;
  - mudança de `categoria` para algo diferente de `sem_contato`, vista no sync. Não tem horário confiável, então só **encerra** o relógio, sem gerar tempo.
- **Cores:**
  - verde: até `verde_min`;
  - amarelo: até `amarelo_min`;
  - vermelho: acima de `amarelo_min`;
  - cinza "aguardando abertura": lead que chegou fora do expediente e ainda não abriu.
- Lead contatado **antes** da abertura (consultor atendeu à noite) conta 0 min. É mérito, não erro.
- **Onde é calculado:** só no navegador, numa função pura `vlMinutosUteis(inicio, fim, cfg)`. As RPCs devolvem timestamps crus. Motivo: uma implementação só (com `ppFeriados`), testável no jsdom, e volume pequeno (~1.000 leads/mês).

### 4.3 Coluna `leads.primeira_sync_em`
- `timestamptz default now()`, preenchida só no insert. O upsert do `sync-leads` não envia a coluna, então o valor nunca muda depois.
- Para quê: medir o atraso **Meta → planilha → painel** (`primeira_sync_em - criado_em_lead`). A Mesa mostra a mediana desse atraso.
  Se ela passar de 15 min, o gargalo é a planilha e não o consultor.
- Linhas antigas ficam nulas. A métrica vale só de 02/10 em diante.

### 4.4 Sync de leads mais frequente
- O cron `sync-leads-auto` passa de `22,52 * * * *` para `*/10 * * * *` (a cada 10 min, o dia todo).
- A trava de mês (seção 62) e o resto da função continuam iguais.
- O custo é baixo: lê o `htmlview` da planilha, sem limite conhecido.
- Rollback: voltar para `22,52 * * * *`.

### 4.5 RPCs (todas `security definer`, `set search_path = public`, `revoke` de `public, anon`, `grant` para `authenticated`)
1. **`registrar_contato_lead(p_aba text, p_lead_id text, p_canal text) returns void`**
   - O consultor só registra lead dele: `norm_nome(leads.consultor) in (select meus_leads_nomes())`. Admin e supervisor registram qualquer lead.
   - Outros casos dão erro `42501`. Canal inválido dá `22023`.
2. **`meus_leads_relogio() returns table(aba, lead_id, nome, telefone, status, criado_em_lead, primeiro_clique, primeira_ligacao, contatado boolean)`**
   - Leads do consultor logado (mesmo filtro de `meus_leads_para_tratar`, sem o Repique) com `criado_em_lead` nos últimos `janela_dias` dias.
   - `contatado` = tem clique, tem ligação ou `categoria <> 'sem_contato'`.
   - O consultor continua sem ler `ligacoes_manuais`. Só recebe o timestamp da 1ª ligação para os próprios leads.
3. **`mesa_leads_relogio(p_desde timestamptz) returns table(aba, lead_id, consultor, profile_id, criado_em_lead, primeira_sync_em, categoria, converteu, primeiro_clique, canal_clique, primeira_ligacao)`**
   - Só admin/supervisor (`get_my_role()`). `profile_id` vem de `leads_equipe` pelo nome.
   - Lead sem consultor sai com `consultor` nulo (vai para "Sem dono"). Sem o Repique.
4. **`mesa_pendencias(p_ref date) returns table(profile_id uuid, nome text, tipo text, ref text, titulo text, desde timestamptz, extra jsonb)`**
   - Só admin/supervisor. Uma linha por item pendente, com `tipo` em:
     - `retorno_atrasado`: `leads_followups` não feitos com `data_prevista < p_ref`;
     - `lead_esfriando`: lead em aberto do consultor sem contato (clique ou ligação) há 5 dias ou mais;
     - `proposta_parada`: `propostas` em `proposta_enviada`/`negociacao` com `estagio_entrada_em` há 7 dias ou mais;
     - `pedido_risco`: pedidos abertos do consultor, com `desde` = entrada na etapa, mesmo cálculo de `producao_meus_pedidos.na_etapa_desde`. O nível sai de `ppDiasUteisDesde`/`ppNivel` no navegador, e só entra 3 ou mais dias úteis (`PP_FAIXAS.minimo`).
   - Inclui também uma linha `tipo = 'consultor'` por profile `role = 'consultor'`, sem pendência. Assim quem está em dia aparece verde em vez de sumir.
5. **`mesa_ligacoes_hoje(p_ref date) returns table(profile_id uuid, lig_lead bigint, lig_total bigint, ultima timestamptz)`**
   - Só admin/supervisor. Por pessoa de `leads_equipe` com `usuario_telefonia`.
6. **`mesa_vendas_mes(p_mes date) returns table(profile_id uuid, pedidos bigint, receita numeric)`**: só admin/supervisor.
   - Por consultor de `consultor_neo`, conta os pedidos com `cadastro` no mês, que é a mesma data da matriz do Cadastro Diário (seção 66).
   - Exclui as etapas `VENDA PERDIDA` e `DEVOLVIDO`. GROSS já não entra (gatilho da seção 49).
   - `pedidos` conta `numero_pedido` distinto. `receita` soma `valor`.
   - A meta vem de `metas_consultor.meta_receita` do mesmo mês (leitura direta, RLS atual) e é comparada com `receita`.

## 5. "Atender agora" (consultor)

**Onde:** card no **topo** da sub-aba Digital → "Meus leads para tratar", acima do `plPlacar`. Fica visível só para o consultor com vínculo (mesma regra da seção 61).

- **Lista:** leads do consultor ainda **não contatados**, criados nos últimos `janela_dias`. Ordem: vermelho → amarelo → verde → cinza "aguardando abertura", e o mais antigo primeiro.
- **Por lead:** nome, cidade, nº de linhas, relógio (`mm:ss` até 60 min, depois `Xh Ymin`), selo de cor, e os botões:
  - **WhatsApp:** mesma mensagem de `plMensagemWhats`, tipo "resgatar". Registra `whatsapp` antes de abrir o link.
  - **Ligar:** link `tel:`. Registra `ligar`.
  - **Já falei com ele:** registra `manual`, para o contato feito por fora.
- **Ao registrar**, o lead sai da lista na hora (otimista). Se a RPC falhar, ele volta e aparece `mostrarAviso('Não foi possível registrar o contato — tente de novo', 'erro')`.
- **Registro também na lista de baixo:** o botão WhatsApp que já existe em "Meus leads para tratar" (`plWhats`) passa a registrar `whatsapp` quando o lead ainda não tem contato. Isso fecha o buraco "atendido no WhatsApp e nunca medido".
- **Relógio vivo:** o card recalcula a cada 30 s (só a renderização) e recarrega a RPC a cada 2 min enquanto a aba do navegador está visível (`document.visibilityState`).
- **Aviso de lead novo:** se, na recarga, aparecer um lead que não estava antes:
  - `mostrarAviso('Lead novo: <primeiro nome> — atenda agora', 'info')`;
  - se o consultor tiver permitido (botão "Avisar no navegador" no card, que chama `Notification.requestPermission()`), também uma notificação do navegador.
  - O sidebar **não muda** (regra do CLAUDE.md).
- **Polling fora da sub-aba:** a recarga de 2 min também roda quando o consultor está em outra aba do painel. Só o aviso é mostrado, o card não precisa estar na tela.
- **Vazio:** "Nenhum lead esperando. Bom trabalho." (sem cor).
- **Erro de carga:** o card mostra "Não foi possível carregar agora" e o resto da sub-aba funciona.

## 6. Mesa do Supervisor (admin e supervisor)

**Navegação:**
- Botão novo `<button data-tab="mesa" id="tabBtnMesa" style="display:none" data-sub="Pendências da equipe e cobrança em 1 clique">`, no grupo **Visão geral**, logo depois de Dashboard, com o mesmo formato SVG + `.sbLabel` ("Mesa do Supervisor").
- Visível se `producaoAdminMode()`.
- Para o consultor, a `section#panel-mesa` é **removida do DOM**, no mesmo padrão da seção 48.1.

**Carga:**
- Ao abrir a aba, chama em paralelo `mesa_leads_relogio(now() - janela)`, `mesa_pendencias(hoje SP)`, `mesa_ligacoes_hoje(hoje SP)` e `mesa_vendas_mes`, mais `metas_consultor`.
- Recarrega a cada 2 min com a aba visível e no botão "Atualizar".
- Cada bloco falha sozinho: o bloco mostra "não foi possível carregar" e os outros aparecem.

### 6.1 KPIs (`.kpiGrid`)
- Leads novos hoje.
- **No prazo hoje / 7 dias:** % atendidos em até `amarelo_min` min úteis. Exclui os "aguardando abertura".
- Mediana até o 1º contato (7 dias).
- Esperando agora (não contatados e já com relógio correndo).
- Sem dono.
- Retornos atrasados.
- Pedidos em risco 🔴.

### 6.2 "Atender agora: equipe"
- Mesma lista da seção 5 para todos os consultores, com a coluna Consultor.
- Os leads **sem dono** aparecem no topo com o selo "sem dono — atribua na planilha".
- Não há redistribuição pelo painel: o dono vem da planilha, e o sync é só de leitura.

### 6.3 Semáforo por consultor (`table.tbl`)
- **Uma linha por consultor:**
  - todo profile `consultor`;
  - mais nomes da planilha sem perfil, que aparecem pelo nome, com "sem login".
- **Colunas:**
  1. **Esperando agora** (nº e o pior relógio).
  2. **No prazo 7 d** (%; "—" se tiver menos de 5 leads).
  3. **Retornos atrasados.**
  4. **Leads esfriando.**
  5. **Propostas paradas.**
  6. **Pedidos em risco** (🔴/🟠/🟡 pelo `ppNivel`).
  7. **Ligações hoje** contra a média da equipe (só quem tem telefonia; senão "—").
  8. **Vendas no mês / meta** ("sem meta" se não houver).
- **Semáforo da linha:**
  - vermelho se houver lead esperando acima de `amarelo_min`, pedido 🔴 ou retorno atrasado há 2 dias ou mais;
  - amarelo se houver qualquer outra pendência;
  - verde se não houver nenhuma.
- **Ordem:** vermelho → amarelo → verde, e dentro de cada cor por nº de pendências.
- **Clique na linha** expande os itens: leads esperando, retornos, propostas e pedidos, com título, há quanto tempo e nível.
- **Botão "Cobrar"** na linha:
  - Monta um texto curto, por exemplo: "Oi <primeiro nome>, pendências de hoje: 2 leads esperando (o mais antigo há 47 min), 1 retorno atrasado, 3 propostas sem retorno há +7 dias. Bora zerar?".
  - Copia o texto para a área de transferência e abre `https://wa.me/?text=…` (sem número, o supervisor escolhe o contato).
  - Avisa `mostrarAviso('Mensagem copiada', 'ok')`.
  - Linha verde não tem botão.
- **Exportar Excel** (ExcelJS sob demanda, padrão da seção 48.4): uma aba com o semáforo e uma aba com os itens.

### 6.4 Atraso da planilha
- Linha discreta no topo: "Leads chegam ao painel em ~X min (mediana de `primeira_sync_em - criado_em_lead`, 7 dias)".
- Acima de 15 min, fica na cor de alerta com o texto "o atraso está antes do consultor (planilha/integração)".

### 6.5 Velocidade × conversão
- Tabela do mês escolhido (pílulas das abas da Digital, sem o Repique).
- Faixas de tempo até o 1º contato: **até 5 min, 5–15, 15–60, 1–4 h, mais de 4 h, sem contato registrado**.
- Para cada faixa: leads, vendas, conversão.
- Rodapé: "Amostra pequena: só leia diferenças com 30+ leads por faixa".
- É o que valida ou derruba a hipótese com dado da própria operação.

## 7. Permissões e privacidade

- **Consultor:**
  - vê só os próprios leads e o próprio relógio;
  - registra contato só nos próprios leads;
  - não vê a Mesa, que é removida do DOM, e as RPCs da Mesa dão erro `42501` para ele;
  - continua sem ler `ligacoes_manuais`.
- **Admin e supervisor:** veem tudo da Mesa.
- **Telefones:**
  - não aparecem na Mesa, que mostra nome, cidade e linhas;
  - aparecem só no card do consultor dono do lead, como já acontece hoje.
- **Repositório público:** testes com dados **fictícios** e nenhum segredo.

## 8. Fora de escopo (fase 2)

- Alerta fora do painel (Telegram ou Slack) quando um lead passa de 15 min sem contato. Depende do token do bot (pendência 1 do Rafael) e vira uma Edge Function com cron de 5 min reaproveitando a regra da seção 4.2 portada.
- Redistribuir lead pelo painel, escrevendo na planilha.
- Relógio para leads do Repique.
- Ideias 2, 3, 4, 6, 7 e 8 do brainstorming (fila "próximo lead", propostas esquecidas para o consultor, pedidos em risco para o consultor, funil por consultor, campanha, resumo das 8h). A Mesa já mostra propostas e pedidos ao supervisor. Levar isso ao consultor é a próxima rodada.

## 9. Testes (jsdom, dados fictícios)

- **`test_velocidade_lead.js`:**
  - `vlMinutosUteis`: lead dentro do expediente; chegou às 21h e foi atendido às 08:05 (= 5 min); atendido antes da abertura (= 0); atravessando o fechamento das 18h; sábado até 12h; domingo; feriado; fuso de SP.
  - Cores nas fronteiras de 5 e 15 min.
  - Card "Atender agora": ordem, os três botões chamam `registrar_contato_lead` com o canal certo, remoção otimista e volta quando dá erro.
  - O `plWhats` antigo registra o contato só quando o lead não tinha contato.
  - Aviso de lead novo na recarga.
  - Vazio e erro.
  - O consultor nunca chama RPC `mesa_*` nem lê `ligacoes_manuais`.
- **`test_mesa_supervisor.js`:**
  - botão e painel só para admin/supervisor, e o painel removido para o consultor;
  - KPIs (no prazo, mediana, sem dono);
  - semáforo: as regras de vermelho, amarelo e verde, e a ordem;
  - linha sem pendência aparece verde;
  - nível do pedido igual ao `ppNivel`;
  - expandir a linha;
  - texto do "Cobrar" e o link `wa.me` sem número;
  - um bloco que falha não derruba os outros;
  - tabela velocidade × conversão por faixa;
  - atraso da planilha;
  - Excel.
- **SQL:** script `supabase/tests/velocidade_lead_mesa_check.sql`, rodado em transação com `rollback`. Simula admin, supervisor, consultor vinculado, consultor sem vínculo e anon:
  - quem pode registrar e em qual lead;
  - o anti-duplo-clique;
  - `mesa_*` com erro `42501` para o consultor;
  - o `primeira_sync_em` não muda num upsert.
- **Regressão:** `test_monitoramento_leads.js`, `test_digital_abas.js`, `test_leads_followups.js`, `test_pedidos_parados.js`, `test_reorganizacao_abas.js` e o `bash run_tests.sh` completo. As falhas antigas conhecidas são `test_conversao_vendas.js` (relógio) e `test_pedidos_alerta.js` (`exceljs`).

## 10. Entrega, autorizações e riscos

**Ordem:**
1. **Plano A (banco):** migration, rollback, script SQL de verificação e cron de 10 min.
2. **Plano B ("Atender agora"):** template e testes.
3. **Plano C (Mesa):** template e testes.

**Autorizações:**
- Aplicar a migration e mudar o cron no Supabase `apex` (produção) **só com ok explícito do Rafael**, antes de publicar o painel. Sem a migration, os cards novos mostram "não foi possível carregar" e o resto não quebra.
- Publicar o painel **só com ok do Rafael naquele momento**. Antes:
  - `git fetch oficial` e merge;
  - baixar o painel no ar e comparar;
  - backup e conferência de MD5;
  - atualizar o vigia.
- Registrar em `REGRAS_NEGOCIO.md` como **§68**. A §67 já foi usada pelo robô: conferir o próximo número livre na hora.

**Riscos:**
- **(a) Clique sem contato real.** O consultor pode clicar em "Já falei" sem ter falado. A Mesa mostra o canal: muitos `manual` sem ligação do ProContact em seguida é sinal para o supervisor. Não há trava automática.
- **(b) Atraso da planilha.** A integração Meta → planilha pode atrasar mais que 15 min. É medido pela seção 6.4 e, se for o caso, vira outra frente.
- **(c) Expediente diferente do padrão.** O expediente fica editável em `config.velocidade_lead`, sem mexer no código.
- **(d) Conflito com outras sessões.** Outras sessões mexem no `_template.html`. Mitigação: worktree, `git fetch oficial` antes de qualquer merge e push sem force.
- **(e) Amostra pequena para a hipótese.** A seção 6.5 mostra o tamanho da amostra e o rodapé de cautela.
