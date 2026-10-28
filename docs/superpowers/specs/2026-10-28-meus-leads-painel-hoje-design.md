# Meus leads: quem pega, Hoje em painel, Equipe com atividade, filtros, aba Todos, aviso de lead novo (§122)

Data: 28/10/2026 · Pedido do Rafael · Seção reservada: **§122** do `REGRAS_NEGOCIO.md`.
Entrega: **tudo numa publicação só**.

## Por quê

- A aba **Hoje** virou "um monte de lead": o bloco Próximo lead e duas listas compridas (retornos e alertas). O consultor não vê quanto tem em cada etapa.
- O supervisor precisa saber **se cada consultor está ligando e escrevendo OBS**.
- O **Quadro** não tem filtro para o consultor (só o gestor tem Consultor e "Só divergências").
- Hoje **qualquer pessoa da `leads_equipe`** (11) pega lead. Só 4 devem pegar.
- Ninguém é avisado quando **chega lead novo**.
- O botão **Copiar** do telefone na ficha copia o valor cru (`p:+5511…`).

## Decisões do Rafael (28/10)

- Só **Luria, Lucas, Caio e Mariana** pegam lead. Quem já tem lead **fica com ele**. O supervisor **continua redistribuindo para qualquer um**.
- Escolhidos: 1a, 1b, 1c · 2a · filtros 3a a 3g (todos) · 4a · 5a · 6a.
- 4a: o consultor vê **só os leads dele**; o gestor vê os da equipe, com filtro por consultor.
- 6a: **só o supervisor** vê. Limites **30 min (amarelo) / 1 h (vermelho)**. Expediente **13h–21h** (São Paulo), **segunda a sexta**.
- O telefone copiado começa no DDD: `11999998888`, sem `p:`, sem `+55`.

## O que existe hoje (base)

- Abas da tela: `hoje`, `quadro`, `equipe` (`kbTrocarAba`). O consultor vê Hoje e Quadro; o gestor vê as três, e a Equipe é a padrão dele.
- `leads_hoje(p_dono)` (jsonb: `fila`, `retornos`, `livres`), `leads_alertas(p_dono)` (tipos `sem_contato`, `retorno_vencido`, `parado`, `perda_suspeita`), `leads_equipe_resumo()`, `leads_kanban2` (inclui `ligacoes`, `ultima_ligacao`, `retorno_em`, `qtd_linhas`, `tipo_empresa`, `cidade`, `uf`, `categoria`, `classificado_em`, `pego_em`, `criado_em_lead`).
- `mesa_ligacoes_hoje()` → `profile_id, lig_lead, lig_total, ultima`. `meu_placar_ligacoes()` → `lig_hoje`, `meta_ligacoes_dia` etc.
- `leads_historico`: `acao` (`pegar`, `classificar`, `devolver`, `redistribuir`, `apagar`), `por`, `em`, `antes`, `depois`. Em `classificar`, `antes`/`depois` trazem `obs`.
- Notificação: `kbCarregarAlertas(true)` já toca `alBip`, mostra aviso e `Notification` do Windows (hoje só para `sem_contato`). O laço roda a cada 10 s com a aba à vista e a cada 2 min em segundo plano.
- As ligações vêm do robô do ProContact **de hora em hora** (§93): a "última ligação" pode estar até ~1 h atrasada.

## Desenho

### 0. Quem pega lead

- **Banco:** coluna `leads_equipe.pode_pegar boolean not null default false`; `true` para Luria, Lucas, Caio e Mariana (pelo `profile_id`).
- `leads_pegar`: depois de achar o membro, se `pode_pegar` for falso → erro `42501` "você não está liberado para pegar leads". Nada mais muda nela.
- `leads_redistribuir`: **não muda** (o gestor manda para qualquer membro).
- `leads_hoje` devolve também `pode_pegar` (bool do usuário logado; gestor = `true`).
- **Painel**, para quem não pode pegar: some a coluna **Livres** do Quadro, o botão "Pegar o próximo livre", o "Pegar" da ficha e o arrastar para pegar. Os leads que ele já tem seguem iguais.

### 1. Hoje do consultor (substitui a tela atual)

De cima para baixo:

**1a. Cartões por etapa** (só a contagem; o clique abre logo abaixo a lista só daquela etapa e destaca o cartão; clicar de novo fecha):
- Sem contato · Em andamento · Retornos de hoje · Retornos atrasados · Convertidos no mês (+ receita do mês).
- Contas feitas na tela sobre `kbEstado.leads` (o mesmo dado do Quadro), com as regras de mês e "hoje" em São Paulo já usadas pelo Quadro. A lista aberta mostra no máximo 20, com "ver mais".

**1b. Faça agora:** até **5** leads, nesta ordem:
1. retorno atrasado (mais antigo primeiro);
2. retorno de hoje (pela hora);
3. pego e nunca ligado (mais antigo primeiro);
4. mais tempo parado (última ação mais antiga).

Cada linha: nome, motivo ("retorno atrasado 2 h", "nunca ligado") e botão que abre a ficha. O "Próximo lead" atual vira o primeiro item. Para quem pode pegar e não tem nada a fazer: "Pegar o próximo livre (N esperando)".

**1c. Placar do dia:** ligações hoje (`meu_placar_ligacoes.lig_hoje`, com a meta se houver), classificações hoje (`leads_historico` acao `classificar`, por = eu, hoje SP) e retornos cumpridos (retornos marcados para hoje que tiveram classificação ou ligação hoje). `leads_hoje` passa a devolver `placar: {classificacoes, retornos_cumpridos, retornos_hoje}`.

A **lista de Alertas** sai do corpo da Hoje. No lugar fica uma linha discreta "N alertas · ver", que abre a lista (fechada por padrão). O badge da aba continua igual.

### 2 + 6a. Equipe do supervisor (reforma da tabela)

Uma linha por membro da `leads_equipe`, colunas:

| Consultor | Atividade (6a) | Sem contato | Andamento | Parados 3+ dias | Retornos atrasados | Convertidos no mês | Conversão % | Receita |

- Os números **abrem a lista** daquele consultor naquela etapa (mesmo componente da 1a, com o consultor fixo).
- **Atividade (6a)**: bolinha + "ligou há 12 min · 34 hoje" e "OBS há 40 min · 9 hoje".
  - Última ligação e ligações hoje: `mesa_ligacoes_hoje` (`ultima`, `lig_total`).
  - Última OBS e OBS hoje: `leads_historico` acao `classificar`, `por` = consultor, onde `depois->>'obs'` não vazio e diferente de `antes->>'obs'`.
  - **Minutos parado** = agora − maior entre (última ligação, última OBS, hoje 13:00 SP). Verde < 30, amarelo 30–59, vermelho ≥ 60.
  - Fora do expediente (antes das 13h, depois das 21h, sábado e domingo): bolinha cinza "fora do expediente".
  - Rodapé da tabela: "Ligações chegam do ProContact de hora em hora; a última ligação pode estar até 1 h atrasada."
- `leads_equipe_resumo` ganha as colunas `andamento`, `parados_3d`, `ultima_ligacao`, `lig_hoje`, `ultima_obs`, `obs_hoje`. A conta do semáforo fica na tela (função pura testável). A tabela continua atualizando junto com os alertas.
- As colunas antigas que saem da vista: "Sem contato +15 min", "Perdidos sem ligação", "Pegos no mês", "1º contato" (continuam nos alertas da equipe, abaixo da tabela, que fica como está).

### 3. Filtros no Quadro (e na aba Todos)

Barra de filtros acima do Quadro, para todos. Cada opção mostra a contagem; os grupos se somam (E); dentro do grupo é uma escolha só; "Limpar" zera.

- **3a. Parado há:** hoje · 1–2 dias · 3–4 dias · 5+ dias. Dias corridos (SP) desde a última ação = maior entre `ultima_ligacao`, `classificado_em`, `pego_em`.
- **3b. Nunca ligado:** `ligacoes = 0`.
- **3c. Retorno:** atrasado · hoje · esta semana (até domingo).
- **3d. Perfil:** linhas (faixas da planilha em `qtd_linhas`) · tipo de empresa · cidade (listas montadas dos leads carregados).
- **3e. Origem:** campanha · formulário. `leads_kanban2` passa a devolver `campanha` e `formulario` (`campaign_name`, `form_name`).
- **3f. Mês:** pelo `aba` do lead (mês da planilha).
- **3g. Consultor:** o seletor que o gestor já tem.

Filtro feito na tela sobre os leads já carregados (sem consulta nova). A coluna Livres não é filtrada por 3a–3c (não tem dono). Os filtros escolhidos ficam guardados no navegador (`localStorage`, com try/catch).

### 4a. Aba "Todos"

Nova aba `todos` (consultor e gestor), entre Quadro e Equipe.

- Tabela: Nome · Etapa · STATUS (chip com a cor) · Último contato · Retorno · Linhas · Cidade · Pego em.
- Busca (nome, CNPJ, telefone, igual à pesquisa atual), ordenação clicando no cabeçalho, os mesmos filtros da seção 3, **50 por página**.
- Clique na linha abre a ficha.
- Consultor: só os dele (já é o que `leads_kanban2` devolve para ele). Gestor: os da equipe, com o seletor de consultor ("Todos" = todos os donos).
- Sem livres e sem apagados.

### 5a. Aviso de lead novo (só quem pode pegar)

- `leads_alertas` ganha o tipo **`lead_novo`**: lead livre (`dono_id is null`, `categoria = 'sem_contato'`, não apagado) criado há menos de 2 h, só para quem tem `pode_pegar` (o gestor não recebe).
- `kbAlertasParaNotificar` passa a incluir `lead_novo`. Texto: "Lead novo: <nome> · <linhas> linhas". Som (`alBip`) + aviso + notificação do Windows; clique abre a ficha.
- Ao abrir o painel, os leads novos que já estavam lá **não** apitam de uma vez: o primeiro carregamento só marca como vistos.
- **Título da aba do navegador** ganha o número de livres: "(3) Painel…".
- Tempo de chegada do aviso: até 10 s com o painel à vista, até 2 min minimizado/em outra aba. Com o painel fechado não chega (era a 5b, fora deste escopo).
- O lead some do alerta assim que alguém pega.

### 7. Copiar telefone

O "Copiar" da linha Telefone da ficha copia o número normalizado, pela mesma regra do `kbLigar`: só dígitos, sem o `55` do começo quando sobram 10 ou 11 dígitos. Ex.: `p:+5511999998888` → `11999998888`. E-mail e CNPJ continuam copiando o valor como está.

## Banco (resumo das mudanças)

Uma migration por bloco, aplicada com `execute_sql` em `begin/commit` (sem `drop`), com check em `supabase/tests/`:
1. `leads_equipe.pode_pegar` + marcar os 4 + `leads_pegar` com a trava.
2. `leads_hoje` + `pode_pegar` e `placar`.
3. `leads_alertas` + tipo `lead_novo`.
4. `leads_equipe_resumo` + colunas novas. A troca do tipo de retorno exige recriar a função: fazer com nome novo `leads_equipe_resumo2` para não precisar de `drop` (o conector falha com `drop`), e o painel passa a chamar a nova.
5. `leads_kanban2` + `campanha`, `formulario`: mesmo cuidado, `leads_kanban3`.

Funções antigas ficam no banco até a publicação estar estável (o painel do ar ainda chama as antigas durante a troca).

## Testes

- **Tela (jsdom, padrão dos `test_*.js`):** contas dos cartões; ordem do Faça agora; semáforo (dentro/fora do expediente, sábado, 13:00 como piso, limites 30/60); cada filtro e a soma deles; paginação e ordenação da aba Todos; esconder Livres/Pegar quando `pode_pegar` é falso; telefone copiado; primeiro carregamento não apita lead novo.
- **Banco (`supabase/tests/*.sql`):** `leads_pegar` recusa quem não pode e aceita os 4; `leads_redistribuir` continua aceitando qualquer membro; `lead_novo` só aparece para quem pode pegar; contas de `obs_hoje` (OBS igual à anterior não conta).
- Antes de publicar: contar `<div>`/`</div>`, conferir as outras abas do painel, comparar com o ar (MD5) e seguir o roteiro de publicação com o ok do Rafael.

## Fora do escopo

Notificação com painel fechado (5b), WhatsApp/e-mail (5c), ações em lote (4c), alertas da equipe novos (2b), velocidade (2c), ranking (2d), "ligou e não anotou" e afins (6b–6g), funil do mês (1d).
