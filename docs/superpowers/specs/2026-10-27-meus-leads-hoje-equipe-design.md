# Meus leads: abas Hoje / Quadro / Equipe, pesquisa, linha do tempo, retorno na Agenda e alertas (design)

- **Data:** 27/10/2026
- **Pedido do Rafael:** as ideias 1 (próximo lead), 3 (retorno vira compromisso), 7 (linha do tempo), 8 (quadro da equipe com semáforo) e 9 (alertas). Também a pesquisa por CNPJ e a separação em abas "para não deixar o consultor confuso". Tudo antes da virada.
- **Seção do REGRAS:** §118 (reservada; a oficial vai até a §117).
- **Base:** spec `2026-10-26-leads-kanban-planilha-design.md` (§112). Nada daquela spec muda, a não ser o que está escrito aqui.

## 1. Objetivo

1. O consultor sabe **o que fazer agora**: ele aperta "Próximo lead" e trabalha em sequência, os retornos tocam na hora marcada e os alertas mostram o que está escapando.
2. O supervisor **enxerga o trabalho em cada lead**: clica e vê se houve ligação, quando, se foi atendida e quanto durou. Vê também a equipe inteira num quadro com semáforo.
3. Ninguém se perde: as funções ficam separadas em abas, com uma pesquisa sempre à mão.

## 2. Decisões do Rafael (27/10)

| Tema | Decisão |
|---|---|
| Organização | Abas **Hoje / Quadro / Equipe**. Equipe só para admin e supervisor. **Pesquisa** (CNPJ, nome, telefone) sempre no topo |
| Alertas | **Lista** nas abas Hoje e Equipe, contador no menu e **notificação na tela** para o alerta urgente, no mesmo mecanismo dos alertas da Agenda |
| Limites | Padrões ajustáveis em `config.leads_alertas` (seção 5.4) |

## 3. Telas

### 3.1 Topo de "Meus leads" (todas as abas)
- Campo **"Pesquisar por CNPJ, nome ou telefone"**. A busca começa a partir de 3 caracteres, espera 300 ms depois da digitação e traz até 20 resultados.
- Cada resultado mostra empresa, cidade/UF, status e com quem está, e clicar abre a **ficha**.
- **Consultor** acha os leads dele e os Livres. Nos Livres, CNPJ, telefone e e-mail continuam escondidos, mas a busca pelo CNPJ completo acha o lead, sem mostrar o número.
- **Gestor** acha qualquer lead.
- Placar já existente: receita e vendas do mês, leads em aberto.
- Pílulas das abas: **Hoje · Quadro · Equipe**. A Equipe só aparece para gestor. O contador de alertas aparece ao lado de "Hoje" e "Equipe".

### 3.2 Aba "Hoje" (abre por padrão para o consultor)
- **Botão grande "Próximo lead"**: abre a ficha do primeiro lead da lista de prioridade (seção 5.1). Se a lista estiver vazia e houver Livres, o botão vira **"Pegar o próximo livre"**, que pega o Livre mais antigo e abre a ficha.
- **Retornos de hoje:** os retornos ligados a leads do consultor, de hoje e vencidos, em ordem de hora, com a hora, a empresa e um botão para abrir. Vencido fica em vermelho.
- **Meus alertas:** lista dos alertas do consultor (seção 5.4), cada um com botão para abrir o lead.
- O gestor também vê a aba Hoje, no recorte escolhido no filtro "Consultor".

### 3.3 Aba "Quadro"
- É o Kanban atual, sem mudança.

### 3.4 Aba "Equipe" (gestor; abre por padrão para o gestor)
- Tabela com uma linha por consultor da `leads_equipe`:
  - em aberto;
  - **novos sem contato há 15 min ou mais**;
  - retornos vencidos;
  - **parados**: em andamento há 3 dias ou mais sem contato;
  - **perdidos sem ligação** no mês;
  - pegos no mês;
  - convertidos no mês e **conversão** (convertidos ÷ pegos no mês);
  - **receita** do mês;
  - **tempo médio até o 1º contato** hoje.
- **Semáforo por linha:**
  - **vermelho** se houver novo sem contato há 15 min ou mais, ou retorno vencido;
  - **amarelo** se houver parado ou perda suspeita;
  - **verde** nos outros casos.
- Clicar na linha leva para o **Quadro** com o filtro daquele consultor.
- Embaixo vem a **lista de alertas da equipe**, com o nome do consultor e um botão para abrir o lead.

### 3.5 Ficha do lead (gaveta já existente)
- **Resumo de contato** no topo da seção Andamento, por exemplo: "5 tentativas · 2 atendidas · última há 3 h" ou "Nenhuma ligação ainda".
- **Linha do tempo**, do mais novo para o mais antigo. Mostra os 30 eventos mais recentes, com "ver tudo" para o restante. Os eventos estão na seção 5.2.
- Seção nova **"Detalhes do anúncio"**: campanha, conjunto (adset), anúncio, formulário, plataforma, orgânico.

### 3.6 Retorno na Agenda
- No **Classificar**, AGENDADO RETORNO passa a pedir **data e hora**, com a hora em 10:00 por padrão.
- Ao salvar, o banco cria ou atualiza **um** retorno pendente na `agenda_retornos` daquele lead para o dono, com `origem = 'lead'`, nome, telefone, `chave_tel` e OBS. O alerta da Agenda (`alEstado`) já toca na hora marcada.
- "Retorno amanhã" e "Em 3 dias" fazem o mesmo, às 10:00. A gravação em `leads_followups` continua igual, para a Digital (§48a).
- Classificar com outro status marca como **feito** o retorno pendente daquele lead. Redistribuir passa o retorno pendente para o novo dono.

## 4. Fora do escopo
- Régua de contato (ideia 4), meta no topo (5), auditoria em lote (10), devolução automática (11) e resumo no Boletim (12).
- "Cobrar" consultor (Recados).
- A sincronização do ProContact continua de hora em hora. Nada muda no robô.

## 5. Regras e dados

### 5.1 Prioridade do "Próximo lead" (só leads do dono)
1. Meus novos sem contato, o mais antigo primeiro.
2. Retorno pendente com hora já passada, o mais antigo primeiro.
3. Em andamento com o último contato há 2 dias ou mais (ou nenhum contato), o mais antigo primeiro.
4. Perdido do mês com status "CLIENTE NÃO RESPONDE" ("para resgatar") e sem contato há 2 dias ou mais.

Lead que o consultor acabou de abrir pelo botão não volta como próximo nos 2 minutos seguintes: a exceção fica guardada no navegador. Isso evita que o botão abra sempre o mesmo lead enquanto ele liga.

### 5.2 "Contato" e linha do tempo

**Contato** = qualquer um destes:
- clique em Ligar ou WhatsApp no painel (`leads_contatos`);
- ligação manual do ProContact pelo telefone do lead (`ligacoes_manuais.chave_tel = chave_tel(phone_number)`);
- ligação do discador pelo CNPJ (`discador_chamadas.cnpj` = dígitos do CNPJ).

Para ligação, conta só o que aconteceu **depois** de `criado_em_lead - 1 h`, a mesma regra do "Atender agora".

**Eventos da linha do tempo:**

| Evento | Fonte | Mostra |
|---|---|---|
| Chegou | `leads.criado_em_lead` | data/hora, campanha |
| Pegou / Classificou / Redistribuiu / Devolveu | `leads_historico` | quem, status novo, OBS |
| Clique Ligar / WhatsApp | `leads_contatos` | quem |
| Ligação manual | `ligacoes_manuais` | usuário do ProContact, atendida ou não, duração, tabulação |
| Discador | `discador_chamadas` | status, duração |
| Retorno agendado / feito | `agenda_retornos` (origem lead) | para quando |

### 5.3 Permissões
Valem as mesmas da ficha (`leads_ficha`):
- o consultor vê a linha do tempo do lead dele;
- no Livre, vê só "Chegou";
- o gestor vê todos.

A pesquisa respeita a mesma regra. A aba Equipe e os alertas da equipe são só do gestor.

### 5.4 Alertas e limites (`config.leads_alertas`, JSON)
Padrão: `{"sem_contato_min":15,"parado_dias":3,"esfriando_dias":2}`.

| Código | Regra | Quem vê | Notifica? |
|---|---|---|---|
| `sem_contato` | lead pego (dono definido, sem status) sem nenhum contato, **agora dentro do expediente** (janela seg–sex de `config.velocidade_lead`, hoje 11h–21h) e com `agora − maior(pego_em, início do expediente de hoje)` ≥ `sem_contato_min` minutos. Fora do expediente, o alerta não aparece; ele volta no dia seguinte, 15 min depois da abertura | dono + gestor | **sim** (notificação na tela, uma vez por lead) |
| `retorno_vencido` | retorno pendente com hora passada e sem contato depois dela | dono + gestor | não |
| `parado` | em andamento com o último contato há `parado_dias` dias ou mais | dono + gestor | não |
| `perda_suspeita` | perdido no mês sem nenhuma ligação (manual ou discador) | gestor | não |

- O painel consulta os alertas **a cada 60 s** com a aba visível e, enquanto ela estiver fechada, **a cada 2 min** para o contador do menu.
- A notificação usa o mesmo caminho dos alertas da Agenda: `Notification` mais título piscando. Ela só dispara uma vez por lead em cada sessão.

## 6. Banco (migration `20261027…`)
- **`agenda_retornos`:** colunas novas `lead_aba text` e `lead_id text`, e um índice `(lead_aba, lead_id) where status = 'pendente'`.
- **`config.leads_alertas`** com o JSON padrão.
- **Funções** (`security definer`, `search_path` fixo, sem execute para anon):
  - `leads_buscar(p_texto text) → table(...)`: até 20 resultados com as mesmas colunas e a mesma proteção do `leads_kanban`. Texto só com dígitos (8 ou mais) procura CNPJ e telefone; o resto procura no nome, sem diferenciar maiúsculas e acentos.
  - `leads_linha_tempo(p_aba, p_id) → table(em timestamptz, tipo text, titulo text, detalhe text, quem text)` e um resumo de contato (tentativas, atendidas, último contato), com a permissão da seção 5.3.
  - `leads_alertas(p_dono uuid default null) → table(tipo, aba, lead_id, nome, dono_id, dono_nome, desde timestamptz)`: para o consultor, só os dele; para o gestor, os do dono pedido ou todos.
  - `leads_equipe_resumo() → table(dono_id, nome, em_aberto, sem_contato, retornos_vencidos, parados, perdas_suspeitas, pegos_mes, convertidos_mes, receita_mes, tempo_medio_1o_contato_min)`: só gestor.
  - `leads_hoje() → table(...)`: retornos de hoje e vencidos do consultor, mais a lista de prioridade da seção 5.1, já ordenada. Para o gestor, usa o filtro de dono.
- **`leads_classificar`** ganha `p_retorno_hora time default '10:00'`, e cria, atualiza ou fecha o retorno na `agenda_retornos`. A assinatura antiga continua funcionando, porque o parâmetro tem padrão.
- **`leads_redistribuir`** passa o retorno pendente para o novo dono.

## 7. Testes
- **Funções puras do painel** (jsdom):
  - prioridade do Próximo lead e a exceção de 2 min;
  - semáforo da Equipe;
  - texto do resumo de contato;
  - montagem da linha do tempo, com ordem e ícones;
  - pesquisa: tempo de espera e mínimo de caracteres;
  - abas por perfil;
  - contador de alertas;
  - notificação uma vez por lead.
- **Banco** (transação com rollback, dados fictícios):
  - permissões de cada função;
  - contato por clique, por ligação manual e por discador;
  - os 4 alertas, com limites e expediente;
  - o retorno criado, atualizado e fechado pelo classificar e pelo redistribuir;
  - pesquisa por CNPJ achando lead Livre sem mostrar o número.
- **Visual:** print com dados fictícios das três abas e da ficha com a linha do tempo, conferido antes de publicar.

## 8. Ordem de entrega
Um único pacote, publicado **antes da virada**. A aba continua visível só para o admin até a virada.
