# Aba Renovação: carteira da planilha + kanban + proposta numa aba só (§143)

**Data:** 07/11/2026 · **Pedido:** Rafael · **Seção do REGRAS:** §143 (fases §143.1 e §143.2)

## 1. Por que

O time de renovação (Bruno, Fabiana e Silvana) vende só para quem já é cliente Claro e trabalha
numa planilha do Google ("Carteira_2409_Controle_Consultores"). A planilha não obriga nada e isso
aparece nos números de 07/11: 77% da carteira ainda "Não contatado", 24 retornos atrasados, 8
renovados mas só 3 com "linhas renovadas" preenchido, 52 perdidos e só 26 com motivo.

Ao mesmo tempo, o que é de renovação no painel está espalhado em quatro abas (Busca, Proposta,
Funil, Agenda). O pedido: **tudo que tem na planilha passa a existir no painel, funcionando**, e
**tudo de renovação fica numa aba só**.

## 2. Decisões do Rafael (brainstorming de 07/11)

| Tema | Decisão |
|---|---|
| Origem da carteira | Base única (Aptos de 24/09), que pode mudar: importação junta por CNPJ e nunca apaga trabalho |
| Ligação com proposta/funil | **Integrado**: "Gerar proposta" sai da carteira e o status anda sozinho |
| Abas atuais | Aba **Renovação** nova; o time vê só ela no lugar de Busca/Proposta/Funil/Agenda; os demais consultores continuam com as abas antigas |
| "Faturas" | A análise de fatura que hoje fica dentro de Proposta (premissa; confirmar) |
| Quem manda no status | **A carteira** (abordagem A). O funil acompanha, num sentido só |
| Acesso | Consultor vê só a carteira dele; supervisor e admin veem tudo e redistribuem; só admin importa |
| Kanban | Começa em "Contato efetivo"; não contatado e tentativa ficam na lista |
| Várias propostas por cliente | Permitido; o status move todas as abertas juntas |
| Dados legados incompletos | Entram marcados "a completar"; a regra vale a partir da próxima edição |
| Entrega | 2 fases publicadas separadamente |

## 3. O que a planilha tem hoje (levantado em 07/11)

- **Resumo:** tabela da redistribuição (414 clientes e 1.762 linhas de voz por consultor) e
  "Acompanhamento dos consultores": carteira, contatados, % cobertura, contato efetivo+,
  propostas+, renovados, perdidos, % conversão, linhas renov., BL vendidas, sol. digitais (R$),
  retornos atrasados. Mais o texto "Como preencher".
- **Base Completa:** 1.242 CNPJs, 101 colunas da Claro (consultor, origem, CNPJ, código, razão
  social, endereço, UF, regional, segmento, território, tempos de contrato e quantidades de
  linhas de voz/BL/telemetria, classificação, desconto Claro, telefone, ADM, cidade, DDD,
  apto/tempo/cluster de renovação, clusters de linhas e TMC, fixa, CNAE, dados da Receita,
  contatos extras, cabeamento/HP, pré-aprovado fixa, valor do contrato, ARPU, silentes, última
  cotação, renovação antecipada, score, 5G, concorrência fixa/móvel, churn, porte etc.).
- **Bruno / Fabiana / Silvana:** 414 linhas cada, ordenadas por linhas de voz. Colunas amarelas:
  STATUS, DATA CONTATO, PRÓX. RETORNO, CANAL, LINHAS RENOV., BL VENDIDA (qtd), SOL. DIGITAIS
  (R$), MOTIVO PERDA, OBSERVAÇÕES. Depois, um subconjunto da base (72 colunas).
- **Listas:**
  - Status: 1-Não contatado, 2-Tentativa s/ retorno, 3-Contato efetivo, 4-Proposta enviada,
    5-Em negociação, 6-Renovado, 7-Perdido.
  - Canal: WhatsApp, Ligação, E-mail, Visita.
  - Motivo da perda: Preço, Foi p/ concorrente, Sem interesse, Insatisfeito c/ Claro, Empresa
    fechada/baixada, Contato inválido, Outro.
- **Cores:** linha vermelha = Perdido, linha verde = Renovado, motivo vermelho = perdido sem
  motivo, próximo retorno vermelho = vencido e cliente não fechado.

## 4. Dados e permissões

### 4.1 Tabelas

**`renovacao_carteira`** (um registro por CNPJ)

| Grupo | Colunas |
|---|---|
| Chave | `id` bigint, `cnpj_digits` text **único** (14 dígitos) |
| Da Claro (filtro/lista) | `razao_social`, `telefone`, `nome_adm`, `linhas_voz` int, `apto` text ('APTO' / '1 MÊS PARA APTO'), `cidade`, `ddd`, `tempo_contrato_voz` int, `classificacao`, `desconto_claro` |
| Da Claro (inteiro) | `dados_claro` jsonb: as 101 colunas, chave = cabeçalho original |
| Trabalho | `consultor_id` uuid → profiles, `origem` text, `status` smallint 1–7 (padrão 1), `data_contato` date, `prox_retorno` date, `canal` text, `linhas_renovadas` int, `bl_vendida` int, `sol_digitais` numeric, `motivo_perda` text, `observacoes` text |
| Controle | `na_base` bool (padrão true), `a_completar` bool (padrão false), `importado_em`, `atualizado_em`, `atualizado_por` |

`canal` e `motivo_perda` com CHECK nas listas da seção 3.

**`renovacao_historico`**: `id`, `carteira_id`, `user_id`, `campo` ('status' | 'consultor'),
`de`, `para`, `nota`, `criado_em`. Gravado por trigger em toda mudança de status ou de consultor.

**Colunas novas em tabelas existentes**
- `propostas.carteira_id` bigint nulo → `renovacao_carteira(id)`.
- `profiles.equipe` text nulo; `'renovacao'` marca o time.

### 4.2 Regras no banco (trigger `renovacao_carteira_validar`, BEFORE INSERT/UPDATE)

1. `status = 7` exige `motivo_perda`.
2. `status = 6` exige `linhas_renovadas >= 1` (BL e digitais podem ser 0 ou vazios).
3. `status >= 2` e `data_contato` vazia → `data_contato = hoje` (horário de SP).
4. As regras 1 e 2 **não valem** para registro com `a_completar = true` que não teve o status
   mudado. Quando o registro passa nas regras, `a_completar` vira false sozinho.
5. Consultor (não admin/supervisor) não pode mudar `consultor_id`, `dados_claro`, `na_base`
   nem as colunas da Claro (mesmo padrão da trava `profiles_trava_role`).

### 4.3 RLS

| Perfil | Ler | Editar | Inserir/excluir |
|---|---|---|---|
| Consultor | `consultor_id = auth.uid()` | os mesmos (só colunas de trabalho, ver 4.2.5) | não |
| Supervisor | tudo | tudo (redistribuir) | não |
| Admin | tudo | tudo | sim (importação) |
| Agência e demais | nada | nada | nada |

`renovacao_historico`: leitura segue a da carteira; escrita só pelo trigger (security definer).

### 4.4 Importação (admin, no painel)

Entrada: XLSX lido no navegador (SheetJS 0.18.5 já carregado no painel, `XLSX.read`). Os
dados dos clientes vão do navegador direto ao Supabase e **nunca** passam pelo repositório.

Junção por `cnpj_digits`:
- **Novo** → entra com status 1, sem consultor (aparece em "Sem consultor" para distribuir).
- **Já existe** → atualiza só colunas da Claro e `dados_claro`; volta `na_base = true`.
- **Sumiu do arquivo** → `na_base = false` (sai da lista ativa, não é apagado).

Antes de gravar, mostra a prévia (novos / atualizados / saíram) e pede confirmação.

**Formato "planilha do time" (migração, usado uma vez):** se o arquivo tem as abas dos
consultores com a coluna `STATUS ▼`, o importador também lê as colunas amarelas e liga cada aba
ao consultor pelo nome do perfil. Datas `dd/mm/aa` são convertidas. Registros que quebram as
regras 1 ou 2 entram com `a_completar = true`.

## 5. A aba Renovação

`data-tab="renovacao"`, visível para `equipe = 'renovacao'`, supervisor e admin. Selo na aba =
retornos vencidos do usuário (supervisor/admin: do time). Visual Sinal de Ápice, reaproveitando
o padrão de ficha lateral de Meus leads (§126).

### 5.1 Subabas

1. **Carteira**: lista com busca (CNPJ/razão social/ADM) e filtros (status, apto, cidade/DDD,
   consultor (só supervisor/admin), "só retorno vencido", "Pendências" = `a_completar`, "Fora
   da base"). Ordem padrão: linhas de voz decrescente. Colunas: razão social/ADM, linhas, apto,
   status, próx. retorno, canal. Status, canal e retorno editáveis na própria linha; mudar
   para 6 ou 7 abre a janela de fechamento (5.2). Mesmas cores da planilha. Topo com contadores
   (clientes, % não contatado, retornos vencidos).
2. **Kanban**: colunas 3-Contato efetivo · 4-Proposta enviada · 5-Em negociação · 6-Renovado ·
   7-Perdido. Arrastar muda o status. Soltar em 6/7 abre a janela de fechamento. Cartão:
   razão social, linhas, valor proposto (última proposta aberta), dias no status.
3. **Proposta e fatura**: o gerador e a análise de fatura que já existem (mesmo código), para
   proposta avulsa de cliente fora da carteira.
4. **Retornos**: vencidos, hoje e próximos 7 dias (`prox_retorno`, status diferente de 6 e 7),
   com atalho para a ficha.
5. **Resumo**: consultor vê os próprios números. Supervisor/admin veem a tabela
   "Acompanhamento" por consultor + total (fórmulas em 5.3), **Redistribuir** (selecionar
   clientes na lista → "Passar para" → consultor) e, só admin, **Importar base**.

### 5.2 Ficha do cliente (painel lateral)

Cabeçalho: razão social, CNPJ formatado, botões WhatsApp / Ligar / **Gerar proposta**.
Bloco **Atendimento** com os campos de trabalho. Grupos recolhíveis com os dados da Claro:
Contrato e linhas · Empresa (Receita) · Contatos · Concorrência · Fixa e cabeamento · **Tudo**
(as 101 colunas de `dados_claro`, para nada ficar de fora). **Histórico** (de
`renovacao_historico`) e **Propostas** ligadas (valor atual → proposto, data, estágio).

Janela de fechamento: Renovado pede linhas renovadas (obrigatório), BL vendida e sol. digitais;
Perdido pede motivo (obrigatório) e observação.

### 5.3 Fórmulas do Resumo (iguais às da planilha)

Sobre `na_base = true`, por consultor:
carteira = total · contatados = status ≥ 2 · % cobertura = contatados / carteira ·
contato efetivo+ = status 3 a 6 (Perdido fora) · propostas+ = status 4, 5 ou 6 ·
renovados = status 6 · perdidos = status 7 · % conversão = renovados / contato efetivo+ ·
linhas renov. / BL / digitais = soma · retornos atrasados = `prox_retorno < hoje` e status
diferente de 6 e 7.

Conferido contra os totais da planilha em 07/11: contatados 281, contato efetivo+ 53
(30+11+4+8), propostas+ 23 (11+4+8). Na virada, os retornos atrasados (24) também têm que bater.

Calculado numa view (`renovacao_resumo`) com `security_invoker`, para respeitar a RLS.

### 5.4 Abas antigas

Para quem tem `equipe = 'renovacao'`: Busca, Proposta, Funil e Agenda ficam escondidas
(fase 2). Para os demais, nada muda.

## 6. Integração com proposta e funil (fase 2)

- **Gerar proposta** chama `openProposal(clienteDaCarteira(registro), { carteiraId })`.
  `clienteDaCarteira` monta o objeto no formato de `clientes` (razão social, CNPJ, cidade, DDD,
  linhas de voz, tempo de contrato, `valor_contrato` ← `VL_CONTR_NO_MSISDN_C_DESC_RET`, `arpu`
  ← `VALOR POR LINHA / ARPU`, `qtde_silentes`, `cep_cabeado`, telefones). Se o CNPJ estiver em
  `clientes`, os campos de lá têm preferência e a carteira completa o que faltar.
- `registrarPropostaNoFunil()` grava `carteira_id` quando `proposalState.carteiraId` existe e,
  se o status da carteira for 1–3, muda para 4 (histórico: "Proposta gerada").
- **Trigger `renovacao_carteira_sync_propostas`** (AFTER UPDATE OF status): atualiza as
  propostas **abertas** ligadas (4 → `proposta_enviada`, 5 → `negociacao`, 6 → `fechado_ganho`,
  7 → `fechado_perdido` + `motivo_perda` copiado) e grava `propostas_historico`. Nunca há
  caminho proposta → carteira.
- **Funil antigo:** cartão com `carteira_id` mostra "Abrir na Renovação" e não pode ser
  arrastado. No banco, um trigger em `propostas` recusa mudança de `estagio` em proposta com
  `carteira_id` que não venha do trigger de sincronização.
- **Migração das propostas existentes:** propostas de renovação abertas cujo `cliente_cnpj`
  bate com a carteira recebem `carteira_id` (sem mudar estágio nem status).
- Ranking, Painel do consultor, Fechamento e vendas perdidas continuam lendo `propostas` sem
  mudança.

## 7. Entrega

**Fase 1, §143.1: aposenta a planilha.** Tabelas, regras, RLS, view do Resumo, `profiles.equipe`
(+ marcação na aba Consultores), aba Renovação com Carteira, Ficha (sem "Gerar proposta"),
Retornos, Resumo, Redistribuir e Importar (com o formato de migração). Virada: o admin importa
a planilha, o Resumo do painel tem que bater número a número com o da planilha e a planilha
fica só de consulta.

**Fase 2, §143.2: junta tudo.** Kanban, Gerar proposta integrado, subaba Proposta e fatura,
triggers de sincronização e de trava no funil, migração das propostas existentes e abas antigas
escondidas para o time.

Cada fase: publicada só com ok do Rafael, comparando com o que está no ar; seção no
REGRAS_NEGOCIO.md; DDL em produção só com ok.

## 8. Testes

**SQL (`supabase/tests/`)**
- Consultor lê/edita só os próprios clientes; não muda `consultor_id` nem colunas da Claro;
  agência não lê nada.
- Status 7 sem motivo e status 6 sem linhas são recusados; `a_completar` libera o legado até a
  próxima mudança de status.
- `data_contato` preenchida sozinha ao sair do status 1.
- Histórico gravado em mudança de status e de consultor.
- Fase 2: status leva o estágio das propostas abertas; proposta com `carteira_id` não muda
  estágio fora do trigger; proposta fechada não é tocada.

**JS (`test_*.js`, jsdom, como os demais)**
- Junção da importação: novo / atualiza só Claro / sumiu → `na_base = false`; trabalho
  preservado.
- Leitura do formato da planilha (abas dos consultores, datas `dd/mm/aa`, listas).
- `clienteDaCarteira`: mapeamento e preferência pelos dados de `clientes`.
- Fórmulas do Resumo contra um conjunto pequeno de exemplo.

**Antes de publicar:** `<div>`/`</div>` balanceadas; abrir outras abas (Produção, Meus leads,
Funil) para ver se nada saiu do lugar.

## 9. Fora do escopo

- Cruzar "Renovado" com a produção do NeoSales para confirmar ativação (depende da §81).
- Importação automática da base direto da Claro.
- Kanban para os consultores que não são do time.
