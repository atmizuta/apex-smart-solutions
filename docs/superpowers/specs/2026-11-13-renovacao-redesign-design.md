# Redesign da aba Renovação: "Central do dia" (§151)

**Data:** 13/11/2026 · **Pedido:** Rafael ("redesign COMPLETO dessa aba… para que fique bonito e fácil de usar e claro")
**Seção do REGRAS:** §151 (a §150 está reservada pela biometria em Pedidos em Alerta)
**Mockups aprovados** (dados fictícios): `docs/superpowers/specs/assets/2026-11-13-renovacao-redesign-direcoes.html` (opção A) e
`docs/superpowers/specs/assets/2026-11-13-renovacao-redesign-estrutura.html` (Carteira, Funil, Resumo).

## 1. Por que

A aba Renovação (§143) funciona, mas é uma planilha na tela: tabela com selects e campos de data em cada linha, nove
filtros soltos lado a lado, subabas que não dizem por onde começar. O time não sabe o que fazer primeiro (77% da carteira
ainda "Não contatado", 22 retornos vencidos em 13/11). O redesign organiza a aba em torno do **dia de trabalho**.

## 2. Decisões do Rafael (brainstorming de 13/11)

| Tema | Decisão |
|---|---|
| Direção | **A · Central do dia** (as primeiras opções e as B/C foram descartadas) |
| Subabas | **Hoje** · **Carteira** · **Funil** · **Resumo** · **Proposta e fatura**. "Retornos" deixa de ser subaba (vira Atrasados e Hoje da Central) |
| Cartão "meta" | Não existe meta: o cartão vira **linhas renovadas no mês** |
| Retorno | **Data e hora** (coluna nova; retornos antigos ficam só com a data) |
| Ordem da fila | Atrasados (mais antigo primeiro) → Hoje (por hora; sem hora no fim) → Sugeridos (10 maiores APTO não contatados) |
| Registrar contato | Botões grandes "Como foi o contato?" mapeados aos status 2–7, com "Salvar e próximo" |
| Gestor | Seletor "Time todo / consultor" na Central; com "Time todo" a fila mostra o time inteiro |
| Entrega | Uma publicação só (aba inteira de uma vez) |

## 3. Linguagem visual

- **Mesma linguagem do redesign de Meus leads (§126)**: tokens `--ml-*` (tinta, superfícies, atrasado, ok), raios 12 px nos
  blocos, 10 px nos cartões e 8 px nos botões e campos; sombra só no que flutua; Barlow no texto e Barlow Condensed nos
  números grandes e no nome do cliente na ficha; números com `tabular-nums`.
- Os tokens ficam declarados para `#panel-renovacao, #rnFicha` (reaproveitando os valores do §126, sem cor nova).
- **Cor:** o vermelho Apex só no botão principal de cada tela e no que está **atrasado** (sempre cor + ícone ⏱ + texto).
  Verde só para "hoje" / renovado (`--st-ganho`).
- **Etapas** (status 1–7) em **etiqueta com ponto colorido** e texto em frase normal:
  1 Não contatado (cinza) · 2 Tentativa (âmbar) · 3 Contato efetivo (azul) · 4 Proposta enviada (roxo) ·
  5 Em negociação (laranja) · 6 Renovado (verde) · 7 Perdido (vermelho). As cores de azul/roxo/laranja entram como tokens da
  aba (`--rn-st3`… `--rn-st7` e fundos), declarados uma vez.
- **Navegação:** controle segmentado (como o `kbSeg` de Meus leads) com o selo de atrasados em "Hoje".
- **Tela estreita (< 900 px):** fila e ficha uma embaixo da outra; tabela da Carteira vira lista de linhas empilhadas; Funil
  com rolagem lateral.
- **Movimento:** só transform/opacity entre 150 e 300 ms; nada com `prefers-reduced-motion`.
- O shell não muda (menu, `#pageHead`, ApexMotion, "SISTEMA VISUAL SINAL DE ÁPICE"). As outras abas não mudam.

## 4. Hoje (Central do dia) — tela inicial da aba

### 4.1 Cartões do topo (4)
1. **Carteira:** total na base e barra de % contatado ("23% já contatados").
2. **Retornos atrasados:** número em vermelho e "N vencem hoje".
3. **Em negociação:** clientes em 5 e soma do valor proposto das propostas **abertas** ligadas.
4. **Linhas renovadas no mês:** soma de `linhas_renovadas` dos clientes em 6 cujo `status_desde` cai no mês corrente (SP),
   e "N clientes".
Para o gestor, os cartões somam o que o seletor escolher (time todo ou um consultor).

### 4.2 Fila (lado esquerdo)
- Busca no topo da fila (empresa, CNPJ, ADM) e botão "Filtros" que leva para a Carteira com a busca aplicada.
- Três blocos, nesta ordem, cada um com contagem:
  1. **Atrasados:** retorno antes de agora (data anterior a hoje, ou hoje com hora já passada), do mais antigo ao mais novo.
     Texto "⏱ há 3 dias" / "⏱ era 10:00".
  2. **Hoje:** retorno hoje ainda não vencido, por hora; sem hora no fim. Texto "15:00" ou "hoje".
  3. **Sugeridos:** os **10** maiores (linhas de voz) com apto **APTO** e status 1, na base.
- Só entram clientes **na base** com status ≠ 6 e ≠ 7 nos blocos 1 e 2.
- Cada item: iniciais, empresa, ADM e linhas, etiqueta da etapa, tempo/hora. O item aberto fica marcado.
- Gestor com "Time todo": cada item mostra também o consultor.
- Vazio: "Nada atrasado nem para hoje. 👏" e os Sugeridos.

### 4.3 Ficha (lado direito; a mesma em todas as subabas)
- Abre sozinha no primeiro item da fila; nas outras subabas abre ao clicar num cliente.
- Cabeçalho: iniciais, **nome** (Barlow Condensed), CNPJ formatado, cidade, linhas, apto; etiqueta da etapa.
- Ações: **WhatsApp** (principal) · **Ligar** · **Gerar proposta** (escondido em 6 e 7, com a explicação de hoje).
  Clicar em WhatsApp ou Ligar marca o canal no formulário (WhatsApp / Ligação).
- Abas da ficha: **Atendimento** · **Dados da Claro** (os grupos de hoje) · **Propostas · N** · **Histórico**.
- **Atendimento:**
  - "Como foi o contato?" com botões:

    | Botão | Status | Junto |
    |---|---|---|
    | Não atendeu | 2 | próximo retorno, sugerido amanhã na mesma hora |
    | Falei com o responsável | 3 | próximo retorno |
    | Mandei proposta | 4 | próximo retorno |
    | Negociando | 5 | próximo retorno |
    | Renovou ✓ | 6 | linhas renovadas (obrigatório), BL vendida, soluções digitais |
    | Perdido | 7 | motivo (obrigatório) |

    O botão do status atual vem marcado; clicar em outro só muda a seleção (nada grava até salvar).
  - Campos: **próximo retorno** (data + hora, hora opcional), canal, observação. Renovou/Perdido mostram os campos deles no
    lugar do retorno.
  - Botões: **Salvar e próximo →** (grava e abre o próximo item da fila; fora da Central, só "Salvar") e "Salvar".
  - As regras continuam as do banco (Perdido exige motivo, Renovado exige linhas, legado "a completar").

## 5. Carteira
- Busca grande; **visões com contagem** (pílulas): Todos · Não contatados · Em andamento (2–5) · Atrasados · Pendências ·
  Renovados · Perdidos · Fora da base. Uma visão ativa por vez.
- **Mais filtros** (painel): cidade, DDD, apto, consultor (gestor). Filtros ligados viram etiquetas "Cidade: Campinas ✕".
- Ordenação: "Mais linhas primeiro" (padrão) ou "Retorno mais próximo".
- Tabela: Empresa (iniciais, nome, ADM · cidade · apto) · Linhas · Etapa · Último contato (data · canal) · Próximo passo
  ("⏱ retorno atrasado 3 dias", "● retorno hoje 15:00", "Primeiro contato", "22 linhas renovadas"…). **Nada editável na
  linha**; clicar abre a ficha.
- 50 por vez com "Mostrar mais".
- Gestor: caixa de seleção por linha e barra "N selecionados · Passar para [consultor] [Passar]" (regras de hoje:
  destino guardado, "selecionar todos" = filtro inteiro, só passa o que está no filtro).

## 6. Funil
- O Kanban de hoje (etapas 3–7, arrastar, janela de Renovado/Perdido, Gerar proposta no cartão) com o visual novo.
- Cartão: empresa, linhas, valor da proposta aberta (renovado/perdido: a mais nova), "⏱ parado há X dias" (vermelho a partir
  de 7 dias em 3–5), consultor (gestor).
- Respeita o seletor de consultor do gestor.

## 7. Resumo
- Cartões: clientes na carteira · % contatados · % conversão · retornos atrasados.
- Tabela por consultor: carteira, cobertura (barra + %), conversão (barra + %), em negociação, renovados, linhas renovadas,
  atrasados (+ linha TOTAL). Mesmas fórmulas de hoje (view `renovacao_resumo`).
- **Importar base** (admin): botão discreto que abre a importação de hoje numa janela (mesma lógica e prévia).

## 8. Proposta e fatura
Sem mudança: o mesmo gerador (nós movidos de `#panel-proposta`).

## 9. Banco
- `renovacao_carteira.retorno_hora time` (nulo). `prox_retorno` continua `date`.
- "Atrasado" = `prox_retorno < hoje_SP` **ou** (`prox_retorno = hoje_SP` e `retorno_hora < agora_SP`), status ≠ 6/7.
  A view `renovacao_resumo` passa a usar essa regra (`create or replace`, mesmas colunas).
- Consultor pode gravar `retorno_hora` (é campo de atendimento; a trava da Fase 1 só protege consultor e dados da Claro).
- Sem DROP; migration `20261113150000_renovacao_retorno_hora.sql` + conferência `supabase/tests/renovacao_retorno_hora_check.sql`.

## 10. O que não muda
Carregar/salvar, regras e permissões (RLS), histórico, importação, redistribuição, propostas ligadas e sincronização com o
funil, time sem Busca/Proposta/Funil/Agenda, as outras abas.

## 11. Testes
- **Mantidos** (regras): testes de funções puras da §143 (filtrar, contadores, validar fechamento, importação, resumo,
  propostas). Os testes de tela da §143 são reescritos para a marcação nova.
- **Novos:**
  - ordem da fila: atrasados por antiguidade, hoje por hora (sem hora no fim), sugeridos = 10 maiores APTO status 1 na base;
  - atrasado com hora (hoje 15:00 às 16:00 → atrasado; às 14:00 → hoje);
  - linhas renovadas no mês (só status 6 com `status_desde` no mês corrente);
  - cada botão de "Como foi o contato?" gravando o status certo; Renovou exige linhas e Perdido exige motivo;
  - clicar em WhatsApp/Ligar marca o canal;
  - "Salvar e próximo" grava e abre o próximo da fila;
  - gestor com "Time todo" (fila do time com consultor) e com um consultor;
  - visões da Carteira com contagem, "Mais filtros" com etiquetas ✕, "Retorno mais próximo";
  - SQL: `retorno_hora` gravável pelo consultor; atrasado com hora na view.
- Antes de publicar: revisão única do branch, `<div>` balanceadas, comparação com o ar, ok do Rafael para o banco e para o
  painel.

## 12. Fora do escopo
Meta de renovação por consultor; notificação/alerta de retorno (som, push); agenda em calendário; mudanças na importação.
