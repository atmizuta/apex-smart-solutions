# Regras de Negócio — Painel de Clientes Apex

Documento vivo. Toda vez que uma regra de negócio do sistema for criada, alterada ou removida, atualize esta página (e registre no changelog no final). É a referência para treinamento de consultores, ajustes futuros e documentação do próprio sistema.

Última atualização: 23/09/2026 (seção 30)

---

## 1. Visão geral

SaaS interno da Apex Smart Solutions (reseller/canal Claro Empresas) para consultores de vendas: consultar a base de clientes, gerar propostas comerciais de renovação/upsell em PDF e acompanhar as negociações em um funil de vendas (kanban), com dados compartilhados entre todos os usuários (backend Supabase).

### 1.1 Área de atuação (regional) — importante

A Apex só vende nas regiões **RSC (São Paulo Capital)** e **RSI (São Paulo Interior)**, que correspondem aos **DDDs 12 a 19**. As demais regiões citadas no book de ofertas (RRS, RRE, RCO, RNO, RMG, RPS, RBS, RNE) **não são atendidas pela Apex** — mesmo quando uma oferta regional do book cobre essas regiões, ela não deve ser oferecida se não incluir DDD 12-19.

Isso afeta diretamente quais ofertas móveis regionais aparecem no sistema (ver seção 5): quando uma faixa de DDD do book inclui RSC/RSI, a oferta é mantida (marcada com os DDDs 12-19); quando não inclui, a oferta é **removida** da lista — não faz sentido mostrar pro consultor uma oferta que a Apex não pode vender.

## 2. Perfis de acesso

| Perfil | Busca de clientes | Gerar proposta | Funil de vendas | Verificar Cobertura | Dashboard de Produção | Aba "Digital" | Aba "Consultores"/Usuários | Aba "Base de dados"/Upload Base | Aba "Movimentação da Base"/Upload Dash | Criar/gerenciar usuários |
|---|---|---|---|---|---|---|---|---|---|---|
| Consultor | Sim | Sim | Só os próprios cards | Sim | Sim (sem Cliente/CNPJ — LGPD, ver 16.4) | Sim (01/09/2026) | Não | Não | Não | Não |
| Supervisor | Sim | Sim | Todos os cards, de todo mundo | Sim | Sim (com Cliente/CNPJ) | Sim | Sim (visualizar equipe, resetar senha) | Não | Não | Só consultor |
| Admin | Sim | Sim | Todos os cards, de todo mundo | Sim | Sim (com Cliente/CNPJ) | Sim | Sim | Sim | Sim | Admin, Supervisor e Consultor |

- Login por usuário/senha próprios (sem depender de e-mail real do consultor); o sistema converte o usuário digitado em um e-mail interno (`usuario@apexclientes.com`) só para autenticação no backend.
- O primeiro usuário criado no sistema (bootstrap) sempre vira Admin automaticamente. Depois disso, só Admin/Supervisor logado pode criar novos usuários.
- Admin pode alterar seu próprio login/senha e criar outros Admins.

### 2.1 Consultor ganhou acesso a quase todas as abas (01/09/2026)

Antes, várias abas do menu principal eram restritas a Admin/Supervisor. A pedido do usuário, o Consultor passou a ver **todas as abas e conteúdos, exceto três**: "Upload Base", "Upload Dash" e "Usuários" (essas três continuam só pra Admin — Supervisor também não vê as duas primeiras, só "Usuários"). Na prática, a única mudança de comportamento foi a aba **"Digital"** (seção 17), que era restrita a Admin/Supervisor e passou a ficar visível pro Consultor também — incluindo o desempenho individual por consultor (o usuário confirmou explicitamente que queria essa visão liberada, mesmo mostrando o desempenho de outros consultores). As demais abas (Dashboard de Produção, Buscar Clientes, Cobertura, Gerar Proposta, Funil) já eram visíveis a qualquer perfil, sem mudança.

**Exceção mantida deliberadamente**: as colunas Cliente/CNPJ no detalhamento (drilldown) do Dashboard de Produção continuam restritas a Admin/Supervisor (regra de LGPD, seção 16.4) — o usuário confirmou explicitamente que essa restrição deve continuar, mesmo com a liberação geral das outras abas.

Implementação: a função `canSeeConversao()` passou a incluir `role === 'consultor'`, e a política de RLS `leads_select` (tabela `leads`, que alimenta a aba Digital) foi atualizada no Supabase pra liberar select também pro perfil consultor (antes só `admin`/`supervisor`).

**Ver os dados não é o mesmo que sincronizar**: o botão "Atualizar agora" da aba Digital (seção 17.1) dispara a Edge Function `sync-leads`, que já recusa (403) quem não é admin/supervisor — isso foi mantido de propósito, porque é uma ação de gestão de dados (busca a planilha do Google e grava no banco), no mesmo espírito de "Upload Base" e "Upload Dash", que continuam só pro admin. Criada a função `canSyncConversao()` (admin/supervisor) só pra esconder esse botão do consultor — sem essa checagem, o botão apareceria pra qualquer um mas sempre daria erro de permissão pro consultor, o que seria uma experiência ruim.

## 3. Busca de clientes

- Campos pesquisáveis: razão social, CNPJ, telefone (contato, tel1, tel2). E-mail e nome do administrador foram removidos da busca — geravam muitos resultados "aleatórios" em buscas curtas, por baterem em campos numéricos/alfanuméricos longos sem relação aparente com o card exibido.
- O casamento é sempre por sequência contígua de caracteres (equivalente a `ILIKE '%termo%'` no Postgres) — nunca por caracteres soltos em qualquer ordem. Ex.: buscar "234" só encontra clientes que tenham "234" em sequência em algum dos campos acima, nunca clientes que só têm os dígitos 2, 3 e 4 espalhados.
- A busca só é disparada com no mínimo 3 caracteres digitados (evita buscas amplas/pesadas com 1-2 caracteres).
- Toda consulta é registrada em log (usuário, termo buscado, data/hora).
- O log de consultas só é visível para Admin e Supervisor (por consultor, com total e última consulta).
- Ao atingir exatamente 21 consultas, o consultor recebe um alerta único informando que o uso é monitorado. O uso não é bloqueado.

### 3.0.1 Busca por CNPJ funciona com ou sem formatação (24/08/2026)

O CNPJ é sempre salvo formatado na base (`XX.XXX.XXX/XXXX-XX`, via `cleanCNPJ()` no upload — ver seção 6), independente de como ele apareceu na planilha original (com ou sem pontuação, ou repetido em colunas diferentes com formatos diferentes). Antes, se o consultor digitasse o CNPJ só com números (sem pontos/barra/traço), a busca não encontrava o cliente, porque comparava o texto digitado direto contra o valor formatado salvo. Corrigido com uma coluna gerada no banco, `cnpj_digits` (só os dígitos do CNPJ, recalculada automaticamente pelo Postgres sempre que `cnpj` muda), incluída como mais um alvo de busca quando o termo digitado tiver pelo menos 4 dígitos. Funciona pra CNPJ completo ou parcial (ex.: só a raiz, sem filial/DV), com ou sem pontuação.

### 3.1 Filtros de busca (pílulas: Apto / Não apto / Cabeado)

- Abaixo do campo de busca ficam 3 pílulas sempre visíveis (não é um menu escondido) — **Apto**, **Não apto** e **Cabeado** — que o consultor liga clicando; clicar de novo desliga.
- **Apto e Não apto são mutuamente exclusivos**: clicar em um desliga o outro automaticamente (não faz sentido os dois ligados ao mesmo tempo). **Cabeado é independente** e pode ficar ligado junto com qualquer um dos dois (ex.: "Apto + Cabeado" mostra só quem bate os dois critérios).
- Os filtros são aplicados **em cima do resultado que a busca por texto já trouxe** (client-side, sem nova consulta ao banco) — por isso só têm efeito quando já existe uma busca de pelo menos 3 caracteres em andamento (mesma regra da seção 3); não é uma forma de listar toda a base sem digitar nada.
- O contador abaixo do campo de busca passa a mostrar a contagem já filtrada (ex.: "2 resultado(s) com o filtro aplicado (de 5 resultado(s) encontrado(s))").
- **Pendência conhecida**: não existe filtro de GPON/HFC ainda — essa informação de tipo de rede só existe nos arquivos KMZ de cobertura (usados na aba "Verificar Cobertura"), não como uma coluna da base de clientes. Adicionar esse filtro exigiria cruzar o CEP de cada cliente do resultado com os pontos de rede do KMZ (geocodificação), o que pode deixar a busca mais lenta — decisão adiada a pedido do usuário (12/08/2026).

## 4. Motor de proposta comercial

Ponto de partida: comparar o que o cliente paga hoje (`valor_contrato`) com uma proposta nova, sempre buscando o melhor resultado comercial (menor aumento possível, podendo até reduzir a fatura) sem nunca cancelar linha existente.

### 4.1 Renovação — opcional (ligada por padrão), com múltiplos planos

- Por padrão, a proposta assume que **todas as linhas de voz já existentes na base do cliente (`linhas_voz`) serão renovadas** (nenhuma linha é tratada como cancelável ou substituível — todas migram para a(s) oferta(s) de renovação escolhida(s)).
- **O consultor pode desligar a renovação** (checkbox "Renovar as linhas já existentes do cliente") quando o cliente não quiser trocar o plano atual. Nesse caso, a proposta passa a considerar só incremento e/ou fibra, mantendo o valor das linhas existentes igual ao atual — útil para clientes que só querem adicionar 1+ linhas e/ou banda larga sem mexer no plano de voz vigente.
- **A renovação pode ser dividida entre vários planos, com quantidade de linhas personalizável por plano** (mudança de 21/08/2026, mesmo padrão já usado no incremento — ver 4.2): o consultor informa, por exemplo, "10 linhas de 20GB" + "20 linhas de 10GB" num cliente com 30 linhas de voz, em vez de um único plano igual pra toda a base. Cada grupo tem oferta + quantidade (`renewGrupos`); o valor da renovação é oferta × quantidade, somado entre todos os grupos. A tela mostra o total já alocado (soma das quantidades dos grupos) frente ao total de linhas de voz do cliente, pra o consultor conferir se bateu.
- Por padrão nasce **1 grupo já sugerido automaticamente** com a quantidade igual ao total de `linhas_voz` do cliente, usando a mesma lógica de sugestão de antes (mais barata quando o incremento está ligado, ou a "melhor renovação" quando não está). O consultor usa "+ Adicionar plano de renovação" para dividir em mais planos e "Remover" para tirar um grupo (só aparece quando há mais de um).
- A oferta de renovação escolhida **pode ser mais barata que o valor atual do cliente** — isso é desejável, não um problema: o sistema busca minimizar o custo da renovação (ou até reduzi-lo), já que a receita adicional vem do incremento (ver 4.2).
- O consultor pode trocar manualmente, em cada grupo, a oferta de renovação sugerida pelo sistema.
- Ligar/desligar o incremento **não reseta mais a divisão de planos de renovação já feita** pelo consultor — a sugestão automática só entra quando `renewGrupos` ainda estiver vazio.
- Ao aplicar um combo de "Destaques Convergentes" (ver 4.4.2) com a renovação ligada, o combo ajusta a oferta do **primeiro** plano de renovação, preservando os demais planos já configurados.

### 4.2 Incremento — linha(s) extra(s), composição de receita

- Incremento é uma ou mais linhas **adicionais** vendidas junto com a renovação, para compor receita/comissão. Não substitui nem reduz as linhas existentes.
- Ligado por padrão (`incluirIncremento = true`), mas o consultor pode desligar.
- **Suporta múltiplos incrementos por proposta** (ex.: cliente com 10 linhas pode renovar as 10 + adicionar 1 ou 2 incrementos). O consultor usa "+ Adicionar incremento" para incluir mais linhas e "Remover" para tirar.
- **Cada incremento é um grupo com quantidade de linhas, não uma linha por vez** (mudança de 12/08/2026): o consultor informa direto "10 linhas de 20GB" num único grupo, em vez de adicionar 10 linhas idênticas uma a uma. Cada grupo tem oferta + quantidade; o valor do incremento é oferta × quantidade, somado entre todos os grupos. Ex.: "10 linhas de 40GB" + "20 linhas de 12GB" são só 2 grupos, exibidos assim (agrupados) na tela, no PDF e no resumo — nunca linha a linha.
- **A fatura total pode cair mesmo somando incremento(s)**, se a economia obtida na renovação (ver 4.1) for maior que o custo do(s) incremento(s) somado(s). Esse é um resultado válido e esperado do modelo — não indica erro de cálculo.
- Cada incremento pode opcionalmente usar ofertas exclusivas de portabilidade (Pág. 59), habilitadas por um checkbox à parte que afeta a lista de ofertas disponíveis para todas as linhas de incremento da proposta.

### 4.3 Meta de comissão de 10% (delta da renovação)

- A régua de comissão "atinge a meta" é calculada **apenas sobre o delta da renovação** (oferta de renovação × linhas vs. valor atual do contrato) — não considera fibra, passaporte nem incremento, para não distorcer a leitura.
- Quando o incremento está incluído, o selo mostra "incremento incluído — comissão garantida" (a lógica de comissão por incremento independe do delta percentual da renovação).
- Quando o incremento está desligado, o selo mostra se a renovação sozinha atinge ou não os 10% de aumento.
- **Pendência conhecida (ver TODO no código, `_template.html`, função `computeProposal`)**: essa meta de 10% é, pela regra real de comissionamento, **por linha do cliente**, não sobre o valor total do contrato. Hoje a base de clientes só traz o valor total (`valor_contrato`) e a média por linha (`arpu`), sem o valor individual de cada linha (MSISDN). Enquanto isso não mudar, o cálculo usa o total/ARPU como aproximação. Se a planilha de clientes passar a trazer valor por linha, esse cálculo deve ser refeito por linha.

### 4.4 Banda larga (Claro Fibra)

- **A banda larga deve ser sugerida em todas as propostas**, independentemente de o cliente estar marcado como "cabeado" na base. (Antes o sistema só sugeria fibra para clientes cabeados — essa regra mudou.)
- Ligada por padrão (`incluirFixa = true`).
- Se o cliente não estiver marcado como cabeado na base, o sistema exibe um aviso pedindo para o consultor confirmar viabilidade técnica do endereço antes de fechar.
- Os valores usados são sempre os de preço **"Combinado"** do book (fibra vendida junto com plano móvel) — é assim que a Apex sempre vende, nunca fibra avulsa/"Single" (que é mais cara). Desde 11/08/2026 isso está explícito no código e na tela (antes o comentário/aviso dizia erroneamente "valor avulso").
- Só o plano 600MEGA tem preço promocional temporário (R$59,90 nos 3 primeiros meses, depois R$89,90/mês); os demais planos de fibra (400MEGA/800MEGA/1GIGA/5GIGA/10GIGA) são preço cheio, sem prazo.
- O desconto do pacote convergente por grupo de cidade (G1-G4) **ainda não está confirmado** — se o consultor souber o valor correto pra aquele cliente, deve ajustar manualmente.

### 4.4.1 Oferta de Convergência (fibra + linha móvel)

- Sempre que a proposta tem **fibra E pelo menos uma linha móvel** (renovação, incremento **ou portabilidade** — o book não diferencia entre elas pra esse fim), o sistema identifica e destaca isso como **Oferta de Convergência**: badge verde "Oferta de Convergência" na tela (logo abaixo do comparativo de valores) e nota "(Convergência)" no item "Claro Fibra" do PDF, com rodapé explicando o bônus.
- O book de agosto/2026 confirma que essa combinação (fibra + qualquer linha móvel) dá um **bônus de 30GB extra na franquia móvel** ("Mega Bônus") — o preço total da combinação é simplesmente a soma do preço "Combinado" da fibra com o preço da oferta móvel escolhida (conferido cruzando as tabelas de convergência do book com os preços avulsos de cada item — batem exatamente).
- Se a fibra estiver marcada mas **não** houver nenhuma linha móvel na proposta (nem renovação, nem incremento, nem portabilidade), o sistema mostra um aviso neutro — "bônus de convergência não se aplica" — em vez do badge de convergência, pra deixar claro que o bônus de 30GB só vale quando os dois itens estão juntos.
- Essa regra é calculada automaticamente (`computeProposal` → `convergenciaAtiva`), sem precisar de nenhuma ação manual do consultor além de marcar fibra + a linha móvel desejada.

### 4.4.2 Combos prontos "Destaques Convergentes" (`CONVERGENCIA_OFERTAS`)

Além da detecção automática acima (4.4.1), a tela de proposta tem uma seção opcional **"Oferta de Convergência — combo pronto do book"** com os combos nomeados da seção 1 do book ("Destaques Convergentes", Pág. 5-6), pra agilizar quando o consultor já sabe que vai vender fibra + móvel juntos:

- É um atalho opcional (toggle desligado por padrão) — ao ligar, aparece um seletor com os combos vendáveis e um botão "Aplicar combo à proposta", que ajusta de uma vez a velocidade da fibra e o plano móvel (da renovação, do incremento, ou do primeiro grupo de linhas, na proposta avulsa) pra combinação escolhida.
- Só **3 dos 4** combos do book entraram no sistema — o quarto ("Claro-fibra 1GIGA + Claro-pós 30GB") usa o plano regional do grupo RMG/RPS/RBS/RNE, que não é vendável pela Apex (fora de RSC/RSI, ver seção 1.1), mesma razão pela qual o `p57-30reg` já tinha sido removido da lista de planos móveis:
  - Fibra 1GIGA + Claro-pós 15GB (regional RSC/RSI, DDD 12-19) — 45GB total (15GB + 30GB Mega Bônus) — R$194,89/mês
  - Fibra 800MEGA + Claro-pós 12GB (nacional) — 42GB total — R$149,89/mês
  - Fibra 800MEGA + Claro-pós 40GB (nacional) — 70GB total — R$164,89/mês
- O preço de cada combo no book (ex.: R$194,89) é a referência do book para **fibra + 1 linha** nesse plano — é a mesma soma (fibra Combinado + móvel) já usada em 4.4.1, conferida linha a linha. Ao aplicar o combo, a proposta **não trava nesse valor fixo**: continua calculando o total real pela quantidade de linhas do cliente (a renovação multiplica o valor do plano móvel pelas linhas de voz, como sempre) — o combo só serve pra pré-preencher fibra + plano móvel de uma vez, não é uma tabela de preço própria.
- Escopo desta primeira versão: só os combos de **Fibra + Móvel** (seção 1 do book). Os combos de **Fibra + Soluções Digitais** (Microsoft 365 / Site Pronto, seção 2 do book) ficaram de fora — é um produto novo (preço, franquia) que ainda não foi modelado no sistema.

### 4.5 Claro Passaporte (uso internacional)

- Opcional, desligado por padrão.
- Cobertura Américas ou Europa, franquias de 5 a 40GB, valores conforme Pág. 79 do book anterior (não coberto pelo book de agosto/2026 — ver seção 5).
- Pacote "Mundo Total" é sempre opcional (nunca sugerido como obrigatório).
- **Pendência conhecida**: o mapeamento de qual cobertura (Américas/Europa) corresponde a qual faixa de preço ainda não foi confirmado pelo usuário — os rótulos na tela avisam "confirmar cobertura".

### 4.5.1 Outras ofertas — Claro Monitor e itens manuais (21/08/2026)

Seção opcional (nasce desligada/fechada) pra itens que não fazem parte do fluxo estruturado de linha/fibra/passaporte: hoje cobre o Claro Monitor e qualquer produto/serviço avulso que o consultor precise incluir na proposta sem estar modelado no sistema.

- **Claro Monitor** (gestão remota de dispositivos Android — bloqueio de apps/sites, geolocalização, apagar dados remotamente em caso de furto, inventário de dispositivos): o botão "+ Adicionar Claro Monitor" inclui o item já pré-preenchido no valor da **Jornada de Mobilidade** (R$5,00/mês por licença, 1 licença por linha móvel Claro, fidelidade de 24 meses — só essa jornada foi modelada, por ser a mais aderente ao perfil de cliente da Apex, que já tem linha Claro). A quantidade de licenças já nasce sugerida igual ao total de linhas de voz do cliente (cliente-da-base) ou 1 (avulsa), e o consultor pode ajustar livremente.
  - A **Jornada Radar** (pacote fechado de 30 licenças por R$150,00/mês, pra cliente sem linha móvel Claro, adicionais em múltiplos de 5) existe no book mas **não foi modelada** — fica pendente pra uma eventual necessidade futura.
  - O Claro Monitor é compatível só com dispositivos Android (limitação do produto, não do sistema).
- **Oferta manual**: o botão "+ Adicionar oferta manual" cria um item em branco com 3 campos livres — produto/serviço (texto), valor unitário (R$) e quantidade — pro consultor incluir qualquer produto/serviço combinado com o cliente que não esteja no book padrão (ex.: instalação, serviço avulso, produto de parceiro).
- Cada item soma `valor unitário × quantidade` no valor total da proposta (`extrasValor`, em `computeProposal`), aparece no resumo e como uma linha própria na tabela do PDF (nome do item + "qtd× valor/un").
- **Itens de "Outras ofertas" não entram na régua de meta de comissão de 10%** (seção 4.3), que continua calculada só sobre o delta da renovação — igual já acontecia com fibra, passaporte e incremento.
- Desligar o interruptor da seção **não apaga** os itens já configurados (mesmo comportamento do incremento, ver 4.2) — só zera a contribuição deles no total enquanto a seção estiver desligada; religar a seção mostra os itens de novo, do jeito que o consultor deixou.

### 4.6 Regras regionais (DDD) e área de atuação

- A Apex só vende nas regiões **RSC/RSI (São Paulo Capital/Interior — DDD 12 a 19)** — ver seção 1.1. Ofertas regionais do book fora dessa área (grupos RRS/RRE/RCO/RNO/RMG/RPS/RBS/RNE) foram **removidas do sistema**, não aparecem nem pra seleção manual.
- Para as ofertas regionais que **incluem** RSC/RSI (hoje: 15GB nacional/regional e 60GB portabilidade), o sistema marca automaticamente `ddds:[12..19]` e já sugere a oferta automaticamente pra clientes com esses DDDs — não precisa mais confirmação manual pra essas duas ofertas.
- Continua valendo o princípio geral: uma oferta regional só é sugerida automaticamente quando a lista de DDDs está confirmada; sem lista confirmada, a oferta fica disponível pra seleção manual do consultor.

## 5. Base de ofertas

Fonte atual (desde 11/08/2026): **"Claro-empresas & Canais Sinergia — PME Book Clareando", Agosto/2026** (documento enviado pelo usuário). Esse book é organizado por assunto (não mais por número de página como o anterior), então os blocos abaixo são identificados por categoria:

- **Nacional** (Claro pós empresas, Exclusivo CNPJ): ofertas de renovação/incremento "livres" (sem exigir portabilidade) — 12GB, 40GB, 70GB, 100GB e 150GB.
- **Regional** (respeitando a área de atuação da Apex — ver seção 1.1): o book de agosto/2026 associa faixas de GB a grupos de DDD nomeados (RSC/RSI/RRS/RRE/RCO/RNO de um lado, RMG/RPS/RBS/RNE de outro).
  - **15GB (R$44,99)** está no grupo RSC/RSI/RRS/RRE/RCO/RNO — como esse grupo inclui a área da Apex, a oferta foi mantida no sistema com **DDD 12 a 19** (RSC/RSI).
  - **30GB (R$44,99)** está no grupo RMG/RPS/RBS/RNE — esse grupo **não inclui** RSC/RSI, ou seja, fora da área de venda da Apex. Essa oferta foi **removida** do sistema (não aparece mais como opção pro consultor).
- **Portabilidade**: ofertas de incremento exclusivas para quem porta o número — 6GB, 21GB e 60GB (regional, grupo RSC/RSI, mantida com DDD 12-19). A variante de 25GB (regional, grupo RMG/RPS/RBS/RNE, fora da área da Apex) foi **removida** pelo mesmo motivo do 30GB acima.
- **Pág. 60** (book anterior): ofertas adicionais de renovação/incremento com input manual (via TCPJ/CPC) e redes sociais ilimitadas — não constam no book de agosto/2026, mas foram **mantidas como estavam** por decisão do usuário (não foram descontinuadas, só não foram reconfirmadas nesse documento).
- **Claro Passaporte** (uso internacional): não consta no book de agosto/2026 — mantido do book anterior, pendente de atualização específica.
- **Claro Fibra**: valores confirmados no book de agosto/2026, usando sempre o preço **"Combinado"** (fibra vendida junto com o plano móvel — que é como a Apex sempre oferece, nunca fibra avulsa) do grupo Grandes Mercados: 400MEGA R$79,90 · 600MEGA R$59,90 **só nos primeiros 3 meses**, depois R$89,90 (o preço avulso/"Single", que a Apex não usa, seria R$99,90) · 800MEGA R$109,90 · 1GIGA R$149,90 · 5GIGA R$449,90 · 10GIGA R$1.949,90. Confirmado que **só o 600MEGA** tem prazo promocional — os demais são preço cheio, sem prazo. Desconto de pacote convergente por grupo de cidade (G1-G4) segue **não confirmado**.

## 6. Pendências / itens a confirmar

- Conectar a regra de comissão (meta de 10% por linha, ver 4.3) ao valor real extraído da fatura pela "Analisar Fatura" (seção 22) — o usuário decidiu não usar ARPU como aproximação; o valor por linha vem da fatura analisada quando disponível. Ainda não implementado.
- Desconto do pacote convergente fibra+móvel por grupo de cidade (G1-G4).
- Mapeamento Américas × Europa no Claro Passaporte (não coberto pelo book de agosto/2026).
- Condição do bônus de 50GB (fibra + móvel, atualizado do book Set/2026 v3 — antes 30GB) para clientes não identificados como cabeados na base.
- Combo novo do book Set/2026 v3 (Claro-fibra 600MEGA + Claro-pós 71GB) não adicionado ao `CONVERGENCIA_OFERTAS` — franquia base ambígua (10GB+11GB), ver seção 21.
- Catálogo de "Soluções Digitais" (Claro Monitor Avançado, Blip Go, Site Pronto, Microsoft 365, Google Workspace etc., todos com preço no book Set/2026 v3) ainda não tem UI própria no painel — depende do seletor de tipo de proposta "renovação com inclusão de produtos de soluções digitais" ainda não implementado.

## 7. Exibição da diferença de valor (redução na fatura)

- Na prévia da proposta (tela) e no PDF, o valor/percentual de diferença **só aparece quando o total proposto é menor que o valor atual do contrato** (redução real, considerando renovação + incremento(s) + fibra + passaporte, tudo somado).
- Quando o total proposto é igual ou maior que o atual, essa linha simplesmente não aparece — a tela mostra só "Valor atual" e "Valor proposto", sem destacar aumento.

## 8. Identidade visual do PDF da proposta

- O PDF exibe o logo da Apex e o logo da Claro Empresas lado a lado no cabeçalho (antes só tinha o logo Apex), para reforçar que a proposta é respaldada pela Claro e gerar mais credibilidade com o cliente.
- Layout redesenhado no padrão de documento comercial formal (mesmo estilo visual de propostas de portabilidade/aparelho já usadas pela Apex): cabeçalho e rodapé em barra preta (repetidos em todas as páginas), título "PROPOSTA COMERCIAL" com subtítulo dinâmico conforme o tipo de proposta (renovação, avulsa, titularidade), grade com os dados do cliente (Cliente / Data de emissão / CNPJ / Consultor), seções "SITUAÇÃO ATUAL" e "NOVA PROPOSTA" em vermelho da marca (`#b3101f`), com a "Nova proposta" apresentada como tabela itemizada (cabeçalho vermelho, linhas zebradas).
- A caixa de destaque com o valor proposto passou a usar o vermelho da marca (`#b3101f`, mesma cor do cabeçalho de tabela) em vez do vinho antigo.
- Rodapé preto com nome da Apex, "Agente Autorizado Claro Empresas" + CNPJ da Apex, validade da proposta e numeração de página — repetido em todas as páginas caso a proposta tenha muitos itens (o PDF quebra automaticamente para uma nova página quando o conteúdo não cabe).
- O **conteúdo** da proposta não mudou nessa atualização — é a mesma comparação situação atual × nova proposta, com a diferença exibida só quando há redução (ver seção 7). Só o estilo visual foi atualizado, a pedido do usuário, tomando como referência um modelo de documento comercial já usado pela Apex.
- Subtítulo do cabeçalho: "Apex Smart Solutions — Parceiro autorizado Claro Empresas" (renovação); "Proposta avulsa — Nova aquisição / portabilidade" (avulsa concorrência); "Transferência de titularidade Claro — Pessoa Física para Jurídica" (titularidade).

### 8.0.1 Tabela de itens com subtotal e total

- A coluna "VALOR" da tabela "Nova proposta" virou "SUBTOTAL": cada linha mostra o valor unitário dentro da descrição (ex.: "5× 12GB — R$ 39,99/linha") e o subtotal já multiplicado pela quantidade na última coluna (ex.: R$ 199,95).
- Uma linha "TOTAL" fecha a tabela, somando todos os subtotais (renovação/grupos + incremento(s) + fibra + passaporte) — esse total é sempre igual ao "Valor proposto" mostrado na caixa vermelha logo abaixo, então o cliente consegue conferir a conta line a line antes de ver o valor final.

## 8.1 Benefícios inclusos (voz/dados) exibidos na proposta

- Todo plano móvel das Pág. 56/57/59 do book (renovação, incremento ou portabilidade) inclui, sem custo adicional e sem descontar da franquia de dados: **ligações ilimitadas** (fixo e celular, qualquer operadora do Brasil, usando o 21), **WhatsApp ilimitado** (voz, vídeo e mensagens) e **Waze ilimitado**. Esses 3 benefícios são universais — aparecem sempre que a proposta tem alguma oferta móvel (renovação, grupo de linha avulsa ou incremento), independentemente de qual plano específico foi escolhido.
- Como não temos os arquivos de logo oficiais do WhatsApp e do Waze, o PDF exibe **selos coloridos com a cor de cada marca** (preto para ligações, verde WhatsApp, azul/ciano Waze) em vez do logo oficial. Se o usuário fornecer os arquivos de logo reais, dá pra trocar os selos por eles.
- Além dos 3 benefícios universais, cada oferta específica pode ter **extras próprios** (campo `extras` em `OFFERS_MOBILE`), vindos do book: Claro Passaporte Américas 5GB incluso sem custo (planos 70/100/150GB da Pág. 57), Cloud 1,5TB (plano 150GB da Pág. 57), redes sociais ilimitadas sem descontar da franquia (planos da Pág. 60). Esses extras aparecem na proposta (tela e PDF) só quando a oferta que os tem foi realmente selecionada.
- Notas puramente operacionais (ex.: "Input manual via TCPJ/CPC", "Exclusivo portabilidade") **não aparecem** na lista de benefícios do PDF — são informação pro consultor, não benefício pro cliente — mas continuam visíveis no resumo da tela.
- **Pendência**: os extras "Américas 5GB" e "Cloud 1,5TB" foram atribuídos aos planos com base na extração de texto do book (Pág. 57), que reordena elementos visuais da página em PDF — vale conferir com o book original antes de uma venda grande se a associação plano×benefício está mesmo correta.

## 9. Validade da proposta

- Toda proposta gerada (tela e PDF) mostra a validade de **1 dia a partir da emissão** (data de emissão + 1 dia), para criar senso de urgência e deixar claro que os valores podem mudar depois desse prazo.

## 10. Proposta avulsa (prospect fora da base)

- Nova aba "Gerar Proposta", visível para todos os perfis (admin, supervisor, consultor), para gerar proposta comercial a um cliente que **ainda não está na base** — ex.: um prospect que hoje é cliente de outra operadora, ou uma linha totalmente nova.
- Formulário pede: tipo de proposta (ver abaixo), nome do cliente/empresa (obrigatório), CNPJ (opcional), cidade (opcional), DDD (obrigatório — usado para filtrar as ofertas regionais corretas), operadora atual (obrigatória só para o tipo Portabilidade), quantidade de linhas (obrigatório) e valor total que o cliente informou pagar hoje (obrigatório).
- Diferente da proposta de um cliente já cadastrado, aqui a "Situação atual" é o valor que o **próprio cliente informou** (não vem da nossa base), com aviso deixando isso explícito na tela e no PDF.
- Como o prospect ainda não é cliente Claro, não existe "renovação". A linha base da proposta usa as ofertas de **Aquisição** (Pág. 57/60) e, opcionalmente, **Portabilidade** (Pág. 59) — o consultor marca se o cliente vai portar o número ou não. É o mesmo pool de ofertas usado na seção de Incremento das propostas normais.
- **Quantidade de linhas atual x desejada**: o formulário pede quantas linhas o cliente tem hoje (usado para "Situação atual" e para calcular o valor médio por linha). A quantidade de linhas **desejada** com a Claro é definida na tela seguinte, através dos grupos de linha (ver abaixo) — pode ser igual, maior ou menor que a quantidade atual (ex.: tem 3 linhas na concorrência e quer 5 ou 6 com a Claro).
- **Grupos de linha (pode misturar aquisição e portabilidade no mesmo pedido)**: a linha base da proposta avulsa não é mais uma escolha única — é uma **lista de grupos**, cada um com tipo (Aquisição ou Portabilidade — só aparece a opção de tipo quando não é titularidade), quantidade de linhas e oferta. O consultor pode adicionar quantos grupos precisar ("+ Adicionar grupo de linhas") e remover os que não usar. Isso cobre o caso comum de um pedido parte portabilidade, parte linha nova (ex.: 3 linhas portadas de outra operadora + 3 linhas novas). O total de linhas do pedido é a soma da quantidade de todos os grupos. No tipo "Transferência de titularidade", todo grupo é automaticamente do tipo Aquisição (nunca portabilidade), mas ainda é possível ter vários grupos com ofertas diferentes.
- **Tipo de proposta avulsa**: o formulário tem um seletor com três tipos —
  - **Novo**: linha nova, sem portar número de lugar nenhum (ex.: cliente sem linha anterior, ou uma linha adicional nova). **Não pede operadora atual** — não existe serviço anterior a portar. Usa ofertas de Aquisição (Pág. 57/60).
  - **Portabilidade**: o cliente vai portar o número de outra operadora pra Claro. É o **único tipo que pede operadora atual** (obrigatório). Usa ofertas de Aquisição (Pág. 57/60) e também as exclusivas de Portabilidade (Pág. 59).
  - **Transferência de titularidade Claro — pessoa física para jurídica**: para um cliente que já é Claro (pessoa física) migrando para pessoa jurídica. Não pede operadora (já é Claro) e **nunca usa ofertas de portabilidade** — usa só as mesmas ofertas de Aquisição da Pág. 57/60, já que não é portabilidade de outra operadora.
  - O tipo escolhido só define o ponto de partida: dentro do formulário de grupos de linha (ver acima), o consultor ainda pode misturar Aquisição e Portabilidade no mesmo pedido nos tipos Novo/Portabilidade (não na Transferência de titularidade, que é sempre só Aquisição).
- Não existe meta de comissão de 10% na proposta avulsa (esse conceito é específico de renovação). A comissão vem da aquisição/portabilidade, do incremento e/ou dos itens à parte (fibra, passaporte).
- Fora essa diferença na origem do valor "atual" e no pool de ofertas da linha base, a proposta avulsa segue o mesmo padrão da proposta normal: incremento(s) opcionais, fibra sugerida por padrão, Passaporte opcional, diferença só exibida quando há redução, validade de 1 dia, logos Apex + Claro no PDF.

## 10.1 Funil de vendas (kanban)

Nova aba "Funil de Vendas", visível para todos os perfis, com um quadro kanban das propostas em andamento. Guarda as propostas no banco (tabela `propostas`, ver `supabase_schema.sql` seção 4) — antes disso, a proposta só existia como o PDF gerado na hora, sem nenhum registro persistente.

### Estágios e SLA

1. **Lead** — sem SLA. Card manual, criado pelo consultor pelo botão "+ Novo lead" antes de existir uma proposta formal (ex.: um contato inicial). Guarda nome, CNPJ/cidade/DDD opcionais, valor estimado opcional e uma observação livre.
2. **Proposta Enviada** — SLA de **24h**. Todo card entra aqui automaticamente assim que uma proposta é gerada em PDF (fluxo cliente-da-base, avulsa ou titularidade) — não precisa de nenhuma ação manual do consultor pra criar o card.
3. **Negociação** — SLA de **24h**. Movida manualmente pelo consultor (drag-and-drop ou pelo seletor "Mover para" dentro do card).
4. **Fechado/Ganho** — sem SLA, mas não é definitivo: se surgir uma nova negociação/nova proposta pro mesmo cliente, o consultor usa o botão "Gerar proposta" **dentro do próprio card** (não cria um card novo) — isso move o card de volta pra Proposta Enviada e reinicia o SLA.
5. **Fechado/Perdido** — sem SLA. Ao mover um card pra cá (por drag-and-drop ou pelo seletor), abre um mini-modal pedindo o motivo da perda (**opcional**, fica salvo no card).

O SLA é contado a partir de `estagio_entrada_em`, que é resetado toda vez que o card muda de estágio (inclusive quando volta de Fechado/Ganho pra Proposta Enviada). Card com SLA estourado (mais de 24h parado em Proposta Enviada ou Negociação) ganha um selo vermelho "SLA estourado" no card, tanto no kanban quanto no alerta do dashboard.

### Como um card nasce e é atualizado

- **Automático**: toda vez que `generateProposalPDF()` roda com sucesso (cliente da base, avulsa ou titularidade), um card novo é criado em Proposta Enviada — a não ser que a proposta tenha sido aberta a partir de um card já existente (ver abaixo), caso em que ESSE card é atualizado em vez de duplicar.
- **Manual**: o botão "+ Novo lead" cria um card direto no estágio Lead, sem proposta ainda.
- **Reabrir um card pra gerar nova proposta**: todo card (inclusive Lead e Fechado/Ganho) tem um botão "Gerar proposta", que reabre o formulário de proposta pré-preenchido com os dados salvos no card (nome, CNPJ, cidade, DDD, tipo avulsa/titularidade, operadora atual). Ao gerar o PDF a partir daí, o card é atualizado (não duplicado) e volta pra Proposta Enviada.
- Cada card guarda um snapshot dos dados do cliente/proposta em uma coluna `dados` (jsonb), usado justamente pra poder reabrir e regenerar a proposta depois.
- **Limitação conhecida**: gerar uma proposta a partir da busca de clientes ou da aba "Gerar Proposta" avulsa (sem passar pelo card) **sempre cria um card novo**, mesmo que já exista um card aberto pra aquele mesmo cliente — não há hoje uma tentativa automática de "achar o card certo" por nome/CNPJ, pra evitar o risco de juntar duas negociações diferentes por engano. Se o consultor quiser continuar a mesma negociação, deve reabrir a proposta a partir do card (botão "Gerar proposta" dentro do card), não pela busca.

### Toda movimentação é registrada

Toda mudança de estágio — manual (drag-and-drop ou seletor) ou automática (nova proposta gerada) — grava uma linha em `propostas_historico` (estágio anterior, estágio novo, quem moveu, quando, e a nota/motivo quando houver). O histórico completo de cada card fica visível ao clicar nele.

### Visibilidade por perfil

- **Consultor**: só vê e movimenta os próprios cards (RLS restringe por `consultor_id`). Não existe filtro de consultor na tela dele (não faz sentido, só tem os dele).
- **Admin / Supervisor**: veem o funil consolidado de todos os consultores no mesmo kanban, com um filtro dropdown pra focar em um consultor específico. Cada card mostra o nome do consultor dono (com um selo com as iniciais), pra identificar visualmente de quem é cada proposta. Podem mover qualquer card (RLS permite update pra admin/supervisor em qualquer linha).

### Dashboard na tela de entrada

A aba "Buscar Clientes" (tela de entrada, primeira aba após login) mostra, só para consultores, um resumo simples com a contagem de cards em cada estágio e um alerta vermelho clicável quando há proposta(s) com SLA estourado (leva direto pra aba Funil de Vendas). Fica escondido se o consultor ainda não tem nenhum card. Para admin/supervisor esse resumo fica escondido — a visão consolidada deles já é o próprio kanban na aba Funil de Vendas.

### Pendência

- O SLA de 24h é fixo no código (`FUNIL_ESTAGIOS` em `_template.html`) — se precisar de SLA diferente por estágio ou por tipo de proposta, é só ajustar essa constante.
- Não existe hoje uma forma de excluir um card do funil (só admin tem permissão no banco via RLS, mas não tem botão na interface) — se aparecer necessidade de "arquivar"/remover, precisa de uma tela específica.

## 11. Processo de deploy (apexsmart.com.br)

- O painel roda em `apexsmart.com.br/public_html/painel_clientes_apex.html`, atualizado via SSH/SFTP (host 45.152.46.187:65002, hospedagem Hostinger).
- **Sempre pedir autorização antes de subir uma atualização** — nunca subir automaticamente sem confirmar antes.
- **Antes de sobrescrever, fazer backup da versão que está no ar**, copiando para `~/backups_painel_clientes_apex/` (fora da `public_html`, não acessível pelo navegador), com data/hora no nome do arquivo. Isso permite reverter rapidamente se algo der errado.
- Depois do upload, conferir o MD5 do arquivo remoto contra o local para garantir que subiu certinho.
- Não subir nada além do `painel_clientes_apex.html` sem pedido explícito — não mexer no `index.html` (home page da empresa) nem nos outros arquivos que já estão na pasta.
- **Sempre gerar o `painel_clientes_apex.html` a partir de `_template.html` usando o script `build_painel.py`** (nunca fazer substituição manual/parcial dos placeholders). O script substitui os 4 placeholders (`__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`, `__APEX_LOGO_B64__`, `__CLARO_LOGO_B64__`) e falha alto se sobrar algum — evita repetir o incidente da seção 11.1.

### 11.1 Incidente (05/08/2026) — login quebrado por placeholder não substituído

- Ao regenerar o painel após o redesign do PDF, a substituição foi feita manualmente e só trocou os logos, esquecendo `__SUPABASE_URL__` e `__SUPABASE_ANON_KEY__`. O arquivo subiu para produção com esses placeholders literais no lugar da URL/chave do Supabase, quebrando toda comunicação com o backend — inclusive o login — para todos os usuários.
- Detectado pelo próprio usuário ("meu login não consegue mais acessar"). Corrigido no mesmo dia: gerado novo arquivo com todos os placeholders preenchidos, backup do arquivo quebrado guardado em `backups_painel_clientes_apex/` (sufixo `_QUEBRADO`), upload da versão corrigida e conferência de MD5.
- **Correção estrutural**: criado `build_painel.py`, que centraliza a geração do painel e trava (erro explícito) se qualquer placeholder `__X__` ficar sem substituição — ver seção 11 acima.

## 12. Verificação de cobertura de banda larga (KMZ)

Sinaliza pro consultor se um endereço (CEP + número) provavelmente tem cobertura de rede fixa (HFC/GPON) da operadora, a partir do mapa de rede em KMZ que a Apex recebe da Claro — sem depender de confirmação manual de viabilidade técnica a cada proposta.

### 12.1 Como funciona

- **Fonte dos dados**: o admin sobe o(s) arquivo(s) `.kmz` da operadora (um por cidade) na aba "Base de Dados". O parsing é feito no navegador (JSZip + DOMParser): o `.kmz` é descompactado, o `.kml` interno é lido, e todo ponto de `Point`/`LineString`/`Polygon` é extraído junto com a rede de origem (pasta "HFC" ou "GPON" dentro do KML). O resultado — uma lista de `[latitude, longitude, rede]` — é salvo por cidade na tabela `cobertura_kmz` do Supabase. O `.kmz` em si não é armazenado, só os pontos extraídos.
- **Nome da cidade**: lido automaticamente do nome do arquivo (padrão observado nos arquivos da operadora: `SP - CAMPINAS - 06.07.2026.kmz` → "Campinas"). Se o nome não bater nesse padrão, o sistema pergunta a cidade antes de salvar. Subir de novo o arquivo de uma cidade sobrescreve a versão anterior dela (upsert por cidade normalizada).
- **Geocodificação**: CEP + número são convertidos em latitude/longitude via Google Maps Geocoding API. A chave da API fica guardada na tabela `config` do Supabase (não fixa no código), editável pelo admin na aba "Base de Dados" sem precisar de novo deploy.
- **Cálculo de cobertura**: distância (fórmula de haversine) do endereço geocodificado até o ponto de rede mais próximo cadastrado para a cidade. **Cobertura = ponto de rede a até 150 metros de distância** — essa é a distância máxima permitida da CTO (caixa de terminação óptica) para instalação de banda larga, então é o raio tecnicamente correto pra essa checagem (raio inicial de 50m foi ajustado pra 150m em 06/08/2026 depois de confirmado o limite real com a operadora).
- **Resultado sempre rotulado como estimativa**: a tela deixa explícito que isso não substitui a confirmação oficial de viabilidade técnica da Claro.

### 12.2 Onde é usado

- **Aba dedicada "Verificar Cobertura"** (visível a todos os perfis): consultor digita CEP + número e recebe o resultado (coberto / sem cobertura próxima / sem dados daquela cidade) sem precisar estar no meio de uma proposta.
- **Dentro do fluxo de proposta**: ao marcar "Incluir Claro fibra" (tanto em cliente da base quanto em proposta avulsa), aparece um mini-formulário de CEP + número pra checar a cobertura ali mesmo, sem sair da tela. Na proposta avulsa, o campo CEP do formulário inicial pré-preenche esse campo.

### 12.3 Mapa de cobertura (visão aérea/satélite)

Na mesma aba "Verificar Cobertura", abaixo da busca por CEP, tem um mapa (Google Maps, view padrão "hybrid" — satélite com nomes de ruas) com um seletor de cidade. Cada ponto do KMZ vira uma mancha de cobertura semi-transparente com o raio de cobertura (150m) — laranja para HFC, azul para fibra (GPON) — com checkbox pra ligar/desligar cada camada. A opacidade é baixa de propósito, pra dar pra ver ruas e nomes por baixo das manchas.

- **Por que manchas e não pino por ponto**: cidades grandes chegam a dezenas de milhares de pontos extraídos do KMZ (Campinas tem mais de 25 mil). Um pino por ponto travaria o navegador; as manchas mostram a área de cobertura de fato (raio real considerado na checagem), e onde se sobrepõem indica mais de um ponto de rede próximo.
- **Como é desenhado**: overlay de canvas próprio (`google.maps.OverlayView`), não o `HeatmapLayer` da API — o Google descontinuou essa funcionalidade nas versões atuais do Maps JavaScript API.
- **Carregamento sob demanda**: o script do Google Maps só é carregado quando a aba "Verificar Cobertura" é aberta pela primeira vez (não pesa o resto do painel) e a instância do mapa é reaproveitada ao trocar de cidade (não recria o mapa a cada troca).
- **Integração com a busca por CEP**: ao verificar um endereço específico, se a cidade encontrada tiver KMZ cadastrado, o mapa seleciona essa cidade automaticamente, centraliza e dá zoom no endereço, e marca um pino verde (coberto) ou vermelho (sem cobertura próxima) — sem precisar trocar de tela.

## 13. Movimentação da base (comparativo antes/depois entre uploads)

A cada envio de planilha na aba "Base de Dados" (só admin), o painel compara a base atual com a planilha nova **antes** de substituir, e registra o que mudou — sem isso, o upload simplesmente trocava a base sem deixar rastro de quem saiu, entrou ou mudou.

### 13.1 Como a comparação funciona

- **Chave de comparação**: CNPJ normalizado (só dígitos — "11.222.333/0001-44" e "11222333000144" são tratados como o mesmo cliente). Registros sem CNPJ (de qualquer um dos dois lados) ficam de fora da comparação — o upload informa quantos foram esses.
- **CNPJ duplicado** na mesma planilha: fica só a primeira ocorrência pra fins de comparação (não trava o upload).
- **Saída**: CNPJ que estava na base atual e não está mais na planilha nova.
- **Entrada**: CNPJ que não estava na base atual e apareceu na planilha nova.
- **Mudança**: CNPJ presente nos dois, mas algum campo rastreado é diferente — linhas de voz, linhas fixas, valor do contrato, cidade, ou se o cliente passou a ser (ou deixou de ser) cabeado. Mudança de razão social sozinha **não** gera registro de mudança (não é um campo rastreado). O tempo de contrato de voz (`tempo_contrato_voz`) também **não** é rastreado aqui de propósito — ele sobe naturalmente todo mês pra todo mundo, então tratá-lo como "mudança" geraria um evento pra base inteira a cada upload; ele é usado separadamente pra calcular aptidão (ver regra abaixo) e "renovaram".
- Cada evento detectado vira uma linha na tabela `clientes_movimentacao`, com um retrato completo do cliente antes e depois (`dados_antes`/`dados_depois` em JSON) — histórico permanente, nunca apagado, mesmo que a base seja substituída de novo depois.
- **Permaneceram**: CNPJs presentes nos dois lados (não é saída, não é entrada) — inclui quem não mudou nada e quem teve alguma mudança de campo. É a base de comparação pra medir retenção de carteira.
- **Regra de aptidão para renovação (11/08/2026)**: a planilha da base deixou de trazer uma coluna explícita de "apto/não apto" — a partir de agora um cliente é considerado **apto para renovação quando o tempo de contrato de voz (`tempo_contrato_voz`) é maior que 15 meses**. Essa regra é calculada em todo lugar do painel que mostra aptidão (busca de clientes, modal de detalhe, movimentação da base), não depende mais de nenhum texto vindo da planilha.
- **Possível renovação (sinal positivo)**: quando um cliente **permanece na base** e seu tempo de contrato de voz **cai de >15 pra ≤15 meses** entre um upload e o outro — sinal de que o contrato foi resetado porque a renovação foi fechada com ele (por isso ele deixou de aparecer como "apto pendente", mas não foi perdido). Esse cálculo é feito direto entre o retrato antigo e o novo de cada cliente que permaneceu, independente de ter gerado ou não um registro de "mudança" (já que `tempo_contrato_voz` sozinho não é campo rastreado, como explicado acima).
- Cada upload também grava **um resumo agregado** na tabela `clientes_movimentacao_resumo` (total antes, total depois, saíram, entraram, mudaram, permaneceram, possíveis renovações, quem fez e quando) — é essa tabela que alimenta o card "Última atualização da base" (seção 13.3), pois "quantos permaneceram" e "quantas renovações prováveis" não dá pra recalcular de forma confiável a partir só dos eventos individuais (uploads em chunks, sem um identificador de "lote").
- Antes de confirmar o upload, o admin já vê um resumo (quantos saíram/entraram/mudaram/permaneceram, e quantas possíveis renovações) na própria caixa de confirmação.

### 13.2 Dashboard "Movimentação da Base" (só admin)

Nova aba, visível só para Administrador (mesma visibilidade da aba "Base de Dados"):

- **Cards de resumo** (últimos 30 dias): quantos saíram, entraram, mudaram; quantos saíram **estando aptos para renovação** (destacado em vermelho — é a perda mais evitável, indica que o cliente estava pronto pra fechar e foi perdido de qualquer forma); valor de contrato perdido (soma do `valor_contrato` de quem saiu) e ganho (soma de quem entrou), e o saldo entre os dois.
- **Clique no número de "saíram"/"entraram"/"mudaram"** abre o analítico completo daquele tipo — todos os registros dos últimos 30 dias, não só de um dia — já com o filtro de tipo pré-selecionado, pronto pra exportar.
- **Gráfico de barras** (Chart.js) com entradas x saídas x mudanças por dia, últimos 30 dias. Clique numa barra abre o detalhe só daquele dia específico.
- **Tabela de detalhe** (aberta pelo card de resumo ou pela barra do gráfico): tipo, CNPJ, razão social, cidade e o que mudou especificamente (para "mudança", mostra campo por campo o valor antes → depois). Tem filtro por tipo (saída/entrada/mudança), que já refiltra a tabela aberta na hora.
- **Exportar Excel**: gera um `.xlsx` de verdade (via SheetJS, a mesma biblioteca usada pra ler a planilha da base) com a lista atualmente filtrada — pronto pra abrir direto no Excel. Colunas: Tipo, CNPJ, Razão Social, Cidade, **Linhas**, **Valor Contrato**, **Apto Renovação** e **Meses de Contrato** (cada um em coluna separada, não misturado em texto livre), além de "Detalhe" (o resumo textual, útil principalmente pra "mudança" — mostra campo a campo o que mudou) e Data. Pra saída usa o retrato do cliente antes de sair; pra entrada/mudança usa o retrato mais recente.

### 13.3 Card "Última atualização da base" (retenção, em tempo real)

Card no topo da aba "Movimentação da Base", separado do resumo de 30 dias — aqui os números são calculados **em tempo real, direto da base atual**, não do histórico de eventos:

- **Clientes na base**: contagem atual de `clientes`.
- **Linhas totais**: soma de `linhas_voz + linhas_fixas` de todos os clientes ativos na base.
- **Permaneceram** e **possíveis renovações**: vêm do resumo do **último upload** feito (`clientes_movimentacao_resumo`, o mais recente por data).
- **Aptos para renovação (hoje)**: contagem, calculada na hora a partir da base atual, de quantos clientes têm `tempo_contrato_voz` maior que 15 meses (ver regra de aptidão na seção 13.1) — é diferente de "quem saiu estando apto" (seção 13.2), que olha o histórico de saídas.
- **Data da última atualização**: quando o último upload foi processado.
- **Clique no número de "aptos para renovação"** abre o mesmo card de detalhe usado pela movimentação, mas num modo à parte: lista todos os clientes aptos agora (CNPJ, razão social, cidade, linhas, valor de contrato, apto renovação, meses de contrato), sem o filtro de tipo (que não se aplica aqui), com exportação para `.xlsx` (`clientes_aptos_renovacao.xlsx`) — dá pra um consultor priorizar contato com quem está pronto pra renovar, já vendo há quanto tempo o contrato está ativo.

## 14. Changelog

- **04/08/2026** — Regra de renovação redefinida como sempre obrigatória (nenhuma linha existente pode ser extinta); incremento passou a ser item separado e opcional de composição de receita. Selo de meta de 10% passou a considerar só o delta da renovação (não misturar com fibra/passaporte/incremento). Registrado TODO: meta de 10% deveria ser por linha, não sobre o total (aguardando dado de valor por linha na base).
- **04/08/2026** — Banda larga (fibra) passou a ser sugerida em todas as propostas, não só para clientes cabeados. Proposta passou a suportar múltiplos incrementos (adicionar/remover linhas de incremento), permitindo, por exemplo, renovar as linhas existentes de um cliente com 10 linhas e ainda somar 1 ou 2 incrementos, podendo reduzir a fatura total se a renovação escolhida for mais barata que o valor atual.
- **04/08/2026** — Diferença de valor (tela e PDF) agora só é exibida quando há redução real na fatura. PDF passou a incluir o logo da Claro Empresas ao lado do logo Apex e adotou a cor vinho da Claro na caixa de destaque, para reforçar credibilidade. Adicionada validade de 1 dia à proposta.
- **04/08/2026** — Busca de clientes passou a exigir no mínimo 3 caracteres para iniciar (antes disparava com 1 caractere).
- **04/08/2026** — Busca de clientes restrita a razão social, CNPJ e telefone (removidos e-mail e nome do administrador), depois de observar que buscas curtas em campos numéricos/alfanuméricos longos geravam muitos resultados sem relação aparente com o termo buscado.
- **04/08/2026** — Lista de resultados da busca passou a mostrar em qual campo o termo foi encontrado (ex.: "Encontrado em: Telefone 1 (11912340000)"), para dar transparência sobre por que aquele cliente apareceu — útil principalmente quando o match é em tel1/tel2, que não aparecem em outro lugar do card.
- **04/08/2026** — Renovação deixou de ser obrigatória na proposta: agora é opcional (ligada por padrão), podendo ser desmarcada para clientes que não querem trocar o plano atual, gerando propostas só de incremento e/ou só de banda larga.
- **04/08/2026** — Nova aba "Gerar Proposta" (visível para todos os perfis) para gerar proposta avulsa a um prospect fora da base, usando ofertas de aquisição/portabilidade em vez de renovação, com o valor "atual" vindo do que o próprio cliente informou pagar na concorrência.
- **04/08/2026** — Proposta avulsa passou a diferenciar quantidade de linhas atual (o que o cliente tem hoje) de quantidade desejada (o que ele quer com a Claro, podendo ser maior). Adicionado o tipo "Transferência de titularidade Claro — pessoa física para jurídica", que usa só ofertas de aquisição (Pág. 57/60), sem portabilidade e sem pedir operadora atual.
- **04/08/2026** — Linha base da proposta avulsa virou uma lista de grupos (tipo + quantidade + oferta), permitindo misturar aquisição e portabilidade no mesmo pedido (ex.: parte das linhas portadas, parte novas).
- **05/08/2026** — Corrigido: grupo de portabilidade agora mostra todos os planos de aquisição da Pág. 57/60 além das promoções exclusivas da Pág. 59 (antes só mostrava as exclusivas). Aquisição sem portar número continua só com os planos normais da Pág. 57/60.
- **05/08/2026** — Painel publicado em `apexsmart.com.br` via SSH/SFTP. Definido processo de deploy: sempre pedir autorização antes de subir, e sempre fazer backup da versão anterior antes de sobrescrever (ver seção 11).
- **05/08/2026** — PDF da proposta redesenhado visualmente no padrão de documento comercial formal (cabeçalho/rodapé em barra preta repetidos em todas as páginas, grade de dados do cliente, seções e tabela de itens em vermelho da marca, quebra automática de página). Conteúdo da proposta não mudou, só o estilo visual (ver seção 8).
- **05/08/2026** — Incidente e correção: regeneração manual do painel esqueceu de substituir os placeholders de URL/chave do Supabase, quebrando o login de todos os usuários por algumas horas. Corrigido e criado `build_painel.py` para centralizar e travar esse processo (ver seção 11.1).
- **05/08/2026** — Adicionada seção "Benefícios inclusos" na "Nova proposta" do PDF: ligações ilimitadas, WhatsApp ilimitado e Waze ilimitado (universais a qualquer plano móvel), com selos coloridos (cor da marca, já que não há o logo oficial), além da lista de extras específicos de cada oferta (Américas, Cloud, redes sociais) tirados do book (ver seção 8.1). Corrigido também um bug de exibição pré-existente: "Redução de -R$ X (-Y%)" tinha o sinal negativo duplicado — agora mostra "Redução de R$ X (Y%)".
- **05/08/2026** — Criado o funil de vendas (kanban): nova aba "Funil de Vendas", tabela `propostas` no Supabase (antes as propostas não ficavam salvas em lugar nenhum, só existiam como o PDF gerado na hora). Estágios Lead → Proposta Enviada (SLA 24h) → Negociação (SLA 24h) → Fechado/Ganho ou Fechado/Perdido, com toda movimentação registrada em `propostas_historico`. Card nasce automaticamente ao gerar uma proposta; consultor pode reabrir qualquer card pra gerar nova proposta (atualiza o mesmo card, sem duplicar). Consultor só vê os próprios cards; admin/supervisor veem o funil consolidado com o nome do consultor em cada card. Dashboard simples com contagem por estágio e alerta de SLA estourado na tela de entrada (só pra consultor). Ver seção 10.1.
- **05/08/2026** — Tabela "Nova proposta" do PDF ganhou coluna de subtotal (valor unitário × quantidade) e uma linha de TOTAL fechando a tabela, antes da caixa com o valor proposto final — deixa a conta auditável linha a linha em vez de só mostrar o valor por linha. Ver seção 8.0.1.
- **05/08/2026** — Corrigido: o botão "X" e o clique fora do modal não fechavam a janela de detalhe do card do funil (faltava vincular os eventos).
- **06/08/2026** — "Tipo de proposta" avulsa passou de 2 para 3 opções: **Novo** (linha nova, sem portar número — não pede operadora), **Portabilidade** (porta número de outra operadora — único tipo que pede operadora atual) e **Transferência de titularidade** (sem alteração). Antes, "Cliente de outra operadora" misturava aquisição e portabilidade num tipo só e sempre pedia a operadora, mesmo quando o cliente não tinha linha anterior a portar. Ver seção 10.
- **06/08/2026** — Criada a verificação de cobertura de banda larga por CEP + número, a partir do mapa de rede (KMZ) da operadora: nova aba "Verificar Cobertura" (todos os perfis), upload de KMZ pelo admin na aba "Base de Dados" (parsing client-side, extrai pontos HFC/GPON por cidade), configuração da chave do Google Maps pelo admin (geocodificação), e uma checagem rápida embutida no fluxo de proposta ao marcar "Incluir Claro fibra". Cobertura é estimada por proximidade (raio de 50m do ponto de rede mais próximo), sempre rotulada como estimativa — não substitui a confirmação oficial da Claro. Ver seção 12.
- **06/08/2026** — Adicionado mapa de cobertura (visão aérea/satélite, Google Maps) na aba "Verificar Cobertura", com seletor de cidade e camadas HFC/GPON independentes. Cada ponto do KMZ vira uma mancha de cobertura semi-transparente (laranja = HFC, azul = fibra/GPON), desenhada com um overlay de canvas próprio (o `HeatmapLayer` original foi descontinuado pelo Google e precisou ser substituído). Integrado com a busca por CEP: ao achar um endereço, o mapa seleciona a cidade automaticamente e marca o ponto com pino verde/vermelho conforme o resultado. Ver seção 12.3.
- **06/08/2026** — Raio de cobertura ajustado de 50m para **150m**, distância máxima real permitida da CTO pra instalação de banda larga (o valor de 50m inicial era uma estimativa conservadora; 150m é o número correto confirmado com a operadora). Afeta tanto a checagem por CEP quanto o raio das manchas no mapa. Ver seção 12.1.
- **06/08/2026** — Transparência das manchas do mapa de cobertura aumentada (opacidade de 0,35 para 0,16), pra dar pra ver ruas e nomes de rua por baixo. Ver seção 12.3.
- **06/08/2026** — Criada a movimentação da base: todo upload de planilha agora compara a base atual com a nova (por CNPJ) antes de substituir, registrando quem saiu, quem entrou e quem mudou algum campo relevante (apto, linhas, valor, cidade, cabeado) em `clientes_movimentacao` — histórico permanente. Nova aba "Movimentação da Base" (só admin) com cards de resumo (incluindo valor de contrato perdido/ganho e clientes aptos que saíram), gráfico de entradas x saídas por dia, e detalhe exportável ao clicar num dia. Ver seção 13.
- **11/08/2026** — Cards de resumo da "Movimentação da Base" (saíram/entraram/mudaram) ficaram clicáveis: abrem o analítico completo daquele tipo nos últimos 30 dias (não só de um dia), com o filtro já pré-selecionado. Exportação trocada de CSV pra **.xlsx de verdade** (SheetJS), pronta pra abrir no Excel. Ver seção 13.2.
- **11/08/2026** — Adicionado o card "Última atualização da base" (retenção, em tempo real): clientes na base, linhas totais, quantos permaneceram e possíveis renovações (do último upload), e quantos estão aptos para renovação agora — com o número de aptos clicável, abrindo analítico exportável para Excel. Nova tabela `clientes_movimentacao_resumo` guarda o resumo agregado de cada upload (necessário porque "permaneceram"/"renovaram" não davam pra recalcular de forma confiável só com os eventos individuais). Ver seções 13.1 e 13.3.
- **11/08/2026** — Exportações Excel da "Movimentação da Base" (analítico geral e "aptos para renovação") passaram a trazer quantidade de linhas, valor de contrato, apto para renovação e meses de contrato (`tempo_contrato_voz`) em colunas separadas, em vez de só dentro do texto livre "Detalhe" — facilita filtrar/somar direto na planilha. Ver seções 13.2 e 13.3.
- **11/08/2026** — Corrigido bug: o card "Última atualização da base" ficava travado em "carregando..." indefinidamente sempre que a consulta do card "Resumo (30 dias)" falhasse (as duas estavam encadeadas, uma dependia da outra terminar sem erro). Agora as duas consultas rodam de forma independente e qualquer erro aparece na tela ("Erro: ...") em vez de deixar o card preso.
- **11/08/2026** — Achada e corrigida a causa raiz do travamento acima: o link do Chart.js no `<head>` apontava pra uma versão (4.4.4) que não existe mais no CDN cdnjs (retornava 404), então a biblioteca nunca carregava e `renderMovChart()` sempre lançava "Chart is not defined" — antes da correção anterior, esse erro travava a aba inteira sem aviso. Link atualizado pra versão 4.5.0 (confirmada ativa no CDN).
- **11/08/2026** — Mudança de regra de negócio: a planilha da base deixou de trazer a coluna "apto/não apto para renovação". A aptidão agora é **calculada** (não lida da planilha): cliente apto = tempo de contrato de voz maior que 15 meses. Afeta o selo "Apto para renovação" na busca e no modal de detalhe do cliente, e os cálculos de "saíram estando aptos", "aptos para renovação (hoje)" e "possíveis renovações" na Movimentação da Base. O campo antigo `apto_renovacao` deixou de ser usado pra qualquer decisão do painel.
- **11/08/2026** — Book de ofertas atualizado pro "Claro-empresas & Canais Sinergia — PME Book Clareando, Agosto/2026" (enviado pelo usuário). Removida a oferta nacional de 30GB (R$44,99), que no book novo passou a ser regional; as duas variantes regionais de 15GB (antes com DDDs distintos) foram unificadas em uma única entrada de 15GB regional, e criada uma nova entrada de 30GB regional — ambas sem DDD específico confirmado (o book novo não lista), mesmo tratamento já usado pra outra faixa regional antes. Ofertas nacionais de 12GB/40GB/70GB/100GB/150GB e Claro Fibra permaneceram com os mesmos valores. Os planos da Pág. 60 (book anterior, redes sociais ilimitadas/TCPJ-CPC) e o Claro Passaporte foram **mantidos sem alteração**, por não constarem neste book novo (decisão do usuário: não remover). Ver seção 5.
- **11/08/2026** — Registrada a área de atuação regional da Apex (seção 1.1): só RSC/RSI (São Paulo Capital/Interior, DDD 12-19). Com isso, a oferta regional de 15GB passou a ter DDD 12-19 confirmado (em vez de "sem DDD"), e as ofertas de 30GB (regional, grupo RMG/RPS/RBS/RNE) e 25GB portabilidade (mesmo grupo) foram **removidas** do sistema por não serem vendáveis pela Apex — evita mostrar ao consultor uma oferta que não pode ser fechada. Corrigida também a nota de preço do Claro fibra 600MEGA: confirmado que o valor promocional (R$59,90) vale só nos primeiros 3 meses, depois R$89,90/mês no preço "Combinado" (venda casada com plano móvel, que é como a Apex sempre vende) — confirmado que os demais planos de fibra (400MEGA/800MEGA/1GIGA/5GIGA/10GIGA) não têm prazo promocional, é preço cheio direto. Ver seções 1.1 e 5.
- **11/08/2026** — Criada a detecção automática de **Oferta de Convergência**: quando a proposta tem fibra + qualquer linha móvel (renovação, incremento ou portabilidade), o sistema destaca isso com um badge na tela e uma nota no PDF, explicando o bônus de 30GB (Mega Bônus) do book. Corrigido também o aviso desatualizado do seletor de fibra, que dizia "valor avulso" quando na verdade o app sempre usa o preço "Combinado". Ver seções 4.4 e 4.4.1.
- **12/08/2026** — Redesign da tela "Gerar Proposta" (interface, sem mudança de regra de negócio): resumo (valor atual/proposto/redução/Convergência/meta) passou a ficar sempre visível no topo, em vez de só aparecer depois de rolar toda a tela; as seções Renovação, Incremento, Claro Fibra e Claro Passaporte viraram blocos que abrem/fecham (accordion) com um interruptor (toggle) pra ligar/desligar cada item, abrindo sozinhas quando estão ativas e ficando fechadas quando não estão em uso. Objetivo: reduzir a quantidade de informação exibida de uma vez, sem remover nenhum campo ou cálculo existente. Ver seção 15.

## 15. Interface da tela "Gerar Proposta" (redesign 12/08/2026)

Mudança só de interface (front-end) — nenhum campo, cálculo ou regra de negócio foi alterado.

- **Resumo sempre visível no topo**: logo abaixo da "Situação atual" fica um cartão destacado com valor atual, valor proposto, redução na fatura (quando houver), o badge de Oferta de Convergência (ver seção 4.4.1) e o indicador de meta de 10% — antes esse comparativo só aparecia depois de rolar a tela inteira, ao final do formulário.
- **Seções em acordeão**: Renovação/Aquisição, Incremento, Claro Fibra e Claro Passaporte viraram seções que abrem e fecham (`<details>`), cada uma com um interruptor (toggle) para ligar/desligar aquele item da proposta. Uma seção abre sozinha quando está ativa (ex.: Renovação ligada = seção aberta) e fica fechada quando não está em uso (ex.: Passaporte, desligado por padrão) — reduz a rolagem sem esconder nenhuma opção; o consultor pode abrir qualquer seção manualmente a qualquer momento.
- Nenhum id de elemento, checkbox ou função de cálculo foi alterado — só a organização visual, em `renderProposalBody()` e nas classes CSS `.propSection`, `.toggleSwitch` e `.propSummary`. `computeProposal()`, `updateProposalPreview()` e `generateProposalPDF()` continuam exatamente iguais.

### 15.1 Seções opcionais nascem fechadas (menos poluição, 12/08/2026)

Depois do primeiro redesign (15), a tela ainda vinha com Renovação, Incremento e Fibra todas ligadas e abertas de cara — muita informação de uma vez. Ajustado:

- Só a seção **Renovação** nasce aberta (é a ação principal da proposta pro cliente da base). **Incremento** e **Claro fibra** nascem **desligadas e fechadas** — só expandem quando o consultor decide usar (clica no interruptor). Passaporte e o combo de Convergência já nasciam fechados, sem mudança.
- Isso é só o estado inicial: o consultor pode ligar/abrir qualquer seção a qualquer momento, e todos os campos continuam exatamente os mesmos.
- **Alerta de viabilidade da fibra**: mesmo com a seção fechada, quando o cliente está marcado como cabeado na base (`cep_cabeado`), aparece um selo "Endereço cabeado — disponível" ao lado do título "Claro fibra", sempre visível (não precisa abrir a seção pra ver). Isso mantém a regra de negócio de sempre sugerir fibra (seção 4.4) sem forçar a seção aberta pra todo mundo — o consultor vê o alerta e decide se abre.
- Quando o cliente NÃO está marcado como cabeado, não aparece selo nenhum no título (a seção só mostra o aviso de "confirme viabilidade técnica" se o consultor abrir a seção manualmente).
- **12/08/2026** — Adicionados os combos prontos "Destaques Convergentes" (Pág. 5-6 do book) como uma seção opcional na tela de proposta (`CONVERGENCIA_OFERTAS`): o consultor liga o toggle, escolhe um dos 3 combos vendáveis (fibra + móvel) e aplica de uma vez, sem precisar configurar fibra e plano móvel separadamente. O combo fora da área de atuação da Apex (grupo RMG/RPS/RBS/RNE) não entrou na lista. Ficaram de fora, por enquanto, os combos de Fibra + Soluções Digitais (Microsoft 365/Site Pronto — produto novo, não modelado). Ver seção 4.4.2.
- **12/08/2026** — Incidente identificado e corrigido: a base de clientes estava corrompida desde um upload em 11/08/2026 21:35 (planilha com colunas fora da posição esperada — todo cliente ficou com razão social de 1-2 caracteres e CNPJ falso em sequência, ~6.600 registros inválidos). Restaurada a partir dos 1.000 clientes reais preservados no histórico de Movimentação da Base (snapshot "antes" do upload ruim, de 04/08/2026). Backup da base corrompida guardado em tabela separada no Supabase (`clientes_backup_corrompida_20260811`), fora de uso. Buscas voltaram a mostrar dados reais dos clientes.
- **12/08/2026** — Adicionados filtros de busca (Apto / Não apto / Cabeado) como pílulas sempre visíveis abaixo do campo de busca, clique liga/desliga. Apto e Não apto são mutuamente exclusivos; Cabeado é independente. Filtro de GPON/HFC ficou de fora por enquanto (não existe essa informação por cliente na base, só nos KMZ de cobertura). Ver seção 3.1.
- **12/08/2026** — Incremento passou a ter campo de quantidade de linhas por plano, em vez de exigir uma linha por vez: ex. "10 linhas de 40GB" + "20 linhas de 12GB" agora são só 2 grupos (oferta + quantidade), em vez de 30 itens repetidos. Refletido na tela, no resumo e no PDF (item por grupo, com "qtd× GB — valor/linha" e subtotal já multiplicado). Ver seção 4.2.
- **12/08/2026** — Reduzida a poluição visual da tela de proposta: Incremento e Claro fibra passaram a nascer desligadas/fechadas por padrão (só Renovação abre de cara). Claro fibra ganhou um selo de alerta "Endereço cabeado — disponível" no título da seção, visível mesmo fechada, quando o cliente é cabeado — mantém a fibra sempre visível como opção sem forçar a seção aberta pra todo mundo. Ver seção 15.1.
- **21/08/2026** — Renovação passou a suportar múltiplos planos com quantidade de linhas personalizável por plano, mesmo padrão já usado no incremento: ex. cliente com 30 linhas de voz pode renovar "10 linhas de 20GB" + "20 linhas de 10GB" em vez de um único plano igual pra toda a base. Refletido na tela (campo "+ Adicionar plano de renovação"), no resumo e no PDF (item por plano, agrupado). Ligar/desligar o incremento deixou de resetar a divisão de planos de renovação já feita pelo consultor. Ver seção 4.1.
- **21/08/2026** — Adicionada a seção opcional "Outras ofertas" na tela de proposta: **Claro Monitor** (Jornada Mobilidade do book, R$5,00/mês por licença, pré-preenchido com a quantidade de linhas do cliente) e **oferta manual** (produto/serviço + valor unitário + quantidade digitados livremente pelo consultor, pra itens fora do book padrão). Cada item soma no valor total da proposta e aparece como linha própria no resumo e no PDF, sem entrar na régua de meta de comissão de 10%. Ver seção 4.5.1.

## 16. Dashboard de Produção (Apex/Claro)

Aba "Dashboard de Produção" no painel, visível a qualquer perfil logado — e é a **página que abre automaticamente logo após o login** (ver 16.6). Substitui o fluxo antigo (gerar `Dashapex.html` numa conversa separada, a partir do script `update_dashboard.py`, e subir manualmente por FTP no Hostinger) — agora tudo acontece dentro do painel, sem depender de nenhum arquivo publicado externamente.

### 16.1 Upload da planilha do NeoCRM (só admin, na aba "Atualização de Bases")

- O upload da planilha de produção **não fica na aba "Dashboard de Produção"** — fica na aba **"Atualização de Bases"** (mesma aba onde já existia o upload da base de clientes), como mais um card. Só o perfil **admin** vê essa aba e pode enviar a planilha de exportação do NeoCRM (`ExportacaoProducao*.xlsx`). Supervisor e consultor só visualizam o dashboard já pronto na aba "Dashboard de Produção" (e, se não houver nenhuma planilha carregada ainda, veem uma mensagem orientando a pedir pra um administrador atualizar em "Atualização de Bases").
- **Validação antes de aceitar o arquivo**: a planilha precisa ter uma aba "Exportacao" (ou "Exportação") com as colunas GRUPO, PROPRIETÁRIO DO PEDIDO, ETAPA PEDIDO, CADASTRO, ATUALIZACAO e VALOR UNIT — senão o upload é rejeitado com uma mensagem clara, sem tocar nos dados existentes. Isso evita confundir com a planilha de Base de Clientes (que tem aba/colunas completamente diferentes — ver seção 3.2/incidente de 11/08/2026).
- **Bug conhecido da exportação do NeoCRM, contornado no código**: o `!ref` (intervalo de células) que a planilha declara às vezes começa na linha 2, "escondendo" a linha 1 (cabeçalho) do parser — sem a correção, a primeira linha de dados seria lida como se fosse o cabeçalho, e o cabeçalho de verdade desapareceria. O upload força o intervalo a sempre incluir a linha 0 antes de converter (`XLSX.utils.decode_range` + força `range.s.r = 0`). Confirmado com a planilha real do usuário.
- **Pedidos com etapa "ARQUIVADO (NEOCRM)" são sempre excluídos** — são duplicatas de outros pedidos, não entram em nenhum total.
- Cada upload novo **substitui por completo** os dados anteriores (apaga tudo em `producao_pedidos` e insere de novo, em lotes de 500 — mesmo padrão já usado no upload da base de clientes), não é incremental. Antes de confirmar, o admin vê um resumo (quantos pedidos, quantos ganhos/perdidos/andamento/devolvidos) num `confirm()`.
- Depois do upload, o dashboard é recalculado e recarregado automaticamente na mesma tela — não precisa trocar de aba nem recarregar a página.

### 16.2 Categorização das etapas (Ganho / Perdido / Andamento / Devolvido)

- **Ganho**: `CONCLUIDO (NEOCRM)`, `ENTREGA (NEOCRM)`, `FATURAMENTO (NEOCRM)`, `PORTABILIDADE EM ANDAMENTO (NEOCRM)`, `VALIDAÇÃO ESIM (NEOCRM)`. As duas últimas entraram em 24/08/2026: são etapas **pós-aprovação** na esteira da Claro (o pedido já foi aprovado, só falta a portabilidade/o eSIM serem efetivados) — continuar contando como "em andamento" subestimava o resultado real. Mostradas em verde no dashboard, junto com as demais etapas de ganho.
- **Perdido**: `VENDA PERDIDA (NEOCRM)`.
- **Devolvido**: `DEVOLVIDO (NEOCRM)` — **não conta mais como perdido** (mudança de regra deliberada; antes um pedido devolvido era tratado como perda, hoje é categoria própria, separada da taxa de perda).
- **Andamento**: qualquer etapa que não esteja nas listas acima (é o padrão — ex.: `NEGOCIACAO`, `PROPOSTA`, `PORTABILIDADE EM TRATATIVA` — diferente de "em andamento", essa continua sendo tratativa real, ainda sem aprovação —, `CHAMADOS`, `ANTIFRAUDE`, `BIOMETRIA`, etc.).
- `ARQUIVADO (NEOCRM)` não entra em categoria nenhuma — é excluído na extração (ver 16.1).

### 16.2.1 Quantidade de pedidos por etapa (24/08/2026)

A tabela "Valor por Etapa (Total Geral)" ganhou uma coluna **Qtd**, entre Etapa e Valor, mostrando quantos pedidos existem em cada etapa — antes essa contagem só aparecia no hover (tooltip) da barra de valor. A linha de Total no rodapé também soma a quantidade total de pedidos, não só o valor. Não muda nada na extração/categorização (seção 16.2), só a apresentação.

### 16.3 O que o dashboard mostra

Reaproveita 100% do HTML/CSS/JS já testado do `Dashapex.html` (histórico de uso real em produção) — embutido como um template em base64 dentro de `_template.html` (`PRODUCAO_DASHBOARD_TPL_B64`) e renderizado num `<iframe srcdoc="...">` dentro da aba, com os dados vindos do Supabase em vez de um JSON fixo gerado em build-time. Isso evita reescrever ~1.500 linhas de lógica já validada, e evita duas fontes de verdade (arquivo publicado x painel).

- **Aba "Visão Geral"**: KPIs (valor total, pedidos, ticket médio, taxa de perda), insights automáticos, composição por vendedor (Ganho/Andamento/Devolvido/Perdido empilhado), valor por etapa, motivos de perda (por tag), diagnóstico com plano de ação por motivo de perda, valor por etapa detalhado por vendedor, valor por grupo.
- **Aba "Cadastro Diário"**: volume cadastrado por dia (gráfico de barras), calendário de vendas com média por dia da semana, matriz diária por vendedor (dias sem venda em dia útil ficam em vermelho; fins de semana/feriados nacionais — calculados automaticamente, incluindo os móveis — ficam sombreados e não contam como falha), tabela detalhada por dia.
- Filtros por Grupo, período (Cadastro ou Atualização), Vendedor(es) e Etapa — todos combináveis. Por padrão, os grupos **Aparelho, Renovação e Banda Larga** vêm desmarcados (só entram se o usuário marcar manualmente); os demais grupos (Novo, Portabilidade, Transf. Titularidade) vêm marcados.
- Clicar em qualquer barra, célula, linha de tabela ou segmento do gráfico abre um detalhamento (drilldown) com a lista de pedidos por trás daquele número, exportável para Excel.

### 16.4 Visibilidade de Cliente/CNPJ (LGPD)

- **Cliente e CNPJ/CPF só aparecem no detalhamento (drilldown) para admin e supervisor.** Consultor vê o dashboard normalmente (KPIs, gráficos, composição por vendedor), mas nunca esses dois campos.
- Essa restrição é aplicada na própria consulta ao Supabase (`select` só pede as colunas `cliente`/`cnpj` quando o perfil logado é admin ou supervisor) — não é só uma coluna escondida na tela: quem não tem permissão nunca recebe esse dado na resposta.
- Diferente da base de clientes (onde CNPJ/razão social já é visível a qualquer perfil logado, porque o consultor precisa disso pra buscar e propor — ver seção 3), aqui a restrição é mais rígida porque os registros de produção podem envolver clientes fora da carteira do consultor.

### 16.5 Schema (Supabase)

- Tabela `producao_pedidos`: um registro por linha de pedido da planilha (`numero_pedido`, `grupo`, `usuario`, `etapa`, `cadastro`, `atualizacao`, `valor`, `quantidade`, `produto`, `cliente`, `cnpj`, `tag`). RLS: `select` liberado pra qualquer perfil autenticado (a restrição de cliente/cnpj é feita na consulta, ver 16.4); `insert`/`update`/`delete` só para admin.
- A tabela `config` (já usada para a chave do Google Maps) ganhou a chave `producao_atualizado_em`, atualizada a cada upload — é o texto "Atualizado em: ..." que aparece no topo do dashboard.

### 16.6 Organização das abas e página inicial pós-login (24/08/2026)

- A aba antes chamada **"Movimentação da Base"** foi renomeada para **"Atualização de Bases"** — ela concentra os dois uploads administrativos do painel: a planilha de exportação de produção do NeoCRM (card novo, adicionado no topo) e a planilha da base de clientes (cards que já existiam: resumo dos últimos 30 dias, entradas x saídas por dia, tabela de detalhe). Continua visível só para admin.
- O card de upload da planilha de produção **saiu da aba "Dashboard de Produção"** e passou a viver dentro de "Atualização de Bases" — a aba "Dashboard de Produção" ficou só com a visualização (iframe do dashboard), sem nenhum controle administrativo, pra não misturar "ver os números" com "atualizar os dados" na mesma tela.
- **Dashboard de Produção passou a ser a página inicial pós-login**: assim que o usuário entra (qualquer perfil), o painel já abre direto nessa aba, em vez de "Buscar Clientes" como era antes. A ideia é que a primeira coisa que qualquer pessoa da Apex vê ao logar seja o retrato atual da produção. As demais abas continuam acessíveis normalmente pelo menu.

### 16.7 Largura da tela (24/08/2026)

O Dashboard de Produção reaproveita o layout do `Dashapex.html` original, pensado pra ocupar a tela cheia (KPIs, gráficos e tabelas lado a lado). Como o restante do painel usa uma largura de leitura de 1000px (boa pra formulários e listas, mas estreita demais pra esse dashboard), só essa aba passou a usar uma largura maior — até 1600px em telas grandes, ou 96% da largura da janela em telas menores — enquanto as demais abas (Buscar Clientes, Gerar Proposta, Funil, etc.) continuam com os mesmos 1000px de sempre. A troca de largura acontece automaticamente ao entrar ou sair da aba Dashboard de Produção (classe `mainWide` no `<main>`), sem precisar de nenhuma configuração do usuário.

### 16.8 Bug de acentuação corrigido (24/08/2026)

O template embutido (`PRODUCAO_DASHBOARD_TPL_B64`) é decodificado no navegador com `atob()`. Só que `atob()` sozinho não reconhece UTF-8 — ele decodifica o base64 pra uma "string de bytes" (1 caractere por byte), então qualquer acento dentro do template (por exemplo "VALIDAÇÃO", travessões) virava caractere corrompido no HTML final. Isso ficou mais visível ao adicionar `VALIDAÇÃO ESIM (NEOCRM)` na categorização de ganho (ver 16.2): o texto acentuado embutido no template não batia com o texto correto vindo dos dados, então a categorização falhava silenciosamente pra essa etapa. Corrigido decodificando os bytes do base64 e remontando o texto com `TextDecoder('utf-8')` em vez de usar a string do `atob()` direto — sem isso, qualquer acento em textos futuros do dashboard corre o mesmo risco.

### 16.9 Analítico (drilldown) aparecendo longe da tela — corrigido (24/08/2026)

Ao clicar numa barra, célula ou linha pra abrir o detalhamento (drilldown), o modal muitas vezes aparecia bem abaixo na rolagem — às vezes nem aparecia na tela, obrigando o usuário a descer bastante pra encontrá-lo. Causa raiz: o dashboard roda dentro de um `<iframe>` embutido no painel, e o modal usava `position:fixed` — que, dentro de um iframe, fica preso ao **meio da caixa inteira do iframe** (que pode passar de vários milhares de pixels de altura), não à parte que o usuário está efetivamente vendo na tela do navegador. Corrigido em duas frentes complementares:

- **Altura do iframe ajustada automaticamente ao conteúdo real** (em vez de uma altura mínima fixa de 2400px): elimina um scroll "duplo" (o da página e um scroll interno do próprio iframe), unificando tudo numa rolagem só. Reajusta sozinho quando o conteúdo muda de tamanho (troca de aba interna Visão Geral/Cadastro Diário, filtros, etc.), via `ResizeObserver`.
- **O modal do analítico passou a se reposicionar sozinho**: como o painel e o dashboard embutido são do mesmo domínio (apexsmart.com.br), o template consegue enxergar, via JavaScript, qual pedaço do iframe está atualmente visível na janela do navegador (usando `window.frameElement`/`window.parent`) e posiciona o modal exatamente ali — tanto ao abrir quanto quando a página rola com o modal já aberto. Se por algum motivo o dashboard for aberto sozinho (fora do painel, como está o `Dashapex.html` original), o comportamento antigo (`position:fixed` centralizado) continua funcionando normalmente.
- **Rolagem própria dentro do card do analítico** (24/08/2026): o limite de altura do card (`max-height:85vh`) usava a unidade `vh`, que corresponde à altura do iframe *inteiro* — e como o iframe agora acompanha o conteúdo real (ponto acima), isso podia passar de vários milhares de pixels, deixando o card gigante e sem rolagem própria quando havia muitos pedidos, ao invés de manter cabeçalho/título fixos e só a lista rolando por dentro. Corrigido calculando o limite de altura do card a partir do tamanho real da tela do usuário (~85% da altura visível), e corrigido também um problema de CSS (flexbox) que impedia a lista de fato rolar dentro do card em vez de simplesmente crescer.
- **Menos rolagem horizontal no card do analítico** (24/08/2026): a tabela de detalhamento tem até 10 colunas (8 pro consultor, +Cliente/+CNPJ pro admin — ver 16.4), e algumas delas (Etapa, Vendedor, Motivo) podem ter texto mais longo. Antes, todas as colunas ficavam numa linha só (sem quebrar), o que empurrava a tabela pra além da largura do card e forçava rolagem horizontal com frequência. Corrigido em duas frentes: o card ficou mais largo (1150px → 1400px, aproveitando que a aba já ocupa mais tela — ver 16.7), e as colunas de texto mais longo (Etapa, Vendedor, Motivo, Cliente) passaram a quebrar linha em vez de esticar a tabela — as colunas compactas por natureza (Pedido, Grupo, datas, Valor, CNPJ) continuam numa linha só. A rolagem horizontal continua existindo como recurso pra casos extremos (ex.: tela pequena + modo admin com todas as colunas), mas deixa de ser o comportamento padrão.

### 16.10 Horário de Cadastro/Atualização 3h adiantado no analítico — corrigido (27/08/2026)

Reportado pelo usuário: no detalhamento (drilldown), o horário das colunas "Cadastro" e "Atualização" de cada pedido não batia com o horário real de São Paulo. **Era um bug do sistema** (não da planilha do NeoCRM) — a planilha sempre trouxe o horário certo, o problema estava em como o painel gravava esse horário no banco.

**Causa raiz**: a função `parseDataProducao()` (upload da planilha, aba "Upload Dash") convertia CADASTRO/ATUALIZACAO pra uma string ISO **sem indicar o fuso horário** (ex.: `"2026-08-04T19:27:39"`, sem `Z` nem offset). As colunas `cadastro`/`atualizacao` no Supabase são do tipo `timestamptz`, e a sessão do banco roda em **UTC** — então, ao gravar uma hora sem fuso, o Postgres assumia que já era UTC. Só que aquele "19:27:39" era hora de **São Paulo** (UTC-3), não UTC. Resultado: todo horário salvo ficava gravado 3h **adiantado** em relação ao instante real — e, ao exibir de volta (convertendo UTC → horário local do navegador), aparecia 3h **atrasado** em relação ao horário real da planilha. Confirmado direto no banco: a sessão do Supabase realmente roda em `TimeZone = UTC`, e os registros existentes tinham exatamente esse desvio de 3h.

**Correção**:
- `parseDataProducao()` agora grava o offset `-03:00` explicitamente em toda data que monta (nos três formatos de entrada: texto `dd/mm/aaaa[ HH:MM:SS]`, data nativa do Excel, e serial numérico) — o Postgres passa a converter certo pra UTC internamente. Como o Brasil aboliu o horário de verão em 2019, esse offset é fixo o ano inteiro (não precisa calcular DST).
- Reforço na exibição: tanto o `fmtDate()` do Dashboard de Produção (template embutido) quanto o "Atualizado em" do topo do dashboard (gerado no upload) passaram a fixar `timeZone: 'America/Sao_Paulo'` explicitamente na formatação, em vez de depender do fuso configurado no computador de quem está vendo/atualizando o painel — segue o mesmo padrão já usado na Edge Function `sync-leads` (seção 17.6).
- **Dados já gravados foram corrigidos**: rodado um `UPDATE` direto no Supabase somando 3h em `cadastro` e `atualizacao` de todos os 665 registros existentes em `producao_pedidos` (todos tinham o mesmo desvio, porque cada upload sempre substitui a tabela inteira — ver 16.1 — então não havia registro gravado de forma diferente). Não foi necessário mexer na planilha de origem nem pedir reenvio.
- Próximos uploads já gravam certo automaticamente, sem precisar de nenhum ajuste manual.

### 16.11 Visão Diária — desempenho hora a hora, com Modo TV (01/09/2026)

Nova aba interna **"Visão Diária"** dentro do Dashboard de Produção (ao lado de "Visão Geral" e "Cadastro Diário"), pensada especificamente para ficar **maximizada numa TV na operação**, mostrando o desempenho da equipe hora a hora — quem visita a operação consegue acompanhar o ritmo do dia em tempo real sem precisar de um consultor navegando no painel.

- **Dia selecionável**: um campo de data no topo permite ver qualquer dia (não fica travado em "hoje"), útil tanto pra acompanhar o dia corrente na TV quanto pra revisar um dia específico depois.
- **Métricas por hora** (00h a 23h, sempre as 24 horas, mesmo as sem nenhum pedido): quantidade de contratos (barra), quantidade de linhas (número abaixo de cada barra) e valor por contrato — ticket médio (linha sobreposta ao gráfico de barras). A hora atual (quando o dia selecionado é hoje) fica destacada visualmente. Clicar numa barra/hora abre o mesmo modal de analítico (drilldown) já usado nas outras abas, filtrado só pelos pedidos daquela hora.
- **Ranking por consultor** e **ranking por produto**: dois "leaderboards" lado a lado, ordenados por quantidade de contratos no dia, com destaque (ouro/prata/bronze) pros três primeiros e barra de proporção — pensados pra gerar competição saudável quando exibidos na TV.
  - O ranking por produto usa o campo `grupo` (6 categorias: VOZ - Portabilidade, VOZ - Renovação, VOZ - Novo, BANDA LARGA - Novo, VOZ - Tranf. Titularidade, APARELHO), não o campo `produto` (15+ SKUs granulares) — granularidade adequada pra leitura rápida numa tela de TV.
- **KPIs do dia**: cards com o total de contratos, linhas, valor total e ticket médio do dia selecionado, no topo da aba.
- **Fuso horário**: todo o bucketing de data/hora (tanto pra decidir quais pedidos pertencem ao dia selecionado quanto pra agrupar por hora) usa o horário de São Paulo calculado via `Intl.DateTimeFormat`, nunca cortando a string ISO bruta — evita reintroduzir, numa aba nova, o mesmo tipo de bug corrigido na seção 16.10 (um pedido cadastrado às 22h de um dia em São Paulo cai corretamente nesse dia, mesmo já sendo o dia seguinte em UTC).
- **Modo TV**: botão que ativa a tela cheia do próprio dashboard (Fullscreen API), ampliando fontes e escondendo elementos secundários — pensado pra ligar numa TV da operação e deixar rodando o dia todo. Como o dashboard roda dentro de um `<iframe>` do mesmo domínio, foi necessário adicionar os atributos `allowfullscreen allow="fullscreen"` no iframe externo (`producaoFrame`) pra que a chamada de tela cheia feita de dentro do iframe funcione — sem isso, o navegador bloqueia o pedido de tela cheia por política de permissões do iframe.
- **Atualização automática a cada 1 hora**: o painel externo busca os dados de `producao_pedidos` de novo no Supabase a cada hora e envia pro dashboard embutido através de uma função exposta pelo próprio iframe (`window.atualizarDadosDashboard`), em vez de recarregar o iframe inteiro — isso preserva o Modo TV ligado e o dia selecionado, que se perderiam com um recarregamento completo (o Modo TV, em particular, sairia da tela cheia a cada atualização).
- **Limitação conhecida**: as listas de filtro (checkboxes de consultor/grupo/etapa) das abas "Visão Geral" e "Cadastro Diário" são montadas uma única vez, a partir dos dados carregados no primeiro carregamento da página — se um consultor ou grupo novo aparecer só numa atualização automática horária, ele não ganha um checkbox novo até a próxima vez que a página for recarregada. A própria Visão Diária **não é afetada** por essa limitação, porque lê os dados brutos diretamente, sem passar pelos checkboxes de filtro.

#### 16.11.1 Cards "Por tipo de venda" (01/09/2026)

Logo abaixo dos KPIs gerais do dia, quatro cards mostram a quantidade de contratos do dia separada por categoria de venda — pedido do usuário, pra ter uma leitura rápida e organizada do mix do dia (em vez de só o total misturado):

- **Banda Larga** — grupo `BANDA LARGA - Novo`
- **Migração (Titularidade)** — grupo `VOZ - Tranf. Titularidade` (transferência de titularidade do contrato)
- **Portabilidade** — grupo `VOZ - Portabilidade` (adicionado em 01/09/2026, separado da Linha Nova a pedido do usuário)
- **Linha Nova** — grupo `VOZ - Novo`
- **Renovação** — grupo `VOZ - Renovação`

Os cards usam o mesmo campo `grupo` já usado no ranking "Por produto" (seção 16.11), na ordem acima, cada uma com o número de contratos do dia. Cada card é clicável e abre o mesmo modal de analítico (drilldown) usado no resto da aba, filtrado só pelos pedidos daquela categoria no dia selecionado. Em dias sem nenhum pedido de uma categoria, o card continua aparecendo, só que zerado — não some da tela. **Atualizado em 15/09/2026** — ver seção 16.11.3: os cards agora cobrem todos os grupos conhecidos (Aparelho e SVA Fixa entraram), então a soma dos cards sempre bate com o total de contratos/produtos do dia.

#### 16.11.2 Card "Produtos" e layout condensado (01/09/2026)

O segundo card de KPI no topo da aba (logo abaixo do botão Modo TV), que mostrava "Linhas", foi renomeado para **"Produtos"** — mesmo número (soma do campo `quantidade` de todos os pedidos do dia), só com um rótulo mais genérico, já que nem toda categoria representa uma linha de voz (banda larga e aparelho, por exemplo).

Pedido do usuário: caber todas as informações da Visão Diária numa tela só, sem precisar rolar — importante porque a aba é pensada pra ficar ligada numa TV da operação. Reduzido o espaçamento (padding, gap, margem) dos cards de KPI, dos cards "Por tipo de venda", dos títulos/textos de seção e do gráfico hora a hora (altura de 200px para 130px, mantendo a proporção do overlay da linha de ticket médio). Essas reduções valem **só dentro da Visão Diária** (regra CSS com escopo `body.tab-diaria`), pra não encolher os cards e títulos que essas mesmas classes (`.cards`, `.card`, `.section-title`, `.section-sub`) já usavam nas abas Visão Geral e Cadastro Diário.

O Modo TV (seção 16.11) também teve sua ampliação de fontes reduzida (o card de valor, por exemplo, foi de 42px para 28px), porque a versão anterior, otimizada só pra legibilidade à distância, ficava alta demais e voltava a exigir rolagem quando ligada em tela cheia — mesmo com o restante do dashboard condensado.

Como o ranking por consultor pode crescer bastante (um consultor por linha) e não tem um limite natural de itens, ele ganhou altura máxima (230px fora do Modo TV, 280px dentro) com rolagem própria — garante que o resto da tela (KPIs, cards por tipo de venda e gráfico hora a hora) sempre fique visível de uma vez, mesmo que a lista de consultores ou de produtos seja longa.

#### 16.11.3 Aparelho e SVA Fixa: cards que fecham a soma com o total (15/09/2026)

**Sintoma reportado pelo usuário** (com print): na Visão Diária, a soma dos 5 cards "Por tipo de venda" não batia com o total mostrado nos KPIs "Contratos"/"Produtos" do topo (ex.: cards somavam 13, KPI mostrava 14).

**Causa raiz**: os 5 cards cobriam só 5 dos grupos possíveis (Banda Larga, Migração/Titularidade, Portabilidade, Linha Nova, Renovação). `APARELHO` nunca teve card próprio (só aparecia no ranking "Por produto", mais embaixo) — limitação conhecida, documentada desde a criação dos cards (seção 16.11.1). No dia em questão apareceu também `SVA FIXA`, um grupo **novo** vindo da exportação do NeoCRM, que também não batia em nenhum dos 5 cards nem tinha sido antecipado.

**Correção**: adicionados os cards **Aparelho** (grupo `APARELHO`) e **SVA Fixa** (grupo `SVA FIXA`) à lista `DIARIA_TIPOS_VENDA`, na mesma mecânica dos outros 5 (clicável, abre o analítico filtrado, zera sem sumir em dias sem pedido daquele tipo). Agora são 7 cards, e a soma bate com o total do dia.

**Limitação que continua**: se o NeoCRM criar mais um grupo novo no futuro (como aconteceu agora com SVA FIXA), a soma volta a não bater até alguém adicionar o card correspondente manualmente em `DIARIA_TIPOS_VENDA` — foi avaliado um card catch-all "Outros" que somaria automaticamente qualquer grupo não mapeado (sem precisar de manutenção a cada categoria nova), mas o usuário preferiu cards nomeados específicos, então essa manutenção manual continua sendo necessária quando o NeoCRM introduzir uma categoria de grupo nova.

### 16.12 Pedidos duplicados na exportação do NeoCRM — dedup de linhas 100% idênticas (10/09/2026)

Usuário reportou (com print) o mesmo `numero_pedido` (49541316, cliente EDERSON GONCALVES DIAS DOS SANTOS) aparecendo 3 vezes idêntico no analítico. Investigação direto no banco encontrou 112 `numero_pedido` com mais de uma linha, divididos em dois padrões bem diferentes:

- **Cópias 100% idênticas** — a mesma linha (grupo, produto, valor, etapa, datas, usuário, cliente, CNPJ, tag, tudo igual) repetida 2 ou mais vezes pro mesmo pedido, sem nenhuma diferença. Esse é exatamente o caso do print (pedido 49541316). Contando linha a linha (não só pedido a pedido — um pedido pode ter uma parte legítima e ainda assim ter uma linha repetida dentro dela), são **135 linhas em excesso, espalhadas por 84 pedidos**. Confirmado que não é erro de reenvio (o upload já apaga a tabela inteira antes de reinserir) — a duplicação vem da própria planilha exportada pelo NeoCRM.
- **Pedidos com linhas de produtos DIFERENTES** (56 pedidos) — ex.: um pedido com uma linha "VOZ - Portabilidade" + uma linha "APARELHO" (chip + aparelho na mesma venda), ou "VOZ - Renovação" + "VOZ - Novo" (produtos diferentes dentro do mesmo pedido). O campo `QUANTIDADE` não guarda nenhum total agregado (é sempre "1" em toda linha, mesmo nessas), então não existe hoje uma forma de saber o "total de produtos" sem juntar as linhas manualmente. Essas linhas continuam intactas — só as cópias exatas (padrão acima) são removidas, mesmo quando aparecem dentro de um pedido que também tem linhas legitimamente diferentes.

**Decisão (confirmada com o usuário em 10/09/2026):** só o primeiro padrão (cópias exatas) é bug — foi corrigido. O segundo padrão foi **mantido como está**, porque o card "Por tipo de venda" da Visão Diária (seção 16.11.1) já conta exatamente por linha/`grupo` — juntar essas linhas num pedido só faria esse card parar de contar corretamente quantas portabilidades/aparelhos/etc. saíram no dia. Ou seja: linhas com o mesmo `numero_pedido` mas produtos/grupos diferentes **não são duplicidade**, são componentes distintos da mesma venda.

**Fix**: `extractProducaoRecords()` agora descarta, no momento da extração (antes de gravar no Supabase), qualquer linha cujos campos (`numero_pedido`, `grupo`, `usuario`, `etapa`, `cadastro`, `atualizacao`, `valor`, `quantidade`, `produto`, `cliente`, `cnpj`, `tag`) batem 100% com uma linha já vista na mesma planilha — mantém só 1 ocorrência. Linhas com qualquer campo diferente (mesmo que só o `produto`/`valor`/`grupo`) continuam todas, porque representam produtos distintos dentro do pedido.

**Limpeza dos dados já existentes**: as 135 linhas em excesso já gravadas em `producao_pedidos` (cópias exatas, mesmo dentro de pedidos que também têm linhas legítimas diferentes) foram removidas do banco com uma limpeza pontual (mantendo sempre 1 linha por combinação idêntica), com autorização do usuário — as linhas de produtos genuinamente diferentes não foram tocadas.

#### 16.12.1 REVERTIDO no mesmo dia (10/09/2026) — linhas idênticas também podiam ser vendas reais

Horas depois de publicado, o usuário reportou que o dia 09/09 teve **21 linhas de entrada reais**, e o Dashboard de Produção, já com o dedup ativo, mostrava só **14** pra esse dia — confirmado direto no banco (`cadastro` de 09/09: 14 linhas, contra as 21 que realmente entraram). Ou seja, o dedup da seção 16.12 removeu linhas que eram vendas/entradas de verdade, só porque coincidiam em todos os campos com outra linha — a suposição de que "todos os campos iguais = cópia de erro" estava errada: o NeoCRM não garante nenhuma unicidade nesse sentido, e linhas idênticas podem representar registros distintos e válidos.

**Reversão**: `extractProducaoRecords()` voltou a manter **todas** as linhas da planilha, sem nenhum dedup — cada linha da exportação do NeoCRM vira 1 registro em `producao_pedidos`, ponto. O caso original do pedido 49541316 (3 linhas idênticas) não é mais tratado como bug.

**Dados perdidos**: as 135 linhas removidas na limpeza da seção 16.12 não foram recuperadas por aqui (a limpeza foi um `DELETE` direto no banco, sem backup do banco em si — só o HTML do painel tem backup automático a cada deploy). Como o upload da planilha de produção sempre apaga `producao_pedidos` por inteiro e recarrega do zero a partir da exportação do NeoCRM (ver seção 16.1), a forma correta de restaurar o estado real é o admin **subir de novo a planilha atual do NeoCRM** em "Upload Dash" — com o código já revertido, isso recarrega tudo (inclusive as linhas "idênticas" que antes eram descartadas) fiel ao que está no NeoCRM hoje.

- **24/08/2026** — Criado o Dashboard de Produção dentro do painel (nova aba, visível a qualquer perfil logado): substitui o fluxo antigo de gerar `Dashapex.html` numa conversa separada e subir por FTP no Hostinger. Admin sobe a planilha de exportação do NeoCRM direto na aba; os dados são validados, extraídos e categorizados (Ganho/Perdido/Andamento/Devolvido — Devolvido deixou de contar como perdido), substituem por completo `producao_pedidos` no Supabase, e o dashboard é recalculado na hora. Reaproveita 100% do HTML/CSS/JS já testado do Dashapex.html (embutido em base64, renderizado num iframe). Cliente/CNPJ no detalhamento só aparecem pra admin e supervisor (LGPD). Corrigido também um bug real da exportação do NeoCRM (o intervalo declarado da planilha às vezes esconde a linha de cabeçalho). Ver seção 16.
- **24/08/2026** — Reorganização das abas: o upload da planilha de produção saiu da aba "Dashboard de Produção" e foi pra "Atualização de Bases" (antiga "Movimentação da Base", renomeada); Dashboard de Produção virou a página inicial que abre automaticamente após o login, pra qualquer perfil. Ver seção 16.6.
- **24/08/2026** — Dashboard de Produção: a aba passou a usar uma largura maior de tela (só essa aba, as demais continuam com a largura padrão), pra não ficar espremida — ver seção 16.7. A tabela "Valor por Etapa (Total Geral)" ganhou uma coluna com a quantidade de pedidos por etapa, além do valor e do percentual — ver seção 16.2.1.
- **24/08/2026** — Dashboard de Produção: `PORTABILIDADE EM ANDAMENTO (NEOCRM)` e `VALIDAÇÃO ESIM (NEOCRM)` passaram a contar como ganho (verde), por serem etapas pós-aprovação na esteira da Claro — ver seção 16.2. Corrigido também um bug de acentuação no decode do template embutido (`atob()` sozinho corrompia acentos como "VALIDAÇÃO"), que fazia essa categorização falhar silenciosamente dentro do dashboard — ver seção 16.8.
- **24/08/2026** — Corrigido o modal do analítico (drilldown) aparecendo longe da área visível da tela ao clicar numa barra/célula: a altura do iframe do dashboard agora se ajusta ao conteúdo real (sem scroll duplo), e o modal se reposiciona sozinho pra sempre aparecer dentro do que o usuário está vendo, mesmo rolando a página com o modal aberto. Ver seção 16.9.
- **24/08/2026** — Corrigido o card do analítico ficando gigante (sem rolagem própria) quando tinha muitos pedidos: o limite de altura agora usa o tamanho real da tela do usuário, e a lista de pedidos passou a rolar por dentro do card (cabeçalho e título fixos), em vez do card só crescer. Ver seção 16.9.
- **24/08/2026** — Reduzida a rolagem horizontal no card do analítico: card mais largo (1150px → 1400px) e colunas de texto mais longo (Etapa, Vendedor, Motivo, Cliente) passaram a quebrar linha em vez de esticar a tabela — colunas compactas (Pedido, Grupo, datas, Valor, CNPJ) continuam numa linha só. Ver seção 16.9.
- **24/08/2026** — Corrigida a busca de clientes por CNPJ sem formatação (digitando só números não encontrava o cliente, porque o CNPJ é sempre salvo com pontos/barra/traço): nova coluna gerada `cnpj_digits` no Supabase, incluída na busca — funciona com CNPJ completo ou parcial, formatado ou não. Ver seção 3.0.1.
- **26/08/2026** — Criada a aba "Digital" (só admin e supervisor): dashboard com os leads de campanhas Facebook/Instagram, vindos de uma planilha do Google, mostrando KPIs gerais, conversão por consultor e funil por status. Botão "Atualizar agora" busca a planilha na hora, via Edge Function `sync-leads`. Ver seção 17.
- **26/08/2026** — Aba renomeada de "Conversão de Vendas" para "Digital" e apresentação dos números modernizada (cards de KPI com barra de progresso, gráfico doughnut do funil por categoria, barras visuais de percentual e badges coloridos por categoria nas tabelas). Ver seção 17.7.
- **26/08/2026** — Menu principal reordenado (Dashboard, Digital, Buscar Clientes, Cobertura, Gerar Proposta, Funil, Upload Base, Upload Dash, Usuários) e várias abas renomeadas (Verificar Cobertura → Cobertura, Funil de Vendas → Funil, Base de Dados → Upload Base, Atualização de Bases → Upload Dash, Consultores → Usuários). Visual do menu modernizado: pílulas com ícone, aba ativa com fundo sólido na cor da marca, rolagem horizontal própria. Ver seção 18.
- **27/08/2026** — Corrigido bug de fuso horário no Dashboard de Produção: os horários de Cadastro/Atualização no analítico (drilldown) apareciam 3h atrasados em relação ao horário real de São Paulo, porque o upload gravava a hora sem indicar o fuso e a sessão do Supabase roda em UTC. Corrigido gravando o offset `-03:00` explicitamente, reforçada a exibição fixando `America/Sao_Paulo`, e corrigidos os 665 registros já gravados com o horário errado. Ver seção 16.10.
- **01/09/2026** — Criada a aba "Visão Diária" dentro do Dashboard de Produção, feita pra ficar maximizada numa TV na operação: dia selecionável, desempenho hora a hora (contratos, linhas e ticket médio) com clique pra abrir o analítico daquela hora, ranking por consultor e por produto (agrupado por `grupo`), Modo TV (tela cheia) e atualização automática dos dados a cada 1 hora sem perder o Modo TV nem o dia selecionado. Ver seção 16.11.
- **01/09/2026** — Visão Diária ganhou 4 cards clicáveis "Por tipo de venda" (Banda Larga, Migração/Titularidade, Linha Nova, Renovação), mostrando a quantidade de contratos do dia separada por categoria, cada um abrindo o analítico filtrado ao clicar. Ver seção 16.11.1.
- **01/09/2026** — Visão Diária: card de KPI "Linhas" renomeado para "Produtos"; layout condensado (cards, títulos, gráfico hora a hora) pra caber tudo numa tela só sem rolar, Modo TV com fontes menos ampliadas, e ranking por consultor/produto com altura máxima e rolagem própria. Ver seção 16.11.2.
- **01/09/2026** — Visão Diária: cards "Por tipo de venda" passaram de 4 para 5 — "Linha Nova" foi dividida em "Portabilidade" (grupo `VOZ - Portabilidade`) e "Linha Nova" (grupo `VOZ - Novo`), cada uma com seu próprio card. Ver seção 16.11.1.
- **01/09/2026** — Consultor passou a ver todas as abas do painel, exceto "Upload Base", "Upload Dash" e "Usuários" — na prática, a única mudança foi liberar a aba "Digital" (antes só admin/supervisor). Cliente/CNPJ no Dashboard de Produção e o botão "Atualizar agora" da aba Digital continuam restritos a admin/supervisor. Ver seção 2.1.
- **04/09/2026** — Corrigido erro "Edge Function returned a non-2xx status code" ao sincronizar a aba Digital: a planilha do Google passou a ter uma linha extra antes do cabeçalho de verdade, fazendo a coluna "id" puxar o nome do consultor (duplicado) em vez do id do lead, o que quebrava o upsert no banco. A função `sync-leads` agora localiza a linha de cabeçalho pelo conteúdo (não assume que é sempre a linha 1), corrige o rótulo da coluna de id e de-duplica antes de gravar; o painel também passou a mostrar a mensagem de erro real da função, em vez do texto genérico. Ver seção 17.1.1.
- **09/09/2026** — Corrigido: leads de setembro não apareciam na aba Digital. O time passou a criar uma aba nova por mês na planilha de origem, e a sincronização buscava só a "aba padrão" (a mais à esquerda), que virou a de Setembro e deixou de trazer Agosto. Uma primeira correção (buscar por nome via endpoint gviz) causou um novo bug — esse endpoint corrompia o cabeçalho especificamente da aba de Agosto. A correção final busca cada aba pelo **gid** (exportação direta, sem a detecção "esperta" de cabeçalho do gviz), consolidando Agosto + Setembro num total só — abas de meses futuros só precisam ser adicionadas na lista `SHEET_TABS` (com o gid copiado da URL da planilha). Ver seção 17.1.2.
- **09/09/2026** — Adicionado filtro de período na aba Digital: pílulas de atalho (Tudo/Hoje/Últimos 7 dias/Este mês) e campos De/Até editáveis, recalculando todos os números (KPIs, gráfico, tabelas) em memória sobre os leads já carregados — o filtro de um único dia é o caso De igual a Até (não é um controle separado). Ver seção 17.8.
- **10/09/2026** — Corrigido pedido aparecendo duplicado no analítico do Dashboard de Produção (reportado com print, pedido 49541316 3x idêntico): `extractProducaoRecords()` passou a descartar linhas 100% idênticas na extração da planilha do NeoCRM. Pedidos com várias linhas de produtos genuinamente diferentes (ex.: aparelho + plano no mesmo pedido) continuaram com uma linha por produto. Ver seção 16.12.
- **10/09/2026** — REVERTIDO no mesmo dia: o dedup acima apagou linhas reais (dia 09/09 tinha 21 linhas de entrada, o dashboard com o dedup mostrou só 14). `extractProducaoRecords()` voltou a manter todas as linhas da planilha, sem nenhuma deduplicação — linhas idênticas podem ser vendas/entradas distintas de verdade, o NeoCRM não garante unicidade. Recomendado reenviar a planilha atual do NeoCRM em "Upload Dash" pra restaurar as linhas perdidas na limpeza feita mais cedo. Ver seção 16.12.1.
- **14/09/2026** — Corrigido erro "HTTP 400" ao sincronizar a aba Digital: a aba de Setembro foi recriada na planilha de origem e ganhou um gid novo, invalidando o gid antigo configurado em `SHEET_TABS`. Gid corrigido e adicionada também a aba "REPIQUE" (novo lote de recontato) à sincronização. Edge Function `sync-leads` reimplantada. Ver seção 17.1.3.
- **15/09/2026** — Corrigido: a soma dos cards "Por tipo de venda" da Visão Diária não batia com o total de Contratos/Produtos do dia. Causa: os grupos `APARELHO` (limitação conhecida) e `SVA FIXA` (categoria nova do NeoCRM) não tinham card próprio. Adicionados os cards "Aparelho" e "SVA Fixa" — agora são 7 cards, cuja soma sempre bate com o total. Ver seção 16.11.3.

### 16.13 "Contratos" contava linha, não pedido — corrigido pra usar numero_pedido (18/09/2026)

Usuário notou (com print) que os cards "Contratos" e "Produtos" da Visão Diária sempre mostravam o mesmo número (15 e 15). Causa: `totalContratos` era `rows.length` — ou seja, contava **linhas** da planilha, exatamente a mesma coisa que "Produtos" (a coluna `QUANTIDADE` do NeoCRM é sempre "1" em cada linha, então somar quantidade também dá o total de linhas). Um pedido com mais de um produto (ex.: portabilidade + aparelho na mesma venda — padrão já documentado na seção 16.12) sempre foi contado como 2+ "contratos", quando é 1 só.

**Correção**: `totalContratos` passou a contar `numero_pedido` **distintos** no dia (via `pedidoKey()`, nova função — linha sem `numero_pedido` preenchido vira uma chave única por linha, pra nunca juntar duas linhas sem pedido por engano). Validado direto no banco: o dia usado no print (15 linhas) tinha só **11 `numero_pedido` distintos** — o card devia mostrar Contratos: 11, Produtos: 15.

Fixes aplicados em 3 pontos do mesmo arquivo (`PRODUCAO_DASHBOARD_TPL_B64`, o Dashapex embutido em base64):
- KPI do topo (`totalContratos`).
- Barra por hora (`porHora[h].contratos`) — as linhas de um mesmo pedido na mesma hora agora contam como 1 contrato na barra, não uma barra "inflada".
- Ranking "Por consultor" / "Por produto" (`agruparDiariaPor`) — o texto "X contratos" ao lado de cada consultor/produto também passou a contar pedido distinto, não linha (achado ao revisar o mesmo bug espalhado pelo arquivo; a soma "linhas" continua mostrando o total de produtos, sem mudança).

**Por que `numero_pedido` e não CNPJ** (opção cogitada pelo usuário): `numero_pedido` já é o identificador de venda do próprio NeoCRM — CNPJ agrupa por *cliente*, não por *venda*, então em tese poderia juntar dois pedidos genuinamente separados do mesmo cliente no mesmo dia como se fossem 1 contrato só. Conferido no banco (dia do print): hoje os dois critérios dão o mesmo resultado (11), mas `numero_pedido` é a opção mais correta a longo prazo.

Testado com um cenário sintético (pedido com 2 linhas — portabilidade + aparelho — na mesma hora): KPI, barra da hora e ranking por consultor todos mostram 1 contrato / 2 produtos, não 2/2. Ver `test_visao_diaria.js`, bloco 7.3.

- **18/09/2026** — Corrigido "Contratos" da Visão Diária contando linha em vez de pedido (sempre idêntico a "Produtos"): passou a contar `numero_pedido` distinto — no KPI, na barra por hora e no ranking por consultor/produto. Ver seção 16.13.

### 16.14 Aba "Fechamento" (admin) — relatório de ativações pra comissionamento (18/09/2026)

Pedido do usuário: *"criar uma aba fechamento somente para o perfil administrador onde a data de ativação da linha deve ser verificada na coluna portabilidade, para a banda larga fica em data de instalação, desta forma posso gerar o relatório de fechamento para comissionamento do consultor. Essa informação comecou a ser inserida em agosto, favor considerar somente a partir de agosto."*

**Nova aba "Fechamento"**, visível só pra admin (`canSeeFechamento()`) — é a base de um pagamento (comissão do consultor), tratado com a mesma cautela de dado sensível que outras informações restritas do painel.

- **Duas colunas novas em `producao_pedidos`**: `data_portabilidade` e `data_instalacao` (timestamptz, nullable — migração aditiva, não afeta dados existentes). Extraídas do export do NeoCRM em `extractProducaoRecords()` por um lookup de coluna **tolerante a maiúscula/minúscula e acento** (`normalizarHeaderProducao`/`getFlex`, diferente do match exato usado nas colunas obrigatórias — ver seção 14 sobre por que colunas obrigatórias usam nome exato) — usado porque a grafia exata do cabeçalho no export ("Portabilidade" / "Data de instalação") foi informada pelo usuário, não confirmada de forma independente num export real ainda.
- **Regra de qual data vale, e pra qual produto** (`dataAtivacaoFechamento()`) — **corrigida no mesmo dia** depois de uma primeira versão restrita a grupos `VOZ - *`: o usuário esclareceu, *"todo e qualquer produto que estiver na data de portabilidade constará como ativação"* — ou seja, a coluna Portabilidade preenchida conta como ativação pra **qualquer produto**, não só linha de voz (ex.: um Aparelho vendido junto de uma portabilidade também recebe essa data e deve contar). A regra final é: `data_portabilidade` preenchida → sempre conta, seja qual for o grupo; sem ela, só BANDA LARGA cai no fallback de `data_instalacao`; sem nenhuma das duas, o produto fica de fora (não tem como saber quando foi ativado).
- **A coluna "Portabilidade" cobre TODO tipo de ativação de linha, não só número portado** — esclarecido pelo usuário: *"é que usamos a coluna portabilidade para colocar a data de todos os tipos de ativação, seja linha nova, ou renovação e etc"*. Ou seja, `VOZ - Novo`, `VOZ - Renovação`, `VOZ - Tranf. Titularidade` e `VOZ - Portabilidade` usam todos a mesma coluna `data_portabilidade` — o nome da coluna no NeoCRM é histórico, não literal. Combinado com o ponto acima, isso também vale pra Aparelho, SVA Fixa ou qualquer outro grupo, sempre que a Portabilidade estiver preenchida.
- **Piso de 01/08/2026** (`FECHAMENTO_PISO`): esse dado só começou a ser preenchido pelo NeoCRM a partir dessa data — o relatório nunca considera nada anterior, mesmo que o campo "De" seja preenchido com uma data mais antiga (o piso sempre prevalece sobre o "De" informado).
- **Só pedidos "ganho"** (`producaoEtapaCategoria(r.etapa) === 'ganho'`) contam — decisão do time (não literalmente pedida pelo usuário, mas inferida da natureza do relatório): um pedido devolvido ou perdido não deveria gerar comissão, mesmo que tenha ficado com uma data de ativação preenchida em algum momento do processo. Documentado aqui como suposição, pendente de confirmação se algum caso real aparecer.
- **Período**: filtro livre De/Até (o usuário escolheu essa opção explicitamente em vez do mês calendário sugerido).
- **Resumo por consultor + drilldown clicável**, mesmo padrão visual/interação do card "Conversão confirmada no NeoCRM" (seção 17.9-17.x) — cards `.kpiCard` com contagem de contratos (Voz/Banda Larga/Outros/Total), clicáveis, abrindo modal com a lista de ativações (pedido, tipo, produto, cliente, CNPJ, data de ativação).
- **Contratos, não linhas**: mesmo cuidado da seção 16.13 — `agruparFechamentoPorConsultor()` conta `numero_pedido` distinto, não linha, pra não inflar a contagem quando um pedido tem mais de uma linha. Balde **"Outros"** (além de Voz e Banda Larga) criado justamente por causa da correção acima: qualquer grupo fora de `VOZ - *`/`BANDA LARGA` que qualifique via Portabilidade preenchida (ex.: Aparelho avulso) cai nesse balde — o total do card sempre soma os 3 baldes, nunca só Voz+Banda Larga, senão essas ativações desapareceriam da contagem mesmo aparecendo no drilldown.
- **Não calcula valor de comissão** — decisão explícita do usuário ("Só listar as ativações"): a aba só lista as ativações qualificadas no período; o cálculo do valor da comissão fica por conta de quem gera o relatório, fora do painel.
- **Receita das ativações** (pedido do usuário, mesmo dia): além da contagem de contratos, o relatório agora soma o `valor` de cada produto ativado no período — receita bruta das ativações, **não** o valor da comissão (a aba continua sem calcular comissão). Mostrada em 3 lugares: "Receita total no período" no topo do card de resumo (soma de todos os consultores), a receita de cada consultor no próprio card (`agruparFechamentoPorConsultor()` agora também soma `valor`, **não deduplicado por pedido** — cada produto tem seu próprio valor, diferente da contagem de contratos que dedup por `numero_pedido`), e o valor de cada linha individual na coluna "Valor" do drilldown.
- **Pendência não resolvida**: o usuário não se manifestou sobre Aparelho/SVA Fixa avulsos ficarem fora do relatório quando a Portabilidade não está preenchida — mantido como estava antes desta mudança de receita.

Testado em `test_fechamento.js` (48 asserções): visibilidade da aba por perfil, `dataAtivacaoFechamento()` cobrindo VOZ/Aparelho/SVA Fixa/Banda Larga com e sem Portabilidade preenchida, `filtrarRegistrosFechamento()` (piso de 01/08, exclusão de etapa perdida/devolvida, exclusão de produtos sem nenhuma data), `agruparFechamentoPorConsultor()` (contrato ≠ linha, balde "Outros", soma de receita não deduplicada), fluxo completo de busca/renderização dos cards (incluindo a receita formatada em R$), drilldown por consultor (valor por linha + subtotal) e o aviso quando "De" é anterior ao piso.

- **18/09/2026** — Nova aba "Fechamento" (só admin): relatório de ativações pra comissionamento do consultor. Data de ativação = coluna Portabilidade preenchida, pra QUALQUER produto (não só voz); Banda Larga sem Portabilidade cai no fallback de Data de instalação. Piso de 01/08/2026, resumo por consultor (Voz/Banda Larga/Outros) com drilldown, receita bruta somada por consultor e por linha (sem calcular valor de comissão). Ver seção 16.14.

### 16.15 Convergência (fibra + móvel) fragmentada em 2 pedidos — "Contratos" voltou a igualar "Produtos" (21/09/2026)

Usuário reportou (com print da Visão Diária, dia 21/09/2026) que o bug da seção 16.13 tinha "voltado": os cards mostravam **Contratos: 26** e **Produtos: 26**, de novo idênticos. Mensagem do usuário: *"voltou a apresentar o erro de mesma quantidade de contratos e produtos, verificar a quantidade de contratos e produtos de forma distintas, ou seja, pode haver menos contratos que produtos, a fibra tambem deve ser contabilizada de forma separada dentro de um mesmo contrato caso tenha"*.

**Não era uma regressão do fix da seção 16.13** — `pedidoKey()` continuava agrupando corretamente por `numero_pedido` distinto. O problema é outro: conferido direto no banco (Supabase, `producao_pedidos`, dia 21/09/2026), as 26 linhas daquele dia tinham, de fato, 26 `numero_pedido` **distintos** — ou seja, contar por `numero_pedido` dava 26 "corretamente", só que não é isso que o usuário considera 1 venda.

**Causa raiz**: numa venda de **convergência** (fibra + linha móvel vendidas juntas pro mesmo cliente), o NeoCRM grava a linha de **Banda Larga** e a linha de **Voz** com **dois `numero_pedido` diferentes**, mesmo sendo a mesma negociação, mesmo cliente, mesmo dia. Uma segunda consulta no banco (`group by cnpj having count(*) > 1`, filtrando o mesmo dia) confirmou o padrão: exatamente **3 CNPJs** tinham 1 linha `BANDA LARGA - Novo` + 1 linha `VOZ - Novo`, cada uma com `numero_pedido` diferente — essas 3 vendas de convergência é que inflavam "Contratos" de 23 pra 26, igualando "Produtos".

**Correção** (`PRODUCAO_DASHBOARD_TPL_B64`, o Dashapex embutido em base64): nova função `cnpjsComConvergencia(rows)`, calculada 1x por render sobre o conjunto de linhas do dia — marca todo CNPJ que tenha **ao menos 1 linha de Banda Larga E ao menos 1 linha de outro tipo** de produto (voz, aparelho etc.) no mesmo conjunto. `pedidoKey(r, idx, cnpjConvergenciaSet)` ganhou um 3º parâmetro: se o CNPJ da linha estiver nesse conjunto, a chave de contrato passa a ser o **CNPJ** (`'CONV_' + cnpj`, fundindo as linhas de banda larga + voz da mesma convergência em 1 contrato só); caso contrário, continua usando `numero_pedido` normalmente, exatamente como a seção 16.13 deixou.

**Por que não usar CNPJ como chave geral** (o que resolveria de forma mais simples, mas foi descartado): a própria seção 16.13 já tinha rejeitado agrupar por CNPJ puro, porque CNPJ identifica *cliente*, não *venda* — duas vendas de voz genuinamente separadas do mesmo cliente no mesmo dia (2 linhas novas, por exemplo) não podem virar 1 contrato só. Por isso a fusão por CNPJ aqui é **restrita ao padrão exato de convergência** (banda larga + outro tipo coexistindo pro mesmo CNPJ) — um CNPJ com 2 linhas de banda larga (sem nenhum outro tipo) ou 2 linhas de voz (sem banda larga) **não funde**, continua contando como contratos separados.

Aplicado nos mesmos 3 pontos já corrigidos na seção 16.13 (todos agora recebem/propagam `cnpjConvergenciaSet`):
- KPI do topo (`totalContratos`).
- Barra por hora (`porHora[h].contratosSet`).
- Ranking "Por consultor" / "Por produto" (`agruparDiariaPor` → `renderDiariaLeaderboard`).

Testado em `test_visao_diaria.js` (bloco novo "7.4", dia fictício 21/09/2026 com 6 linhas): 2 linhas de convergência real (mesmo CNPJ, banda larga + voz, `numero_pedido` diferente) devem contar como 1 contrato; 2 casos de controle — mesmo CNPJ com 2 linhas de voz (sem banda larga) e mesmo CNPJ com 2 linhas de banda larga (sem voz) — devem continuar contando 2 contratos cada, provando que a fusão não vaza pra fora do padrão exato de convergência. Total esperado do dia: 5 contratos, 6 produtos (não 6/6). Confirmado no KPI, na coluna da hora, no ranking por consultor e no ranking por produto (o corte "BANDA LARGA - Novo" mostra 3 contratos: a convergência fundida + as 2 linhas de banda larga isoladas do caso de controle). Suíte completa de `test_visao_diaria.js` re-rodada sem regressão (inclusive o cenário MULTI-1/SOLO-1 da seção 16.13, que não usa CNPJ e passa pelo caminho antigo sem alteração).

- **21/09/2026** — Corrigido "Contratos" da Visão Diária voltando a igualar "Produtos" em dias com venda de convergência (fibra + móvel): o NeoCRM grava banda larga e voz da mesma venda com `numero_pedido` diferente; agora CNPJs com banda larga + outro tipo de produto no mesmo dia fundem em 1 contrato só (CNPJs sem esse padrão exato continuam contando por `numero_pedido`, sem mudança). Ver seção 16.15.

## 17. Digital (leads de campanhas Facebook/Instagram)

Aba **"Digital"** (nome interno/técnico `conversao` — vem da época em que a aba se chamava "Conversão de Vendas", mantido nos IDs/funções do código pra não gerar retrabalho num rename só de rótulo visível). Até 01/09/2026 era visível só para admin e supervisor; a partir dessa data, **qualquer perfil vê a aba**, incluindo o consultor (ver seção 2.1) — mesma visibilidade do Dashboard de Produção (porta de entrada de qualquer perfil, seção 16.6). O botão **"Atualizar agora"**, porém, continua restrito a admin/supervisor (ver seção 17.1) — ver dados é uma permissão, disparar a sincronização com o Google Sheets é outra.

### 17.1 Origem dos dados

A planilha de origem vive no Google Sheets (exportação de campanhas de Facebook/Instagram, uma linha por lead) e continua sendo o sistema de registro — o painel não substitui essa planilha, só espelha e agrega os dados pra dar visibilidade de conversão. Botão **"Atualizar agora"** dispara a Edge Function `sync-leads`, que:

1. Confere que quem chamou está autenticado e tem perfil admin ou supervisor (senão recusa com 403).
2. Busca **cada aba da planilha, pelo `gid`** (endpoint `/export?format=csv&gid=<gid da aba>`) — isso roda no servidor (Deno), não no navegador, porque o endpoint de exportação do Google não libera CORS pra fetch direto do navegador; fazer o fetch client-side falharia de forma intermitente/silenciosa. Ver 17.1.2 pra por que é por `gid` explícito, e não a exportação "padrão" (posicional) usada antes de 09/09/2026.
3. Faz o parse do CSV de cada aba (biblioteca PapaParse, que lida bem com campos com vírgula dentro de aspas — comum nos nomes de anúncio) e mapeia cada linha pros campos da tabela `leads`.
4. Consolida os registros de todas as abas num só total, e grava por **upsert** (por `id` do lead) em lotes de 500 — atualiza quem já existe e insere quem é novo. Diferente do Dashboard de Produção (que apaga e substitui tudo a cada upload — ver 16.1), aqui os dados **não são apagados**, só atualizados/complementados, porque a planilha é viva e cresce dia a dia.
5. Grava a data/hora da sincronização na tabela `config` (chave `leads_atualizado_em`), mostrada no topo da aba.

Não existe sincronização automática agendada — é sempre manual, pelo botão. (Foi cogitado buscar via API do NeoCRM diretamente, mas não havia confirmação de que a Apex tem acesso a essa API — ver changelog de 25/08/2026 nesta seção; a planilha do Google seguiu sendo a fonte usada.)

### 17.1.2 Consolidação de múltiplas abas — uma por mês (09/09/2026)

**Sintoma reportado pelo usuário**: os leads de setembro não apareciam nos números da aba Digital.

**Causa raiz**: o time passou a criar **uma aba nova por mês** na planilha de origem (ex.: `FORM- LEADS CLARO B2B APEX - AGOSTO`, depois `FORM- LEADS CLARO B2B APEX - SETEMBRO`). Até então a Edge Function buscava a exportação "padrão" da planilha (`/export?format=csv`, sem indicar aba), que o Google sempre resolve pra aba **mais à esquerda** — funcionava enquanto só existia uma aba, mas ao criar a aba de Setembro (posicionada antes da de Agosto), a sincronização passou a trazer só Setembro e parar de atualizar os leads de Agosto (que ficaram parados na última sincronização antes da mudança).

**Primeira tentativa de correção (revertida)**: buscar cada aba pelo **nome**, usando o endpoint `gviz/tq?tqx=out:csv&sheet=<nome>` do Google em vez do `/export?format=csv` posicional. Essa troca introduziu um bug novo: esse endpoint gviz faz uma detecção "esperta" de cabeçalho do lado do Google, e — só na aba de Agosto, não na de Setembro — essa detecção **fundiu o rótulo da coluna com o valor da 1ª linha de dado na mesma célula** (ex.: a coluna virou literalmente `"id l:1087703643780439"`), fazendo a função não achar o cabeçalho de jeito nenhum nessa aba (erro "Não foi possível localizar a linha de cabeçalho na aba ... AGOSTO", visto em produção logo após o primeiro deploy dessa correção).

**Correção final**: usar o endpoint de **exportação direta por `gid`** (`/export?format=csv&gid=<gid>`) — o mesmo tipo de endpoint já usado antes (só que agora com um `gid` explícito por aba, em vez de depender de qual aba está mais à esquerda). Esse endpoint devolve as células cruas, sem nenhuma "inteligência" de cabeçalho do lado do Google, então não sofre do problema acima. Confirmado direto na planilha (abrindo cada aba e lendo o `gid` na URL) e testado contra os dados reais antes de publicar: Agosto = 155 leads, Setembro = 113 leads, ambos com cabeçalho reconhecido normalmente.

A função faz o parse de cada aba (reaproveitando a mesma detecção de cabeçalho tolerante a linha extra do fix de 04/09/2026 — seção 17.1.1 — como defesa adicional, já que cada aba pode ter esse mesmo tipo de problema independentemente) e **consolida tudo antes do upsert**, com o mesmo de-dup por id (mantendo a última ocorrência) já existente.

Quando o time criar a aba de um novo mês (ex. Outubro), é preciso: (1) abrir a planilha, clicar na aba nova e copiar o `gid` da URL (ex. `.../edit?gid=1483781302`), e (2) **adicionar um item em `SHEET_TABS`** (no arquivo `edge_function_sync_leads.ts`) com o `label` (só usado nas mensagens de erro) e esse `gid`, e reimplantar a função — as abas antigas continuam sendo somadas, nada precisa ser removido. Isso não é automático (a planilha pública não expõe a lista de abas/gids sem autenticação OAuth), então é um passo manual de manutenção.

Se uma aba específica falhar ao buscar (HTTP com erro) ou não tiver uma linha de cabeçalho reconhecível, a sincronização inteira é abortada com uma mensagem identificando qual aba deu problema — evita gravar um total parcial (só de algumas abas) sem avisar.

### 17.1.3 Gid da aba de Setembro ficou inválido (14/09/2026)

**Sintoma reportado pelo usuário** (com print): botão "Atualizar agora" passou a dar erro "Não foi possível acessar a aba 'FORM- LEADS CLARO B2B APEX - SETEMBRO' da planilha (HTTP 400)". O usuário confirmou que o compartilhamento da planilha continuava certo ("qualquer pessoa com o link pode ver"), descartando a causa mais óbvia sugerida pela própria mensagem de erro.

**Causa raiz**: a aba de Setembro foi **recriada** na planilha em algum momento — o nome perdeu o prefixo "FORM- " (ficou só "LEADS CLARO B2B APEX - SETEMBRO") e, junto com a recriação, ganhou um **gid novo**. O gid antigo configurado (`1483781302`) passou a apontar pra uma aba que não existe mais, e o Google devolve HTTP 400 nesse caso — não um 404, o que tornou a causa menos óbvia à primeira vista. A aba de Agosto (não mexida) continuou funcionando normalmente com seu gid de sempre (`0`), por isso só Setembro quebrou.

**Diagnóstico**: testado cada gid configurado diretamente (`export?format=csv&gid=<gid>`) — Agosto voltou HTTP 200 com dados, Setembro voltou HTTP 400. Localizado o gid atual da aba de Setembro inspecionando a página de edição da planilha (`1292366194`), confirmado com um novo teste (HTTP 200, cabeçalho reconhecido, dados de setembro presentes).

**Correção**: `SHEET_TABS` atualizado com o gid correto da aba de Setembro (`1292366194`) e o rótulo ajustado pro nome atual da aba (sem o prefixo "FORM- "). Também identificada, na mesma inspeção, uma aba nova chamada **"REPIQUE"** (mesma estrutura de colunas dos leads — um lote de recontato) que ainda não estava em `SHEET_TABS`; incluída a pedido do usuário (gid `532368128`). A partir de agora a sincronização soma Agosto + Setembro + REPIQUE. Edge Function `sync-leads` reimplantada (versão 5).

**Lição pra manutenção futura**: recriar/renomear uma aba na planilha muda o gid, mesmo que o nome pareça igual ou parecido — sempre que o erro "Não foi possível acessar a aba ... (HTTP ...)" aparecer com o compartilhamento confirmado como correto, o próximo passo é checar se o gid daquela aba ainda é o mesmo na planilha (não assumir que só pode ser problema de permissão).

### 17.1.1 Bug corrigido: sincronização quebrando com "Edge Function returned a non-2xx status code" (04/09/2026)

**Sintoma reportado pelo usuário**: ao clicar em "Atualizar agora", aparecia sempre o erro genérico "Edge Function returned a non-2xx status code", sem explicar o motivo real.

**Causa raiz (na planilha, não no código)**: a planilha do Google passou a trazer uma **linha extra logo acima do cabeçalho de verdade** — mesmo tipo de problema já visto antes na exportação do NeoCRM (seção 16.1), mas dessa vez na planilha de leads. Como a função sempre tratava a linha 1 como cabeçalho (`Papa.parse(..., {header:true})`), essa linha extra virava o cabeçalho errado, e a coluna "id" acabava lendo o valor de outra coluna (o **nome do consultor**) pra quase todo mundo — como vários leads são do mesmo consultor, isso gerava **IDs duplicados** dentro do mesmo lote de upsert, e o Postgres recusa um upsert com o mesmo id repetido no mesmo lote (erro "ON CONFLICT DO UPDATE command cannot affect row a second time"). A Edge Function devolvia esse erro com status 500, mas o `supabase-js`, no navegador, só expõe a mensagem genérica em `error.message` — o motivo de verdade fica no corpo da resposta (`error.context`), que o painel não lia.

Achada também uma segunda causa, na mesma planilha: a 1ª coluna (o id do lead, sempre no formato `l:...`) está **sem rótulo** de cabeçalho, e sobra um rótulo `"id"` duplicado numa coluna vazia lá no final da planilha — se não tratado, esse rótulo duplicado sobrescreveria o id de verdade.

**Correção** (`edge_function_sync_leads.ts`, republicada no Supabase):
- A função agora **procura a linha real do cabeçalho pelo conteúdo** (looking for `created_time` bem na 2ª coluna, junto com `campaign_id` e `lead_status`), em vez de assumir que é sempre a linha 1 — funciona tanto com a planilha "normal" quanto com essa linha extra na frente.
- Se a 1ª coluna do cabeçalho estiver em branco, é tratada como `"id"` (é sempre o id do lead nessa planilha); qualquer rótulo de coluna repetido (como o `"id"` duplicado do final) é renomeado automaticamente pra não sobrescrever a coluna certa.
- **De-duplicação por id antes do upsert**: mesmo com o cabeçalho certo, se a planilha tiver alguma linha duplicada, a função agora mantém só a última ocorrência de cada id antes de gravar, em vez de deixar o Postgres rejeitar o lote inteiro.
- `console.error` adicionado nos pontos de erro, pra aparecer no log da função (painel do Supabase) em caso de problema futuro.
- **Painel** (`_template.html`): o botão "Atualizar agora" agora lê `error.context.json()` quando a Edge Function devolve um erro, pra mostrar a mensagem real (ex.: "Erro ao gravar leads: ...") em vez do texto genérico "Edge Function returned a non-2xx status code" — importante pra diagnosticar problemas de planilha no futuro sem precisar olhar os logs do Supabase.

### 17.2 Categorização do status (coluna STATUS da planilha)

O status de atendimento que o consultor registra na planilha (coluna `STATUS`) é agrupado em 4 categorias, usadas no funil e nos cálculos de conversão:

- **Convertido**: `PEDIDO CONCLUIDO (VENDA)`.
- **Perdido**: `CLIENTE NÃO RESPONDE`, `CLIENTE NÃO ACEITOU VALORES`, `CLIENTE SEM INTERESSE NO PLANO`, `LEAD PAROU DE RESPONDER`, `CNPJ INAPTO`.
- **Andamento**: `EM NEGOCIAÇÂO`, `AGENDADO RETORNO`, `AGUARDANDO DOCUMENTAÇÃO`, `AGUARDANDO CLIENTE DECIDIR`, e qualquer status novo/desconhecido que apareça na planilha no futuro (entra como andamento por padrão, pra não sumir do funil).
- **Sem contato**: status em branco — lead que ainda não foi trabalhado pelo consultor.

### 17.3 Regra de conversão (campo CONVERTEU?)

A planilha tem uma coluna própria `CONVERTEU?`, mas ela às vezes fica em branco mesmo quando o `STATUS` já é `PEDIDO CONCLUIDO (VENDA)` (inconsistência real de preenchimento manual, confirmada na planilha de origem em 25/08/2026). Pra não subcontar vendas reais, a regra é: **`STATUS = PEDIDO CONCLUIDO (VENDA)` sempre conta como convertido**, independente do que estiver em `CONVERTEU?`; fora esse caso, vale o que estiver preenchido em `CONVERTEU?` (aceita "sim", sem diferenciar maiúsculas/minúsculas).

### 17.4 O que a aba mostra

- **Período** (ver 17.8): filtro de data que recorta todos os números abaixo — sem ele, tudo é calculado sobre o total histórico.
- **Resumo**: total de leads, total convertidos, taxa de conversão geral e receita gerada (soma do campo `RECEITA` dos leads convertidos), com o ticket médio como contexto adicional no card de receita.
- **Funil por categoria**: gráfico doughnut com a proporção Convertido/Perdido/Andamento/Sem contato, com legenda mostrando quantidade e percentual de cada fatia.
- **Conversão por consultor**: leads recebidos, convertidos, taxa de conversão (com barra visual) e receita, um consultor por linha (ordenado por volume de leads); leads sem consultor atribuído na planilha aparecem agrupados como "(Sem consultor)", sempre por último.
- **Funil por status**: cada status distinto da planilha, sua categoria (17.2, com badge colorido), quantidade e percentual do total (com barra visual) — dá pra ver em que etapa os leads estão empacando.
- Enquanto não houver nenhum lead sincronizado ainda, a aba mostra uma mensagem orientando a clicar em "Atualizar agora".

### 17.5 Schema (Supabase)

- Tabela `leads`: um registro por lead (chave primária `id`, vindo da própria planilha), com os campos de origem do anúncio (campanha, conjunto, anúncio, formulário, plataforma), dados de contato (nome, e-mail, telefone, cidade, estado, CNPJ informado no formulário — sem validação, é texto livre do lead), e os campos de atendimento (`consultor`, `status`, `categoria`, `obs`, `converteu`, `receita`). RLS: `select` só para admin/supervisor; não existe política de escrita liberada — só a Edge Function grava, usando a service_role key (que ignora RLS).
- A tabela `config` ganhou a chave `leads_atualizado_em`, exibida no topo da aba.

### 17.6 Edge Function `sync-leads`

Publicada no projeto Supabase (`edge_function_sync_leads.ts`, guardado localmente como referência). Segue o mesmo padrão das outras Edge Functions do sistema (`create-user`, `reset-password`): valida o JWT de quem chamou, confere o perfil (`profiles.role`) usando um client com a service_role key, e só então executa a operação privilegiada (aqui, ler a planilha pública do Google e gravar em `leads`/`config`).

### 17.7 Rename para "Digital" e apresentação moderna dos números (26/08/2026)

A aba foi renomeada de "Conversão de Vendas" pra **"Digital"** (só o texto visível no menu e no título do card — os IDs internos, funções JS e nomes de tabela/coluna continuam com "conversao"/"leads", pra não precisar mexer em nada além da apresentação). A forma de mostrar os números também foi revista, seguindo boas práticas de dashboard (número grande em primeiro plano, contexto visual junto, cores com significado consistente):

- **Cards de KPI redesenhados**: cada card do resumo (Leads, Convertidos, Taxa de conversão, Receita) ganhou uma barra de destaque colorida na lateral e um número grande em primeiro plano — o card de Taxa de conversão ganhou também uma barra de progresso mostrando visualmente o percentual, e o card de Receita passou a mostrar o ticket médio como contexto (não só o total).
- **Gráfico doughnut do funil por categoria**: novo card com um gráfico de rosca (Chart.js, já usado em outros dashboards do painel) mostrando a proporção Convertido/Perdido/Andamento/Sem contato, com legenda ao lado trazendo a quantidade e o percentual de cada fatia — dá uma leitura visual imediata da composição do funil, complementar à tabela detalhada por status.
- **Barras visuais nas tabelas**: a coluna "Taxa de conversão" (tabela por consultor) e "% do total" (funil por status) deixaram de ser só texto e passaram a mostrar uma barrinha de progresso ao lado do percentual — facilita comparar visualmente as linhas sem precisar ler número por número.
- **Badges coloridos por categoria**: na tabela de funil por status, a coluna "Categoria" passou a usar um selo colorido (verde para Convertido, vermelho para Perdido, âmbar para Em andamento, cinza para Sem contato) em vez de texto plano — mesma paleta usada no gráfico doughnut, pra manter a leitura consistente em toda a aba.
- Nenhuma mudança na lógica de cálculo/categorização (seções 17.2 e 17.3) nem no schema — é só uma mudança de apresentação.

### 17.8 Filtro de período, com granularidade diária (09/09/2026)

Card **"Período"**, no topo da aba (antes do Resumo), com pílulas de atalho (**Tudo**, **Hoje**, **Últimos 7 dias**, **Este mês**) e dois campos de data, **De** e **Até**, editáveis à mão. Não existe um seletor "diário" separado — o filtro por um único dia é justamente o caso **De == Até** (é isso que a pílula "Hoje" faz por baixo dos panos: preenche os dois campos com a mesma data). Filtrar por um intervalo qualquer (ex.: uma semana específica do passado) também funciona, digitando De e Até manualmente.

**Comportamento**:
- Todos os números da aba (KPIs do Resumo, gráfico doughnut, tabela por consultor, funil por status) são recalculados só com os leads cujo `criado_em_lead` cai dentro do período — o filtro é aplicado **em memória**, sobre os leads já carregados do Supabase (sem refetch a cada troca de período).
- A data de cada lead é convertida pro fuso de São Paulo antes de comparar (mesmo cuidado do fix de fuso horário do Dashboard de Produção, seção 16.10) — evita um lead criado às 23h de um dia (em UTC ou outro fuso da planilha) cair no dia errado do filtro.
- Um pequeno texto abaixo dos campos de data mostra quantos leads estão sendo exibidos em relação ao total (ex.: "42 de 265 leads no período selecionado"); sem filtro, mostra só o total.
- Leads sem `criado_em_lead` conhecido (campo vazio na planilha) **entram na contagem de "Tudo"**, mas somem assim que qualquer período específico é escolhido — não dá pra confirmar que estão dentro de um intervalo se não se sabe a data.
- Clicar numa pílula sempre reposiciona os dois campos De/Até e marca a pílula como ativa; editar os campos manualmente desativa todas as pílulas (fica um filtro "personalizado", sem atalho correspondente).
- O filtro escolhido **não é salvo** — ao trocar de aba e voltar, ou clicar em "Atualizar agora", volta pro que estava selecionado durante a sessão (o "Atualizar agora" só busca dados novos e reaplica o mesmo período já escolhido, não reseta pra "Tudo").

### 17.9 Vendas x origem do lead — cruzamento por CNPJ (10/09/2026)

**Pedido do usuário**: saber, para uma data específica, quais pedidos viraram venda no NeoCRM e em que data o lead correspondente (da campanha digital) tinha chegado — pra medir o tempo entre a captação do lead e o fechamento real da venda.

Novo card **"Vendas x origem do lead"**, no fim da aba Digital, **visível só para admin/supervisor** (mesma regra de visibilidade de CNPJ/cliente do Dashboard de Produção, seção 16.4) — o card inteiro fica escondido (`display:none`) pra qualquer outro perfil, não só as colunas sensíveis, porque o relatório inteiro gira em torno do CNPJ.

**Critério de cruzamento**: o único campo em comum entre `producao_pedidos` (NeoCRM) e `leads` (campanha digital) é o **CNPJ** — não há um id compartilhado entre os dois sistemas. O cruzamento normaliza ambos os CNPJs (só dígitos, via `onlyDigits`, mesmo padrão já usado na busca por CNPJ — seção 3.x/CNPJ e na Movimentação da Base) antes de comparar. Pedidos sem CNPJ, ou cujo CNPJ não bate com nenhum lead, aparecem marcados como **"sem lead encontrado"** — não quebra o relatório, e não é necessariamente um problema (o pedido pode ter vindo de outro canal que não a campanha digital, ex. indicação, prospecção ativa).

**Campo de data usado — corrigido duas vezes no mesmo dia (10/09/2026, numeração própria deste tópico)**:

- *1ª correção do campo de data:* a primeira versão filtrava por `cadastro` (a data em que o pedido é inserido no NeoCRM), seguindo literalmente o pedido original do usuário. Na prática, porém, o usuário reportou que um pedido que virou venda no dia anterior não aparecia no relatório. Investigando direto no banco (`execute_sql`), confirmou-se que `cadastro` costuma ser **bem anterior** à venda de verdade em alguns casos — exemplo real encontrado: pedido com `cadastro` em 19/08 e `atualizacao` em 09/09, já em etapa `PORTABILIDADE EM ANDAMENTO (NEOCRM)` (ganho). Concluiu-se (na época) que `atualizacao` refletia melhor "quando o pedido virou venda", e o filtro foi trocado pra `atualizacao`.

- *2ª correção do campo de data (revertida pra `cadastro`):* o usuário reportou um caso concreto onde a data mostrada estava errada — pedido `49535940`, `cadastro` em 03/09 (batendo com a coluna T "CADASTRO" que ele via direto no relatório do NeoCRM), mas o card mostrava a venda em 09/09 (`atualizacao`). Investigando de novo no banco, descobriu-se que a 1ª correção partiu de uma premissa errada: **`atualizacao` não reflete um evento de negócio real** (a etapa mudando pra "ganho"), e sim algum tipo de sincronização periódica do NeoCRM que toca o carimbo de todo mundo de uma vez. Evidência: **100% dos pedidos "ganho" no banco têm `atualizacao` diferente de `cadastro`** (gap médio de 5,8 a 18 dias dependendo da etapa), e ao olhar os pedidos mais recentes, vários com `cadastro` bem diferentes entre si (19/08, 31/08, 02/09, 04/09...) tinham **a mesma `atualizacao` exata** (09/09) — um padrão de atualização em lote, não de eventos individuais de venda. **Corrigido de volta para filtrar/exibir por `cadastro`** — a data em que o pedido foi de fato registrado no NeoCRM, que é o que o usuário e o relatório nativo do NeoCRM (coluna "CADASTRO") tratam como a data real. O filtro continua sendo um único campo de data (padrão: **ontem**, ajustável pra qualquer dia), comparado em janela de 00:00 a 00:00 do dia seguinte no fuso de São Paulo (mesmo padrão `FUSO_SAO_PAULO` já usado no Dashboard de Produção — seção 16.10).

`atualizacao` continua sendo usado normalmente na seção 17.10 (Conversão confirmada no NeoCRM), mas ali com um propósito diferente — só para escolher, entre vários pedidos do mesmo CNPJ, qual é o "mais recente conhecido" (não para representar a data de um evento).

**"Virou venda" — regra corrigida no mesmo dia (10/09/2026, 2ª correção)**: a versão original considerava venda só o que o NeoCRM marcava como "ganho" (`PRODUCAO_ETAPA_CATEGORY`, seção 16.3). O usuário reportou um caso real — CNPJ `61729048000120` — que **entrou como lead e virou venda na planilha** (status "PEDIDO CONCLUIDO (VENDA)", `CONVERTEU? = true`), mas cujo pedido correspondente no NeoCRM está em etapa **"VENDA PERDIDA (NEOCRM)"**. Ou seja: a planilha (mantida manualmente pelos consultores) e o NeoCRM podem discordar sobre se um negócio é, de fato, uma venda. Decisão do usuário: **a planilha manda** para contar algo como venda. A regra final é:

> `venda = convertido na planilha (CONVERTEU?/status) OU (sem lead correspondente na planilha E etapa "ganho" no NeoCRM)`

Em outras palavras: se o CNPJ tem um lead convertido na planilha, conta como venda **mesmo que o NeoCRM diga outra coisa** — mas o status do NeoCRM continua sendo mostrado na tabela (coluna "Status no NeoCRM"), pra deixar a divergência visível em vez de escondida. Se não há lead correspondente na planilha pra aquele CNPJ, cai na regra antiga: conta como venda só se a etapa do NeoCRM for "ganho" (`CONCLUIDO`, `ENTREGA`, `FATURAMENTO`, `PORTABILIDADE EM ANDAMENTO`, `VALIDAÇÃO ESIM`, todas `(NEOCRM)`).

Por causa disso, a query deixou de filtrar `producao_pedidos` por etapa (`.in('etapa', [...])` foi removido) — agora ela busca **todos** os pedidos cadastrados na data escolhida, e o filtro de "é venda ou não" acontece depois, em `casarVendasComLeads`, já que agora depende também do que a planilha diz.

**Data de chegada do lead**: quando existem **múltiplos leads com o mesmo CNPJ** (reenvios do formulário), usa-se o `criado_em_lead` **mais antigo** entre eles — representa o primeiro contato daquele cliente com a campanha, que é o ponto de partida mais correto pra medir "quanto tempo até a venda".

**O que a tabela mostra (colunas ajustadas em 10/09/2026)**: pedido, cliente, CNPJ, **Receita** (substituiu "Produto" — vem da coluna Z da planilha, `leads.receita`, somada entre os leads convertidos daquele CNPJ), data da venda (`cadastro`, ver correção do campo de data acima), **Status no NeoCRM** (etapa bruta do pedido — nova coluna, mostra a divergência quando a planilha diz convertido mas o NeoCRM ainda não confirmou), se encontrou lead correspondente (badge Sim/Não), a data em que esse lead chegou, e a quantidade de dias entre a chegada do lead e a venda. Um resumo no topo mostra o total de vendas na data, quantas têm lead correspondente, e quantas têm status diferente de "ganho" no NeoCRM (ex.: "5 venda(s) nessa data · 3 com lead digital correspondente · 1 com status diferente de \"ganho\" no NeoCRM"). A busca roda automaticamente ao abrir a aba (com a data padrão "ontem") e pode ser refeita pra qualquer outra data, clicando em "Buscar".

**Funções (`_template.html`)**: `agruparLeadsPorCnpj(leads)` (substituiu `mapaPrimeiroLeadPorCnpj` — monta o mapa CNPJ→`{primeiroLead, convertido, receita}`, já trazendo se o CNPJ tem lead convertido na planilha e a soma da receita), `casarVendasComLeads(pedidos, leads)` (função pura que aplica a regra OR e faz o cruzamento, sem nenhuma chamada de rede — agora filtra os próprios pedidos, retornando só os que contam como venda) e `buscarVendasOrigemLead()` (busca `producao_pedidos` + `leads` no Supabase, chama as funções puras acima e renderiza a tabela — com guarda no início que sai sem fazer nada se quem está logado não for admin/supervisor).

- **10/09/2026** — Criado o cruzamento "Vendas x origem do lead" na aba Digital (admin/supervisor): pra uma data escolhida (padrão "ontem"), cruza os pedidos que viraram venda no NeoCRM com a data em que o lead de campanha digital correspondente chegou — casado por CNPJ, já que é o único campo em comum entre as duas fontes. Pedidos sem CNPJ ou sem lead correspondente aparecem como "sem lead encontrado", sem quebrar o relatório. Ver seção 17.9.
- **10/09/2026** — Corrigido, no mesmo dia: o relatório acima filtrava pela data de `cadastro` do pedido (quando ele foi criado no NeoCRM), mas o usuário reportou uma venda de ontem que não aparecia. Confirmado direto no banco que `cadastro` costuma ser bem anterior à venda de verdade (pedido criado semanas antes de virar "ganho"). Corrigido pra filtrar por `atualizacao` (última mudança do pedido, que reflete quando ele de fato virou venda). Ver seção 17.9.
- **10/09/2026** — Corrigido, no mesmo dia (2ª correção): usuário reportou um CNPJ específico (`61729048000120`) que entrou como lead e virou venda na planilha, mas não aparecia no card. Investigando, descobriu-se que o NeoCRM marca o pedido correspondente como "VENDA PERDIDA", divergindo da planilha. Decisão: a planilha manda pra contar como venda (regra OR: convertido na planilha OU, sem lead, ganho no NeoCRM), com o status do NeoCRM sempre visível na tabela. Coluna "Produto" trocada por "Receita" (coluna Z da planilha). Ver seção 17.9.
- **10/09/2026** — Corrigido, no mesmo dia (3ª correção, campo de data revertido): usuário reportou que o pedido `49535940` aparecia com data de venda 09/09, mas o `cadastro` real (coluna T do NeoCRM) era 03/09. Investigando direto no banco, confirmado que `atualizacao` não reflete eventos reais de venda — 100% dos pedidos "ganho" têm `atualizacao` divergente de `cadastro`, e vários pedidos com `cadastro` bem diferentes têm a mesma `atualizacao` (padrão de sync em massa do NeoCRM). Revertido pra filtrar/exibir por `cadastro`, como na versão original. Ver seção 17.9.

### 17.10 Conversão confirmada no NeoCRM — reconciliação planilha x NeoCRM (10/09/2026)

**Pedido do usuário**: além de contar como venda o que a planilha marca como convertido (seção 17.9), o usuário quis um jeito de **auditar** quantos desses "convertidos na planilha" o NeoCRM de fato confirma como venda — reconhecendo que a planilha, mantida manualmente pelos consultores, pode estar otimista ou desatualizada em relação ao pipeline oficial (o caso do CNPJ `61729048000120` é o exemplo). Pedido literal do usuário: *"entraram 100 concluidos na planilha, mas no NEO 20 chegaram no status venda perdida e 80 em concluido, conversao de 80"*.

Novo card **"Conversão confirmada no NeoCRM"**, na aba Digital, **separado dos KPIs principais do topo** (decisão explícita do usuário — não substitui "Resumo"/"Funil por categoria" etc., é um card adicional) e posicionado **antes** do card "Vendas x origem do lead". Inicialmente era visível só para admin/supervisor — **aberto também pro consultor em 10/09/2026** (ver "Drilldown e abertura pro consultor" abaixo).

**Período usado**: **reaproveita o filtro "Período" (De/Até) já existente no topo da aba Digital** (`conversaoPeriodoDe`/`conversaoPeriodoAte`, seção 17.8) — decisão explícita do usuário, em vez de criar um campo de data próprio. O card é recalculado toda vez que `renderConversaoFiltrado()` roda (ou seja, a cada troca do período ou pílula).

**Como funciona**: dos leads do período selecionado que estão marcados como `converteu = true` na planilha, cruza cada um (por CNPJ) com o pedido de `producao_pedidos` de **`atualizacao` mais recente** para aquele CNPJ (não precisa ser da mesma data — é o status mais atual daquele cliente no NeoCRM, buscado uma vez em `loadConversaoVendas()` e cacheado em `producaoPedidosCacheDigital` pra não refazer a consulta a cada troca de período), e classifica pela categoria da etapa (`producaoEtapaCategoria`, seção 16.3):

- **Confirmados no NeoCRM** — etapa categoria "ganho".
- **Voltaram perdidos** — etapa categoria "perdido" (ex.: o caso do CNPJ `61729048000120`).
- **Ainda não confirmados** — soma de "em andamento" (etapa existe mas não é ganho/perdido/devolvido) e "sem pedido no NeoCRM" (CNPJ não encontrado em `producao_pedidos`), mostrados separadamente no texto do card.
- **Taxa de conversão confirmada** — confirmados / total de leads do período (não só os convertidos na planilha) — é a "taxa de conversão real", validada contra o NeoCRM.

**Funções (`_template.html`)**: `mapaEtapaMaisRecentePorCnpj(pedidos)` (função pura — monta o mapa CNPJ→`{etapa, atualizacao, numero_pedido, cadastro, cliente}` do pedido mais recente daquele CNPJ; os três últimos campos foram adicionados em 10/09/2026 pro drilldown, ver abaixo), `reconciliarConversaoNeoCRM(leadsConvertidos, pedidos)` (função pura — recebe os leads já filtrados por convertido+período e devolve as contagens `{total, ganho, perdido, andamento, semPedido}`) e `renderReconciliacaoNeoCRM(leadsPeriodo)` (async desde 10/09/2026 — monta os KPIs e o cache do drilldown; ver detalhes abaixo). Chamada a partir de `renderConversaoFiltrado()`, a cada refiltragem (sem `await`, fire-and-forget, mesmo padrão já usado por `buscarVendasOrigemLead()`).

#### Drilldown (analítico) e abertura pro consultor (10/09/2026)

**Pedido do usuário**: clicar em cada caixa do card deve abrir um analítico com os pedidos daquela categoria — pro consultor, mostrando só o número do pedido (regra já usada no Dashboard de Produção, seção 16.4); pra supervisor/admin, o CNPJ e os demais dados.

Isso implicou abrir a **visibilidade do card em si** pro consultor (antes era só admin/supervisor) — decisão confirmada com o usuário via pergunta, já que o card depende de cruzar CNPJ entre `leads` e `producao_pedidos`, e o consultor nunca recebe CNPJ no navegador (mesma cautela de privacidade do Dashboard de Produção). Pra abrir sem quebrar essa garantia, o cruzamento passou a rodar em dois lugares diferentes dependendo de quem está logado:

- **admin/supervisor**: o cruzamento continua rodando no navegador (`reconciliarConversaoNeoCRM` + `montarDrilldownReconciliacao`, ambas puras), porque essas pessoas já têm o CNPJ localmente de qualquer jeito (mesmos dados usados pelo card "Vendas x origem do lead"). A query de `producao_pedidos` em `loadConversaoVendas()` passou a buscar também `numero_pedido`, `cliente` e `cadastro` (antes só `cnpj,etapa,atualizacao`), pra alimentar as colunas extras do drilldown.
- **consultor**: o cruzamento roda **no servidor**, via a function `reconciliacao_neocrm(p_de date, p_ate date)` do Postgres (RPC, `SECURITY DEFINER`, migração `create_reconciliacao_neocrm_rpc`) — ela faz o mesmo join CNPJ-a-CNPJ (normalizado só dígitos, pedido mais recente por `atualizacao`) inteiramente dentro do banco e **nunca devolve CNPJ nem nome do cliente**, só as contagens (`total/ganho/perdido/andamento/semPedido`) e, por categoria, uma lista de `{numero_pedido, etapa, cadastro}`. A function exige `auth.uid()` não nulo (rejeita chamada anônima) e o `grant execute` é só pra `authenticated` (revogado de `public`). Validado que os números batem exatamente com os já mostrados no card antes dessa mudança (81 concluídos / 29 confirmados / 10 perdidos / 42 ainda não confirmados, mesmo cenário real do banco).

**Colunas do analítico**: Pedido, Status no NeoCRM e Data (cadastro) pra todo mundo; CNPJ, Cliente e Receita só pra admin/supervisor. Um lead convertido na planilha **sem nenhum pedido correspondente** no NeoCRM (categoria "sem pedido") não tem número de pedido/etapa/data pra mostrar (não existe pedido) — mas **tem CNPJ**, porque esse dado vem da PLANILHA, não do NeoCRM. Decisão (10/09/2026, ajustada no mesmo dia): pra admin/supervisor, que já têm o CNPJ da planilha localmente de qualquer jeito, a linha mostra o CNPJ (e a receita) normalmente, só com "—" nas colunas que dependem do pedido (Pedido/Status/Data). Pro consultor, que nunca recebe CNPJ (via RPC, que só devolve a contagem), a linha continua genérica: "— sem pedido correspondente —", sem nenhum dado do lead.

**Categorias clicáveis**: "Concluídos na planilha" (todas as linhas, de todas as categorias), "Confirmados no NeoCRM" (ganho), "Voltaram perdidos" (perdido), "Ainda não confirmados" (em andamento + sem pedido) e "Taxa de conversão confirmada" (mesma lista de "Confirmados no NeoCRM", já que a taxa é confirmados/total — decisão do usuário).

**Funções novas (`_template.html`)**: `montarDrilldownReconciliacao(leadsConvertidos, pedidos)` (pura, versão admin — monta `{ganho, perdido, andamento, semPedidoCount}` com CNPJ/cliente/receita em cada linha), `linhasReconciliacaoPorCategoria(categoria)`, `linhaReconciliacaoHtml(linha, admin)` e `abrirDrilldownReconciliacao(categoria)` (monta e abre o modal `#reconciliacaoDrilldownOverlay`, reaproveitando o padrão `.overlay`/`.modal` já usado nos outros modais do painel — não é o mesmo drilldown do Dashboard de Produção, que vive num template embutido separado dentro do iframe).

- **10/09/2026** — Criado o card "Conversão confirmada no NeoCRM" na aba Digital (admin/supervisor): reconcilia os leads convertidos na planilha, dentro do período selecionado, com o status mais atual do pedido correspondente no NeoCRM — mostra quantos foram de fato confirmados como venda, quantos voltaram como perdidos, e quantos ainda não têm pedido ou seguem em andamento. Reaproveita o filtro Período já existente; card novo, separado dos KPIs principais. Ver seção 17.10.
- **10/09/2026** — No mesmo dia: adicionado o drilldown (clique em cada caixa abre a lista de pedidos) e aberta a visibilidade do card pro consultor também — pro consultor, o cruzamento roda no servidor via a function `reconciliacao_neocrm` (nunca devolve CNPJ), e o analítico mostra só número do pedido; admin/supervisor continuam com o cruzamento no navegador e veem CNPJ/cliente/receita no analítico. Ver seção 17.10.
- **10/09/2026** — Ajustado, no mesmo dia: usuário perguntou se dava pra ver o CNPJ dos leads "sem pedido no NeoCRM" através da planilha. Como esse CNPJ vem da planilha (não do NeoCRM), e admin/supervisor já têm esse dado localmente, a linha "sem pedido" do drilldown passou a mostrar o CNPJ (e a receita) pra admin/supervisor — só as colunas que dependem de um pedido (Pedido/Status/Data) ficam em branco. Pro consultor a linha continua genérica, já que o RPC nunca devolve CNPJ. Ver seção 17.10.

## 18. Menu principal: ordem, nomes e visual das abas (26/08/2026)

O menu de abas (`nav.tabs`) foi reorganizado e modernizado. Os `data-tab`/IDs internos de cada aba (`producao`, `conversao`, `busca`, `cobertura`, `proposta`, `funil`, `basedados`, `movimentacao`, `consultores`) **não mudaram** — só a ordem, o rótulo visível e o visual do menu.

### 18.1 Nova ordem e nomes

| Ordem | Aba (`data-tab`) | Rótulo atual | Rótulo anterior |
|---|---|---|---|
| 1 | `producao` | Dashboard | Dashboard de Produção |
| 2 | `conversao` | Digital | (já era "Digital" — ver seção 17.7) |
| 3 | `busca` | Buscar Clientes | (sem alteração) |
| 4 | `cobertura` | Cobertura | Verificar Cobertura |
| 5 | `proposta` | Gerar Proposta | (sem alteração) |
| 6 | `funil` | Funil | Funil de Vendas |
| 7 | `basedados` | Upload Base | Base de Dados |
| 8 | `movimentacao` | Upload Dash | Atualização de Bases |
| 9 | `consultores` | Usuários | Consultores |

A ordem é fixa no HTML (a posição na tela não depende do perfil logado) — o que muda por perfil é só quais abas ficam visíveis (`display:none` nas administrativas: Upload Base, Upload Dash e Usuários só aparecem pra quem tem permissão, ver seção 2). "Dashboard" continua sendo a primeira aba visualmente e a página inicial pós-login (ver 16.6), independente do perfil.

Os textos internos do painel que citam essas abas por nome (mensagens de erro, avisos de onde encontrar algo, comentários no código) foram atualizados junto pra não ficar inconsistente com o rótulo novo do menu — por exemplo, a mensagem de dashboard vazio agora diz "Vá em Upload Dash" em vez de "Vá em Atualização de Bases".

### 18.2 Visual do menu

O menu deixou de ser abas com sublinhado (estilo antigo, mais "aba de navegador") e passou a ser uma barra de **pílulas com ícone**: cada aba tem um ícone simples (outline, 15px) antes do texto, a aba ativa ganha um fundo sólido na cor da marca (vermelho Claro) com leve sombra, e o hover das inativas mostra um fundo cinza-claro sutil. A barra ganhou rolagem horizontal própria (com uma barra de rolagem fina) pra não quebrar linha em telas menores, já que agora são até 9 abas pra quem é admin. Não há nenhuma mudança de comportamento — só aparência.

## 19. Biometria facial (aba "Biometria" + página-ponte para envio no WhatsApp, 09/09/2026)

Pedido do usuário: enviar aos clientes, pelo WhatsApp, um link para realizar a biometria facial exigida pela Claro na ativação — com identidade visual da Claro Empresas, e um link de destino diferente para cada cliente (o link real de biometria vem do sistema da Claro, gerado por cliente).

### 19.1 Por que não dá pra ser só uma imagem clicável

O pedido original era uma "imagem clicável" enviada direto no WhatsApp. Tecnicamente isso não existe: uma imagem enviada sozinha no WhatsApp nunca é clicável, não importa o que esteja desenhado nela (um botão "Clique aqui" pintado na imagem é só um desenho, sem link nenhum atrás). O único jeito de um clique abrir alguma coisa no WhatsApp é mandando um **link em texto puro** — o app então busca a página desse link e monta um card grande e clicável usando as tags Open Graph (`og:title`, `og:description`, `og:image`) daquela página. Clicar em qualquer parte do card (inclusive na imagem) leva pro mesmo lugar: a URL que foi enviada. Não existe um "botão dentro da imagem" com link próprio, diferente do resto do card — foi isso que ficou combinado com o usuário (09/09/2026) depois de explicado o funcionamento do preview do WhatsApp.

Como a página real de biometria (do sistema da Claro) não tem essas tags OG configuradas do jeito que a Apex quer — e é uma página de terceiro, sem acesso pra editar —, a solução foi criar uma **página-ponte**: uma página própria que tem as tags OG fixas (sempre a mesma imagem, com a identidade visual da Claro Empresas) e mostra, de forma visível, uma saudação com o nome do cliente e um botão "Clique aqui" que leva pro link real e específico daquele cliente. O consultor manda o link **dessa página-ponte** no WhatsApp, não o link real da Claro nem a imagem sozinha.

### 19.2 Imagem de preview (og:image)

Uma única imagem (`biometria_preview.png`, 1200×630, hospedada em `https://apexsmart.com.br/biometria_preview.png`) é compartilhada por todos os clientes — ela não muda por cliente, é só o "cartão de capa" que aparece no preview do WhatsApp antes de abrir o link. Contém: o logo oficial da Claro (`logoclaro2.png`, fornecido pelo usuário — a primeira versão usava também o logo da Apex ao lado, removido a pedido do usuário em 09/09/2026, ficando só o logo da Claro), um selo "Biometria facial", o texto "Bem-vindo(a) à Claro Empresas" e um botão desenhado "Clique aqui →" (sem link real, é só visual — o link de verdade fica no HTML da página-ponte, não na imagem).

Decisão confirmada com o usuário (09/09/2026): o **nome do cliente não entra na imagem** — ficaria mais lento (precisaria gerar uma imagem nova por cliente, na hora, o que atrasaria o preview no WhatsApp) e mais complexo de manter. O nome do cliente aparece no **texto da página-ponte** (saudação "Olá, {nome}!"), que é o que o cliente vê ao efetivamente abrir o link.

A imagem foi gerada com Python/Pillow (gradiente da marca, logo, selo e botão desenhados programaticamente — não é uma captura de tela), já que o ambiente de geração não tem um navegador Chromium funcional disponível para renderizar HTML/CSS diretamente em imagem.

### 19.3 Página-ponte: HTML estático em apexsmart.com.br (corrigido em 10/09/2026)

**Tentativa inicial (09/09/2026), abandonada**: a página-ponte foi implementada primeiro como uma Edge Function pública do Supabase (`biometria-preview`, arquivo `edge_function_biometria_preview.ts`, ainda publicada no projeto mas **sem uso** — mantida só porque o Supabase não oferece um jeito simples de excluir uma função pela mesma via de deploy). Ao testar de verdade, a página aparecia como texto cru (as tags HTML apareciam literalmente na tela, sem renderizar) em vez de uma página bonita. Causa raiz, confirmada na documentação oficial do Supabase: **Edge Functions reescrevem automaticamente qualquer resposta de `GET` com `Content-Type: text/html` para `text/plain`** — não importa o header que a função declare explicitamente. Edge Functions lá são pensadas pra APIs/JSON, não pra servir páginas web. Isso quebrava tanto a experiência de quem abria o link quanto (mais grave) o preview do WhatsApp, já que o crawler do WhatsApp também precisa ler a resposta como HTML pra encontrar as tags `og:*` — como texto puro, nenhuma tag é reconhecida.

**Correção final**: a página-ponte virou um **arquivo HTML estático de verdade** (`biometria.html`), publicado no mesmo servidor do painel via SFTP (`https://apexsmart.com.br/biometria.html`) — hospedagem de arquivo estático não tem esse problema, serve `.html` com `Content-Type: text/html` normalmente (o próprio `painel_clientes_apex.html` já prova isso). Como as tags Open Graph são sempre as mesmas (imagem/título/descrição únicos, ver seção 19.2) e não dependem do cliente, elas continuam **fixas no HTML**, lidas normalmente pelo crawler do WhatsApp (que não executa JavaScript). Só a parte **visível pro cliente que efetivamente abre o link** — a saudação com o nome e o destino do botão "Clique aqui" — é preenchida no navegador por um JavaScript simples, lendo os parâmetros da própria URL (`?nome=...&link=...`) depois que a página carrega. Chamada como:

```
https://apexsmart.com.br/biometria.html?nome=<nome do cliente>&link=<link real da Claro, urlencoded>
```

Validações de segurança (o `link` e o `nome` vêm de parâmetros de URL, tratados como entrada não confiável):
- `link` precisa ser uma URL absoluta com esquema `http:` ou `https:` (`new URL(...)` + checagem de protocolo) — qualquer outro esquema (`javascript:`, `data:`, etc.) ou texto que não seja URL faz o botão "Clique aqui" ficar escondido e mostra uma mensagem de erro no lugar, em vez de deixar um link quebrado ou perigoso.
- `nome` é escrito na página via `textContent` (não `innerHTML`) e truncado em 100 caracteres — um nome nunca é interpretado como HTML/script, então não precisa de escape manual pra evitar XSS.

Não existe mais nenhum componente server-side nessa página — é só HTML + CSS + um JavaScript pequeno, sem chamada nenhuma ao Supabase.

### 19.4 Aba "Biometria" no painel (todos os perfis)

Nova aba **"Biometria"**, visível para admin, supervisor e consultor (decisão do usuário — mesma visibilidade da aba Digital e do Dashboard, seção 2.1). Tem dois campos — Nome do cliente e Link de biometria (o link real, específico daquele cliente, que o consultor recebe do sistema da Claro) — e um botão "Gerar link". Validações no próprio painel, antes de gerar (mensagens de erro inline):
- Nome do cliente é obrigatório (usado só na mensagem do WhatsApp, ver seção 19.6 — não afeta mais o link em si).
- Link precisa ser uma URL válida começando com `http://` ou `https://`.

Ao gerar com sucesso, aparece o link final num campo somente-leitura, com um botão "Copiar link" (usa `navigator.clipboard`, com fallback pra `document.execCommand('copy')` em navegadores mais antigos) e um botão "Enviar no WhatsApp", que abre `https://wa.me/?text=...` com uma mensagem já pronta (saudação personalizada + explicação + o link), deixando o consultor só escolher o contato dentro do WhatsApp Web/app antes de enviar. **Atualizado em 10/09/2026 (v3)**: o "link final" voltou a ser o link da página-ponte `biometria.html` (ver seção 19.8), não mais o link real direto.

### 19.5 Página-ponte `biometria.html` — histórico de abandono e reativação (10/09/2026)

Entre 09/09 e 10/09/2026 o link gerado pela aba passava por uma página-ponte própria (primeiro uma Edge Function do Supabase, depois um HTML estático em `https://apexsmart.com.br/biometria.html`) para poder controlar a imagem/título/descrição que aparecem no preview do WhatsApp — ver a explicação completa do mecanismo do preview do WhatsApp na seção 19.1, que continua válida como referência técnica.

**Decisão do usuário (10/09/2026): voltar a enviar o link real da Claro direto**, sem página-ponte. Motivo: preferência por simplicidade em vez do preview com a identidade visual da Claro Empresas. Consequência assumida: o card de preview que aparece no WhatsApp deixou de ser controlado pela Apex — agora é o que a própria página de biometria da Claro tiver configurado em suas tags Open Graph (pode ser um preview genérico, ou nenhum preview, dependendo do que a Claro configurou lá).

Nesse período, os arquivos/artefatos ficaram como código morto, não removidos (limpeza não solicitada), só sem uso pelo painel: `biometria.html`, `biometria_preview.png` e `edge_function_biometria_preview.ts` (esta última já estava sem uso desde a correção da seção 19.3, e continua assim).

**Reativado em 10/09/2026 (mesmo dia, decisão seguinte do usuário — ver seção 19.8): `biometria.html` voltou a ser o link gerado pela aba.** O código do arquivo em si não precisou de nenhuma mudança (só a `edge_function_biometria_preview.ts` continua sem uso); o que mudou foi `montarLinkBiometria`, que voltou a montar a URL da página-ponte em vez do link direto.

### 19.6 Link enviado = link real da Claro, direto (10/09/2026)

`montarLinkBiometria(nome, link)` agora só normaliza o link informado (`trim` + reconstrução via `new URL(...)`) e devolve ele mesmo — não monta mais nenhuma URL de página-ponte. O nome do cliente continua sendo pedido no formulário, mas passou a servir só pra personalizar a saudação da mensagem pronta do botão "Enviar no WhatsApp" (`montarMensagemWhatsapp`), nunca fazendo parte do link em si.

### 19.7 Card grande enviado como foto + botão "Baixar imagem" (10/09/2026)

Consequência da decisão da seção 19.5/19.6: como o link agora vai direto (sem página-ponte), o WhatsApp não gera mais nenhum card de preview controlado pela Apex. Para ainda assim entregar uma imagem grande e com a identidade visual da Claro Empresas junto do link, a solução usa dois elementos independentes na mesma conversa do WhatsApp, em vez de um único card de link-preview:

- **A imagem** (`biometria_preview.png`) é enviada como **anexo de foto**, não como preview de link — por isso pode ser bem maior e mais chamativa (redesenhada em formato retrato 1080×1350, com logo da Claro maior, badge "Biometria facial", título "Bem-vindo(a) à Claro Empresas", texto explicativo, uma caixa branca com a instrução "Toque no link enviado logo abaixo para continuar" e uma seta apontando pra baixo — substituindo o antigo botão "Clique aqui" visual, que não fazia mais sentido sem um link clicável dentro da própria imagem).
- **O link** continua chegando como texto clicável na mensagem/legenda (o WhatsApp reconhece URLs em texto puro e as sublinha automaticamente, independente de qualquer tag Open Graph) — mecanismo já usado pelo botão "Enviar no WhatsApp" (`montarMensagemWhatsapp`).

**Limitação de plataforma constatada**: links `wa.me` só pré-preenchem texto — não existe parâmetro ou mecanismo para anexar automaticamente uma imagem a uma mensagem do WhatsApp Web/app por link. Por isso o envio da imagem continua sendo manual: o consultor precisa baixar o arquivo e anexá-lo à conversa como foto.

Para viabilizar esse passo manual, foi adicionado um botão **"Baixar imagem"** na aba Biometria (ao lado de "Copiar link" e "Enviar no WhatsApp"), com `href` fixo para `https://apexsmart.com.br/biometria_preview.png` e atributo `download`. Fluxo orientado ao consultor (texto explicativo também adicionado na aba): baixar a imagem → abrir a conversa no WhatsApp → enviar a imagem como foto → colar o texto (já com o link, gerado pelo botão "Enviar no WhatsApp") como legenda da foto ou na mensagem seguinte.

**Superado em 10/09/2026 pela seção 19.8** — o usuário decidiu voltar pra página-ponte no mesmo dia, achando mais simples enviar um único link do que baixar+anexar a imagem manualmente. O botão "Baixar imagem" foi removido da aba.

### 19.8 De volta à página-ponte, com a imagem grande como preview (10/09/2026 — superado no mesmo dia pela seção 19.9)

Decisão do usuário: o fluxo de "baixar imagem + anexar como foto + colar link na legenda" (seção 19.7) foi considerado mais trabalhoso do que enviar um único link. `montarLinkBiometria(nome, link)` voltou a montar a URL da página-ponte:

```
https://apexsmart.com.br/biometria.html?nome=<nome codificado>&link=<link real codificado>
```

(o parâmetro `nome` só é incluído quando o campo não está vazio). O botão "Baixar imagem" e o texto de instrução de anexar manualmente foram **removidos** da aba — a imagem volta a aparecer automaticamente como preview do link no card do WhatsApp, sem nenhuma ação manual do consultor além de copiar/enviar o link.

A imagem `biometria_preview.png` (mesmo arquivo, mesmas dimensões grandes 1080×1350 da seção 19.7) foi ajustada: o texto "Toque no link enviado logo abaixo para continuar" (que fazia sentido só quando a imagem era enviada separada do link) foi trocado por um CTA genérico, **"Toque para continuar →"**, sem seta apontando pra baixo — coerente com o fato de que, nesse fluxo, o card inteiro (imagem + título + descrição, todos gerados a partir das tags Open Graph de `biometria.html`) já é o único elemento clicável, e não existe nenhum "link separado abaixo".

Nada mudou em `biometria.html` em si (segue exatamente como descrito nas seções 19.1–19.3) nem na Edge Function `biometria-preview` (continua publicada e sem uso).

**Superado ainda no mesmo dia (seção 19.9)**: o usuário reportou, ao ver o card de verdade no WhatsApp, que a imagem ficava pequena dentro do card (limitação do próprio WhatsApp, que sempre reduz `og:image` a uma miniatura fixa, independente do tamanho do arquivo) e que o link de terceiro embutido causava desconfiança nos clientes. Isso motivou a decisão final da seção 19.9.

### 19.9 Decisão final: imagem grande como FOTO separada + link real da Claro direto (10/09/2026)

**Motivo da mudança**: ao testar o fluxo da seção 19.8 de verdade no WhatsApp, o usuário percebeu que (a) o WhatsApp sempre reduz a imagem de preview de link (`og:image`) a uma miniatura pequena e fixa — isso é um comportamento do próprio app, não depende do tamanho/resolução do arquivo enviado, então nenhum redesenho de imagem resolve enquanto ela for usada como preview de link; e (b) os clientes estavam desconfiando do link recebido, o que reforça a importância de a imagem "de verdade" (grande, nítida) chegar de outra forma.

**Solução final**: voltar ao modelo da seção 19.7, mas com o link real da Claro (não mais a página-ponte). Fluxo:
1. O consultor baixa a imagem pelo botão **"Baixar imagem"** (`href` fixo pra `https://apexsmart.com.br/biometria_preview.png`, atributo `download`) e envia como **foto de verdade** na conversa do WhatsApp — assim ela aparece em tamanho normal na tela do cliente, sem qualquer redução.
2. Em seguida, o consultor envia o **link real de biometria da Claro** (o que veio do sistema da Claro pra aquele cliente), usando o botão "Enviar no WhatsApp" (mensagem pronta com saudação + explicação + link) ou copiando o link com "Copiar link". `montarLinkBiometria(nome, link)` voltou a só normalizar e devolver o próprio link informado — sem passar pela página-ponte.

`biometria.html` e a Edge Function `biometria-preview` continuam publicados, mas sem uso (código morto, ver seção 19.5).

**Imagem `biometria_preview.png` redesenhada (v4)**: mais simples que a v2/v3 — logo da Claro ainda maior (400px de altura), badge "Biometria facial" removido (menos elementos, mais foco), headline maior, subtexto reduzido a uma linha curta, e a caixa "Toque no link enviado logo em seguida" com seta apontando pra baixo (igual à v2, seção 19.7) — volta a fazer sentido aqui, já que o link chega mesmo como mensagem separada logo depois da foto.

### 19.10 Mensagem do WhatsApp reforçada contra desconfiança/phishing (10/09/2026)

O usuário perguntou quais são as melhores práticas de mercado pra o cliente sentir confiança ao receber o link pelo WhatsApp (relato de clientes desconfiando do link). A prática mais forte — conta comercial do WhatsApp verificada pela Meta (selo azul/verde) — é uma decisão de negócio fora do escopo do painel (depende de WhatsApp Business API + verificação do Business Manager com CNPJ). Dentro do que o painel controla, `montarMensagemWhatsapp(nome, linkGerado, consultorNome)` foi reforçada:

- Passou a receber um terceiro parâmetro, `consultorNome` — preenchido automaticamente com `currentUser.nome` (o consultor logado) na hora de gerar o link. A mensagem se apresenta ("Aqui é {consultor}, consultor(a) da Claro Empresas (Apex Smart Solutions)"), o que reduz a sensação de disparo automático/anônimo — mensagens que identificam quem está falando são reconhecidamente mais confiáveis que links "frios". Se por algum motivo não houver usuário logado, cai numa apresentação genérica ("seu(sua) consultor(a) da Claro Empresas").
- O texto passou a reforçar explicitamente que o link é **oficial**, gerado pelo sistema da Claro — frase final "Esse é o link oficial gerado pelo sistema da Claro. Qualquer dúvida, me chama por aqui mesmo." — seguindo a recomendação de mercado de nunca deixar um link "pelado" sem contexto, e de deixar claro um canal de retorno pro cliente tirar dúvida antes de clicar.

Outras recomendações de mercado (fora do escopo de código, ficam como orientação pro time comercial): evitar tom de urgência exagerado; manter a conversa no mesmo número que o cliente já reconhece (evitar número novo); e, se possível, buscar a verificação oficial da conta comercial da Apex no WhatsApp Business (selo azul/verde), que é o maior fator isolado de confiança.

- **09/09/2026** — Criada a funcionalidade de Biometria facial: nova aba "Biometria" no painel (todos os perfis), que gera um link de "página-ponte" para o consultor enviar ao cliente pelo WhatsApp. A página-ponte tem tags Open Graph fixas com uma imagem única da Claro Empresas (`biometria_preview.png`) e mostra o nome do cliente e um botão que leva pro link real e específico de biometria daquele cliente. Existe porque uma imagem sozinha nunca é clicável no WhatsApp, e o link real da Claro não tem as tags de preview configuradas do jeito desejado. Ver seção 19.
- **09/09/2026** — Esclarecido com o usuário que o clique no card de preview do WhatsApp sempre leva pra UM link só (a página inteira, não um "botão" isolado dentro da imagem) — por isso o nome do cliente entra no texto da página-ponte, e não na imagem de preview (que continua única e compartilhada por todos os clientes, pra não atrasar a geração do preview). Ver seção 19.2.
- **10/09/2026** — Corrigido: a página-ponte, publicada inicialmente como Edge Function do Supabase, aparecia como texto cru no navegador (tags HTML visíveis, sem renderizar) em vez de uma página normal. Causa: o Supabase reescreve toda resposta `GET` com `Content-Type: text/html` para `text/plain` — Edge Functions lá não servem páginas web, só APIs (confirmado na documentação oficial). A página-ponte foi reescrita como um **arquivo HTML estático** (`biometria.html`), publicado via SFTP no mesmo servidor do painel; as tags Open Graph continuam fixas no HTML (lidas normalmente pelo WhatsApp), e só a saudação/link visíveis ao cliente são preenchidos por um JavaScript no navegador, a partir dos parâmetros da URL. Testado com um link real de biometria (via metatags.io, que simula o mesmo mecanismo de leitura de tags OG usado pelo WhatsApp) — preview funcionando corretamente.
- **10/09/2026** — Decisão do usuário: abandonar a página-ponte e voltar a enviar o **link real da Claro direto** no WhatsApp, abrindo mão do preview com a identidade visual da Claro Empresas em troca de simplicidade. `biometria.html`, `biometria_preview.png` e a Edge Function `biometria-preview` ficaram publicados mas sem uso (código morto, não removido). Ver seção 19.5 e 19.6.
- **10/09/2026** — Reformulado a pedido do usuário: `biometria_preview.png` redesenhada em formato retrato bem maior (1080×1350), para ser enviada como **anexo de foto** (não mais como preview de link) junto do link em texto na legenda/mensagem. Adicionado botão "Baixar imagem" na aba Biometria, já que links `wa.me` não conseguem anexar mídia automaticamente (limitação de plataforma). Ver seção 19.7.
- **10/09/2026** — Voltou pra página-ponte `biometria.html`, achando mais simples enviar um único link do que baixar+anexar a imagem manualmente. `montarLinkBiometria` volta a montar a URL da página-ponte (com nome+link como parâmetros); botão "Baixar imagem" removido; imagem ajustada com CTA genérico "Toque para continuar →" no lugar do texto "toque no link enviado logo abaixo" (que só fazia sentido no fluxo anterior). Ver seção 19.8.
- **10/09/2026** — Decisão final (mesmo dia): ao ver o card de verdade no WhatsApp, a imagem ficou pequena (limitação do WhatsApp, que sempre reduz `og:image` a miniatura) e os clientes estavam desconfiando do link. Voltou ao modelo de foto separada (seção 19.7), mas agora com o **link real da Claro direto** (sem página-ponte) — botão "Baixar imagem" reativado, imagem redesenhada mais simples e com logo/texto maiores (v4, sem o badge "Biometria facial", com a caixa "Toque no link enviado logo em seguida" de volta). Ver seção 19.9.
- **10/09/2026** — Mensagem do WhatsApp reforçada com boas práticas de mercado contra desconfiança/phishing: passou a se apresentar com o nome do consultor logado e a reforçar que o link é oficial da Claro. Ver seção 19.10.

## 20. Analisar Fatura — estrutura inicial dentro da aba "Gerar Proposta" (18/09/2026)

### 20.1 O que foi pedido

O usuário pediu um botão **"Analisar Fatura"** dentro da aba "Gerar Proposta", pra anexar a fatura atual de um cliente e fazer um **"de para"** contra uma oferta do book, comparando o que o cliente paga hoje com uma oferta específica (não o motor de proposta genérico já existente — ver seção 4). Dois pontos ficaram para uma mensagem seguinte, ainda não recebida:

1. **A oferta do book** a ser usada como referência na comparação (o usuário disse "vou enviar em breve").
2. **A regra de análise** — como exatamente extrair os dados da fatura (quais campos, de qual operadora, etc.) e como mapeá-los pra fazer o "de para" (o usuário disse "vou enviar na sequência").

Como o pedido foi explícito — *"enquanto isso inicie a criação da estrutura solicitada"* — a estrutura abaixo foi construída sem esperar por esses dois itens, deixando um ponto único de entrada (`analisarFatura()`) pronto pra receber a lógica real assim que a regra e a oferta chegarem.

### 20.2 O que foi construído (só estrutura, sem análise real ainda)

- **Novo card "Analisar Fatura"**, dentro do `panel-proposta` (a aba "Gerar Proposta"), logo abaixo do card existente "Proposta avulsa" — mesma aba, card separado, mesma visibilidade (todos os perfis: admin, supervisor, consultor).
- **Botão "Analisar Fatura"** abre um novo modal, `#faturaOverlay`, seguindo o mesmo padrão visual dos outros modais do painel (`#leadOverlay`, `#motivoOverlay` etc.).
- O modal pede: **nome do cliente/empresa** (opcional, só pra identificar a fatura depois) e o **arquivo da fatura** (`<input type="file" accept="application/pdf,image/*">` — aceita PDF ou imagem, já que não se sabe ainda em que formato o cliente vai mandar a fatura).
- Ao selecionar o arquivo, o nome e o tamanho aparecem na tela (confirmação visual de que o anexo certo foi escolhido).
- Botão **"Analisar"**: exige que um arquivo tenha sido anexado (senão mostra erro); guarda o arquivo e o nome do cliente em `faturaState` e chama `analisarFatura(state)`.
- **`analisarFatura()` — só o placeholder por enquanto**: confirma visualmente o recebimento do arquivo (nome do arquivo e do cliente, se informado) e explica que o "de para" com a oferta do book ainda não foi configurado, porque a regra de análise e a oferta ainda não chegaram. Nenhum PDF é lido, nenhum dado é extraído — é só a confirmação de que o anexo chegou até o painel.
- Texto do arquivo/nome do cliente é escapado (`escapeHtml()`, novo helper local — o painel não tinha um helper genérico de escape até agora) antes de entrar no HTML do resultado, por segurança.

### 20.3 O que falta (bloqueado até o usuário enviar os dois itens da seção 20.1)

Quando a oferta do book e a regra de análise chegarem, `analisarFatura()` deixa de ser um placeholder e passa a: extrair os dados relevantes da fatura anexada (operadora atual, valor, linhas, plano — o que a regra definir), montar a comparação "de para" contra a oferta indicada, e exibir o resultado no mesmo bloco `#faturaResultado`. Dependendo do formato da fatura (PDF de texto x imagem escaneada), pode ser necessário adicionar uma biblioteca de leitura de PDF e/ou OCR — isso só fica claro quando o formato real da fatura for conhecido.

### 20.4 Suposições assumidas (a confirmar com o usuário)

Como o pedido definiu o objetivo mas não os detalhes visuais/técnicos, foram assumidas por padrão, seguindo os mesmos padrões já usados no resto da aba "Gerar Proposta": card novo ao lado de "Proposta avulsa" (não substituindo nada); aceita PDF ou imagem; visível a todos os perfis, sem nenhuma restrição adicional de acesso. Qualquer um desses pontos pode ser ajustado a pedido do usuário.

- **18/09/2026** — Criada a estrutura inicial de "Analisar Fatura" dentro da aba "Gerar Proposta": novo card com botão que abre um modal pra anexar a fatura (PDF/imagem) e nome do cliente opcional. Por enquanto só confirma o recebimento do arquivo — a comparação "de para" com a oferta do book aguarda a regra de análise e os dados da oferta, que o usuário vai enviar em seguida. Ver seção 20.

## 21. Book Clareando Setembro/2026 (v3) — atualização parcial do catálogo (18/09/2026)

O usuário enviou o book "Clareando Setembro/2026 v3" (242 páginas, convertido pra markdown) e pediu pra atualizar todo o catálogo de ofertas do painel. Boa parte do book é só descritivo (produtos B2B que o painel não modela, como MPLS, SD-WAN, PABX Virtual, Vip Único, Internet Dedicada) e várias tabelas de preço mais complexas vieram na conversão como texto solto ("valores variam de X a Y"), sem todas as células — atualizar essas sem o número exato seria inventar preço, o que não foi feito. O que tinha número explícito e mapeia numa estrutura já existente do painel foi atualizado:

- **`OFFERS_MOBILE`**: adicionado o plano Nacional 30GB por R$44,99 (Pág. 49 do book) e o plano de Portabilidade 25GB por R$44,99 (Pág. 51). Os demais planos (12/40/70/100/150GB nacional, 15GB regional, Pág. 60, portabilidade 6/21/60GB) conferem exatamente com os valores já cadastrados — sem mudança.
- **`CLARO_FIBRA`**: conferido contra o book (400MEGA R$79,90, 600MEGA R$59,90/3 meses depois R$89,90, 800MEGA R$109,90, 1GIGA R$149,90, 5GIGA R$449,90, 10GIGA R$1.949,90) — tudo igual ao que já estava cadastrado, sem mudança.
- **`CLARO_PASSAPORTE`**: o book só lista os valores de 5GB (Américas R$14,99, Europa R$24,99, Mundo R$34,99/mês/linha), que batem exatamente com o tier de 5GB já cadastrado — sem mudança nas demais franquias (não confirmadas neste book).
- **`CONVERGENCIA_OFERTAS`**: o Mega Bônus da convergência Claro fibra + Claro pós aumentou de 30GB pra 50GB nesse book ("PRÉ-BLACK FRIDAY"). Atualizados `gbTotal` e `valor` dos 3 combos existentes (1GIGA+15GB regional, 800MEGA+12GB, 800MEGA+40GB) pros novos totais/preços do book. **Não adicionado**: o book tem um 4º combo novo (Claro-fibra 600MEGA + Claro-pós 71GB, R$99,89 por 3 meses/R$129,89 depois, grupos Padrão Especial/Especial+, com uma variante de R$94,89/R$124,89 exclusiva pra portabilidade nos grupos Mercados em Desenvolvimento/Redes Neutras) — a franquia base do combo é descrita como "10GB + 11GB" (21GB), mas não ficou claro se é um plano nacional novo de 21GB ou uma composição de dois planos já existentes; não foi adicionado pra não arriscar inventar o plano-base. Fica pendente de confirmação com o usuário.
- **Claro Monitor**: a Jornada de Mobilidade (R$5,00/licença, fidelidade 24 meses) — que é a forma já usada na proposta — não mudou de preço. O book traz também um "Claro Monitor Avançado" (R$179,90/mês, usado nos combos "Ofertas Convergentes com Soluções Digitais") e uma lista grande de produtos de soluções digitais com preço próprio (Blip Go, Site Pronto, Gestão de Negócios, Microsoft 365, Google Workspace, McAfee, EDR, Be Digital, Starbem etc.) — isso fica pra quando o seletor "renovação com inclusão de produtos de soluções digitais" for implementado (ver seção 6, itens pendentes), não foi criado ainda nenhuma UI nova pra esses produtos.

- **18/09/2026** — Atualizado o catálogo de ofertas (`OFFERS_MOBILE`, `CONVERGENCIA_OFERTAS`) pro book Clareando Setembro/2026 v3: 2 planos novos (Nacional 30GB, Portabilidade 25GB) e o Mega Bônus de convergência de 30GB pra 50GB (com os 3 combos existentes reajustados). `CLARO_FIBRA`, `CLARO_PASSAPORTE` e o preço-base do Claro Monitor conferem sem alteração. Ver seção 21.

## 22. Analisar Fatura — leitura real do PDF e comparação de-para por linha (18/09/2026)

Substitui o placeholder da seção 20 (que só confirmava o recebimento do arquivo). Com a fatura real (`MASALVADOR.pdf`) e a explicação do usuário sobre como identificar o plano de cada linha, `analisarFatura()` passou a ler o PDF de verdade e montar a comparação "de para" linha por linha.

### 22.1 Regra de leitura confirmada pelo usuário

Dentro da fatura Claro Empresas, cada linha móvel tem um bloco **"DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (DDD) NÚMERO"**, com uma tabela **"Mensalidades e Pacotes Promocionais"**. O plano da linha é a linha `Claro Pós <N>GB` que aparece **com traço** (`-`) nessa tabela — o traço indica que aquele item está embutido no preço da "Oferta Conjunta Claro MIX" (não cobrado à parte). Esse bloco por linha é mais confiável de extrair do texto do PDF do que a tabela agrupada de 6 colunas do início da fatura (onde o alinhamento traço×coluna se perde na extração de texto linear). O usuário confirmou o padrão com dois exemplos reais: linha (17) 99219-9652 → 10GB, linha (17) 99244-3093 → 20GB — os dois batem com o que o parser (`extractFaturaLinhas`) extrai da fatura anexada.

### 22.2 O que foi construído

- **Leitura de PDF client-side via pdf.js** (`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174`, mesma filosofia das outras libs já usadas no painel — jsPDF, xlsx — tudo estático, sem backend próprio). `getPdfjsLib()` carrega a lib do CDN e configura o worker na primeira chamada.
- **`extractFaturaLinhas(fullText)`**: recebe o texto extraído do PDF (todas as páginas concatenadas) e devolve uma linha por bloco "DETALHAMENTO..." encontrado, com telefone, valor mensal (via "Oferta Conjunta Claro MIX"), plano em GB (via `Claro Pós <N>GB` com traço) e se a linha tem Claro Monitor / Aplicativos Digitais inclusos.
- **`pickOfertaAlvoPadrao(linhas)`**: sugere automaticamente, como ponto de partida, uma oferta de renovação (não regional) do catálogo com franquia ≥ a maior franquia já contratada entre as linhas da fatura — o consultor pode trocar a oferta-alvo num seletor.
- **`renderFaturaComparacao(linhas, ofertaAlvoId)`**: monta a tabela de comparação, **uma linha por telefone**, nunca somando ou misturando linhas — cada linha mostra o plano/valor atual, o plano/valor da oferta-alvo e o badge "economia de R$X (Y%)" (fica mais barato) ou "aumento de R$X (Y%)" (fica mais caro). Essa é a mesma filosofia "avaliação unitária por linha" que a regra de comissão da seção 4.3/6 vai usar (ver pendência abaixo).
- Se o arquivo anexado não for PDF (`accept` do input ainda aceita imagem), o painel avisa que a leitura automática só funciona com PDF por enquanto, sem tentar OCR.
- Se o PDF não tiver nenhum bloco "DETALHAMENTO..." reconhecível, o painel avisa que não encontrou nada, em vez de mostrar uma tela vazia ou travar.

### 22.3 Fonte de valor por linha para a regra de comissão (decisão do usuário)

Perguntado se dava pra aproximar o valor atual por linha usando o ARPU do cliente (valor total da fatura ÷ nº de linhas), o usuário recusou a aproximação: *"vou enviar a fatura para sua analise e interpretacao"*. Ou seja, o valor de referência por linha (pra seção 4.3/6 — meta de 10% por linha) deve vir da fatura real analisada aqui (`linhas[].valorMensal`), não de uma média. Isso ainda não foi conectado à regra de comissão (item pendente, seção 6) — por enquanto `analisarFatura` só compara contra uma oferta-alvo manualmente escolhida, sem gravar o resultado na proposta.

### 22.4 Testado

`test_analisar_fatura.js` ganhou um mock de pdf.js (`window['pdfjs-dist/build/pdf']`, já que o jsdom não carrega scripts externos de verdade) alimentado por uma fixture de 3 linhas baseada na fatura real (10GB/20GB — exemplos do usuário — e 50GB, pra provar que o parser não é fixo pra um valor só). Cobre: extração correta dos 3 campos por linha, texto vazio/sem blocos não quebra, sugestão automática de oferta-alvo, e a comparação sempre gera uma `<tr>` por telefone (nunca uma soma agregada) — com pelo menos uma linha em "economia" e uma em "aumento" na mesma fatura, provando que a avaliação é mesmo por linha.

### 22.5 Correção (18/09/2026): a fatura real não era reconhecida — espaçamento de acento do pdf.js

Ao testar com a fatura real (a mesma `MASALVADOR.pdf` já usada como referência), "Analisar Fatura" respondia "Não encontrei nenhum bloco...", mesmo o PDF tendo o formato esperado. Causa: extraindo o texto real via pdf.js (fora do painel, direto com a biblioteca, pra depurar), cada caractere acentuado (ç, ã, é, ó, õ, ú etc.) sai como um item de texto separado do resto da palavra — e como `analisarFatura()` junta os itens da página com espaço (`items.map(i => i.str).join(' ')`), o resultado fica com espaço colado no acento: "LIGAÇÕES" vira "LIGA ÇÕ ES", "Descrição" vira "Descri çã o", "Pós" vira "P ó s". Os regexes de `extractFaturaLinhas()` (que buscavam o texto literal com acento normal) nunca batiam com esse formato — só batiam com a fixture de teste, que foi digitada à mão sem esse artefato.

**Correção**: nova função `normalizePdfAccents()`, aplicada logo no início de `extractFaturaLinhas()`, que remove qualquer espaço colado (dos dois lados) a um caractere acentuado latino — reconstrói "LIGA ÇÕ ES" → "LIGAÇÕES", "P ó s" → "Pós" etc., sem afetar espaços de separação entre palavras normais (sem acento). Validado extraindo o texto real das 28 páginas da fatura `MASALVADOR.pdf` (fora do painel, com a biblioteca pdf.js direto) — as **30 linhas móveis da fatura** foram todas reconhecidas corretamente após a correção, incluindo os 2 exemplos originais do usuário.

`test_analisar_fatura.js` ganhou uma nova fixture com um recorte **literal** do texto real que o pdf.js devolveu pra 3 linhas da fatura (não escrita à mão) — prova que o parser aguenta o espaçamento real, não só a fixture "limpa" já existente.

- **18/09/2026** — Corrigido bug que impedia `extractFaturaLinhas()` de reconhecer qualquer fatura real: o pdf.js insere espaço colado a cada caractere acentuado, quebrando os regexes de busca. Adicionada `normalizePdfAccents()`. Validado com o texto real das 30 linhas da fatura MASALVADOR.pdf. Ver seção 22.5.

- **18/09/2026** — `analisarFatura()` deixou de ser placeholder: agora lê o PDF de verdade (pdf.js), identifica o plano de cada linha pelo traço em "Claro Pós \<N\>GB" dentro do bloco "DETALHAMENTO..." de cada telefone, e mostra a comparação de-para **por linha** (nunca agregada) contra uma oferta de renovação sugerida automaticamente (trocável pelo consultor). Ver seção 22.

## 23. Analisar Fatura — sugestão de upgrade/downgrade por consumo real e conexão com o motor de proposta (22/09/2026)

Pedido do usuário: *"em analise de fatura, analisar o consumo do cliente em cada linha gerar um comparativo e sugestao de upgrade ou downgrade do plano, deixar o plano sugerido setado e deixar a opcao de incluir incremento ou outro servico da claro, principalmente solucoes digitais, mais precisamente claro monitor por exemplo."* Substitui a lógica da seção 22 (uma única "oferta-alvo" escolhida manualmente e aplicada a todas as linhas) por uma sugestão **individual por linha**, baseada no consumo real de dados de cada linha, com a oferta sugerida já pré-selecionada (mas trocável) e a opção de gerar a proposta de verdade a partir do resultado.

### 23.1 Decisões confirmadas com o usuário (AskUserQuestion, 22/09/2026)

- **Fonte do dado de consumo**: extraído da própria fatura (bloco "Internet (MB)" / "Subtotal" dentro do detalhamento de cada linha), não estimado.
- **Regra de upgrade/downgrade**: limiares de % da franquia contratada. Confirmado: **≥ 90% da franquia → sugere upgrade**; **≤ 40% da franquia → sugere downgrade** (com margem de segurança, ver 23.2); entre 40% e 90% → mantém o plano atual.
- **Relação com a seção 22**: a sugestão por consumo **substitui** a antiga `pickOfertaAlvoPadrao` (oferta-alvo única pra fatura inteira) — removida.
- **Incremento/serviços digitais**: as opções de incluir incremento (linhas extras) ou serviços como Claro Monitor, oferecidas junto do resultado da análise, **se conectam ao motor de proposta já existente** (mesma tela de "Gerar Proposta"), em vez de ficarem soltas.

### 23.2 Extração do consumo (`internetMbUtilizado`)

`extractFaturaLinhas()` ganhou um novo campo por linha, extraído do mesmo bloco "DETALHAMENTO..." já usado pra achar o plano (seção 22.1): busca "Internet (MB)" seguido (mais adiante no bloco) de "Subtotal \<valor\>", onde `<valor>` é o consumo real em MB no mês. Passa por `normalizePdfAccents()` e `parseBRLInput()` como os demais campos numéricos da fatura. Se o padrão não for encontrado no bloco, assume 0 (linha sem consumo de dados detectável).

### 23.3 Regra de sugestão (`sugerirPlanoConsumo(linha)`)

- `LIMIAR_UPGRADE_PCT = 90`, `LIMIAR_DOWNGRADE_PCT = 40`, `MARGEM_DOWNGRADE = 0.8` (80%) — a franquia do plano de downgrade candidato, multiplicada pela margem, precisa ainda cobrir o consumo real, pra não sugerir um plano menor que na prática já nasceria estourado.
- O catálogo considerado é `planosRenovacaoCatalogo()`: ofertas de `OFFERS_MOBILE` do tipo `renovacao`, excluindo planos regionais (mesma base de planos já usada na seção 22 pra sugestão automática).
- `pct = consumoMb / franquiaMbAtual * 100` (franquia atual em MB = `planoGb * 1024`).
- **Upgrade** (pct ≥ 90%): busca, entre os planos do catálogo com franquia maior que a atual, o menor que já cobre o consumo real (senão o maior disponível); em caso de empate de franquia, o mais barato.
- **Downgrade** (pct ≤ 40%): busca, entre os planos com franquia menor que a atual, os que — mesmo com a margem de 20% de folga (`MARGEM_DOWNGRADE`) — ainda cobririam o consumo; usa o maior desses (mais próximo do consumo real, evitando downgrade agressivo demais); se não houver nenhum plano menor que atenda com folga, **mantém o plano atual** em vez de forçar um downgrade que fica apertado (ex.: linha de 10GB quase sem uso não tem pra onde descer no catálogo atual — fica em "manter").
- **Sem consumo detectável ou sem plano atual reconhecido** → `acao: 'indefinido'`, sem oferta sugerida.
- Resultado: `{ acao: 'upgrade'|'downgrade'|'manter'|'indefinido', pctFranquia, oferta }`.

### 23.4 Interface — comparação por linha com seleção pré-marcada

`renderFaturaComparacao(linhas, escolhas)` foi reescrita (antes recebia uma única `ofertaAlvoId`): agora cada linha da tabela tem seu próprio `<select>` de "Plano proposto", **pré-selecionado com a sugestão de `sugerirPlanoConsumo()`**, mas o consultor pode trocar manualmente linha a linha — a escolha manual fica guardada em `faturaState.escolhas.porLinha[idx]` e sobrevive a re-renderizações. Colunas da tabela: linha, plano atual, consumo do mês, badge da sugestão (`badgeAcaoConsumo` — verde pra downgrade/economia, amarelo/atenção pra upgrade, neutro pra manter/indefinido, sempre com o % da franquia quando disponível), plano proposto (select), valor atual, valor proposto e diferença.

Abaixo da tabela, um bloco "Incluir na proposta": toggle de Claro Monitor (com quantidade, padrão = nº de linhas da fatura) e uma lista de grupos de incremento (quantidade + oferta, com botões de adicionar/remover grupo) — mesma UX dos grupos de incremento já usada em "Gerar Proposta" (seção correspondente ao motor de proposta). Um botão "Gerar proposta a partir da fatura" fecha o modal de análise e abre a tela de proposta já preenchida.

### 23.5 Conexão com o motor de proposta (`gerarPropostaDaFatura`)

Ao clicar em "Gerar proposta":

- Agrupa as linhas por oferta escolhida (a sugerida ou a trocada manualmente) — vira `renewGrupos: [{offerId, qtd}]`, agrupando linhas diferentes que caíram na mesma oferta num único grupo com a quantidade somada (mesmo formato que a tela de proposta já usa pra renovação).
- Monta um objeto `client` sintético a partir dos dados da fatura: nº de linhas, valor total do contrato (soma de `valorMensal` de todas as linhas), ARPU calculado, DDD da primeira linha; nome do cliente vem do campo opcional preenchido na análise (ou um texto genérico se vazio).
- Se o toggle de Claro Monitor estiver marcado, adiciona a linha extra em `extras` (R$5/licença, mesma regra de preço já usada — ver seção 21).
- Os grupos de incremento marcados na tela de análise viram `incrementos`.
- Chama `openProposal(client, {...})` com os novos parâmetros de override (`renewGruposOverride`, `incluirIncrementoOverride`, `incrementosOverride`, `incluirExtrasOverride`, `extrasOverride`) — `openProposal()` foi ajustada pra usar esses overrides quando presentes, em vez dos valores-padrão que calcularia sozinha (formulário de proposta avulsa). O restante do fluxo de proposta (cálculo de comissão, PDF, envio) **não muda** — a análise de fatura só alimenta os dados iniciais.

### 23.6 Testado

`test_analisar_fatura.js` foi atualizado: fixture de 3 linhas ganhou os blocos "Internet (MB)"/"Subtotal" (linha 1: 10GB quase sem uso → mantém; linha 2: 20GB em ~50% de uso → mantém; linha 3: 50GB estourado → upgrade), com um caso adicional de downgrade e um de "indefinido" (sem plano/consumo reconhecível). Cobre: extração de `internetMbUtilizado`, as 4 ações de `sugerirPlanoConsumo()` (upgrade/downgrade/manter/indefinido), pré-seleção correta do select por linha, troca manual persistindo no estado, e `gerarPropostaDaFatura()` — incluindo um caso propositalmente construído em que duas linhas diferentes sugerem a mesma oferta, pra provar que o agrupamento em `renewGrupos` soma a quantidade em vez de criar grupos duplicados. Toda a suíte de regressão do painel (fechamento, filtros, funil, mapa de cobertura, movimentação, PDF, venda por origem de lead, visão diária, reorganização de abas) foi reexecutada após a mudança — sem quebras.

- **22/09/2026** — `analisarFatura()`: sugestão de upgrade/downgrade agora é **por linha**, baseada no consumo real de dados (limiares de 90%/40% da franquia), substituindo a antiga oferta-alvo única da fatura inteira. Plano sugerido já vem pré-selecionado por linha (trocável). Adicionada a opção de incluir Claro Monitor e grupos de incremento junto do resultado, conectada ao motor de proposta (`gerarPropostaDaFatura` → `openProposal` com overrides) — permite gerar a proposta de verdade a partir da fatura analisada. Ver seção 23.

### 23.7 Fatura escaneada (PDF sem texto): aceitar .md/.txt já transcrito (22/09/2026)

Testando em produção logo após o deploy da seção 23, o usuário anexou uma fatura real (`UMUNIDADEMEDICA.pdf`, 26 páginas) e recebeu "Não encontrei nenhum bloco de Detalhamento de ligações...". Investigando: o PDF não tinha **nenhuma** camada de texto (confirmado extraindo com duas bibliotecas Python diferentes — 0 caracteres em todas as 26 páginas) — era um PDF escaneado/rasterizado (cada página é uma imagem). Como o pdf.js só lê texto real do PDF, `extractFaturaLinhas()` nunca tinha o que processar — não era um bug de regex, e sim um tipo de arquivo sem suporte.

Antes de decidir a solução, foi verificado (renderizando as páginas como imagem) se essa fatura seguia a mesma estrutura já suportada (seção 22.1) ou se era um formato diferente (esse cliente tem um plano "MIX" com várias franquias combinadas por linha). Confirmado nas páginas internas do PDF: a mesma estrutura "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (DDD) NÚMERO" + "Mensalidades e Pacotes Promocionais" + "Claro Pós NGB" com traço está presente, cobrindo dezenas de linhas móveis — e a seção "Internet (MB)" / "Subtotal" (usada pela sugestão de upgrade/downgrade da seção 23) também aparece no mesmo formato. Ou seja: o problema era só a falta de texto, não uma estrutura de fatura diferente.

**Decisão do usuário**: em vez de OCR automático no navegador (mais arriscado pra números de franquia/consumo, que são críticos pra sugestão de upgrade/downgrade), "Analisar Fatura" passou a aceitar também um arquivo **.md ou .txt** já transcrito, além do PDF. Fluxo pra fatura escaneada: alguém (o consultor, ou pedindo pra uma IA ler as páginas escaneadas) transcreve o conteúdo da fatura pra um `.md`/`.txt` mantendo a mesma estrutura de texto de uma fatura em PDF normal, e anexa esse arquivo em vez do PDF — o parser (`extractFaturaLinhas`) é exatamente o mesmo dos dois casos, não muda nenhuma regra de negócio.

**Implementação**: `analisarFatura()` agora detecta o tipo de arquivo (`isPdf` vs `isTexto`, por extensão `.md`/`.txt` ou `type` `text/plain`/`text/markdown`) — pra PDF, extrai o texto via pdf.js como antes; pra `.md`/`.txt`, lê o conteúdo do arquivo direto (`file.text()`), pulando o pdf.js inteiramente. Depois desse ponto, os dois caminhos convergem no mesmo `extractFaturaLinhas(fullText)` — sem duplicação de lógica. O input de arquivo (`accept`) e as mensagens de erro/ajuda no modal foram atualizados pra mencionar a opção de `.md`/`.txt`.

**Testado**: `test_analisar_fatura.js` ganhou 2 novos casos usando a mesma fixture de 3 linhas já existente, entregue via `file.text()` (mock) em vez de `arrayBuffer()`/pdf.js — um pra `.md` e um pra `.txt` — confirmando que o resultado (3 linhas identificadas, comparação de-para calculada) é idêntico ao caminho PDF. Validado também manualmente contra a fatura real escaneada (`UMUNIDADEMEDICA.pdf`): confirmado que a estrutura de texto nas páginas internas bate com os regexes existentes (sem necessidade de mudar `extractFaturaLinhas`), tanto pro bloco de plano quanto pro consumo de dados.

- **22/09/2026** — "Analisar Fatura" passou a aceitar também `.md`/`.txt` já transcrito, além do PDF — pensado pra fatura escaneada (PDF sem camada de texto, que o pdf.js não consegue ler). O parser (`extractFaturaLinhas`) é o mesmo dos dois casos. Ver seção 23.7.

## 24. Ajustes no PDF da proposta: remover "redes sociais sem franquia" e rótulo de incremento (22/09/2026)

Pedido do usuário: *"no gerador de proposta, ao emitir a proposta informa que redes sociais está incluso e nao tem franquia, retire esta informação, a unica coisa ilimitada é waze e whatsapp. Outro ponto é que no incremento, está descrito incremento 1, deixar somente Incremento(s)."*

### 24.1 "Redes sociais ilimitadas" removido dos planos da Pág. 60

Os 3 planos de incremento/renovação da Pág. 60 (`p60-25`, `p60-45`, `p60-70`, em `OFFERS_MOBILE`) tinham `'Redes sociais ilimitadas (sem descontar da franquia)'` no campo `extras` — esse texto entrava na lista de "Benefícios inclusos" do PDF (via `collectOfferExtras()`) sempre que um desses planos era usado. O usuário confirmou que essa informação está incorreta: dos benefícios universais (`BENEFICIOS_UNIVERSAIS_MOVEL`), só **WhatsApp** e **Waze** são de fato ilimitados (sem descontar franquia) — não existe um benefício de "redes sociais ilimitadas" nesses planos. Removido esse item do `extras` dos 3 planos, mantendo só a nota operacional `'Input manual via TCPJ/CPC'` (que já não aparece como benefício pro cliente — filtrada por `EXTRAS_NAO_BENEFICIO`). Os benefícios de WhatsApp e Waze ilimitados continuam exibidos normalmente, sem mudança — já vinham de `BENEFICIOS_UNIVERSAIS_MOVEL`, não do `extras` de nenhuma oferta específica.

### 24.2 Rótulo do incremento no PDF: "Incremento(s)" em vez de "Incremento N"

Quando a proposta tinha mais de um grupo de incremento (planos diferentes pro incremento, ex.: 10 linhas de 40GB + 20 linhas de 12GB), cada grupo aparecia na tabela do PDF (e no resumo/meta da proposta) como "Incremento 1", "Incremento 2" etc. — numeração desnecessária, já que cada linha da tabela já se diferencia pela descrição (GB/valor). Removida a numeração: tanto o item da tabela do PDF (`generateProposalPDF()`) quanto a linha de resumo (`computeProposal()`/meta da proposta) agora usam o rótulo fixo `'Incremento(s)'` pra cada grupo, sem `${idx+1}`.

### 24.3 Testado

`test_incremento_qtd.js` (cenário com 2 grupos de incremento — 15×40GB e 20×12GB) foi atualizado: a assertion antiga verificava que não existia um 3º item numerado (`/^Incremento 3/`); substituída por duas assertions — nenhum item de incremento tem número (`/^Incremento \d/` nunca aparece) e os 2 itens de incremento aparecem exatamente como `'Incremento(s)'` na tabela do PDF. Suíte completa reexecutada sem quebras.

- **22/09/2026** — PDF da proposta: removida a informação incorreta de "redes sociais ilimitadas (sem franquia)" dos planos da Pág. 60 (só WhatsApp e Waze são de fato ilimitados) e o rótulo do item de incremento na tabela/resumo passou de "Incremento N" pra "Incremento(s)", sem numeração. Ver seção 24.

## 25. Redesign do resultado de "Analisar Fatura" + banda larga como produto adicional (22/09/2026)

Pedido do usuário: *"apos a analise da fatura abrir uma janela com designer mais amigável, moderno e de facil entendimento, as informações estão com poluicao visual, outro ponto é incluir a banda larga como opção de produto adicional lembrando que tem a convergencia com bonus."*

### 25.1 Redesign visual do resultado

O resultado da análise (`renderFaturaComparacao()`) tinha uma tabela densa de 8 colunas (Linha, Plano atual, Consumo, Sugestão, Plano proposto, Valor atual, Valor proposto, Diferença) espremida num modal de 520px — muita informação repetida linha a linha (ex.: "Valor atual"/"Valor proposto" como colunas cheias, quando é só um de-para). Reformulado:

- **Modal alargado** de 520px pra 880px (`#faturaOverlay .modal`) — só pra caber o novo layout sem espremer.
- **Resumo (KPIs) no topo**, antes da tabela: total de linhas, mensalidade atual (soma), mensalidade proposta (soma) e economia/aumento total — dá o panorama da fatura inteira sem precisar somar mentalmente cada linha. Usa o componente `.kpiGrid`/`.kpiCard` já existente na aba Digital, por consistência visual com o resto do painel.
- **Tabela reduzida de 8 pra 5 colunas** (Linha, Consumo, Sugestão, Plano proposto, Mensalidade): "Plano atual" virou um subtítulo pequeno dentro da célula "Linha"; "Valor atual"/"Valor proposto"/"Diferença" viraram uma única célula "Mensalidade" com o valor atual riscado (`text-decoration:line-through`) em cima do valor proposto em negrito, e a diferença como texto colorido compacto (verde/vermelho) embaixo — em vez de badges grandes repetidos em toda linha.
- **Consumo com barra visual** (`miniBarHtml()`, já usado na aba Digital) em vez de só número — cor verde/âmbar/vermelho conforme a % da franquia usada (mesmos limiares de `sugerirPlanoConsumo`: ≤40% verde, ≥90% vermelho, resto neutro).
- **Linhas em formato de "cartão"** (classe `.faturaTbl`, nova): fundo branco, contorno fino arredondado por linha, espaçamento entre linhas (`border-spacing`) em vez de bordas horizontais contínuas — reduz a sensação de "planilha".
- Seção **"O que mais incluir na proposta?"** (antes "Incluir na proposta"): cada item (Claro Monitor, banda larga, incremento) agora é uma caixa própria com contorno, em vez de tudo solto dentro de um único card — facilita escanear rápido o que dá pra adicionar.

### 25.2 Banda larga (Claro Fibra) como produto adicional

Novo toggle "Banda larga — Claro Fibra (venda casada com o móvel)", no mesmo padrão do toggle do Claro Monitor já existente. Reaproveita os combos de **Oferta de Convergência** já usados no gerador de proposta avulsa (`CONVERGENCIA_OFERTAS`/`convergenciaOfferList()`) em vez de oferecer fibra avulsa (`CLARO_FIBRA`) — mesma regra de negócio já documentada na seção 4 ("a fibra é sempre vendida junto com o plano móvel", venda casada): não faz sentido oferecer fibra solta numa tela que já parte de uma fatura móvel existente.

- Toggle desligado por padrão (upsell opcional, mesmo padrão do Claro Monitor/incremento — nasce fechado pra não poluir a tela).
- Ao ligar, aparece o select de combo (fibra + plano móvel) — já vem com um combo **pré-selecionado automaticamente** pelo DDD da 1ª linha da fatura (mesmo critério de "aplicável por região" já usado no gerador de proposta: `combos.find(c => c.aplicavel) || combos[0]`), mas o consultor pode trocar livremente.
- Texto de apoio deixa explícito que o valor já é o de venda casada e que o combo **ativa o Mega Bônus de dados** (bônus de convergência) na franquia da linha móvel — o pedido do usuário foi justamente "lembrar que tem a convergência com bônus".
- Ao gerar a proposta (`gerarPropostaDaFatura()`), a escolha de banda larga é propagada pro motor de proposta via dois novos overrides em `openProposal()`: `usarConvergenciaPresetOverride`/`convergenciaPresetIdOverride` (mesmo padrão de `renewGruposOverride`/`extrasOverride` já existentes) — a proposta gerada já abre com a seção "Oferta de Convergência" ligada e o combo certo selecionado, sem o consultor precisar reconfigurar na tela de proposta.

### 25.3 Testado

`test_analisar_fatura.js`: assertions do formato antigo de diferença ("economia de X"/"aumento de X" em badge) substituídas pelo novo formato compacto (`-R$`/`+R$` + resumo KPI); contagem de `<tr>` ajustada pra olhar só dentro do `<tbody>` (o `<thead>` também usa `<tr>` sem atributos agora, por causa da classe `.faturaTbl`). Novos testes: toggle de banda larga desligado não mostra o select de combo; ligado, mostra e vem com o combo pré-selecionado certo pro DDD da fatura (17 → `conv-1giga-15gb`, regional RSC/RSI); `gerarPropostaDaFatura()` propaga `fibraIncluir`/`fibraComboId` corretamente pra `proposalState.usarConvergenciaPreset`/`convergenciaPresetId` (e não liga a convergência sozinho quando a fibra não foi marcada na análise). Suíte completa reexecutada sem quebras (as únicas falhas observadas — `test_biometria_html.js`, `test_cobertura.js`, `test_dashboard_producao.js`, `test_edge_function_*.js`, o teste de canvas em `test_conversao_vendas.js` — são limitações pré-existentes do ambiente de teste isolado, sem relação com esta mudança).

- **22/09/2026** — Resultado de "Analisar Fatura" redesenhado (resumo com KPIs no topo, tabela de 8 pra 5 colunas, barra de consumo visual, linhas em formato de cartão, modal alargado) pra reduzir a poluição visual; adicionada banda larga (Claro Fibra) como produto adicional, sempre em combo de Oferta de Convergência com bônus de dados, propagado pro gerador de proposta. Ver seção 25.

## 26. Campo manual "GB do plano atual" na Situação Atual do PDF (22/09/2026)

Pedido do usuário: *"na proposta, ao gerar o pdf no plano atual informar as linhas atuais e a quantidade de GB pro linha e total da fatura."*

A base de clientes (planilha) e a proposta avulsa nunca guardaram a franquia (GB) do plano atual do cliente — só valor total do contrato/informado e ARPU (`rowToRecord()`, seção 3). Perguntado ao usuário se essa informação deveria aparecer só quando a proposta vem da análise de fatura (onde o GB por linha já é extraído de verdade, seção 23) ou como campo preenchido à mão em qualquer proposta — escolheu a segunda opção.

### 26.1 Campo manual na tela da proposta

Novo campo "GB do plano atual por linha (opcional)" (`#propPlanoAtualGb`), na seção "Situação atual" no topo do modal de proposta (`renderProposalBody()`), disponível pra qualquer tipo de proposta — cliente da base, avulsa ou vinda de "Analisar Fatura". Guardado em `proposalState.planoAtualGb` (string, nasce vazio — sem valor padrão, sem tentar adivinhar/herdar de nenhum dado existente). Digitar no campo só atualiza o estado (sem re-renderizar a tela, mesmo padrão de outros inputs simples como a quantidade do Claro Monitor).

### 26.2 Situação Atual do PDF: linhas atuais → GB por linha → total da fatura

Em `generateProposalPDF()`, a caixa "SITUAÇÃO ATUAL" foi reordenada e ganhou uma linha nova:

- **Linhas atuais** — já existia ("Linhas (voz)" pro cliente da base, "Linhas hoje" pra avulsa), só mudou de posição (era a 2ª/3ª linha, agora é a 1ª).
- **GB por linha (atual)** — nova, só aparece quando `proposalState.planoAtualGb` tem um valor numérico válido e maior que zero (campo opcional: texto vazio, "0" ou não numérico não mostra a linha, sem quebrar).
- **Total da fatura** — já existia (renomeado de "Valor total do contrato"/"Valor informado pelo cliente" pra "Total da fatura (valor do contrato)"/"Total da fatura (informado pelo cliente)", deixando o rótulo mais próximo da linguagem do usuário, sem mudar o valor calculado).

"Valor médio por linha" (cliente da base) continua exibido, só reposicionado pro final da lista.

### 26.3 Testado

Novo arquivo `test_plano_atual_gb.js` (17 assertions): campo nasce vazio em toda proposta nova; input existe e digitar nele atualiza `proposalState.planoAtualGb` sem re-renderizar; sem preencher, o PDF não mostra "GB por linha" (nem pra cliente da base, nem avulsa); preenchendo, as 3 linhas aparecem na ordem certa (linhas atuais → GB por linha → total da fatura) tanto pra cliente da base quanto avulsa; valor "0" ou texto inválido no campo não mostra a linha de GB e não lança erro. Suíte completa reexecutada sem quebras.

- **22/09/2026** — Novo campo manual "GB do plano atual por linha" em qualquer proposta; Situação Atual do PDF passou a informar linhas atuais, GB por linha (quando preenchido) e total da fatura, nessa ordem. Ver seção 26.

## 27. Situação Atual como tabela por plano (igual à Nova Proposta) + vendedor editável (23/09/2026)

Pedido do usuário, ao ver o PDF gerado com a seção 26: *"aqui em situação atual informar a quantidade de linhas por plano, valor unitário e valor total, ou seja, 5 linhas 10GB no valor de 250,00 por exemplo onde cada linha custa 50,00, 5 x 50GB, conforme modelo de nova proposta, deixar também a opção de editar ou preencher o nome do vendedor."* O campo único "GB do plano atual por linha" da seção 26 (22/09/2026, no ar por menos de um dia) foi **substituído** por essa nova mecânica — não dava pra representar múltiplos planos misturados (ex.: 5 linhas de 10GB + 3 linhas de 45GB) com um valor só.

### 27.1 Grupos do plano atual (`situacaoAtualGrupos`)

Novo estado `proposalState.situacaoAtualGrupos`: array de `{qtd, gb, valorUnit}`, um grupo por plano diferente que o cliente tem hoje. UI dentro de "Situação atual" (`renderProposalBody()`), mesmo padrão visual dos grupos de incremento/renovação já existentes — cada grupo é uma linha com 3 campos (Qtde. linhas / GB / Valor por linha) + botão Remover, e um botão "+ Adicionar plano atual" no fim. Nasce vazio (`[]`) em toda proposta nova — igual ao campo que substituiu, é preenchimento manual e opcional, porque a base de clientes não guarda esse detalhe por linha.

### 27.2 PDF: Situação Atual vira tabela itemizada quando há grupos

Extraída a função `desenharTabelaItens(items, startY)` dentro de `generateProposalPDF()` — mesmo desenho (cabeçalho vermelho ITEM/DESCRIÇÃO/SUBTOTAL, linhas alternadas branco/cinza, linha de TOTAL destacada) que já existia só pra "NOVA PROPOSTA"; a tabela de Nova Proposta passou a usar essa função também, em vez de ter o desenho duplicado.

- **Com pelo menos 1 grupo preenchido** (`qtd > 0`): a Situação Atual vira essa mesma tabela — uma linha "Plano atual" por grupo, descrição `"{qtd}× {gb}GB — {valor}/linha"`, subtotal `qtd × valorUnit`, e o TOTAL da tabela já é o total da fatura atual (não precisa repetir em outro lugar). Exemplo do próprio usuário: grupo `{qtd:5, gb:10, valorUnit:50}` vira a linha "Plano atual — 5× 10GB — R$ 50,00/linha — R$ 250,00".
- **Sem nenhum grupo preenchido** (padrão): mantém o resumo simples de antes — linhas (voz)/linhas hoje, total da fatura (do contrato ou informado pelo cliente), valor médio por linha — igual ao que já existia antes da seção 26, sem a linha "GB por linha" (que não existe mais como conceito isolado).
- Adicionado um `if(ty + 30 > 265){ doc.addPage(); ty = 20; }` defensivo antes do cabeçalho "NOVA PROPOSTA", pra cobrir o caso (raro) de a Situação Atual detalhada com muitos grupos empurrar o conteúdo perto do fim da página.

### 27.3 Vendedor editável

Novo campo `proposalState.vendedorNome`, inicializado com `currentUser.nome` em `openProposal()` mas com um input de texto editável (`#propVendedorNome`) na tela da proposta, logo abaixo do resumo "Situação atual". No PDF, o campo "Consultor" da grade de dados do cliente passou a usar `proposalState.vendedorNome || currentUser.nome` em vez de sempre `currentUser.nome` — cobre o caso de alguém gerar a proposta em nome de outro vendedor (ex.: admin/supervisor emitindo pra um consultor específico). Campo vazio cai de volta pro nome do usuário logado.

### 27.4 Testado

`test_plano_atual_gb.js` foi reescrito (não foi possível apagar/renomear o arquivo — outputs não permite exclusão) com 29 assertions cobrindo: estado inicial (`situacaoAtualGrupos` vazio, `vendedorNome` = usuário logado); UI do campo de vendedor e dos grupos (existência, valores iniciais, adicionar/editar/remover); PDF sem grupos preenchidos cai no resumo simples de antes; PDF com grupos vira tabela itemizada com a descrição/subtotal certos por grupo e linha de TOTAL; grupo com quantidade 0 é ignorado sem quebrar; nome do vendedor editado aparece no PDF, vazio cai pro nome do usuário logado; mesmo comportamento pra proposta avulsa. Suíte completa reexecutada sem quebras.

- **23/09/2026** — Situação Atual do PDF passou a virar uma tabela por plano (quantidade de linhas × GB — valor/linha — subtotal, com TOTAL), igual ao modelo da Nova Proposta, quando o consultor detalha o plano atual por linha (substitui o campo único de GB da seção 26); adicionado campo editável de nome do vendedor, usado no lugar do nome do usuário logado no PDF. Ver seção 27.

## 28. Situação Atual auto-preenchida a partir da Analisar Fatura (23/09/2026)

Pedido do usuário, no mesmo dia da seção 27: *"não precisa colocar o detalhar plano atual manualmente, basta retirar da análise da fatura os planos já existentes e mostrar na proposta com a quantidade de gb e quantidade de linhas."* Quando a proposta é gerada a partir de "Analisar Fatura" (`gerarPropostaDaFatura()`), os grupos da seção 27 (`situacaoAtualGrupos`) agora são **preenchidos automaticamente** com o plano/valor que já está na própria fatura, em vez de exigir digitação manual — a extração de linhas (`extractFaturaLinhas`) já tinha `planoGb` e `valorMensal` por linha, então não precisava pedir esse dado de novo ao consultor.

### 28.1 Agrupamento pelo plano atual da fatura

Em `gerarPropostaDaFatura(linhas, state)`, mesma lógica de agrupamento já usada pra `renewGrupos` (contagem por chave), só que agrupando pelo **plano atual** de cada linha (GB + valor mensal, direto da fatura) em vez da oferta de renovação escolhida: chave `gb + '|' + valorUnit`, contador de `qtd` por chave, `Object.values()` no final. Resultado vira `situacaoAtualGrupos`, passado como `situacaoAtualGruposOverride` pro `openProposal()` — mesmo padrão de override já usado pelos demais campos vindos da análise de fatura (renovação, incremento, extras, convergência).

### 28.2 UI manual continua disponível

A tela "Detalhar plano atual por linha" (seção 27.1) não foi removida — continua existindo pra proposta avulsa/base de clientes (que não têm dado de fatura) e pra o consultor ajustar/corrigir os grupos que vieram automáticos da fatura, se precisar. Quando a proposta vem da análise de fatura, os grupos só chegam **já preenchidos**; o consultor pode editar, remover ou adicionar mais grupos normalmente.

### 28.3 Testado

`test_analisar_fatura.js` ganhou 3 novos blocos de assertions (dentro do teste de `gerarPropostaDaFatura`): (1) com a fixture de 3 linhas em planos diferentes (10GB/48,49, 20GB/58,99, 50GB/74,99), `situacaoAtualGrupos` chega com 3 grupos, cada um com a qtd/gb/valor certos; (2) cenário sintético com 2 linhas no mesmo plano atual (10GB/48,49) + 1 linha diferente (20GB/58,99) confirma que linhas repetidas somam num grupo só (qtd=2), em vez de virar um grupo por linha; (3) reconfirmado que os demais campos da proposta (Claro Monitor, incremento) continuam corretos após essas mudanças. Suíte completa (26 arquivos de teste aplicáveis ao `_template.html`) reexecutada sem quebras — a única falha encontrada (`test_conversao_vendas.js`, 1 de 70 assertions) é pré-existente e depende da data corrente do sistema, sem relação com esta mudança.

## 29. Múltiplas faturas na Analisar Fatura — média de consumo/valor por linha (23/09/2026)

Pedido do usuário: *"na analise de fatura, liberar a opçao de inserir mais de uma fatura para que possa efetuar o calculo da media de utilização de cada linha e outras informações que sejam importantes para a avaliação da oferta, ou seja, abrir um campo para selecionar a quantidade de faturas que deseja avaliar e o campo necessário para inserir cada fatura apos isso faca a media de consumo de cada linha, valores e outras informações que achar importante."* Até aqui, "Analisar Fatura" só aceitava 1 arquivo — a sugestão de upgrade/downgrade (seção 23) e o "de-para" de valor eram baseados no consumo de um único mês, que pode ser atípico (mês de viagem, promoção pontual etc.) e distorcer a sugestão.

### 29.1 Seletor de quantidade de faturas

Novo campo "Quantidade de faturas a avaliar" no modal (`#faturaQtd`, select de 1 a 6), logo abaixo de "Cliente / Empresa". Trocar a quantidade recria os campos de arquivo dentro de `#faturaArquivosWrap` via `renderFaturaArquivosInputs(qtd)`: com 1 fatura (padrão), gera exatamente o mesmo input único `#faturaArquivo`/`#faturaArquivoInfo` de sempre — o fluxo de 1 fatura já existente e testado não muda em nada; a partir da 2ª fatura, os campos seguintes viram `#faturaArquivo2`/`#faturaArquivoInfo2`, `#faturaArquivo3`, etc., cada um rotulado "Fatura N de {qtd}". Trocar a quantidade reseta `faturaState.files` (não é possível reatribuir o `FileList` de um `<input type=file>` via JS por segurança do navegador, então os campos recriados sempre nascem vazios — o estado é resetado junto pra nunca ficar dessincronizado com a tela). O botão "Analisar" valida que todas as N faturas selecionadas foram anexadas antes de prosseguir.

### 29.2 Mesclagem por linha (`mesclarLinhasFaturas`)

Cada fatura anexada passa por `extractFaturaLinhas()` normalmente (mesmo parser de sempre, sem mudança); o resultado das N faturas é combinado pela nova função `mesclarLinhasFaturas(listaDeListas)`, que casa as linhas pelo número de telefone e calcula, por linha:

- **`internetMbUtilizado`**: média de consumo entre as faturas em que a linha apareceu — é o mesmo campo que `sugerirPlanoConsumo()` já lia antes, então a sugestão de upgrade/downgrade passa a ser calculada pela média do período informado, não por 1 mês isolado.
- **`valorMensal`**: média do valor cobrado.
- **`internetMbMin`/`internetMbMax`** e **`valorMensalMin`/`valorMensalMax`**: faixa observada entre as faturas, pra dar transparência de quanto variou.
- **`planoGb`**: o plano mais frequente entre as faturas (moda); em empate, fica com o da fatura anexada por último (assumindo ordem cronológica de upload). **`planoGbDistintos`**: lista de todos os GBs diferentes vistos pra essa linha — sinaliza quando o plano contratado mudou de uma fatura pra outra no período.
- **`qtdFaturasEncontrada`/`totalFaturas`**: em quantas das faturas anexadas essa linha apareceu — linha ausente em alguma fatura (nova, suspensa, fora do período) fica sinalizada.

Com 1 única fatura (fluxo de sempre), cada "média"/"moda" acaba igual ao valor daquela fatura só — o comportamento de sempre não muda em nada; a função só entra em ação de verdade a partir de 2 faturas anexadas.

### 29.3 UI: avisos de transparência

Quando mais de 1 fatura foi analisada, `renderFaturaComparacao()` mostra: um aviso no topo ("Consumo e valor de cada linha abaixo são a média de N faturas..."); em cada linha, "(méd.)" ao lado do consumo e a faixa mín-máx observada quando variou; um aviso discreto em vermelho quando a linha só apareceu em parte das faturas anexadas ("achada em X de Y faturas"); e outro quando o plano contratado da linha mudou no período ("plano mudou no período (XGB, YGB)"). O cabeçalho do resultado lista os nomes de todos os arquivos anexados e o texto "(média de N faturas)".

### 29.4 Resto do fluxo sem mudança

`sugerirPlanoConsumo()`, `gerarPropostaDaFatura()` e a geração de proposta (incluindo `situacaoAtualGrupos` auto-preenchido da seção 28) continuam exatamente iguais — todos já trabalhavam em cima do array de linhas recebido, então passam a operar sobre os valores médios sem precisar de nenhuma mudança própria.

### 29.5 Testado

`test_analisar_fatura.js` ganhou a seção 18, com: (a) `mesclarLinhasFaturas()` isolada — com 1 fatura o resultado bate exatamente com o valor original (regressão); com 2 faturas sintéticas (mesma linha com consumo/valor diferentes, uma linha cujo plano contratado mudou de 20GB pra 30GB, e uma linha que só aparece na 1ª fatura), confirma médias, faixa min/máx, `planoGbDistintos` e `qtdFaturasEncontrada`/`totalFaturas` calculados corretamente; (b) UI — o select `#faturaQtd` recria os inputs de arquivo (`#faturaArquivo2` aparece/desaparece ao trocar a quantidade), reseta o estado ao trocar, e valida que todas as faturas selecionadas foram anexadas antes de analisar; (c) fluxo completo anexando 2 arquivos `.txt` reais (com conteúdo diferente cada, driblando o mock global de pdf.js do teste) confirma que o resultado mostra os avisos de média/linha ausente/plano mudou, e que `gerarPropostaDaFatura()` a partir dessas linhas mescladas gera uma proposta com o valor de contrato correto (soma dos valores médios). Suíte completa reexecutada sem quebras (mesmas falhas pré-existentes de sempre, não relacionadas a esta mudança).

- **23/09/2026** — "Analisar Fatura" passou a aceitar de 1 a 6 faturas (seletor de quantidade + um campo de arquivo por fatura); com mais de 1 fatura anexada, consumo e valor de cada linha viram a média do período (não mais de um único mês), com avisos de faixa observada, linha ausente em alguma fatura e plano que mudou no período. Ver seção 29.

## 30. Modal da Analisar Fatura não fecha mais ao clicar fora + PDF amigável pro cliente (23/09/2026)

Dois pedidos do usuário no mesmo dia: *"ao abrir a analise com a sugestao de planos a tela fecha automaticamente clicando fora da pagina, corrigir para deixar a pagina aberta"* e *"outro ponto é que possamos gerar um pdf ou uma imagem para envio ao cliente com essa analise, deixe formatado para ser de facil entendimento e amigavel visualmente."*

### 30.1 Fix: clique fora do modal não fecha mais

O modal "Analisar Fatura" (`#faturaOverlay`) seguia o mesmo padrão de todos os outros overlays do painel: clicar no fundo (fora do conteúdo) fechava o modal. Só que esse modal em particular fica aberto por bastante tempo — o consultor sobe a(s) fatura(s), ajusta plano linha a linha, mexe em incremento/fibra — e um clique sem querer um pouco fora do conteúdo (comum numa tela com bastante rolagem/tabela) derrubava toda a análise sem aviso. Removido o listener de fechamento por clique no backdrop especificamente desse modal (os demais overlays do painel continuam com o comportamento de sempre — não é uma mudança global). Agora só fecha pelo X ou terminando o fluxo (gerando a proposta).

### 30.2 PDF da análise pra enviar ao cliente

Novo botão "Baixar PDF para o cliente", ao lado de "Gerar proposta com essas escolhas", no resultado da análise. Gera um PDF diferente do PDF de proposta comercial (`generateProposalPDF`, voltado ao consultor/negociação, cheio de termos de catálogo): esse é um resumo simples pensado pro CLIENTE FINAL entender de relance — quanto ele paga hoje por linha, quanto usa de internet, o que a Apex sugere e quanto muda no valor, sem jargão técnico.

Estrutura do PDF (`generateFaturaAnalisePDF(linhas, escolhas, nomeCliente)`):
- Cabeçalho: mesma faixa preta com os logos Apex + Claro do PDF de proposta, título "RESUMO DA SUA FATURA" e subtítulo explicando o que é.
- Nome do cliente e data de emissão; quando a análise usou mais de 1 fatura (seção 29), avisa "Consumo e valor baseados na média de N faturas analisadas."
- 4 caixas de resumo (linhas analisadas, mensalidade atual, nova mensalidade, economia/aumento mensal).
- Tabela por linha (telefone + valor atual, plano atual, consumo médio, plano sugerido, diferença) — reaproveita o mesmo cálculo de sugestão/valor-alvo/diferença de `renderFaturaComparacao()`, agora extraído pra uma função compartilhada `computeFaturaComparacaoRows(linhas, escolhas)` (evita as duas lógicas divergirem no futuro).
- Caixa de destaque final com o valor da economia ou do aumento, em texto grande.
- Rodapé com identificação da Apex/Claro, igual ao do PDF de proposta.

Novidade de cor: como esse PDF é pro cliente ver rapidinho se vale a pena, foram introduzidas cores semânticas que o PDF de proposta não usava — verde para economia, âmbar para aumento (o PDF de proposta usa só o vermelho fixo da marca no destaque final, sem indicar se é bom ou ruim pra quem lê).

Nome do arquivo: `analise_fatura_<nome do cliente>.pdf` (mesmo padrão de sanitização do nome já usado no PDF de proposta).

### 30.3 Testado

`test_analisar_fatura.js`: (a) o teste que verificava "clicar fora fecha o modal" foi invertido pra confirmar que **não** fecha mais; (b) novo stub completo de jsPDF (igual ao já usado em `test_pdf.js`) pra capturar as chamadas de `doc.text()`/`doc.save()`; (c) clicar em "Baixar PDF para o cliente" no resultado de uma análise multi-fatura confirma o título, o aviso de média, o cabeçalho da tabela (Linha/Plano sugerido/Diferença) e o nome do arquivo salvo; (d) chamando a função direto com uma análise de 1 fatura só, confirma que o aviso de média NÃO aparece (regressão) e que o nome do cliente é exibido. Suíte completa reexecutada sem quebras (mesmas falhas pré-existentes de sempre).

## 31. Consolidar valores das linhas + Claro Monitor como benefício + proposta comercial em Word editável (23/09/2026)

Três pedidos do usuário, no mesmo fio, sobre o documento de proposta comercial (`generateProposalPDF`, o PDF voltado ao consultor/negociação — diferente do PDF de análise de fatura da seção 30, que não muda):

1. *"no resultado da analise da fatura ao gerar a proposta dar a opção de gerar o pdf com o valor consolidado das linhas, ou seja, total de linhas e valor total ou a forma como está agora. Pois em algumas propostas o cliente possui algumas das linhas com valor menor que a valor que enviamos que pode gerar um desconforto para o mesmo."*
2. *"incluir no valor total da linha o claro monitor e mencionar ao lado de beneficios o mesmo, ou seja, junto a whatsapp e waze"*
3. *"em vez de liberar um arquivo pdf, pode ser um arquivo docx? editavel?"*

Antes de implementar o item 3, foi perguntado ao usuário (ambiguidade real de escopo): qual documento vira Word — só a proposta comercial, ou também o PDF de análise de fatura pro cliente (seção 30)? E se o Word substitui o PDF ou fica como opção adicional. Respostas: **só a proposta comercial** (o PDF de análise de fatura da seção 30 continua PDF, sem mudança) e **o Word substitui o PDF** (um botão só, um formato só — não ficou os dois).

### 31.1 Arquitetura em duas camadas (pra manter os testes simples)

Em vez de gerar o Word direto dentro de uma função gigante (como era o PDF com jsPDF), a proposta comercial agora é construída em duas camadas:

- **`buildPropostaDocModel()`**: função pura e síncrona, sem nenhuma dependência de biblioteca de documento — só lê `proposalState` e `computeProposal()` e devolve um objeto JS simples (strings/números já formatados) com tudo que vai no documento: dados do cliente, situação atual, itens da nova proposta, benefícios, valor final. É essa camada que os testes chamam direto e comparam como objeto — não precisa mockar biblioteca nenhuma.
- **`montarDocxProposta(modelo)`**: função fina que só desenha o modelo já pronto usando a biblioteca `docx` (carregada via CDN — `https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js`, expõe `window.docx`). Não tem lógica de negócio, só monta `Document`/`Table`/`Paragraph` a partir do que já veio calculado.
- **`generateProposalDocx()`**: orquestra — monta o modelo, registra no funil de vendas (síncrono, antes da parte assíncrona do Word, pra não mudar o comportamento que os testes do funil já esperavam), gera o `.docx` e dispara o download via `downloadBlob()`.

Essa separação foi decisão deliberada: os testes existentes (7 arquivos, ~20 pontos de chamada) testavam o PDF antigo capturando texto desenhado num stub de jsPDF — replicar isso pra uma lib nova (docx.js) seria muito mais trabalho e mais frágil. Com o modelo puro, os testes viraram comparação de objeto simples.

### 31.2 Consolidar valores das linhas

Novo toggle na tela de proposta: "Consolidar valores no documento (não detalhar por plano/linha)" — desligado por padrão (mantém o detalhamento de sempre; o consultor decide ativar caso a caso, avulso por proposta). Quando ligado, a seção "Nova Proposta" do documento mostra **uma linha só** ("Linhas móveis", com a quantidade total e o valor total somado) em vez de detalhar cada grupo/plano com preço por linha — evita o cliente comparar valores diferentes entre as próprias linhas dele quando a proposta mistura planos/ofertas distintos. Claro Fibra, Claro Passaporte e ofertas manuais (extras) continuam sempre itemizados nos dois modos — só as linhas móveis (aquisição/portabilidade/renovação/incremento) são afetadas pelo toggle, porque são elas que geram a comparação desconfortável entre linhas do mesmo cliente.

Campo novo em `proposalState`: `consolidarValores` (boolean, `false` por padrão), com override `opts.consolidarValoresOverride` em `openProposal()`, no mesmo padrão dos demais campos de estado da proposta.

### 31.3 Claro Monitor: sai da tabela, vira benefício

Antes, Claro Monitor aparecia como uma linha própria na tabela de itens (com preço unitário e subtotal). Agora ele nunca aparece como item — seu valor some da lista de itens, mas continua entrando no total (a soma dos itens visíveis + o valor do Monitor ainda bate com o valor total proposto, `destaque.valorProposto`, então nada foi perdido, só deixou de aparecer como linha separada). E passa a ser citado na seção de benefícios, junto dos badges universais (Ligações ilimitadas, WhatsApp ilimitado, Waze ilimitado) — só aparece esse badge extra quando a proposta realmente inclui Claro Monitor. Outras ofertas manuais (extras que não são Monitor) continuam itemizadas normalmente, sem mudança.

### 31.4 PDF → Word editável

Botão "Baixar proposta (Word editável)" (antes "Baixar PDF da proposta") gera um `.docx` com a mesma estrutura visual de antes (cabeçalho preto, tabela de itens com cabeçalho vermelho, situação atual, benefícios, caixa de destaque final, rodapé) — mas editável no Word, pra o consultor poder ajustar antes de mandar pro cliente se precisar. Nome do arquivo: `proposta_<razão social>.docx` (mesmo padrão de sanitização de antes, só troca a extensão). O PDF de análise de fatura pro cliente (seção 30) continua PDF — só a proposta comercial virou Word.

### 31.5 Testado

Reescritos `test_pdf.js`, `test_convergencia.js`, `test_incremento_qtd.js`, `test_plano_atual_gb.js`, `test_outras_ofertas.js`, `test_renovacao_multiplano.js` e `test_funil.js` pra chamar `buildPropostaDocModel()` direto e comparar o objeto retornado, em vez de capturar texto de um stub de jsPDF — ficaram mais simples que antes. `test_outras_ofertas.js` ganhou verificação específica de que Claro Monitor não aparece em `novaProposta.itens` mas aparece em `beneficios.badges` e em `novaProposta.valorMonitor`. Novo arquivo `test_consolidar_valores.js` cobre: comportamento padrão (desligado) inalterado; com o toggle ligado, todas as linhas móveis viram um item só; Fibra/Passaporte/extras manuais continuam itemizados mesmo com o toggle ligado; consistência do total (itens somados + valor do Monitor bate com o valor final) nas quatro combinações de consolidado/itemizado × com/sem Claro Monitor. Um bug real foi encontrado durante a reescrita: dois cenários antigos de `test_pdf.js` setavam `proposalState.incrementos` sem também ligar `incluirIncremento`, então `computeProposal()` descartava os incrementos silenciosamente — invisível antes porque o teste antigo só conferia contagem de chamadas do jsPDF; corrigido no teste novo. Suíte completa reexecutada sem quebras (mesmas falhas pré-existentes de sempre, não relacionadas a este código).

## 32. DDD do endereço fiscal decide ofertas regionais na Analisar Fatura (23/09/2026)

Pedido do usuário: *"ao montar a oferta de renovação, está considerando o plano de ofertas regionalizadas, precisa corrigir conforme o DDD do endereço do cliente. RSI é do DDD 12 ao 19. ajustar as ofertas conforme o endereço fiscal."*

### 32.1 O bug

A Apex só vende ofertas regionais do grupo RSC/RSI (São Paulo Capital/Interior, DDD 12 a 19) — hoje só duas ofertas do book são regionais (`p57-15reg`, 15GB/R$44,99, e `p59-60`, 60GB portabilidade) e 1 combo de Convergência (`conv-1giga-15gb`). O resto do painel (tela "Gerar Proposta", `renderProposalBody`) já decidia a elegibilidade dessas ofertas corretamente, com base no campo `ddd` do cadastro do cliente na base (`offerRegionOk`/`aplicavel`).

A tela "Analisar Fatura" é diferente: ela não parte de um cadastro da base, parte só do PDF da fatura anexada — monta um cliente sintético do zero. E tinha duas falhas:

1. O `ddd` desse cliente sintético vinha de `linhas[0].ddd` — o DDD da PRÓPRIA LINHA TELEFÔNICA lida da fatura, não do endereço fiscal/cadastral do cliente. Número portado, matriz com filiais em outro DDD etc. fazem esses dois DDDs divergirem.
2. Pior: o dropdown de "Plano proposto" (renovação) e o de incremento nem chegavam a checar região — listavam a oferta regional pra QUALQUER cliente, sem aviso nenhum, então o consultor podia oferecer o plano de RSC/RSI pra um cliente de fora da área de venda da Apex sem perceber. A sugestão automática (`sugerirPlanoConsumo`) ia pro lado oposto: excluía a oferta regional pra TODO mundo, inclusive pra quem estava de fato em DDD 12-19 (nunca sugeria a opção certa).

### 32.2 O fix

Novo campo obrigatório no modal Analisar Fatura: "DDD do endereço fiscal do cliente" (2 dígitos) — precisa ser preenchido antes de analisar (mesma validação de erro já usada pra arquivo faltando). É esse DDD, gravado em `faturaState.ddd`, que agora decide elegibilidade regional em tudo que sai da análise:

- `planosRenovacaoCatalogo(client)`: em vez de excluir toda oferta regional incondicionalmente, agora usa `offerRegionOk(oferta, client)` — mesma regra do resto do painel. Oferta regional entra no catálogo (e pode ser sugerida automaticamente por `sugerirPlanoConsumo`) só quando o DDD do cliente bate com a região.
- Dropdown "Plano proposto" (renovação) e dropdown de incremento: agora usam `offersOfType(...)`, que calcula `aplicavel` por oferta — a oferta regional continua listada (não trava a tela), mas ganha o aviso " — confirmar DDD" quando não é elegível pro DDD informado, igual ao padrão já usado no combo de Fibra/Convergência.
- Combo de Fibra/Convergência: já tinha essa checagem, mas usava o DDD da 1ª linha da fatura — trocado pro mesmo DDD do endereço fiscal, por consistência.
- `gerarPropostaDaFatura`: o cliente sintético passado pro motor de proposta (`openProposal`) agora usa `state.ddd` (fiscal) em vez de `linhas[0].ddd` (linha telefônica) — a proposta final também respeita a região certa.

Funções que dependiam de DDD ganharam um parâmetro `client` opcional (`sugerirPlanoConsumo`, `computeFaturaComparacaoRows`, `renderFaturaComparacao`) — quando omitido, cai no `faturaState.ddd` já gravado pelo formulário, então quem chama essas funções sem se preocupar com o parâmetro (ex.: o PDF de análise pro cliente, `generateFaturaAnalisePDF`) continua funcionando sem mudança.

### 32.3 Testado

`test_analisar_fatura.js`: validação do novo campo obrigatório (vazio, 1 dígito, 3 dígitos, não-numérico — todos barram a análise com erro; 2 dígitos válido libera); `planosRenovacaoCatalogo` inclui/exclui a oferta regional conforme o DDD (dentro de 12-19 x fora, ex. DDD 21); `sugerirPlanoConsumo` só sugere a oferta regional pra DDD dentro da faixa, cai pra próxima oferta nacional mais barata fora dela; dropdown de "Plano proposto" mostra "— confirmar DDD" na oferta regional quando o DDD é de fora; `gerarPropostaDaFatura` com DDD da linha telefônica (11) diferente do DDD fiscal informado (21) confirma que a proposta final usa o DDD fiscal, não o da linha. Suíte completa reexecutada sem quebras novas (mesmas 6 falhas pré-existentes de sempre, por fixture/pacote ausente no ambiente de teste, não relacionadas a este código).

## 33. Três formatos de emissão da proposta (Word/PDF/PDF cliente) + correção dos logos perdidos no Word (24/09/2026)

Pedido do usuário: *"na emissao da proposta em word perde-se os logos da Apex e da Claro, é possivel emitir no formato anterior, deixar a opção tambem de emissão em PDF, ou seja, Versao editavel, versao pdf e pdf para o cliente."*

Dois problemas no mesmo pedido: (1) um bug real — a troca do PDF pelo Word editável (seção 31) tinha derrubado os logos da Apex e da Claro do cabeçalho, porque o cabeçalho virou parágrafos de texto centralizado sem nenhuma imagem; (2) a troca de formato da seção 31 tinha sido "PDF vira Word, um substitui o outro" — o usuário agora quer os DOIS de volta, mais um terceiro formato pro cliente final.

### 33.1 Fix dos logos no Word

Nova função `getLogoBytes()`: extrai os bytes crus dos logos Apex (PNG) e Claro (JPEG), que já estão embutidos como data URI no próprio HTML (`header.topbar .logoChip img` / `.logoClaro` — preenchidos por `build_painel.py` a partir dos placeholders `__APEX_LOGO_B64__`/`__CLARO_LOGO_B64__`), via `.src.split(',')[1]` + `atob()` + `Uint8Array.from(...)`. O `docx.ImageRun` do Word precisa dos bytes de verdade — não aceita a data URI direto como o `<img src>` ou o `doc.addImage()` do jsPDF aceitam.

`montarDocxProposta(modelo)` trocou o cabeçalho de parágrafos centralizados por uma `Table` de 3 colunas com fundo preto: logo Apex (`ImageRun`) na célula da esquerda, título "PROPOSTA COMERCIAL" + subtítulo na célula central, logo Claro (`ImageRun`) na célula da direita — reproduzindo o mesmo layout de cabeçalho que o PDF sempre teve. `ImageRun` passou a ser destructurado de `getDocxLib()` junto com as demais classes já usadas (`Document`, `Paragraph`, `TextRun`, `Table`, `TableRow`, `TableCell`).

### 33.2 Três opções de emissão, um botão pra cada

O único botão "Baixar proposta (Word editável)" virou três, lado a lado, na tela de proposta:

1. **`#btnBaixarProposta`** → `generateProposalDocx()` (Word, sem mudança de comportamento além do fix dos logos).
2. **`#btnBaixarPropostaPdf`** → `generateProposalPdfConsultor()` (PDF no formato de antes da seção 31 — cabeçalho preto com os dois logos via `doc.addImage`, grid de dados do cliente, tabelas de itens com cabeçalho vermelho pra Situação Atual/Nova Proposta, badges de benefícios, caixa de destaque final com o valor proposto, rodapé em todas as páginas).
3. **`#btnBaixarPropostaPdfCliente`** → `generateProposalPdfCliente()` (PDF novo, resumido, pro cliente final).

Todos os três alimentam a partir do MESMO `buildPropostaDocModel()` (camada de dado pura, seção 31) — então as três versões sempre mostram exatamente a mesma proposta (mesma lógica de consolidar valores e Claro Monitor como benefício), nunca divergem entre si. A separação renderer/orquestrador da seção 31 se repete aqui: `montarPdfProposta(modelo)` e `montarPdfPropostaCliente(modelo)` só desenham (recebem o modelo pronto, devolvem o objeto `jsPDF` sem salvar/baixar nada); `generateProposalPdfConsultor()` e `generateProposalPdfCliente()` são os orquestradores (montam o modelo, decidem o nome do arquivo, chamam `doc.save(...)`).

### 33.3 PDF do consultor x PDF do cliente — a mesma assimetria da seção 30

Word e PDF do consultor são as duas formas "oficiais" de emitir a proposta — qualquer uma das duas conta como o ato de gerar a proposta, então as duas chamam `registrarPropostaNoFunil(modelo.destaque.valorProposto, modelo.atual)` de forma síncrona antes de salvar o arquivo (mesmo padrão que o Word já tinha desde a seção 31: PDF do consultor só trocou onde o valor vem — do modelo em vez de recalcular do zero).

O PDF pro cliente é material de apoio, não o ato formal de "gerar a proposta" — mesmo raciocínio já usado no PDF de análise de fatura (`generateFaturaAnalisePDF`, seção 30), que também nunca tocou o funil. `generateProposalPdfCliente()` **não chama `registrarPropostaNoFunil`**. Visualmente ele segue o mesmo espírito do PDF da Analisar Fatura: título "RESUMO DA PROPOSTA", 3 caixas de KPI no topo (mensalidade atual em cinza, nova mensalidade em preto, economia em verde ou aumento em âmbar conforme o sinal do delta), depois as mesmas tabelas de Situação Atual/Nova Proposta (relabeladas "SUA SITUAÇÃO ATUAL"/"NOSSA PROPOSTA", coluna "VALOR" em vez de "SUBTOTAL"), e uma caixa de destaque final verde/âmbar no mesmo padrão. Arquivo: `proposta_cliente_<razão social>.pdf` (o do consultor continua `proposta_<razão social>.pdf`, mesmo padrão de sanitização de sempre).

### 33.4 Testado

`test_pdf.js` passou a ler `painel_clientes_apex.html` (já com os placeholders de logo substituídos por `build_painel.py`) em vez de `_template.html` direto — os casos novos precisam dos bytes reais dos logos, que só existem depois do build. O stub de `docx.js` ganhou `ImageRun` (antes ausente, quebraria o novo cabeçalho em tabela) numa classe distinta do resto (`FakeImageRun extends FakeNode`), pra dar pra verificar com `instanceof` que os logos viraram `ImageRun` de verdade dentro da tabela, não só texto. Novo stub de jsPDF (`window.jspdf`, ausente neste arquivo até agora), reaproveitando o padrão `__makeDocStubFatura` de `test_analisar_fatura.js`. O stub de Supabase ganhou rastreio de chamadas por tabela (`window.__testFromCalls`) e suporte a `insert`/`update`/`eq`/`single`, pra dar pra verificar se `registrarPropostaNoFunil` foi de fato acionada (antes o stub só evitava lançar exceção, sem dar pra confirmar nada).

Casos cobertos: `getLogoBytes()` devolve `Uint8Array` não-vazio pros dois logos; `montarDocxProposta()` com o stub novo completa sem lançar e o `Document` capturado mostra que o primeiro filho do cabeçalho é uma `Table` (não mais um `Paragraph`) com 2 `ImageRun` de verdade (1ª e 3ª células) e nenhum na célula central; `generateProposalPdfConsultor()` chama `doc.save()` com `proposta_<razão social>.pdf` e toca a tabela `propostas` (funil registrado); `generateProposalPdfCliente()` chama `doc.save()` com `proposta_cliente_<razão social>.pdf` e NÃO toca a tabela `propostas`; `montarPdfProposta()` não lança com Claro Monitor incluso (4º badge de benefício, exercitando a quebra de linha dos badges quando estouram a largura da página). Suíte completa reexecutada sem quebras novas (mesmas falhas pré-existentes de sempre — fixtures/pacotes ausentes no ambiente de teste, não relacionadas a este código).

## 34. Item consolidado "Linhas móveis" passa a mencionar os planos (por GB) selecionados (24/09/2026)

Pedido do usuário: *"na proposta gerada em pdv no campo nova proposta mencionar os planos selecionados para o cliente conforme na situação atual"* (o "pdv" foi digitação errada de "pdf" — confirmado com o usuário, o pedido é sobre o campo "Nova Proposta" do documento de proposta, não sobre nenhuma tela de PDV).

Esse é um refinamento direto do toggle "Consolidar valores" da seção 31.2: quando ligado, o item "Linhas móveis" já resumia toda linha móvel (aquisição/portabilidade/renovação/incremento) numa única linha com quantidade total e valor total, exatamente pra evitar o cliente comparar valores diferentes entre as próprias linhas dele. O efeito colateral era esconder também QUAIS planos foram escolhidos — o cliente via só "8 linha(s) — valor total consolidado", sem saber se eram todas do mesmo plano ou uma mistura de franquias diferentes. Perguntado ao usuário como resolver isso sem reabrir o desconforto de comparação que a seção 31 existe pra evitar, entre (a) listar os planos por GB mantendo o valor único, ou (b) voltar a detalhar preço por linha — a resposta foi a opção (a): **listar os planos + total consolidado**, sem voltar a mostrar preço por linha.

### 34.1 O fix

Em `buildPropostaDocModel()`, cada item empilhado em `itensMoveis` (tanto os de `baseGrupos.forEach` quanto os de `incGrupos.forEach`) agora carrega também um campo `gb` (`gb: g.offer.gb`) — o item placeholder "Plano atual"/"Linha base" (quando não há nenhum grupo de renovação ativo) carrega `gb: null`, já que não representa uma oferta real.

Quando `proposalState.consolidarValores` está ligado, além de somar `qtdTotal` e `valorTotalMovel` como antes, o código agora agrupa os itens por `gb` num objeto `porGb` (soma a quantidade de todos os grupos — renovação e incremento — que caem no mesmo GB; ignora itens com `subtotal === null` ou sem `gb`), ordena as chaves da maior pra menor franquia e monta uma string tipo `"2× 40GB, 4× 12GB"`. A `desc` final do item consolidado passa a ser `"${qtdTotal} linha(s)${planosTxt ? ' — ' + planosTxt : ''} — valor total consolidado"` — por exemplo, uma renovação de 4 linhas de 12GB + 2 linhas de 40GB vira `"6 linha(s) — 2× 40GB, 4× 12GB — valor total consolidado"` (antes seria só `"6 linha(s) — valor total consolidado"`, sem dizer quais franquias). Quando o cenário todo cai num único GB, a `desc` ainda cita essa franquia (`"5 linha(s) — 5× 30GB — valor total consolidado"`), não fica sem menção nenhuma. Quando dois grupos diferentes (ex.: um de renovação e um de incremento) caem no MESMO GB, eles se mesclam numa única entrada somada (`"7× 12GB"`), a franquia não aparece repetida na descrição.

No modo itemizado (`consolidarValores` desligado, o `else` da mesma função), o campo `gb` continua sendo removido do item antes de entrar no modelo final (`({ qtd, gb, ...resto }) => resto`) — cada item já mostra o GB na própria `desc` (`"4× 12GB — R$ 39,99/linha"`), então não precisa (e não deve) expor o campo cru `gb` no objeto do modelo; esse comportamento já existia antes desta mudança e não foi alterado.

### 34.2 Testado

Estendido `test_consolidar_valores.js` (mesmo arquivo da seção 31.5, é o mesmo toggle) com:

- Múltiplos GBs diferentes consolidados (renovação 12GB + renovação 40GB): a `desc` do item "Linhas móveis" menciona as duas franquias, na ordem decrescente (40GB antes de 12GB) e com a quantidade certa em cada uma.
- Mesmo GB vindo de grupos diferentes (renovação 12GB + incremento 12GB, ambos 12GB): mesclam numa única entrada somada ("7× 12GB"), a franquia "12GB" aparece só uma vez na descrição, não duplicada.
- Cenário de um único GB (regressão — já funcionava antes via `porGb` ter uma chave só): confirmado explicitamente que a franquia continua citada na descrição, e que o formato bate exatamente com o esperado.
- Modo itemizado (padrão, sem consolidar) não foi afetado: os itens de "Renovação" continuam separados por GB, nenhum item expõe a propriedade crua `gb` (nem `qtd`) no modelo, e a `desc` de cada item continua no formato antigo (`"Nx GBGB — R$/linha"`), sem mudança.
- Em todos os cenários novos, reforçada a invariante já existente desde a seção 31 — `itens.reduce(soma dos subtotal) + valorMonitor === destaque.valorProposto` — confirmando que o agrupamento por GB mexeu só na descrição, não na matemática do total.

Suíte completa (29 arquivos `test_*.js`) reexecutada, cada um em cópia isolada com `npm install jsdom` + `python3 build_painel.py` frescos: sem quebras novas, só as mesmas falhas pré-existentes de sempre (fixture `biometria.html` ausente, arquivos `.ts` de Edge Function ausentes no diretório de teste, pacotes `canvas`/`xlsx` não instalados no ambiente) — nenhuma relacionada a este código. `test_consolidar_valores.js` sozinho: 46 asserts, 0 falhas.

## 35. Campo CNPJ (opcional) na Analisar Fatura — evita CNPJ em branco na proposta gerada (24/09/2026)

Pedido do usuário: *"Na proposta gerada tem o campo onde podemos colocar a razao social ou nome fantasia, mas na tem o campo onde colocamos o CNPJ, esta aparecendo em branco. Precisa corrigir e deixar apto para inserirmos o CNPJ e ele aparecer na proposta."*

### 35.1 O bug

O modal "Analisar Fatura" (upload da fatura → geração de proposta) tinha o campo "Cliente / Empresa (opcional)" (`faturaNomeCliente`), que vira o `razao_social` do cliente sintético da proposta — mas não tinha campo nenhum pra CNPJ. `gerarPropostaDaFatura()` montava esse cliente sintético sempre com `cnpj: ''` fixo no código, então toda proposta gerada por esse fluxo saía com o CNPJ em branco no grid de dados do cliente — tanto no Word quanto nos dois PDFs (consultor e cliente), já que os três são renderizados a partir do mesmo `buildPropostaDocModel()` → `modelo.client.cnpj` (seção 33.2).

Esse bug era específico do fluxo "Analisar Fatura". O outro fluxo de geração de proposta, "Gerar Proposta avulsa" (pra prospect que ainda não está na base de clientes), já tinha um campo `#avCnpj` opcional funcionando desde sempre — esse fluxo não foi afetado e não precisou de nenhuma mudança.

### 35.2 O fix

Mesmo padrão já usado pro nome do cliente nesse modal (campo de texto livre, opcional, sem validação):

- Novo campo no modal Analisar Fatura, logo depois de "Cliente / Empresa (opcional)": `<input type="text" id="faturaCnpj" placeholder="00.000.000/0000-00">`, rotulado "CNPJ (opcional)".
- `faturaState` ganhou o campo `cnpj` (inicializado em `''`), tanto na declaração inicial (`let faturaState = { files: [null], nomeCliente: '', cnpj: '', qtd: 1, ddd: '' }`) quanto no reset feito ao clicar em "Analisar Fatura" pra abrir o modal (`btnAbrirAnaliseFatura`), que agora também limpa `document.getElementById('faturaCnpj').value = ''` — mesmo comportamento de reset já aplicado a nome do cliente e DDD, evitando que o CNPJ de uma análise anterior vaze pra próxima.
- O clique em "Analisar" (`btnAnalisarFatura`) passou a gravar `faturaState.cnpj = document.getElementById('faturaCnpj').value.trim()` — sem validação nenhuma (campo opcional, igual ao nome do cliente; diferente do DDD do endereço fiscal, que é obrigatório desde a seção 32 e continua sendo o único campo que bloqueia a análise).
- `gerarPropostaDaFatura(linhas, state)`: o cliente sintético agora usa `cnpj: state.cnpj || ''` em vez do `''` fixo de antes — com CNPJ informado, ele chega ao `client.cnpj` da proposta (e dali pro `modelo.client.cnpj` de `buildPropostaDocModel()`); sem CNPJ informado, o comportamento de antes se mantém (string vazia, não quebra nada).

### 35.3 Testado

Estendido `test_analisar_fatura.js` com:

- Fluxo completo pela UI (abrir modal → preencher DDD, nome do cliente e `#faturaCnpj` → anexar fatura → Analisar → clicar "Gerar proposta com essas escolhas"): `proposalState.client.cnpj` bate com o CNPJ digitado, e o mesmo valor chega intacto em `buildPropostaDocModel().client.cnpj` (o campo de fato usado no Word/PDF/PDF-cliente).
- Mesmo fluxo com `#faturaCnpj` em branco (nunca preenchido): confirma que clicar em "Analisar" **não** mostra erro nenhum (o CNPJ não entra na validação obrigatória, só o DDD continua bloqueando) e que o resultado da análise aparece normalmente; `faturaState.cnpj`, `proposalState.client.cnpj` e `buildPropostaDocModel().client.cnpj` ficam todos em string vazia (`''`) — nunca `undefined`/`null`, prova explícita de que o bug relatado (CNPJ em branco/ausente na proposta) está corrigido.
- Reabrir o modal (`btnAbrirAnaliseFatura`) depois de uma análise anterior com CNPJ preenchido: `#faturaCnpj` e `faturaState.cnpj` voltam pra `''` — mesmo padrão de reset já coberto pra nome do cliente/DDD.
- Chamada direta de `gerarPropostaDaFatura()` (sem passar pela UI) com um `state.cnpj` explícito: cliente sintético grava o mesmo CNPJ, cobrindo a função isolada.

Suíte completa (29 arquivos `test_*.js`) reexecutada, cada um em cópia isolada com `npm install jsdom` + `python3 build_painel.py` frescos: sem quebras novas, só as mesmas falhas pré-existentes de sempre (fixture `biometria.html` ausente, arquivos `.ts` de Edge Function ausentes no diretório de teste, pacotes `canvas`/`xlsx` não instalados no ambiente) — nenhuma relacionada a este código. `test_analisar_fatura.js` sozinho: 100% dos asserts (novos e antigos) passando.

## 36. Aba Digital travando em 1000 leads no filtro "Tudo" — cap de 1000 linhas do Supabase/PostgREST em todo select() sem paginação (24/09/2026)

Pedido do usuário: *"na aba digital quando seleciono o filtro tudo está capturando no maximo 1000 leads sendo que temos mais ja"*.

### 36.1 A causa raiz

O Supabase (PostgREST por baixo) limita **todo** `.select()` a no máximo **1000 linhas por padrão**, mesmo sem nenhum `.limit()` explícito no código — basta a tabela crescer além de 1000 linhas que a resposta vem cortada em 1000, **sem lançar erro nenhum**. Qualquer `sb.from(tabela).select(colunas)` do painel que espera receber a tabela INTEIRA de volta (sem paginação) estava sujeito a esse corte silencioso assim que a tabela em questão passasse de 1000 linhas — o que já aconteceu com `leads` (causa direta do bug relatado: a aba Digital, com o filtro de período "Tudo", busca a tabela `leads` inteira pra depois filtrar no navegador; como `leads` já tem mais de 1000 linhas, a busca vinha cortada bem antes do filtro entrar em ação).

Levantamento de todo `sb.from(...)` do `_template.html` (grep, ~40 ocorrências) pra separar o que precisava de paginação do que não:
- **Não precisa** (fica como está): qualquer chamada com `.limit(N)` explícito (ex.: busca de cliente por nome/CNPJ, `.limit(200)`); `.single()`/`.maybeSingle()` (só uma linha); `{ count: 'exact', head: true }` (contagem, não devolve linhas, não é afetada pelo cap); tabelas de baixo volume que não têm expectativa real de passar de 1000 linhas (`profiles`, `propostas`, `propostas_historico`, `consultas_resumo`, `cobertura_kmz`, `config`).
- **Precisa** (buscas de tabela "completa", com expectativa real de crescer além de 1000 linhas):
  - `leads` em `loadConversaoVendas()` (aba Digital) — **o bug relatado diretamente**.
  - `producao_pedidos` em `loadConversaoVendas()` (drilldown do card "Conversão confirmada no NeoCRM", só admin).
  - `producao_pedidos` em `loadProducaoDashboard()` (Dashboard de Produção).
  - `producao_pedidos` no `setInterval` de auto-atualização hora a hora da Visão Diária (mesma função, dentro de `loadProducaoDashboard()`).
  - `producao_pedidos` e `leads` em `buscarVendasOrigemLead()` (aba "Vendas x origem do lead").
  - `clientes` no upload da planilha de base (`baseAtual`, comparação de-para pra calcular entradas/saídas/mudanças) — **crítico pro negócio**: se essa leitura viesse cortada em 1000, o diff (permaneceram/entradas/saídas/mudanças) sairia errado e a base nova sobrescreveria a antiga com números de movimentação incorretos, sem erro nenhum aparecer pro admin.
  - `clientes` em `loadMovResumoAtual()` (card "Última atualização da base", conta clientes/linhas/aptos pra renovação).
  - `clientes_movimentacao` em `loadMovimentacao()` (resumo de 30 dias, com `.gte()`/`.order()`).

### 36.2 O fix

Nova função `fetchAllRows(queryFactory, pageSize = 1000)`, declarada logo depois da criação do `sb` (`const sb = window.supabase.createClient(...)`). Ela pagina com `.range(from, from + pageSize - 1)`, chamando `queryFactory()` de novo a cada página (é assim que o encadeamento do Supabase funciona — cada `.range()` é uma query nova), concatena os resultados e para quando uma página vem vazia OU menor que `pageSize` (cobre tanto tabelas com tamanho múltiplo exato de 1000 quanto as que não são, sem loop infinito e sem off-by-one). Se alguma página der erro, devolve o que já tinha acumulado (ou `null` se nada ainda) mais o erro, no mesmo formato `{ data, error }` que o Supabase real devolve — por isso ela funciona tanto num `await` direto quanto dentro de um `Promise.all([...])`, sem precisar mudar o código que já desestrutura `{ data, error }` do resultado.

Todo call site listado em 36.1 foi trocado de `sb.from('tabela').select(cols)[...filtros/order...]` pra `fetchAllRows(() => sb.from('tabela').select(cols)[...mesmos filtros/order...])` — os filtros (`.gte()`, `.lt()`, `.order()`) continuam dentro da factory, só o `.range()` final é que fica por conta do `fetchAllRows`.

### 36.3 Testado

Novo arquivo `test_fetch_all_rows.js`:
- `fetchAllRows()` isolada com mock que pagina de verdade (`.range(from, to)` fatiando um array real, ao contrário dos mocks dos outros arquivos de teste, que sempre devolvem tudo numa página só): 2340 linhas (3 páginas — 1000+1000+340) devolvidas concatenadas e na ordem certa, com exatamente 3 chamadas `.range()`.
- Caso de borda: 2000 linhas (múltiplo exato do pageSize) — confirma que precisa de uma 3ª chamada vazia pra fechar o loop (sem ficar preso num loop infinito nem cortar a última página).
- Caso de borda: tabela vazia (0 linhas) — devolve `{ data: [], error: null }` (array vazio, não `null`) com 1 chamada só.
- Caso de borda: menos de uma página (150 linhas) — só 1 chamada `.range()`.
- Mesmo caso de 150 linhas com `pageSize` customizado (50) — confirma a matemática da paginação com um tamanho de página diferente do padrão, incluindo o caso de múltiplo exato (150 = 3×50, precisa de uma 4ª chamada vazia).
- Teste de integração, a regressão mais direta do bug relatado: `loadConversaoVendas()` (aba Digital) com a tabela `leads` mockada em 2340 linhas — confirma que `conversaoLeadsCache` termina com as 2340 linhas inteiras, não trava em 1000.

Os mocks de Supabase dos arquivos de teste existentes que exercitam as funções alteradas (`test_conversao_vendas.js`, `test_venda_origem_lead.js`, `test_movimentacao.js`, `test_reorganizacao_abas.js`, `test_funil.js`, `test_fechamento.js`) ganharam um `.range()` chainable (sempre devolvendo os dados mockados numa página só, já que os datasets desses testes são pequenos) — sem isso, o `fetchAllRows()` novo quebraria com "`.range is not a function`" dentro deles.

Suíte completa (29 arquivos `test_*.js` + o novo `test_fetch_all_rows.js`) reexecutada, cada um em cópia isolada com `npm install jsdom`/`npm install xlsx jszip papaparse` + `python3 build_painel.py` frescos: sem quebras novas. `test_fetch_all_rows.js`: 23/23 asserts. Falhas remanescentes, todas pré-existentes e não relacionadas a este código: `test_cobertura.js` e `test_dashboard_producao.js` (fixtures `campinas.kmz`/`sjrp.kmz`/`ExportacaoProducao18080917.xlsx` ausentes no diretório de teste — nunca existiram nesta pasta); `test_conversao_vendas.js` tem 1 assert dependente da data real do sistema (`"Este mês" inclui pelo menos hoje e o lead do 1º dia do mês (2 ou 3...)"`) que falha quando "10 dias atrás" cai no mesmo mês que hoje (ex.: rodando no dia 24, como neste ambiente) — bug pré-existente da construção do teste (não cobre esse caso), sem nenhuma relação com paginação/`fetchAllRows`; nenhum dos dois call sites tocados nesse arquivo (`leads`/`producao_pedidos`) tem qualquer papel na lógica de datas que falhou.

Rebuild (`python3 build_painel.py`) confirmado sem placeholders pendentes.

## 37. Ranking do consultor na Visão Diária — ordenar por receita (não por volume de contrato), com desempate por quantidade de produtos (24/09/2026)

Pedido do usuário: *"na visao diaria o ranking do consultor esta por volume de contrato, corrigir para a maior receita e desempate quantidade de produtos"*.

### 37.1 O comportamento anterior

A Visão Diária (seção 16 em diante) tem dois rankings lado a lado: "Por consultor" (`#diariaConsultores`) e "Por produto" (`#diariaProdutos`), ambos montados pela mesma função `agruparDiariaPor(rows, campo, cnpjConvergenciaSet)` e renderizados por `renderDiariaLeaderboard(elId, rows, campo, cnpjConvergenciaSet)`. Os dois agrupavam as linhas do dia pelo campo pedido (`usuario` pro ranking de consultor, `grupo` pro de produto) e ordenavam o resultado só por `contratos` (quantidade de `numero_pedido` distintos, na contagem "1 contrato = 1 venda" já documentada na seção 16.12/16.15) — "volume de contrato", como descrito pelo usuário. Isso significava que um consultor com muitas vendas pequenas ficava sempre acima de um consultor com poucas vendas de alto valor, mesmo trazendo bem mais receita pra operação — não refletia quem estava performando melhor em termos de resultado financeiro.

### 37.2 O fix

`agruparDiariaPor` ganhou um 4º parâmetro opcional, `sortBy`: quando chamado com `sortBy === 'valor'`, a ordenação passa a ser por receita total do grupo (`valor`) decrescente, com empate resolvido pela quantidade de produtos (`linhas`, soma de `quantidade` das linhas do grupo — o mesmo "produtos" que já aparece nos KPIs da seção 16.10) decrescente: `list.sort((a, b) => b.valor - a.valor || b.linhas - a.linhas)`. Sem `sortBy` (ou com qualquer valor diferente de `'valor'`), a função mantém o comportamento de sempre — `b.contratos - a.contratos`.

`renderDiariaLeaderboard` recebeu o mesmo parâmetro e o repassa pro `agruparDiariaPor`. Quando `sortBy === 'valor'`, o número em destaque de cada linha do ranking (`lb-count`, o que aparece grande ao lado do nome) e a largura da barra de progresso passam a ser a receita formatada (`fmtBRL(o.valor)`) em vez da contagem de contratos — pra não ficar incoerente mostrar "6 contratos" em destaque numa lista que na verdade está ordenada por receita; contratos e produtos viram o sub-texto menor abaixo ("6 contratos · 4 produtos"). Sem `sortBy`, a renderização não muda nada: número em destaque continua "X contrato(s)", sub-texto continua "X linha(s) · receita".

Só o call site do ranking do consultor foi alterado: `renderDiariaLeaderboard('diariaConsultores', rows, 'usuario', cnpjConvergenciaSet, 'valor')`. O ranking por produto (`renderDiariaLeaderboard('diariaProdutos', rows, 'grupo', cnpjConvergenciaSet)`) foi deixado **de propósito** sem o `sortBy` — o pedido do usuário foi especificamente sobre o ranking do consultor, e o ranking por produto continua fazendo mais sentido por volume (quantos contratos daquele grupo saíram no dia), não por receita.

### 37.3 Testado

Estendido `test_visao_diaria.js`:

- No fixture principal (dia 20/08), Caio já tinha tanto mais contratos (6) quanto mais receita (R$ 2.150,00) que Giovanna (4 contratos, R$ 710,00) — então a ordem do ranking do consultor nesse fixture, sozinha, não prova o fix (teria dado a mesma ordem com o critério antigo). Passou a checar também que o número em destaque do 1º colocado agora é a receita formatada (`2.150,00`), com "6 contratos" aparecendo só no sub-texto.
- Prova direta do fix (chamando `agruparDiariaPor`/`renderDiariaLeaderboard` diretamente, sem passar pela UI): fixture dedicado onde um consultor (Bruno) tem só 1 contrato mas receita maior (R$ 500) que outro (Ana, 2 contratos, R$ 200 no total) — confirma que sem `sortBy` (ranking "Por produto"), Ana fica em 1º (mais contratos); com `sortBy='valor'` (ranking do consultor), Bruno fica em 1º (mais receita), mesmo com metade dos contratos — a regressão que o usuário reportou.
- Desempate por quantidade de produtos: dois consultores (X e Y) com receita total idêntica (R$ 200 cada), mas X com 4 produtos (linhas) e Y com 2 — confirma que X fica em 1º com `sortBy='valor'`.
- Sem regressão no ranking "Por produto": mesmo fixture, chamado sem `sortBy`, continua ordenando por contratos (Ana, com mais contratos, à frente de Bruno, mesmo com receita menor) — prova que a mudança não vazou pro ranking por produto.
- `renderDiariaLeaderboard` com `sortBy='valor'`: o número em destaque (`.lb-count`) do 1º colocado contém "R$" e não contém mais "contrato"; o sub-texto (`.lb-sub`) continua mostrando tanto "contrato" quanto "produto". Sem `sortBy`, o número em destaque continua no formato "X contrato(s)", sem "R$" — confirma que a renderização do ranking por produto não mudou.
- Ajustado o teste pré-existente de contratos-fragmentados-por-pedido (seção 16.12, dia 23/08): o sub-texto do ranking do consultor, que antes dizia "X linha(s)", agora diz "X produto(s)" nesse ranking (é o `sortBy='valor'` usando o formato novo de sub-texto) — texto do assert atualizado, sem mudar o que estava sendo verificado (2 produtos no mesmo pedido continuam contando como 1 contrato só).

Suíte completa (29 arquivos `test_*.js`) reexecutada, cada um em cópia isolada com `npm install jsdom` + `python3 build_painel.py` frescos: sem quebras novas, só as mesmas falhas pré-existentes de sempre (fixtures `biometria.html`/`campinas.kmz`/`sjrp.kmz`/`ExportacaoProducao18080917.xlsx` ausentes, arquivos `.ts` de Edge Function ausentes no diretório de teste, pacotes `canvas`/`xlsx` não instalados no ambiente, e o assert de `test_conversao_vendas.js` dependente da data real do sistema já documentado na seção 36.3) — nenhuma relacionada a este código. `test_visao_diaria.js` sozinho: 31 (estrutura) + 61 (convergência, parcial) + 67 (render real) asserts, 0 falhas.

Rebuild (`python3 build_painel.py`) confirmado sem placeholders pendentes.

## 38. Modo manual na proposta avulsa — editor 100% livre de produtos/valores/situação atual (25/09/2026)

Pedido do usuário: *"Preciso que crie a opção de uma proposta manual onde o consultor insira os dados dos produtos, valores, quantidade, tambem deixando a opção dele editar a situação atual do cliente, totalmente customizavel, mas mantendo o padrao visual, para facilitar, deixar a opção dele selecinar se é renovação, incremento, nova linha, portabilidade, banda larga, pabx, claro monitor e etc."*

### 38.1 Onde entra: só na proposta avulsa ("Gerar Proposta avulsa")

O modo manual é um toggle (`#propModoManual`, `proposalState.modoManual`) que só aparece — e só pode ser ligado — quando `proposalState.avulsa === true`. A renovação do cliente-da-base continua 100% no fluxo estruturado de catálogo de sempre (book de ofertas, grupos de renovação/incremento, convergência etc.); nunca mostra o toggle nem permite `modoManual = true` por nenhum caminho de UI. A decisão é deliberada: o book estruturado garante consistência comercial pra base existente, enquanto a proposta avulsa (linha nova, portabilidade, titularidade) é justamente o caso em que o consultor mais precisa montar algo fora do padrão (ex.: PABX, banda larga avulsa, combos que não existem no catálogo).

### 38.2 O que muda quando o modo manual está ligado

Ligar o toggle troca, na tela de proposta, todas as seções dirigidas por catálogo por dois editores de texto livre — mantendo o mesmo padrão visual (cards com borda, mesmos campos de `qtd`/`valor unitário`, mesmo botão "+ Adicionar", mesmo resumo fixo no topo):

- **Somem**: os accordions de Renovação/Linhas (aquisição/portabilidade), Incremento, Oferta de Convergência, Fibra, Passaporte de Dados, Outras Ofertas (Claro Monitor automático + oferta manual antiga), e o toggle "Consolidar valores no documento" (não faz sentido com itens livres/heterogêneos — não há GB comum pra agrupar).
- **Aparecem dois editores livres**:
  - **"Situação atual (modo manual)"** — linhas `{descricao, qtd, valorUnit}` (`proposalState.situacaoAtualManual`), descrição 100% texto livre no lugar do campo de GB da Situação Atual estruturada. Sem nenhum item preenchido, o documento mostra "Situação atual: Não informada".
  - **"Itens da proposta (manual)"** — linhas `{categoria, descricao, valorUnit, qtd}` (`proposalState.itensManuais`), com um total corrente ("Total da proposta") calculado ao vivo. `categoria` é um `<select>` com as opções pedidas pelo usuário: `MODO_MANUAL_CATEGORIAS = ['Renovação', 'Incremento', 'Nova linha', 'Portabilidade', 'Banda Larga', 'PABX', 'Claro Monitor', 'Outro']` — é só um rótulo livre pra organizar/prefixar a descrição no documento (`[Categoria] Descrição`), **sem nenhuma lógica de negócio por trás** (diferente do fluxo automático, onde escolher "Claro Monitor" aciona badge de benefício e contabilidade especial — aqui é só mais uma linha, sob controle total do consultor).
- O campo de descrição dos dois editores tem autocomplete via `<datalist id="dlModoManualSugestoes">`, construído por `modoManualSugestoes()` a partir dos nomes já usados no catálogo estruturado (`OFFERS_MOBILE`, `CLARO_FIBRA`, `CONVERGENCIA_OFERTAS`) + "Claro Monitor — Jornada Mobilidade" — é só conveniência de digitação, o campo continua 100% texto livre.
- **Conveniência Claro Monitor**: selecionar "Claro Monitor" na categoria de um item preenche automaticamente `descricao = 'Claro Monitor — Jornada Mobilidade'` e `valorUnit = 5`, mas **só quando a descrição ainda está vazia** — se o consultor já digitou algo, a seleção da categoria não sobrescreve nada (nem descrição nem valor).
- O resumo fixo no topo (`updateProposalPreview()`) ganha um branch dedicado pro modo manual: em vez de rodar `computeProposal()` (que depende do catálogo), soma direto `situacaoAtualManual` (valor atual) e `itensManuais` (valor proposto) e mostra "Valor atual / Valor proposto / Redução (se houver) / Indicador: proposta manual — 100% customizável".
- Editar quantidade/valor de uma linha atualiza o subtotal daquela linha e o total da seção direto no DOM (`updateModoManualTotals()`), sem re-renderizar a tela inteira (mesmo padrão de performance/UX já usado nos outros editores de linha da proposta — evita perder o foco do campo enquanto o consultor digita); adicionar/remover linha ainda re-renderiza (`renderProposalBody()`), porque muda a estrutura da lista.

### 38.3 Guarda contra proposta vazia

Como não existe fallback de catálogo no modo manual, gerar um documento com `itensManuais` vazio sairia com "Nova Proposta: R$ 0,00" — sem sentido. `guardModoManualVazio(fn)` envolve os 3 botões de emissão (`#btnBaixarProposta`/`#btnBaixarPropostaPdf`/`#btnBaixarPropostaPdfCliente`, ou seja: Word, PDF consultor, PDF cliente) e bloqueia com um `alert()` ("Adicione pelo menos um item na 'Nova Proposta' antes de gerar o documento.") sempre que `modoManual === true` e `itensManuais.length === 0` — sem tocar nas 3 funções de geração em si, que continuam chamando `buildPropostaDocModel()`/`registrarPropostaNoFunil()` exatamente como sempre quando há pelo menos 1 item.

### 38.4 Como o documento é montado: `buildPropostaDocModel()`

`buildPropostaDocModel()` ganhou um branch inicial (`if(proposalState.modoManual){...; return {...};}`) que **bypassa `computeProposal()` inteiro** — não existem grupos de catálogo, fibra, passaporte nem convergência no modo manual, só os itens livres digitados. `client`/`subtitulo`/`rodapé` seguem exatamente a mesma lógica de sempre (replicada nesse branch, já que ele retorna antes das variáveis calculadas no fluxo padrão). Pontos relevantes do modelo retornado:

- Itens com descrição em branco (só espaços) **e** valor zero são filtrados dos dois editores antes de montar o modelo — uma linha adicionada e nunca preenchida não vira lixo no documento.
- `novaProposta.itens[i].item` usa `[categoria] descrição` quando há categoria (inclusive a categoria padrão "Outro", que é sempre truthy — todo item novo nasce com `categoria: 'Outro'`, então o prefixo `[Outro]` aparece a menos que o consultor troque a categoria); `desc` no formato `"{qtd}× {valorUnit formatado}/un"`; `subtotal = valorUnit × qtd`.
- `novaProposta.consolidado` é sempre `false` (não existe "Consolidar valores" no modo manual) e `novaProposta.valorMonitor` é sempre `0` (sem contabilidade especial de Claro Monitor — é só mais uma linha comum, ao contrário do fluxo automático).
- `situacaoAtual` vira `{tipo:'tabela', itens:[...], nota:'Valores informados livremente pelo consultor.'}` quando há pelo menos 1 item preenchido em `situacaoAtualManual`; vazio, cai no fallback `{tipo:'resumo', linhas:[['Situação atual','Não informada']], nota:''}` (mesmo texto que já aparecia pra clientes sem contrato detalhado nos fluxos antigos).
- `destaque.valorProposto` = `novaProposta.total`; `destaque.reducao` só é preenchido (`{valor, pct}`) quando o total proposto é **menor** que a situação atual — mesma regra "só destaca quando há redução" do resto do sistema (seção 15).
- `beneficios.temOfertaMovel` é ligado (`true`) sempre que há pelo menos 1 item na Nova Proposta — **não** reflete se a proposta é realmente móvel (pode ser só PABX, banda larga etc.); o propósito único dessa flag no modo manual é abrir a seção "BENEFÍCIOS INCLUSOS" no documento pra mostrar a nota `beneficios.extras = ['Proposta manual — itens definidos livremente pelo consultor.']`. `beneficios.badges` fica sempre vazio — sem os badges universais (ligação ilimitada, WhatsApp, Waze) que aparecem no fluxo automático, já que não há garantia de que a proposta manual inclui linha móvel nova.
- `montarDocxProposta()`, `montarPdfProposta()`, `montarPdfPropostaCliente()`, `generateProposalDocx()`, `generateProposalPdfConsultor()`, `generateProposalPdfCliente()` e `registrarPropostaNoFunil()` **não foram alterados** — todos consomem o modelo genérico que `buildPropostaDocModel()` devolve (mesmo formato do fluxo automático), então o modo manual reaproveita os 3 formatos de emissão (Word/PDF consultor/PDF cliente) e o registro no funil de vendas sem nenhuma lógica dedicada nesses pontos.

### 38.5 Limites de escopo (deliberados)

- Sem modo manual pro cliente-da-base — renovação continua só no fluxo de catálogo.
- Sem "Consolidar valores" no modo manual — os itens já são livres/heterogêneos por natureza, não haveria um "plano único" pra consolidar.
- "Claro Monitor" escolhido como categoria não vira badge de benefício nem contabilidade especial — é tratado como qualquer outra linha, ao contrário do fluxo automático (seção 4.3/31) onde Claro Monitor é somado à parte como "Outras ofertas".

### 38.6 Testado

Novo arquivo `test_proposta_manual.js` (90 asserts, 0 falhas), seguindo o mesmo padrão jsdom dos demais testes de proposta (`test_tipo_avulsa.js`/`test_proposta_colapsada.js`):

- Toggle `#propModoManual` ausente e `modoManual` sempre `false` no fluxo cliente-da-base (não-avulsa); editores manuais (`#btnAddItemManual`/`#btnAddSitManual`) também ausentes nesse fluxo.
- Na avulsa: `modoManual` nasce desligado, `itensManuais`/`situacaoAtualManual` nascem vazios, toggle existe, catálogo (accordion `.propGrupoTipo`) e "Consolidar valores" aparecem normalmente antes de ligar o modo manual.
- Ligar o toggle: accordions de catálogo e "Consolidar valores" somem; os dois editores livres e o `<datalist id="dlModoManualSugestoes">` aparecem; hint "Adicione pelo menos um item" aparece com a lista vazia; datalist tem a mesma quantidade de sugestões que `modoManualSugestoes()` retorna.
- Situação atual manual: adicionar linha, editar descrição/qtd/valor, subtotal atualizado no DOM sem re-render, adicionar 2ª linha e removê-la.
- Itens da nova proposta: adicionar 2 linhas (categoria padrão "Outro"), editar categoria/descrição/valor/qtd das duas, subtotal por linha e total da seção atualizados no DOM sem re-render, resumo fixo mostrando o indicador "proposta manual".
- Claro Monitor: selecionar a categoria com descrição vazia preenche `descricao`/`valorUnit` automaticamente; selecionar de novo com descrição/valor já preenchidos manualmente **não sobrescreve** nada.
- `guardModoManualVazio`: com `itensManuais` vazio, os 3 botões de emissão (Word/PDF consultor/PDF cliente) disparam `alert()` mencionando "Nova Proposta" e **não** chamam `generateProposalDocx`/`generateProposalPdfConsultor`/`generateProposalPdfCliente`; com pelo menos 1 item, os 3 chamam normalmente.
- `buildPropostaDocModel()` no modo manual: itens com/sem categoria geram o rótulo `[Categoria] Descrição` correto (inclusive a categoria padrão "Outro", sempre truthy); `desc`/`subtotal` por item; `novaProposta.total` = soma; `consolidado=false`; `valorMonitor=0`; `notaFibra=false`; `atual` = soma da situação atual manual; `situacaoAtual.tipo='tabela'` com itens corretos e nota "Valores informados livremente pelo consultor."; `destaque.valorProposto`/`destaque.reducao` corretos tanto quando a proposta aumenta quanto quando reduz o valor (incluindo o cálculo de `pct`); `beneficios.badges` vazio; `beneficios.extras` com a nota "proposta manual"; `beneficios.temOfertaMovel=true` quando há itens; `subtitulo`/`client` reaproveitando a lógica normal de proposta avulsa.
- Fallback de situação atual vazia: `{tipo:'resumo', linhas:[['Situação atual','Não informada']], nota:''}`, `atual=0`.
- Itens só com espaços em branco e valor zero são filtrados do modelo (tanto na Nova Proposta quanto na Situação Atual).
- Desligar o toggle restaura o fluxo catalogado (accordion e "Consolidar valores" voltam, editores manuais somem) sem quebrar nada.

A cobertura de `buildPropostaDocModel()` no fluxo **não**-manual (cliente-da-base e avulsa sem modo manual) já é extensa em 9 arquivos de teste pré-existentes (`test_analisar_fatura.js`, `test_consolidar_valores.js`, `test_convergencia.js`, `test_funil.js`, `test_incremento_qtd.js`, `test_outras_ofertas.js`, `test_pdf.js`, `test_plano_atual_gb.js`, `test_renovacao_multiplano.js`) — todos reexecutados sem quebras, confirmando que o novo branch `if(proposalState.modoManual)` no início da função não afeta o comportamento existente (é um early-return condicional, o resto da função é idêntico a antes).

Suíte completa (31 arquivos `test_*.js`, incluindo o novo `test_proposta_manual.js`) reexecutada em lote (por causa do limite de 120s por chamada de ferramenta no sandbox, rodada em grupos de 8 arquivos), cada um em cópia isolada com `npm install jsdom`/`npm install xlsx jszip papaparse canvas` + `python3 build_painel.py` frescos: sem quebras novas, só as mesmas falhas pré-existentes de sempre (fixtures `biometria.html`/`campinas.kmz`/`sjrp.kmz`/`ExportacaoProducao18080917.xlsx` ausentes no diretório de teste, arquivos `.ts` de Edge Function ausentes no diretório de teste, e o assert de `test_conversao_vendas.js` dependente da data real do sistema já documentado na seção 36.3) — nenhuma relacionada a este código.

Rebuild (`python3 build_painel.py`) confirmado sem placeholders pendentes.

### 38.7 Fix: formatação ruim na coluna ITEM (25/09/2026)

Pedido do usuário (após ver a primeira proposta manual gerada): *"a formatacao esta ruim no item, corrigir"*.

Causa: `modoManualSugestoes()` usava `offerLabel()`/`convergenciaLabel()` pras opções do `<datalist>` de autocomplete — essas funções embutem o VALOR no nome (ex.: `"12GB — R$ 39,99/linha (Nacional)"`). Ao escolher a sugestão, esse texto virava a `descricao` literal do item, que `buildPropostaDocModel()` prefixa com `[Categoria] ` (seção 38.4) — o rótulo final (`"[Renovação] 12GB — R$ 39,99/linha (Nacional)"`) ficava comprido demais pra coluna ITEM (30% de largura nas tabelas do Word/PDF), quebrava linha de forma feia e ainda duplicava o preço, que já aparece nas colunas DESCRIÇÃO/SUBTOTAL (ex.: `"3× R$ 39,99/un"` / `"R$ 119,97"`).

Fix: `modoManualSugestoes()` agora gera sugestões só com a identidade do plano, sem valor — `"12GB (Nacional)"`, `"Claro Fibra 400MEGA"`, `"Fibra 400MEGA + Claro-pós 12GB"` etc. — o consultor continua digitando o valor unitário no campo próprio, sem duplicação. `offerLabel()`/`convergenciaLabel()` (usadas em todo o resto do sistema, fora do modo manual) não foram tocadas.

Testado: `test_proposta_manual.js` reexecutado (90/90 asserts) — a asserção de quantidade de sugestões (`dlOptions.length === modoManualSugestoes().length`) não depende do conteúdo exato dos textos, então continua válida sem alteração. Rebuild confirmado sem placeholders pendentes.

## 39. Badge com o valor da oferta selecionada, ao lado do seletor (25/09/2026)

Pedido do usuário: *"na montagem da proposta mostrar o valor de cada oferta, somente na proposta que pode ser retirado do item, em tipo de proposta Novo, portabilidade e transferencia, incluir incremento e renovação"*. Esclarecido via pergunta ao usuário (a frase original era ambígua entre mudar o documento gerado ou só a tela): o usuário escolheu **"Mostrar valor nos seletores de oferta (tela)"** — ou seja, é uma melhoria só na TELA de montagem da proposta, não no Word/PDF final (que já mostra o valor normalmente nas colunas de valor).

### 39.1 O que mudou

O `<select>` de oferta já mostrava o valor de cada opção dentro do próprio `<option>` (via `offerLabel()`), mas isso só é visível abrindo o dropdown — o texto da opção escolhida (mostrado fechado) pode truncar em telas estreitas, deixando o consultor sem ver o valor de cara. Adicionado um badge (`<div class="propOfertaValorWrap">` com um `<span class="propOfertaValorBadge">`) logo abaixo de cada seletor de oferta, sempre visível, mostrando "Valor: R$ X,XX/linha" da oferta **atualmente selecionada**. Aparece nos 3 pontos da tela onde existe seletor de oferta:

- **Linha nova/portabilidade/transferência de titularidade** (proposta avulsa) — `.propGrupoOferta`.
- **Renovação das linhas existentes** (cliente da base ou avulsa) — `.propRenovGrupoOferta`.
- **Incremento — linha(s) extra** — `.propIncrementoOferta`.

Nova função auxiliar `ofertaValorBadgeHtml(offer)` (logo após `offerLabel()`): recebe a oferta (ou `null`/`undefined` se nada estiver selecionado) e devolve o HTML do badge, com fallback "—" pra não quebrar quando não há oferta aplicável.

### 39.2 Atualização ao vivo (sem re-render completo)

Cada um dos 3 listeners de `change` do respectivo `<select>` (que já só atualizavam `proposalState` e chamavam `updateProposalPreview()`) passou a também reescrever o `innerHTML` do badge correspondente, na hora, sem disparar `renderProposalBody()` — mesmo espírito de outros campos que editam o estado in-place pra preservar o foco do campo.

**Detalhe importante corrigido durante a implementação**: o `data-idx` do badge (`data-idx="${idx}"`) se repete entre as 3 seções (cada uma começa a contagem em 0) — um `document.querySelector('.propOfertaValorWrap[data-idx="0"]')` pegaria sempre o primeiro badge do documento inteiro, não necessariamente o da seção certa. Por isso os 3 listeners usam `this.nextElementSibling` (o badge é sempre o irmão HTML imediatamente seguinte ao `<select>`, dentro do mesmo `<div>` de campo) em vez de buscar por `data-idx` no documento todo — isso garante que trocar a oferta em uma seção nunca atualiza o badge errado em outra.

Para o seletor de linha (`.propGrupoOferta`), o "pool" de ofertas disponíveis é recalculado por grupo dentro do `.map()` do render (não fica em escopo fora dele) — o listener recalcula com `grupoOfferList(client, proposalState.linhaGrupos[idx].tipo)` usando o tipo atual do grupo. Para renovação e incremento, `renewOffers`/`incOffers` já ficam no escopo da função `renderProposalBody()` e são reaproveitados diretamente.

### 39.3 CSS

Badge simples, cor de destaque verde (fundo `#eafaf1`, borda `#b9e8c9`), só decorativo — não altera layout do formulário, fica abaixo do select ocupando a largura do próprio campo.

### 39.4 Limites de escopo (deliberados)

- Só a tela — nenhuma mudança no Word/PDF/PDF-cliente gerado, nem em `buildPropostaDocModel()` ou nos 3 renderizadores de documento.
- Não aparece em "Outras ofertas" (Claro Monitor/manual) nem no modo manual — esses já usam campos de valor livres/editáveis, não um `<select>` de oferta do book.

### 39.5 Testado

Novo arquivo `test_oferta_valor_badge.js` (16 asserts, 0 falhas):

- Renovação: badge existe, é irmão imediato do select, mostra "Valor: R$..." no render inicial; trocar a oferta selecionada muda o texto do badge (mantendo o formato).
- Incremento: mesma cobertura, após ligar o toggle `#propIncluirIncremento` (a seção só renderiza com o toggle ligado).
- Linha nova (avulsa, tipo "novo"): mesma cobertura.
- `ofertaValorBadgeHtml(null)`/`ofertaValorBadgeHtml(undefined)` devolvem o fallback "—" em vez de quebrar.

Reexecutados sem quebras (relacionados ao fluxo de proposta, que compartilha `renderProposalBody()`/listeners com esta mudança): `test_proposta_manual.js`, `test_outras_ofertas.js`, `test_convergencia.js`, `test_convergencia_preset.js`, `test_incremento_qtd.js`, `test_renovacao_multiplano.js`, `test_tipo_avulsa.js`, `test_proposta_colapsada.js`, `test_consolidar_valores.js`, `test_plano_atual_gb.js`, `test_pdf.js`.

Rebuild (`python3 build_painel.py`) confirmado sem placeholders pendentes.

## 40. Renovação e Incremento como Tipo de proposta na proposta avulsa (25/09/2026)

Pedido do usuário: *"em proposta avulsa em tipo de proposta colocar tambem as opcoes linha nova/portabilidade/titularidade, renovação e incremento"*. Esclarecido via duas perguntas ao usuário:

1. *"O que deve mudar na prática quando o consultor selecionar 'Renovação' ou 'Incremento' logo no formulário inicial?"* → **"Atalho de abertura"**: o select só decide o que abre pré-marcado (a seção correspondente já vem ligada, as outras desligadas); o consultor continua podendo ligar/desligar tudo depois, normalmente.
2. *"Pra um cliente cujo tipo de proposta é 'Renovação' ou 'Incremento', faz sentido considerar ele já cliente Claro (sem pedir operadora, igual à Titularidade) ou pode ser de qualquer operadora?"* → **"Sempre Claro"**: pressupõe que o cliente já tem uma linha/plano Claro (só não está cadastrado na base ainda) — não pede operadora atual, igual à Transferência de titularidade.

### 40.1 O select `#avTipo` ganhou 2 opções

```html
<option value="renovacao">Renovação (cliente já é Claro, ainda não está na base)</option>
<option value="incremento">Incremento (cliente já é Claro, só quer linha(s) extra)</option>
```

Ordem final: Novo, Portabilidade, Transferência de titularidade, Renovação, Incremento. Nenhuma das duas pede operadora atual (`operadoraAtual` fica fixo em `'Claro'`, e é excluído da nota "Operadora atual informada" no resumo da proposta e no PDF/Word, igual à titularidade).

### 40.2 "Renovação" reaproveita o fluxo de renovação do cliente-da-base, não o de linha nova

Esse foi o ponto mais delicado: até aqui, TODA proposta avulsa (Novo/Portabilidade/Titularidade) usava `linhaGrupos` (grupos de aquisição/portabilidade) na primeira seção da tela — não existia, na avulsa, um conceito real de "renovar um plano Claro já existente" (isso só existia pro cliente-da-base, via `renewGrupos`/`renewalOfferList()`/`pickBestRenovacao()`). Como a decisão do usuário foi tratar avulsa-Renovação como "cliente já é Claro", a solução foi fazer esse tipo de proposta avulsa reaproveitar o MESMO mecanismo de `renewGrupos` do cliente-da-base, em vez de inventar um terceiro fluxo.

Nova função helper `usarRenewGruposAvulsa()` (lida a partir de `proposalState`, usada em `renderProposalBody()`/`computeProposal()`/`buildPropostaDocModel()`/`updateProposalPreview()`) e uma constante local equivalente dentro de `openProposal()` (que ainda não tem `proposalState` montado nesse ponto):

```js
function usarRenewGruposAvulsa(){
  return !proposalState.avulsa || proposalState.tipoAvulsa === 'renovacao';
}
```

`true` sempre para cliente-da-base (comportamento de sempre) e para a avulsa quando `tipoAvulsa === 'renovacao'`. Onde esse booleano é `true`, a primeira seção da tela ("Linhas do cliente..."/"Renovação das linhas existentes") passa a usar `renewGrupos`/`renewOffers`/`pickBestRenovacao()`/`pickCheapestRenewal()` (a lógica que já existia, inalterada) em vez de `linhaGrupos`/`grupoOfferList()`. Onde é `false` (Novo/Portabilidade/Titularidade/Incremento), continua exatamente como antes: `linhaGrupos`/`grupoOfferList()`.

Para essas funções de renovação funcionarem sem alteração com um cliente avulsa (que não tem `linhas_voz`, só `linhas_atuais`), o objeto `client` montado no clique de "Gerar proposta" passou a preencher `linhas_voz: linhasAtuais` também (espelhando `linhas_atuais`) — `pickBestRenovacao`/`pickCheapestRenewal`/`renewalOfferList` já leem `client.linhas_voz`.

Pontos ajustados pra essa troca de fonte de dados (todos usando `usarRenewGrupos`/`usarRenewGruposAvulsa()` no lugar de checar só `avulsa`/`!avulsa`):

- `renderProposalBody()`: título da seção (`"Renovação das linhas existentes"` vs `"Linhas do cliente — aquisição / portabilidade"`/`"Transferência de titularidade"`), o corpo (grupos de `renewGrupos` com `.propRenovGrupoOferta` vs grupos de `linhaGrupos` com `.propGrupoOferta`/`.propGrupoTipo`), o texto de rodapé de cada bloco, e os totais (`totalLinhasGrupos`/`totalLinhasRenov`).
- `computeProposal()`: de onde vem `baseGrupos`/`baseValor` (de `renewGrupos`, com `tipo:'renovacao'` fixo — reaproveita o rótulo "Renovação" que já existia em `rotulosBaseGrupo`/`rotulosGrupo`) e o texto do "mantém o plano atual, sem alteração" quando a seção está desligada.
- `buildPropostaDocModel()`: os 2 mapas `subtitulosAvulsa` (modo normal e modo manual) ganharam entradas `renovacao`/`incremento`; o fallback de "Linha base não incluída"/"Plano atual mantido" no item da Nova Proposta passou a usar `usarRenewGruposAvulsa()`.
- `updateProposalPreview()`: `rotulosTipoAvulsa` (badge "proposta avulsa — ...") ganhou `renovacao: 'renovação de plano Claro'` e `incremento: 'incremento de linha(s)'`; a exclusão da nota "Operadora atual informada" passou a cobrir também `renovacao`/`incremento` (não só `titularidade`); o texto "sem alteração" passou a usar `usarRenewGruposAvulsa()`.
- `openProposal()`: `linhaGrupos` só é pré-populado quando `avulsa && !usarRenewGrupos` (ou seja, não é montado à toa pra `tipoAvulsa==='renovacao'`, já que essa seção nunca vai usá-lo); `renewGrupos`/`renewDefault` passam a ser calculados quando `usarRenewGrupos` é `true` (em vez de só `!avulsa`).

**Deliberadamente fora de escopo**: a "meta de 10%" (badge de comissão do cliente-da-base, `renewDeltaPct`) continua restrita a `!proposalState.avulsa` — avulsa-Renovação não ganhou esse conceito, já que o usuário só pediu o atalho de abertura, não a regra de comissão completa (ver item pendente #253 do backlog, não relacionado a este pedido).

### 40.3 "Incremento" é mais simples — não precisa de dado novo

`tipoAvulsa === 'incremento'` não muda a FONTE de dados de nenhuma seção — ele só muda os valores **iniciais** dos dois toggles em `openProposal()`:

```js
const incluirRenovacao = !(avulsa && tipoAvulsa === 'incremento'); // só nasce desligado no atalho "Incremento"
const incluirIncremento = avulsa && tipoAvulsa === 'incremento';   // só nasce ligado no atalho "Incremento"
```

Ou seja: escolher "Incremento" no formulário inicial já abre a proposta com a seção "Linha nova/Portabilidade/Titularidade" (`linhaGrupos`) FECHADA e a seção "Incremento — linha(s) extra" ABERTA, com uma oferta de incremento pré-selecionada (via `pickIncrementoLine(client, false)`, já existente). O consultor pode ligar a seção de linha base manualmente depois, se quiser — nesse caso ela some pro fluxo normal de `linhaGrupos` (tipo "aquisição" por padrão), já que `usarRenewGrupos` é `false` pra `tipoAvulsa==='incremento'`.

### 40.4 Testado

`test_tipo_avulsa.js` (34 asserts, era 10 antes desta mudança):

- Combobox agora tem 5 opções, na ordem novo/portabilidade/titularidade/renovacao/incremento.
- **Renovação**: campo operadora escondido; `operadoraAtual` fixo em `'Claro'`; `incluirRenovacao` nasce `true` (atalho de abertura); `incluirIncremento` nasce `false`; `renewGrupos` populado (reaproveitando o fluxo do cliente-da-base); `.propRenovGrupoOferta` aparece na tela e `.propGrupoOferta` NÃO aparece; título da seção vira "Renovação das linhas existentes".
- **Incremento**: campo operadora escondido; `operadoraAtual` fixo em `'Claro'`; `incluirRenovacao` nasce `false` (atalho de abertura); `incluirIncremento` nasce `true`; select de oferta de incremento já aparece na tela sem precisar ligar o toggle manualmente.

Reexecutados sem quebras (fluxo de proposta, que compartilha `renderProposalBody()`/`computeProposal()`/`buildPropostaDocModel()`/`updateProposalPreview()` com esta mudança): `test_proposta_colapsada.js`, `test_renovacao_multiplano.js`, `test_incremento_qtd.js`, `test_consolidar_valores.js`, `test_proposta_manual.js`, `test_outras_ofertas.js`, `test_convergencia.js`, `test_convergencia_preset.js`, `test_plano_atual_gb.js`, `test_pdf.js`, `test_oferta_valor_badge.js`, `test_funil.js`.

Rebuild (`python3 build_painel.py`) confirmado sem placeholders pendentes.
