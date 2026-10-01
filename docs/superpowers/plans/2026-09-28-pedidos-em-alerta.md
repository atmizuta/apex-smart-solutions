# Pedidos em Alerta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar a aba "Pedidos em Alerta" no Dashboard de Produção (só admin/supervisor). Ela lista os pedidos parados há 3 dias úteis ou mais em Antifraude, Portabilidade (andamento/tratativa) e Entrega, com três níveis de cor, e exporta um Excel colorido para o back office.

**Architecture:** todo o código novo fica no dashboard embutido (HTML em base64 dentro de `_template.html`, constante `PRODUCAO_DASHBOARD_TPL_B64`), editado via `python dashboard_tpl.py extrair|empacotar`. A regra fica em funções puras (`diasUteisDesde`, `nivelAlerta`, `montarPedidosEmAlerta`, `resumirAlertas`, `filtrarAlertas`) que usam os dados `DATA` já carregados no iframe. A tela e o Excel usam só essas funções. O painel externo muda em um ponto: o timer de 1h passa também o "Atualizado em". O Excel usa a ExcelJS 4.4.0, carregada do cdnjs só no clique.

**Tech Stack:** HTML/CSS/JS puro (sem build), SheetJS já existente (não tocado), ExcelJS 4.4.0 (CDN no navegador, npm `exceljs` só nos testes), testes em Node + jsdom, rodados por `bash run_tests.sh`.

**Spec:** `docs/superpowers/specs/2026-09-28-pedidos-em-alerta-design.md`

## Global Constraints

- Repositório oficial: `https://github.com/atmizuta/apex-smart-solutions` (remote local `oficial`). Ramo de trabalho: `feature/pedidos-em-alerta`. Worktree: `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\pedidos-em-alerta`. **Todos os comandos rodam nessa pasta.**
- **Repositório público:** nenhum dado real de cliente (nome, CPF/CNPJ, nº de pedido real) em código, teste, commit ou doc. Fixtures só com dados fictícios. A planilha real fica fora do git (`ExportacaoProducao*.xlsx` já está no `.gitignore`).
- Siga o `CLAUDE.md` do repositório:
  - edite só o `_template.html` (o `painel_clientes_apex.html` é gerado por `python build_painel.py`);
  - não mexa no bloco `<style>` "SISTEMA VISUAL SINAL DE ÁPICE", no menu lateral nem em `ApexMotion`/`mostrarAviso`/`fecharOverlay` do painel externo;
  - cores por variável.
- Dashboard embutido: **sempre** `python dashboard_tpl.py extrair` antes de editar `_dashboard_producao.html` (arquivo temporário, ignorado no git) e `python dashboard_tpl.py empacotar` depois de cada edição e antes de rodar qualquer teste. Os testes leem o `_template.html`.
- Etapas monitoradas, exatamente estas strings: `ENTREGA (NEOCRM)`, `ANTIFRAUDE (NEOCRM)`, `PORTABILIDADE EM ANDAMENTO (NEOCRM)`, `PORTABILIDADE EM TRATATIVA (NEOCRM)`, nessa ordem de exibição.
- Faixas em dias úteis: `< 3` sem alerta · `3–5` `minimo` (MÍNIMO, 🟡) · `6–9` `medio` (MÉDIO, 🟠) · `>= 10` `maximo` (MÁXIMO, 🔴).
- Dias úteis: seg–sex sem feriados nacionais (`isHoliday`/`isWeekend` que já existem), contando os dias **depois** da data da atualização até a data de referência **inclusive**. Datas no fuso de São Paulo.
- Data de referência: a data do texto "Atualizado em: dd/mm/aaaa, hh:mm:ss" do topo do dashboard. Se não der para ler, usa hoje em São Paulo e avisa na tela.
- A aba só existe com `ADMIN_MODE === true` (admin e supervisor). Com `false`, nem o botão nem o painel ficam no DOM.
- Excel:
  - arquivo `PedidosEmAlerta_<aaaa-mm-dd da referência>.xlsx`;
  - abas `Pedidos em Alerta` e `Resumo`;
  - na primeira aba, título na linha 1, legenda/filtros na linha 2, cabeçalho na linha 3 (com filtro automático e congelado) e dados da linha 4 em diante;
  - cores ARGB: máximo `FFC1050F`/`FFFFC7CE`, médio `FFF97316`/`FFFFD8B0`, mínimo `FFEAB308`/`FFFFF2A8`, cabeçalho `FF1D1F20`.
- Mensagens de commit terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Depois de cada commit: `git push oficial feature/pedidos-em-alerta` (pedido do usuário: sempre subir no repositório oficial). **Nunca** fazer push no `main` nem publicar em apexsmart.com.br sem o OK explícito do usuário.

## Review Focus

- **Datas vindas do Supabase em UTC** (`"2026-09-22T01:30:00+00:00"`, que é 21/09 22:30 em São Paulo) precisam contar pelo dia de São Paulo, não pelo dia UTC. O teste está na Task 2 (pedido `U1`).
- **`numero_pedido` numérico e texto misturados** (`123` e `"123"`) precisam virar 1 pedido só. O teste está na Task 2.
- **Pedido muito antigo** (atualização de 2024) precisa dar um número grande de dias rapidamente, sem travar a tela. O teste está na Task 2.
- **Nome de cliente/produto com `<`, `&` e aspas** precisa aparecer como texto, não como HTML. O teste está na Task 3.
- **Consultor filtrado que some depois da atualização de 1h** precisa fazer o filtro voltar para "Todos", em vez de deixar a tabela vazia sem explicação. O teste está na Task 3.

---

### Task 1: Base sincronizada com o painel publicado (28/09)

O `main` oficial (`f80da04`) não tem o commit publicado em apexsmart.com.br às 19:24 de 28/09 (`d7f8140` do repositório antigo `rafaangelao/apex-smart-solutions`, pasta `crm/`, já disponível no git local): dashboard mobile, cores de status, acentos, card "Claro Monitor" e "Linhas" só de voz. O painel no ar é idêntico a esse commit. Esta task junta os dois sem perder nada do oficial.

**Files:**
- Modify: `_template.html` (substituído pela versão de `d7f8140`, um superconjunto verificado do oficial)
- Modify: `painel_clientes_apex.html` (regenerado)
- Modify: `test_visao_diaria.js` (patch das mudanças de 28/09 sobre a versão oficial)
- Modify: `package.json`/`package-lock.json` só se o `npm install` mudar algo; nesse caso, **não** commitar mudanças não relacionadas.

**Interfaces:**
- Consumes: nada.
- Produces: ramo com a mesma base do painel no ar e a suíte rodando. As tasks seguintes contam com a paleta `--andamento:#EAB308` / `--devolvido:#F97316` no CSS do dashboard embutido.

- [ ] **Step 1: Instalar as dependências dos testes (CLAUDE.md: jsdom, jspdf, jszip, xlsx, papaparse)**

```bash
npm install
npm install --no-save xlsx@0.18.5 jszip papaparse
```
Expected: `node_modules/` criado (ignorado no git). `git status --short` não mostra `package.json` alterado.

- [ ] **Step 2: Rodar a suíte na base oficial e anotar o resultado (linha de base)**

```bash
bash run_tests.sh
```
Expected: `TOTAL: X passaram, 0 falharam, Y pulados`. Os pulados são os testes com planilhas reais ausentes. Se houver falhas **já na base**, anote os nomes: elas não são desta tarefa e devem ser relatadas ao usuário no fim, sem corrigir.
Depois: `git checkout -- painel_clientes_apex.html` (o build pode ter reescrito o arquivo gerado).

- [ ] **Step 3: Trazer `_template.html` de 28/09**

```bash
git show d7f8140:crm/_template.html > _template.html
```
Verifique que, fora do base64, só mudaram as cores de status:
```bash
diff <(git show oficial/main:_template.html | tr -d '\r' | grep -v PRODUCAO_DASHBOARD_TPL_B64) <(tr -d '\r' < _template.html | grep -v PRODUCAO_DASHBOARD_TPL_B64)
```
Expected: exatamente 2 linhas trocadas (`--st-andamento` e `--st-devolvido`: `#1D1F20`→`#B45309` e `#8E0B1B`→`#C2410C`, mais os `-bg`).
Confira também que o dashboard embutido novo mantém o ranking por receita do oficial:
```bash
python dashboard_tpl.py extrair && grep -c "receita" _dashboard_producao.html
```
Expected: número ≥ 1 (o oficial tem 5 ocorrências e a versão de 28/09 também).

- [ ] **Step 4: Aplicar as mudanças de 28/09 no teste da Visão Diária**

```bash
git diff d7f8140~1 d7f8140 -- crm/test_visao_diaria.js > /tmp/tvd.patch
git apply -p2 --ignore-whitespace --reject /tmp/tvd.patch
```
Expected: o hunk #9 é rejeitado, porque o oficial já tem essa mudança. Confirme:
```bash
grep -n "consultorHtmlMulti.includes('2 produto')" test_visao_diaria.js
```
Expected: 1 ocorrência. Então apague a sobra: `rm -f test_visao_diaria.js.rej /tmp/tvd.patch`.

- [ ] **Step 5: Regenerar o painel e comparar com o que está no ar**

```bash
python build_painel.py
diff <(tr -d '\r' < painel_clientes_apex.html) <(git show d7f8140:crm/painel_clientes_apex.html | tr -d '\r') && echo IGUAL-AO-PUBLICADO
```
Expected: `IGUAL-AO-PUBLICADO`.

- [ ] **Step 6: Rodar a suíte inteira**

```bash
bash run_tests.sh
```
Expected: `0 falharam` (ou exatamente as mesmas falhas pré-existentes do Step 2). `test_visao_diaria.js` precisa passar.

- [ ] **Step 7: Commit + push**

```bash
git add _template.html painel_clientes_apex.html test_visao_diaria.js
git commit -m "sync: junta a versão publicada em 28/09 (dashboard mobile, cores de status, Claro Monitor)

O painel no ar em apexsmart.com.br era o commit d7f8140 do repositório antigo,
que não tinha chegado ao main oficial (CLAUDE.md regra 3: juntar, nunca sobrescrever).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```

---

### Task 2: Regra de cálculo (funções puras)

**Files:**
- Modify: `_template.html` (via `_dashboard_producao.html`), bloco novo de JS logo **antes** da linha `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`
- Create: `test_pedidos_alerta.js`

**Interfaces:**
- Consumes (já existem no dashboard): `spParts(iso) -> {date:'aaaa-mm-dd', hour} | null`, `isHoliday('aaaa-mm-dd')`, `isWeekend('aaaa-mm-dd')`, `fromISO('aaaa-mm-dd') -> Date` (local), `toISO(Date) -> 'aaaa-mm-dd'`.
- Produces:
  - `ALERTA_ETAPAS: string[]` (4 etapas, na ordem de exibição)
  - `ALERTA_FAIXAS = { minimo: 3, medio: 6, maximo: 10 }`
  - `ALERTA_NIVEIS = ['maximo','medio','minimo']`
  - `ALERTA_ROTULO = { minimo:'MÍNIMO', medio:'MÉDIO', maximo:'MÁXIMO' }`
  - `parseDataReferencia(texto) -> {date:'aaaa-mm-dd', hora:'hh:mm'|null} | null`
  - `diasUteisDesde(dataIni:'aaaa-mm-dd', dataRef:'aaaa-mm-dd') -> number`
  - `nivelAlerta(dias) -> 'minimo'|'medio'|'maximo'|null`
  - `montarPedidosEmAlerta(dados:Array<registro>, dataRef:'aaaa-mm-dd') -> Array<PedidoAlerta>`. `PedidoAlerta = {numero_pedido, cliente, cnpj, usuario, grupo, etapa, produtos, qtd, valor, cadastro, atualizacao, dias, nivel}`, ordenado por dias desc → posição da etapa em `ALERTA_ETAPAS` → nº do pedido.
  - `resumirAlertas(lista) -> { porEtapa: {[etapa]: {minimo,medio,maximo,total}}, total: {minimo,medio,maximo,total} }`
  - `filtrarAlertas(lista, {etapa, nivel, consultor}) -> lista` (string vazia = sem filtro)

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `test_pedidos_alerta.js`:

```js
// Testa a aba "Pedidos em Alerta" do Dashboard de Produção (28/09/2026, REGRAS_NEGOCIO.md seção 46).
// Mesma técnica de test_visao_diaria.js: decodifica o template embutido de verdade
// (PRODUCAO_DASHBOARD_TPL_B64), preenche os placeholders com dados FICTÍCIOS e roda o script real num
// jsdom. Nenhum dado real de cliente aqui — o repositório é público.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');
const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script do template embutido nao encontrado'); process.exit(1); }
const jsOriginal = scriptMatch[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// Monta o dashboard num jsdom novo. updatedAt imita o texto que o upload grava em config.
function montarDashboard({ adminMode = true, updatedAt = '28/09/2026, 20:12:03', data = [] } = {}){
  const html = htmlNoScript
    .replace('__ADMIN_BADGE__', '')
    .replace('__APEX_B64__', '')
    .replace('__CLARO_B64__', '')
    .replace('__UPDATED_AT__', updatedAt);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  const js = jsOriginal
    .replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';')
    .replace('__ADMIN_MODE__', adminMode ? 'true' : 'false');
  w.eval(js);
  return w;
}

// Registro no formato de producao_pedidos (dados fictícios). Referência dos testes: seg 28/09/2026.
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'ENTREGA (NEOCRM)',
  cadastro: '2026-09-01T10:00:00-03:00', atualizacao: '2026-09-28T10:00:00-03:00',
  valor: 50, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: '11111111000100', tag: null,
}, over); }

const FIXTURE = [
  ped({ numero_pedido: 'A1', atualizacao: '2026-09-25T10:00:00-03:00' }),                                        // sex → 1 d.u. (fora)
  ped({ numero_pedido: 'A7', atualizacao: '2026-09-24T10:00:00-03:00' }),                                        // qui → 2 d.u. (fora)
  ped({ numero_pedido: 'A2', atualizacao: '2026-09-23T10:00:00-03:00', usuario: 'Caio' }),                       // qua → 3 (mínimo)
  ped({ numero_pedido: 'A8', etapa: 'ANTIFRAUDE (NEOCRM)', atualizacao: '2026-09-21T10:00:00-03:00', usuario: 'Giovanna' }), // 5 (mínimo)
  ped({ numero_pedido: 'A3', etapa: 'ANTIFRAUDE (NEOCRM)', atualizacao: '2026-09-18T10:00:00-03:00', usuario: 'Giovanna' }), // 6 (médio)
  ped({ numero_pedido: 'A5', etapa: 'PORTABILIDADE EM TRATATIVA (NEOCRM)', atualizacao: '2026-09-15T10:00:00-03:00', usuario: 'Vitor' }), // 9 (médio)
  ped({ numero_pedido: 'A4', etapa: 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', atualizacao: '2026-09-14T10:00:00-03:00', usuario: 'Caio' }), // 10 (máximo)
  // pedido com 3 linhas: vale a atualização MAIS RECENTE (02/09, qua; 07/09 é feriado) → 17 d.u. (máximo)
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-01T09:00:00-03:00', cadastro: '2026-08-20T08:00:00-03:00', valor: 10, quantidade: 1, produto: 'Plano B', cnpj: '00123456000190' }),
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-02T15:45:00-03:00', cadastro: '2026-08-21T08:00:00-03:00', valor: 20, quantidade: 2, produto: 'Plano A', cnpj: '00123456000190' }),
  ped({ numero_pedido: 'M1', atualizacao: '2026-09-01T09:00:00-03:00', cadastro: '2026-08-22T08:00:00-03:00', valor: 30, quantidade: 3, produto: 'Plano A', cnpj: '00123456000190' }),
  // UTC: 22/09 01:30Z = 21/09 22:30 em São Paulo → conta a partir de 21/09 → 5 d.u. (mínimo). Pelo dia UTC daria 4.
  ped({ numero_pedido: 'U1', atualizacao: '2026-09-22T01:30:00+00:00', usuario: 'Vitor' }),
  // ignorados:
  ped({ numero_pedido: 'X1', etapa: 'CONCLUIDO (NEOCRM)', atualizacao: '2026-08-01T10:00:00-03:00' }),        // etapa fora da lista
  ped({ numero_pedido: null, atualizacao: '2026-08-01T10:00:00-03:00' }),                                       // sem nº de pedido
  ped({ numero_pedido: 'N1', atualizacao: null }),                                                             // sem atualização
];

// ---------------- Task 2: regra ----------------
{
  const w = montarDashboard({ data: FIXTURE });

  // parseDataReferencia
  const r1 = w.parseDataReferencia('28/09/2026, 20:12:03');
  assert(r1 && r1.date === '2026-09-28' && r1.hora === '20:12', 'parseDataReferencia lê "dd/mm/aaaa, hh:mm:ss" → ' + JSON.stringify(r1));
  const r2 = w.parseDataReferencia('Atualizado em: 28/09/2026 20:12:03');
  assert(r2 && r2.date === '2026-09-28' && r2.hora === '20:12', 'parseDataReferencia aceita prefixo e ausência de vírgula');
  assert(w.parseDataReferencia('—') === null, 'parseDataReferencia("—") → null');
  assert(w.parseDataReferencia('') === null, 'parseDataReferencia("") → null');

  // diasUteisDesde
  assert(w.diasUteisDesde('2026-09-25', '2026-09-28') === 1, 'sexta → segunda = 1 dia útil');
  assert(w.diasUteisDesde('2026-09-26', '2026-09-28') === 1, 'sábado → segunda = 1 (fim de semana não conta)');
  assert(w.diasUteisDesde('2026-09-04', '2026-09-09') === 2, '04/09 → 09/09 = 2 (07/09 é feriado)');
  assert(w.diasUteisDesde('2026-09-28', '2026-09-28') === 0, 'mesmo dia = 0');
  assert(w.diasUteisDesde('2026-09-29', '2026-09-28') === 0, 'referência anterior à atualização = 0');
  assert(w.diasUteisDesde('2026-12-30', '2027-01-04') === 2, '30/12 → 04/01 = 2 (01/01 feriado, fim de semana no meio)');
  const t0 = Date.now();
  const antigo = w.diasUteisDesde('2024-01-02', '2026-09-28');
  assert(antigo > 600 && Date.now() - t0 < 500, 'pedido de 2024 dá muitos dias úteis e calcula rápido (' + antigo + ', ' + (Date.now() - t0) + 'ms)');

  // nivelAlerta nas fronteiras
  [[0, null], [2, null], [3, 'minimo'], [5, 'minimo'], [6, 'medio'], [9, 'medio'], [10, 'maximo'], [40, 'maximo']].forEach(([d, esperado]) => {
    assert(w.nivelAlerta(d) === esperado, 'nivelAlerta(' + d + ') === ' + esperado + ' (veio ' + w.nivelAlerta(d) + ')');
  });

  // montarPedidosEmAlerta
  const lista = w.montarPedidosEmAlerta(FIXTURE, '2026-09-28');
  const ids = lista.map(p => p.numero_pedido);
  assert(JSON.stringify(ids) === JSON.stringify(['M1', 'A4', 'A5', 'A3', 'U1', 'A8', 'A2']),
    'lista na ordem dias desc → etapa (Entrega antes de Antifraude no empate) → nº: ' + JSON.stringify(ids));
  const m1 = lista.find(p => p.numero_pedido === 'M1');
  assert(m1.dias === 17 && m1.nivel === 'maximo', 'M1 usa a atualização mais recente (02/09) → 17 d.u. máximo (veio ' + m1.dias + ')');
  assert(m1.qtd === 6 && m1.valor === 60, 'M1 soma quantidade (6) e valor (60)');
  assert(m1.produtos === 'Plano A + Plano B', 'M1 lista produtos distintos em ordem: ' + m1.produtos);
  assert(m1.cadastro === '2026-08-20T08:00:00-03:00', 'M1 usa o cadastro mais antigo');
  assert(m1.atualizacao === '2026-09-02T15:45:00-03:00', 'M1 guarda a atualização mais recente');
  assert(m1.cnpj === '00123456000190', 'CNPJ preserva zeros à esquerda');
  const u1 = lista.find(p => p.numero_pedido === 'U1');
  assert(u1 && u1.dias === 5, 'U1 (UTC 22/09 01:30 = 21/09 em SP) conta 5 d.u. pelo dia de São Paulo (veio ' + (u1 && u1.dias) + ')');
  assert(!ids.includes('A1') && !ids.includes('A7'), 'pedidos com 1 e 2 dias úteis ficam de fora');
  assert(!ids.includes('X1') && !ids.includes('N1') && !ids.includes(null), 'etapa fora da lista, sem nº e sem atualização são ignorados');

  // numero_pedido numérico e texto viram 1 pedido só
  const misto = w.montarPedidosEmAlerta([
    ped({ numero_pedido: 123, atualizacao: '2026-09-01T10:00:00-03:00', quantidade: 1 }),
    ped({ numero_pedido: '123', atualizacao: '2026-09-01T10:00:00-03:00', quantidade: 2 }),
  ], '2026-09-28');
  assert(misto.length === 1 && misto[0].qtd === 3 && misto[0].numero_pedido === '123', 'nº 123 (número) e "123" (texto) são o mesmo pedido');

  // resumirAlertas
  const res = w.resumirAlertas(lista);
  const ent = res.porEtapa['ENTREGA (NEOCRM)'];
  assert(ent.minimo === 2 && ent.medio === 0 && ent.maximo === 1 && ent.total === 3, 'Entrega: 2 mín, 0 méd, 1 máx: ' + JSON.stringify(ent));
  const anti = res.porEtapa['ANTIFRAUDE (NEOCRM)'];
  assert(anti.minimo === 1 && anti.medio === 1 && anti.maximo === 0 && anti.total === 2, 'Antifraude: 1 mín, 1 méd: ' + JSON.stringify(anti));
  assert(res.porEtapa['PORTABILIDADE EM ANDAMENTO (NEOCRM)'].maximo === 1, 'Port. andamento: 1 máx');
  assert(res.porEtapa['PORTABILIDADE EM TRATATIVA (NEOCRM)'].medio === 1, 'Port. tratativa: 1 méd');
  assert(JSON.stringify(res.total) === JSON.stringify({ minimo: 3, medio: 2, maximo: 2, total: 7 }), 'total geral 3/2/2 = 7: ' + JSON.stringify(res.total));

  // filtrarAlertas
  assert(w.filtrarAlertas(lista, { etapa: '', nivel: '', consultor: '' }).length === 7, 'sem filtro = 7');
  assert(w.filtrarAlertas(lista, { etapa: 'ENTREGA (NEOCRM)', nivel: 'minimo', consultor: '' }).length === 2, 'Entrega + mínimo = 2');
  assert(w.filtrarAlertas(lista, { etapa: '', nivel: 'maximo', consultor: 'Caio' }).length === 2, 'máximo + Caio = 2 (M1, A4)');
}

console.log('--- test_pedidos_alerta RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_pedidos_alerta.js`
Expected: FAIL, com `TypeError: w.parseDataReferencia is not a function`.

- [ ] **Step 3: Implementar**

```bash
python dashboard_tpl.py extrair
```
Em `_dashboard_producao.html`, insira **imediatamente antes** da linha
`// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// ---------- PEDIDOS EM ALERTA (28/09/2026) — ver REGRAS_NEGOCIO.md seção 46 ----------
// Pedidos que já viraram venda mas estão parados em etapas pós-venda do NeoCRM. O tempo parado é
// contado em DIAS ÚTEIS (seg–sex, sem feriados nacionais — isHoliday/isWeekend acima) desde a data da
// última ATUALIZACAO até a data da última subida da planilha ("Atualizado em" do topo), não até o
// relógio de quem abre a tela: assim a contagem reflete exatamente a foto que o NeoCRM mandou.
// Decisões do usuário em 28/09/2026 (spec docs/superpowers/specs/2026-09-28-pedidos-em-alerta-design.md).
const ALERTA_ETAPAS = ['ENTREGA (NEOCRM)', 'ANTIFRAUDE (NEOCRM)', 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'PORTABILIDADE EM TRATATIVA (NEOCRM)'];
const ALERTA_FAIXAS = { minimo: 3, medio: 6, maximo: 10 };
const ALERTA_NIVEIS = ['maximo', 'medio', 'minimo'];
const ALERTA_ROTULO = { minimo: 'MÍNIMO', medio: 'MÉDIO', maximo: 'MÁXIMO' };

// "28/09/2026, 20:12:03" (formato gravado pelo upload) → { date: '2026-09-28', hora: '20:12' }.
function parseDataReferencia(texto){
  const m = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/);
  if(!m) return null;
  return { date: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4]}:${m[5]}` : null };
}

// Dias úteis DEPOIS de dataIni até dataRef (inclusive). Ex.: sex 25/09 → seg 28/09 = 1.
function diasUteisDesde(dataIni, dataRef){
  if(!dataIni || !dataRef || dataRef <= dataIni) return 0;
  const d = fromISO(dataIni);
  let n = 0;
  for(;;){
    d.setDate(d.getDate() + 1);
    const iso = toISO(d);
    if(iso > dataRef) break;
    if(!isWeekend(iso) && !isHoliday(iso)) n++;
  }
  return n;
}

function nivelAlerta(dias){
  if(dias >= ALERTA_FAIXAS.maximo) return 'maximo';
  if(dias >= ALERTA_FAIXAS.medio) return 'medio';
  if(dias >= ALERTA_FAIXAS.minimo) return 'minimo';
  return null;
}

// Agrupa as linhas por pedido (uma linha por produto na exportação do NeoCRM) e devolve só os que
// estão em alerta, do mais parado pro menos parado.
function montarPedidosEmAlerta(dados, dataRef){
  const porPedido = new Map();
  (dados || []).forEach(r => {
    if(!r || ALERTA_ETAPAS.indexOf(r.etapa) < 0) return;
    const num = r.numero_pedido == null ? '' : String(r.numero_pedido).trim();
    if(!num) return;
    if(!porPedido.has(num)) porPedido.set(num, []);
    porPedido.get(num).push(r);
  });
  const texto = (linhas, campo) => {
    const r = linhas.find(x => x[campo] != null && String(x[campo]).trim() !== '');
    return r ? String(r[campo]) : '';
  };
  const lista = [];
  porPedido.forEach((linhas, num) => {
    const comData = linhas.filter(r => spParts(r.atualizacao));
    if(comData.length === 0) return;
    const ultima = comData.reduce((a, b) => new Date(b.atualizacao) > new Date(a.atualizacao) ? b : a);
    const dias = diasUteisDesde(spParts(ultima.atualizacao).date, dataRef);
    const nivel = nivelAlerta(dias);
    if(!nivel) return;
    const cadastros = linhas.map(r => r.cadastro).filter(c => spParts(c)).sort((a, b) => new Date(a) - new Date(b));
    const produtos = [...new Set(linhas.map(r => r.produto).filter(p => p != null && String(p).trim() !== '').map(String))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    lista.push({
      numero_pedido: num,
      cliente: texto(linhas, 'cliente'),
      cnpj: texto(linhas, 'cnpj'),
      usuario: texto(linhas, 'usuario'),
      grupo: texto(linhas, 'grupo'),
      etapa: ultima.etapa,
      produtos: produtos.join(' + '),
      qtd: linhas.reduce((s, r) => s + (Number(r.quantidade) || 0), 0),
      valor: linhas.reduce((s, r) => s + (Number(r.valor) || 0), 0),
      cadastro: cadastros[0] || null,
      atualizacao: ultima.atualizacao,
      dias,
      nivel,
    });
  });
  lista.sort((a, b) => (b.dias - a.dias)
    || (ALERTA_ETAPAS.indexOf(a.etapa) - ALERTA_ETAPAS.indexOf(b.etapa))
    || a.numero_pedido.localeCompare(b.numero_pedido, 'pt-BR'));
  return lista;
}

function resumirAlertas(lista){
  const vazio = () => ({ minimo: 0, medio: 0, maximo: 0, total: 0 });
  const porEtapa = {};
  ALERTA_ETAPAS.forEach(e => { porEtapa[e] = vazio(); });
  const total = vazio();
  (lista || []).forEach(p => {
    const e = porEtapa[p.etapa];
    if(!e) return;
    e[p.nivel]++; e.total++;
    total[p.nivel]++; total.total++;
  });
  return { porEtapa, total };
}

function filtrarAlertas(lista, f){
  return (lista || []).filter(p => (!f.etapa || p.etapa === f.etapa)
    && (!f.nivel || p.nivel === f.nivel)
    && (!f.consultor || p.usuario === f.consultor));
}

```

```bash
python dashboard_tpl.py empacotar
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_pedidos_alerta.js`
Expected: `--- test_pedidos_alerta RESULTADO: N passaram, 0 falharam ---`.
Run também: `node test_visao_diaria.js` e `node test_dashboard_producao.js`. Expected: 0 falhas (o segundo pode imprimir `PULADO:`).

- [ ] **Step 5: Commit + push**

```bash
python build_painel.py
git add _template.html painel_clientes_apex.html test_pedidos_alerta.js
git commit -m "feat(alertas): regra de dias úteis e níveis dos Pedidos em Alerta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```

---

### Task 3: Aba "Pedidos em Alerta" (tela, filtros, atualização de hora em hora)

**Files:**
- Modify: `_template.html` (via `_dashboard_producao.html`): CSS, painel HTML, JS de tela, `switchTab`, `window.atualizarDadosDashboard`, inicialização.
- Modify: `_template.html` (painel externo): timer de 1h em `loadProducaoDashboard()`.
- Modify: `test_visao_diaria.js:33` (a asserção da chamada `atualizarDadosDashboard(novos)` passa a aceitar o 2º argumento).
- Test: `test_pedidos_alerta.js` (bloco novo).

**Interfaces:**
- Consumes (Task 2): `ALERTA_ETAPAS`, `ALERTA_FAIXAS`, `ALERTA_NIVEIS`, `ALERTA_ROTULO`, `parseDataReferencia`, `montarPedidosEmAlerta`, `resumirAlertas`, `filtrarAlertas`. Do dashboard: `DATA`, `ADMIN_MODE`, `spParts`, `shortEtapa`, `fmtBRL`, `fmtDate`, `fmtDateOnly`, `escAttr`, `unique`.
- Produces:
  - `let ALERTA_FILTRO = {etapa, nivel, consultor}`
  - `let ALERTA_LISTA` (a lista montada)
  - `let ALERTA_REF = {date, hora, desconhecida}`
  - `escHtml(s)`, `obterReferenciaAlertas()`, `renderPedidosAlerta()`, `renderTabelaAlertas()`, `preencherFiltrosAlerta()`, `onFiltroAlerta()`, `limparFiltrosAlerta()`, `filtroTextoAlertas(f) -> string`
  - `window.atualizarDadosDashboard(novosDados, novoAtualizadoEm?)`
  - Botão `#alertaExportBtn` com `onclick="exportarAlertasExcel()"`. A função é criada na Task 4. Até lá, o clique só dá erro no console.
  - DOM ids: `tabAlertas`, `alertaSub`, `alertaCards`, `alertaMatriz`, `alertaFiltroEtapa`, `alertaFiltroNivel`, `alertaFiltroConsultor`, `alertaExportBtn`, `alertaMsg`, `alertaBody`.

- [ ] **Step 1: Escrever o teste da tela (falhando)**

Em `test_pedidos_alerta.js`, insira **antes** da linha `console.log('--- test_pedidos_alerta RESULTADO:'`:

```js
// ---------------- Task 3: tela ----------------
{
  // consultor (ADMIN_MODE=false): a aba não existe
  const wc = montarDashboard({ adminMode: false, data: FIXTURE });
  assert(!wc.document.querySelector('.tab-btn[data-tab="alertas"]'), 'consultor: botão da aba não existe');
  assert(!wc.document.getElementById('tabAlertas'), 'consultor: painel #tabAlertas não existe no DOM');

  const w = montarDashboard({ data: FIXTURE });
  const d = w.document;
  const btn = d.querySelector('.tab-btn[data-tab="alertas"]');
  assert(btn && btn.textContent.trim() === 'Pedidos em Alerta', 'admin: botão "Pedidos em Alerta" existe');
  w.switchTab('alertas');
  assert(d.getElementById('tabAlertas').classList.contains('active'), 'switchTab("alertas") ativa o painel');
  assert(d.body.classList.contains('tab-alertas'), 'switchTab("alertas") põe a classe tab-alertas no body (esconde a barra de filtros)');
  w.switchTab('overview');
  assert(!d.body.classList.contains('tab-alertas'), 'voltar pra Visão Geral tira a classe tab-alertas');
  w.switchTab('alertas');

  const valorCard = (k) => (d.querySelector('.alerta-card-' + k + ' .value') || {}).textContent;
  assert(valorCard('total') === '7' && valorCard('maximo') === '2' && valorCard('medio') === '2' && valorCard('minimo') === '3',
    'placar 7 / 2 máx / 2 méd / 3 mín: ' + [valorCard('total'), valorCard('maximo'), valorCard('medio'), valorCard('minimo')].join('/'));
  assert(d.getElementById('alertaSub').textContent.includes('base de 28/09/2026 20:12'), 'subtítulo mostra a data da base: ' + d.getElementById('alertaSub').textContent);

  const linhas = () => [...d.querySelectorAll('#alertaBody tr')];
  const pedidos = () => linhas().map(tr => tr.dataset.pedido);
  assert(JSON.stringify(pedidos()) === JSON.stringify(['M1', 'A4', 'A5', 'A3', 'U1', 'A8', 'A2']), 'tabela na ordem certa: ' + JSON.stringify(pedidos()));
  assert(linhas()[0].classList.contains('alerta-maximo') && linhas()[2].classList.contains('alerta-medio') && linhas()[6].classList.contains('alerta-minimo'),
    'linhas com a classe de cor do nível');
  assert(linhas()[0].textContent.includes('MÁXIMO') && linhas()[0].textContent.includes('00123456000190') && linhas()[0].textContent.includes('Plano A + Plano B'),
    'linha mostra selo, CNPJ (admin) e produtos');

  // clique na matriz: Entrega × Mínimo
  const link = d.querySelector('#alertaMatriz a[data-etapa="ENTREGA (NEOCRM)"][data-nivel="minimo"]');
  assert(link && link.textContent === '2', 'matriz: Entrega × Mínimo = 2');
  link.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(JSON.stringify(pedidos()) === JSON.stringify(['U1', 'A2']), 'clique na matriz filtra a tabela: ' + JSON.stringify(pedidos()));
  assert(d.getElementById('alertaFiltroEtapa').value === 'ENTREGA (NEOCRM)' && d.getElementById('alertaFiltroNivel').value === 'minimo', 'clique na matriz atualiza os selects');

  // selects combinados
  w.limparFiltrosAlerta();
  assert(pedidos().length === 7, 'limpar filtros volta a 7');
  d.getElementById('alertaFiltroNivel').value = 'maximo';
  d.getElementById('alertaFiltroConsultor').value = 'Caio';
  w.onFiltroAlerta();
  assert(JSON.stringify(pedidos()) === JSON.stringify(['M1', 'A4']), 'máximo + Caio = M1, A4: ' + JSON.stringify(pedidos()));
  assert(valorCard('total') === '7', 'placar continua mostrando o total geral com filtro ativo');

  // atualização de hora em hora: nova referência 02/10 (sex), filtros preservados
  w.limparFiltrosAlerta();
  d.getElementById('alertaFiltroNivel').value = 'medio';
  w.onFiltroAlerta();
  w.atualizarDadosDashboard(FIXTURE, '02/10/2026, 09:00:00');
  assert(d.querySelector('.topbar .updated').textContent === 'Atualizado em: 02/10/2026, 09:00:00', 'topo mostra o novo "Atualizado em"');
  assert(d.getElementById('alertaFiltroNivel').value === 'medio', 'filtro de nível preservado após a atualização');
  assert(pedidos().includes('A7') && pedidos().includes('A2'), 'com referência 02/10, A7 (6 d.u.) e A2 (7 d.u.) viram médio: ' + JSON.stringify(pedidos()));

  // consultor filtrado que some na atualização → filtro volta pra "Todos"
  w.limparFiltrosAlerta();
  d.getElementById('alertaFiltroConsultor').value = 'Vitor';
  w.onFiltroAlerta();
  w.atualizarDadosDashboard(FIXTURE.filter(r => r.usuario !== 'Vitor'), '28/09/2026, 20:12:03');
  assert(d.getElementById('alertaFiltroConsultor').value === '' && pedidos().length === 5, 'consultor que sumiu volta pra "Todos" (5 pedidos sem os do Vitor): ' + pedidos().length);

  // estado vazio
  const wv = montarDashboard({ data: [ped({ numero_pedido: 'A1', atualizacao: '2026-09-25T10:00:00-03:00' })] });
  wv.switchTab('alertas');
  assert(wv.document.getElementById('alertaMsg').textContent.includes('Nenhum pedido parado há 3 dias úteis'), 'estado vazio com mensagem');
  assert(wv.document.getElementById('alertaExportBtn').disabled === true, 'Exportar desabilitado sem pedidos');

  // referência ilegível → usa hoje e avisa
  const wd = montarDashboard({ updatedAt: '—', data: FIXTURE });
  assert(wd.document.getElementById('alertaSub').textContent.includes('data da base desconhecida'), 'sem data da base: aviso na tela');

  // HTML em nome de cliente/produto aparece como texto
  const wx = montarDashboard({ data: [ped({ numero_pedido: 'H1', atualizacao: '2026-09-01T10:00:00-03:00', cliente: '<b>ACME & "FILHOS"</b>', produto: '<img src=x>' })] });
  const tr = wx.document.querySelector('#alertaBody tr');
  assert(tr && !tr.querySelector('b') && !tr.querySelector('img') && tr.textContent.includes('<b>ACME & "FILHOS"</b>'), 'cliente/produto com HTML são escapados');
}

// o painel externo passa o "Atualizado em" na atualização de 1h
assert(/win\.atualizarDadosDashboard\(novos, \(cfgAuto && cfgAuto\.valor\) \|\| null\)/.test(outerHtml), 'painel externo chama atualizarDadosDashboard(novos, atualizadoEm)');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_pedidos_alerta.js`
Expected: FAIL (`admin: botão "Pedidos em Alerta" existe`, e em seguida um `TypeError` porque `#tabAlertas` não existe).

- [ ] **Step 3: CSS**

`python dashboard_tpl.py extrair`. Em `_dashboard_producao.html`, logo **depois** da linha `  body.tab-diaria .layout .panel{display:none;}`, insira:

```css

  /* ---------- PEDIDOS EM ALERTA (28/09/2026) — ver REGRAS_NEGOCIO.md seção 46 ---------- */
  /* cores dos níveis derivadas da paleta de status (vermelho = perdido, laranja = devolvido,
     amarelo = andamento) + fundos claros pras linhas da tabela */
  :root{
    --alerta-max:var(--perdido); --alerta-med:var(--devolvido); --alerta-min:var(--andamento);
    --alerta-max-bg:#FDE2E2; --alerta-med-bg:#FFEBD9; --alerta-min-bg:#FEF6D2;
  }
  body.tab-alertas .layout{grid-template-columns:1fr;}
  body.tab-alertas .layout .panel{display:none;}
  .card.alerta-card-maximo{border-top-color:var(--alerta-max);} .card.alerta-card-maximo .value{color:var(--alerta-max);}
  .card.alerta-card-medio{border-top-color:var(--alerta-med);} .card.alerta-card-medio .value{color:var(--alerta-med);}
  .card.alerta-card-minimo{border-top-color:var(--alerta-min);} .card.alerta-card-minimo .value{color:var(--alerta-min);}
  .alerta-matriz-wrap,.alerta-tabela-wrap{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow-x:auto;margin-bottom:14px;}
  table.alerta-matriz th,table.alerta-matriz td{text-align:center;}
  table.alerta-matriz th:first-child,table.alerta-matriz td:first-child{text-align:left;}
  table.alerta-matriz a{color:var(--text);font-weight:700;text-decoration:underline;cursor:pointer;}
  .alerta-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:13px;color:var(--muted);font-weight:600;}
  .alerta-toolbar select{border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--panel);color:var(--text);margin-left:6px;}
  .alerta-toolbar a{color:var(--accent);cursor:pointer;}
  .alerta-toolbar .btn-export{margin-left:auto;}
  .alerta-toolbar .btn-export:disabled{opacity:.5;cursor:not-allowed;}
  .alerta-msg{font-size:12px;color:var(--muted);margin:0 0 8px 0;}
  table.alerta-tabela{min-width:1100px;}
  table.alerta-tabela th,table.alerta-tabela td{text-align:left;white-space:nowrap;}
  table.alerta-tabela th.num,table.alerta-tabela td.num{text-align:right;}
  table.alerta-tabela td.col-wrap{white-space:normal;min-width:180px;}
  table.alerta-tabela tr.alerta-maximo td{background:var(--alerta-max-bg);}
  table.alerta-tabela tr.alerta-medio td{background:var(--alerta-med-bg);}
  table.alerta-tabela tr.alerta-minimo td{background:var(--alerta-min-bg);}
  .alerta-selo{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:var(--panel);}
  .alerta-selo-maximo{background:var(--alerta-max);}
  .alerta-selo-medio{background:var(--alerta-med);}
  .alerta-selo-minimo{background:var(--alerta-min);color:var(--text);}
```

- [ ] **Step 4: Painel HTML**

Ainda em `_dashboard_producao.html`, insira **imediatamente antes** da linha
`    <div class="footer-note">Apex Smart Solutions &middot; Dashboard de Produção Claro</div>`:

```html
    <!-- Pedidos em Alerta (28/09/2026, só admin/supervisor — o script remove este bloco quando
         ADMIN_MODE é false). Ver REGRAS_NEGOCIO.md seção 46. -->
    <div id="tabAlertas" class="tab-panel">
      <div class="section-title" style="margin-top:0;">Pedidos em alerta</div>
      <p class="section-sub" id="alertaSub"></p>
      <div class="cards" id="alertaCards"></div>
      <div class="alerta-matriz-wrap"><table class="alerta-matriz" id="alertaMatriz"></table></div>
      <div class="alerta-toolbar">
        <label>Etapa<select id="alertaFiltroEtapa" onchange="onFiltroAlerta()"></select></label>
        <label>Nível<select id="alertaFiltroNivel" onchange="onFiltroAlerta()"></select></label>
        <label>Consultor<select id="alertaFiltroConsultor" onchange="onFiltroAlerta()"></select></label>
        <a onclick="limparFiltrosAlerta()">Limpar filtros</a>
        <button type="button" class="btn-export" id="alertaExportBtn" onclick="exportarAlertasExcel()">&#128190; Exportar Excel</button>
      </div>
      <p class="alerta-msg" id="alertaMsg"></p>
      <div class="alerta-tabela-wrap">
        <table class="alerta-tabela">
          <thead><tr>
            <th>Nível</th><th class="num">Dias úteis</th><th>Pedido</th><th>Cliente</th><th>CPF/CNPJ</th><th>Consultor</th>
            <th>Grupo</th><th>Etapa</th><th>Produtos</th><th class="num">Qtd.</th><th class="num">Valor</th><th>Cadastro</th><th>Última atualização</th>
          </tr></thead>
          <tbody id="alertaBody"></tbody>
        </table>
      </div>
    </div>

```

- [ ] **Step 5: `switchTab`**

Substitua a função `switchTab` inteira por:

```js
function switchTab(name){
  document.querySelectorAll('.tab-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p=> p.classList.remove('active'));
  const PAINEIS = { daily: 'tabDaily', diaria: 'tabDiaria', alertas: 'tabAlertas' };
  const panel = document.getElementById(PAINEIS[name] || 'tabOverview');
  if(panel) panel.classList.add('active');
  // Visao Diaria e Pedidos em Alerta nao usam os filtros de Grupo/Vendedor/Etapa/Data da sidebar
  // (mostram sempre a equipe inteira) — escondida via CSS quando uma dessas abas esta ativa.
  document.body.classList.toggle('tab-diaria', name === 'diaria');
  document.body.classList.toggle('tab-alertas', name === 'alertas');
}
```

- [ ] **Step 6: JS da tela**

Logo **depois** da função `filtrarAlertas` (Task 2), acrescente:

```js
let ALERTA_FILTRO = { etapa: '', nivel: '', consultor: '' };
let ALERTA_LISTA = [];
let ALERTA_REF = null;

function escHtml(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Data de referência = "Atualizado em" do topo (data da última subida da planilha). Se não der pra
// ler (ex.: "—", nenhuma planilha com data), conta até hoje em São Paulo e avisa na tela.
function obterReferenciaAlertas(){
  const el = document.querySelector('.topbar .updated');
  const ref = parseDataReferencia(el ? el.textContent : '');
  if(ref) return { date: ref.date, hora: ref.hora, desconhecida: false };
  return { date: spParts(new Date().toISOString()).date, hora: null, desconhecida: true };
}

function textoFaixa(nivel){
  const F = ALERTA_FAIXAS;
  if(nivel === 'maximo') return `${F.maximo}+`;
  if(nivel === 'medio') return `${F.medio}–${F.maximo - 1}`;
  return `${F.minimo}–${F.medio - 1}`;
}

function filtroTextoAlertas(f){
  const partes = [];
  if(f.etapa) partes.push('Etapa: ' + shortEtapa(f.etapa));
  if(f.nivel) partes.push('Nível: ' + ALERTA_ROTULO[f.nivel]);
  if(f.consultor) partes.push('Consultor: ' + f.consultor);
  return partes.length ? partes.join(' · ') : 'todos';
}

function renderPedidosAlerta(){
  if(!document.getElementById('tabAlertas')) return; // consultor: aba não existe
  ALERTA_REF = obterReferenciaAlertas();
  ALERTA_LISTA = montarPedidosEmAlerta(DATA, ALERTA_REF.date);
  const resumo = resumirAlertas(ALERTA_LISTA);

  document.getElementById('alertaSub').textContent = ALERTA_REF.desconhecida
    ? 'Dias úteis desde a última atualização · data da base desconhecida — contando até hoje (' + fmtDateOnly(ALERTA_REF.date) + ')'
    : 'Dias úteis desde a última atualização · referência: base de ' + fmtDateOnly(ALERTA_REF.date) + (ALERTA_REF.hora ? ' ' + ALERTA_REF.hora : '');

  document.getElementById('alertaCards').innerHTML = [
    ['total', 'Em alerta', resumo.total.total],
    ['maximo', '🔴 Máximo (' + textoFaixa('maximo') + ')', resumo.total.maximo],
    ['medio', '🟠 Médio (' + textoFaixa('medio') + ')', resumo.total.medio],
    ['minimo', '🟡 Mínimo (' + textoFaixa('minimo') + ')', resumo.total.minimo],
  ].map(([k, rotulo, v]) => `<div class="card alerta-card-${k}"><div class="label">${rotulo}</div><div class="value">${v}</div></div>`).join('');

  // matriz Etapa × Nível — cada número é um link que aplica os filtros correspondentes
  const link = (n, etapa, nivel) => n > 0 ? `<a data-etapa="${escAttr(etapa)}" data-nivel="${nivel}">${n}</a>` : '0';
  const colunas = ['minimo', 'medio', 'maximo'];
  let h = '<thead><tr><th>Etapa</th><th>🟡 Mínimo</th><th>🟠 Médio</th><th>🔴 Máximo</th><th>Total</th></tr></thead><tbody>';
  ALERTA_ETAPAS.forEach(e => {
    const r = resumo.porEtapa[e];
    h += `<tr><td>${escHtml(shortEtapa(e))}</td>` + colunas.map(n => `<td>${link(r[n], e, n)}</td>`).join('') + `<td><b>${link(r.total, e, '')}</b></td></tr>`;
  });
  const t = resumo.total;
  h += '<tr class="total-row"><td>Total</td>' + colunas.map(n => `<td>${link(t[n], '', n)}</td>`).join('') + `<td>${link(t.total, '', '')}</td></tr></tbody>`;
  document.getElementById('alertaMatriz').innerHTML = h;

  preencherFiltrosAlerta();
  renderTabelaAlertas();
}

// Recria as opções dos selects preservando a escolha; consultor que não está mais na lista (ex.:
// saiu na atualização de 1h) volta pra "Todos" em vez de deixar a tabela vazia sem explicação.
function preencherFiltrosAlerta(){
  const consultores = unique(ALERTA_LISTA.map(p => p.usuario).filter(Boolean));
  if(ALERTA_FILTRO.consultor && consultores.indexOf(ALERTA_FILTRO.consultor) < 0) ALERTA_FILTRO.consultor = '';
  const opt = (v, rotulo, sel) => `<option value="${escAttr(v)}"${v === sel ? ' selected' : ''}>${escHtml(rotulo)}</option>`;
  document.getElementById('alertaFiltroEtapa').innerHTML = opt('', 'Todas', ALERTA_FILTRO.etapa)
    + ALERTA_ETAPAS.map(e => opt(e, shortEtapa(e), ALERTA_FILTRO.etapa)).join('');
  document.getElementById('alertaFiltroNivel').innerHTML = opt('', 'Todos', ALERTA_FILTRO.nivel)
    + ALERTA_NIVEIS.map(n => opt(n, ALERTA_ROTULO[n], ALERTA_FILTRO.nivel)).join('');
  document.getElementById('alertaFiltroConsultor').innerHTML = opt('', 'Todos', ALERTA_FILTRO.consultor)
    + consultores.map(c => opt(c, c, ALERTA_FILTRO.consultor)).join('');
}

function renderTabelaAlertas(){
  const lista = filtrarAlertas(ALERTA_LISTA, ALERTA_FILTRO);
  const msg = document.getElementById('alertaMsg');
  document.getElementById('alertaExportBtn').disabled = lista.length === 0;
  if(ALERTA_LISTA.length === 0) msg.textContent = `Nenhum pedido parado há ${ALERTA_FAIXAS.minimo} dias úteis ou mais nessas etapas. 🎉`;
  else if(lista.length === 0) msg.textContent = 'Nenhum pedido com esses filtros.';
  else msg.textContent = lista.length + (lista.length === 1 ? ' pedido na lista' : ' pedidos na lista') + ' (filtros: ' + filtroTextoAlertas(ALERTA_FILTRO) + ')';
  const soData = iso => iso ? fmtDate(iso).split(' ')[0] : '-';
  document.getElementById('alertaBody').innerHTML = lista.map(p => `<tr class="alerta-${p.nivel}" data-pedido="${escAttr(p.numero_pedido)}">
    <td><span class="alerta-selo alerta-selo-${p.nivel}">${ALERTA_ROTULO[p.nivel]}</span></td>
    <td class="num"><b>${p.dias}</b></td>
    <td>${escHtml(p.numero_pedido)}</td>
    <td class="col-wrap">${escHtml(p.cliente || '-')}</td>
    <td>${escHtml(p.cnpj || '-')}</td>
    <td>${escHtml(p.usuario || '-')}</td>
    <td>${escHtml(p.grupo || '-')}</td>
    <td>${escHtml(shortEtapa(p.etapa))}</td>
    <td class="col-wrap">${escHtml(p.produtos || '-')}</td>
    <td class="num">${p.qtd}</td>
    <td class="num">${fmtBRL(p.valor)}</td>
    <td>${soData(p.cadastro)}</td>
    <td>${fmtDate(p.atualizacao)}</td>
  </tr>`).join('');
}

function onFiltroAlerta(){
  ALERTA_FILTRO = {
    etapa: document.getElementById('alertaFiltroEtapa').value,
    nivel: document.getElementById('alertaFiltroNivel').value,
    consultor: document.getElementById('alertaFiltroConsultor').value,
  };
  renderTabelaAlertas();
}

function limparFiltrosAlerta(){
  ALERTA_FILTRO = { etapa: '', nivel: '', consultor: '' };
  preencherFiltrosAlerta();
  renderTabelaAlertas();
}

function onCliqueMatrizAlerta(ev){
  const a = ev.target.closest('a[data-nivel]');
  if(!a) return;
  ALERTA_FILTRO.etapa = a.dataset.etapa || '';
  ALERTA_FILTRO.nivel = a.dataset.nivel || '';
  preencherFiltrosAlerta();
  renderTabelaAlertas();
}

// A aba só existe pra admin/supervisor: pro consultor, some até o painel do DOM.
if(ADMIN_MODE){
  const abas = document.querySelector('.tabs');
  if(abas) abas.insertAdjacentHTML('beforeend', '<button type="button" class="tab-btn" data-tab="alertas" onclick="switchTab(\'alertas\')">Pedidos em Alerta</button>');
  const matriz = document.getElementById('alertaMatriz');
  if(matriz) matriz.addEventListener('click', onCliqueMatrizAlerta);
} else {
  const painelAlertas = document.getElementById('tabAlertas');
  if(painelAlertas) painelAlertas.remove();
}

```

- [ ] **Step 7: Atualização de hora em hora + primeira renderização**

Substitua o bloco `window.atualizarDadosDashboard = function(novosDados){ ... };` inteiro por:

```js
window.atualizarDadosDashboard = function(novosDados, novoAtualizadoEm){
  if(!Array.isArray(novosDados) || novosDados.length === 0) return;
  DATA = novosDados;
  // 2º argumento (28/09/2026, Pedidos em Alerta): o "Atualizado em" mais recente — é a data de
  // referência da contagem de dias úteis, precisa acompanhar uma planilha nova sem recarregar.
  if(novoAtualizadoEm){
    const upd = document.querySelector('.topbar .updated');
    if(upd) upd.textContent = 'Atualizado em: ' + novoAtualizadoEm;
  }
  applyFilters();
  renderVisaoDiaria();
  renderPedidosAlerta();
};
```

Logo abaixo da linha `applyFilters();` que aparece sozinha (a inicialização, antes do bloco `// movimento (25/09/2026)`), acrescente:

```js
renderPedidosAlerta();
```

Depois: `python dashboard_tpl.py empacotar`.

- [ ] **Step 8: Painel externo passa o "Atualizado em"**

Em `_template.html` (fora do base64), dentro de `producaoAutoRefreshTimer = setInterval(async () => {`, troque:

```js
      const { data: novos, error: errAuto } = await fetchAllRows(() => sb.from('producao_pedidos').select(cols));
      if(errAuto || !novos || novos.length === 0) return;
      const win = frame.contentWindow;
      if(win && typeof win.atualizarDadosDashboard === 'function') win.atualizarDadosDashboard(novos);
```
por:
```js
      const [{ data: novos, error: errAuto }, { data: cfgAuto }] = await Promise.all([
        fetchAllRows(() => sb.from('producao_pedidos').select(cols)),
        sb.from('config').select('valor').eq('chave', 'producao_atualizado_em').maybeSingle(),
      ]);
      if(errAuto || !novos || novos.length === 0) return;
      const win = frame.contentWindow;
      // 2º argumento: data da base, referência dos Pedidos em Alerta (REGRAS_NEGOCIO.md seção 46)
      if(win && typeof win.atualizarDadosDashboard === 'function') win.atualizarDadosDashboard(novos, (cfgAuto && cfgAuto.valor) || null);
```

E em `test_visao_diaria.js`, troque a linha
```js
assert0(outerHtml.includes('atualizarDadosDashboard(novos)'), 'painel externo chama atualizarDadosDashboard() do iframe ao atualizar');
```
por
```js
assert0(outerHtml.includes('atualizarDadosDashboard(novos, '), 'painel externo chama atualizarDadosDashboard() do iframe ao atualizar (28/09/2026: + "Atualizado em" como 2º argumento)');
```

- [ ] **Step 9: Rodar e ver passar**

Run: `node test_pedidos_alerta.js && node test_visao_diaria.js && node test_dashboard_producao.js`
Expected: todos com `0 falharam` (o último pode ter `PULADO:`).

- [ ] **Step 10: Commit + push**

```bash
python build_painel.py
git add _template.html painel_clientes_apex.html test_pedidos_alerta.js test_visao_diaria.js
git commit -m "feat(alertas): aba Pedidos em Alerta no Dashboard de Produção (admin/supervisor)

Placar, matriz Etapa x Nível clicável, filtros próprios (etapa, nível, consultor) e
tabela colorida; a atualização de 1h passa também o \"Atualizado em\" (data de referência).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```

---

### Task 4: Exportar Excel colorido (ExcelJS)

**Files:**
- Modify: `_template.html` (via `_dashboard_producao.html`): JS de exportação depois de `onCliqueMatrizAlerta`.
- Modify: `package.json`, `package-lock.json` (`exceljs` como devDependency, só para os testes).
- Test: `test_pedidos_alerta.js` (bloco novo, assíncrono).

**Interfaces:**
- Consumes (Tasks 2 e 3): `ALERTA_LISTA`, `ALERTA_FILTRO`, `ALERTA_REF`, `ALERTA_ETAPAS`, `ALERTA_ROTULO`, `filtrarAlertas`, `resumirAlertas`, `filtroTextoAlertas`, `textoFaixa`, `shortEtapa`, `fmtDateOnly`. DOM: `#alertaExportBtn`, `#alertaMsg`.
- Produces:
  - `ALERTA_CORES_EXCEL`
  - `carregarExcelJS() -> Promise<ExcelJS>`
  - `dataExcelSp(iso) -> Date|null`: Date "UTC" com os números do horário de São Paulo; o Excel não tem fuso.
  - `gerarExcelAlertas(ExcelJS, lista, ref, filtroTexto) -> Workbook`
  - `baixarArquivo(buffer, nome)`
  - `exportarAlertasExcel() -> Promise<void>`

- [ ] **Step 1: Instalar a ExcelJS para os testes**

```bash
npm install --save-dev exceljs@4.4.0
npm install --no-save xlsx@0.18.5 jszip papaparse
```
Expected: `package.json` ganha `"devDependencies": { "exceljs": "^4.4.0" }`. A 2ª linha é obrigatória, porque o `npm install` remove os pacotes instalados com `--no-save` na Task 1 e `test_dashboard_producao.js` precisa do `xlsx`. Confira com `node -e "require('xlsx'); require('exceljs'); console.log('ok')"`.

- [ ] **Step 2: Escrever o teste (falhando)**

Em `test_pedidos_alerta.js`, troque as duas últimas linhas do arquivo:
```js
console.log('--- test_pedidos_alerta RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
```
por:

```js
// ---------------- Task 4: Excel ----------------
async function testarExcel(){
  const ExcelJS = require('exceljs');
  const w = montarDashboard({ data: FIXTURE });
  const d = w.document;
  w.ExcelJS = ExcelJS;
  assert((await w.carregarExcelJS()) === ExcelJS, 'carregarExcelJS reaproveita window.ExcelJS quando já existe');

  let baixado = null;
  w.baixarArquivo = (buffer, nome) => { baixado = { buffer, nome }; };
  w.switchTab('alertas');
  await w.exportarAlertasExcel();
  assert(baixado && baixado.nome === 'PedidosEmAlerta_2026-09-28.xlsx', 'nome do arquivo com a data da base: ' + (baixado && baixado.nome));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(baixado.buffer);
  assert(JSON.stringify(wb.worksheets.map(s => s.name)) === JSON.stringify(['Pedidos em Alerta', 'Resumo']), 'abas "Pedidos em Alerta" e "Resumo"');
  const ws = wb.getWorksheet('Pedidos em Alerta');
  assert(String(ws.getCell('A1').value).includes('Pedidos em Alerta'), 'linha 1 = título');
  const l2 = String(ws.getCell('A2').value);
  assert(l2.includes('Base de 28/09/2026 20:12') && l2.includes('Filtros: todos') && l2.includes('Máximo 10+'), 'linha 2 = base, legenda e filtros: ' + l2);
  const cab = [];
  for(let c = 1; c <= 13; c++) cab.push(ws.getRow(3).getCell(c).value);
  assert(JSON.stringify(cab) === JSON.stringify(['Nível', 'Dias úteis parado', 'Nº Pedido', 'Cliente', 'CPF/CNPJ', 'Consultor', 'Grupo', 'Etapa', 'Produtos', 'Qtd.', 'Valor total', 'Cadastro', 'Última atualização']),
    'cabeçalho na linha 3: ' + JSON.stringify(cab));
  assert(ws.getCell('A3').fill.fgColor.argb === 'FF1D1F20' && ws.getCell('A3').font.color.argb === 'FFFFFFFF', 'cabeçalho grafite com texto branco');
  const af = ws.autoFilter;
  assert(af === 'A3:M3' || (af && af.from && (af.from.row === 3 || af.from === 'A3')), 'filtro automático na linha 3: ' + JSON.stringify(af));
  assert(ws.views[0] && ws.views[0].state === 'frozen' && ws.views[0].ySplit === 3, 'painel congelado abaixo do cabeçalho: ' + JSON.stringify(ws.views[0]));
  assert(ws.actualRowCount === 3 + 7, '7 pedidos a partir da linha 4 (' + ws.actualRowCount + ' linhas)');

  // linha 4 = M1 (máximo)
  const r4 = ws.getRow(4);
  assert(r4.getCell(1).value === 'MÁXIMO' && r4.getCell(1).fill.fgColor.argb === 'FFC1050F' && r4.getCell(1).font.color.argb === 'FFFFFFFF', 'selo MÁXIMO vermelho com texto branco');
  assert(r4.getCell(2).fill.fgColor.argb === 'FFFFC7CE' && r4.getCell(13).fill.fgColor.argb === 'FFFFC7CE', 'linha inteira com fundo vermelho claro');
  assert(r4.getCell(2).value === 17, 'dias úteis como número');
  assert(r4.getCell(3).value === 'M1' && r4.getCell(5).value === '00123456000190', 'nº do pedido e CNPJ como texto (zeros preservados)');
  assert(r4.getCell(11).value === 60 && String(r4.getCell(11).numFmt).includes('R$'), 'valor numérico com formato R$');
  const atu = r4.getCell(13).value;
  assert(atu instanceof Date && atu.getUTCDate() === 2 && atu.getUTCHours() === 15 && atu.getUTCMinutes() === 45 && r4.getCell(13).numFmt === 'dd/mm/yyyy hh:mm',
    'última atualização como data do Excel no horário de São Paulo (02/09 15:45)');
  assert(r4.getCell(12).value instanceof Date && r4.getCell(12).numFmt === 'dd/mm/yyyy', 'cadastro como data');
  // linha 6 = A5 (médio) · linha 10 = A2 (mínimo)
  assert(ws.getRow(6).getCell(1).value === 'MÉDIO' && ws.getRow(6).getCell(1).fill.fgColor.argb === 'FFF97316' && ws.getRow(6).getCell(4).fill.fgColor.argb === 'FFFFD8B0', 'médio laranja');
  assert(ws.getRow(10).getCell(1).value === 'MÍNIMO' && ws.getRow(10).getCell(1).fill.fgColor.argb === 'FFEAB308'
    && ws.getRow(10).getCell(1).font.color.argb === 'FF000000' && ws.getRow(10).getCell(4).fill.fgColor.argb === 'FFFFF2A8', 'mínimo amarelo com texto preto');

  const rs = wb.getWorksheet('Resumo');
  const linhaResumo = n => [1, 2, 3, 4, 5].map(c => rs.getRow(n).getCell(c).value);
  assert(JSON.stringify(linhaResumo(1)) === JSON.stringify(['Etapa', 'Mínimo', 'Médio', 'Máximo', 'Total']), 'cabeçalho do resumo');
  assert(JSON.stringify(linhaResumo(2)) === JSON.stringify(['ENTREGA', 2, 0, 1, 3]), 'resumo Entrega: ' + JSON.stringify(linhaResumo(2)));
  assert(JSON.stringify(linhaResumo(6)) === JSON.stringify(['TOTAL', 3, 2, 2, 7]), 'resumo TOTAL: ' + JSON.stringify(linhaResumo(6)));

  // exporta só o filtrado
  d.getElementById('alertaFiltroNivel').value = 'maximo';
  w.onFiltroAlerta();
  await w.exportarAlertasExcel();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(baixado.buffer);
  const ws2 = wb2.getWorksheet('Pedidos em Alerta');
  assert(ws2.actualRowCount === 3 + 2 && String(ws2.getCell('A2').value).includes('Filtros: Nível: MÁXIMO'), 'Excel só com os 2 pedidos filtrados e o filtro descrito');
  assert(wb2.getWorksheet('Resumo').getRow(6).getCell(5).value === 2, 'resumo do Excel filtrado soma 2');

  // falha ao carregar a biblioteca: mensagem e botão reabilitado
  w.carregarExcelJS = () => Promise.reject(new Error('sem internet'));
  const errOrig = w.console.error; w.console.error = () => {};
  await w.exportarAlertasExcel();
  w.console.error = errOrig;
  assert(d.getElementById('alertaMsg').textContent.includes('Não foi possível gerar o Excel'), 'falha ao carregar ExcelJS mostra aviso');
  assert(d.getElementById('alertaExportBtn').disabled === false, 'botão volta a ficar habilitado depois da falha');
}

testarExcel().catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); }).finally(() => {
  console.log('--- test_pedidos_alerta RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  if(fail > 0) process.exitCode = 1;
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node test_pedidos_alerta.js`
Expected: FAIL com `FALHOU (exceção no teste do Excel): TypeError: w.carregarExcelJS is not a function`.

- [ ] **Step 4: Implementar**

`python dashboard_tpl.py extrair`. Em `_dashboard_producao.html`, logo **depois** da função `onCliqueMatrizAlerta` (e antes do `if(ADMIN_MODE){` que insere o botão), acrescente:

```js
// ----- Exportação Excel (ExcelJS, carregada só no clique) -----
// O SheetJS gratuito já usado nas outras exportações não grava cor de célula; a ExcelJS grava.
// Cores em ARGB espelhando os tokens --alerta-* da tela (o Excel não lê variáveis CSS).
const ALERTA_CORES_EXCEL = {
  maximo: { forte: 'FFC1050F', claro: 'FFFFC7CE', texto: 'FFFFFFFF' },
  medio: { forte: 'FFF97316', claro: 'FFFFD8B0', texto: 'FFFFFFFF' },
  minimo: { forte: 'FFEAB308', claro: 'FFFFF2A8', texto: 'FF000000' },
  cabecalho: { fundo: 'FF1D1F20', texto: 'FFFFFFFF' },
};
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let excelJsCarregando = null;

function carregarExcelJS(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(!excelJsCarregando){
    excelJsCarregando = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL;
      s.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS não ficou disponível'));
      s.onerror = () => reject(new Error('falha ao baixar a ExcelJS'));
      document.head.appendChild(s);
    }).catch(err => { excelJsCarregando = null; throw err; });
  }
  return excelJsCarregando;
}

// O Excel não tem fuso: grava uma Date "UTC" com os números do horário de São Paulo, pra célula
// mostrar exatamente a data/hora que aparece na tela.
const ALERTA_SP_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
});
function dataExcelSp(iso){
  if(!iso) return null;
  const d = new Date(iso);
  if(isNaN(d.getTime())) return null;
  const p = {};
  ALERTA_SP_FMT.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, parseInt(p.hour, 10) % 24, +p.minute));
}

function gerarExcelAlertas(ExcelJS, lista, ref, filtroTexto){
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex Smart Solutions';
  const CAB = ['Nível', 'Dias úteis parado', 'Nº Pedido', 'Cliente', 'CPF/CNPJ', 'Consultor', 'Grupo', 'Etapa', 'Produtos', 'Qtd.', 'Valor total', 'Cadastro', 'Última atualização'];
  const ws = wb.addWorksheet('Pedidos em Alerta', { views: [{ state: 'frozen', ySplit: 3 }] });
  const pintar = (cell, argb) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };

  ws.getCell('A1').value = 'Pedidos em Alerta — Apex / Claro';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, CAB.length);
  ws.getCell('A2').value = 'Base de ' + fmtDateOnly(ref.date) + (ref.hora ? ' ' + ref.hora : '')
    + ' · dias úteis desde a última atualização · Mínimo ' + textoFaixa('minimo') + ' · Médio ' + textoFaixa('medio')
    + ' · Máximo ' + textoFaixa('maximo') + ' · Filtros: ' + filtroTexto;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(2, 1, 2, CAB.length);

  const cab = ws.getRow(3);
  CAB.forEach((t, i) => {
    const c = cab.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: ALERTA_CORES_EXCEL.cabecalho.texto } };
    pintar(c, ALERTA_CORES_EXCEL.cabecalho.fundo);
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: CAB.length } };

  lista.forEach((p, i) => {
    const row = ws.getRow(4 + i);
    const cor = ALERTA_CORES_EXCEL[p.nivel];
    [ALERTA_ROTULO[p.nivel], p.dias, String(p.numero_pedido), p.cliente || '', p.cnpj ? String(p.cnpj) : '', p.usuario || '',
      p.grupo || '', shortEtapa(p.etapa), p.produtos || '', p.qtd, p.valor, dataExcelSp(p.cadastro), dataExcelSp(p.atualizacao)]
      .forEach((v, c) => { row.getCell(c + 1).value = v; pintar(row.getCell(c + 1), c === 0 ? cor.forte : cor.claro); });
    row.getCell(1).font = { bold: true, color: { argb: cor.texto } };
    row.getCell(3).numFmt = '@';
    row.getCell(5).numFmt = '@';
    row.getCell(11).numFmt = '"R$" #,##0.00';
    row.getCell(12).numFmt = 'dd/mm/yyyy';
    row.getCell(13).numFmt = 'dd/mm/yyyy hh:mm';
  });

  // largura de cada coluna pelo maior conteúdo (limitada a 60)
  CAB.forEach((t, i) => {
    let max = t.length;
    for(let r = 4; r < 4 + lista.length; r++){
      const v = ws.getRow(r).getCell(i + 1).value;
      const len = v instanceof Date ? 16 : String(v == null ? '' : v).length;
      if(len > max) max = len;
    }
    ws.getColumn(i + 1).width = Math.min(60, max + 2);
  });

  const rs = wb.addWorksheet('Resumo');
  const resumo = resumirAlertas(lista);
  const cabR = rs.getRow(1);
  ['Etapa', 'Mínimo', 'Médio', 'Máximo', 'Total'].forEach((t, i) => {
    const c = cabR.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: ALERTA_CORES_EXCEL.cabecalho.texto } };
    pintar(c, ALERTA_CORES_EXCEL.cabecalho.fundo);
  });
  ALERTA_ETAPAS.forEach((e, i) => {
    const r = resumo.porEtapa[e];
    rs.getRow(2 + i).values = [shortEtapa(e), r.minimo, r.medio, r.maximo, r.total];
  });
  const tot = rs.getRow(2 + ALERTA_ETAPAS.length);
  tot.values = ['TOTAL', resumo.total.minimo, resumo.total.medio, resumo.total.maximo, resumo.total.total];
  tot.font = { bold: true };
  rs.getColumn(1).width = 32;
  [2, 3, 4, 5].forEach(c => { rs.getColumn(c).width = 12; });
  return wb;
}

function baixarArquivo(buffer, nome){
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportarAlertasExcel(){
  const lista = filtrarAlertas(ALERTA_LISTA, ALERTA_FILTRO);
  if(lista.length === 0) return;
  const btn = document.getElementById('alertaExportBtn');
  btn.disabled = true;
  try{
    const ExcelJS = await carregarExcelJS();
    const wb = gerarExcelAlertas(ExcelJS, lista, ALERTA_REF, filtroTextoAlertas(ALERTA_FILTRO));
    const buffer = await wb.xlsx.writeBuffer();
    baixarArquivo(buffer, 'PedidosEmAlerta_' + ALERTA_REF.date + '.xlsx');
  }catch(err){
    console.error('Erro ao gerar o Excel de Pedidos em Alerta:', err);
    document.getElementById('alertaMsg').textContent = 'Não foi possível gerar o Excel agora — tente de novo.';
  }finally{
    btn.disabled = false;
  }
}

```

`python dashboard_tpl.py empacotar`

- [ ] **Step 5: Rodar e ver passar**

Run: `node test_pedidos_alerta.js`
Expected: `0 falharam`.
Se `ws.autoFilter`, `ws.views` ou `actualRowCount` vierem num formato diferente depois do `load`, **não relaxe a asserção às cegas**. Imprima o valor (`console.log(JSON.stringify(...))`), confirme no arquivo gerado (salve `baixado.buffer` num `.xlsx` temporário no scratchpad e abra) e só então ajuste a leitura no teste, mantendo a mesma exigência.

- [ ] **Step 6: Commit + push**

```bash
python build_painel.py
git add _template.html painel_clientes_apex.html test_pedidos_alerta.js package.json package-lock.json
git commit -m "feat(alertas): exportar Pedidos em Alerta para Excel colorido (ExcelJS)

Linha inteira pintada pelo nível, cabeçalho congelado com filtro automático,
aba Resumo e só o que está filtrado na tela. ExcelJS carregada do cdnjs só no clique.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```

---

### Task 5: Conferência com a planilha real (local, fora do git)

**Files:**
- Create: `test_pedidos_alerta_planilha.js`
- Local (não commitar): `ExportacaoProducao_alerta.xlsx` (cópia da planilha que o usuário mandou)

**Interfaces:**
- Consumes: do painel externo, `parseDataProducao`, `normalizarHeaderProducao` e `extractProducaoRecords` (lidas do código-fonte). Do dashboard, `montarPedidosEmAlerta` e `resumirAlertas`.
- Produces: teste que imprime `PULADO:` sem a planilha, para `run_tests.sh` não contar como aprovado.

- [ ] **Step 1: Copiar a planilha real para a pasta e confirmar que o git a ignora**

```bash
cp "/c/Users/acer1/Downloads/ExportacaoProducao - 2026-09-28T201209.179.xlsx" ExportacaoProducao_alerta.xlsx
git check-ignore -v ExportacaoProducao_alerta.xlsx
```
Expected: `.gitignore:...:ExportacaoProducao*.xlsx	ExportacaoProducao_alerta.xlsx`. Se **não** estiver ignorada, pare: o repositório é público.

- [ ] **Step 2: Escrever o teste**

Crie `test_pedidos_alerta_planilha.js`:

```js
// Conferência da aba "Pedidos em Alerta" contra a planilha REAL do NeoCRM (28/09/2026). A planilha
// fica fora do git (dados de clientes; ExportacaoProducao*.xlsx está no .gitignore) — sem ela o
// teste imprime PULADO. Os números esperados foram calculados de forma independente (Python) durante
// o design, com referência 28/09/2026: 61 pedidos em alerta (21 mínimo, 6 médio, 34 máximo).
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');
const { exigirArquivo } = require('./test_helper_mock.js');

const ARQ = process.env.PEDIDOS_ALERTA_XLSX || 'ExportacaoProducao_alerta.xlsx';
if(!exigirArquivo(ARQ, 'test_pedidos_alerta_planilha.js')) process.exit(0);

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// 1) extração com o MESMO código do upload do painel (lido do _template.html, não reimplementado)
const outer = fs.readFileSync('_template.html', 'utf8');
function extrairFuncao(src, nome){
  const i = src.indexOf('function ' + nome + '(');
  if(i < 0) throw new Error('função não encontrada no _template.html: ' + nome);
  let nivel = 0;
  for(let k = src.indexOf('{', i); k < src.length; k++){
    if(src[k] === '{') nivel++;
    else if(src[k] === '}'){ nivel--; if(nivel === 0) return src.slice(i, k + 1); }
  }
  throw new Error('fim da função não encontrado: ' + nome);
}
const ctx = { XLSX };
vm.createContext(ctx);
vm.runInContext("const FUSO_SAO_PAULO = '-03:00';\n"
  + ['parseDataProducao', 'normalizarHeaderProducao', 'extractProducaoRecords'].map(n => extrairFuncao(outer, n)).join('\n')
  + '\nthis.extractProducaoRecords = extractProducaoRecords;', ctx);

const wb = XLSX.readFile(ARQ);
const aba = wb.SheetNames.find(n => ['exportacao', 'exportação'].includes(n.trim().toLowerCase()));
assert(!!aba, 'planilha tem a aba Exportacao');
const ws = wb.Sheets[aba];
const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
if(range && range.s.r > 0) range.s.r = 0; // mesmo contorno do upload (REGRAS_NEGOCIO.md 16.1)
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: range || undefined });
const records = JSON.parse(JSON.stringify(ctx.extractProducaoRecords(rows)));
assert(records.length > 0, 'extração produziu registros (' + records.length + ')');

// 2) dashboard embutido real com esses registros, referência = base de 28/09/2026
const m = outer.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
const tpl = Buffer.from(m[1], 'base64').toString('utf8');
const js = tpl.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]
  .replace('let DATA = __DATA__;', 'let DATA = [];')
  .replace('__ADMIN_MODE__', 'true');
const dom = new JSDOM(tpl.replace(/<script>[\s\S]*?<\/script>/g, '').replace('__UPDATED_AT__', '28/09/2026, 20:12:03')
  .replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', ''), { runScripts: 'outside-only', url: 'http://localhost/' });
dom.window.alert = () => {};
dom.window.eval(js);

const lista = dom.window.montarPedidosEmAlerta(records, '2026-09-28');
const res = dom.window.resumirAlertas(lista);
const t = res.total;
assert(t.total === 61 && t.minimo === 21 && t.medio === 6 && t.maximo === 34, 'total 61 (21/6/34) — obtido ' + JSON.stringify(t));
const esperado = {
  'ENTREGA (NEOCRM)': [15, 3, 14],
  'ANTIFRAUDE (NEOCRM)': [5, 1, 2],
  'PORTABILIDADE EM ANDAMENTO (NEOCRM)': [0, 0, 10],
  'PORTABILIDADE EM TRATATIVA (NEOCRM)': [1, 2, 8],
};
Object.keys(esperado).forEach(e => {
  const r = res.porEtapa[e];
  const obtido = [r.minimo, r.medio, r.maximo];
  assert(JSON.stringify(obtido) === JSON.stringify(esperado[e]), e + ' mín/méd/máx ' + JSON.stringify(esperado[e]) + ' — obtido ' + JSON.stringify(obtido));
});

console.log('--- test_pedidos_alerta_planilha RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
```

- [ ] **Step 3: Rodar com a planilha**

Run: `node test_pedidos_alerta_planilha.js`
Expected: `0 falharam`.
**Se os números não baterem, não altere os esperados.** Use a skill superpowers:systematic-debugging: liste os pedidos que diferem (compare `lista` com um cálculo manual de 2–3 pedidos), descubra a causa (fuso, feriado, linhas sem GRUPO descartadas pela extração, etc.) e relate ao usuário antes de mudar regra ou expectativa.

- [ ] **Step 4: Rodar sem a planilha**

Run: `PEDIDOS_ALERTA_XLSX=nao-existe.xlsx node test_pedidos_alerta_planilha.js`
Expected: linha começando com `PULADO:` e código de saída 0.

- [ ] **Step 5: Commit + push (sem a planilha)**

```bash
git status --short   # ExportacaoProducao_alerta.xlsx NÃO pode aparecer
git add test_pedidos_alerta_planilha.js
git commit -m "test(alertas): conferência com a planilha real do NeoCRM (local, fora do git)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```

---

### Task 6: Documentação, demo visual e verificação final

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova seção 46 + referência na 16.3)
- Modify: `demo_supabase.js` (etapas de alerta e `producao_atualizado_em` nos dados fictícios da demo)

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: documentação e evidência visual para o usuário.

- [ ] **Step 1: REGRAS_NEGOCIO.md — referência na seção 16.3**

Logo **depois** do item que começa com `- **Aba "Cadastro Diário"**:` (seção 16.3), insira:

```markdown
- **Aba "Pedidos em Alerta"** (28/09/2026, só admin e supervisor): pedidos ganhos parados em Entrega, Antifraude e Portabilidade (andamento/tratativa), por dias úteis desde a última atualização, com exportação para Excel colorido — ver seção 46.
```

- [ ] **Step 2: REGRAS_NEGOCIO.md — seção 46 (no fim do arquivo)**

```markdown

## 46. Pedidos em Alerta — pedidos ganhos parados nas etapas pós-venda (28/09/2026)

Aba nova dentro do Dashboard de Produção, ao lado de Visão Geral / Cadastro Diário / Visão Diária. Pedido do usuário: mostrar os pedidos que **já geraram venda mas estão parados**, com alerta por cor, e exportar um Excel para mandar ao back office. Spec: `docs/superpowers/specs/2026-09-28-pedidos-em-alerta-design.md`; plano: `docs/superpowers/plans/2026-09-28-pedidos-em-alerta.md`.

### 46.1 Quem vê
Só **admin e supervisor** (`ADMIN_MODE` do dashboard). Para o consultor o botão da aba nem é criado e o painel é removido do DOM. Não existe vínculo confiável entre o usuário do painel e o "Proprietário do pedido" do NeoCRM, então a opção "consultor vê só os próprios" ficou de fora.

### 46.2 Regra
- **Etapas monitoradas:** `ENTREGA`, `ANTIFRAUDE`, `PORTABILIDADE EM ANDAMENTO` e `PORTABILIDADE EM TRATATIVA` (todas "(NEOCRM)"). Todos os grupos entram, independente dos filtros da barra lateral.
- **1 linha por pedido** (`numero_pedido`):
  - vale a ATUALIZACAO mais recente entre as linhas e o CADASTRO mais antigo;
  - valor é a soma de `valor` e Qtd. é a soma de `quantidade` (mesmas regras do resto do dashboard);
  - produtos distintos unidos por " + ";
  - pedido sem número ou sem ATUALIZACAO é ignorado.
- **Tempo parado em dias úteis:** seg–sex, sem feriados nacionais (os mesmos do Cadastro Diário). Conta os dias **depois** da data da ATUALIZACAO (dia em São Paulo) até a data de referência. Ex.: atualizado na sexta, visto na segunda = 1.
- **Data de referência:** a data do "Atualizado em" (última subida da planilha), **não** o dia de hoje. Assim a contagem reflete a foto do NeoCRM e não infla sozinha se ninguém subir planilha nova. Se a data não puder ser lida, conta até hoje e avisa na tela. A atualização automática de 1h passa também o "Atualizado em" (2º argumento de `atualizarDadosDashboard`).
- **Níveis:** 0–2 dias úteis ficam fora · 3–5 🟡 MÍNIMO · 6–9 🟠 MÉDIO · 10+ 🔴 MÁXIMO (constante `ALERTA_FAIXAS`).
- **ATUALIZACAO × seção 17.9:** a 17.9 mostrou que a ATUALIZACAO não serve como "data da venda" (sincronizações em massa do NeoCRM). Aqui ela é usada de propósito, porque a pergunta é justamente "há quanto tempo o pedido não se mexe". Na planilha de 28/09 nenhum pedido dessas 4 etapas tinha horário de atualização repetido (sem sinal de sync em massa). Se isso mudar, rever.

### 46.3 Tela
- **Placar:** total em alerta, 🔴, 🟠 e 🟡.
- **Matriz Etapa × Nível:** clicar num número filtra a tabela.
- **Filtros próprios:** Etapa, Nível e Consultor, mais "Limpar filtros". Um consultor que some numa atualização volta para "Todos".
- **Tabela:** do mais parado para o menos parado, com a linha inteira na cor clara do nível e o selo na cor forte.
- **Cores:** tokens `--alerta-max/med/min` (derivados de `--perdido`, `--devolvido` e `--andamento`) e fundos `--alerta-*-bg`.

### 46.4 Excel
- **Biblioteca:** o SheetJS gratuito do painel não grava cor de célula, então este Excel usa a **ExcelJS 4.4.0** (cdnjs), carregada só no clique em "Exportar Excel". Se falhar, aparece "Não foi possível gerar o Excel agora — tente de novo".
- **Arquivo:** `PedidosEmAlerta_<data da base>.xlsx`.
- **Aba "Pedidos em Alerta":**
  - linha 1 com o título;
  - linha 2 com a base, a legenda e os filtros aplicados;
  - linha 3 com o cabeçalho (congelado, com filtro automático);
  - uma linha por pedido, com a linha inteira colorida e a célula "Nível" na cor forte;
  - CPF/CNPJ e nº como texto, valor em R$, datas reais do Excel no horário de São Paulo.
- **Aba "Resumo":** a matriz dos pedidos exportados.
- **O que exporta:** só o que está filtrado na tela.

### 46.5 Testes
- `test_pedidos_alerta.js`: dias úteis, feriados, fronteiras dos níveis, fuso, agrupamento, tela, filtros, atualização de 1h e Excel (relido com a ExcelJS). Usa dados fictícios.
- `test_pedidos_alerta_planilha.js`: confere a planilha real de 28/09 (61 em alerta: 21/6/34). Fica fora do git e imprime `PULADO` quando ausente.

### 46.6 Fora de escopo (por ora)
Coluna FILA do NeoCRM (exigiria mudar upload e schema), envio automático do Excel, histórico de alertas, feriados estaduais e municipais.
```

- [ ] **Step 3: Dados da demo local com pedidos em alerta**

Em `demo_supabase.js`, troque a linha
```js
  const etapas = ['CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)', 'ANALISE DE CREDITO (NEOCRM)'];
```
por
```js
  const etapas = ['CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)', 'ANALISE DE CREDITO (NEOCRM)',
    'ANTIFRAUDE (NEOCRM)', 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'PORTABILIDADE EM TRATATIVA (NEOCRM)'];
```
e a linha
```js
    config: [{ chave: 'leads_ultima_sync', valor: new Date().toLocaleString('pt-BR') }],
```
por
```js
    config: [{ chave: 'leads_ultima_sync', valor: new Date().toLocaleString('pt-BR') },
      { chave: 'producao_atualizado_em', valor: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }],
```

- [ ] **Step 4: Suíte completa**

```bash
bash run_tests.sh
```
Expected: `0 falharam` (ou só as falhas pré-existentes anotadas na Task 1). `test_pedidos_alerta.js` e `test_pedidos_alerta_planilha.js` entre os que passaram (a planilha está na pasta).

- [ ] **Step 5: Verificação visual na demo (desktop e celular)**

```bash
node demo_local.js
```
Abra o arquivo no painel do navegador (`mcp__Claude_Browser__preview_start` com `url: "file:///C:/Users/acer1/Downloads/apex-smart-solutions/.worktrees/pedidos-em-alerta/demo_local.html"`). Se o `file://` for recusado, crie `.claude/launch.json` na worktree (não commitar) com `{"version":"0.0.1","configurations":[{"name":"demo","runtimeExecutable":"python","runtimeArgs":["-m","http.server","8765"],"port":8765}]}`, rode `preview_start` com `name: "demo"` e navegue para `http://localhost:8765/demo_local.html`. Então:
1. O painel abre no Dashboard de Produção (usuário demo = admin).
2. Clique na aba "Pedidos em Alerta" dentro do iframe.
3. Confira placar, matriz, filtros e cores.
4. Clique num número da matriz e depois em "Limpar filtros".
5. Clique em "Exportar Excel" e confira em `read_network_requests` que o `exceljs.min.js` foi baixado do cdnjs, sem erro no console.
6. Tire um print.
7. `resize_window` com `preset: "mobile"`, recarregue e confira que só a tabela rola na horizontal, não a página. Tire um print.
8. `resize_window` com `preset: "desktop"`.

Se algo estiver errado, corrija no `_dashboard_producao.html`, rode `empacotar`, `build_painel.py` e `node demo_local.js` de novo.

- [ ] **Step 6: Commit + push**

```bash
git add REGRAS_NEGOCIO.md demo_supabase.js _template.html painel_clientes_apex.html
git commit -m "docs(alertas): REGRAS_NEGOCIO seção 46 + pedidos em alerta na demo local

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push oficial feature/pedidos-em-alerta
```
(Se o `_template.html`/painel não mudaram neste passo, o `git add` deles não faz nada.)

- [ ] **Step 7: Entregar ao usuário (sem publicar)**

Mostre ao usuário:
- os prints (desktop e celular);
- o resultado da suíte;
- a conferência 61 = 21/6/34;
- o link do ramo no repositório oficial.

Pergunte se pode **publicar** em apexsmart.com.br. Se sim, siga o `CLAUDE.md`:
1. baixe o painel no ar e compare com o gerado; se o do ar tiver algo a mais, junte antes;
2. publique;
3. faça o merge do ramo no `main` oficial e o push.
