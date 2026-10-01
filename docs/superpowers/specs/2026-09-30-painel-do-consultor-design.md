# Painel do Consultor — Minha Fila, Agenda e Meu Placar (design)

Data: 30/09/2026 · Status: **rascunho para aprovação** (nada implementado) · Branch: `feat/painel-consultor` (base `oficial/main`)

## 1. Objetivo

Dar a cada consultor, dentro do painel, o que ele precisa para **não deixar dinheiro parado** e
**saber onde está na meta**, usando só a produção já sincronizada da NeoSales (`producao_pedidos_neo`).
Ganho esperado: menos pedidos esquecidos em etapas pós-venda (receita já vendida e não ativada), menos
no-show/atraso de portabilidade e mais foco diário, sem o gerente montar planilha.

Três entregas, nesta ordem (cada uma com plano próprio em `docs/superpowers/plans/`):

| # | Entrega | Plano |
|---|---------|-------|
| 0 | Fundação: vínculo consultor × NeoCRM e privacidade real por consultor | `2026-09-30-painel-consultor-00-fundacao.md` |
| 1 | **Minha Fila** — pedidos parados, quantidade, R$ parados, etapa de cada um | `...-01-minha-fila.md` |
| 2 | **Agenda** — portabilidades/instalações de hoje, próximas e atrasadas | `...-02-agenda.md` |
| 3 | **Meu Placar** + resumo diário (meta, ritmo, "bom dia") | `...-03-meu-placar-e-resumo.md` |

## 2. O que já existe (não refazer)

- **Sync** hora em hora: Edge Function `sync-producao` → `producao_pedidos_neo` (+ `producao_neo_raw` com o JSON completo). `producao_pedidos` é uma VIEW (`security_invoker=true`) sobre ela.
- **Pedidos em Alerta** (REGRAS seção 48): dias úteis parado, feriados, níveis 3/6/10, etapas ENTREGA/ANTIFRAUDE/PORTABILIDADE (andamento e tratativa). **Só admin/supervisor**, porque "não existe vínculo confiável entre o usuário do painel e o proprietário do pedido". A Fundação (0) resolve exatamente isso.
- **Fechamento** (seção 16.14, admin): ativações do mês por consultor (data de ativação = `data_portabilidade`, ou `data_instalacao` na banda larga; só "ganho"; piso 01/08/2026). **Não calcula comissão, por decisão do usuário.** O Meu Placar reaproveita essa regra.
- Alerta de sync parada + faixa no painel (seção 52); canal Telegram ainda sem token do bot.

## 3. Achados dos dados (30/09/2026, somente leitura)

**3.1 O JSON bruto da API já traz o que faltava** (sem nova chamada à API):
- `estruturaUsuarioId` = ID numérico estável do consultor no NeoCRM (ex.: Caio 102218, Giovanna 102220). É a chave certa do vínculo; nome não serve (abaixo).
- `tagPedido` traz o **motivo de perda** (#SEMINTERESSE 138, #SEMCREDITO 44, #RESTRICAOOPERADORA 37, #COMRESTRICAO 22, #HOTLEAD 19…). A nota "não verificado" da memória sobre motivo de perda está resolvida: **a API traz, via tagPedido**.
- Também existem `nomeColuna`, `nomeEtapaItem`, `tipoNegociacao`, `solicitacao`, `nomeEquipe`, `nomeConsultorOperadora`, `numeroTelefoneItem` (ainda não usados).

**3.2 Nome do painel × nome do NeoCRM não bate** (por isso o vínculo é por ID):
`Caio Costa` = `CAIO COSTA SANTANA`; `Manuella Bento` × `MANUELA BENTO MACEDO` (grafia); `Yasmin Bezerra` × `YASMIN SILVA` (sobrenome); dois perfis "Gabriel" × `GABRIEL MACEDO MARTINS` e `GABRIEL DA SILVA GOMES`; `DANILO MORAIS ARAUJO` tem pedidos e nenhum perfil. Só 3 dos 18 nomes batem por igualdade simples.

**3.3 Dinheiro parado hoje** (pedidos abertos, 1 linha por pedido; "parado" = mais de 3 dias corridos sem atualização, nas 8 etapas pós-venda abaixo; é uma estimativa, a regra final usa dias úteis):
- ≈ **76 pedidos / R$ 7,7 mil** parados; cerca de R$ 18,4 mil em aberto no total.
- Por etapa (pedidos / R$ parados >3d): ANTIFRAUDE 7 / R$ 3.025 · ENTREGA 25 / R$ 1.700 · PORT. ANDAMENTO 12 / R$ 905 · PORT. TRATATIVA 16 / R$ 900 · VALIDAÇÃO ESIM 7 / R$ 415 · AGUARDANDO ASSINATURA 3 / R$ 300 · CRÉDITO 4 / R$ 260 · BIOMETRIA 2 / R$ 210.
- Por consultor (pedidos parados / R$): Rafael 14 / R$ 3.310 · Giovanna 14 / R$ 1.035 · Manuela 14 / R$ 1.015 · Caio 12 / R$ 995 · Vitor 9 / R$ 550 · Gabriel M. 4 / R$ 235 · Victoria 4 / R$ 215 · demais ≤ 2.
- **Só 4 das 8 etapas são monitoradas hoje** (seção 48); BIOMETRIA, VALIDAÇÃO ESIM, CRÉDITO e AGUARDANDO ASSINATURA ficam de fora (R$ 1,1 mil parados).

**3.4 Datas de portabilidade/instalação são pouco preenchidas** nos pedidos abertos: só 8 em ENTREGA, 10 em VALIDAÇÃO ESIM, 6 em portabilidade; `data_instalacao` em nenhum. Dessas, **22 já passaram** (pedido não concluído) e só **2 são futuras**. Consequência: a Agenda vale mais como lista de **atrasados** e de **"sem data"** do que como agenda do futuro, até o hábito de preencher a data crescer.

**3.5 Privacidade hoje:** a política `producao_neo_select` libera a tabela inteira para **qualquer usuário autenticado**. O dashboard do consultor esconde cliente/CNPJ só na tela (não pede essas colunas), mas um consultor com o próprio login consegue consultar `cliente` e `cnpj` de todos os pedidos direto na API do Supabase. "Só o Caio vê os pedidos do Caio" só é verdade se a regra for aplicada **no banco**.

## 4. Design

### 4.1 Fundação (0)
- `producao_pedidos_neo.usuario_id bigint` (de `estruturaUsuarioId`): preenchido por SQL a partir de `producao_neo_raw` (histórico) e pela `sync-producao` daqui em diante. **Não precisa chamar a API.**
- Tabela `consultor_neo(profile_id uuid PK → profiles, neo_usuario_id bigint UNIQUE, atualizado_em)`. Editor para o admin (Configurações): lista os IDs do NeoCRM detectados (nome + nº de pedidos) e os perfis do painel; o painel **sugere** o par por nome e o admin confirma. Admin/supervisor também podem ter vínculo (o Rafael tem pedidos próprios).
- **Privacidade no banco (recomendado, decisão D1):**
  - `producao_neo_select` passa a: admin/supervisor → tudo; consultor → só linhas com `usuario_id` = seu vínculo.
  - O dashboard de equipe do consultor (Visão Geral/ranking, que hoje ele já enxerga) passa a ler a RPC `producao_equipe()` (SECURITY DEFINER), que devolve **as mesmas colunas de hoje sem cliente/CNPJ** (`numero_pedido,grupo,usuario,etapa,cadastro,atualizacao,valor,quantidade,produto,tag`). Para o consultor nada muda na tela; deixa de vazar cliente/CNPJ dos colegas.
  - Minha Fila/Agenda/Placar leem RPCs `minha_fila()`, `minha_agenda()`, `meu_placar(mes)`, que já filtram pelo vínculo do `auth.uid()` (e aceitam `p_consultor` só para admin/supervisor, para "ver como").
- Sem vínculo: o consultor vê "seu usuário ainda não foi ligado ao NeoCRM — avise o admin" (nunca a base inteira).
- Tudo com migration + rollback em `supabase/rollback/`, como na virada da Fase 2.

### 4.2 Minha Fila (1)
Aba nova **"Minha Fila"** (consultor vê só a própria; admin/supervisor têm seletor "ver como" e continuam com Pedidos em Alerta para a visão geral).
- **Topo:** 3 cartões — *Pedidos parados* (nº), *R$ parados* (soma do `valor` dos pedidos parados) e *R$ em aberto* (todos os pedidos não concluídos/perdidos/devolvidos).
- **Por etapa:** barras/linhas com nº de pedidos e R$ em cada etapa ("ANTIFRAUDE: 3 pedidos · R$ 580"). Clicar filtra a lista.
- **Lista:** 1 linha por pedido, do mais parado ao menos parado: cliente, CNPJ, produto(s), valor, **etapa**, dias úteis parado, nível (🟡🟠🔴), "de quem é a bola" (consultor / cliente / operadora / back office), copiar nº do pedido.
- **Regra de tempo:** a da seção 48 (dias úteis, feriados, níveis 3/6/10 via `ALERTA_FAIXAS`), referência = "Atualizado em" da sincronização.
- **Etapas monitoradas:** ampliar de 4 para 8 (+ BIOMETRIA, VALIDAÇÃO ESIM, CRÉDITO, AGUARDANDO ASSINATURA) — decisão D2. Mapa proposto de "de quem é a bola": BIOMETRIA, VALIDAÇÃO ESIM, AGUARDANDO ASSINATURA → **cliente** (o consultor empurra); CRÉDITO, ANTIFRAUDE, PORTABILIDADE (andamento/tratativa) → **operadora/back office**; ENTREGA → **logística**.
- **Importante:** `valor` é o valor do produto no pedido (ex.: 39,99). Se for mensalidade, o rótulo correto é **"R$/mês parados"**, não "R$" — decisão D3.

### 4.3 Agenda (2)
Aba/cartão **"Agenda"**: *Atrasados* (data já passou e pedido não concluído) · *Hoje* · *Amanhã* · *Próximos 7 dias* · *Sem data* (pedido em portabilidade/entrega sem `data_portabilidade`).
- Hoje o valor está em **Atrasados (22)** e **Sem data**; a agenda futura cresce conforme o time preencher a data (o cartão "Sem data" empurra esse hábito).
- Botão **WhatsApp de confirmação** ao cliente (mensagem pronta, reaproveita o fluxo da seção 41). O telefone vem de `clientes.tel1/tel2` pelo `cnpj_digits`; sem telefone achado, o botão não aparece.
- Lembrete ativo (manhã do dia) sai com o resumo diário (3).

### 4.4 Meu Placar + resumo diário (3)
- **Meu Placar** (topo do painel do consultor): ativações do mês, receita bruta das ativações, pedidos cadastrados, **% da meta**, "faltam X" e **ritmo** (projeção linear pelos dias úteis restantes). Regra de ativação = a do Fechamento (16.14). **Não mostra comissão** (decisão de 18/09 mantida).
- **Meta:** tabela `metas_consultor(profile_id, mes, meta_receita, meta_ativacoes)` preenchida pelo admin num editor simples. Hoje **não existe meta cadastrada em lugar nenhum** — decisão D4 (em R$ ou em nº de ativações).
- **Resumo diário "bom dia"**, em duas etapas: **3a** cartão no topo do painel ao entrar (sem canal externo, entrega valor já); **3b** Edge Function `resumo-diario` + `pg_cron` (8h, dias úteis) enviando por Telegram a cada consultor vinculado. Mensagem só com contagens e valores, **sem nome/CNPJ de cliente** (LGPD). Depende do bot do Telegram (pendência já aberta) — decisão D5.

## 5. Decisões que dependem do usuário

| | Decisão | Recomendação |
|---|---|---|
| D1 | Privacidade **no banco** (RLS por consultor) em vez de só esconder na tela? Efeito: consultor deixa de conseguir ler cliente/CNPJ dos colegas | **Sim** |
| D2 | Quais etapas contam como "parado" e de quem é a bola | 8 etapas, mapa da 4.2 |
| D3 | `valor` é mensalidade (R$/mês) ou valor do pedido? | confirmar |
| D4 | Meta em R$ de receita ou nº de ativações? Quem define e por mês? | R$ de receita, admin define por mês |
| D5 | Resumo diário: Telegram (precisa criar o bot) ou começar só com o cartão no painel? | 3a agora, 3b quando houver o bot |
| D6 | Vínculos ambíguos: Gabriel ×2, Yasmin, Manuella, Danilo (sem perfil), Bruno/Silvana (sem pedidos) | admin confirma no editor |

## 6. Ideias extras (fora desta entrega, em ordem de retorno)

1. **Recontato de perdidos por motivo** — 359 pedidos perdidos = R$ 50,6 mil. `#SEMCREDITO`, `#COMRESTRICAO`, `#RESTRICAOOPERADORA` (≈100) são recuperáveis (outro CNPJ/forma de pagamento/regularização) e `#HOTLEAD` perdidos (≈30) estavam quentes: fila de recontato D+30/60 por consultor.
2. **Histórico de etapas** (trigger grava quando `etapa` muda): dá o tempo **real** em cada etapa em vez da heurística de `ATUALIZACAO`, permite SLA por etapa ("esse pedido está lento *para essa etapa*") e o aviso "seu pedido mudou de etapa/foi devolvido".
3. **Devolvidos** (49 / R$ 4,6 mil): fila de recuperação com o motivo.
4. **Anti-duplicidade:** avisar se o CNPJ já tem pedido aberto (seu ou de outro) antes de propor/ligar.
5. **Venda × origem do lead:** cruzar `leads.cnpj` (campanha/anúncio) com pedidos → faturamento por campanha (ROI do tráfego pago).
6. **Previsão do mês:** pipeline ponderado pela taxa histórica de cada etapa → "você deve fechar R$ X".
7. **Cross-sell D+30** de CONCLUÍDOS (segunda linha/fibra) usando a base de clientes.
8. **Desafio do dia** (streak de "fila zerada") — só se o time gostar de gamificação.

## 7. Riscos e cuidados

- **RLS em produção:** a troca da política afeta todos os consultores. Testar simulando cada papel (`set local role` + `request.jwt.claims`) antes; aplicar só com OK explícito; rollback pronto. O dashboard do consultor precisa migrar para a RPC **na mesma janela**, senão ele fica vazio.
- **Limite de 1000 linhas do PostgREST** (seção 36): RPCs com paginação (`range`) ou agregação no banco.
- **Vínculo errado = consultor vendo pedido de outro:** o editor mostra nome + nº de pedidos de cada ID para conferência, e o vínculo é 1 ID ↔ 1 perfil (`UNIQUE`).
- **Publicação:** seguir o CLAUDE.md (partir de `oficial/main`, comparar site × repo, backup, MD5, atualizar REGRAS_NEGOCIO.md). Nada vai ao ar sem autorização. Design "Sinal de Ápice" intocado; só classes/tokens existentes.
- **API NeoSales:** nenhuma chamada nova é necessária. O único ajuste na sync é gravar `usuario_id`; o histórico sai do `producao_neo_raw`. Se algum dia precisar de dado que a API não entrega no JSON atual, avisar o usuário antes.

## 8. Decisões do usuário e escopo final (30/09/2026)

Status: **aprovado e implementado** (código + testes no worktree; migration e publicação aguardam OK). Documentação viva: `REGRAS_NEGOCIO.md` seção 53.

- **Escopo da privacidade (substitui 4.1 "Privacidade no banco" e a Tarefa 4 do Plano 0):** dashboard e ranking continuam mostrando todos os pedidos aos consultores; só a aba nova mostra "apenas os meus". A RLS de `producao_pedidos_neo` **não** foi apertada. O filtro vale no servidor para a aba (RPC `producao_meus_pedidos` por `auth.uid()`), não como regra de segurança da tabela inteira.
- **Nome da aba:** "Pedidos Parados", só para o consultor. "Pedidos em Alerta" (admin/supervisor) fica como está.
- D2 = sim (8 etapas) · D3 = sim (valor é mensalidade; rótulo R$/mês) · D4 = meta em R$ · D5 = cartão no painel (Slack como opção futura) · D6 = o editor pede confirmação. Manuela/Manuella e Yasmin Bezerra/Silva: confirmadas como a mesma pessoa. Gabriel (dois) e Danilo (sem perfil): o admin decide no editor.
- **Extras implementados:** recuperar perdidos por motivo, devolvidos, histórico de etapas (+ Novidades), anti-duplicidade de CNPJ, previsão do mês, reoferecer concluídos. Fora: "vendas × origem do lead" (já existe na aba Digital) e "desafio do dia".
- **Desvio técnico:** o `usuario_id` é mantido por gatilho no banco em vez de alterar a Edge Function `sync-producao` (sem Deno nesta máquina e sem novo deploy).
