# Triagem Automática de Leads (CNPJ + Viabilidade) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No instante em que um lead novo cai na planilha (Fibra ou Móvel B2B), validar CNPJ (Receita Federal) e, para Fibra, viabilidade técnica (portal Claro), classificar o lead, montar uma mensagem de WhatsApp já ancorada no plano maior e notificar o consultor designado — sem que nenhum consultor gaste tempo em lead sem CNPJ válido ou sem viabilidade.

**Architecture:** Google Apps Script vinculado à planilha (mesma que já é o sistema de registro hoje), com um gatilho por tempo (a cada 1 minuto) que varre as abas de leads em busca de linhas ainda não processadas, chama duas APIs externas (BrasilAPI para CNPJ, portal de viabilidade da Claro para Fibra), grava a classificação em colunas novas ao final da planilha, e envia um e-mail ao consultor designado com um link `wa.me` já preenchido com a mensagem de abertura (seguindo a escada de preço do guia de atendimento). Não mexe nas colunas existentes nem no fluxo manual que os consultores já usam — só adiciona informação.

**Tech Stack:** Google Apps Script (V8 runtime), `clasp` (Google Apps Script CLI) para versionar e publicar o código a partir do Node, Node 24 + `node:test` (nativo, sem dependência) para testar a lógica pura isolada do Apps Script, BrasilAPI (`https://brasilapi.com.br/api/cnpj/v1/{cnpj}`, gratuita, sem chave).

**Spec:** `docs/superpowers/specs/2026-09-23-captacao-leads-claro-design.md` (Abordagem escolhida, seção 4-7). O guia de atendimento (`docs/guides/2026-09-23-guia-atendimento-lead-claro.md`) define a escada de preço usada na mensagem de abertura.

## Global Constraints

- Não usar Python — não está instalado nesta máquina (só Node v24 está disponível; ver `[[project_crm_painel_apex]]`).
- Nunca inserir colunas no meio das abas de leads — só adicionar ao final. O CRM do painel de clientes (`apex-smart-solutions/crm`) já lê essa mesma planilha via Edge Function `sync-leads`; inserir/reordenar colunas existentes pode quebrar essa sincronização.
- Nomes de aba mudam todo mês (ex.: "LEADS FIBRA CLARO APEX - SETEMBRO" vira "...OUTUBRO"). Nunca fixar o nome da aba no código — ler de uma aba de configuração (Task 9).
- Escada de preço (não reabrir essa decisão sem confirmar com o Rafael): abrir por 100GB/R$89,99 ou 70GB/R$74,99; só descer para 40GB/R$54,99 ou 12GB/R$39,99 se o cliente questionar; nunca oferecer proativamente o plano regional de 15GB/R$44,99.
- Consultores atuais: Caio, Gabriel, Giovanna, Manuela, Rafael, Victoria (conferir a lista real na aba de configuração antes de rodar em produção — pode ter mudado).
- Toda chamada de rede (BrasilAPI, portal de viabilidade) deve usar `muteHttpExceptions: true` e nunca deixar uma falha de rede derrubar o processamento das outras linhas do lote.
- Os nomes de campo usados no Task 10 (`informe_o_seu_cnpj_`, `informe_o_seu_endereço_com_cep_para_consulta_de_viabilidade_técnica_`, `nome_completo`, `nome_da_empresa`, `telefone`, `phone_number`) foram lidos visualmente da planilha durante o design — **antes de rodar o Task 10 em produção, confira a linha 1 real de cada aba** (`=TRANSPOSE(A1:Z1)` numa célula vazia mostra tudo em coluna) e ajuste os literais se algum nome estiver diferente. `mapearCabecalho` (Task 8) já usa nome de coluna em vez de letra fixa — só os literais de string no Task 10 podem estar errados, não a lógica.

## Review Focus

- CNPJ vem da planilha com pontuação (`XX.XXX.XXX/XXXX-XX`) ou só dígitos, dependendo de como o lead preencheu — a validação tem que limpar antes de chamar a API, senão todo CNPJ válido é classificado como inválido.
- Linha de lead com CNPJ ou CEP vazio/mal preenchido (lead capenga) não pode travar o processamento do lote inteiro — precisa virar `PENDENTE_MANUAL` e seguir para a próxima linha.
- BrasilAPI ou o portal de viabilidade fora do ar (timeout, 5xx) não pode ser tratado como "CNPJ inválido" ou "sem viabilidade" — é um caso diferente (`PENDENTE_MANUAL`), senão lead bom é descartado por instabilidade de terceiro.
- Uma linha já processada (tem timestamp em `TRIAGEM_PROCESSADO_EM`) nunca pode ser reprocessada nem gerar uma segunda notificação, mesmo que o consultor edite outras células da mesma linha depois.
- Uma execução não pode estourar o limite de tempo do Apps Script (6 minutos) quando o volume de leads não processados for grande — precisa de um teto de linhas por execução.
- Um lead novo com o mesmo CNPJ ou telefone de um lead já processado antes (mesma aba) não pode gerar uma segunda mensagem/notificação de "abertura" — é o mesmo contato reaparecendo, não um lead novo (spec, seção 7).

**Nota de escopo:** `TRIAGEM_STATUS` (esta automação) é um conjunto fechado — `QUALIFICADO`, `SEM_VIABILIDADE`, `CNPJ_INVALIDO`, `DUPLICADO`, `PENDENTE_MANUAL`. A classificação `SUSPEITA DE FRAUDE` que já existe na coluna `STATUS` manual (preenchida pelo consultor) continua sendo um julgamento humano — nenhuma das duas APIs usadas aqui (Receita Federal, portal de viabilidade) dá sinal confiável de fraude, então a automação não tenta detectar isso e nunca sobrescreve a coluna `STATUS` existente, só adiciona as colunas novas.

---

## Task 1: Scaffold do projeto e harness de teste

**Files:**
- Create: `apex-smart-solutions/leads-triagem/package.json`
- Create: `apex-smart-solutions/leads-triagem/appsscript.json`
- Create: `apex-smart-solutions/leads-triagem/.claspignore`
- Create: `apex-smart-solutions/leads-triagem/README.md`
- Create: `apex-smart-solutions/leads-triagem/src/_smoke.js`
- Test: `apex-smart-solutions/leads-triagem/test/_smoke.test.js`

**Interfaces:**
- Produces: convenção de arquivo compartilhado Node/Apps Script — todo arquivo em `src/` termina com `if (typeof module !== 'undefined') { module.exports = {...}; }`, o que faz o mesmo arquivo funcionar via `require()` no Node (testes) e como escopo global no Apps Script (produção), sem bundler.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "leads-triagem-apex",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Criar `appsscript.json`** (manifesto do Apps Script — fuso e runtime)

```json
{
  "timeZone": "America/Sao_Paulo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

- [ ] **Step 3: Criar `.claspignore`** (não publicar testes/config de Node no Apps Script)

```
test/**
package.json
package-lock.json
README.md
.claspignore
```

- [ ] **Step 4: Escrever o arquivo de exemplo `src/_smoke.js`** (prova o padrão Node/Apps Script antes de usar nos módulos reais)

```javascript
function somar(a, b) {
  return a + b;
}

if (typeof module !== 'undefined') {
  module.exports = { somar };
}
```

- [ ] **Step 5: Escrever o teste `test/_smoke.test.js`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { somar } = require('../src/_smoke.js');

test('somar soma dois números', () => {
  assert.equal(somar(2, 3), 5);
});
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: `# pass 1`, `# fail 0`

- [ ] **Step 7: Remover o arquivo de exemplo** (serviu só pra provar o harness — não faz parte do produto final)

Run: `rm apex-smart-solutions/leads-triagem/src/_smoke.js apex-smart-solutions/leads-triagem/test/_smoke.test.js`

- [ ] **Step 8: Commit**

```bash
git add apex-smart-solutions/leads-triagem/package.json apex-smart-solutions/leads-triagem/appsscript.json apex-smart-solutions/leads-triagem/.claspignore
git commit -m "chore: scaffold leads-triagem project (Node test harness + Apps Script manifest)"
```

---

## Task 2: Módulo de validação de CNPJ

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/cnpj.js`
- Test: `apex-smart-solutions/leads-triagem/test/cnpj.test.js`

**Interfaces:**
- Produces: `limparCnpj(cnpjTexto: string): string` (só dígitos); `classificarRespostaCnpj(httpStatus: number, corpo: object|null): {status: 'ATIVA'|'INVALIDA'|'ERRO', detalhe: string}` — usado pelo Task 7 (glue HTTP) e pelo Task 10 (orquestração).

- [ ] **Step 1: Escrever os testes de `limparCnpj`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { limparCnpj, classificarRespostaCnpj } = require('../src/cnpj.js');

test('limparCnpj remove pontuação', () => {
  assert.equal(limparCnpj('63.224.353/0001-95'), '63224353000195');
});

test('limparCnpj mantém string já só com dígitos', () => {
  assert.equal(limparCnpj('63224353000195'), '63224353000195');
});

test('limparCnpj remove espaços e traços soltos', () => {
  assert.equal(limparCnpj(' 63 224 353 0001-95 '), '63224353000195');
});
```

- [ ] **Step 2: Rodar e confirmar falha** (função ainda não existe)

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: FAIL — `Cannot find module '../src/cnpj.js'`

- [ ] **Step 3: Implementar `limparCnpj`**

```javascript
function limparCnpj(cnpjTexto) {
  return String(cnpjTexto || '').replace(/\D/g, '');
}

if (typeof module !== 'undefined') {
  module.exports = { limparCnpj };
}
```

- [ ] **Step 4: Rodar e confirmar que os 3 testes de `limparCnpj` passam**

Run: `npm test`
Expected: os 3 testes de `limparCnpj` em PASS (os de `classificarRespostaCnpj` ainda falham, é esperado)

- [ ] **Step 5: Escrever os testes de `classificarRespostaCnpj`**

```javascript
test('classificarRespostaCnpj: 200 com situação ATIVA é válido', () => {
  const r = classificarRespostaCnpj(200, { descricao_situacao_cadastral: 'ATIVA' });
  assert.equal(r.status, 'ATIVA');
});

test('classificarRespostaCnpj: 200 com situação BAIXADA é inválido', () => {
  const r = classificarRespostaCnpj(200, { descricao_situacao_cadastral: 'BAIXADA' });
  assert.equal(r.status, 'INVALIDA');
  assert.match(r.detalhe, /BAIXADA/);
});

test('classificarRespostaCnpj: 404 é inválido (CNPJ não existe)', () => {
  const r = classificarRespostaCnpj(404, null);
  assert.equal(r.status, 'INVALIDA');
});

test('classificarRespostaCnpj: 500 é erro (não é inválido, é falha de terceiro)', () => {
  const r = classificarRespostaCnpj(500, null);
  assert.equal(r.status, 'ERRO');
});

test('classificarRespostaCnpj: timeout (status 0) é erro', () => {
  const r = classificarRespostaCnpj(0, null);
  assert.equal(r.status, 'ERRO');
});
```

- [ ] **Step 6: Rodar e confirmar falha** (`classificarRespostaCnpj` ainda não existe)

Run: `npm test`
Expected: FAIL — `classificarRespostaCnpj is not a function`

- [ ] **Step 7: Implementar `classificarRespostaCnpj`**

```javascript
function classificarRespostaCnpj(httpStatus, corpo) {
  if (httpStatus === 200 && corpo && corpo.descricao_situacao_cadastral === 'ATIVA') {
    return { status: 'ATIVA', detalhe: 'ATIVA' };
  }
  if (httpStatus === 200 && corpo && corpo.descricao_situacao_cadastral) {
    return { status: 'INVALIDA', detalhe: corpo.descricao_situacao_cadastral };
  }
  if (httpStatus === 404) {
    return { status: 'INVALIDA', detalhe: 'CNPJ não encontrado na Receita Federal' };
  }
  return { status: 'ERRO', detalhe: `Falha ao consultar BrasilAPI (HTTP ${httpStatus})` };
}

if (typeof module !== 'undefined') {
  module.exports = { limparCnpj, classificarRespostaCnpj };
}
```

- [ ] **Step 8: Rodar todos os testes de `cnpj.js` e confirmar que passam**

Run: `npm test`
Expected: 8 testes em PASS, 0 FAIL

- [ ] **Step 9: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/cnpj.js apex-smart-solutions/leads-triagem/test/cnpj.test.js
git commit -m "feat: add CNPJ validation classifier module"
```

---

## Task 3: Módulo de mensagem e link de WhatsApp

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/mensagem.js`
- Test: `apex-smart-solutions/leads-triagem/test/mensagem.test.js`

**Interfaces:**
- Consumes: nada de outro módulo (puro).
- Produces: `montarMensagemAbertura(lead: {nome: string, empresa: string}): string`; `montarLinkWhatsapp(telefone: string, mensagem: string): string`; `limparTelefone(telefone: string): string`. Usados pelo Task 8 (detecção de duplicata) e pelo Task 10 (orquestração).

- [ ] **Step 1: Escrever os testes de `montarMensagemAbertura`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarMensagemAbertura, montarLinkWhatsapp } = require('../src/mensagem.js');

test('montarMensagemAbertura usa nome e empresa do lead', () => {
  const msg = montarMensagemAbertura({ nome: 'Rafael', empresa: 'Padaria Boa Sorte' });
  assert.match(msg, /Rafael/);
  assert.match(msg, /Padaria Boa Sorte/);
});

test('montarMensagemAbertura abre pelo plano de 100GB, não pelo do anúncio', () => {
  const msg = montarMensagemAbertura({ nome: 'Rafael', empresa: 'Padaria Boa Sorte' });
  assert.match(msg, /100GB/);
  assert.match(msg, /R\$89,99/);
  assert.doesNotMatch(msg, /R\$39,99/);
});

test('montarMensagemAbertura usa "sua empresa" quando o nome da empresa está vazio', () => {
  const msg = montarMensagemAbertura({ nome: 'Rafael', empresa: '' });
  assert.match(msg, /sua empresa/);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: FAIL — `Cannot find module '../src/mensagem.js'`

- [ ] **Step 3: Implementar `montarMensagemAbertura`**

```javascript
function montarMensagemAbertura(lead) {
  const nome = lead.nome || '';
  const empresa = lead.empresa && lead.empresa.trim() ? lead.empresa.trim() : 'sua empresa';
  return `Oi ${nome}! Vi que a ${empresa} tá buscando linha empresarial. ` +
    'Pro seu perfil, o plano que mais faz sentido é o de 100GB por R$89,99 — ' +
    'dá folga de verdade e já vem com Claro banca, McAfee e nuvem incluídos. ' +
    'Consigo confirmar a viabilidade aí no seu endereço agora, me passa o CEP?';
}

if (typeof module !== 'undefined') {
  module.exports = { montarMensagemAbertura };
}
```

- [ ] **Step 4: Rodar e confirmar que os 3 testes de `montarMensagemAbertura` passam**

Run: `npm test`

- [ ] **Step 5: Escrever os testes de `limparTelefone` e `montarLinkWhatsapp`**

```javascript
test('limparTelefone deixa só dígitos', () => {
  assert.equal(limparTelefone('+55 (16) 98123-4567'), '5516981234567');
});

test('montarLinkWhatsapp gera link wa.me com telefone só em dígitos', () => {
  const link = montarLinkWhatsapp('+55 (16) 98123-4567', 'Oi!');
  assert.match(link, /^https:\/\/wa\.me\/5516981234567\?text=/);
});

test('montarLinkWhatsapp escapa a mensagem pra URL', () => {
  const link = montarLinkWhatsapp('5516981234567', 'Olá! Tudo bem?');
  const url = new URL(link);
  assert.equal(url.searchParams.get('text'), 'Olá! Tudo bem?');
});
```

- [ ] **Step 6: Rodar e confirmar falha**

Run: `npm test`
Expected: FAIL — `montarLinkWhatsapp is not a function`

- [ ] **Step 7: Implementar `limparTelefone` e `montarLinkWhatsapp`**

```javascript
function limparTelefone(telefone) {
  return String(telefone || '').replace(/\D/g, '');
}

function montarLinkWhatsapp(telefone, mensagem) {
  const digitos = limparTelefone(telefone);
  const params = new URLSearchParams({ text: mensagem });
  return `https://wa.me/${digitos}?${params.toString()}`;
}

if (typeof module !== 'undefined') {
  module.exports = { montarMensagemAbertura, montarLinkWhatsapp, limparTelefone };
}
```

- [ ] **Step 8: Rodar todos os testes de `mensagem.js` e confirmar que passam**

Run: `npm test`
Expected: 6 testes em PASS

- [ ] **Step 9: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/mensagem.js apex-smart-solutions/leads-triagem/test/mensagem.test.js
git commit -m "feat: add WhatsApp opening message and deep-link builder"
```

---

## Task 4: Módulo de roteamento (round-robin de consultores)

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/roteamento.js`
- Test: `apex-smart-solutions/leads-triagem/test/roteamento.test.js`

**Interfaces:**
- Produces: `proximoConsultor(consultores: string[], ultimoIndice: number): {consultor: string, novoIndice: number}`. Usado pelo Task 10.

- [ ] **Step 1: Escrever os testes**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { proximoConsultor } = require('../src/roteamento.js');

test('proximoConsultor avança pro próximo da lista', () => {
  const r = proximoConsultor(['Caio', 'Gabriel', 'Rafael'], 0);
  assert.equal(r.consultor, 'Gabriel');
  assert.equal(r.novoIndice, 1);
});

test('proximoConsultor dá a volta no fim da lista', () => {
  const r = proximoConsultor(['Caio', 'Gabriel', 'Rafael'], 2);
  assert.equal(r.consultor, 'Caio');
  assert.equal(r.novoIndice, 0);
});

test('proximoConsultor com índice inválido/negativo começa do início', () => {
  const r = proximoConsultor(['Caio', 'Gabriel', 'Rafael'], -1);
  assert.equal(r.consultor, 'Caio');
  assert.equal(r.novoIndice, 0);
});

test('proximoConsultor com lista de 1 consultor sempre retorna o mesmo', () => {
  const r = proximoConsultor(['Caio'], 0);
  assert.equal(r.consultor, 'Caio');
  assert.equal(r.novoIndice, 0);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: FAIL — `Cannot find module '../src/roteamento.js'`

- [ ] **Step 3: Implementar `proximoConsultor`**

```javascript
function proximoConsultor(consultores, ultimoIndice) {
  if (!Array.isArray(consultores) || consultores.length === 0) {
    throw new Error('Lista de consultores vazia — configure a aba Config_Triagem.');
  }
  const indiceValido = Number.isInteger(ultimoIndice) && ultimoIndice >= 0 ? ultimoIndice : -1;
  const novoIndice = (indiceValido + 1) % consultores.length;
  return { consultor: consultores[novoIndice], novoIndice };
}

if (typeof module !== 'undefined') {
  module.exports = { proximoConsultor };
}
```

- [ ] **Step 4: Rodar todos os testes de `roteamento.js` e confirmar que passam**

Run: `npm test`
Expected: 4 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/roteamento.js apex-smart-solutions/leads-triagem/test/roteamento.test.js
git commit -m "feat: add round-robin consultant routing module"
```

---

## Task 5: Capturar o contrato de requisição do portal de viabilidade (manual — Rafael)

Esta tarefa não é código — é investigação, porque o portal (`app.conexaoclarobrasil.com.br`) exige login, e ninguém além de quem tem acesso de parceiro pode inspecionar a chamada real.

**Files:**
- Create: `apex-smart-solutions/leads-triagem/docs/contrato-viabilidade.md`

- [ ] **Step 1: Logar no portal** em `https://app.conexaoclarobrasil.com.br/vendas/viabilidade` com sua conta de parceiro.

- [ ] **Step 2: Abrir o DevTools do navegador (F12) → aba Network, marcar "Preserve log"**, antes de fazer a consulta.

- [ ] **Step 3: Fazer uma consulta de viabilidade com um CEP conhecido** (um que você já sabe se é viável ou não, pra conseguir comparar com o resultado real).

- [ ] **Step 4: No painel Network, achar a requisição da consulta** (geralmente XHR/Fetch, método GET ou POST, contendo o CEP). Clicar nela.

- [ ] **Step 5: Copiar como cURL** (botão direito na requisição → "Copy" → "Copy as cURL") e colar o conteúdo em `docs/contrato-viabilidade.md`, junto com:
  - a resposta (aba "Response" da mesma requisição, colar o JSON/HTML retornado)
  - qual campo da resposta indica "viável" vs "sem viabilidade" (ex.: um campo `viavel: true/false`, ou um texto específico)
  - se a chamada precisa de cookie de sessão (login) ou de um token separado no header/URL

- [ ] **Step 6: Repetir com um CEP sem viabilidade conhecida**, pra confirmar como a resposta muda nesse caso, e colar também.

- [ ] **Step 7: Avisar quando o arquivo estiver pronto** — a Task 6 (implementação real) só pode ser escrita depois disso, porque sem o formato exato da resposta qualquer código seria only um chute.

---

## Task 6: Módulo de classificação de viabilidade

**Pré-requisito:** Task 5 concluída (`docs/contrato-viabilidade.md` preenchido). Os testes abaixo usam um formato de resposta assumido — **ajuste os literais de teste para bater com a resposta real documentada na Task 5 antes de implementar** (isso é esperado, não é um placeholder: a estrutura da função e do teste é real, só o formato exato do JSON depende do que a Task 5 trouxer).

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/viabilidade.js`
- Test: `apex-smart-solutions/leads-triagem/test/viabilidade.test.js`

**Interfaces:**
- Produces: `classificarRespostaViabilidade(httpStatus: number, corpo: object|null): {status: 'VIAVEL'|'SEM_VIABILIDADE'|'ERRO', detalhe: string}`. Usado pelo Task 10.

- [ ] **Step 1: Escrever os testes** (adaptar os campos `corpo.viavel` para o nome real do campo documentado na Task 5)

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { classificarRespostaViabilidade } = require('../src/viabilidade.js');

test('classificarRespostaViabilidade: viavel=true é VIAVEL', () => {
  const r = classificarRespostaViabilidade(200, { viavel: true });
  assert.equal(r.status, 'VIAVEL');
});

test('classificarRespostaViabilidade: viavel=false é SEM_VIABILIDADE', () => {
  const r = classificarRespostaViabilidade(200, { viavel: false });
  assert.equal(r.status, 'SEM_VIABILIDADE');
});

test('classificarRespostaViabilidade: erro HTTP é ERRO, não SEM_VIABILIDADE', () => {
  const r = classificarRespostaViabilidade(500, null);
  assert.equal(r.status, 'ERRO');
});

test('classificarRespostaViabilidade: timeout (status 0) é ERRO', () => {
  const r = classificarRespostaViabilidade(0, null);
  assert.equal(r.status, 'ERRO');
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: FAIL — `Cannot find module '../src/viabilidade.js'`

- [ ] **Step 3: Implementar `classificarRespostaViabilidade`** (ajustar o nome do campo conforme a Task 5)

```javascript
function classificarRespostaViabilidade(httpStatus, corpo) {
  if (httpStatus !== 200 || !corpo) {
    return { status: 'ERRO', detalhe: `Falha ao consultar portal de viabilidade (HTTP ${httpStatus})` };
  }
  if (corpo.viavel === true) {
    return { status: 'VIAVEL', detalhe: 'Endereço com viabilidade confirmada' };
  }
  return { status: 'SEM_VIABILIDADE', detalhe: 'Endereço sem viabilidade técnica' };
}

if (typeof module !== 'undefined') {
  module.exports = { classificarRespostaViabilidade };
}
```

- [ ] **Step 4: Rodar todos os testes de `viabilidade.js` e confirmar que passam**

Run: `npm test`
Expected: 4 testes em PASS

- [ ] **Step 5: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/viabilidade.js apex-smart-solutions/leads-triagem/test/viabilidade.test.js
git commit -m "feat: add viability response classifier module"
```

---

## Task 7: Glue de HTTP (BrasilAPI + portal de viabilidade)

Esta camada chama `UrlFetchApp`, que só existe dentro do Apps Script — não dá pra rodar via `node --test` sem simular o serviço. Por isso ela fica fina (só monta a chamada e devolve status+corpo) e toda a lógica de decisão já foi testada nos Tasks 2 e 6.

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/http.js`

**Interfaces:**
- Consumes: nenhum módulo do projeto (usa o global `UrlFetchApp` do Apps Script).
- Produces: `consultarCnpj(cnpjLimpo: string): {status: number, corpo: object|null}`; `consultarViabilidade(cep: string): {status: number, corpo: object|null}`. Usados pelo Task 10.

- [ ] **Step 1: Implementar `consultarCnpj`**

```javascript
function consultarCnpj(cnpjLimpo) {
  const resposta = UrlFetchApp.fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`, {
    muteHttpExceptions: true,
    method: 'get',
  });
  const status = resposta.getResponseCode();
  let corpo = null;
  try {
    corpo = JSON.parse(resposta.getContentText());
  } catch (e) {
    corpo = null;
  }
  return { status, corpo };
}

if (typeof module !== 'undefined') {
  module.exports = { consultarCnpj, consultarViabilidade };
}
```

- [ ] **Step 2: Implementar `consultarViabilidade`** (usar exatamente o método/URL/headers documentados em `docs/contrato-viabilidade.md` da Task 5 — o exemplo abaixo assume um GET com o CEP na query string; ajustar se o contrato real for diferente, ex. POST com corpo, ou exigir cookie de sessão)

```javascript
function consultarViabilidade(cep) {
  const resposta = UrlFetchApp.fetch(
    `https://app.conexaoclarobrasil.com.br/vendas/viabilidade?cep=${encodeURIComponent(cep)}`,
    { muteHttpExceptions: true, method: 'get' }
  );
  const status = resposta.getResponseCode();
  let corpo = null;
  try {
    corpo = JSON.parse(resposta.getContentText());
  } catch (e) {
    corpo = null;
  }
  return { status, corpo };
}
```

- [ ] **Step 3: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/http.js
git commit -m "feat: add UrlFetchApp glue for CNPJ and viability lookups"
```

---

## Task 8: Glue de planilha (ler cabeçalho por nome, achar linhas novas, gravar resultado)

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/planilha.js`
- Test: `apex-smart-solutions/leads-triagem/test/planilha.test.js` (só a parte pura, `mesmoLead` — o resto do arquivo depende de `SpreadsheetApp` e não roda fora do Apps Script)

**Interfaces:**
- Consumes: `SpreadsheetApp` global do Apps Script; `limparCnpj` (Task 2) e `limparTelefone` (Task 3).
- Produces: `mesmoLead(cnpjA: string, telefoneA: string, cnpjB: string, telefoneB: string): boolean` (pura, testável); `mapearCabecalho(aba: Sheet): Object<string,number>`; `linhasNaoProcessadas(aba: Sheet, mapaColunas: Object): Array<{numeroLinha: number, dados: Object}>`; `gravarResultado(aba: Sheet, mapaColunas: Object, numeroLinha: number, resultado: Object)`; `encontrarLeadDuplicado(aba: Sheet, mapaColunas: Object, numeroLinhaAtual: number, cnpjLimpo: string, telefoneLimpo: string): {numeroLinha: number, consultor: string}|null`. Usados pelo Task 10.

- [ ] **Step 1: Escrever os testes de `mesmoLead`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { mesmoLead } = require('../src/planilha.js');

test('mesmoLead: mesmo CNPJ (já limpo) é o mesmo lead', () => {
  assert.equal(mesmoLead('11222333000181', '', '11222333000181', ''), true);
});

test('mesmoLead: mesmo telefone (já limpo) é o mesmo lead, mesmo com CNPJ diferente', () => {
  assert.equal(mesmoLead('11222333000181', '5516988887777', '99888777000100', '5516988887777'), true);
});

test('mesmoLead: CNPJ e telefone diferentes não é o mesmo lead', () => {
  assert.equal(mesmoLead('11222333000181', '5516988887777', '99888777000100', '5516999990000'), false);
});

test('mesmoLead: campos vazios dos dois lados não contam como coincidência', () => {
  assert.equal(mesmoLead('', '', '', ''), false);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd apex-smart-solutions/leads-triagem && npm test`
Expected: FAIL — `Cannot find module '../src/planilha.js'`

- [ ] **Step 3: Implementar `mesmoLead`** (primeira coisa no arquivo — recebe valores já limpos, ou seja, quem chama já rodou `limparCnpj`/`limparTelefone` antes)

```javascript
function mesmoLead(cnpjA, telefoneA, cnpjB, telefoneB) {
  const cnpjBate = Boolean(cnpjA) && cnpjA === cnpjB;
  const telefoneBate = Boolean(telefoneA) && telefoneA === telefoneB;
  return cnpjBate || telefoneBate;
}
```

- [ ] **Step 4: Rodar e confirmar que os 4 testes de `mesmoLead` passam**

Run: `npm test`

**Colunas novas** (adicionadas ao final de cada aba de leads, na primeira execução — ver Step 5): `TRIAGEM_STATUS`, `TRIAGEM_CNPJ_DETALHE`, `TRIAGEM_VIABILIDADE_DETALHE`, `CONSULTOR_ATRIBUIDO`, `LINK_WHATSAPP`, `TRIAGEM_PROCESSADO_EM`.

- [ ] **Step 5: Implementar `mapearCabecalho`** (lê a linha 1 e devolve `{ nomeDaColuna: índiceBaseZero }`; se uma das 6 colunas novas não existir ainda, cria ao final)

```javascript
const COLUNAS_TRIAGEM = [
  'TRIAGEM_STATUS',
  'TRIAGEM_CNPJ_DETALHE',
  'TRIAGEM_VIABILIDADE_DETALHE',
  'CONSULTOR_ATRIBUIDO',
  'LINK_WHATSAPP',
  'TRIAGEM_PROCESSADO_EM',
];

function mapearCabecalho(aba) {
  const ultimaColuna = aba.getLastColumn();
  const cabecalho = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0];
  const mapa = {};
  cabecalho.forEach((nome, indice) => {
    if (nome) mapa[String(nome).trim()] = indice;
  });

  const colunasFaltando = COLUNAS_TRIAGEM.filter((nome) => !(nome in mapa));
  if (colunasFaltando.length > 0) {
    const inicioNovasColunas = ultimaColuna + 1;
    aba.getRange(1, inicioNovasColunas, 1, colunasFaltando.length).setValues([colunasFaltando]);
    colunasFaltando.forEach((nome, i) => {
      mapa[nome] = inicioNovasColunas - 1 + i;
    });
  }
  return mapa;
}
```

(o `module.exports` só é escrito no Step 8, depois que todas as funções deste arquivo existirem — escrevê-lo agora quebraria com `ReferenceError`, já que `linhasNaoProcessadas` e `gravarResultado` ainda não existem.)

- [ ] **Step 6: Implementar `linhasNaoProcessadas`** (linhas onde `TRIAGEM_PROCESSADO_EM` está vazio, limitado a um teto por execução pra não estourar o tempo de execução do Apps Script)

```javascript
const TETO_LINHAS_POR_EXECUCAO = 20;

function linhasNaoProcessadas(aba, mapaColunas) {
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return [];

  const ultimaColuna = aba.getLastColumn();
  const valores = aba.getRange(2, 1, ultimaLinha - 1, ultimaColuna).getValues();
  const colunaProcessado = mapaColunas['TRIAGEM_PROCESSADO_EM'];

  const resultado = [];
  for (let i = 0; i < valores.length; i++) {
    if (resultado.length >= TETO_LINHAS_POR_EXECUCAO) break;
    const linha = valores[i];
    if (!linha[colunaProcessado]) {
      const dados = {};
      Object.keys(mapaColunas).forEach((nomeColuna) => {
        dados[nomeColuna] = linha[mapaColunas[nomeColuna]];
      });
      resultado.push({ numeroLinha: i + 2, dados });
    }
  }
  return resultado;
}
```

- [ ] **Step 7: Implementar `gravarResultado`** (grava as 6 colunas de uma linha de uma vez, incluindo o timestamp que marca "já processado")

```javascript
function gravarResultado(aba, mapaColunas, numeroLinha, resultado) {
  COLUNAS_TRIAGEM.forEach((nomeColuna) => {
    if (nomeColuna in resultado) {
      aba.getRange(numeroLinha, mapaColunas[nomeColuna] + 1).setValue(resultado[nomeColuna]);
    }
  });
  aba.getRange(numeroLinha, mapaColunas['TRIAGEM_PROCESSADO_EM'] + 1).setValue(new Date());
}
```

- [ ] **Step 8: Implementar `encontrarLeadDuplicado`** (varre as linhas já processadas antes da linha atual, procurando o mesmo CNPJ ou telefone — usa `limparCnpj`/`limparTelefone` do Task 2/3 e `mesmoLead` pra comparar sem depender de formatação igual)

```javascript
function encontrarLeadDuplicado(aba, mapaColunas, numeroLinhaAtual, cnpjLimpo, telefoneLimpo) {
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2 || numeroLinhaAtual <= 2) return null;

  const ultimaColuna = aba.getLastColumn();
  const totalLinhasAnteriores = numeroLinhaAtual - 2;
  const valores = aba.getRange(2, 1, totalLinhasAnteriores, ultimaColuna).getValues();
  const colCnpj = mapaColunas['informe_o_seu_cnpj_'] ?? mapaColunas['CNPJ'];
  const colTelefone = mapaColunas['telefone'] ?? mapaColunas['phone_number'];
  const colProcessado = mapaColunas['TRIAGEM_PROCESSADO_EM'];
  const colConsultor = mapaColunas['CONSULTOR_ATRIBUIDO'];

  for (let i = 0; i < valores.length; i++) {
    const linha = valores[i];
    if (!linha[colProcessado]) continue;
    if (mesmoLead(cnpjLimpo, telefoneLimpo, limparCnpj(linha[colCnpj]), limparTelefone(linha[colTelefone]))) {
      return { numeroLinha: i + 2, consultor: linha[colConsultor] || null };
    }
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { mesmoLead, COLUNAS_TRIAGEM, mapearCabecalho, linhasNaoProcessadas, gravarResultado, encontrarLeadDuplicado };
}
```

- [ ] **Step 9: Rodar todos os testes do arquivo e commitar**

Run: `npm test`
Expected: os 4 testes de `mesmoLead` em PASS (as demais funções deste arquivo usam `SpreadsheetApp` e não têm teste Node — ver nota no início do Task 7)

```bash
git add apex-smart-solutions/leads-triagem/src/planilha.js apex-smart-solutions/leads-triagem/test/planilha.test.js
git commit -m "feat: add spreadsheet glue (header mapping, unprocessed rows, write-back, duplicate lookup)"
```

---

## Task 9: Aba de configuração (abas monitoradas + e-mail dos consultores) e notificação

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/config.js`
- Create: `apex-smart-solutions/leads-triagem/src/notificacao.js`
- Manual: criar a aba `Config_Triagem` na planilha (Step 1)

- [ ] **Step 1: Criar manualmente a aba `Config_Triagem` na planilha**, com duas tabelas lado a lado:

  Tabela 1 (colunas A-B, a partir da linha 1):
  | aba_leads | tipo |
  |---|---|
  | LEADS FIBRA CLARO APEX - SETEMBRO | FIBRA |
  | LEADS CLARO B2B APEX - SETEMBRO | MOVEL |

  Tabela 2 (colunas D-E, a partir da linha 1):
  | consultor | email |
  |---|---|
  | Caio | (e-mail real do Caio) |
  | Gabriel | (e-mail real do Gabriel) |
  | Giovanna | (e-mail real da Giovanna) |
  | Manuela | (e-mail real da Manuela) |
  | Rafael | (e-mail real do Rafael) |
  | Victoria | (e-mail real da Victoria) |

  Atualizar essa aba todo mês quando o nome da aba de leads mudar (ex. "...OUTUBRO") — é a única mudança manual mensal necessária, o código não precisa ser tocado.

- [ ] **Step 2: Implementar `src/config.js`** (lê as duas tabelas da aba `Config_Triagem`)

```javascript
function lerAbasMonitoradas(planilha) {
  const aba = planilha.getSheetByName('Config_Triagem');
  if (!aba) throw new Error('Aba Config_Triagem não encontrada — crie antes de rodar (ver Task 9, Step 1).');
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return [];
  const valores = aba.getRange(2, 1, ultimaLinha - 1, 2).getValues();
  return valores
    .filter((linha) => linha[0])
    .map((linha) => ({ nomeAba: linha[0], tipo: linha[1] }));
}

function lerEmailConsultores(planilha) {
  const aba = planilha.getSheetByName('Config_Triagem');
  if (!aba) throw new Error('Aba Config_Triagem não encontrada — crie antes de rodar (ver Task 9, Step 1).');
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return {};
  const valores = aba.getRange(2, 4, ultimaLinha - 1, 2).getValues();
  const mapa = {};
  valores.forEach((linha) => {
    if (linha[0]) mapa[linha[0]] = linha[1];
  });
  return mapa;
}

if (typeof module !== 'undefined') {
  module.exports = { lerAbasMonitoradas, lerEmailConsultores };
}
```

- [ ] **Step 3: Implementar `src/notificacao.js`**

```javascript
function notificarConsultor(email, dadosLead, linkWhatsapp) {
  if (!email) return;
  MailApp.sendEmail({
    to: email,
    subject: `Lead qualificado: ${dadosLead.nome_da_empresa || dadosLead.nome_completo || 'novo lead'}`,
    body:
      `Nome: ${dadosLead.nome_completo || ''}\n` +
      `Empresa: ${dadosLead.nome_da_empresa || ''}\n` +
      `Telefone: ${dadosLead.telefone || dadosLead.phone_number || ''}\n\n` +
      `Mensagem pronta pra abrir no WhatsApp:\n${linkWhatsapp}`,
  });
}

if (typeof module !== 'undefined') {
  module.exports = { notificarConsultor };
}
```

- [ ] **Step 4: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/config.js apex-smart-solutions/leads-triagem/src/notificacao.js
git commit -m "feat: add monitored-tabs config reader and consultant email notification"
```

---

## Task 10: Orquestração principal e instalação do gatilho

**Files:**
- Create: `apex-smart-solutions/leads-triagem/src/main.js`

**Interfaces:**
- Consumes: tudo dos Tasks 2-9 (`limparCnpj`, `classificarRespostaCnpj`, `classificarRespostaViabilidade`, `montarMensagemAbertura`, `montarLinkWhatsapp`, `limparTelefone`, `proximoConsultor`, `consultarCnpj`, `consultarViabilidade`, `mapearCabecalho`, `linhasNaoProcessadas`, `gravarResultado`, `encontrarLeadDuplicado`, `lerAbasMonitoradas`, `lerEmailConsultores`, `notificarConsultor`).
- Produces: `processarNovosLeads()` (função chamada pelo gatilho); `configurarGatilho()` (função de setup, rodada manualmente uma vez pelo Rafael no editor do Apps Script).

- [ ] **Step 1: Implementar `processarNovosLeads`**

```javascript
function processarNovosLeads() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const abasMonitoradas = lerAbasMonitoradas(planilha);
  const emailPorConsultor = lerEmailConsultores(planilha);
  const consultores = Object.keys(emailPorConsultor);

  abasMonitoradas.forEach(({ nomeAba, tipo }) => {
    const aba = planilha.getSheetByName(nomeAba);
    if (!aba) {
      console.warn(`Aba configurada "${nomeAba}" não existe mais na planilha — atualize Config_Triagem.`);
      return;
    }

    const mapaColunas = mapearCabecalho(aba);
    const linhas = linhasNaoProcessadas(aba, mapaColunas);

    linhas.forEach(({ numeroLinha, dados }) => {
      try {
        processarUmaLinha({ aba, mapaColunas, numeroLinha, dados, tipo, consultores, emailPorConsultor });
      } catch (erro) {
        gravarResultado(aba, mapaColunas, numeroLinha, {
          TRIAGEM_STATUS: 'PENDENTE_MANUAL',
          TRIAGEM_CNPJ_DETALHE: `Erro inesperado: ${erro.message}`,
        });
      }
    });
  });
}

function processarUmaLinha({ aba, mapaColunas, numeroLinha, dados, tipo, consultores, emailPorConsultor }) {
  const cnpjTexto = dados['informe_o_seu_cnpj_'] || dados['CNPJ'] || '';
  const cnpjLimpo = limparCnpj(cnpjTexto);
  const telefoneLimpo = limparTelefone(dados['telefone'] || dados['phone_number'] || '');

  if (!cnpjLimpo) {
    gravarResultado(aba, mapaColunas, numeroLinha, {
      TRIAGEM_STATUS: 'PENDENTE_MANUAL',
      TRIAGEM_CNPJ_DETALHE: 'CNPJ ausente ou ilegível no formulário',
    });
    return;
  }

  const duplicata = encontrarLeadDuplicado(aba, mapaColunas, numeroLinha, cnpjLimpo, telefoneLimpo);
  if (duplicata) {
    gravarResultado(aba, mapaColunas, numeroLinha, {
      TRIAGEM_STATUS: 'DUPLICADO',
      TRIAGEM_CNPJ_DETALHE: `Mesmo CNPJ/telefone da linha ${duplicata.numeroLinha}`,
      CONSULTOR_ATRIBUIDO: duplicata.consultor || '',
    });
    return;
  }

  const respostaCnpj = consultarCnpj(cnpjLimpo);
  const cnpjClassificado = classificarRespostaCnpj(respostaCnpj.status, respostaCnpj.corpo);

  if (cnpjClassificado.status === 'ERRO') {
    gravarResultado(aba, mapaColunas, numeroLinha, {
      TRIAGEM_STATUS: 'PENDENTE_MANUAL',
      TRIAGEM_CNPJ_DETALHE: cnpjClassificado.detalhe,
    });
    return;
  }

  if (cnpjClassificado.status === 'INVALIDA') {
    gravarResultado(aba, mapaColunas, numeroLinha, {
      TRIAGEM_STATUS: 'CNPJ_INVALIDO',
      TRIAGEM_CNPJ_DETALHE: cnpjClassificado.detalhe,
    });
    return;
  }

  let viabilidadeDetalhe = 'N/A (linha móvel não depende de viabilidade)';
  if (tipo === 'FIBRA') {
    const cep = dados['informe_o_seu_endereço_com_cep_para_consulta_de_viabilidade_técnica_'] || '';
    const respostaViabilidade = consultarViabilidade(cep);
    const viabilidadeClassificada = classificarRespostaViabilidade(respostaViabilidade.status, respostaViabilidade.corpo);

    if (viabilidadeClassificada.status === 'ERRO') {
      gravarResultado(aba, mapaColunas, numeroLinha, {
        TRIAGEM_STATUS: 'PENDENTE_MANUAL',
        TRIAGEM_CNPJ_DETALHE: cnpjClassificado.detalhe,
        TRIAGEM_VIABILIDADE_DETALHE: viabilidadeClassificada.detalhe,
      });
      return;
    }
    if (viabilidadeClassificada.status === 'SEM_VIABILIDADE') {
      gravarResultado(aba, mapaColunas, numeroLinha, {
        TRIAGEM_STATUS: 'SEM_VIABILIDADE',
        TRIAGEM_CNPJ_DETALHE: cnpjClassificado.detalhe,
        TRIAGEM_VIABILIDADE_DETALHE: viabilidadeClassificada.detalhe,
      });
      return;
    }
    viabilidadeDetalhe = viabilidadeClassificada.detalhe;
  }

  const ultimoIndice = Number(PropertiesService.getScriptProperties().getProperty('ULTIMO_INDICE_CONSULTOR') || -1);
  const { consultor, novoIndice } = proximoConsultor(consultores, ultimoIndice);
  PropertiesService.getScriptProperties().setProperty('ULTIMO_INDICE_CONSULTOR', String(novoIndice));

  const mensagem = montarMensagemAbertura({
    nome: dados['nome_completo'] || '',
    empresa: dados['nome_da_empresa'] || '',
  });
  const linkWhatsapp = montarLinkWhatsapp(dados['telefone'] || dados['phone_number'] || '', mensagem);

  gravarResultado(aba, mapaColunas, numeroLinha, {
    TRIAGEM_STATUS: 'QUALIFICADO',
    TRIAGEM_CNPJ_DETALHE: cnpjClassificado.detalhe,
    TRIAGEM_VIABILIDADE_DETALHE: viabilidadeDetalhe,
    CONSULTOR_ATRIBUIDO: consultor,
    LINK_WHATSAPP: linkWhatsapp,
  });

  notificarConsultor(emailPorConsultor[consultor], dados, linkWhatsapp);
}

if (typeof module !== 'undefined') {
  module.exports = { processarNovosLeads, processarUmaLinha };
}
```

- [ ] **Step 2: Implementar `configurarGatilho`** (função de setup — Rafael roda ela **uma única vez** pelo editor do Apps Script; instala o gatilho de tempo)

```javascript
function configurarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'processarNovosLeads')
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processarNovosLeads')
    .timeBased()
    .everyMinutes(1)
    .create();
}
```

- [ ] **Step 3: Commit**

```bash
git add apex-smart-solutions/leads-triagem/src/main.js
git commit -m "feat: wire triage pipeline together and add trigger installer"
```

---

## Task 11: Deploy via clasp e piloto (manual — Rafael)

Nenhum destes passos pode ser feito por um assistente de IA: exigem login OAuth do Google e acesso à conta que é dona da planilha.

- [ ] **Step 1: Instalar o clasp**

Run: `npm install -g @google/clasp`

- [ ] **Step 2: Login no Google**

Run: `clasp login` (abre o navegador — logar com a conta Google dona da planilha de leads)

- [ ] **Step 3: Habilitar a API do Apps Script** em https://script.google.com/home/usersettings (alternar para "Ligado")

- [ ] **Step 4: Criar o projeto Apps Script vinculado à planilha**

Run (dentro de `apex-smart-solutions/leads-triagem`): `clasp create --type sheets --parentId <ID_DA_PLANILHA> --rootDir ./src`

(o `<ID_DA_PLANILHA>` é o trecho entre `/d/` e `/edit` na URL da planilha de leads)

- [ ] **Step 5: Publicar o código**

Run: `clasp push`

- [ ] **Step 6: Criar a aba `Config_Triagem`** na planilha, seguindo exatamente o Task 9 Step 1 (com os e-mails reais dos consultores).

- [ ] **Step 7: Rodar `configurarGatilho` uma vez manualmente**: abrir `clasp open`, escolher a função `configurarGatilho` no seletor de funções do editor, clicar em Executar, autorizar as permissões pedidas (acesso à planilha, a URLs externas e a envio de e-mail).

- [ ] **Step 8: Piloto em uma aba só** — antes de confiar 100%, deixe só uma linha em `Config_Triagem` (ex.: só a aba de Fibra) por um dia, conferindo manualmente se a classificação bate com a realidade de cada lead novo, antes de adicionar a aba Móvel.

- [ ] **Step 9: Adicionar a segunda aba em `Config_Triagem`** depois que o piloto confirmar que está classificando certo, e acompanhar o `TRIAGEM_STATUS` de cada lead novo por mais alguns dias antes de considerar estável.
