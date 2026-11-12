# §149 TV Vendas — ranking de conversão ao vivo e comemoração de venda — design (12/11/2026)

Pedido do Rafael (12/11): dois vídeos da TV da EagleCRM ("Conversão por Consultor") — "quero colocar algo igual a
isso no nosso painel". O que os vídeos mostram:

- Tela de TV com o ranking do dia por consultor (posição com seta, contatos, vendas com barra, conversão, aditivo em
  R$), cabeçalho com totais, meta do dia, última venda, relógio "ao vivo" e os botões Campanha | Hoje, Alternar,
  Som ligado e tela cheia. Rodapé: "Conversa = tabulação diferente de 'Sem contato' · atualiza a cada venda".
- A cada venda, a tela inteira vira um "VENDEU!" (foto no círculo dourado, nome grande, confete e foguete) com
  "▲ subiu do 3º para o 1º lugar · 2 vendas hoje · 7,0% de conversão", e volta ao ranking já atualizado.
- Ao bater a meta do dia, um "META BATIDA!" dourado com troféu, "31 vendas hoje · Meta do dia: 30 · parabéns, time!"
  e os círculos de todos que venderam com o número de vendas de cada um.

## Problema

No Apex a venda só chega pela NEO (`producao_pedidos_neo`, sync a cada 10 min de dia) e os contatos pelo robô do
discador (`discador_chamadas`, a cada 15 min). Comemorar "na hora" é impossível com essas fontes, e quem vende pelo
discador ou pela Renovação não tem onde marcar a venda no painel.

## Decisões (Rafael, 12/11)

- **Na hora:** a venda nasce quando o consultor marca. Sem aprovação no meio: confirmou, a TV comemora.
- **Duas portas de entrada:**
  - **Discador e Renovação:** botão novo **"Vendi!"**.
  - **Leads:** classificar como `PEDIDO CONCLUIDO (VENDA)` já leva a venda para a TV. O Classificar ganha o mesmo
    seletor de plano × linhas do "Vendi!".
- **1 venda = 1 pedido.** O consultor informa CNPJ, plano e nº de linhas (com "+ outro plano" para pedido misto). A
  **receita do pedido** é calculada e aparece antes de confirmar.
- **Fotos:** ficam para uma fase 2. Agora são as iniciais num círculo colorido. Na fase 2, o gestor sobe a foto de cada
  um.
- **Meta do dia:** o gestor define na própria TV. Se ninguém mexer, vale a do último dia que tem meta.
- **Períodos:** Hoje | Mês, alternando sozinho.
- **Contatos:** conversas do discador + leads atendidos no dia.
- **Operação:** só a Apex (Campinas fora).
- **Atualização:** consulta leve a cada 3 s (sem Realtime).
- **NEO:** confere depois e nunca tira uma comemoração.

## Banco

Migration `2026111212xxxx_tv_vendas.sql`, só com create/alter, sem DROP (o conector do Supabase falha com DROP).

**`vendas_marcadas`:** uma linha por venda.
- Venda: `id bigserial`, `consultor_id uuid → profiles`, `origem` (`discador` | `renovacao` | `lead`), `cnpj` (14
  dígitos), `itens jsonb` (`[{plano_id, gb, valor_linha, linhas}]`), `linhas int`, `receita numeric(12,2)`,
  `marcada_em timestamptz default now()`.
- Ligação com o lead: `lead_aba text`, `lead_id text`, com **único parcial** em `(lead_aba, lead_id) where
  cancelada_em is null`.
- Cancelamento: `cancelada_em`, `cancelada_por`, `motivo_cancel`.
- Conferência: `neo_status` (`pendente` | `confirmada` | `nao_encontrada` | `ok_gestor`), `neo_pedido`,
  `neo_receita`, `neo_usuario`, `neo_conferida_em`.
- RLS ligado, sem policy de escrita: tudo passa pelas RPCs.

**`tv_meta_dia`:** `dia date pk`, `meta int > 0`, `definida_por`, `definida_em`, `comemorada_em`.

**RPCs:** todas secdef, fora de PUBLIC/anon, só para a operação Apex (mesmo filtro do §78).
- `vendi(p_cnpj, p_itens, p_origem)`: grava a venda do usuário logado.
  - Valida o dígito do CNPJ, `linhas` de 1 a 300 e `valor_linha` de 20 a 400.
  - A receita é a soma de linhas × valor_linha.
  - Devolve `{id, aviso}`. O aviso aparece se o mesmo consultor já marcou o CNPJ hoje ou se o CNPJ já virou venda por
    um lead hoje. O aviso não bloqueia.
- `vendi_cancelar(p_id, p_motivo)`:
  - o dono cancela até 10 min depois de `marcada_em`;
  - admin/supervisor cancela sempre, e o motivo é obrigatório.
- `tv_ultima_venda()`: `max(id)` e o nº de cancelamentos de hoje, para a TV perceber os cancelamentos também.
- `tv_vendas_desde(p_id)`: vendas novas não canceladas, em ordem. Cada uma traz nome, iniciais, receita, vendas e
  conversão de hoje, e posição antes e depois no período da tela.
- `tv_ranking(p_periodo)` (`hoje` | `mes`): uma linha por consultor Apex ativo, mais os totais e a meta do dia.
  - Linha: contatos, vendas, receita, conversão, posição.
  - Totais: contatos, vendas, conversão, receita, última venda.
- `tv_meta_definir(p_dia, p_meta)`: só admin/supervisor.
- `tv_meta_comemorar(p_dia)`: `update … set comemorada_em = now() where comemorada_em is null returning`. Dá "sim"
  uma vez só.
- `vendas_conferir_neo()`: ver Conferência.

**Contato (por consultor e dia):**
- **Discador:** `discador_chamadas` com `tabulacao is not null and tabulacao <> 'SEM CONTATO'`. Liga ao consultor
  pela `discador_agente.profile_id` e ao dia por `atendida_em` (hora de SP).
- **Leads:** leads com linha em `leads_historico` feita pelo consultor (`por`) no dia.
- Um mesmo CNPJ conta uma vez por consultor e dia. Chamada sem CNPJ conta pela própria chamada.
- Conversão = vendas ÷ contatos. Com 0 contato aparece "—".

**Lead → venda:** gatilho `after update on leads`.
- **Status virou `PEDIDO CONCLUIDO (VENDA)`:** cria a venda (`origem lead`, `receita = leads.receita`, consultor =
  `dono_id`), se ainda não há venda ativa daquele lead.
- **Status saiu de venda:** cancela a venda ativa daquele lead (motivo "lead mudou de status").
- **Itens:** o Classificar manda os itens por `venda_itens_lead(p_aba, p_id, p_itens)` logo depois do
  `leads_classificar`. Os itens são só detalhe: a receita que vale é a do lead (§140). A `leads_classificar` não muda
  de assinatura.

## Tela

**Botão "Vendi!"**
- Fica fixo no topo, ao lado do usuário, para Consultor, Supervisor e Gestor da Apex. Aparece em qualquer aba (inclusive
  Discador e Renovação).
- Janela:
  - CNPJ com máscara e conferência do dígito. Vem preenchido com o cartão aberto da Renovação.
  - Linhas de plano × nº de linhas, com "+ outro plano". A lista vem da `OFFERS_MOBILE` (a mesma do Gerar Proposta, já
    com o Monitor incluso).
  - "Receita do pedido: R$ X/mês" em destaque e o botão "Confirmar venda 🎉".
- Depois de confirmar: um "VENDEU!" curto na tela do próprio consultor (2 s) e a faixa "Marcou errado? Desfazer",
  que dura 10 min.

**Classificar do lead:**
- Com o status de venda, o bloco de venda ganha o mesmo seletor plano × linhas.
- O seletor preenche "Receita (R$)", que **continua editável** (§140 continua valendo: venda só com receita).

**Aba "TV Vendas"** (só admin/supervisor), no visual Sinal de Ápice, sem mudar o design do resto do painel:
- **Topo:** título e data, Hoje | Mês, Alternar (troca a cada 60 s), Som ligado, tela cheia e relógio "ao vivo".
- **Cabeçalho:** contatos · vendas · conversão · receita · meta do dia "27 de 30" com barra (editável ali) · última
  venda.
- **Linhas:** posição com ▲▼ (movimento desde a venda anterior) · iniciais e nome · contatos · vendas com barra ·
  conversão · receita.
- **Rodapé:** a regra de contato e "atualiza a cada venda".
- **VENDEU!** (7 s):
  - tela cheia com confete e foguete, iniciais no círculo dourado e nome grande;
  - "▲ subiu do Xº para o Yº lugar no mês · N vendas hoje · R$ … · Z% de conversão";
  - várias vendas viram fila.
- **META BATIDA!** (10 s): dourado com troféu, total de hoje, meta e círculos de quem vendeu com o nº de vendas.
  Aparece logo depois do VENDEU! que bateu a meta, uma vez por dia (`tv_meta_comemorar`).
- **Som:** efeito curto por venda e outro pela meta. Só toca depois do clique em "Som ligado", porque o navegador
  exige um gesto. A escolha fica guardada.
- **Ciclo:**
  - `tv_ultima_venda` a cada 3 s;
  - mudou: `tv_vendas_desde` mais `tv_ranking`;
  - sem mudança: `tv_ranking` a cada 60 s (para os contatos do discador).
- **TV ligada o dia todo:**
  - recarrega sozinha na virada do dia;
  - renova o login antes de vencer;
  - mostra o aviso "sem conexão há N min" em vez de congelar.

## Conferência com a NEO

- `vendas_conferir_neo()` roda no pg_cron a cada 30 min, das 8h às 20h de SP, só lendo a `producao_pedidos_neo`.
  Não mexe na `sync-producao` (a §81 está pendente).
- Para cada venda `pendente`, procura um pedido com o mesmo CNPJ, `cadastro` entre o dia da marcação e +3 dias úteis,
  sem GROSS.
  - **Achou:** `confirmada`, com nº, receita e usuário da NEO.
  - **Passou o prazo:** `nao_encontrada`.
- Bloco **"Conferência"** na aba TV Vendas, fora da tela cheia, só para gestor:
  - não encontradas, com "Cancelar venda" ou "Está certo" (as duas pedem motivo, como no §142);
  - avisos de receita da NEO ±20% da marcada e de usuário da NEO diferente do consultor.
- Nada é cancelado sozinho.

## Fora (YAGNI / fase 2)

- Fotos (upload do gestor, recorte redondo).
- Campanha com datas.
- Operação Campinas.
- Supabase Realtime.
- Cruzar "Vendi!" com a tabulação `AQUISIÇÃO - GANHO` do discador.
- Meta por consultor na TV (a `metas_consultor` é mensal de receita e fica como está).
- Fibra/convergência no seletor (entra como "outro valor" se o Rafael pedir).

## Testes

- `test_tv_vendas.js` (jsdom), no padrão dos `test_*.js`:
  - janela do Vendi! (DV, soma da receita, "+ outro plano", Desfazer);
  - fila de comemorações;
  - META BATIDA! uma vez;
  - Hoje | Mês e Alternar;
  - aviso de sem conexão.
- `supabase/tests/tv_vendas_check.sql` (desfaz tudo):
  - permissões (anon recusado, Campinas recusado, cancelamento fora dos 10 min recusado);
  - gatilho do lead (cria, não duplica, cancela ao sair de venda);
  - `tv_meta_comemorar` devolve "sim" uma vez;
  - contatos batem com a `discador_chamadas` e a `leads_historico` num dia real;
  - `vendas_conferir_neo` confirma um CNPJ conhecido.
- Conferir as `<div>` balanceadas e outra aba antes de publicar (incidente de 27/10).
