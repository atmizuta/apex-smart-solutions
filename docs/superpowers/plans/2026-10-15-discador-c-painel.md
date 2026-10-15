# Discador — Plano C: aba "Discador" no painel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar no painel a aba "Discador", só para admin/supervisor. Ela mostra cartões, ritmo por hora com alerta de abandono, mapa de calor, consultores com detalhe por dia, mailing por carga/operadora/cidade e a tela de vínculo agente → consultor (só admin). A aba lê as RPCs `discador_*` que já estão no ar (Plano A).

**Architecture:** Aba própria no menu lateral, no grupo "Visão geral", depois do Boletim da Manhã. É decisão do Rafael em 15/10 e substitui a sub-aba do Dashboard prevista na spec, porque o Dashboard é um iframe com dados injetados e não reconsulta o banco. O código segue o padrão da Mesa e do Boletim:
- funções puras `dc*` que montam HTML a partir das linhas das RPCs, testadas no jsdom;
- uma função de carga `dcCarregar()` com 7 RPCs em paralelo, cada uma isolada por `ppSeguro`, e um contador de geração para descartar respostas atrasadas;
- reaproveitamento das classes do Boletim (`bmCard`, `bmGrade`, `bmG6`, `bmKpi`, `bmCalor`, `bmHoras`, `bmLegenda`, `bmSecao`), de `table.tbl`/`mlTabelaWrap`, `filterPill`, `field` e `btn`. **Nenhum CSS novo**: só estilos inline com variáveis do manual.

**Tech Stack:** HTML/JS puro no `_template.html` (gerado por `build_painel.py`), Supabase JS (`sb.rpc`), testes Node + jsdom (`test_*.js`, rodados por `bash run_tests.sh`).

**Spec:** `docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md` (§8, ajustada na Task 1 para "menu lateral")

## Global Constraints

- Editar só `_template.html`. O `painel_clientes_apex.html` é gerado por `python build_painel.py`.
- Design "Sinal de Ápice" intocado. Não mexer no bloco `<style>` (seções 1 a 7), no menu lateral (exceto acrescentar o botão no mesmo formato), no cabeçalho de página, em `ApexMotion`, em `mostrarAviso` nem em `fecharOverlay`. Cor só por variável (`var(--c-sinal)`, `var(--c-carmim)`, `var(--muted)`, `var(--st-perdido)` etc.), nunca hex. Avisos com `mostrarAviso(msg, 'ok'|'erro'|'info')`.
- Visível só para admin/supervisor da operação Apex: `canSeeDiscador()` = mesmo critério de `canSeeBoletim()`. Consultor não vê o botão e nenhuma RPC é chamada.
- Vínculo agente → consultor: só admin (a RPC `discador_vincular_agente` também recusa supervisor).
- Nenhuma tela mostra cliente, CNPJ ou telefone. Os dados chegam agregados.
- Textos vindos do banco (nome de carga, cidade, nome de consultor) passam por `escapeHtml`.
- Período: Hoje · Ontem · 7 dias · Mês · Personalizado. Abre em Hoje. No máximo 120 dias, como no banco (`p_ate - p_de > 120` recusa).
- Alerta de abandono: só no filtro "Hoje". Olha a última hora cheia: abandonadas ÷ contato da hora maior que `abandono_alerta` (vem do `discador_resumo`, padrão 0,15), **com pelo menos 10 contatos na hora**. Ver Ruling R1.
- Faixa de sincronização parada: mesma regra das ligações manuais, `ligMinutosUteisSemSync(ms, agora) > LIG_SYNC_LIMITE_MIN` (180 min úteis, seg–sáb 07–22h), usando `ultima_sync` do `discador_resumo`. Sem nenhuma sincronização, não mostra nada.
- Destaque de consultor: valor mais de 30% pior que a média da equipe, ponderada pelas atendidas. Vale para % sem avanço (maior é pior), % sem tabulação (maior é pior) e conversão (menor é pior). Só entra quem tem pelo menos 20 atendidas no período. Ver Ruling R2.
- Testes com dados fictícios (nomes "Teste", cargas "ZZ-…"). Repositório público.
- REGRAS_NEGOCIO.md: esta frente é a **§87**.
- Publicar só com ok do Rafael naquele momento: comparar com o painel no ar, backup, MD5, vigia `-Aceitar` (Task 5).

**Rulings já tomados neste plano:**
- **R1 (alerta com mínimo de 10 contatos):** sem esse mínimo, 1 abandono em 2 contatos às 9h dispararia "segurar o ritmo". Custo se errado: o alerta demora uma hora a mais em dias muito fracos.
- **R2 (destaque com mínimo de 20 atendidas):** sem esse mínimo, quem atendeu 4 chamadas sempre sairia destacado. Custo se errado: um consultor novo com poucas chamadas não é destacado.

## Review Focus

1. **Troca rápida de período** (clicar Hoje → Mês → Ontem antes da resposta). Esperado: só a última resposta aparece (contador de geração). Testado na Task 3.
2. **Uma RPC falhando** (ex.: timeout no mapa de calor). Esperado: só aquele bloco mostra "Não foi possível carregar"; o resto aparece. Testado na Task 3.
3. **Período sem nenhuma chamada** (domingo, feriado, "Hoje" antes do discador começar). Esperado: cartões com 0 e "—" nas taxas, sem divisão por zero nem `NaN`. Testado na Task 2.
4. **Texto do banco com HTML** (carga ou cidade com `<`). Esperado: aparece escapado. Testado na Task 2.
5. **Personalizado inválido** (até antes de de, mais de 120 dias, campo vazio). Esperado: aviso e nenhuma RPC chamada. Testado na Task 3.

---

## File Structure

- Modify `_template.html`:
  - menu: botão `tabBtnDiscador` depois do `tabBtnBoletim` (~linha 811);
  - painel: `<section class="panel" id="panel-discador">` depois do `panel-boletim` (~linha 1202);
  - roteador de abas: `if(btn.dataset.tab === 'discador') dcCarregar();` (~linha 2623);
  - login: `dcAplicarPermissao();` depois de `bmAplicarPermissao();` (~linha 2377);
  - JS: bloco novo `/* ============ DISCADOR (seção 87) ============ */` logo depois do bloco do Boletim (depois do listener de `bmSeletor`, ~linha 12400).
- Create `test_discador.js`: testes no jsdom com o mesmo esqueleto de `test_mesa_supervisor.js`.
- Modify `docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md`: §8 (local) e §13.
- Modify `REGRAS_NEGOCIO.md`: §87 (Task 5).

Comandos rodam do worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\discador-supervisao`. Para os testes, usar `NODE_PATH=../boletim-manha/node_modules`, que tem jsdom, xlsx e jspdf.

---

### Task 1: Funções puras de formatação, período e indicadores

**Files:**
- Modify: `_template.html` (bloco JS novo)
- Create: `test_discador.js`
- Modify: `docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md`

**Interfaces:**
- Produces:
  - constantes `DC_MAX_DIAS = 120`, `DC_MIN_CONTATOS_ALERTA = 10`, `DC_MIN_ATENDIDAS_DESTAQUE = 20`;
  - `dcEstado = { geracao: 0, chave: 'hoje', de: null, ate: null }`;
  - `canSeeDiscador() → boolean`;
  - `dcPeriodo(chave, hoje, de, ate) → {de, ate} | null`;
  - `dcTaxa(n, d) → number | null`;
  - `dcFmtPct(x) → string`, com 1 casa e vírgula, ou '—';
  - `dcFmtNum(n) → string`, no padrão pt-BR;
  - `dcFmtSeg(s) → string`;
  - `dcDdMm(dia) → 'dd/mm'`;
  - `dcAlertaAbandono(porHora, horaAgora, limite) → {hora, taxa, abandonadas, contato} | null`;
  - `dcMediaEquipe(consultores) → {semAvanco, semTab, conversao}`;
  - `dcPiorQueMedia(valor, media, maiorEhPior) → boolean`.

- [ ] **Step 1: Criar `test_discador.js` com o esqueleto e os testes das funções puras**

```js
// Testa a aba Discador (15/10/2026) — REGRAS_NEGOCIO.md §87.
// Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__rpcAtraso = {};
window.__tabelas = {};
window.__avisos = [];
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    const atraso = window.__rpcAtraso[nome] || 0;
    const p = new Promise(ok => setTimeout(() => ok(res), atraso));
    return { range: () => p, then: (ok, ko) => p.then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const avisos = [];
  mostrarAviso = (msg, tipo) => avisos.push([tipo, String(msg)]);

  // ==== TASK 1: funções puras ====
  eq(dcPeriodo('hoje', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'hoje');
  eq(dcPeriodo('ontem', '2026-10-01'), { de: '2026-09-30', ate: '2026-09-30' }, 'ontem atravessa o mês');
  eq(dcPeriodo('7dias', '2026-10-15'), { de: '2026-10-09', ate: '2026-10-15' }, '7 dias inclui hoje');
  eq(dcPeriodo('mes', '2026-10-15'), { de: '2026-10-01', ate: '2026-10-15' }, 'mês até hoje');
  eq(dcPeriodo('custom', '2026-10-15', '2026-09-01', '2026-10-10'), { de: '2026-09-01', ate: '2026-10-10' }, 'personalizado válido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-10-10', '2026-10-01'), null, 'personalizado invertido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-01-01', '2026-10-01'), null, 'personalizado acima de 120 dias');
  eq(dcPeriodo('custom', '2026-10-15', '2026-06-03', '2026-10-01'), { de: '2026-06-03', ate: '2026-10-01' }, '120 dias exatos valem');
  eq(dcPeriodo('custom', '2026-10-15', '', '2026-10-01'), null, 'personalizado vazio');
  eq(dcPeriodo('xyz', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'chave desconhecida = hoje');

  eq(dcTaxa(1, 4), 0.25, 'taxa');
  eq(dcTaxa(3, 0), null, 'taxa com divisor 0');
  eq(dcFmtPct(0.30627), '30,6%', 'pct com 1 casa');
  eq(dcFmtPct(null), '—', 'pct nulo');
  eq(dcFmtNum(139925), '139.925', 'milhar pt-BR');
  eq(dcFmtNum(null), '0', 'número nulo');
  eq(dcFmtSeg(48), '48 s', 'segundos');
  eq(dcFmtSeg(125), '2 min 05 s', 'minutos');
  eq(dcFmtSeg(null), '—', 'segundos nulos');
  eq(dcDdMm('2026-10-05'), '05/10', 'dd/mm');

  const ph = [
    { hora: 13, contato: 40, abandonadas: 4 },
    { hora: 14, contato: 50, abandonadas: 10 },
    { hora: 15, contato: 8, abandonadas: 6 },
  ];
  eq(dcAlertaAbandono(ph, 15, 0.15), { hora: 14, taxa: 0.2, abandonadas: 10, contato: 50 }, 'às 15h olha 14h: 20% > 15%');
  eq(dcAlertaAbandono(ph, 14, 0.15), null, 'às 14h olha 13h: 10% não alerta');
  eq(dcAlertaAbandono(ph, 16, 0.15), null, 'às 16h olha 15h: só 8 contatos, sem alerta');
  eq(dcAlertaAbandono(ph, 9, 0.15), null, 'hora sem linha');
  eq(dcAlertaAbandono(null, 15, 0.15), null, 'sem dados');

  const cons = [
    { atendidas: 100, sem_avanco: 50, sem_tabulacao: 2, vendas: 4 },
    { atendidas: 100, sem_avanco: 30, sem_tabulacao: 8, vendas: 0 },
    { atendidas: 5, sem_avanco: 5, sem_tabulacao: 5, vendas: 0 },
  ];
  const m = dcMediaEquipe(cons);
  eq([Math.round(m.semAvanco * 1000), Math.round(m.semTab * 1000), Math.round(m.conversao * 1000)], [415, 73, 20], 'média ponderada pelas atendidas');
  eq(dcMediaEquipe([]), { semAvanco: null, semTab: null, conversao: null }, 'equipe vazia');
  eq(dcPiorQueMedia(0.6, 0.4, true), true, 'sem avanço 50% acima: pior');
  eq(dcPiorQueMedia(0.5, 0.4, true), false, 'sem avanço 25% acima: normal');
  eq(dcPiorQueMedia(0.01, 0.02, false), true, 'conversão 50% abaixo: pior');
  eq(dcPiorQueMedia(0.5, null, true), false, 'sem média: nunca destaca');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `FALHA: ReferenceError: dcPeriodo is not defined`.

- [ ] **Step 3: Inserir o bloco JS no `_template.html`**

Inserir logo **antes** da linha `document.getElementById('bmSeletor').addEventListener('change', async function(){`. É um ponto de top-level do script, depois de `bmVerificarHora`:

```js
/* ============ DISCADOR (15/10/2026, seção 87) — admin/supervisor ============
   Discador automático do ProContact: ritmo/abandono por hora, consultores e mailing, a partir das RPCs discador_*
   (spec docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md). O banco devolve só agregados: nenhuma
   tela mostra cliente, CNPJ ou telefone. Consultor não vê o botão e nada é consultado; a proteção real são as RPCs. */
const DC_MAX_DIAS = 120;               // igual ao limite das RPCs (p_ate - p_de > 120 é recusado)
const DC_MIN_CONTATOS_ALERTA = 10;     // alerta de abandono só com amostra mínima na hora
const DC_MIN_ATENDIDAS_DESTAQUE = 20;  // destaque de consultor só com amostra mínima no período
const dcEstado = { geracao: 0, chave: 'hoje', de: null, ate: null };
function canSeeDiscador(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor') && veAbasDaApex(); }
function dcPeriodo(chave, hoje, de, ate){
  if(chave === 'ontem'){ const d = somaDiasStr(hoje, -1); return { de: d, ate: d }; }
  if(chave === '7dias') return { de: somaDiasStr(hoje, -6), ate: hoje };
  if(chave === 'mes') return { de: hoje.slice(0, 8) + '01', ate: hoje };
  if(chave === 'custom'){
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if(!re.test(de || '') || !re.test(ate || '') || ate < de) return null;
    const dias = (Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000;
    return dias > DC_MAX_DIAS ? null : { de, ate };
  }
  return { de: hoje, ate: hoje };
}
function dcTaxa(n, d){ return Number(d) > 0 ? (Number(n) || 0) / Number(d) : null; }
function dcFmtPct(x){ return x === null || x === undefined || !Number.isFinite(x) ? '—' : (x * 100).toFixed(1).replace('.', ',') + '%'; }
function dcFmtNum(n){ return (Number(n) || 0).toLocaleString('pt-BR'); }
function dcFmtSeg(s){
  if(s === null || s === undefined || !Number.isFinite(Number(s))) return '—';
  const v = Math.round(Number(s));
  return v < 60 ? v + ' s' : Math.floor(v / 60) + ' min ' + String(v % 60).padStart(2, '0') + ' s';
}
function dcDdMm(dia){ return String(dia).slice(8, 10) + '/' + String(dia).slice(5, 7); }
// Última hora cheia (horaAgora - 1): abandono acima do limite, com amostra mínima.
function dcAlertaAbandono(porHora, horaAgora, limite){
  if(!Array.isArray(porHora)) return null;
  const h = porHora.find(x => Number(x.hora) === horaAgora - 1);
  if(!h || Number(h.contato) < DC_MIN_CONTATOS_ALERTA) return null;
  const taxa = dcTaxa(h.abandonadas, h.contato);
  return taxa !== null && taxa > Number(limite) ? { hora: Number(h.hora), taxa, abandonadas: Number(h.abandonadas), contato: Number(h.contato) } : null;
}
// Médias da equipe ponderadas pelas atendidas (quem atende mais pesa mais).
function dcMediaEquipe(consultores){
  const s = (consultores || []).reduce((a, c) => {
    a.at += Number(c.atendidas) || 0; a.sa += Number(c.sem_avanco) || 0; a.st += Number(c.sem_tabulacao) || 0; a.v += Number(c.vendas) || 0;
    return a;
  }, { at: 0, sa: 0, st: 0, v: 0 });
  return { semAvanco: dcTaxa(s.sa, s.at), semTab: dcTaxa(s.st, s.at), conversao: dcTaxa(s.v, s.at) };
}
// Mais de 30% pior que a média (maiorEhPior: % sem avanço e sem tabulação; senão: conversão).
function dcPiorQueMedia(valor, media, maiorEhPior){
  if(valor === null || media === null || media === undefined || !Number.isFinite(valor)) return false;
  return maiorEhPior ? valor > media * 1.3 : valor < media * 0.7;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `--- RESULTADO: 31 passaram, 0 falharam ---`.

- [ ] **Step 5: Ajustar a spec**

Em `docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md`:
- na §8, trocar `Local: Dashboard de Produção, ao lado de Pedidos em Alerta e Vendas Perdidas. Visível só para admin/supervisor (mesmo controle dessas sub-abas).` por `Local: item próprio "Discador" no menu lateral, grupo "Visão geral", depois do Boletim da Manhã (decisão do Rafael em 15/10: o Dashboard é um iframe com dados injetados e não reconsulta o banco por período). Visível só para admin/supervisor da operação Apex (mesmo critério do Boletim).`;
- na §13, no item 3, trocar `sub-aba Discador` por `aba Discador no menu lateral`.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_discador.js docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
git commit -m "feat(discador): funcoes puras da aba Discador (periodo, taxas, alerta, media da equipe) (secao 87)"
```

---

### Task 2: Montagem do HTML dos blocos

**Files:**
- Modify: `_template.html` (continua o bloco JS da Task 1)
- Test: `test_discador.js`

**Interfaces:**
- Consumes: as funções da Task 1; `escapeHtml`; classes `bm*`, `tbl`, `mlTabelaWrap`, `badge`, `ppVazio`.
- Produces (todas devolvem string HTML; `null` de entrada = bloco "Não foi possível carregar"):
  - `dcKpisHtml(resumo)`, onde `resumo` é a linha de `discador_resumo`;
  - `dcHorasHtml(porHora, comMedia)`, com as linhas de `discador_por_hora`;
  - `dcCalorHtml(mapa)`, com as linhas de `discador_mapa_calor`;
  - `dcConsultoresHtml(consultores)`, com as linhas de `discador_consultores`;
  - `dcMailingHtml(linhas, rotuloChave)`, com as linhas de `discador_mailing`;
  - `dcDiasHtml(nome, linhas)`, com as linhas de `discador_consultor_dias`;
  - `dcVinculoHtml(semVinculo, perfis)`, com as linhas de `discador_agentes_sem_vinculo` e `profiles`;
  - `dcFalhou(titulo)`.

- [ ] **Step 1: Escrever os testes** (substituir a linha `// ==== mais testes entram aqui ====` por este bloco seguido da mesma linha)

```js
  // ==== TASK 2: HTML dos blocos ====
  const R = { tentativas: 139925, contato: 8551, atendidas: 5932, abandonadas: 2619, sem_tabulacao: 47, seg_falados_medio: 48, vendas: 34, abandono_alerta: 0.15, ultima_sync: null };
  const k = dcKpisHtml(R);
  assert(k.includes('139.925') && k.includes('6,1%') && k.includes('30,6%') && k.includes('5.932') && k.includes('48 s') && k.includes('>34<'), 'cartões com números formatados');
  assert(k.includes('47 sem tabulação'), 'sub das atendidas');
  const k0 = dcKpisHtml({ tentativas: 0, contato: 0, atendidas: 0, abandonadas: 0, sem_tabulacao: 0, seg_falados_medio: null, vendas: 0 });
  assert(!k0.includes('NaN') && k0.includes('—'), 'período vazio: sem NaN, taxas com traço');
  assert(dcKpisHtml(null).includes('Não foi possível carregar'), 'resumo com erro');

  const horas = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ hora: h, tentativas: h === 14 ? 2935 : 0, contato: h === 14 ? 137 : 0, atendidas: h === 14 ? 120 : 0, abandonadas: h === 14 ? 17 : 0, media_atendidas: h === 14 ? 101 : 0, media_abandonadas: h === 14 ? 31 : 0 }));
  const hh = dcHorasHtml(horas, true);
  assert((hh.match(/class="bmHora"/g) || []).length === 13, '13 colunas de hora');
  assert(hh.includes('14h') && hh.includes('12,4%'), 'hora 14 com % de abandono (17/137)');
  assert(hh.includes('dashed'), 'linha da média quando comMedia');
  assert(!dcHorasHtml(horas, false).includes('dashed'), 'sem média em período de vários dias');
  assert(dcHorasHtml(null, true).includes('Não foi possível carregar'), 'por hora com erro');

  const calor = [{ dia_semana: 1, hora: 14, tentativas: 1000, contato: 80 }, { dia_semana: 3, hora: 10, tentativas: 500, contato: 10 }];
  const ch = dcCalorHtml(calor);
  assert(ch.includes('bmCalor') && ch.includes('Seg') && ch.includes('Qua') && ch.includes('8,0%') && ch.includes('2,0%'), 'mapa de calor com taxa de contato');
  assert(dcCalorHtml([]).includes('Sem chamadas'), 'mapa vazio');

  const consultores = [
    { agente_id: 189, profile_id: null, nome: 'Agente 189', atendidas: 100, seg_falados_total: 4800, seg_falados_medio: 48, sem_avanco: 60, retornos: 5, ganhos: 1, sem_tabulacao: 1, vendas: 3 },
    { agente_id: 193, profile_id: 'p1', nome: 'Caio Teste', atendidas: 100, seg_falados_total: 6000, seg_falados_medio: 60, sem_avanco: 30, retornos: 2, ganhos: 2, sem_tabulacao: 9, vendas: 0 },
    { agente_id: 93, profile_id: null, nome: 'Agente 93', atendidas: 4, seg_falados_total: 12, seg_falados_medio: 3, sem_avanco: 4, retornos: 0, ganhos: 0, sem_tabulacao: 4, vendas: 0 },
  ];
  const ct = dcConsultoresHtml(consultores);
  assert(ct.includes('data-dc-agente="189"') && ct.includes('Caio Teste') && ct.includes('60,0%'), 'linha por agente, clicável');
  assert(/data-dc-agente="189"[^]*?dcPior[^]*?60,0%/.test(ct), 'agente 189: sem avanço 60% vs média ~44% → destacado');
  assert(/data-dc-agente="193"[^]*?dcPior[^]*?9,0%/.test(ct), 'agente 193: sem tabulação 9% vs média ~6,9% → destacado');
  assert(!ct.split('data-dc-agente="93"')[1].split('</tr>')[0].includes('dcPior'), 'agente 93 com 4 atendidas não é destacado');
  assert(dcConsultoresHtml([]).includes('Ninguém atendeu'), 'sem consultores');

  const ml = dcMailingHtml([{ chave: 'ZZ-CARGA <b>1</b>', tentativas: 45570, contato: 2524, atendidas: 1854, abandonadas: 670, ganhos: 5, vendas: 15 }], 'Carga');
  assert(ml.includes('ZZ-CARGA &lt;b&gt;1&lt;/b&gt;') && !ml.includes('<b>1</b>'), 'texto do banco escapado');
  assert(ml.includes('45.570') && ml.includes('5,5%') && ml.includes('26,5%') && ml.includes('0,33'), 'contato, abandono e vendas por mil');
  assert(dcMailingHtml([], 'Cidade').includes('Sem dados'), 'mailing vazio');

  const dd = dcDiasHtml('Caio Teste', [{ dia: '2026-10-05', atendidas: 30, seg_falados_total: 1500, sem_avanco: 10, ganhos: 1, vendas: 2 }]);
  assert(dd.includes('Caio Teste') && dd.includes('05/10') && dd.includes('25 min 00 s'), 'detalhe por dia');

  const vh = dcVinculoHtml([{ agente_id: 189, atendidas_30d: 971, ultima_chamada: '2026-10-14T19:00:00Z' }], [{ id: 'p1', nome: 'Caio Teste', role: 'consultor' }, { id: 'p2', nome: 'Ana <Teste>', role: 'supervisor' }]);
  assert(vh.includes('1 agente sem consultor') && vh.includes('Agente 189') && vh.includes('971'), 'vínculo: lista');
  assert(vh.includes('data-dc-vinc="189"') && vh.includes('value="p1"') && vh.includes('Ana &lt;Teste&gt;'), 'vínculo: seletor com perfis escapados');
  eq(dcVinculoHtml([], []), '', 'sem pendências: nada');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `FALHA: ReferenceError: dcKpisHtml is not defined`.

- [ ] **Step 3: Implementar** (acrescentar ao fim do bloco JS da Task 1)

```js
const DC_DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dcFalhou(titulo){ return `<div class="bmCard"><h4>${escapeHtml(titulo)}</h4><p class="ppVazio">Não foi possível carregar agora. Tente de novo em instantes.</p></div>`; }
function dcKpisHtml(r){
  if(!r) return dcFalhou('Resumo');
  const e = escapeHtml;
  const kpi = (rot, num, sub) => `<div class="bmCard bmKpi"><div class="bmRot">${e(rot)}</div><div class="bmNum">${e(num)}</div><div class="bmSub">${e(sub)}</div></div>`;
  return '<div class="bmGrade bmG6">'
    + kpi('Tentativas', dcFmtNum(r.tentativas), 'discagens no período')
    + kpi('Taxa de contato', dcFmtPct(dcTaxa(r.contato, r.tentativas)), dcFmtNum(r.contato) + ' atenderam')
    + kpi('Abandono', dcFmtPct(dcTaxa(r.abandonadas, r.contato)), dcFmtNum(r.abandonadas) + ' sem consultor livre')
    + kpi('Atendidas', dcFmtNum(r.atendidas), dcFmtNum(r.sem_tabulacao) + ' sem tabulação')
    + kpi('Tempo médio falado', dcFmtSeg(r.seg_falados_medio), 'por atendimento')
    + `<div class="bmCard bmKpi"><div class="bmRot">Vendas do discador</div><div class="bmNum">${e(dcFmtNum(r.vendas))}</div><div class="bmSub">pedido no NEO com CNPJ atendido até 30 dias antes</div></div>`
    + '</div>';
}
function dcHorasHtml(porHora, comMedia){
  if(!Array.isArray(porHora)) return dcFalhou('Ritmo por hora');
  const e = escapeHtml;
  const max = Math.max(1, ...porHora.map(h => Math.max(Number(h.contato) || 0, comMedia ? (Number(h.media_atendidas) || 0) + (Number(h.media_abandonadas) || 0) : 0)));
  const col = h => {
    const at = Number(h.atendidas) || 0, ab = Number(h.abandonadas) || 0, ct = Number(h.contato) || 0;
    const media = comMedia ? (Number(h.media_atendidas) || 0) + (Number(h.media_abandonadas) || 0) : 0;
    const taxa = dcTaxa(ab, ct);
    const titulo = `${h.hora}h: ${ct} contatos, ${at} atendidas, ${ab} abandonadas` + (comMedia ? ` · média do mesmo dia da semana: ${dcFmtNum(media)} contatos` : '');
    return `<div class="bmHora" style="position:relative" title="${e(titulo)}"><b>${ct ? e(dcFmtPct(taxa)) : ''}</b>`
      + `<i style="height:${Math.round(ab / max * 100)}%;background:var(--c-carmim)"></i><i style="height:${Math.round(at / max * 100)}%"></i>`
      + (comMedia && media ? `<u style="position:absolute;left:0;right:0;bottom:calc(${Math.round(media / max * 100)}% * .85 + 16px);border-top:2px dashed var(--c-grafite)"></u>` : '')
      + `<span>${e(String(h.hora))}h</span></div>`;
  };
  return `<div class="bmHoras">${porHora.map(col).join('')}</div>`
    + `<div class="bmLegenda"><i style="background:var(--c-sinal)"></i>atendidas<i style="background:var(--c-carmim)"></i>abandonadas · número em cima = % de abandono da hora`
    + (comMedia ? ' · tracejado = média de contatos do mesmo dia da semana nas 4 semanas anteriores' : '') + '</div>';
}
function dcCalorHtml(mapa){
  if(!Array.isArray(mapa)) return dcFalhou('Melhor hora para ligar');
  if(!mapa.length) return '<p class="ppVazio">Sem chamadas no período.</p>';
  const dias = [...new Set(mapa.map(x => Number(x.dia_semana)))].sort((a, b) => a - b);
  const horas = [...new Set(mapa.map(x => Number(x.hora)))].sort((a, b) => a - b);
  const cel = new Map(mapa.map(x => [x.dia_semana + '-' + x.hora, x]));
  const taxas = mapa.map(x => dcTaxa(x.contato, x.tentativas) || 0), max = Math.max(0.0001, ...taxas);
  return `<div class="mlTabelaWrap"><table class="bmCalor"><thead><tr><th></th>${horas.map(h => `<th>${h}h</th>`).join('')}</tr></thead><tbody>`
    + dias.map(d => `<tr><td>${DC_DIAS_CURTOS[d] || d}</td>${horas.map(h => {
        const x = cel.get(d + '-' + h), t = x ? dcTaxa(x.contato, x.tentativas) : null;
        if(t === null) return '<td style="background:var(--c-papel)"></td>';
        const forca = Math.round(15 + 85 * t / max);
        return `<td title="${escapeHtml(dcFmtNum(x.tentativas) + ' tentativas')}" style="background:color-mix(in srgb, var(--c-sinal) ${forca}%, var(--c-branco));color:${forca > 55 ? 'var(--c-branco)' : 'var(--c-grafite)'}">${dcFmtPct(t)}</td>`;
      }).join('')}</tr>`).join('')
    + '</tbody></table></div><div class="bmLegenda">Taxa de contato (cliente atendeu ÷ tentativas). Mais escuro = hora em que o mailing mais atende.</div>';
}
function dcConsultoresHtml(lista){
  if(!Array.isArray(lista)) return dcFalhou('Consultores');
  if(!lista.length) return '<p class="ppVazio">Ninguém atendeu pelo discador no período.</p>';
  const e = escapeHtml, med = dcMediaEquipe(lista);
  const td = (txt, pior) => `<td${pior ? ' class="dcPior" style="color:var(--st-perdido);font-weight:700"' : ''}>${e(txt)}</td>`;
  const linhas = lista.map(c => {
    const at = Number(c.atendidas) || 0, amostra = at >= DC_MIN_ATENDIDAS_DESTAQUE;
    const sa = dcTaxa(c.sem_avanco, at), st = dcTaxa(c.sem_tabulacao, at), cv = dcTaxa(c.vendas, at);
    return `<tr data-dc-agente="${e(String(c.agente_id))}" data-dc-nome="${e(c.nome || '')}" style="cursor:pointer" title="Ver por dia">`
      + `<td>${e(c.nome || ('Agente ' + c.agente_id))}${c.profile_id ? '' : ' <span class="badge">sem vínculo</span>'}</td>`
      + td(dcFmtNum(at)) + td(dcFmtSeg(c.seg_falados_total)) + td(dcFmtSeg(c.seg_falados_medio))
      + td(dcFmtPct(sa), amostra && dcPiorQueMedia(sa, med.semAvanco, true))
      + td(dcFmtNum(c.retornos)) + td(dcFmtNum(c.ganhos))
      + td(dcFmtPct(st), amostra && dcPiorQueMedia(st, med.semTab, true))
      + td(dcFmtNum(c.vendas)) + td(dcFmtPct(cv), amostra && dcPiorQueMedia(cv, med.conversao, false)) + '</tr>';
  }).join('');
  return '<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Consultor</th><th>Atendidas</th><th>Falado</th><th>Médio</th><th>% sem avanço</th><th>Retornos</th><th>Ganhos</th><th>% sem tabulação</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>'
    + linhas + '</tbody></table></div>'
    + `<div class="bmLegenda">Em vermelho: mais de 30% pior que a média da equipe (sem avanço ${e(dcFmtPct(med.semAvanco))} · sem tabulação ${e(dcFmtPct(med.semTab))} · conversão ${e(dcFmtPct(med.conversao))}), só para quem atendeu ${DC_MIN_ATENDIDAS_DESTAQUE} ou mais. Clique na linha para ver por dia.</div>`;
}
function dcMailingHtml(linhas, rotuloChave){
  if(!Array.isArray(linhas)) return dcFalhou(rotuloChave);
  if(!linhas.length) return '<p class="ppVazio">Sem dados no período.</p>';
  const e = escapeHtml;
  return `<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>${e(rotuloChave)}</th><th>Tentativas</th><th>Contato</th><th>Abandono</th><th>Atendidas</th><th>Ganhos</th><th>Vendas</th><th>Vendas / 1.000</th></tr></thead><tbody>`
    + linhas.map(l => {
      const pm = dcTaxa(l.vendas, l.tentativas);
      return `<tr><td>${e(l.chave)}</td><td>${e(dcFmtNum(l.tentativas))}</td><td>${e(dcFmtPct(dcTaxa(l.contato, l.tentativas)))}</td><td>${e(dcFmtPct(dcTaxa(l.abandonadas, l.contato)))}</td>`
        + `<td>${e(dcFmtNum(l.atendidas))}</td><td>${e(dcFmtNum(l.ganhos))}</td><td>${e(dcFmtNum(l.vendas))}</td><td>${pm === null ? '—' : e((pm * 1000).toFixed(2).replace('.', ','))}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}
function dcDiasHtml(nome, linhas){
  if(!Array.isArray(linhas)) return dcFalhou('Por dia');
  const e = escapeHtml;
  const corpo = linhas.length
    ? '<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Dia</th><th>Atendidas</th><th>Falado</th><th>Sem avanço</th><th>Ganhos</th><th>Vendas</th></tr></thead><tbody>'
      + linhas.map(d => `<tr><td>${e(dcDdMm(d.dia))}</td><td>${e(dcFmtNum(d.atendidas))}</td><td>${e(dcFmtSeg(d.seg_falados_total))}</td><td>${e(dcFmtNum(d.sem_avanco))}</td><td>${e(dcFmtNum(d.ganhos))}</td><td>${e(dcFmtNum(d.vendas))}</td></tr>`).join('')
      + '</tbody></table></div>'
    : '<p class="ppVazio">Sem atendimentos no período.</p>';
  return `<div class="bmCard"><h4>${e(nome)} <small>por dia</small></h4>${corpo}</div>`;
}
function dcVinculoHtml(semVinculo, perfis){
  if(!Array.isArray(semVinculo) || !semVinculo.length) return '';
  const e = escapeHtml, n = semVinculo.length;
  const opcoes = '<option value="">Escolha o consultor…</option>' + (perfis || []).map(p => `<option value="${e(p.id)}">${e(p.nome || p.id)}</option>`).join('');
  return `<div class="bmCard bmAtencao"><h4>${n} agente${n === 1 ? '' : 's'} sem consultor <small>só o admin vê e liga cada número a uma pessoa</small></h4>`
    + semVinculo.map(a => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0"><b style="min-width:110px">Agente ${e(String(a.agente_id))}</b>`
      + `<span class="bmSub" style="min-width:150px">${e(dcFmtNum(a.atendidas_30d))} atendidas em 30 dias</span>`
      + `<select data-dc-vinc-sel="${e(String(a.agente_id))}" style="width:auto">${opcoes}</select>`
      + `<button type="button" class="btn btn-sm" data-dc-vinc="${e(String(a.agente_id))}" style="width:auto">Vincular</button></div>`).join('')
    + '</div>';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `0 falharam`. Se um teste de destaque (`dcPior`) falhar, recalcular a média à mão. Para os 3 consultores do teste:
- sem avanço = 94/204 = 46,1%; ×1,3 = 59,9%. O agente 189 tem 60%, então é destacado.
- sem tabulação = 14/204 = 6,9%; ×1,3 = 8,9%. O agente 193 tem 9%, então é destacado.

Corrigir o código, não o teste, salvo erro de aritmética do teste (ledger).

- [ ] **Step 5: Commit**

```bash
git add _template.html test_discador.js
git commit -m "feat(discador): HTML dos blocos (cartoes, ritmo, mapa, consultores, mailing, vinculo) (secao 87)"
```

---

### Task 3: Aba no menu, painel, carga e eventos

**Files:**
- Modify: `_template.html` (menu, painel, roteador, login, bloco JS)
- Test: `test_discador.js`

**Interfaces:**
- Consumes: Tasks 1–2; `sb`, `ppSeguro`, `hojeSP`, `vlPartesSP`, `ligMinutosUteisSemSync`, `LIG_SYNC_LIMITE_MIN`, `mostrarAviso`, `currentUser`.
- Produces:
  - `dcAplicarPermissao()`;
  - `dcResetar()`;
  - `dcCarregar() → Promise<void>`;
  - `dcAbrirDias(agenteId, nome) → Promise<void>`;
  - `dcVincular(agenteId, profileId) → Promise<void>`;
  - DOM: `#tabBtnDiscador`, `#panel-discador`, `#dcStatus`, `#dcPeriodos`, `#dcCustom`, `#dcDe`, `#dcAte`, `#btnDcAplicar`, `#dcAvisos`, `#dcVinculo`, `#dcConteudo`, `#dcDetalhe`.

- [ ] **Step 1: Escrever os testes** (antes da linha `// ==== mais testes entram aqui ====`)

```js
  // ==== TASK 3: permissão, carga e eventos ====
  const respostasOk = () => {
    window.__rpcRespostas = {
      discador_resumo: { data: [Object.assign({}, R, { ultima_sync: new Date(Date.now() - 30 * 60000).toISOString() })], error: null },
      discador_por_hora: { data: horas, error: null },
      discador_mapa_calor: { data: calor, error: null },
      discador_consultores: { data: consultores, error: null },
      discador_mailing: (a) => ({ data: [{ chave: 'ZZ-' + a.p_dim, tentativas: 1000, contato: 60, atendidas: 40, abandonadas: 20, ganhos: 1, vendas: 2 }], error: null }),
      discador_agentes_sem_vinculo: { data: [{ agente_id: 189, atendidas_30d: 971, ultima_chamada: null }], error: null },
      discador_consultor_dias: { data: [{ dia: '2026-10-05', atendidas: 30, seg_falados_total: 1500, sem_avanco: 10, ganhos: 1, vendas: 2 }], error: null },
      discador_vincular_agente: { data: null, error: null },
    };
  };
  respostasOk();
  window.__tabelas.profiles = [{ id: 'p1', nome: 'Caio Teste', role: 'consultor' }];

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  dcAplicarPermissao();
  assert(document.getElementById('tabBtnDiscador').style.display === 'none', 'consultor não vê o botão');
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera();
  assert(!window.__rpcCalls.length && document.getElementById('dcConteudo').innerHTML === '', 'consultor: nenhuma RPC, nada na tela');

  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  dcAplicarPermissao();
  assert(document.getElementById('tabBtnDiscador').style.display !== 'none', 'supervisor vê o botão');
  window.__rpcCalls.length = 0;
  document.querySelector('#tabsNav button[data-tab="discador"]').click(); await espera(60);
  const nomes = window.__rpcCalls.map(c => c.nome).filter(n => n.startsWith('discador_')).sort();
  eq(nomes, ['discador_consultores', 'discador_mailing', 'discador_mailing', 'discador_mailing', 'discador_mapa_calor', 'discador_por_hora', 'discador_resumo'], 'supervisor: 7 RPCs, sem vínculo');
  const hoje = hojeSP();
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: hoje, p_ate: hoje }, 'abre em Hoje');
  eq(window.__rpcCalls.filter(c => c.nome === 'discador_mailing').map(c => c.args.p_dim).sort(), ['carga', 'cidade', 'operadora'], 'mailing nas 3 dimensões');
  const tela = document.getElementById('dcConteudo').innerHTML;
  assert(tela.includes('139.925') && tela.includes('bmHoras') && tela.includes('bmCalor') && tela.includes('data-dc-agente') && tela.includes('ZZ-carga') && tela.includes('ZZ-cidade'), 'todos os blocos na tela');
  assert(document.getElementById('dcVinculo').innerHTML === '', 'supervisor não vê o vínculo');
  assert(document.getElementById('dcStatus').textContent.includes('Hoje'), 'status com o período');
  assert(!document.getElementById('dcAvisos').textContent.includes('não sincroniza'), 'sync recente: sem faixa');

  // detalhe por dia
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  eq(window.__rpcCalls.map(c => [c.nome, c.args.p_agente]), [['discador_consultor_dias', 193]], 'clique no consultor busca por dia');
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste') && document.getElementById('dcDetalhe').innerHTML.includes('05/10'), 'detalhe renderizado');

  // período: Mês
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="mes"]').click(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: hoje.slice(0, 8) + '01', p_ate: hoje }, 'Mês: do dia 1 até hoje');
  assert(document.querySelector('#dcPeriodos [data-dc-periodo="mes"]').classList.contains('active'), 'pílula ativa');
  assert(document.getElementById('dcDetalhe').innerHTML === '', 'trocar período limpa o detalhe');

  // personalizado inválido: aviso, nenhuma RPC
  document.querySelector('#dcPeriodos [data-dc-periodo="custom"]').click(); await espera();
  assert(document.getElementById('dcCustom').style.display !== 'none', 'personalizado mostra as datas');
  document.getElementById('dcDe').value = '2026-10-10'; document.getElementById('dcAte').value = '2026-10-01';
  window.__rpcCalls.length = 0; avisos.length = 0;
  document.getElementById('btnDcAplicar').click(); await espera(40);
  assert(!window.__rpcCalls.length && avisos.some(a => a[0] === 'erro'), 'personalizado inválido: aviso e nada consultado');
  document.getElementById('dcDe').value = '2026-10-01'; document.getElementById('dcAte').value = '2026-10-10';
  document.getElementById('btnDcAplicar').click(); await espera(60);
  eq(window.__rpcCalls.find(c => c.nome === 'discador_resumo').args, { p_de: '2026-10-01', p_ate: '2026-10-10' }, 'personalizado válido');

  // corrida: resposta antiga não sobrescreve a nova
  window.__rpcAtraso = { discador_resumo: 120 };
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { tentativas: 111 })], error: null };
  const lenta = dcCarregar();
  window.__rpcAtraso = {};
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { tentativas: 222 })], error: null };
  await dcCarregar(); await lenta; await espera(150);
  assert(document.getElementById('dcConteudo').innerHTML.includes('>222<') && !document.getElementById('dcConteudo').innerHTML.includes('>111<'), 'só a última carga aparece');

  // falha isolada
  respostasOk();
  window.__rpcRespostas.discador_mapa_calor = { data: null, error: { message: 'timeout' } };
  await dcCarregar(); await espera(60);
  const t2 = document.getElementById('dcConteudo').innerHTML;
  assert(t2.includes('Não foi possível carregar') && t2.includes('139.925') && t2.includes('data-dc-agente'), 'mapa falhou, resto aparece');

  // faixa de sync parado (última há 2 dias úteis) e alerta de abandono no Hoje
  respostasOk();
  window.__rpcRespostas.discador_resumo = { data: [Object.assign({}, R, { ultima_sync: new Date(Date.now() - 3 * 86400000).toISOString() })], error: null };
  const horaAgora = Math.floor(vlPartesSP(Date.now()).min / 60);
  window.__rpcRespostas.discador_por_hora = { data: [{ hora: horaAgora - 1, tentativas: 900, contato: 50, atendidas: 30, abandonadas: 20, media_atendidas: 0, media_abandonadas: 0 }], error: null };
  document.querySelector('#dcPeriodos [data-dc-periodo="hoje"]').click(); await espera(60);
  const av = document.getElementById('dcAvisos').textContent;
  assert(av.includes('não sincroniza'), 'faixa de sync parado');
  assert(av.includes('40,0%') && av.includes('segurar o ritmo'), 'alerta de abandono na última hora cheia');
  document.querySelector('#dcPeriodos [data-dc-periodo="ontem"]').click(); await espera(60);
  assert(!document.getElementById('dcAvisos').textContent.includes('segurar o ritmo'), 'alerta só no Hoje');

  // admin: vínculo
  respostasOk();
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  dcAplicarPermissao();
  window.__rpcCalls.length = 0;
  await dcCarregar(); await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'discador_agentes_sem_vinculo'), 'admin busca agentes sem vínculo');
  assert(document.getElementById('dcVinculo').innerHTML.includes('Agente 189'), 'admin vê o vínculo');
  avisos.length = 0; window.__rpcCalls.length = 0;
  document.querySelector('#dcVinculo [data-dc-vinc="189"]').click(); await espera(40);
  assert(!window.__rpcCalls.some(c => c.nome === 'discador_vincular_agente') && avisos.some(a => a[0] === 'erro'), 'sem escolher consultor: aviso, nada gravado');
  document.querySelector('#dcVinculo [data-dc-vinc-sel="189"]').value = 'p1';
  document.querySelector('#dcVinculo [data-dc-vinc="189"]').click(); await espera(80);
  eq((window.__rpcCalls.find(c => c.nome === 'discador_vincular_agente') || {}).args, { p_agente: 189, p_profile: 'p1', p_apelido: null }, 'vincula pela RPC');
  assert(avisos.some(a => a[0] === 'ok') && window.__rpcCalls.filter(c => c.nome === 'discador_resumo').length === 1, 'aviso ok e recarrega a aba');

  // trocar para consultor limpa a tela
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  dcAplicarPermissao();
  assert(document.getElementById('dcConteudo').innerHTML === '' && document.getElementById('dcVinculo').innerHTML === '', 'perdeu permissão: tela limpa');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `FALHA: ReferenceError: dcAplicarPermissao is not defined`.

- [ ] **Step 3: Botão do menu**

No `_template.html`, logo depois da linha do `<button data-tab="boletim" id="tabBtnBoletim" …>…</button>`, inserir:

```html
      <!-- 15/10/2026, seção 87: Discador automático do ProContact — admin/supervisor -->
      <button data-tab="discador" id="tabBtnDiscador" style="display:none" data-sub="Ritmo, consultores e mailing do discador automático"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><path d="M15 3v6h6"/></svg><span class="sbLabel">Discador</span></button>
```

- [ ] **Step 4: Painel**

Logo depois do `</section>` que fecha `<section class="panel" id="panel-boletim">` (antes do comentário `<!-- DASHBOARD DE PRODUÇÃO`), inserir:

```html
    <!-- DISCADOR (15/10/2026, seção 87) — admin/supervisor: discador automático do ProContact (ritmo, consultores, mailing).
         Para o consultor o botão some e o painel fica vazio (dcResetar); a proteção real são a RLS e as RPCs discador_*. -->
    <section class="panel" id="panel-discador">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><h3 style="margin:0">Discador</h3><p class="desc" id="dcStatus" style="margin:4px 0 0"></p></div>
          <div class="filterPills" id="dcPeriodos" style="margin:0">
            <button type="button" class="filterPill active" data-dc-periodo="hoje">Hoje</button>
            <button type="button" class="filterPill" data-dc-periodo="ontem">Ontem</button>
            <button type="button" class="filterPill" data-dc-periodo="7dias">7 dias</button>
            <button type="button" class="filterPill" data-dc-periodo="mes">Mês</button>
            <button type="button" class="filterPill" data-dc-periodo="custom">Personalizado</button>
          </div>
        </div>
        <div id="dcCustom" style="display:none;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:var(--space-3)">
          <div class="field" style="margin:0"><label for="dcDe">De</label><input type="date" id="dcDe"></div>
          <div class="field" style="margin:0"><label for="dcAte">Até</label><input type="date" id="dcAte"></div>
          <button type="button" class="btn btn-sm" id="btnDcAplicar" style="width:auto">Aplicar</button>
        </div>
      </div>
      <div id="dcAvisos"></div>
      <div id="dcVinculo"></div>
      <div id="dcConteudo"></div>
      <div id="dcDetalhe"></div>
    </section>
```

- [ ] **Step 5: Roteador e login**

No roteador de abas, depois de `if(btn.dataset.tab === 'boletim') bmGarantirDoDia()…;`, inserir:

```js
  if(btn.dataset.tab === 'discador') dcCarregar();
```

No login, depois de `bmAplicarPermissao();`, inserir:

```js
    // 15/10/2026 (seção 87): Discador — só admin/supervisor
    dcAplicarPermissao();
```

- [ ] **Step 6: Carga e eventos** (acrescentar ao fim do bloco JS do Discador)

```js
function dcResetar(){
  dcEstado.geracao++;
  ['dcConteudo', 'dcVinculo', 'dcDetalhe', 'dcAvisos'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
  const st = document.getElementById('dcStatus'); if(st) st.textContent = '';
}
function dcAplicarPermissao(){
  const vis = canSeeDiscador();
  document.getElementById('tabBtnDiscador').style.display = vis ? 'inline-block' : 'none';
  if(!vis) dcResetar();
}
const DC_ROTULOS = { hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias', mes: 'Mês até hoje', custom: 'Personalizado' };
function dcAvisosHtml(resumo, porHora, chave){
  const e = escapeHtml, partes = [];
  const ms = resumo && resumo.ultima_sync ? new Date(resumo.ultima_sync).getTime() : NaN;
  if(Number.isFinite(ms) && ligMinutosUteisSemSync(ms, Date.now()) > LIG_SYNC_LIMITE_MIN){
    const quando = new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    partes.push(`O discador não sincroniza desde ${quando}. Os números podem estar atrasados; avise o responsável técnico.`);
  }
  if(chave === 'hoje' && resumo){
    const a = dcAlertaAbandono(porHora, Math.floor(vlPartesSP(Date.now()).min / 60), resumo.abandono_alerta);
    if(a) partes.push(`Abandono de ${dcFmtPct(a.taxa)} às ${a.hora}h (${a.abandonadas} de ${a.contato} contatos sem consultor livre) — segurar o ritmo do discador.`);
  }
  return partes.map(p => `<div class="bmCard bmAtencao" style="margin-top:var(--space-3)">${e(p)}</div>`).join('');
}
async function dcCarregar(){
  if(!canSeeDiscador()) return;
  const p = dcPeriodo(dcEstado.chave, hojeSP(), dcEstado.de, dcEstado.ate);
  if(!p){ mostrarAviso('Período inválido: escolha datas em ordem, com no máximo ' + DC_MAX_DIAS + ' dias.', 'erro'); return; }
  const ger = ++dcEstado.geracao;
  const args = { p_de: p.de, p_ate: p.ate };
  const admin = currentUser.role === 'admin';
  document.getElementById('dcStatus').textContent = 'Carregando…';
  document.getElementById('dcDetalhe').innerHTML = '';
  const rpc = (nome, a) => ppSeguro(() => sb.rpc(nome, a));
  const [res, hora, calor, cons, carga, oper, cid, semV, perfis] = await Promise.all([
    rpc('discador_resumo', args), rpc('discador_por_hora', args), rpc('discador_mapa_calor', args), rpc('discador_consultores', args),
    rpc('discador_mailing', Object.assign({}, args, { p_dim: 'carga' })),
    rpc('discador_mailing', Object.assign({}, args, { p_dim: 'operadora' })),
    rpc('discador_mailing', Object.assign({}, args, { p_dim: 'cidade' })),
    admin ? rpc('discador_agentes_sem_vinculo', {}) : Promise.resolve(null),
    admin ? ppSeguro(() => sb.from('profiles').select('id,nome,role').order('nome')) : Promise.resolve(null),
  ]);
  if(ger !== dcEstado.geracao || !canSeeDiscador()) return;
  const dados = r => (r && !r.error && Array.isArray(r.data) ? r.data : null);
  [res, hora, calor, cons, carga, oper, cid, semV].forEach(r => { if(r && r.error) console.error('discador:', r.error); });
  const resumo = dados(res) ? (dados(res)[0] || null) : null, porHora = dados(hora);
  const quando = resumo && resumo.ultima_sync
    ? ' · dados até ' + new Date(resumo.ultima_sync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  document.getElementById('dcStatus').textContent = DC_ROTULOS[dcEstado.chave] + ': ' + (p.de === p.ate ? dcDdMm(p.de) : dcDdMm(p.de) + ' a ' + dcDdMm(p.ate)) + quando;
  document.getElementById('dcAvisos').innerHTML = dcAvisosHtml(resumo, porHora, dcEstado.chave);
  document.getElementById('dcVinculo').innerHTML = admin ? dcVinculoHtml(dados(semV), dados(perfis)) : '';
  const card = (titulo, sub, corpo) => `<div class="bmCard"><h4>${escapeHtml(titulo)}${sub ? ' <small>' + escapeHtml(sub) + '</small>' : ''}</h4>${corpo}</div>`;
  document.getElementById('dcConteudo').innerHTML = dcKpisHtml(resumo)
    + '<div class="bmSecao">Ritmo do discador</div>'
    + `<div class="bmGrade">${card('Contatos por hora', p.de === p.ate ? '' : 'soma do período', dcHorasHtml(porHora, p.de === p.ate))}</div>`
    + `<div class="bmGrade">${card('Melhor hora para ligar', 'taxa de contato por dia da semana e hora', dcCalorHtml(dados(calor)))}</div>`
    + '<div class="bmSecao">Consultores</div>'
    + `<div class="bmGrade">${card('Atendimentos do discador', '', dcConsultoresHtml(dados(cons)))}</div>`
    + '<div class="bmSecao">Mailing</div>'
    + `<div class="bmGrade">${card('Por carga', '', dcMailingHtml(dados(carga), 'Carga'))}</div>`
    + `<div class="bmGrade bmG2">${card('Por operadora de origem', '', dcMailingHtml(dados(oper), 'Operadora'))}${card('Por cidade', '15 maiores com 300+ tentativas', dcMailingHtml(dados(cid), 'Cidade'))}</div>`;
}
async function dcAbrirDias(agenteId, nome){
  if(!canSeeDiscador()) return;
  const p = dcPeriodo(dcEstado.chave, hojeSP(), dcEstado.de, dcEstado.ate);
  if(!p) return;
  const ger = dcEstado.geracao;
  const r = await ppSeguro(() => sb.rpc('discador_consultor_dias', { p_agente: agenteId, p_de: p.de, p_ate: p.ate }));
  if(ger !== dcEstado.geracao || !canSeeDiscador()) return;
  if(r && r.error) console.error('discador_consultor_dias:', r.error);
  const el = document.getElementById('dcDetalhe');
  el.innerHTML = dcDiasHtml(nome, r && !r.error && Array.isArray(r.data) ? r.data : null);
  if(typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function dcVincular(agenteId, profileId){
  if(!currentUser || currentUser.role !== 'admin') return;
  if(!profileId){ mostrarAviso('Escolha o consultor antes de vincular.', 'erro'); return; }
  const r = await ppSeguro(() => sb.rpc('discador_vincular_agente', { p_agente: agenteId, p_profile: profileId, p_apelido: null }));
  if(r && r.error){ console.error('discador_vincular_agente:', r.error); mostrarAviso('Não foi possível vincular agora.', 'erro'); return; }
  mostrarAviso('Agente ' + agenteId + ' vinculado.', 'ok');
  await dcCarregar();
}
document.getElementById('dcPeriodos').addEventListener('click', function(ev){
  const b = ev.target.closest('[data-dc-periodo]');
  if(!b) return;
  this.querySelectorAll('[data-dc-periodo]').forEach(x => x.classList.toggle('active', x === b));
  const custom = b.dataset.dcPeriodo === 'custom';
  document.getElementById('dcCustom').style.display = custom ? 'flex' : 'none';
  if(custom) return; // espera o "Aplicar"
  dcEstado.chave = b.dataset.dcPeriodo;
  dcCarregar();
});
document.getElementById('btnDcAplicar').addEventListener('click', function(){
  dcEstado.chave = 'custom';
  dcEstado.de = document.getElementById('dcDe').value;
  dcEstado.ate = document.getElementById('dcAte').value;
  dcCarregar();
});
document.getElementById('dcConteudo').addEventListener('click', function(ev){
  const tr = ev.target.closest('tr[data-dc-agente]');
  if(tr) dcAbrirDias(Number(tr.dataset.dcAgente), tr.dataset.dcNome || ('Agente ' + tr.dataset.dcAgente));
});
document.getElementById('dcVinculo').addEventListener('click', function(ev){
  const b = ev.target.closest('[data-dc-vinc]');
  if(!b) return;
  const sel = this.querySelector(`[data-dc-vinc-sel="${b.dataset.dcVinc}"]`);
  dcVincular(Number(b.dataset.dcVinc), sel ? sel.value : '');
});
```

- [ ] **Step 7: Rodar e ver passar**

Run: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`
Expected: `0 falharam`.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `NODE_PATH=../boletim-manha/node_modules bash run_tests.sh > /tmp/suite_c.txt 2>&1; tail -5 /tmp/suite_c.txt`
Expected: `TOTAL: N passaram, 0 falharam`. Exceções já conhecidas, que precisam ser comparadas com o `oficial/main` antes desta branch (rodar a suíte em `12c9897` se aparecerem):
- `test_conversao_vendas.js`, que é instável;
- `test_pedidos_alerta`, que falha sem o exceljs.

Qualquer outra falha é desta mudança: investigar.

- [ ] **Step 9: Commit**

```bash
git add _template.html test_discador.js
git commit -m "feat(discador): aba Discador no menu (admin/supervisor), carga das RPCs, periodo, detalhe e vinculo (secao 87)"
```

---

### Task 4: Conferência visual com dados reais (sem publicar)

**Files:** nenhum (só leitura e build local).

- [ ] **Step 1: Gerar o painel**

Run: `python build_painel.py`
Expected: termina sem erro e `painel_clientes_apex.html` contém `panel-discador`.

- [ ] **Step 2: Abrir localmente logado como o Rafael (admin) e conferir**

Servir a pasta (`python -m http.server 8765`) e abrir `http://localhost:8765/painel_clientes_apex.html` no Chrome (claude-in-chrome). O Rafael faz o login; o Claude não digita senha. Depois abrir "Discador" e conferir:
- no filtro **Mês**, os cartões batem com o Plano A: 139.925 tentativas, 6,1%, 30,6%, 5.932 atendidas, 48 s, 34 vendas;
- a tabela por carga mostra as 4 cargas;
- o bloco de vínculo lista 14 agentes;
- no filtro **Hoje**, a tela não quebra (pode estar vazia se o robô ainda não baixa o discador);
- no celular (redimensionar para 390 px), não há rolagem horizontal da página; as tabelas rolam dentro do `mlTabelaWrap`.

Anotar no ledger o que foi visto. **Não** vincular agentes nesse teste: o vínculo é do Rafael, depois de publicado.

---

### Task 5: Publicação (cada passo com ok explícito do Rafael)

- [ ] **Step 1: Juntar com o oficial**

```bash
git fetch oficial
git merge oficial/main
```

Se der conflito em `_template.html`, juntar os dois lados mantendo os blocos da §87. Depois rodar `python build_painel.py` e `bash run_tests.sh` de novo.

- [ ] **Step 2: Comparar com o painel no ar**

```bash
ssh hostinger "md5sum domains/apexsmart.com.br/public_html/painel_clientes_apex.html"
```

Baixar o arquivo do ar e comparar com o `painel_clientes_apex.html` gerado a partir de `oficial/main` **sem** a branch (build num worktree temporário de `oficial/main`). Se forem diferentes, alguém publicou por fora: parar e juntar.

- [ ] **Step 3: REGRAS_NEGOCIO.md §87**

Acrescentar a seção `## 87. Aba "Discador": discador automático do ProContact (15/10/2026)`, com:
- o que é;
- quem vê;
- as definições da spec §7;
- as tabelas e funções do Plano A;
- as Rulings R1/R2;
- os limites conhecidos (médias por hora só em Hoje/Ontem; o robô ainda não baixa o discador até o Plano B; agentes sem vínculo aparecem como "Agente N");
- como reverter;
- MD5 e backup (preenchidos no Step 5).

Conferir antes se o número ainda está livre (`git show oficial/main:REGRAS_NEGOCIO.md | grep -n '^## 8'`).

- [ ] **Step 4: Ajustes no banco e na função** (com ok)

- `comment on table public.discador_chamadas is '… (REGRAS §87) …';`
- republicar `ingest-discador`, que tem o comentário §87 no `ingest.ts`: `npx supabase functions deploy ingest-discador --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`. Conferir o 401 sem token.

- [ ] **Step 5: Publicar** (com ok)

```bash
python build_painel.py
ssh hostinger "cp domains/apexsmart.com.br/public_html/painel_clientes_apex.html ~/deploy_backups/painel_clientes_apex_$(date +%Y%m%d_%H%M%S)_antes_discador.html"
scp painel_clientes_apex.html hostinger:domains/apexsmart.com.br/public_html/painel_clientes_apex.html
ssh hostinger "md5sum domains/apexsmart.com.br/public_html/painel_clientes_apex.html"; md5sum painel_clientes_apex.html
```

Expected: os dois MD5 iguais. Preencher MD5 e nome do backup na §87.

- [ ] **Step 6: Commit, push e vigia** (com ok)

```bash
git add REGRAS_NEGOCIO.md && git commit -m "docs(regras): secao 87 - aba Discador publicada"
git fetch oficial && git merge oficial/main
git push oficial HEAD:main
powershell -File vigia/vigia_painel.ps1 -Aceitar
```

Push sem force. Se o `git merge` trouxer algo novo, rodar build e testes de novo antes do push.

---

## Self-Review (feito ao escrever)

- **Cobertura da spec §8:**
  - filtro de período → Tasks 1 e 3;
  - linha de status e faixa de sync → Task 3;
  - cartões → Task 2;
  - Bloco 1 (barras por hora com abandono, linha tracejada da média, mapa de calor, faixa vermelha do alerta) → Tasks 2 e 3;
  - Bloco 2 (tabela com as 10 colunas, destaque de 30%, clique para o detalhe por dia, aviso de agentes sem consultor com seletor para o admin) → Tasks 2 e 3;
  - Bloco 3 (carga, operadora e cidade, com vendas por 1.000) → Tasks 2 e 3;
  - "sem coluna de cliente, CNPJ ou telefone" → nenhuma função recebe esses campos;
  - publicação e §87 → Task 5.
- **Nomes consistentes:**
  - os argumentos de RPC batem com o Plano A: `p_de`, `p_ate`, `p_dim`, `p_agente`, `p_profile`, `p_apelido`;
  - os campos lidos batem com os `returns table` do Plano A: `tentativas`, `contato`, `atendidas`, `abandonadas`, `sem_tabulacao`, `seg_falados_medio`, `vendas`, `abandono_alerta`, `ultima_sync`; `hora`, `media_atendidas`, `media_abandonadas`; `dia_semana`; `agente_id`, `profile_id`, `nome`, `seg_falados_total`, `sem_avanco`, `retornos`, `ganhos`; `chave`; `dia`; `atendidas_30d`.
- **Review Focus:**
  - itens 1, 2 e 5 → Task 3;
  - itens 3 e 4 → Task 2.
