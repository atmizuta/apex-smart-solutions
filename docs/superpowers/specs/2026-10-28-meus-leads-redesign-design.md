# Meus leads: redesign claro, moderno e intuitivo (design)

- **Data:** 28/10/2026
- **Pedido do Rafael:** "deixe a aba CLARA e bonita e intuitiva para todos os consultores e supervisores… clareza, ao mesmo tempo, modernidade e intuitividade… preciso mesmo de um redesign, mude tudo", em todas as abas de "Meus leads".
- **O que o Rafael aprovou (28/10):**
  - **Visual:** as telas do mockup Hoje, Quadro, Lista, Equipe e Ficha.
  - **Hoje:** a **ideia B**, lista com a ficha ao lado.
  - **Entrega:** o **caminho B**, em 3 fases, cada uma publicada só com o ok dele.
- **Seção do REGRAS:** §126 (reservada; a oficial vai até a §125). Cada fase publicada vira uma subseção: §126.1, §126.2 e §126.3.
- **Base:** specs da §112, da §118 e da §122 (`2026-10-26-leads-kanban-planilha`, `2026-10-27-meus-leads-hoje-equipe` e `2026-10-28-meus-leads-painel-hoje`), mais as §123.1, §124 e §125. O que este documento não muda continua valendo.
- **Mockups (locais, fora do repositório):** `.superpowers/brainstorm/395-1793217071/content/`.
  - `06-hoje.html`: a Hoje B, clicável.
  - `02-quadro.html`, `03-lista.html`, `04-equipe.html` e `05-ficha.html`: as outras telas.
  - `01-hoje-ideias.html`: as três ideias da Hoje.
  - `ml.css`: a linguagem visual.
  - Os dados dos mockups são inventados.
- **Referências que embasam as escolhas:**
  - **Close:** o "Next Call", que trabalha um lead por vez.
  - **Linear:** a fila "Focus", ordenada por urgência.
  - **HubSpot:** a fila com a ficha ao lado.
  - **Pipedrive:** o ícone de urgência no cartão.
  - **Attio, Twenty e folk:** a ficha que abre ao lado da lista, sem cobrir a tela, e as colunas recolhidas.
  - **NN/g:** o painel lateral em vez de janela por cima, e a cor que nunca aparece sozinha.

## 1. Objetivo

1. **O consultor trabalha em sequência, sem procurar.** A Hoje mostra a fila na ordem em que vale ligar, e a ficha já fica aberta ao lado. Ele liga, classifica e aperta "Salvar e ir para o próximo".
2. **Menos janelas.** O Classificar e o Redistribuir deixam de ser janelas por cima da tela. O Classificar passa para dentro da ficha, e o Redistribuir vira o menu "Passar para".
3. **Leitura em segundos.** Cada tela tem um assunto principal, e o que está atrasado aparece em vermelho, com ícone e texto. O resto fica calmo.
4. **O supervisor vê quem está parado e age na hora.** Ele vê a faixa de atenção, o mapa de ligações por hora e redistribui vários leads de uma vez.

## 2. Linguagem visual (vale para as 3 fases)

### 2.1 Escopo
- Muda **só a aba Meus leads**: o `#panel-meusleads`, a ficha (`#kbFicha`) e a janela flutuante dela.
- O shell **não muda**:
  - menu bordô, `#pageHead` e a faixa de sinal;
  - `ApexMotion`, `mostrarAviso` e `fecharOverlay`;
  - o bloco "SISTEMA VISUAL SINAL DE ÁPICE".
- As outras abas não mudam. A mudança desta aba foi pedida explicitamente, como exige o CLAUDE.md.
- **Fontes:** as mesmas, Barlow e Barlow Condensed.

### 2.2 Tokens da aba
- Ficam declarados em `#panel-meusleads, #kbFicha, .kbFichaPip { … }`, logo no começo do bloco CSS de Meus leads.
- Como pede o CLAUDE.md, **reaproveitam as variáveis do sistema** sempre que existe uma cor equivalente.
- Só dois tons são novos, e o hex deles aparece apenas na declaração do token: `--ml-ink-2` e `--ml-surface-2`.
- As cores de STATUS continuam como na §121. Os componentes usam só `var(--…)`.

| Token | Valor | Uso |
|---|---|---|
| `--ml-ink` | `var(--c-grafite)` | texto principal |
| `--ml-ink-2` | `#464A4E` (novo) | texto secundário (contraste ≈ 9:1 no branco); o `--c-cinza` some demais para texto de leitura |
| `--ml-ink-3` | `var(--c-cinza)` | texto de apoio (≈ 5,7:1 no branco) |
| `--ml-ground` | `var(--c-papel)` | fundo da aba |
| `--ml-surface` | `var(--c-branco)` | blocos, cartões, ficha |
| `--ml-surface-2` | `#F7F7F8` (novo) | degrau de tom dentro de um bloco (contato, OBS anterior, cabeçalho de tabela) |
| `--ml-surface-3` | `var(--c-cinza-claro)` | trilho dos controles segmentados, separadores finos de lista |
| `--ml-late` / `--ml-late-soft` | `var(--c-sinal-600)` / `var(--st-perdido-bg)` | atrasado |
| `--ml-soon` / `--ml-soon-soft` | `var(--st-andamento)` / `var(--st-andamento-bg)` | atenção (nunca ligado, parado) |
| `--ml-ok` / `--ml-ok-soft` | `var(--st-ganho)` / `var(--st-ganho-bg)` | retorno de hoje, ligação atendida (o único verde, como manda o CLAUDE.md) |
| `--ml-novo` / `--ml-novo-soft` | `var(--c-sinal)` / `var(--c-rosa)` | lead novo |
| `--ml-float` | `var(--shadow-lg)` mais leve: `0 12px 32px rgba(29,31,32,.16)` | só para o que flutua: gaveta, menu, cartão arrastado |

### 2.3 Regras
- **Superfícies.**
  - Os blocos se separam por **degrau de tom**, sem borda e sem sombra em coisa parada.
  - Sombra só no que flutua: gaveta da ficha, menu "Passar para", cartão sendo arrastado e aviso.
  - Raios: 12 px nos blocos, 10 px nos cartões e 8 px nos botões e campos.
- **Cor.**
  - O vermelho Apex aparece só no botão principal de cada tela e no que está **atrasado**.
  - Urgência **sempre com cor, ícone e texto juntos**, por exemplo "⏱ retorno era às 14:00".
- **Tipo.**
  - Rótulos em frase normal. Sai a caixa alta pequena com espaçamento.
  - Barlow no texto. Barlow Condensed só nos números grandes, no nome do lead na ficha e na hora da fila.
  - Números com `tabular-nums`.
- **STATUS.**
  - Nos cartões e linhas aparece um **ponto com a cor da planilha** e o texto em frase normal ("Agendado retorno"). A conversão do texto aproveita o `bonito()` que já existe dentro de `kbAbrirClassificar`, extraído para a função pura `kbStTexto`.
  - O **chip colorido cheio** fica só na ficha e nos botões de classificar.
  - O ponto usa a cor forte da tabulação, um novo token `--kb-st-dot` por `data-st`. O fundo e a letra do chip continuam como na §121.
- **Barra da aba (Fase 1):**
  - **controle segmentado** Hoje · Quadro · Lista, com Equipe primeiro para o gestor, e os contadores de alerta como hoje;
  - à direita, a **busca** ("Buscar lead por nome, CNPJ ou telefone", atalho `/`) e, para o gestor, o seletor de consultor;
  - no lugar do cartão `.kbTopo` e das pílulas `.kbAbas`.
  - Ficam como estão hoje: "Só divergências" e "Reescrever planilha" (admin), num menu "⋯" ao lado do seletor, e o aviso `.kbAviso`.
  - A aba "Todos" passa a se chamar **"Lista"** na Fase 2. Até lá continua "Todos".
- **Movimento.** Só transform e opacity, entre 150 e 300 ms. O lead que sai da fila desliza e some. Com `prefers-reduced-motion`, nada se move.
- **Tela estreita (< 900 px).** A fila e a ficha da Hoje ficam uma embaixo da outra. O Quadro mantém a rolagem lateral.

## 3. Fase 1: ficha nova e Hoje B

### 3.1 Ficha do lead (um componente, dois lugares)
- `kbFichaHtml` é reescrita e passa a ser usada em três lugares:
  - **painel da direita da Hoje**;
  - **gaveta lateral**, aberta pelo Quadro, pela Lista, pela Equipe, pela busca e pelos alertas, com 560 px de largura e presa de cima a baixo;
  - **janela flutuante** (PiP), que continua existindo.
- **Barra do topo:**
  - "N de M" (posição na fila ou na lista de onde veio);
  - ↑ ↓ para lead anterior e próximo;
  - Flutuar;
  - "⋯": para o gestor, Redistribuir e Apagar do painel, que hoje são botões;
  - Fechar, só na gaveta.
- **Cabeçalho:**
  - marcador de urgência:
    - "retorno era às 14:00" e "retorno hoje às 15:30";
    - "lead novo · você pegou há 6 min";
    - "classificado, mas nunca ligado" e "parado há 4 dias";
  - nome;
  - chip do STATUS, ou "Sem status" e "Livre";
  - cidade/UF, linhas e origem ("chegou 24/10 pelo Facebook");
  - os selos que já existem: "para resgatar" e "✓ venda no NEO".
- **Contato** (bloco em tom):
  - **telefone grande** com Copiar;
  - **Ligar**: copia o número e abre a aba do ProContact, como hoje (§121);
  - **WhatsApp**, com a mensagem de hoje;
  - e-mail e CNPJ, cada um com Copiar.
  - Livre sem contato (consultor):
    - mostra a prévia (tipo, linhas, campanha, quando chegou) e "Celular, e-mail e CNPJ aparecem quando você pega o lead", com **"Pegar este lead"**;
    - quem não pode pegar vê "Você não está liberado para pegar leads".
- **Resumo:** o resumo de ligações (`leads_ficha_detalhes.resumo`) e a **última OBS** com data, num bloco em tom.
- **Abas da ficha:**
  - **Classificar**, aberta por padrão;
  - **Histórico**, a linha do tempo inteira de `leads_ficha_detalhes`;
  - **Anúncio**, os detalhes do anúncio.
  - Um resumo "Últimos contatos" (4 eventos) fica no fim da aba Classificar.
- **Classificar dentro da ficha** (sai a janela `#kbClassOverlay`):
  - **Grupos:** as opções vêm de `leads_status_opcoes`, como hoje, separadas por `grupo`. Os nomes na tela mudam:
    - `andamento` vira "Em andamento";
    - `convertido` vira "Venda";
    - `perdido` vira "Sem resposta ou perdido", com os botões mais apagados até serem escolhidos.
  - **AGENDADO RETORNO** abre "Quando ligar de novo?":
    - atalhos Hoje 17h, Amanhã 10h, Amanhã 14h, Em 3 dias e Próxima semana (segunda às 10h);
    - campos de data e hora;
    - o "Hoje 17h" some depois das 17h;
    - a mesma validação de hoje (`kbValidar`).
  - **Grupo Venda** abre Receita e Converteu, com o aviso do NEO, tudo pré-preenchido como hoje.
  - **OBS:**
    - campo vazio, com a última OBS mostrada acima dele;
    - **com o campo vazio, a OBS atual é mantida** (`p_obs` recebe a OBS de antes);
    - com texto, o texto novo vira a OBS. A anterior continua no Histórico (`leads_historico`).
  - **Rodapé fixo:**
    - na Hoje, **"Salvar e ir para o próximo"** e "Só salvar";
    - na gaveta, **"Salvar"**;
    - nos dois lugares, `Ctrl+Enter`.
    - Erros aparecem embaixo do campo, sem `alert()`.
  - **Salvar** usa as mesmas RPCs de hoje: `leads_classificar` e depois `leads_agendar_retorno` com a hora. Em seguida:
    - aviso com o resultado ("Salvo. Padaria Bom Grão → Agendado retorno, amanhã 10:00. A planilha atualiza em segundos.");
    - `agAvisarMudou()`;
    - recarga como hoje.
  - Os botões "Retorno amanhã" e "Em 3 dias" da ficha atual passam a ser os atalhos do bloco de retorno.
- **Arrastar no Quadro** continua:
  - Livres → Meus novos **pega direto**;
  - meu lead para outra coluna **abre a gaveta na aba Classificar**, rolada até o grupo daquela coluna (`kbGrupoDaColuna`), sem salvar nada sozinho.
- **Teclado:**
  - ↑ ↓ trocam de lead quando o foco não está num campo de texto;
  - `Esc` fecha a gaveta;
  - `Ctrl+Enter` salva.
- **Atualização a cada 10 s** (laço de versão da §120): a ficha aberta **não é redesenhada** enquanto houver texto digitado na OBS ou um status escolhido e ainda não salvo. Só o resto da tela atualiza.

### 3.2 Hoje B
- **Topo:**
  - saudação ("Boa tarde, Caio.") e data;
  - **placar** com quatro números:
    - ligações hoje / meta, de `meu_placar_ligacoes`, com barra;
    - classificados hoje e "N de M retornos cumpridos", de `leads_hoje.placar`;
    - vendas no mês com a receita, de `kbResumoMes`.
- **Área de trabalho na altura da tela:** **fila** à esquerda (380 px) e **ficha** à direita (3.1).
- **Abas da fila:**
  - **Fazer agora**, com contador;
  - **Livres**, só para quem vê livres (`kbVeLivres`);
  - **Alertas**.
- **Fazer agora** é montada pela função pura nova `kbFilaHoje(leads, retornos, agoraMs)`. Ela usa os dados que já chegam (`leads_kanban3` e `leads_hoje.retornos`). Cada lead aparece **uma vez**, no primeiro grupo em que se encaixar, e só entram os leads em aberto (Meus novos, Sem ligação e Em andamento):

  | Ordem | Grupo | Quem entra | Ordem dentro | Coluna da esquerda |
  |---|---|---|---|---|
  | 1 | **Atrasados** | retorno vencido (`vencido`) | o mais antigo primeiro | hora, "ontem" ou dd/mm, em vermelho |
  | 2 | **Agora** | lead pego e sem status (Meus novos) + retorno de hoje nos próximos 60 min | os novos primeiro, pela hora em que foram pegos; depois os retornos, pela hora | "novo" (vermelho) ou a hora |
  | 3 | **Mais tarde hoje** | os outros retornos de hoje | pela hora | a hora |
  | 4 | **Nunca ligados** | classificado com 0 ligações (= coluna Sem ligação) | o pego há mais tempo primeiro | "—" |
  | 5 | **Parados há 3 dias ou mais** | em aberto e sem ação há 3 dias ou mais (`kbDiasParado ≥ 3`) | o parado há mais tempo primeiro | "N d" |

  - Cada linha mostra o nome, o STATUS em texto e as linhas.
  - "Para resgatar" (perdidos esfriando) **não entra**: continua no Quadro, com o selo.
- **Seleção:**
  - ao abrir, fica selecionado o primeiro item;
  - **"Salvar e ir para o próximo"** seleciona o item seguinte na ordem da fila;
  - o lead salvo que ainda se encaixa em algum grupo continua na lista, com o status novo, e o que não se encaixa mais sai deslizando.
- **Livres:**
  - botão **"Pegar o próximo livre"**, que pega o mais antigo (`kbPegarProximoLivre`);
  - a lista vai do mais antigo para o mais novo;
  - clicar num lead mostra a prévia à direita;
  - "Pegar este lead" chama `leads_pegar`, e o lead entra em "Agora", já selecionado, com o aviso "Lead pego. Ligue agora.".
- **Alertas:**
  - a lista de `leads_alertas`, com etiqueta do tipo, nome e detalhe;
  - clicar seleciona o lead na fila; se ele não estiver na fila, abre a ficha dele à direita.
- **Tudo em dia** (fila vazia):
  - "Tudo em dia, Caio. Nenhum retorno vencido e nenhum lead sem ligação.";
  - o próximo retorno futuro (o menor `retorno_em` depois de agora, se houver);
  - "Pegar o próximo livre (N esperando)".
- **Gestor na Hoje:**
  - vê a fila do consultor escolhido no seletor;
  - com "Todos", vê um aviso "Escolha um consultor para ver a fila dele".
  - O que o gestor pode fazer na ficha continua igual a hoje.
- **O que sai da Hoje atual (§122):**
  - os cartões por etapa, o "Faça agora (até 5)" e o bloco "Seu dia";
  - o "Próximo lead", que vira a própria fila;
  - o placar continua, no topo.

### 3.3 Testes da Fase 1
- **Funções puras**, em `test_leads_painel_hoje.js` ou num `test_meus_leads_redesign.js` novo:
  - `kbFilaHoje`: grupos, ordem, cada lead uma vez, o que fica de fora, a borda dos 60 min e os 3 dias;
  - o próximo item depois de salvar;
  - `kbStTexto`;
  - o "Hoje 17h" que some depois das 17h;
  - OBS vazia mantém a anterior;
  - o grupo que o arrastar destaca.
- **jsdom:**
  - a Hoje desenha a fila e a ficha;
  - clicar num status mostra os blocos certos;
  - `Ctrl+Enter` chama `leads_classificar` com os parâmetros certos;
  - a ficha não é redesenhada com OBS digitada;
  - arrastar abre a gaveta e não salva;
  - Livres → Pegar.
- Os testes atuais de Meus leads continuam passando, ajustados só onde a marcação mudou de propósito (modal → ficha).

## 4. Fase 2: Quadro e Lista

### 4.1 Quadro
- **Colunas sem caixa:** no cabeçalho, marcador de cor, nome, contagem, um subtítulo curto que explica a coluna e a ação da coluna. Os subtítulos:
  - Livres: "Arraste para Meus novos ou clique em Pegar";
  - Sem ligação: "Classificados, mas ninguém ligou ainda";
  - Meus novos: "Pegos por você, ainda sem status";
  - Em andamento e Sem resposta: "Pela chegada do lead".
- **Livres:** a coluna fica em fundo de tom, com "Pegar próximo" no cabeçalho. Os cartões mostram nome, cidade, linhas, há quanto tempo chegou (com cor pela idade) e "Pegar".
- **Cartão** em três níveis:
  1. nome;
  2. cidade · linhas, e o STATUS (ponto e texto);
  3. a OBS em 2 linhas e um rodapé com a etiqueta de retorno, a última ligação (verde se atendida, com a duração) e "há N d" de chegada (§125).
- **Ícone de urgência** no canto, só nos leads em aberto: vermelho para retorno atrasado, verde para retorno hoje, cinza para retorno marcado e amarelo para nada agendado.
- **Faixa vermelha à esquerda** só no que precisa de ação agora: retorno vencido, novo sem contato há mais de 15 min (`kbAtrasado`) ou Sem ligação pego há mais de 1 dia.
- **Ações ao passar o mouse** (Ligar, WhatsApp). Clicar no cartão abre a gaveta.
- Para o gestor, o cartão mostra as iniciais do dono.
- **Convertido e Perdido ficam recolhidos por padrão:** uma faixa de 52 px com a cor, o nome e a contagem (no Convertido, também a receita). Clicar abre. A escolha fica guardada no navegador.
- **Filtros:**
  - viram botões compactos que abrem uma lista: Retorno, Parado há, Nunca ligado, Linhas, Cidade, Campanha e Mês;
  - os filtros ativos ficam escuros, com o valor e um "×";
  - a lógica continua a mesma (`KB_FILTROS`, `kbFiltrar`), assim como o que fica guardado em `localStorage.kbFiltros`.
- **Densidade:** Confortável ou Compacto. O Compacto esconde a OBS e a última ligação. A escolha fica guardada no navegador.
- **Continua igual:**
  - o desempenho da §120: `content-visibility`, redesenho só da coluna que mudou, 100 cartões por coluna e "Ver mais";
  - a ordem e o botão "↑ Mais antigo / ↓ Mais novo" da §125;
  - o arrastar, com a área "Solte aqui para pegar este lead" na coluna Meus novos.
- A barra de pílulas de navegação entre colunas (`.kbNavQuadro`) **sai**, porque com as colunas recolhidas o quadro cabe melhor. A rolagem lateral continua.

### 4.2 Lista (ex-Todos)
- A aba passa a se chamar **Lista** (com a mesma chave interna `todos`).
- **Visões prontas** com contagem: Todos, Em aberto, Retornos, Sem ligação, Sem resposta, Convertidos e Perdidos. À direita, "Mês" e "Filtros" (o mesmo menu do Quadro).
- **Tabela:**
  - linhas de 52 px e cabeçalho fixo em tom;
  - colunas:
    - Empresa (nome; cidade · campanha);
    - Etapa (marcador de cor);
    - STATUS (ponto);
    - Último contato (quando; atendida e duração);
    - Próximo retorno (etiqueta de urgência);
    - Linhas;
    - Pego em;
    - para o gestor, Consultor.
  - Ligar e WhatsApp aparecem ao passar o mouse na linha.
- Mantém a ordenação por clique no cabeçalho, as 50 linhas por página e a busca local.
- Ganha a densidade.
- Clicar numa linha **abre a gaveta**, e a lista continua à vista.

### 4.3 Testes da Fase 2
- Ícone de urgência (função pura), regra da faixa vermelha, visões da Lista (contagens) e recolher/densidade guardados.
- **jsdom:**
  - o Quadro desenha as colunas recolhidas;
  - o filtro em botão aplica o mesmo resultado de antes;
  - a §125 continua (a ordem não muda ao reclassificar).

## 5. Fase 3: Equipe

### 5.1 Tela
- **Cinco números no topo**, clicáveis (abrem a lista daquele grupo, como faz o `kbEstado.equipeLista`):
  1. ligações da equipe hoje / meta, com barra. A meta é a `meta_ligacoes_dia` (a mesma do `meu_placar_ligacoes` e das metas do Monitoramento) × consultores com telefonia;
  2. leads livres, com o mais antigo;
  3. pegos e sem contato;
  4. retornos atrasados;
  5. vendas no mês, com a receita.
- **Faixa "precisa de atenção"**, uma por consultor com semáforo vermelho:
  - ex.: "Lucas está há 1 h 12 min sem ligar nem escrever OBS e tem 4 leads sem contato";
  - botões **"Ver os leads dele"** e **"Redistribuir N"**, que abre a seleção em lote já com os sem contato dele.
- **Tabela por consultor:**
  - iniciais e nome, com "pega leads" ou "só os que já tem" (`pode_pegar`);
  - **Agora**, o semáforo escrito: "ligou há 4 min", "OBS há 9 min", "parado 38 min", "parado 1 h 12", "sem telefonia" ou "fora do expediente";
  - **Ligações por hora, das 13h às 21h:** oito quadradinhos com intensidade, e as horas que ainda não chegaram vazadas;
  - **Hoje**, ligações / meta com barra (vermelha abaixo de 30% da meta proporcional à hora, verde acima de 70%);
  - Sem contato, Em andamento, Parados 3+ d, Retornos atrasados, Vendas no mês e Conversão;
  - os números abrem a lista, e os que indicam problema ficam em vermelho quando > 0;
  - legenda do semáforo embaixo, como hoje.
- **Alertas em três blocos lado a lado:**
  - Pegos e sem contato (com "Passar");
  - Retornos atrasados (com "Abrir");
  - Perdidos sem nenhuma ligação (com "Abrir").
  - "Parado em andamento" entra no número Parados 3+ d da tabela, e "lead novo" entra no número de Livres.

### 5.2 Redistribuir
- **Em lote:**
  - caixas de seleção nas listas da Equipe (lista aberta por número e faixa de atenção);
  - **barra escura** com "N leads selecionados", **Devolver aos livres** (só para lead sem status, a regra de hoje) e **Passar para…**.
- **Menu "Passar para"** (sai a janela `#kbRedOverlay`):
  - os consultores da `leads_equipe`, menos o dono atual, cada um com "N em andamento";
  - o de menor carga leva o selo **"menos carga"** e vem marcado;
  - opção **"Dividir igual entre os que pegam"**: entre os `pode_pegar`, sempre para quem estiver com menos carga naquele momento;
  - botão "Passar para Luria".
- **Execução:**
  - `leads_redistribuir` lead a lead, em sequência, com progresso ("Passando 2 de 4…");
  - no fim, o resultado ("4 de 4 passados", ou a lista dos que falharam);
  - depois, `agAvisarMudou()` e recarga.
- **Redistribuir um lead só** (no "⋯" da ficha e no "Passar" dos alertas) usa o mesmo menu.

### 5.3 Banco (a única mudança de banco do redesign)
- Função nova **`leads_atividade_equipe2()`**: a mesma saída de `leads_atividade_equipe()`, mais `lig_por_hora int[]`.
  - São 8 posições, das 13h às 20h, no horário de SP.
  - A conta é igual à de hoje: `ligacoes_manuais` por `usuario_telefonia`, `gerada_em` desde o começo do dia em SP.
  - Mesma checagem de papel (admin/supervisor), `security definer`, `search_path = public`, `revoke` de public/anon e `grant` para authenticated.
- **Sem DROP:** a função antiga continua até uma limpeza futura (o conector do Supabase falha com DROP; ver memória do projeto).
- Migration `supabase/migrations/<data e hora da Fase 3>_leads_atividade_equipe2.sql` (mesmo padrão de nome das outras), com check em `supabase/tests/leads_atividade_equipe2_check.sql`: a soma das horas ≤ `lig_hoje`, e consultor sem telefonia sai com o array zerado.
- **Aplicada só com o ok do Rafael** (Supabase é produção).

### 5.4 Testes da Fase 3
- Funções puras:
  - sugestão "menos carga";
  - divisão igual (round-robin pela menor carga, com empate em ordem alfabética);
  - cor da barra de ligações;
  - faixa de atenção (quem entra).
- **jsdom:**
  - o lote chama `leads_redistribuir` N vezes, em sequência;
  - uma falha parcial aparece na lista;
  - o menu "Passar para" substitui a janela.

## 6. O que não muda (nenhuma fase)
- **Regras de pegar:**
  - só `pode_pegar`;
  - trava no banco;
  - telefone, e-mail e CNPJ escondidos nos Livres.
- **Dados:**
  - as RPCs atuais e a planilha-espelho;
  - o laço de versão de 10 s e o de 60 s do gestor;
  - as notificações de lead novo e o contador no menu e no título.
- **Ficha:** a ficha flutuante (PiP), o aviso de divergência com o NEO, Apagar e restaurar, e a busca (`leads_buscar`).
- **Quadro:**
  - os filtros guardados;
  - as colunas Sem ligação (§121) e Sem resposta (§123.1);
  - a ordem por chegada (§125).
- **Admin:** "Reescrever planilha" e "Só divergências".

## 7. Publicação, uma vez por fase
1. Antes de começar a fase, `git fetch oficial` e um worktree novo a partir de `oficial/main`. Outras sessões mexem nessa aba todo dia.
2. Testes com `bash run_tests.sh`, depois `python build_painel.py`.
3. **Prévia para o Rafael**, com prints do painel gerado, e um ok explícito.
4. Publicar como manda a memória de publicação:
   - comparar com o painel no ar e juntar, nunca sobrescrever;
   - backup e MD5 no mesmo comando;
   - vigia `-Aceitar`.
5. Registrar a §126.N no REGRAS, fazer o commit e dar push na `oficial/main`, sem force.
6. Contar `<div>` e `</div>` e abrir outra aba do painel antes de publicar (memória "divs balanceadas").
7. Nada de dado real de cliente no repositório. Os mockups ficam fora dele.

## 8. Riscos e cuidados
- **Conflito com outras sessões:** fases pequenas e `fetch` antes de cada merge. As funções puras novas ficam separadas das antigas, para o diff ficar legível.
- **A equipe estranhar a mudança:** o Rafael avisa o time antes de cada fase. As mudanças de nome são "Todos" → "Lista" e o Classificar, que passa para dentro da ficha.
- **Perder o que o consultor digitou:** a ficha não é redesenhada com OBS ou status pendentes (3.1).
- **Desempenho:** a fila da Hoje reaproveita os dados já carregados, sem consulta nova. O Quadro mantém as técnicas da §120.

## 9. Decisões tomadas no design (o Rafael confirma na revisão desta spec)
1. **OBS:** com o campo vazio, a OBS atual é mantida; com texto, o texto novo substitui a anterior, que fica no Histórico.
2. **"Para resgatar"** fica fora da Hoje e continua no Quadro.
3. **Parados** só entram na Hoje com **3 dias ou mais** (hoje o "Faça agora" usa 1 dia).
4. **Convertido e Perdido** ficam recolhidos por padrão no Quadro.
5. **"Agora"** inclui os retornos da **próxima 1 hora**.
