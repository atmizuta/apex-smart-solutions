# Base de Mailing: remover duplicados e cruzar com o NEO

**Data:** 2026-10-22
**Responsável:** Rafael
**Status:** especificação para revisão (nada construído)
**Base:** `oficial/main` em 404b4c8. Seção do REGRAS_NEGOCIO.md: **102.12**.

> **Sigilo.** Este documento descreve só estrutura e ordens de grandeza. Nenhum CNPJ, CPF, telefone ou nome vai para o repositório, que é público.

## 1. Objetivo

Hoje o arquivo exportado pode trazer:
- **telefone repetido:** o mesmo número em várias empresas. No arquivo TIM de 22/10 foram 10%, e um número aparecia em 78 empresas;
- **empresa que já tem pedido da Apex no NeoSales:** cliente ou venda em andamento, para quem não se deve ligar como prospecção.

Pedido do Rafael:
- um botão **"Remover duplicados"**;
- um botão **"Cruzar com o NEO"**, que tira do mailing o que está no NEO;
- entregar à parte a lista do que foi removido.

**Sucesso:**
- **Exportação nova:** sai sem telefone repetido e sem empresa com pedido no NeoSales, já no tamanho pedido.
- **Removidos:** um arquivo diz o que saiu e por quê.
- **Arquivos já gerados:** é possível limpar arquivos antigos (por exemplo, os 8 de Claro da manhã de 22/10) sem mexer no banco.
- **Histórico:** mostra quantas linhas foram para o arquivo e quantas foram removidas.

## 2. Decisões (Rafael, 22/10)

1. **"Estar no NEO"** = a empresa (CNPJ) tem pedido na tabela de pedidos do NeoSales (`producao_pedidos_neo`), **em qualquer etapa**, inclusive Venda perdida e Devolvido.
   - Em 22/10 eram 1.936 pedidos de 1.112 empresas.
   - O cruzamento é **só por CNPJ de 14 dígitos**, porque os pedidos não têm telefone. Os 7 pedidos com CPF ficam de fora.
   - Se o CNPJ tem pedido, **todas** as linhas daquela empresa saem.
2. **Caminho escolhido:** a limpeza acontece **durante a exportação**, completando a quantidade pedida, e existe também uma caixa para **limpar arquivo já gerado**.
3. As duas opções da exportação vêm **marcadas por padrão**.

## 3. Desenho

### 3.1 Lista do NeoSales (função `mailing-api`)

- **Ação nova:** `neo`, com a mesma permissão das outras (admin e supervisor).
- **O que devolve:** uma linha por CNPJ com o último pedido daquela empresa:
  - número do pedido, etapa, consultor (`usuario`), data de cadastro;
  - quantidade de pedidos.
- **Consulta:** agrupa `public.producao_pedidos_neo` por CNPJ, só para CNPJs com 14 dígitos. São ~1,1 mil linhas, em milissegundos.
- **Atualização:** a tabela já é atualizada de hora em hora pelo `sync-producao`. Nada novo para manter.

### 3.2 Exportação

- **Cartão "Exportar para o ProContact":** ganha duas caixas de marcar, marcadas por padrão:
  - ☑ **Cruzar com o NEO** (tirar empresas com pedido no NeoSales);
  - ☑ **Remover duplicados** (cada telefone sai uma vez).
- **Começo do pedido:** com "Cruzar com o NEO" marcado, o painel busca a lista (3.1) **antes** de extrair. Se a lista não vier, o pedido não começa e aparece: "Não foi possível carregar os pedidos do NeoSales. Tente de novo ou desmarque Cruzar com o NEO."
- **A cada trecho que chega**, em ordem, para cada linha:
  1. CNPJ na lista do NEO → vai para os **removidos**, com motivo "Pedido no NeoSales" e detalhe "pedido Nº · etapa · consultor · data";
  2. senão, telefone já visto **neste pedido** → vai para os **removidos**, com motivo "Telefone repetido" e detalhe "ficou no CNPJ X";
  3. senão, vai para o arquivo e o telefone entra na lista de vistos.
- **Quantidade:** só conta o que vai para o arquivo. O painel continua pedindo trechos até completar a quantidade ou o filtro acabar.
- **Banco:** as linhas removidas **ficam marcadas como usadas**, porque saíram da base. Assim vão para o fim da fila e quase não voltam.
- **Arquivos:**
  - mailing: igual a hoje, até 100 mil linhas por arquivo, layout do ProContact;
  - removidos: um arquivo **`<CARGA>_<data>_REMOVIDOS.csv`** por pedido, com `;`, Windows-1252, que abre no Excel;
  - colunas dos removidos: motivo; detalhe; sócio; razão social; CNPJ; telefone; operadora; porte; cidade.
- **Parar ou erro:** baixam o mailing e os removidos que já saíram.
- **Aviso final:** "93.194 linhas em 1 arquivo · removidas: 312 com pedido no NeoSales e 4.120 telefones repetidos (arquivo REMOVIDOS)".

### 3.3 Histórico

- **Migration nova:** `mailing.extracao` ganha `removidos_neo integer not null default 0` e `removidos_repetidos integer not null default 0`.
- **Ação nova:** `fechar_parte` {pedido, parte, neo, repetidos}.
  - O painel chama ao terminar cada arquivo.
  - A função grava os dois números no registro daquela parte, só se ele for do mesmo usuário.
- `quantidade_entregue` continua sendo o que saiu da base, a verdade do banco.
- **Coluna "Linhas" do histórico:** mostra `entregue − removidos`, que é o que foi para o arquivo. Ao lado: "(+N removidas)" quando houver.

### 3.4 Limpar arquivo já gerado

- **Caixa no mesmo cartão:** "Limpar arquivo já gerado".
  - escolher um ou mais CSVs no layout do ProContact;
  - dois botões: **[Remover duplicados]** e **[Cruzar com o NEO]**.
- **Leitura:** Windows-1252, separador `;`, campos entre aspas como o painel gera. O cabeçalho precisa ter `documento2` e `fone1`. Senão aparece: "O arquivo X não está no layout do ProContact".
- **[Remover duplicados]:** percorre os arquivos na ordem escolhida. Um telefone que já apareceu, no mesmo arquivo ou num anterior, vai para os removidos.
- **[Cruzar com o NEO]:** busca a lista (3.1) e tira as linhas cujo CNPJ está nela.
- **Saída:**
  - um **`<arquivo>_LIMPO.csv`** por arquivo de entrada, no mesmo layout de 20 colunas;
  - **um** `REMOVIDOS_<data>.csv` com as colunas de 3.2 e mais o nome do arquivo de origem.
- **Banco:** não mexe em nada nem marca nada. A ação `neo` é só leitura.

### 3.5 O que fica de fora

- **Repetido entre pedidos de dias diferentes:** um número que saiu por outra empresa em outro dia não é pego. Pegar exigiria um índice por telefone na base (~250 MB e uma recarga pesada). Para não repetir linhas entre dias continua valendo o filtro "Nunca extraídos".
- **Carteira de clientes e leads** não entram no cruzamento. Decisão do Rafael: só pedidos do NeoSales.

## 4. Erros e casos de borda

- **Lista do NEO vazia:** cruza contra nada e avisa "nenhuma empresa com pedido".
- **Filtro que acaba antes da quantidade:** o aviso diz que saíram todas as linhas do filtro, como hoje, e quantas foram removidas.
- **Quantidade e remoções:** um pedido de 100 mil com muitas remoções faz mais chamadas. Cada chamada continua limitada (seção 102.10).
- **Arquivo antigo grande:** até ~1 milhão de linhas é lido no navegador. Acima disso aparece "arquivo grande demais".
- **Telefone vazio** numa linha de arquivo antigo: a linha fica, porque não dá para comparar.

## 5. Testes

- **Função:** ação `neo` (permissão, formato); `fechar_parte` (grava só no registro do próprio usuário; números inteiros ≥ 0).
- **Painel (jsdom):**
  - exportação com remoção NEO e de repetidos completando a quantidade;
  - repetido entre arquivos de um pedido acima de 100 mil;
  - arquivo REMOVIDOS com motivo e detalhe;
  - pedido não começa se a lista do NEO falhar;
  - caixas desmarcadas = comportamento de hoje;
  - histórico com "(+N removidas)";
  - limpeza de CSV: leitura Windows-1252 e aspas, vários arquivos, layout errado, os dois botões.
- **Migration:** colunas novas e rollback.

## 6. Publicação

Cada passo só com ok do Rafael:
1. migration;
2. função `mailing-api` (v8);
3. painel, com o processo de sempre: MD5 do ar no mesmo comando do envio, backup e vigia;
4. registro na seção 102.12.
