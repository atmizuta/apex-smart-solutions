# Base de Mailing: banco e aba "Mailing" (extração no layout do ProContact)

**Data:** 2026-10-20
**Responsável:** Rafael
**Status:** especificação para revisão (nada construído)
**Base:** `oficial/main` em b1dda38. REGRAS_NEGOCIO.md vai até a seção 101; esta frente usa a **seção 102**.
**Pré-requisito:** **Supabase Pro ativo** na organização. Hoje ela está no plano gratuito, ver seção 2.6.

> **Sigilo.** Este documento descreve só estrutura e ordens de grandeza.
> - Nenhum dado da base (CNPJ, CPF, telefone, nome) vai para este repositório, que é público.
> - O pipeline que trata os arquivos do fornecedor fica fora do repositório, no PC do responsável (`Documents\apex-mailing\pipeline`).

## 1. Objetivo e critérios de sucesso

A empresa comprou mailings de um fornecedor credenciado (LGPD) com empresas, sócios e telefones. Eles foram unificados e enriquecidos fora do painel, com a Receita Federal e a consulta de operadora do NEO. O objetivo é colocar essa base **online e restrita**: admin e supervisor filtram, contam e **exportam um arquivo pronto para importar no ProContact**, sem planilha intermediária.

**Sucesso:**
- **Contagem:** a pessoa filtra e vê em segundos quantas linhas, empresas e telefones o filtro rende.
- **Importação direta:** o arquivo exportado (até 100 mil linhas) entra no ProContact **sem nenhum ajuste**. É o mesmo layout do mailing de referência (seção 2.4).
- **Registro:** toda extração fica registrada (quem, quando, filtros, quantidade e nome da carga).
- **Acesso:** só admin e supervisor; consultor não vê a aba nem consegue chamar as funções.
- **LGPD:** só sobem as colunas necessárias para filtrar e exportar (seção 3, decisão 7).
- **Cópias locais:** depois da carga conferida, nenhuma cópia da base fica no PC.
- **CRM:** o desempenho do CRM não é afetado de forma perceptível.

**Fora de escopo nesta versão:**
- retorno do discador (cruzar o resultado das ligações com a base);
- atualização automática mensal (Receita e NEO) na nuvem;
- operadora dos telefones fixos;
- editar registros pela aba;
- vínculo com leads e com o CRM de clientes.

## 2. Contexto confirmado

### 2.1 Base (ordens de grandeza, out/2026)

| Item | Quantidade |
|---|---:|
| Empresas (CNPJ) | ~4,8 milhões |
| Pares empresa + sócio | ~5,3 milhões |
| Vínculos empresa + telefone | ~16 milhões (12,3 mi do mailing + 3,7 mi da Receita) |
| Números distintos | ~12,9 milhões (11,4 mi celulares + 1,5 mi fixos; ~28 mil inválidos) |

- **96% das empresas estão em SP.**
- **A base do fornecedor parou em jan/2025.**

### 2.2 Enriquecimento já feito (pipeline local)

- **Receita Federal** (dados abertos de set/2026; 100% dos CNPJs foram encontrados):
  - situação cadastral;
  - porte atual, MEI e Simples;
  - CNAE;
  - endereço, cidade e UF;
  - DDD da cidade (código de município da Receita = SIAFI → DDD);
  - sinais: inativa, deixou de ser MEI, virou MEI, porte mudou, cidade mudou.
- **Operadora:** o NEO consultou **100% dos celulares válidos** (out/2026). Para cada número, informou:
  - a operadora atual;
  - a origem: "via prefixo Anatel" = nunca portado; "em portabilidade" = portado.
  - ~41 mil números não foram identificados pelo NEO. Para esses vale a operadora provável (fornecedor ou tabela de prefixos SMP da Anatel/ABR).
  - Os **fixos não foram consultados**.

### 2.3 Regras da gestão

- A flag Procon do fornecedor **não impede a ligação**. Ela é só um filtro opcional.
- A "base útil" (empresa ativa e sócio sem óbito) é o **padrão dos filtros**, não exclusão.
- Quem decide é o **Guilherme**.

### 2.4 Layout de importação do ProContact

O formato foi confirmado com um mailing real já importado, analisado só pelo formato.

- CSV com separador `;`, codificação **Windows-1252**, quebra de linha CRLF e cabeçalho em minúsculas.
- **20 colunas, nesta ordem:** `nome; descricao; documento1; documento2; fone1; fone2; fone3; fone4; fone5; fone6; fone7; fone8; fone9; fone10; campo1; campo2; campo3; obs; integra1; integra2`.
- **Uma linha por telefone.** Uma empresa com 2 telefones aparece em 2 linhas.

| Coluna | Conteúdo |
|---|---|
| `nome` | nome do sócio |
| `descricao` | razão social |
| `documento1` | CPF do sócio (11 dígitos) |
| `documento2` | CNPJ (14 dígitos) |
| `fone1` | telefone com DDD, sem 55 |
| `fone2` a `fone10` | vazios |
| `campo1` | operadora em texto (ex.: `CLARO S.A.`) |
| `campo2` | porte |
| `campo3` | cidade da empresa |
| `obs`, `integra1`, `integra2` | vazios |

- O relatório do discador (seção 87) devolve `Documento 1/2`, `Campo 1–3` e o **nome da carga**. É isso que permitirá, no futuro, ligar resultado de ligação ↔ linha da base.

### 2.5 Papéis

Hoje são 7 admins e 2 supervisores (um da operação Apex e um de Campinas). O padrão do banco é `public.get_my_role()`.

### 2.6 Espaço no banco

- A organização está no plano **gratuito**: 500 MB, e acima disso o projeto inteiro fica só-leitura.
- O banco `apex` tinha **228 MB em 20/10**; tinha 77 MB em 07/10.
- `discador_chamadas` cresce ~20 MB por dia útil. Nesse ritmo, o limite chega no início de novembro, mesmo sem esta frente.
- **Esta frente só começa com o Pro (8 GB).**

## 3. Decisões (brainstorming de 20/10)

1. **Abordagem B:** uma tabela de **linhas de mailing** na unidade do ProContact (empresa + sócio + telefone), com os campos de filtro copiados nela. Razão social e nome do sócio ficam em tabelas próprias e só entram na exportação.
   - **Descartadas:** A, tabelas normalizadas com junções na hora (lenta para contar 16 mi linhas no servidor básico); armazenar em arquivos no Storage (desenho do plano grátis).
   - **C fica de reserva:** contagens pré-calculadas, só se B ficar lenta (seção 9).
2. **Uma linha por telefone** na exportação, como no modelo.
3. **"Já extraído": só registrar.** Pode repetir. O sistema guarda a data da última extração e quantas vezes cada linha saiu.
4. **Até 100 mil linhas por extração**, com a quantidade escolhida pela pessoa.
5. **Prioridade quando o filtro rende mais do que o pedido:** primeiro as nunca extraídas, depois as extraídas há mais tempo; entre iguais, sorteio fixo, gerado na carga.
6. **Projeto `apex`** (mesma autenticação do painel), num **schema próprio `mailing`**, sem acesso direto pela API. Supervisor de qualquer operação vê a base inteira, porque a base é da empresa e não da operação. O registro guarda a operação de quem extraiu.
7. **LGPD: sobem só estas colunas.**
   - **Empresa:** CNPJ, razão social, colunas da Receita, porte do fornecedor e sinais.
   - **Sócio:** CPF e nome, **exigidos pelo layout**; classe econômica (filtro); flag de óbito, como booleano para o filtro padrão.
   - **Telefone:** número, tipo, origem, WhatsApp, Procon, operadora e portado.
   - **Não sobem:** nome da mãe, sexo, nascimento, idade, renda, score e faixas, persona de crédito, Bolsa Família, FGTS, veículo, imóvel, saque, e-mails, endereço do sócio e geolocalização.
8. **Mapeamento da exportação:**
   - `campo1` = nome da operadora atual em texto (NEO);
   - `campo2` = **porte atual pela Receita** (MEI, MICRO, PEQUENA, DEMAIS). O modelo usava o porte do fornecedor;
   - `campo3` = cidade da empresa pela Receita.
9. **Telefones da Receita** (às vezes do contador) entram marcados com a origem; o filtro padrão usa **só os do mailing**. **Fixos** entram; o filtro padrão é **só celular**.
10. Cada extração pede um **nome de carga** (ex.: `ICP-D-MEI-VIVO-APEX`). Ele vira o nome do arquivo e fica no registro, o que prepara o retorno do discador por carga.

## 4. Dados (schema `mailing`)

Nenhuma tabela é exposta à API. `revoke all on schema mailing from anon, authenticated`.

### 4.1 `mailing.empresa` (1 por CNPJ)

| Coluna | Tipo | Observação |
|---|---|---|
| `cnpj` | text PK | 14 dígitos; texto, preparado para o CNPJ alfanumérico |
| `razao_social` | text | a do fornecedor (é a que o ProContact recebe hoje) |
| `rf_razao_social` | text | nome atual na Receita |
| `rf_situacao` | text | ATIVA, BAIXADA, INAPTA, SUSPENSA, NULA |
| `rf_porte_atual` | text | MEI, MICRO, PEQUENA, DEMAIS, NAO INFORMADO |
| `porte_fornecedor` | text | MEI, MICRO, PEQUENA, MEDIA |
| `rf_mei`, `rf_simples` | boolean | |
| `rf_cnae` | text | 7 dígitos |
| `rf_data_abertura` | date | |
| `rf_cidade`, `rf_uf` | text | |
| `rf_ddd_cidade` | text | 2 dígitos |
| `sinal_deixou_mei`, `sinal_virou_mei`, `sinal_porte_mudou`, `sinal_cidade_mudou` | boolean | |
| `algum_socio_obito` | boolean | |
| `rf_base` | text | mês da Receita usado (ex.: `2026-09`) |

### 4.2 `mailing.socio` (1 por CNPJ + CPF)

| Coluna | Tipo |
|---|---|
| `cnpj`, `cpf` | text, PK composta |
| `nome` | text |
| `classe_economica` | text (A–E, X) |
| `obito` | boolean |
| `principal` | boolean |

### 4.3 `mailing.linha` (1 por CNPJ + telefone; unidade da exportação)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | bigint PK | |
| `cnpj` | text | |
| `cpf` | text | sócio dono do número. Para telefone da Receita, o sócio principal |
| `fone` | text | 10 ou 11 dígitos; único com `cnpj` |
| `tipo` | text | CELULAR ou FIXO |
| `ddd` | smallint | do telefone |
| `origem` | text | MAILING ou RECEITA |
| `whatsapp`, `procon` | boolean | segundo o fornecedor |
| `operadora` | text | VIVO, CLARO, TIM, OUTRAS ou nulo |
| `operadora_nome` | text | texto do NEO, para o `campo1` |
| `operadora_fonte` | text | NEO, FORNECEDOR ou PREFIXO |
| `portado` | boolean | NEO; nulo se não consultado |
| *cópia da empresa e do sócio* | | `rf_situacao`, `rf_porte_atual`, `rf_mei`, `rf_cnae`, `rf_uf`, `rf_cidade`, `rf_ddd_cidade`, `rf_data_abertura`, os sinais, `classe_economica`, `socio_obito` |
| `sorteio` | integer | aleatório, fixado na carga |
| `ultima_extracao` | timestamptz | nulo = nunca extraída |
| `vezes_extraida` | integer default 0 | |

- **Índices:** o principal é parcial, na ordem de prioridade (`ultima_extracao nulls first, sorteio`), sobre o filtro padrão: ativa + sem óbito + celular + mailing. Há também índices simples nos filtros mais seletivos (operadora + DDD, CNAE, cidade). O conjunto final de índices sai da medição da seção 9.
- **Na recarga** (NEO ou Receita novos), os dados são atualizados **sem perder** `ultima_extracao` e `vezes_extraida` (chave `cnpj + fone`).

### 4.4 `mailing.extracao` (registro)

`id`, `criado_em`, `user_id`, `username`, `role`, `operacao`, `nome_carga`, `filtros` (jsonb), `total_no_filtro`, `quantidade_pedida`, `quantidade_entregue`.

### 4.5 Apoio

- `mailing.cnae (codigo, descricao)`: busca de CNAE no filtro.
- `mailing.carga (id, carregado_em, fonte, receita_mes, neo_ate, contagens jsonb)`: alimenta o texto "dados da Receita de set/2026 · operadora NEO de out/2026" na aba.

**Tamanho estimado:** ~3–4 GB com índices. Cabe nos 8 GB do Pro; o valor real é medido na carga.

## 5. Acesso: Edge Function `mailing-api`

As funções RPC comuns (PostgREST) não servem para isto, por dois motivos:
- o tempo limite do papel `authenticated` é de 8 s;
- a API devolve no máximo 1.000 linhas por resposta.

Por isso tudo passa por uma Edge Function `mailing-api`, com `verify_jwt`.
- **Permissão:** confere o papel do usuário em `profiles`, aceitando só admin e supervisor; qualquer outro recebe 403.
- **Banco:** fala com o banco por **conexão direta** (`SUPABASE_DB_URL`), com tempo limite próprio por consulta: 30 s para contar e 120 s para extrair.
- **Filtros:** sempre como parâmetros, nunca concatenando texto do usuário em SQL.

| Ação | Entrada | Saída |
|---|---|---|
| `opcoes` | — | listas para os filtros (UFs, cidades por UF, DDDs, CNAEs com descrição, portes, operadoras, classes) e a data dos dados (`mailing.carga`) |
| `contar` | filtros | linhas, empresas distintas, telefones distintos e a divisão por operadora |
| `extrair` | filtros, quantidade (1 a 100.000), nome da carga | arquivo CSV no layout da seção 2.4. Na mesma transação, marca `ultima_extracao` e `vezes_extraida` e grava `mailing.extracao` |
| `historico` | — | últimas 100 extrações |

- **Ordem da exportação:** `ultima_extracao nulls first, sorteio`, até a quantidade pedida.
- **CSV:**
  - separador `;`, CRLF e cabeçalho com os 20 nomes;
  - campos com `;`, aspas ou quebra de linha vão entre aspas, com aspas duplicadas;
  - codificação Windows-1252: caractere fora da tabela vira `?`.
- **Arquivo:** `<nome_carga>_<AAAA-MM-DD>.csv`.

## 6. Aba "Mailing" no painel

- Fica no menu lateral, no grupo comercial, **só para admin e supervisor**.
- Segue o visual "Sinal de Ápice" (`.card`, `.filterPill`, `.btn`, `table.tbl`, `mostrarAviso`; sem cor fixa nem `alert()`).

**Filtros (padrão entre parênteses):**

| Grupo | Filtros |
|---|---|
| Região | UF; cidade; DDD do telefone |
| Empresa | situação na Receita (**ATIVA**); porte atual; MEI (todos); CNAE (busca por código ou descrição); abertura entre datas; sinais (deixou de ser MEI, virou MEI, porte mudou) |
| Sócio | classe econômica; **excluir sócio com óbito (sim)** |
| Telefone | tipo (**celular**); operadora; portado (todos); WhatsApp (todos); Procon (**todos**); origem (**só mailing**) |
| Uso | só nunca extraídas; ou não extraídas há X dias (desligado) |

**Fluxo:**
1. **Contar:** mostra linhas, empresas, telefones e a divisão por operadora.
2. **Exportar:** a pessoa informa o nome da carga e a quantidade (até 100 mil, padrão = o total, limitado a 100 mil), e o navegador baixa o CSV.
3. **Histórico:** tabela das extrações (data, quem, carga, filtros resumidos, quantidade).
4. **Rodapé:** de quando são os dados (Receita e NEO).

**Erros:** sem permissão, tempo esgotado e filtro vazio aparecem como aviso, sem travar a aba.

## 7. Carga dos dados (pipeline local → banco)

1. **Migration no repositório** com o schema, as tabelas, as permissões e os índices. É só estrutura, sem dados.
2. **Script local** no pipeline, fora do repositório:
   - lê o resultado do enriquecimento;
   - monta as tabelas com **só as colunas da decisão 7**;
   - envia por `COPY` com a string de conexão numa **variável de ambiente do PC**, nunca no chat nem em arquivo versionado;
   - carrega primeiro em tabelas de preparação e depois troca.
3. **Conferência:** contagens e impressão digital (hash) de cada tabela comparadas com o local; amostra só por formato; `analyze`.
4. **Só depois da conferência:** apagar todas as cópias locais da base e esvaziar a lixeira. Ficam os scripts e os arquivos públicos (Receita e Anatel).
5. **Recarga** (nova consulta NEO ou Receita do mês): o mesmo script atualiza preservando o uso (seção 4.3).

## 8. Segurança e LGPD

- O schema `mailing` não tem acesso direto. Só a Edge Function lê, e só para admin e supervisor.
- **Toda extração é registrada.** O limite de 100 mil por vez impede baixar a base inteira de uma só vez.
- CPF e nome do sócio sobem porque o layout do ProContact exige. As colunas sensíveis desnecessárias ficam de fora (decisão 7).
- Nada da base vai para o repositório nem para o HTML do painel, que é público.
- Os backups diários do Pro contêm a base; o acesso a eles é restrito à conta do Supabase.

## 9. Desempenho e custos

- **Servidor:** o Pro vem com o servidor Micro (1 GB de RAM).
- **Meta** nos filtros típicos (ex.: ativa + celular + operadora + DDD):
  - **contar ≤ 10 s**;
  - **extrair 100 mil ≤ 60 s**.
- **Medição** logo depois da carga, com `explain analyze`, antes de construir a aba.
- **Se não atingir, nesta ordem:**
  1. ajustar índices;
  2. contagens pré-calculadas (abordagem C);
  3. servidor Small (~US$ 15/mês a mais).
- **Proteção do CRM:** as consultas pesadas ficam com tempo limite. Se houver impacto perceptível, a extração passa a ter fila (uma por vez).
- **Custos:**
  - Pro: US$ 25/mês. O projeto do Apex Mind soma ~US$ 10/mês se continuar na mesma organização;
  - disco acima de 8 GB: US$ 0,125 por GB.

## 10. Testes

- **Unitários (node, padrão `test_*.js`):**
  - montagem do CSV: ordem e nomes das 20 colunas, `;`, CRLF, aspas e Windows-1252, incluindo acentos e caractere fora da tabela;
  - tradução filtros → consulta parametrizada, inclusive filtro vazio, listas e datas;
  - limite de 1 a 100 mil;
  - prioridade "menos usados primeiro".
- **Banco (após a carga):**
  - contagens iguais às locais;
  - consultor e anônimo recebem 403;
  - extrair grava `mailing.extracao` e atualiza o uso;
  - pedir 100.001 linhas é recusado.
- **ProContact:** importar uma extração de teste (~100 linhas) numa campanha de teste e confirmar que entra sem ajuste. **Esta é a condição de aceite final.**

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Banco do CRM atingir 500 MB antes do Pro | contratar o Pro já (urgente pelo Discador, independente desta frente) |
| Servidor Micro lento | medição antes da aba; plano da seção 9 |
| ProContact recusar o arquivo | teste com 100 linhas antes de liberar |
| Vazamento da string de conexão | só em variável de ambiente local; trocar a senha do banco depois da carga, se houver dúvida |
| Base envelhecendo (fornecedor jan/2025) | sinais da Receita; recarga mensal (fora de escopo agora) |
| Fixos sem operadora | filtro padrão só celular; tabela STFC numa próxima versão |

## 12. Entrega (cada fase com autorização própria)

1. **Pro contratado** (gestão) e confirmado no banco.
2. **Migration** de estrutura (schema, tabelas, permissões, índices), sem dados.
3. **Carga** pelo script local e **conferência**; medição de desempenho.
4. **Edge Function `mailing-api`**.
5. **Aba "Mailing"** no painel.
6. **Teste de importação** no ProContact.
7. **Publicação** (REGRAS_NEGOCIO seção 102) e **remoção das cópias locais**.

**Depois:**
- retorno do discador por carga;
- operadora dos fixos (tabela STFC);
- Receita e NEO mensais.

**Pendências antes da fase 2:**
- contratação do Pro;
- ok final da lista de colunas (decisão 7) pelo Guilherme;
- string de conexão do banco disponível no PC do responsável.
