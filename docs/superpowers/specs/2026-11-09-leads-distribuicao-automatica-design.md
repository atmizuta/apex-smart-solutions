# Distribuição automática de leads por conversão + velocidade (§146)

**Data:** 09/11/2026 · **Pedido:** Rafael · **Seção do REGRAS:** §146 (fases §146.1 e §146.2)

## 1. Por que

Hoje o lead cai nos **Livres** e quem tem `leads_equipe.pode_pegar` pega na mão (§112/§122). Quem
vê primeiro leva, e nada premia quem atende rápido nem quem converte. O pedido: **o lead vai
sozinho para alguém**, com preferência para quem converte mais **e** para quem liga rápido ("se
liga ou tabula nos primeiros 5 minutos, recebe o próximo"). Todo mundo do grupo recebe, uns mais e
outros menos, e a preferência **muda sozinha** com o desempenho recente.

Números de 09/11 (últimos 30 dias, os 4 que pegam): ~31 leads/dia (~8 por consultor); conversão
entre 14,8% e 18,6%; só 3% a 16% dos leads recebem ligação em até 5 min do pego; mediana até a 1ª
ligação entre 1h55 e 5h29. A venda é marcada em mediana 1,2 dia depois de o lead cair (80% em até
7,3 dias). Conclusão: a conversão separa pouco e chega atrasada; a velocidade separa muito e é
medida na hora. Por isso cada uma tem seu relógio (§4).

## 2. Decisões do Rafael (brainstorming de 09/11)

| Tema | Decisão |
|---|---|
| Convive com o "Pegar"? | **Convive (B) + chave (C)**: lead cai com dono; se não for atendido no prazo, volta a circular. Chave Manual/Automático na Equipe |
| A preferência é fixa? | **Não**: nota recalculada a cada lead, pelo desempenho recente |
| Janela da conversão | **14 dias móveis**, dias recentes pesam mais, **sem os 2 dias mais recentes** (ainda maturando) |
| Janela da velocidade | **Últimos 10 leads** recebidos pelo consultor |
| O que é "atendeu" | **Os dois sinais**: clique no telefone do painel ou tabulação dão crédito **na hora**; a ligação real do ProContact **confirma depois**; sem ligação real, perde o crédito e vira "clicou e não ligou" para o supervisor. Tabulação sem ligação **não** vale |
| Motor | **Rodízio ponderado** com trava de pendência; fatia por nota com **piso 15% / teto 40%**; peso **50/50** |
| Quem está disponível | **Presença automática** (painel aberto) + **botão Pausa** que volta sozinho em 60 min + expediente + chave "Pega leads" |
| Fora do expediente | Lead **guardado** e distribuído na abertura; o relógio só começa quando chega a alguém |
| Devolução | **15 min** sem clique/tabulação → vai na hora para o próximo da vez (nunca para quem perdeu); se ninguém disponível, fica nos Livres |
| O que o consultor vê | **Só os números dele**, sem ranking |
| Arquitetura | **Motor dentro do banco** (abordagem 1), chamado por `leads_entrada2` + cron de 1 min |

## 3. Quem participa e o que é "estar na vez"

- **Grupo:** `leads_equipe.pode_pegar = true` (hoje 4 pessoas; chave "Pega leads" do §132). O
  "Bloquear todos" do §132 (`leads_pegar_bloqueado`) também para o motor.
- **Presente:** `leads_presenca.visto_em` nos últimos **3 min** (o painel avisa a cada 1 min, em
  qualquer aba, enquanto estiver aberto) **e** `pausa_ate` nulo ou vencido.
- **Expediente:** dias úteis, **13h–21h** (America/Sao_Paulo), o mesmo do semáforo do §122.
  Editável em `config.leads_distribuicao`. Feriado: supervisor põe em Manual.
- **Sem pendência:** não tem **nenhuma entrega aberta** (recebida, sem atendimento, não devolvida).
  > Ajuste ao que foi falado (a conferir na revisão): na conversa a trava era "lead recebido há
  > menos de 5 min sem ligação". Aqui ela dura **até atender ou até a devolução (15 min)**. Do
  > contrário, quem não ligou em 5 min voltaria para a vez e receberia outro lead mesmo parado,
  > o oposto do pedido.
- **Ativo hoje:** esteve presente em algum momento do dia. É o conjunto sobre o qual as fatias
  são divididas (quem nem abriu o painel não "reserva" fatia).

**Na vez** = grupo + presente + expediente + sem pendência + não bloqueado.

## 4. A nota

Calculada por `leads_dist_notas()` a cada decisão (barata: ~4 pessoas, poucos milhares de linhas).

**Conversão (C):** leads do consultor (`dono_id`) com `pego_em` entre **hoje−16 e hoje−2 dias**.
Peso de cada lead linear de **1,0** (2 dias atrás) a **0,5** (16 dias atrás).
`C_bruta = Σ peso·converteu / Σ peso`. Para não pular com amostra pequena, puxa para a média do
time: `C = (Σ peso·converteu + 10·média_time) / (Σ peso + 10)`.

**Velocidade (V):** as **últimas 10 entregas** do consultor (`leads_distribuicao`, tipos `auto`
e `pegou`, já decididas: atendidas ou com 5 min passados). Atendida a tempo = `atendido_em −
recebido_em ≤ 5 min` **e** `confirmado` diferente de `false` (aguardando confirmação conta a
favor). `V = (atendidas_a_tempo + 3·média_time) / (n + 3)`.

**Consultor novo** (menos de 10 entregas ou nada na janela): a suavização acima já o leva à média
do time.

**Nota:** `nota = 0,5·(C / média_C) + 0,5·(V / média_V)` (médias entre os ativos hoje; média zero
→ componente vale 1 para todos).

**Fatia:** `nota / Σ notas` entre os ativos hoje, depois **piso 15% / teto 40%** por "enchimento"
(prende quem passou do limite e redistribui o resto proporcionalmente entre os demais, até
estabilizar). Se o número de ativos torna o limite impossível (ex.: 2 pessoas e teto 40%), divide
igual.

Pesos, piso, teto, janela e suavização ficam em `config.leads_distribuicao`.

## 5. O motor (rodízio ponderado)

`leads_distribuir(p_aba, p_id)`, sob `pg_advisory_xact_lock` (um lead por vez):

1. Sai sem fazer nada se: modo `manual`, lead já tem dono, lead apagado, fora do expediente (fica
   guardado) ou bloqueado.
2. Monta os **na vez**, tirando quem já perdeu este lead por devolução.
3. Para cada um: `déficit = fatia × (recebidos_hoje_dos_ativos + 1) − recebidos_hoje`. Recebidos
   = entregas `auto` e `pegou` de hoje, **contando as devolvidas** (quem deixa vencer não é
   compensado com mais leads).
4. Escolhe o **maior déficit**; empate → quem recebeu o último há mais tempo.
5. Grava `dono_id`, `pego_em` (como o `leads_pegar`), uma linha em `leads_distribuicao` com o
   **motivo** (fatias, déficits, quem estava fora e por quê) e uma linha em `leads_historico`
   (`acao = 'distribuir'`).
6. Ninguém na vez → lead fica nos Livres com entrega `aguardando`; o tick tenta a cada minuto.

**Modo `sombra`:** os passos 1–4 rodam, mas só gravam em `leads_dist_sombra` para quem iria. Nada
muda para o time. Serve para conferir a divisão com dados reais antes de ligar.

## 6. O tick (pg_cron, 1 em 1 minuto, só no expediente)

`leads_dist_tick()`:
- **Devolução:** entregas abertas há 15 min sem atendimento → `devolvido_em`, lead sem dono,
  `leads_historico` (`acao = 'devolver_auto'`), e chama o motor de novo (sem quem perdeu). Depois
  de **2 devoluções** o lead fica nos Livres e aparece como alerta na Equipe.
- **Guardados:** entregas `aguardando` (lead fora do expediente, ninguém na vez ou devolvido),
  **mais recente primeiro** (lead quente antes). Um por vez, respeitando a trava, então o
  acumulado da manhã sai no ritmo em que o time atende.
- **Confirmação ProContact:** entregas com `atendido_em`, `confirmado` nulo e `atendido_em` há mais
  de 20 min, **desde que o robô já tenha importado depois disso** (`max(importado_em) >
  atendido_em + 20 min`): existe `ligacoes_manuais` com `chave_tel = chave_tel(lead.phone_number)`
  e `usuario = usuario_telefonia` do consultor, `gerada_em` entre `recebido_em − 5 min` e
  `atendido_em + 20 min`? Se sim, `true`; se não, `false` ("clicou e não ligou"). Consultor sem
  `usuario_telefonia` → `true`. Ainda sem decisão depois de 24 h → `true` (benefício da dúvida).
- **Robô parado** (último `importado_em` há mais de 30 min no expediente): não decide nenhuma
  confirmação, grava aviso em `config.leads_distribuicao_aviso` (ninguém perde crédito).

## 7. Sinais de atendimento

- **Clique no telefone** (copiar/abrir ProContact, §121) → `leads_contato_registrar(p_aba, p_id)`:
  marca `atendido_em` / `sinal = 'clique'` na entrega aberta **do próprio consultor** daquele
  lead. Também grava em `leads_historico` (`acao = 'contato'`).
- **Tabulação** → gatilho em `leads.classificado_em`: se a entrega aberta do dono não tem
  `atendido_em`, marca com `sinal = 'tabulacao'`. A confirmação (§6) vale igual, então tabular sem
  ligar acaba em `confirmado = false`.

## 8. Outras entradas no ciclo

- **`leads_entrada2`:** ao final, para cada lead **novo** que entrou no painel sem dono, chama o
  motor dentro de `begin … exception when others` (falha nunca derruba a entrada: lead fica nos
  Livres, aviso na Equipe, o tick tenta de novo). Webhook em `ensaio` não chega aqui.
- **`leads_pegar`** (Livres, ainda permitido no automático): grava entrega `pegou`; conta na
  velocidade e nos recebidos.
- **`leads_redistribuir` / Passar para** (supervisor, §124/§126): grava entrega
  `redistribuido`, que **não** entra na velocidade nem nos recebidos (decisão de gestor, ex.:
  passar 30 leads antigos não pode zerar alguém no rodízio).
- **Devolver** (consultor, ação existente): fecha a entrega; em modo automático o lead entra como
  `aguardando` sem o consultor que devolveu.
- Livres antigos (de antes de ligar o automático) **não** entram no motor.

## 9. Dados novos

Nenhuma coluna nova em `leads`; nada é apagado (sem DROP, ver o problema do conector com DROP).

- **`leads_distribuicao`**: `id`, `lead_aba`, `lead_id`, `consultor_id` (nulo enquanto
  `aguardando`), `tipo` (`auto` | `pegou` | `redistribuido` | `aguardando`), `recebido_em`,
  `atendido_em`, `sinal` (`clique` | `tabulacao`), `confirmado` (bool nulo), `devolvido_em`,
  `devolucoes` (int), `excluidos` (uuid[] de quem já perdeu), `motivo` (jsonb). Índices por
  `(consultor_id, recebido_em desc)` e parcial nas abertas.
- **`leads_presenca`**: `profile_id` (pk), `visto_em`, `pausa_ate`.
- **`leads_dist_sombra`**: `lead_aba`, `lead_id`, `em`, `escolhido`, `motivo`.
- **`config`**: `leads_distribuicao` (jsonb: `modo` manual/sombra/automatico, `peso_conversao`,
  `piso`, `teto`, `prazo_atender_min` 5, `prazo_devolver_min` 15, `janela_dias` 14,
  `maturacao_dias` 2, `pausa_min` 60, `presenca_min` 3, `expediente` {dias, inicio, fim},
  `max_devolucoes` 2) e `leads_distribuicao_aviso`.

Telefone continua trancado (§112): as funções novas são `security definer` e não devolvem
telefone, e-mail nem CNPJ. RLS ligado nas tabelas novas, acesso só por RPC, com `revoke` de
`public`/`anon` e `grant` a `authenticated`.

## 10. Funções

| Função | Quem chama | O que faz |
|---|---|---|
| `leads_distribuir(aba, id)` | `leads_entrada2`, tick | Motor (§5) |
| `leads_dist_notas()` | motor, Equipe | Nota, fatia e componentes por consultor ativo hoje |
| `leads_dist_tick()` | pg_cron 1 min | Devolução, guardados, confirmação, aviso (§6) |
| `leads_presenca_ping(p_pausa text)` | painel, 1 min | `null` = só presença; `'pausa'` / `'voltar'` |
| `leads_contato_registrar(aba, id)` | painel, clique no telefone | §7 |
| `leads_dist_meu()` | painel (consultor) | Estado (na vez / aguardando você / pausa / fora do horário), entrega aberta com relógio, rápidos x/10, conversão 14d, recebidos hoje × fatia |
| `leads_dist_equipe()` | painel (supervisor/admin) | Tabela da Equipe (§11) + avisos |
| `leads_dist_config(p jsonb)` | painel (admin/supervisor) | Troca modo e parâmetros (com validação) |
| `leads_dist_motivo(aba, id)` | painel (ficha) | "Por que foi para ele?" (gestor) |
| `leads_dist_sombra_relatorio(dias)` | painel (gestor) | Sombra × o que aconteceu |

## 11. Painel

Visual atual (Sinal de Ápice), reaproveitando cartões e chips existentes. Nada de estilo novo.

**Consultor, Meus leads → Hoje (§146.2):**
- Faixa **"Sua vez"** com o estado em uma palavra + botão **Pausa / Voltar** (mostra o tempo
  restante).
- Cartão do lead recebido com **cronômetro de 5 min** (normal → âmbar → vermelho); aos 15 min some
  com aviso "devolvido". O aviso de lead novo (§122) passa a soar para lead recebido
  automaticamente.
- **Seus números:** "Rápidos: x de 10" · "Conversão 14 dias: y%" · "Hoje: n de ~m da sua fatia".
  Sem nome de colega nem posição.
- **Ping de presença** a cada 1 min enquanto o painel está aberto (já no §146.1, invisível).
- Clique no telefone chama `leads_contato_registrar` (já no §146.1).

**Supervisor/admin, Equipe:**
- Faixa **"Distribuição"** ao lado de "Pegar leads" (§132): **Manual / Sombra / Automático** +
  engrenagem com os parâmetros. Avisos (motor falhou, robô parado, lead com 2 devoluções).
- Tabela por consultor: estado · nota · fatia · recebidos hoje · atendidos em 5 min · devolvidos ·
  **clicou e não ligou** (destaque).
- Em Sombra: quadro "Se estivesse ligado" (quantos cada um teria recebido × quantos recebeu).

**Ficha do lead (gestor):** linha "Distribuído às HH:MM para X: …" (`leads_dist_motivo`).

## 12. Fases

- **§146.1 — banco + sombra + Equipe:** tabelas, funções, gatilho, cron, ganchos em
  `leads_entrada2`/`leads_pegar`/`leads_redistribuir`/devolver, ping de presença e registro do
  clique no painel, faixa e tabela da Equipe, modo **Sombra**. Nada muda para o consultor. Ligar
  em **sombra** e rodar 1–2 dias úteis.
- **§146.2 — consultor + ligar:** faixa "Sua vez", Pausa, cronômetro, seus números, "por que" na
  ficha. Ajustar parâmetros com o relatório da sombra, avisar o time e ligar **Automático**.

## 13. Erros e reversão

- Motor falhou → lead entra mesmo assim, fica nos Livres, aviso na Equipe, tick tenta de novo.
- Ninguém na vez → Livres + `aguardando`; tick a cada minuto.
- ProContact parado → confirmações suspensas, aviso; ninguém perde crédito.
- Painel de todos fechado → ninguém presente → leads guardados; Livres seguem pegáveis.
- **Voltar atrás:** chave em **Manual** (efeito imediato; entregas abertas continuam com o dono).
  Para desligar de vez: `cron.unschedule('leads-dist-tick')`.

## 14. Testes

- `supabase/tests/leads_distribuicao_check.sql`, dentro de transação desfeita, com consultores e
  leads fictícios: fatias com piso/teto (incluindo 2 pessoas), déficit e desempate, trava de
  pendência, fora do expediente guardando, devolução aos 15 min sem voltar a quem perdeu, limite
  de 2 devoluções, confirmação true/false/aguardando robô, robô parado, tabulação sem ligação,
  redistribuição fora da conta, modo sombra sem alterar dono, falha do motor sem derrubar
  `leads_entrada2`, dois leads seguidos não indo para a mesma pessoa pendente.
- Sombra em produção por 1–2 dias úteis antes do automático.
- Painel: `node --check` nos scripts extraídos, contagem de `<div>`/`</div>`, conferir outra aba
  (Equipe e Hoje) antes de publicar.

## 15. Fora do escopo

- Feriados automáticos (Manual resolve).
- Nota por tipo de lead (campanha, porte) ou por receita da venda em vez de "converteu".
- Ranking ou gamificação visível ao time.
- Campinas e quem não tem `pode_pegar` (continuam recebendo só por Passar para).
