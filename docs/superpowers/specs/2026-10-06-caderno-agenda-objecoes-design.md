# Caderno de Ligação + Agenda + Objeções com IA

**Data:** 06/10/2026
**Responsável:** Rafael
**Branch:** `feat/caderno-agenda` (worktree `.worktrees/caderno-agenda`, base `oficial/main` 4d8dfdb)
**Status:** spec para revisão (nada construído)
**Seção do REGRAS_NEGOCIO.md reservada:** §72

## 1. Objetivo, público e sucesso

**Problema:** os consultores da **discadora (ProContact)** anotam os dados do cliente no Bloco de Notas do computador durante a ligação. Isso causa três perdas:
- se o Bloco de Notas fecha, perdem tudo;
- nada fica ligado ao cliente;
- o retorno combinado depende da memória do consultor.

**Público:** consultores **fora do lead** (não estão em `leads_equipe`), que ligam pela discadora, tanto em ligação manual quanto em campanha automática. O consultor do lead também pode usar, mas o desenho não é pensado para ele.

**O que esta entrega faz:**
1. **Caderno de Ligação:** anotar o cliente durante a ligação, com salvamento automático, sem nunca perder nada.
2. **Agenda:** um calendário do mês. O consultor clica no dia e salva o retorno com hora, linhas, valor etc. Tem alerta antes da hora.
3. **Objeções com IA:** um clique no chip da objeção mostra na hora uma resposta pronta para falar ao cliente. A IA adapta a resposta àquele cliente.

**Sucesso:**
- Em 2 semanas, todo consultor da discadora registra anotações no Caderno todos os dias (medido por `caderno_notas` por consultor e dia).
- Nenhuma anotação perdida: fechar a aba, recarregar ou cair a internet não apaga o que foi digitado.
- O consultor vê os retornos do mês no calendário e recebe o alerta 5 min antes, com o painel aberto.
- A resposta da biblioteca aparece em menos de 100 ms depois do clique, sem rede. A resposta adaptada da IA aparece em até 4 s em 90% das vezes. Quando a IA falha, nada trava.

## 2. O que já existe (oficial/main 4d8dfdb)

- **`leads_followups`** e as telas "Meus leads e retornos" (§48) e "Meus leads para tratar" (§61/§64).
  - Retorno por **dia, sem hora**, que **exige lead**. Não serve ao público desta entrega.
  - Fica como está e não aparece no calendário, porque esse público não tem lead.
- **Agenda de portabilidade/instalação dos pedidos** em Pedidos Parados (`ppAgenda`, `_template.html`). Entra no calendário como camada só de leitura (seção 4.4).
- **`public.chave_tel(text)`** (migration `20261001000000_monitoramento_leads.sql`) normaliza o telefone. É a chave do Caderno.
- **`public.get_my_role()`** devolve `admin`, `supervisor` ou `consultor`. É a base das regras de acesso.
- **Mesa do Supervisor** (§68). Recebe um bloco novo (seção 8).
- **Apex Mind**: tem SSO a partir do painel (`sso-pratica-vendas`) e cenários por categoria, por exemplo `objecao_preco`.
- **Design "Sinal de Ápice"**: não muda. A entrega reaproveita `.card`, `.modal`/`.overlay`, `.btn`, `.field`, `.badge`, `.filterPill`, cores só por variável, `mostrarAviso` e `fecharOverlay` (CLAUDE.md do repo).

## 3. Escopo

**Entra nesta entrega:**
- Caderno (seção 5);
- Agenda/calendário (seção 4);
- Objeções com biblioteca + IA (seção 6);
- alertas (seção 7);
- bloco do supervisor (seção 8);
- banco (seção 9);
- Edge Function `caderno-ia` (seção 10).

**Fica fora:**
- **Telegram:** descartado.
- **IA que organiza a anotação inteira:** a IA desta entrega é só objeção, por decisão de foco. O CPF, CNPJ, telefone, CEP e e-mail continuam sendo reconhecidos no navegador por padrão de texto, sem IA (seção 5.3).
- **Integração por URL de atendimento do ProContact:** descartada por enquanto.
- **Fases seguintes:** seção 13.

## 4. Agenda (aba nova)

### 4.1 Onde fica
- Botão `data-tab="agenda"` no `nav#tabsNav`, no mesmo formato das outras abas: `<svg>` + `<span class="sbLabel">Agenda</span>`, com `data-sub="Seus retornos do mês"`.
- Aparece para todo usuário logado.

### 4.2 Calendário do mês
- **Cabeçalho:** `‹  OUTUBRO 2026  ›`, um botão **Hoje** e um botão **+ Novo retorno**.
- **Grade:** 7 colunas (DOM a SÁB) e 5 ou 6 linhas. Os dias de fora do mês aparecem apagados.
- **Cada dia mostra:**
  - até **3 retornos** em ordem de hora, no formato `14:30 Transportes Silva`, com o ícone do tipo;
  - acima disso, um **"+N"**.
- **Destaques:**
  - **hoje** com destaque visual;
  - dia com retorno **atrasado** (passou da hora e está pendente) com borda e contador em vermelho;
  - retorno feito aparece riscado e apagado.
- **Clicar no dia** abre o painel lateral do dia (seção 4.3).
- **Arrastar e soltar:** arrastar um retorno para outro dia remarca para o mesmo horário no dia novo. Só no computador.
- **No celular** (menos de 720 px), a grade vira uma lista por dia: hoje, depois os próximos dias com retorno. Os atrasados ficam no topo.

### 4.3 Painel do dia
- **Lista dos retornos do dia em ordem de hora.** Cada um tem:
  - **Feito**;
  - **Remarcar** (escolher dia e hora);
  - **Cancelar**;
  - **Abrir no Caderno**: abre a anotação de origem ou um Caderno novo já com nome e telefone.
- **Formulário "Novo retorno"**, já com a data do dia clicado:
  - **Cliente/nome** (obrigatório);
  - **Telefone** (obrigatório);
  - **Hora** (obrigatória; atalhos 09:00, 11:00, 14:00, 16:00);
  - **Tipo**: ligação, WhatsApp, reunião ou enviar proposta;
  - **Quantidade de linhas**;
  - **Valor do plano**;
  - **Observação**.
- **Salvar** grava em `agenda_retornos` e atualiza o calendário sem recarregar.

### 4.4 Camada de pedidos (só leitura)
- As datas de portabilidade e instalação dos pedidos abertos do consultor, as mesmas do `ppAgenda`, aparecem no calendário com outra cor e o rótulo "Pedido".
- Clicar leva a Pedidos Parados. Não se edita pela Agenda.

## 5. Caderno de Ligação

### 5.1 Como abre
- Um **botão fixo** no canto inferior direito, em todas as abas, e o atalho **`Alt+N`**. Abre como painel lateral sobre a tela atual.
- **Destacar:** um botão "Janela flutuante" abre o Caderno numa janela sempre por cima, para ficar sobre o ProContact.
  - Usa a Document Picture-in-Picture do Chrome. Nos navegadores sem ela, abre uma janela comum (`window.open`) de 420×720.
  - Os mesmos dados e o mesmo salvamento valem nas duas formas.
- **Novo atendimento** (`Alt+Shift+N`): fecha a anotação atual, que já está salva, e abre uma em branco com o cursor no telefone.

### 5.2 Campos
- **Principais** (sempre à vista, nesta ordem):
  - telefone;
  - nome;
  - CPF;
  - CNPJ;
  - CEP;
  - quantidade de linhas;
  - valor do plano (R$).
- **Outros** (seção "Mais dados", recolhida, abre com um clique):
  - e-mail;
  - operadora atual;
  - decisor;
  - vencimento da fidelidade (mês/ano);
  - interesse: móvel, fibra ou portabilidade (seleção múltipla).
- **Anotação livre:** caixa grande, onde o consultor escreve como escreve hoje no Bloco de Notas.
- **Objeções:** chips (seção 6).
- **Resultado da ligação:** um clique entre *atendeu*, *não atendeu*, *caixa postal*, *sem interesse* e *fechou*.
- **Nenhum campo é obrigatório.** Basta digitar qualquer coisa para a anotação existir.
- **Verificação leve:** CPF e CNPJ com dígito verificador inválido ganham um aviso discreto ("confira o CNPJ"). Não bloqueia.

### 5.3 Reconhecimento automático (no navegador, sem IA)
Se o consultor colar ou digitar dados na anotação livre, o painel reconhece por padrão de texto:
- telefone;
- CPF;
- CNPJ;
- CEP;
- e-mail.

Ele oferece "Preencher campo" para cada dado que o campo ainda não tem. Nunca sobrescreve um campo já preenchido.

### 5.4 Salvamento (nunca perde)
- **A cada pausa de digitação** (800 ms), a anotação vai para o `localStorage` (`caderno_rascunho_<userId>`) e, em seguida, para o banco.
- **Sem duplicar:** a anotação ganha um `id` (uuid) no navegador já na primeira tecla, e a gravação é `upsert` por esse `id`.
- **Indicador sempre visível:**
  - *Salvo ✓*;
  - *Salvando…*;
  - *Sem internet: guardado neste computador*. Tenta de novo a cada 15 s e quando a rede volta (`online`).
- **Ao abrir o painel:** se houver rascunho local mais novo que o do banco, ele é restaurado e enviado.
- O `localStorage` fica protegido com try/catch, porque pode estar bloqueado. Sem ele, o salvamento no banco continua.

### 5.5 Histórico do cliente
- Quando o telefone (`chave_tel`) ou o CNPJ é preenchido, aparecem abaixo as **anotações anteriores do próprio consultor** para aquele cliente: data, resultado, resumo das 2 primeiras linhas. Clicar abre a anotação.
- Ver anotações de outros consultores fica para a Fase 2 (seção 13).

### 5.6 Ligação com a Agenda
- **Faixa "Agendar retorno"** dentro do Caderno:
  - botões rápidos **Em 2h**, **Amanhã 9h**, **Amanhã 14h**, **Seg 9h**;
  - **Escolher…**, que abre um mini-calendário com dia e hora.
- **O retorno nasce preenchido** com o que está no Caderno (nome, telefone, linhas, valor, observação = 1ª linha da anotação) e fica ligado à anotação (`nota_id`).
- **"Não atendeu"** marcado oferece "Tentar de novo em 2h" com um clique.
- **Vencimento da fidelidade:** ao preencher, o painel oferece "Agendar retorno 45 dias antes do vencimento (dd/mm)" com um clique. Nada é criado sem esse clique.
- **Retornos pendentes:** se o cliente já tem retorno pendente, o Caderno mostra "Retorno marcado: qui 14:30", com Feito e Remarcar.

## 6. Objeções com IA (o foco da IA)

**Princípio:** prático e rápido. Um clique e a resposta aparece na hora, pronta para falar.

### 6.1 Onde fica
- Um bloco **Objeções** sempre visível no Caderno, também na janela flutuante, com chips grandes.
- **Atalhos:** `Alt+1` a `Alt+9` disparam os chips, na ordem de exibição.

### 6.2 Biblioteca (instantânea)
- A tabela `objecoes_respostas` é carregada uma vez no login e fica em memória. **Clicar no chip mostra a resposta sem rede.**
- **Cada objeção tem:**
  - **Fala curta** (1 a 2 frases, para dizer ao cliente);
  - **Pergunta de contorno** (para entender o real motivo);
  - **Alternativa**: a oferta a puxar, por exemplo descer de 100GB para 70GB.
- **Botões:** **Copiar** (para o WhatsApp) e **Usei**, que registra o uso (seção 6.4).
- **Objeções iniciais** (o texto é um rascunho que o Rafael aprova antes de publicar):
  1. Tá caro;
  2. Tenho fidelidade/multa com a atual;
  3. Vou pensar;
  4. Preciso falar com o sócio;
  5. Já tenho operadora e estou satisfeito;
  6. Me manda por WhatsApp/e-mail;
  7. Sinal da Claro é ruim aqui;
  8. Agora não posso falar;
  9. Não tenho interesse.
- **Edição:** admin e supervisor editam a biblioteca numa tela simples dentro da aba Agenda, no ícone de engrenagem que só eles veem. Podem criar, editar, reordenar e desativar.
- **Preços:** os textos não citam preço em R$, porque preço muda. Falam de franquia (12/40/70/100/150GB) e da ancoragem em 100GB/70GB.

### 6.3 IA adaptada ao cliente
- **Ao clicar num chip**, se o Caderno tem contexto (linhas, operadora, valor, fidelidade ou anotação livre), o painel pede em segundo plano a **versão para este cliente**.
  - Ela aparece abaixo da biblioteca, com o rótulo "Para este cliente", em até ~4 s.
  - Enquanto isso, a resposta da biblioteca já está na tela.
- **Campo "O cliente disse…":** o consultor digita uma objeção que não está nos chips e aperta Enter. A IA devolve fala curta + pergunta de contorno.
- **Formato da resposta:** no máximo 3 frases, em linguagem falada e direta, em português do Brasil.
- **A IA nunca inventa:**
  - preço em R$;
  - promoção;
  - prazo;
  - condição que não esteja na biblioteca ou na anotação.

  O prompt traz a biblioteca como base e as franquias permitidas.
- **Falha ou demora** (mais de 6 s, erro 503/429 do Gemini ou sem rede): a área da IA mostra "IA indisponível agora, use a resposta acima". Sem `alert` e sem bloquear nada.
- **Cache:** mesma objeção + mesmo contexto dentro de 10 min devolve a resposta guardada no navegador, sem nova chamada.
- **Treinar:** um link "Treinar no Apex Mind" abre o Apex Mind por SSO, no mesmo fluxo da bolinha `#apexMindBubble`. O SSO sempre cai na lista de cenários (`/cenarios`), porque o Apex Mind não tem rota por cenário (conferido em 06/10 na `feature/pratica-vendas-ia`).

### 6.4 Registro de uso
- O botão **Usei** e o 👍/👎 da resposta da IA gravam em `objecoes_uso`: consultor, objeção, fonte (biblioteca ou IA), útil sim/não, `nota_id`.
- **Para que serve:** saber quais objeções mais aparecem e quais respostas funcionam (seção 8).

## 7. Alertas

- Um verificador no navegador roda a cada 30 s enquanto o painel está aberto, em qualquer aba.
- **5 minutos antes** de um retorno pendente:
  - **notificação do Windows** (Notification API; a permissão é pedida no primeiro uso da Agenda, com explicação);
  - **som curto**;
  - **contador no título** da aba ("(2) Painel Apex").
- **Clicar na notificação** foca o painel e abre o Caderno do cliente.
- **Sem repetir:** cada retorno alerta uma vez. Fica marcado no `localStorage`, e um `BroadcastChannel` impede que duas abas abertas alertem em dobro.
- **Ao entrar no painel:** um aviso `mostrarAviso` com "Hoje: 3 retornos · 1 atrasado", se houver.
- **Limite conhecido:** sem nenhuma aba do painel aberta, não há alerta. Isso fica dito na tela de permissão.

## 8. Supervisor (Mesa do Supervisor)

Bloco novo **"Retornos e objeções"**, só admin/supervisor:
- **Por consultor:** retornos de hoje, atrasados, e a % feitos no dia em que estavam marcados nos últimos 7 dias.
- **Top 5 objeções da semana** (de `objecoes_uso`), com quantas vezes a resposta foi marcada útil.

## 9. Banco (Supabase `apex`, migration aditiva com rollback)

### `caderno_notas`
- **Identificação:** `id uuid pk` (gerado no navegador), `consultor_id uuid` → `profiles` (default `auth.uid()`).
- **Contato:** `telefone text`, `chave_tel text` (preenchida por gatilho com `public.chave_tel(telefone)`).
- **Dados do cliente:**
  - `nome`, `cpf`, `cnpj`, `cep`, `email`, `operadora_atual`, `decisor` (todos `text`);
  - `qtd_linhas int`, `valor_plano numeric(10,2)`;
  - `fidelidade_vence date` (dia 1 do mês);
  - `interesse text[]`, `objecoes text[]`.
- **Atendimento:** `texto text`, `resultado text` (check: `atendeu`, `nao_atendeu`, `caixa_postal`, `sem_interesse`, `fechou`).
- **Datas:** `criado_em`, `atualizado_em timestamptz` (gatilho).
- **Índices:** `(consultor_id, chave_tel)`, `(consultor_id, cnpj)`, `(consultor_id, atualizado_em desc)`.

### `agenda_retornos`
- **Identificação:** `id uuid pk`, `consultor_id uuid` (default `auth.uid()`), `nota_id uuid null` → `caderno_notas` (on delete set null).
- **Cliente:** `nome text not null`, `telefone text not null`, `chave_tel text` (gatilho).
- **Retorno:**
  - `quando timestamptz not null`;
  - `tipo text` (check: `ligacao`, `whatsapp`, `reuniao`, `proposta`);
  - `qtd_linhas int`, `valor_plano numeric(10,2)`, `observacao text`.
- **Origem e situação:**
  - `origem text` (check: `manual`, `nao_atendeu`, `fidelidade`);
  - `status text default 'pendente'` (check: `pendente`, `feito`, `cancelado`);
  - `feito_em timestamptz`.
- **Datas:** `criado_em`, `atualizado_em`.
- **Índice:** `(consultor_id, quando)`.

### `objecoes_respostas`
- `chave text pk`, `rotulo text`, `fala text`, `pergunta text`, `alternativa text`;
- `ordem int`, `ativo bool`, `atualizado_em`.
- Semeada pela migration com as 9 objeções da seção 6.2 (texto de rascunho, sem dado de cliente).

### `objecoes_uso`
- `id bigint identity`, `consultor_id` (default `auth.uid()`), `objecao text`, `fonte text` (`biblioteca`|`ia`), `util bool null`, `nota_id uuid null`, `criado_em`.

### `caderno_ia_chamadas`
- `id bigint identity`, `consultor_id`, `objecao text`, `status text`, `ms int`, `criado_em`.
- Escrita só pela Edge Function (service role). Serve ao limite de chamadas e ao log, sem guardar texto do cliente.

### Regras de acesso (RLS)
- **`caderno_notas`, `agenda_retornos` e `objecoes_uso`:**
  - o consultor lê e escreve só as linhas com `consultor_id = auth.uid()`;
  - admin/supervisor (`get_my_role()`) leem tudo;
  - ninguém altera linha de outro.
- **`objecoes_respostas`:** todo autenticado lê. Só admin/supervisor escrevem.
- **RPC `mesa_retornos_objecoes()`** (security definer, recusa quem não é admin/supervisor): devolve o bloco da seção 8 agregado.
- **LGPD:** CPF, telefone e anotações ficam só no banco, protegidos pela RLS. Nada disso vai para o repositório, para log de Edge Function ou para a IA (seção 10).

## 10. Edge Function `caderno-ia` (Supabase `apex`)

- **Entrada:**
  - `{ objecao_chave | objecao_livre, contexto }`;
  - o `contexto` traz só `qtd_linhas`, `valor_plano`, `operadora_atual`, `fidelidade_vence`, `interesse` e o `texto` da anotação.
  - O nome, CPF, CNPJ, CEP, telefone e e-mail **não são enviados** pelo navegador.
- **Mascaramento na própria função** (segunda barreira), antes do Gemini: qualquer CPF, CNPJ, telefone, CEP ou e-mail que sobrar no texto vira `[CPF]`, `[CNPJ]`, `[TELEFONE]`, `[CEP]`, `[EMAIL]`. A função de mascarar é pura e tem teste próprio.
- **Modelo:** Gemini `gemini-3.1-flash-lite`, o mesmo do Apex Mind, no nível gratuito (decisão de 06/10: mascarar + gratuito).
  - A chave fica no secret `GEMINI_API_KEY` do projeto `apex`, configurado pelo Rafael pelo CLI, nunca no chat nem no repositório.
- **Prompt:** papel de consultor Claro Empresas B2B, a resposta da biblioteca daquela objeção como base, as franquias permitidas e a proibição de inventar preço, promoção ou condição. Saída em JSON `{ fala, pergunta }`, com no máximo 3 frases no total.
- **Autenticação e limites:**
  - `verify_jwt` true (só usuário logado);
  - limite de 20 chamadas por consultor a cada 10 min (contadas em `caderno_ia_chamadas`), para proteger a cota gratuita;
  - acima do limite, devolve 429 e o painel mostra "IA indisponível agora".
- **Robustez:** tempo máximo de 6 s no Gemini, 1 nova tentativa só em 503, e o JSON é lido mesmo quando vem dentro de ```json```, como no `lib/ia/cliente.ts` do Apex Mind.
- **Log:** só chave da objeção, tempo e status. Nunca o texto.

## 11. Erros e casos de borda

- **Sem internet:** o Caderno continua (localStorage). Agenda e objeções da biblioteca funcionam com o que já foi carregado. Criar retorno sem rede fica na fila local e é enviado quando a rede volta, com o aviso "retorno guardado, será enviado".
- **Migration ainda não aplicada:** as telas novas mostram "não foi possível carregar" e o resto do painel não quebra. O padrão é o mesmo das seções 59 e 68.
- **Duas abas abertas com o Caderno:** quem salva por último vence (cada aba tem a sua anotação aberta; a mesma anotação editada em duas abas ao mesmo tempo é caso raro e fica sem aviso nesta entrega).
- **Retorno no passado:** pode ser criado (para registro), mas ganha o aviso "esse horário já passou".
- **Fuso:** as horas são sempre de São Paulo (`America/Sao_Paulo`). O banco guarda `timestamptz`.

## 12. Testes

- **Painel:** `test_caderno.js`, `test_agenda.js` e `test_objecoes.js`, com jsdom e `test_helper_mock.js`, no padrão do `run_tests.sh`. Cobrem:
  - a grade do mês: virada de mês, ano bissexto e dias de fora do mês;
  - o "+N" e os destaques de hoje e atrasado;
  - o painel do dia;
  - os atalhos de hora;
  - a remarcação;
  - o reconhecimento de CPF/CNPJ/telefone/CEP/e-mail;
  - o salvamento com e sem rede e a restauração do rascunho;
  - o Caderno → retorno preenchido;
  - a fidelidade → sugestão de 45 dias;
  - o clique no chip → resposta da biblioteca sem rede;
  - a IA indisponível → aviso sem travar;
  - o alerta único com duas abas;
  - o design: nenhuma cor hex nova e uso das classes existentes.
- **Edge Function:** `test_edge_function_caderno_ia.js` testa o mascaramento, a montagem do prompt, a leitura do JSON e o limite. O Gemini é simulado.
- **Banco:** `supabase/tests/caderno_agenda_check.sql`, em transação com rollback. Cobre:
  - um consultor não lê nem altera o do outro;
  - o supervisor lê tudo;
  - o anônimo não lê nada;
  - a `chave_tel` é preenchida;
  - os checks de `status`, `tipo` e `resultado`.
- `bash run_tests.sh` inteiro passando antes de publicar.

## 13. Roteiro das fases seguintes (cada uma com spec/plano próprios)

- **Fase 2: ligar ao ProContact.**
  - O retorno se marca **cumprido sozinho** quando aparece em `ligacoes_manuais` uma ligação do consultor para a `chave_tel` depois do horário marcado.
  - "Já ligaram para esse número?", com quem e quando, sem mostrar o conteúdo da anotação de outro consultor.
  - O usuário da telefonia passa a ser vinculado para todos os consultores.
  - O robô passa a exportar também o relatório das chamadas de campanha automática, se existir.
- **Fase 3: preencher sozinho.**
  - Consulta de CNPJ (BrasilAPI) e cobertura de fibra pelo CEP (`cobertura_kmz`).
  - Ficha pronta para colar no pedido.
  - Calculadora de proposta com a ancoragem 100/70GB.
- **Fase 4 restante:** a IA organiza a anotação inteira em campos + resumo + próximo passo, com o mesmo mascaramento.

## 14. Ordem de entrada no ar (cada passo com ok do Rafael)

1. Migration no Supabase `apex` (aditiva, com rollback em `supabase/rollback/`) e o teste SQL em transação.
2. O Rafael cria o secret `GEMINI_API_KEY` no `apex` pelo CLI.
3. Deploy da Edge Function `caderno-ia`.
4. O Rafael aprova os textos da biblioteca de objeções.
5. Build do painel, comparação com o que está no ar e publicação (fluxo "Gerar, testar e publicar" do CLAUDE.md do repo).
6. REGRAS_NEGOCIO.md §72, commit e push na `oficial/main`.

## 15. Pontos para conferir no plano

- Se a função `ppAgenda` pode ser reaproveitada como está para a camada de pedidos (seção 4.4), ou se precisa de um ajuste pequeno.
- O tamanho do `_template.html`. Se a entrega crescer demais, avaliar um bloco de script separado dentro do mesmo arquivo, sem mudar a forma de build.
