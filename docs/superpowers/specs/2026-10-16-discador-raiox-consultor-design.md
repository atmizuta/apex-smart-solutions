# Discador — Raio-X do consultor (visão da supervisão sobre cada consultor)

**Data:** 2026-10-16
**Responsável:** Rafael (para a supervisão: Isa)
**Status:** especificação para revisão (nada construído)
**Base:** aba Discador no ar (REGRAS §87, §89, §93). Esta frente usa a **§96** (a §94 e a §95 são da Mesa/Biometria).

## 1. Objetivo e critérios de sucesso

Dar à supervisão, na própria aba Discador, uma visão completa de cada consultor em três eixos:
1. **Presença e ritmo:** jornada, atendimentos por hora ativa, pausas longas (com horário).
2. **Qualidade da abordagem:** chamadas curtas, tempo falado, espera do cliente, mix de tabulação, comparados com a equipe.
3. **Resultado:** vendas do discador e conversão nos últimos 7 dias úteis, comparados com a semana anterior.

Sucesso:
- Na tabela de Consultores, a Isa vê de relance jornada, atendimentos por hora, pausas e % curtas, com destaque de quem está mais de 30% pior que a equipe.
- Ao clicar num consultor, abre o Raio-X dele com os três eixos, no período e na operação escolhidos.
- Os dados atualizam na mesma frequência do robô (de hora em hora, minuto 17). Não há atualização mais frequente.
- Admin vê qualquer operação; supervisor vê só a dele (mesma trava da §89). Nenhum dado de cliente aparece.

Fora de escopo:
- cruzar com as ligações manuais e com os leads do consultor (fase 2, porque o vínculo login → consultor das manuais é outro);
- metas por consultor;
- alerta automático de pausa.

## 2. Contexto confirmado (dados de 15/10/2026)

- Cada chamada atendida tem `atendida_em`, `fim_em`, `seg_falados`, `seg_espera` e `tabulacao` (sem nulos em `atendida_em`/`fim_em` nas atendidas).
- Em 15/10: 1.171 atendidas, **530 (45%) com menos de 15 s** falados, espera média de 2 s, intervalo mediano entre atendimentos de 56 s, **43 intervalos de mais de 15 min**, 15 agentes.
- O discador da Apex só começa por volta de 13:30–14h; Campinas começa por volta das 8h. A jornada é medida pelos atendimentos de cada consultor, não por um horário fixo.

## 3. Definições (vão para a REGRAS §96)

Todas valem por consultor (`agente_id`), por dia de São Paulo, só com chamadas `ANSWERED` com agente, dentro da operação efetiva (§89).
- **Jornada do dia:** do primeiro `atendida_em` ao último `fim_em`.
- **Hora ativa:** hora do dia (SP) com pelo menos um atendimento iniciado. **Atend./hora ativa** = atendidas ÷ horas ativas.
- **Pausa longa:** intervalo entre o `fim_em` de um atendimento e o `atendida_em` do próximo do mesmo consultor no mesmo dia, maior que `config.discador.pausa_min` minutos (padrão **15**).
  - **"Equipe sem chamadas":** a pausa leva essa marca quando, no mesmo intervalo, não houve nenhum contato (ANSWERED ou ABANDONED) na mesma operação. Nesse caso o discador estava sem chamadas e não houve ausência do consultor.
  - Pausas marcadas assim **não** entram na contagem de pausas da tabela nem no destaque vermelho; elas aparecem só na lista do Raio-X.
- **Chamada curta:** atendida com `seg_falados` < `config.discador.curta_seg` (padrão **15**). **% curtas** = curtas ÷ atendidas.
- **Tempo médio falado (sem curtas):** média de `seg_falados` das atendidas que não são curtas.
- **Espera média:** média de `seg_espera` das atendidas.
- **Mix de tabulação** (sobre as atendidas), classificado assim:
  - `SEM AVAN%` → sem avanço;
  - `RETORNO` → retorno;
  - `DESCARTE` → descarte;
  - `%PERDIDO` → perdido;
  - `%GANHO` → ganho;
  - `SEM CONTATO` → sem contato;
  - nulo → sem tabulação;
  - qualquer outro valor → outros.
- **Equipe:** os mesmos números somados de todos os consultores da mesma operação efetiva, no mesmo período (média ponderada pelas atendidas).
- **Resultado:** os **7 dias úteis** que terminam em `p_ate` (dia útil = `public.boletim_dia_util`, que já existe), e os 7 dias úteis anteriores. Por dia: atendidas, vendas do discador do consultor (mesma regra da §87: última chamada atendida antes do pedido, janela `janela_venda_dias`) e conversão = vendas ÷ atendidas.
- **Destaque vermelho:** mais de 30% pior que a equipe, só com 20 ou mais atendidas no período (Ruling R2 da §87). "Pior" é:
  - **menor** atend./hora ativa;
  - **mais** pausas longas por hora ativa;
  - **maior** % curtas.

## 4. Banco

### 4.1 Configuração
`config.discador` ganha `"pausa_min": 15` e `"curta_seg": 15`, só se ainda não existirem.

### 4.2 `discador_consultores` (alterada)
Mesmos parâmetros e colunas de hoje, mais estas:
- `jornada_inicio timestamptz`, `jornada_fim timestamptz`: só quando `p_de = p_ate`; nulos em período de vários dias;
- `horas_ativas int`: soma das horas ativas de todos os dias do período;
- `pausas int`: pausas longas **sem** a marca "equipe sem chamadas";
- `curtas bigint`.

Como o tipo de retorno muda, a função é recriada (drop + create), com `p_operacao` padrão nulo como hoje. O painel antigo continua funcionando, porque só lê pelo nome as colunas que já existiam.

### 4.3 `discador_consultor_raiox(p_agente int, p_de date, p_ate date, p_operacao text default null) returns jsonb` (nova)
Faz as mesmas checagens das outras: `discador_exige_supervisao` e `discador_operacao_efetiva`. Devolve:
```json
{
  "operacao": "apex",
  "dias": [ { "dia": "2026-10-15", "inicio": "…", "fim": "…", "horas_ativas": 6, "atendidas": 96,
              "pausas": 2, "min_pausa": 41 } ],
  "por_hora": [ { "hora": 14, "atendidas": 18 } ],
  "pausas": [ { "inicio": "…", "fim": "…", "minutos": 28, "equipe_sem_chamadas": false } ],
  "qualidade": {
    "agente": { "atendidas": 96, "curtas": 40, "seg_falados_medio_sem_curtas": 71, "seg_espera_medio": 2,
                "mix": { "sem_avanco": 50, "retorno": 6, "descarte": 4, "perdido": 3, "ganho": 1, "sem_contato": 20, "sem_tabulacao": 2, "outros": 0 } },
    "equipe": { "…mesmas chaves…": 0 }
  },
  "resultado": {
    "dias": [ { "dia": "2026-10-15", "atendidas": 96, "vendas": 2 } ],
    "semana_anterior": { "atendidas": 410, "vendas": 5 },
    "semana_atual": { "atendidas": 480, "vendas": 7 }
  }
}
```
- `por_hora` (9 a 21) e `pausas` (no máximo 50, as mais longas primeiro, depois reordenadas por horário) só vêm quando `p_de = p_ate`; em vários dias são listas vazias.
- `dias` lista cada dia do período com atendimento do consultor.
- Sem atendimentos: as listas vêm vazias e os números zerados, sem erro.
- Grant para `authenticated`, como as outras funções de leitura.

### 4.4 Testes SQL
`supabase/tests/discador_raiox_check.sql`, cenário fictício em junho de 2000, terminando em ROLLBACK. Confere:
- jornada, horas ativas e atend./hora;
- pausa longa normal e pausa com "equipe sem chamadas", que não conta;
- curtas;
- tempo falado sem curtas;
- mix de tabulação;
- comparação com a equipe;
- resultado de 7 dias úteis com a semana anterior;
- supervisor de outra operação recebe 42501;
- consultor recebe 42501;
- as colunas novas de `discador_consultores`.

## 5. Painel (aba Discador)

- **Tabela de Consultores:**
  - **colunas novas:** Jornada ("14:02–19:58" num dia; "—" em vários), Atend./h ativa, Pausas longas, % curtas;
  - **destaque:** em vermelho conforme §3.
- **Raio-X:** clicar na linha abre o Raio-X logo abaixo da tabela, no lugar do antigo "por dia". Tem botão "Fechar" e recarrega ao trocar de período ou de operação.
  - **Cabeçalho:** nome, operação e período.
  - **4 cartões** (`bmKpi`): Jornada (ou "N dias"), Atend./hora ativa (com o valor da equipe), Pausas longas (quantidade e minutos somados), % curtas (com o valor da equipe). O número fica vermelho quando é pior em mais de 30%.
  - **Ritmo:**
    - num dia: barras hora a hora (`bmHoras`) e a lista de pausas "15:20–15:48 · 28 min", com a etiqueta *equipe sem chamadas* quando for o caso;
    - em vários dias: tabela por dia (jornada, horas ativas, atend./h, pausas, min em pausa).
  - **Qualidade:** tabela consultor × equipe (% curtas, tempo médio falado sem curtas, espera média) e o mix de tabulação em barras (`bmTrilho`), cada categoria com consultor e equipe.
  - **Resultado:** tabela dos 7 dias úteis (dia, atendidas, vendas, conversão) e a linha "semana anterior", com a seta ▲▼ e a variação em % (`bmChip`), para atendidas, vendas e conversão.
- **Correções incluídas** (menores da revisão da §87):
  - o Raio-X tem contador de geração próprio, então clicar rápido em A e depois B mostra B;
  - o texto "até 30 dias antes" do cartão de vendas passa a usar `janela_venda_dias` (o `discador_resumo` não muda; a janela é lida de `config` uma vez na carga).
- **Regras de sempre:**
  - sem CSS novo, só classes existentes e variáveis do manual;
  - textos do banco escapados;
  - no celular, os blocos empilham (`bmG2` → 1 coluna) e as tabelas rolam dentro do `mlTabelaWrap`.
- **Testes JS:** HTML do Raio-X (num dia e em vários dias), destaques, etiqueta "equipe sem chamadas", corrida de cliques A→B, colunas novas da tabela, período vazio sem `NaN`.

## 6. Entrada no ar (cada passo com ok do Rafael)

1. Migration `20261016150000_discador_raiox.sql` (config, `discador_consultores` recriada, `discador_consultor_raiox`), aplicada pelo editor em partes de até ~8 KB se o conector recusar; rollback em `supabase/rollback/`; os três testes SQL.
2. Painel: merge do oficial, build, testes, comparação com o ar, backup, publicação, MD5, REGRAS **§96** (conferir se ainda está livre), push e vigia.

## 7. Riscos

- **Pausa pode não ser ausência:** a fila vazia do discador também aparece como pausa. A etiqueta "equipe sem chamadas" separa a maioria dos casos, mas não todos (por exemplo, quando só um consultor ficou sem chamadas por roteamento).
- **Desempenho:** o Raio-X olha só um consultor por vez e os índices `(agente_id, gerada_em)` e `(operacao, gerada_em)` já existem. A comparação com a equipe percorre o período da operação, como já fazem as outras funções da aba.
