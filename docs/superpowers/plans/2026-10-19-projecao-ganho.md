# Projeção de Ganho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-aba "Projeção de Ganho" no Dashboard de Produção (receita e contratos ponderados pela etapa, projetados pelo
ritmo dos dias úteis, com Excel) e 3º botão "Apex + Campinas" no seletor de operação do admin.

**Architecture:** Toda a conta mora no dashboard embutido (`PRODUCAO_DASHBOARD_TPL_B64`, editado via
`dashboard_tpl.py`), em funções puras (`montarProjecao` e quebras) separadas da tela (`renderProjecao`) e do Excel
(`gerarExcelProjecao`). O painel de fora (`_template.html`) só ganha a opção "todas" no seletor, marca cada pedido com a
operação do vendedor e passa a operação escolhida ao iframe pelo placeholder novo `__OPERACAO__`.

**Tech Stack:** HTML/JS puro no navegador (sem build), ExcelJS 4.4.0 (cdnjs, carregada no clique), testes Node + jsdom
(`test_*.js`, `bash run_tests.sh`), Python 3 para `build_painel.py`/`dashboard_tpl.py`.

**Spec:** `docs/superpowers/specs/2026-10-19-projecao-ganho-design.md`

## Global Constraints

- Trabalhar só no worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\projecao-ganho` (branch `feat/projecao-ganho`). Comandos de shell em **Git Bash**, a partir da raiz do worktree.
- Rodar testes sempre com `NODE_PATH=../../crm/node_modules` (lá estão `xlsx`, `jszip`, `papaparse`; `jsdom`, `jspdf` e `exceljs` estão no `node_modules` do worktree). Para a suíte inteira, o pacote `docx` precisa existir: `npm install --no-save --no-audit --no-fund docx` (não grava no `package.json`; se o `package-lock.json` mudar, `git checkout -- package-lock.json`).
- Dashboard embutido: `python dashboard_tpl.py extrair` → editar `_dashboard_producao.html` → `python dashboard_tpl.py empacotar`. **Sempre** empacotar antes de rodar testes ou fazer commit (os testes leem o `_template.html`). Nunca rodar `extrair` com edições não empacotadas (ele sobrescreve o arquivo extraído). `_dashboard_producao.html` é ignorado pelo git.
- Nunca editar `painel_clientes_apex.html` à mão: `python build_painel.py` (o `run_tests.sh` também gera). Commitar o painel gerado junto com o `_template.html`.
- Não mexer: bloco `<style>` "Sinal de Ápice" do `_template.html`, menu lateral, cabeçalho de página, `ApexMotion`, `mostrarAviso`, `fecharOverlay` (`CLAUDE.md`). CSS novo só dentro do dashboard embutido e só com variáveis (`var(--accent)`, `--bordo`, `--ganho`, `--andamento`, `--muted`, `--border`, `--panel`, `--panel2`, `--rosa`, `--alerta-min-bg`).
- `_template.html` com fim de linha LF (há teste que proíbe CRLF).
- Nenhum dado real de cliente nos testes nem no repositório (repositório público). Nomes de teste fictícios.
- Pesos exatos: `CONCLUIDO (NEOCRM)` 1 · `ENTREGA (NEOCRM)` 1 · `VALIDAÇÃO ESIM (NEOCRM)` 1 (faixa "Entrega + Validação eSIM") · `ANTIFRAUDE (NEOCRM)` 0,5 · `BIOMETRIA (NEOCRM)` 0,5 · demais 0.
- Início de Campinas: `OPERACAO_INICIO = { campinas: '2026-10-06' }`.
- O texto literal `__OPERACAO__` aparece **uma única vez** no dashboard embutido (na linha do `try`) — nunca em comentário, porque o painel de fora troca a primeira ocorrência.
- Linha de base (antes desta feature): `test_pedidos_alerta.js` (2 asserções do resumo com TERRITORIO) e `test_redesign_shell.js` (1 asserção de `border-radius` 10–14px) **já falham** no `oficial/main`. Não corrigir aqui; não pode aparecer nenhuma falha nova.
- Mensagens de commit em português, no estilo `feat(projecao): …`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Semana (refinamento a confirmar com o usuário na revisão do plano):** "Projeção da semana" = realizado ponderado da semana até ontem + ritmo × dias úteis restantes da semana (com hoje). Na segunda-feira e no fim de semana é igual a "ritmo × dias úteis da semana" (texto da spec); no meio da semana passa a bater com a linha da semana atual na tabela "Semana a semana". A Task 7 ajusta o texto da spec §3.4.

## Review Focus

- Venda cadastrada em sábado, domingo ou feriado: tem que entrar no realizado (e no gráfico, como barra estreita) sem contar dia útil — testado na Task 2 (A8, sábado 17/10) e Task 3 (`naoUtil`).
- Semana que atravessa a virada do mês (30/11–06/12): a projeção da semana conta os dias úteis de dezembro com o ritmo de novembro — testado na Task 2.
- "Apex + Campinas" num dia em que uma operação ainda não tem dia útil completo (06/10 para Campinas): a outra continua projetando e a tela avisa — testado nas Tasks 2 e 4.
- Etapa vinda com acento em outra normalização Unicode (NFD) ou com espaços: tem que cair na mesma faixa — testado na Task 1.
- Atualização automática de 1 h com outro mês escolhido no seletor: o mês escolhido não pode voltar sozinho para o atual — testado na Task 4.

---

### Task 1: Pesos, dias úteis e operações (funções puras)

**Files:**
- Create: `test_projecao_ganho.js`
- Modify: `_dashboard_producao.html` (extraído do `_template.html`; nova seção JS antes do comentário `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`)

**Interfaces:**
- Consumes: `isHoliday(iso)`, `spParts(iso)` (dashboard existente).
- Produces: `PROJ_FAIXAS` (array de `{k,label,peso,etapas}`), `projFaixa(etapa) → faixa|null`, `projPeso(etapa) → 0|0.5|1`, `OPERACAO_SELECIONADA` (`'apex'|'campinas'|'todas'`), `OPERACAO_INICIO`, `PROJ_OPERACAO_ROTULO`, `PROJ_OPERACAO_CURTO`, `projOperacoes(sel) → string[]`, `projOperacaoDaLinha(r, sel) → 'apex'|'campinas'`, `projSomaDias(iso, n) → iso`, `projDiaSemana(iso) → 0..6`, `projDiaUtil(iso) → bool`, `projDiasDoMes('AAAA-MM') → iso[]`, `projDiasOperacao(op, mes, hoje) → {op,inicio,uteis,total,completos,restantes}`, `projSegunda(iso) → iso`, `projSemanaAtual(hoje) → {de,ate}` (seg–dom), `projAgora() → ms`, `projHoje() → iso`.

- [ ] **Step 1: Extrair o dashboard e criar o arquivo de teste com o harness e os testes da Task 1**

Run: `python dashboard_tpl.py extrair`

Criar `test_projecao_ganho.js`:

```js
// Testa a sub-aba "Projeção de Ganho" do Dashboard de Produção (19/10/2026, REGRAS_NEGOCIO.md seção 101).
// Mesma técnica de test_pedidos_alerta.js: decodifica o template embutido de verdade (PRODUCAO_DASHBOARD_TPL_B64),
// preenche os placeholders com dados FICTÍCIOS e roda o script real num jsdom. Nenhum dado real de cliente aqui —
// o repositório é público.
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
function perto(a, b){ return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6; }
function secao(nome, fn){ try{ fn(); }catch(e){ fail++; console.log('FALHOU (exceção em ' + nome + '):', e && e.stack || e); } }
const txt = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// "Agora" padrão dos testes: segunda 19/10/2026, 15h em São Paulo.
const AGORA_PADRAO = Date.parse('2026-10-19T15:00:00-03:00');

// Registro no formato de producao_pedidos, já marcado com a operação (o painel de fora marca — seção 101).
// O cadastro chega da API como meia-noite de São Paulo (03:00Z).
const dia = d => d + 'T03:00:00+00:00';
function ped(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'ANA TESTE', etapa: 'CONCLUIDO (NEOCRM)',
  cadastro: dia('2026-10-01'), atualizacao: '2026-10-19T10:00:00-03:00', criado_em: null,
  valor: 10, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: null, tag: null, operacao: 'apex',
}, over); }

// Apex, outubro/2026, hoje = 19/10: realizado até ontem 440 (11 dias úteis completos → ritmo 40, mês 840).
const FIX_APEX = [
  ped({ numero_pedido: 'A1', cadastro: dia('2026-10-01'), valor: 100 }),
  ped({ numero_pedido: 'A2', cadastro: dia('2026-10-02'), etapa: 'ENTREGA (NEOCRM)', valor: 60 }),
  ped({ numero_pedido: 'A3', cadastro: dia('2026-10-05'), etapa: 'VALIDAÇÃO ESIM (NEOCRM)', grupo: 'VOZ - Portabilidade', usuario: 'BRUNO TESTE', valor: 40 }),
  ped({ numero_pedido: 'A4', cadastro: dia('2026-10-06'), etapa: 'ANTIFRAUDE (NEOCRM)', grupo: 'VOZ - Tranf. Titularidade', usuario: 'BRUNO TESTE', valor: 80 }),
  ped({ numero_pedido: 'A5', cadastro: dia('2026-10-07'), etapa: 'BIOMETRIA (NEOCRM)', grupo: 'GRUPO NOVO X', valor: 20 }),
  ped({ numero_pedido: 'A6', cadastro: dia('2026-10-08'), etapa: 'TERRITORIO (NEOCRM)', valor: 999 }),          // peso 0
  ped({ numero_pedido: 'A7', cadastro: dia('2026-10-09'), etapa: 'NEGOCIACAO (NEOCRM)', valor: 500 }),          // peso 0
  ped({ numero_pedido: 'A8', cadastro: dia('2026-10-17'), usuario: 'BRUNO TESTE', valor: 35 }),                  // sábado
  ped({ numero_pedido: 'A9', cadastro: dia('2026-10-19'), valor: 50 }),                                          // hoje
  ped({ numero_pedido: 'A10', cadastro: dia('2026-09-30'), valor: 70 }),                                         // setembro
  ped({ numero_pedido: 'M1', cadastro: dia('2026-10-13'), etapa: 'ENTREGA (NEOCRM)', valor: 30 }),               // pedido de 2 linhas
  ped({ numero_pedido: 'M1', cadastro: dia('2026-10-13'), etapa: 'ANTIFRAUDE (NEOCRM)', grupo: 'SVA MÓVEL', valor: 10 }),
  ped({ numero_pedido: 'C1', cadastro: dia('2026-10-14'), grupo: 'BANDA LARGA - Novo', usuario: 'BRUNO TESTE', cnpj: '22222222000100', valor: 100 }), // convergência
  ped({ numero_pedido: 'C2', cadastro: dia('2026-10-14'), etapa: 'BIOMETRIA (NEOCRM)', usuario: 'BRUNO TESTE', cnpj: '22222222000100', valor: 40 }),
];
// Campinas (início 06/10): realizado até ontem 160 (8 dias úteis completos → ritmo 20, mês de 18 dias úteis = 360).
const FIX_CAMP = [
  ped({ numero_pedido: 'K0', cadastro: dia('2026-09-30'), usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 999 }), // antes do início
  ped({ numero_pedido: 'K1', cadastro: dia('2026-10-06'), usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 80 }),
  ped({ numero_pedido: 'K2', cadastro: dia('2026-10-13'), etapa: 'ANTIFRAUDE (NEOCRM)', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 80 }),
  ped({ numero_pedido: 'K3', cadastro: dia('2026-10-16'), etapa: 'ENTREGA (NEOCRM)', grupo: 'VOZ - Tranf. Titularidade', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 40 }),
  ped({ numero_pedido: 'K4', cadastro: dia('2026-10-19'), etapa: 'BIOMETRIA (NEOCRM)', usuario: 'CARLA CAMPINAS', operacao: 'campinas', valor: 60 }),
];

function montarDashboard({ adminMode = true, operacao = 'apex', data = FIX_APEX, agora = AGORA_PADRAO } = {}){
  const html = htmlNoScript
    .replace('__ADMIN_BADGE__', '')
    .replace('__APEX_B64__', '')
    .replace('__CLARO_B64__', '')
    .replace('__UPDATED_AT__', '19/10/2026, 14:59:02');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  const js = jsOriginal
    .replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';')
    .replace('__ADMIN_MODE__', adminMode ? 'true' : 'false')
    .replace('__OPERACAO__', JSON.stringify(operacao))
    .replace('function projAgora(){ return Date.now(); }', 'function projAgora(){ return ' + agora + '; }');
  w.eval(js);
  return w;
}

// ---------------- Task 1: pesos, dias úteis e operações ----------------
secao('Task 1', () => {
  const w = montarDashboard();
  assert(w.projPeso('CONCLUIDO (NEOCRM)') === 1 && w.projPeso('ENTREGA (NEOCRM)') === 1, 'Concluído e Entrega = 100%');
  assert(w.projPeso('VALIDAÇÃO ESIM (NEOCRM)') === 1 && w.projFaixa('VALIDAÇÃO ESIM (NEOCRM)').k === 'entrega', 'Validação eSIM = 100%, dentro da faixa Entrega');
  assert(w.projFaixa('VALIDAÇÃO ESIM (NEOCRM)'.normalize('NFD')).k === 'entrega', 'acento em NFD cai na mesma faixa');
  assert(w.projFaixa('  entrega (neocrm) ').k === 'entrega', 'espaços e minúsculas não atrapalham');
  assert(w.projPeso('ANTIFRAUDE (NEOCRM)') === 0.5 && w.projPeso('BIOMETRIA (NEOCRM)') === 0.5, 'Antifraude e Biometria = 50%');
  ['TERRITORIO (NEOCRM)', 'FATURAMENTO (NEOCRM)', 'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'NEGOCIACAO (NEOCRM)', 'VENDA PERDIDA (NEOCRM)', null, undefined]
    .forEach(e => assert(w.projPeso(e) === 0, 'peso 0 para ' + e));
  assert(w.projFaixa('TERRITORIO (NEOCRM)') === null, 'Território não tem faixa');
  assert(JSON.stringify(w.eval('PROJ_FAIXAS.map(f => f.k)')) === JSON.stringify(['concluido', 'entrega', 'antifraude', 'biometria']), 'ordem das faixas');

  // operação escolhida no painel de fora
  assert((tplRaw.match(/__OPERACAO__/g) || []).length === 1, 'o placeholder da operação aparece uma única vez no dashboard');
  assert(w.eval('OPERACAO_SELECIONADA') === 'apex', 'padrão: Apex');
  assert(montarDashboard({ operacao: 'todas' }).eval('OPERACAO_SELECIONADA') === 'todas', 'recebe "todas"');
  assert(montarDashboard({ operacao: 'xpto' }).eval('OPERACAO_SELECIONADA') === 'apex', 'valor desconhecido vira Apex');
  assert(JSON.stringify(w.projOperacoes('todas')) === '["apex","campinas"]' && JSON.stringify(w.projOperacoes('campinas')) === '["campinas"]'
    && JSON.stringify(w.projOperacoes('apex')) === '["apex"]', 'operações de cada seleção');
  assert(w.projOperacaoDaLinha({ operacao: 'campinas' }, 'apex') === 'campinas', 'a marca da linha vence');
  assert(w.projOperacaoDaLinha({}, 'campinas') === 'campinas' && w.projOperacaoDaLinha({}, 'todas') === 'apex', 'linha sem marca: a seleção (ou Apex)');
  assert(w.eval('OPERACAO_INICIO.campinas') === '2026-10-06' && w.eval('OPERACAO_INICIO.apex') === undefined, 'Campinas começa em 06/10/2026');

  // datas (sempre texto AAAA-MM-DD, dia de São Paulo)
  assert(w.projSomaDias('2026-10-30', 3) === '2026-11-02' && w.projSomaDias('2026-10-01', -1) === '2026-09-30', 'projSomaDias vira o mês');
  assert(w.projDiaSemana('2026-10-19') === 1 && w.projDiaSemana('2026-10-17') === 6, 'dia da semana');
  assert(!w.projDiaUtil('2026-10-12') && w.projDiaUtil('2026-10-13') && !w.projDiaUtil('2026-10-17') && !w.projDiaUtil('2026-11-20'), 'feriados e fim de semana não são úteis');
  assert(w.projDiasDoMes('2026-02').length === 28 && w.projDiasDoMes('2026-10')[30] === '2026-10-31', 'dias do mês');
  const dOut = w.projDiasOperacao('apex', '2026-10', '2026-10-19');
  assert(dOut.total === 21 && dOut.completos === 11 && dOut.restantes === 10 && dOut.inicio === null, 'outubro/2026 Apex: 21 úteis, 11 completos em 19/10 — ' + JSON.stringify(dOut));
  const dCamp = w.projDiasOperacao('campinas', '2026-10', '2026-10-19');
  assert(dCamp.total === 18 && dCamp.completos === 8 && dCamp.restantes === 10 && dCamp.uteis[0] === '2026-10-06', 'outubro/2026 Campinas: 18 úteis desde 06/10');
  assert(w.projDiasOperacao('apex', '2026-11', '2026-11-01').total === 19, 'novembro/2026: 19 úteis (02/11 e 20/11)');
  assert(w.projDiasOperacao('apex', '2027-02', '2027-02-01').total === 18, 'fevereiro/2027: Carnaval fora (18 úteis)');
  const dSet = w.projDiasOperacao('apex', '2026-09', '2026-10-19');
  assert(dSet.total === 21 && dSet.completos === 21 && dSet.restantes === 0, 'mês fechado: todos completos');
  const s1 = w.projSemanaAtual('2026-10-21');
  assert(s1.de === '2026-10-19' && s1.ate === '2026-10-25', 'semana atual (quarta) = seg 19 a dom 25');
  assert(w.projSemanaAtual('2026-10-19').de === '2026-10-19', 'segunda abre a própria semana');
  const s2 = w.projSemanaAtual('2026-10-24'), s3 = w.projSemanaAtual('2026-10-25');
  assert(s2.de === '2026-10-26' && s2.ate === '2026-11-01' && s3.de === '2026-10-26', 'sábado e domingo: a semana seguinte');
  assert(w.projHoje() === '2026-10-19', 'hoje em São Paulo (relógio controlado pelo teste)');
});

// ---------------- fim ----------------
Promise.resolve().then(() => typeof testarExcel === 'function' ? testarExcel() : null)
  .catch(err => { fail++; console.log('FALHOU (exceção no teste do Excel):', err && err.stack || err); })
  .finally(() => {
    console.log('--- test_projecao_ganho RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
    if(fail > 0) process.exitCode = 1;
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU (exceção em Task 1): TypeError: w.projPeso is not a function` e `RESULTADO: 0 passaram, 1 falharam`, exit 1.

- [ ] **Step 3: Implementar a seção em `_dashboard_producao.html`**

Inserir imediatamente **antes** da linha `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// ---------- PROJEÇÃO DE GANHO (19/10/2026) — ver REGRAS_NEGOCIO.md seção 101 ----------
// Sub-aba só de admin/supervisor. Valor ponderado pela etapa ATUAL do pedido (pesos só desta aba — ETAPA_CATEGORY não
// muda) e projetado pelo ritmo dos dias úteis completos do mês. Spec: docs/superpowers/specs/2026-10-19-projecao-ganho-design.md.
const PROJ_FAIXAS = [
  { k: 'concluido', label: 'Concluído', peso: 1, etapas: ['CONCLUIDO (NEOCRM)'] },
  { k: 'entrega', label: 'Entrega + Validação eSIM', peso: 1, etapas: ['ENTREGA (NEOCRM)', 'VALIDAÇÃO ESIM (NEOCRM)'] },
  { k: 'antifraude', label: 'Antifraude', peso: 0.5, etapas: ['ANTIFRAUDE (NEOCRM)'] },
  { k: 'biometria', label: 'Biometria', peso: 0.5, etapas: ['BIOMETRIA (NEOCRM)'] },
];
function projNormEtapa(e){ return String(e == null ? '' : e).normalize('NFC').trim().toUpperCase(); }
function projFaixa(etapa){
  const e = projNormEtapa(etapa);
  return PROJ_FAIXAS.find(f => f.etapas.some(x => projNormEtapa(x) === e)) || null;
}
function projPeso(etapa){ const f = projFaixa(etapa); return f ? f.peso : 0; }

// Operação escolhida no painel de fora (seções 78 e 101): 'apex' | 'campinas' | 'todas' (só admin). Sem o valor
// (versão antiga do painel ou testes antigos) fica Apex.
let OPERACAO_SELECIONADA = 'apex';
try{ OPERACAO_SELECIONADA = __OPERACAO__; }catch(e){ OPERACAO_SELECIONADA = 'apex'; }
if(['apex', 'campinas', 'todas'].indexOf(OPERACAO_SELECIONADA) < 0) OPERACAO_SELECIONADA = 'apex';
// Início de cada operação: no mês de início, os dias úteis contam a partir desta data (a Apex conta sempre do dia 1º).
const OPERACAO_INICIO = { campinas: '2026-10-06' };
const PROJ_OPERACAO_ROTULO = { apex: 'Operação Apex', campinas: 'Operação Campinas', todas: 'Apex + Campinas' };
const PROJ_OPERACAO_CURTO = { apex: 'Apex', campinas: 'Campinas', todas: 'Apex + Campinas' };
function projOperacoes(sel){ return sel === 'todas' ? ['apex', 'campinas'] : [sel === 'campinas' ? 'campinas' : 'apex']; }
// Cada pedido chega marcado (r.operacao) pelo painel de fora; sem a marca, vale a operação da tela (ou Apex).
function projOperacaoDaLinha(r, sel){
  if(r && (r.operacao === 'apex' || r.operacao === 'campinas')) return r.operacao;
  return sel === 'campinas' ? 'campinas' : 'apex';
}

// Datas como texto AAAA-MM-DD (dia de São Paulo); a conta usa UTC só para andar no calendário, sem fuso.
function projSomaDias(dia, n){
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function projDiaSemana(dia){ const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function projDiaUtil(dia){ const wd = projDiaSemana(dia); return wd !== 0 && wd !== 6 && !isHoliday(dia); }
function projDiasDoMes(mes){
  const [y, m] = mes.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => mes + '-' + String(i + 1).padStart(2, '0'));
}
// Dias úteis da operação no mês (a partir do início dela) e quantos já terminaram (dia < hoje).
function projDiasOperacao(op, mes, hoje){
  const inicio = OPERACAO_INICIO[op] || null;
  const uteis = projDiasDoMes(mes).filter(d => projDiaUtil(d) && (!inicio || d >= inicio));
  const completos = uteis.filter(d => d < hoje).length;
  return { op, inicio, uteis, total: uteis.length, completos, restantes: uteis.length - completos };
}
// Semana de segunda a domingo; no sábado e no domingo, a "semana atual" das projeções é a seguinte.
function projSegunda(dia){ const wd = projDiaSemana(dia); return projSomaDias(dia, wd === 0 ? -6 : 1 - wd); }
function projSemanaAtual(hoje){
  const wd = projDiaSemana(hoje);
  const seg = (wd === 0 || wd === 6) ? projSomaDias(projSegunda(hoje), 7) : projSegunda(hoje);
  return { de: seg, ate: projSomaDias(seg, 6) };
}
// Relógio separado para os testes controlarem o "hoje".
function projAgora(){ return Date.now(); }
function projHoje(){ return spParts(new Date(projAgora()).toISOString()).date; }
```

Run: `python dashboard_tpl.py empacotar`

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `--- test_projecao_ganho RESULTADO: N passaram, 0 falharam ---`, exit 0.

Run (não pode quebrar quem já usa o dashboard): `NODE_PATH=../../crm/node_modules node test_visao_diaria.js && NODE_PATH=../../crm/node_modules node test_vendas_perdidas.js`
Expected: ambos terminam com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
python build_painel.py
git add test_projecao_ganho.js _template.html painel_clientes_apex.html
git commit -F - <<'EOF'
feat(projecao): pesos por etapa, dias úteis e operação escolhida no dashboard

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Núcleo do cálculo (`montarProjecao`)

**Files:**
- Modify: `_dashboard_producao.html` (fim da seção PROJEÇÃO DE GANHO — antes do comentário `// Chamada pelo painel externo …`)
- Test: `test_projecao_ganho.js` (nova seção antes de `// ---------------- fim ----------------`)

**Interfaces:**
- Consumes: tudo da Task 1; `cnpjsComConvergencia(rows)`, `pedidoKey(r, idx, set)` (dashboard existente).
- Produces:
  - `projLinhas(dados, sel) → linha[]` com `linha = { r, dia, op, faixa, peso, bruto, valor, contrato }`.
  - `projContratos(linhas) → Map<chave, { chave, dia, op, usuario, peso, faixa, linhas }>` (preenche `linha.contrato`).
  - `projSoma(linhas) → number`; `projPesoContratos(contratos[]) → number`.
  - `projMesesDisponiveis(dados, sel, hoje) → 'AAAA-MM'[]` (mais recente primeiro).
  - `montarProjecao(dados, { mes, hoje, operacao }) → p` com `p = { mes, hoje, operacao, fechado, semana, calendario, porOperacao, total, linhas, contratos }`; `porOperacao[i] = { op, dias, realizado, hoje, ritmo, mes, semana }`; `realizado`/`hoje` = `{ valor, contratos }`; `ritmo`/`mes` = `{ valor, contratos } | null`; `semana` = `{ de, ate, uteis, valor, contratos } | null`; `total` tem os mesmos campos somados (`total.semana` com `de`, `ate`, `uteis`).

- [ ] **Step 1: Escrever os testes**

Run: `python dashboard_tpl.py extrair`

Acrescentar em `test_projecao_ganho.js`, antes de `// ---------------- fim ----------------`:

```js
// ---------------- Task 2: núcleo do cálculo ----------------
secao('Task 2', () => {
  const w = montarDashboard();
  const mp = (dados, opcoes) => w.montarProjecao(dados, opcoes);
  const p = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  assert(p.linhas.length === 11, 'linhas com peso > 0 em outubro: 11 (sem Território, Negociação e setembro) — ' + p.linhas.length);
  const cs = [...p.contratos.values()];
  assert(cs.length === 9, '9 contratos (M1 = 1, convergência C1+C2 = 1) — ' + cs.length);
  const m1 = cs.find(c => c.linhas.some(l => l.r.numero_pedido === 'M1'));
  assert(m1 && m1.peso === 1 && m1.faixa.k === 'entrega' && m1.linhas.length === 2, 'pedido com 2 linhas: peso do contrato = maior peso, faixa Entrega');
  const conv = cs.find(c => c.chave.indexOf('CONV_22222222000100') >= 0);
  assert(conv && conv.peso === 1 && conv.faixa.k === 'concluido' && conv.linhas.length === 2, 'convergência vira 1 contrato, faixa Concluído');
  assert(p.porOperacao.length === 1 && p.porOperacao[0].op === 'apex', 'uma operação');
  const o = p.porOperacao[0];
  assert(perto(o.realizado.valor, 440) && perto(o.realizado.contratos, 7), 'realizado até ontem: R$ 440 e 7 contratos (sábado 17/10 entra) — ' + JSON.stringify(o.realizado));
  assert(perto(o.hoje.valor, 50) && perto(o.hoje.contratos, 1), 'hoje (parcial) fora do realizado: R$ 50');
  assert(perto(o.ritmo.valor, 40) && perto(o.ritmo.contratos, 7 / 11), 'ritmo = 440 ÷ 11');
  assert(perto(o.mes.valor, 840) && perto(o.mes.contratos, 7 / 11 * 21), 'mês = ritmo × 21');
  assert(o.semana && o.semana.de === '2026-10-19' && o.semana.ate === '2026-10-25' && o.semana.uteis === 5 && perto(o.semana.valor, 200), 'semana (segunda) = ritmo × 5');
  assert(perto(p.total.mes.valor, 840) && perto(p.total.ritmo.valor, 40) && perto(p.total.realizado.valor, 440) && perto(p.total.hoje.valor, 50), 'total = a operação');
  assert(p.total.semana.de === '2026-10-19' && p.total.semana.uteis === 5, 'total da semana com datas');
  assert(p.calendario.total === 21 && p.calendario.completos === 11 && p.fechado === false, 'calendário do mês');

  // quarta-feira: a semana soma o que já entrou nela + ritmo × dias que faltam
  const q = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-21', operacao: 'apex' }).porOperacao[0];
  assert(perto(q.realizado.valor, 490) && q.dias.completos === 13, 'quarta 21/10: 490 em 13 dias');
  assert(perto(q.semana.valor, 50 + 490 / 13 * 3), 'semana na quarta = 50 já realizado + ritmo × 3 — ' + q.semana.valor);
  // sábado: a semana seguinte, inteira projetada
  const sab = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-24', operacao: 'apex' }).porOperacao[0];
  assert(sab.dias.completos === 16 && sab.semana.de === '2026-10-26' && perto(sab.semana.valor, 490 / 16 * 5), 'sábado: 16 dias completos, semana de 26/10 = ritmo × 5');
  // semana que vira o mês: conta os úteis de dezembro com o ritmo de novembro
  const nov = mp([ped({ numero_pedido: 'N1', cadastro: dia('2026-11-03'), valor: 190 })], { mes: '2026-11', hoje: '2026-11-30', operacao: 'apex' }).porOperacao[0];
  assert(nov.dias.total === 19 && nov.dias.completos === 18, 'novembro: 18 de 19 completos em 30/11');
  assert(nov.semana.de === '2026-11-30' && nov.semana.ate === '2026-12-06' && nov.semana.uteis === 5 && perto(nov.semana.valor, 190 / 18 * 5), 'semana 30/11–06/12 com 5 úteis');
  assert(perto(nov.mes.valor, 190 / 18 * 19), 'novembro: mês = ritmo × 19');
  // 1º dia útil: sem ritmo
  const d1 = mp(FIX_APEX, { mes: '2026-10', hoje: '2026-10-01', operacao: 'apex' });
  assert(d1.porOperacao[0].ritmo === null && d1.porOperacao[0].mes === null && d1.porOperacao[0].semana === null, '1º dia útil: sem ritmo, mês e semana');
  assert(d1.total.ritmo === null && d1.total.mes === null && perto(d1.total.realizado.valor, 0) && perto(d1.total.hoje.valor, 100), '1º dia útil: total sem projeção, hoje = 100');
  // mês fechado
  const set = mp(FIX_APEX, { mes: '2026-09', hoje: '2026-10-19', operacao: 'apex' });
  assert(set.fechado && set.semana === null && set.total.semana === null, 'setembro: mês fechado, sem semana');
  assert(perto(set.total.mes.valor, 70) && perto(set.total.realizado.valor, 70) && perto(set.total.ritmo.valor, 70 / 21), 'mês fechado: projeção = realizado');

  // Apex + Campinas: cada operação com o seu ritmo, total = soma
  const tod = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  assert(JSON.stringify(tod.porOperacao.map(x => x.op)) === '["apex","campinas"]', 'duas operações');
  const camp = tod.porOperacao[1];
  assert(camp.dias.total === 18 && perto(camp.realizado.valor, 160) && perto(camp.ritmo.valor, 20) && perto(camp.mes.valor, 360), 'Campinas: 160 em 8 dias, mês 360');
  assert(perto(camp.realizado.contratos, 2.5) && perto(camp.hoje.valor, 30), 'Campinas: 2,5 contratos, hoje 30');
  assert(perto(tod.total.mes.valor, 1200) && perto(tod.total.ritmo.valor, 60) && perto(tod.total.hoje.valor, 80) && perto(tod.total.semana.valor, 300), 'total = 840 + 360');
  const soCamp = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'campinas' });
  assert(soCamp.porOperacao.length === 1 && perto(soCamp.total.realizado.valor, 160) && soCamp.calendario.total === 18, 'só Campinas ignora linhas da Apex');
  // Campinas ainda sem dia útil completo (06/10): a Apex continua projetando
  const t6 = mp(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-06', operacao: 'todas' });
  assert(t6.porOperacao[1].ritmo === null && perto(t6.porOperacao[0].ritmo.valor, 200 / 3), 'em 06/10 Campinas sem ritmo, Apex com 200 ÷ 3');
  assert(perto(t6.total.ritmo.valor, 200 / 3) && perto(t6.total.mes.valor, 200 / 3 * 21), 'total só com a Apex');

  // meses do seletor
  assert(JSON.stringify(w.projMesesDisponiveis(FIX_APEX, 'apex', '2026-10-19')) === '["2026-10","2026-09"]', 'Apex: outubro e setembro');
  assert(JSON.stringify(w.projMesesDisponiveis(FIX_CAMP, 'campinas', '2026-10-19')) === '["2026-10"]', 'Campinas: nada antes do início');
  assert(JSON.stringify(w.projMesesDisponiveis([], 'apex', '2026-10-19')) === '["2026-10"]', 'sem dados: só o mês atual');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU (exceção em Task 2): TypeError: w.montarProjecao is not a function`, exit 1.

- [ ] **Step 3: Implementar (fim da seção PROJEÇÃO DE GANHO)**

Inserir imediatamente antes de `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// Linhas com peso > 0 das operações da tela, com o dia do cadastro (São Paulo), a faixa e o valor ponderado.
function projLinhas(dados, sel){
  const ops = projOperacoes(sel);
  const out = [];
  (dados || []).forEach(r => {
    const f = projFaixa(r && r.etapa);
    if(!f) return;
    const p = spParts(r.cadastro);
    if(!p) return;
    const op = projOperacaoDaLinha(r, sel);
    if(ops.indexOf(op) < 0) return;
    const bruto = Number(r.valor) || 0;
    out.push({ r, dia: p.date, op, faixa: f, peso: f.peso, bruto, valor: bruto * f.peso, contrato: null });
  });
  return out;
}
// Contratos (seções 16.13 e 16.15): pedidoKey por dia e operação, com a convergência (banda larga + outro tipo do
// mesmo CNPJ no dia) valendo 1. Peso do contrato = maior peso das linhas; faixa principal = a dessa linha (empate:
// ordem de PROJ_FAIXAS). Marca linha.contrato.
function projContratos(linhas){
  const grupos = new Map();
  linhas.forEach(l => {
    const k = l.dia + '|' + l.op;
    if(!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  });
  const contratos = new Map();
  grupos.forEach((ls, k) => {
    const conv = cnpjsComConvergencia(ls.map(l => l.r));
    ls.forEach((l, i) => {
      const chave = k + '|' + pedidoKey(l.r, i, conv);
      l.contrato = chave;
      let c = contratos.get(chave);
      if(!c){
        c = { chave, dia: l.dia, op: l.op, usuario: l.r.usuario || '(sem consultor)', peso: 0, faixa: null, linhas: [] };
        contratos.set(chave, c);
      }
      c.linhas.push(l);
      if(l.peso > c.peso || (l.peso === c.peso && PROJ_FAIXAS.indexOf(l.faixa) < PROJ_FAIXAS.indexOf(c.faixa))){
        c.peso = l.peso;
        c.faixa = l.faixa;
      }
    });
  });
  return contratos;
}
function projSoma(linhas){ return linhas.reduce((s, l) => s + l.valor, 0); }
function projPesoContratos(contratos){ return contratos.reduce((s, c) => s + c.peso, 0); }

// Meses do seletor: o atual primeiro e os anteriores com pedido ponderado (nunca antes do início da operação).
function projMesesDisponiveis(dados, sel, hoje){
  const atual = hoje.slice(0, 7);
  const piso = projOperacoes(sel).map(op => OPERACAO_INICIO[op] ? OPERACAO_INICIO[op].slice(0, 7) : '0000-00').sort()[0];
  const meses = new Set([atual]);
  projLinhas(dados, sel).forEach(l => {
    const mes = l.dia.slice(0, 7);
    if(mes <= atual && mes >= piso) meses.add(mes);
  });
  return [...meses].sort().reverse();
}

// Núcleo (seção 101): cada operação é calculada sozinha (dias úteis e início próprios) e o total é a soma.
// Ritmo = realizado até ontem ÷ dias úteis completos; mês = ritmo × dias úteis do mês; semana = realizado da semana
// até ontem + ritmo × dias úteis que faltam nela (com hoje). Hoje (parcial) fica fora do ritmo.
function montarProjecao(dados, opcoes){
  const mes = opcoes.mes, hoje = opcoes.hoje, sel = opcoes.operacao || 'apex';
  const fechado = mes < hoje.slice(0, 7);
  const todas = projLinhas(dados, sel);
  const semana = fechado ? null : projSemanaAtual(hoje);
  const linhasSemana = semana ? todas.filter(l => l.dia >= semana.de && l.dia < hoje) : [];
  const contratosSemana = [...projContratos(linhasSemana).values()];
  const linhas = todas.filter(l => l.dia.slice(0, 7) === mes);
  const contratos = projContratos(linhas); // por último: a chave do mês é a que fica em linha.contrato
  const listaContratos = [...contratos.values()];
  const porOperacao = projOperacoes(sel).map(op => {
    const dias = projDiasOperacao(op, mes, hoje);
    const lsOp = linhas.filter(l => l.op === op);
    const csOp = listaContratos.filter(c => c.op === op);
    const realizado = { valor: projSoma(lsOp.filter(l => l.dia < hoje)), contratos: projPesoContratos(csOp.filter(c => c.dia < hoje)) };
    const hojeParcial = { valor: projSoma(lsOp.filter(l => l.dia === hoje)), contratos: projPesoContratos(csOp.filter(c => c.dia === hoje)) };
    const ritmo = dias.completos > 0 ? { valor: realizado.valor / dias.completos, contratos: realizado.contratos / dias.completos } : null;
    const mesProj = ritmo ? { valor: ritmo.valor * dias.total, contratos: ritmo.contratos * dias.total } : null;
    let semanaProj = null;
    if(semana && ritmo){
      const util = d => projDiaUtil(d) && (!dias.inicio || d >= dias.inicio);
      const diasSemana = [];
      for(let d = semana.de; d <= semana.ate; d = projSomaDias(d, 1)) diasSemana.push(d);
      const restantes = diasSemana.filter(d => d >= hoje && util(d)).length;
      const jaFoi = projSoma(linhasSemana.filter(l => l.op === op));
      const jaFoiContratos = projPesoContratos(contratosSemana.filter(c => c.op === op));
      semanaProj = {
        de: semana.de, ate: semana.ate, uteis: diasSemana.filter(util).length,
        valor: jaFoi + ritmo.valor * restantes, contratos: jaFoiContratos + ritmo.contratos * restantes,
      };
    }
    return { op, dias, realizado, hoje: hojeParcial, ritmo, mes: mesProj, semana: semanaProj };
  });
  const somar = campo => {
    const xs = porOperacao.map(o => o[campo]).filter(Boolean);
    return xs.length ? { valor: xs.reduce((s, x) => s + x.valor, 0), contratos: xs.reduce((s, x) => s + x.contratos, 0) } : null;
  };
  const total = { realizado: somar('realizado'), hoje: somar('hoje'), ritmo: somar('ritmo'), mes: somar('mes'), semana: somar('semana') };
  if(total.semana){
    total.semana.de = semana.de;
    total.semana.ate = semana.ate;
    total.semana.uteis = Math.max.apply(null, porOperacao.filter(o => o.semana).map(o => o.semana.uteis));
  }
  const calendario = projDiasOperacao(sel === 'campinas' ? 'campinas' : 'apex', mes, hoje);
  return { mes, hoje, operacao: sel, fechado, semana, calendario, porOperacao, total, linhas, contratos };
}
```

Run: `python dashboard_tpl.py empacotar`

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `0 falharam`, exit 0.

- [ ] **Step 5: Commit**

```bash
python build_painel.py
git add test_projecao_ganho.js _template.html painel_clientes_apex.html
git commit -F - <<'EOF'
feat(projecao): ritmo, projeção do mês, da semana e do dia útil por operação

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Quebras (dia, semana, consultor, tipo de venda, etapa)

**Files:**
- Modify: `_dashboard_producao.html` (fim da seção PROJEÇÃO DE GANHO; e a última linha de `montarProjecao`)
- Test: `test_projecao_ganho.js`

**Interfaces:**
- Consumes: `p` da Task 2 (`p.linhas`, `p.contratos`, `p.porOperacao`, `p.total`, `p.hoje`, `p.mes`); `DIARIA_TIPOS_VENDA`, `isHoliday`.
- Produces (campos novos em `p`):
  - `p.dias = [{ data, tipo: 'realizado'|'hoje'|'projetado'|'feriado'|'naoUtil', valor, contratos, linhas: registro[] }]`
  - `p.semanas = [{ de, ate, diasUteis, tipo: 'fechada'|'atual'|'futura', valor, contratos, linhas }]`
  - `p.consultores = [{ usuario, operacao, valor, contratos, ritmo, projMes, projContratos, linhas }]` (maior projeção primeiro)
  - `p.tipos = [{ grupo, label, pedidos, valor, pct, projMes, linhas }]` (maior valor primeiro)
  - `p.etapas = [{ k, label, peso, contratos, bruto, valor, pct, linhas }]` (ordem de `PROJ_FAIXAS`)
  - `projRotuloTipo(grupo) → string`

- [ ] **Step 1: Escrever os testes**

Run: `python dashboard_tpl.py extrair`

Acrescentar antes de `// ---------------- fim ----------------`:

```js
// ---------------- Task 3: quebras ----------------
secao('Task 3', () => {
  const w = montarDashboard();
  const p = w.montarProjecao(FIX_APEX, { mes: '2026-10', hoje: '2026-10-19', operacao: 'apex' });
  const dd = d => p.dias.find(x => x.data === d);
  assert(p.dias.length === 23, '21 úteis + feriado 12/10 + sábado com venda 17/10 — ' + p.dias.length);
  assert(dd('2026-10-12').tipo === 'feriado' && dd('2026-10-17').tipo === 'naoUtil' && perto(dd('2026-10-17').valor, 35), 'feriado e sábado com venda');
  assert(!dd('2026-10-18'), 'domingo sem venda não aparece');
  assert(dd('2026-10-19').tipo === 'hoje' && perto(dd('2026-10-19').valor, 50), 'hoje parcial');
  assert(dd('2026-10-20').tipo === 'projetado' && perto(dd('2026-10-20').valor, 40) && perto(dd('2026-10-20').contratos, 7 / 11), 'dia futuro = ritmo');
  assert(dd('2026-10-08').tipo === 'realizado' && perto(dd('2026-10-08').valor, 0), 'dia útil só com Território = 0');
  assert(perto(dd('2026-10-01').valor, 100) && perto(dd('2026-10-01').contratos, 1) && dd('2026-10-01').linhas.length === 1, 'dia com 1 pedido');
  assert(dd('2026-10-14').linhas.length === 2 && perto(dd('2026-10-14').contratos, 1), 'convergência: 2 linhas, 1 contrato');

  const sem = p.semanas;
  assert(sem.length === 5, '5 semanas — ' + sem.length);
  const esperado = [
    ['2026-10-01', '2026-10-04', 2, 'fechada', 160, 2], ['2026-10-05', '2026-10-11', 5, 'fechada', 90, 2],
    ['2026-10-12', '2026-10-18', 4, 'fechada', 190, 3], ['2026-10-19', '2026-10-25', 5, 'atual', 200, 7 / 11 * 5],
    ['2026-10-26', '2026-10-31', 5, 'futura', 200, 7 / 11 * 5],
  ];
  esperado.forEach((e, i) => {
    const s = sem[i];
    assert(s && s.de === e[0] && s.ate === e[1] && s.diasUteis === e[2] && s.tipo === e[3] && perto(s.valor, e[4]) && perto(s.contratos, e[5]),
      'semana ' + i + ': ' + JSON.stringify(s && { de: s.de, ate: s.ate, diasUteis: s.diasUteis, tipo: s.tipo, valor: s.valor, contratos: s.contratos }));
  });
  assert(perto(sem.reduce((a, s) => a + s.valor, 0), 840), 'a soma das semanas é a projeção do mês');

  const c = p.consultores;
  assert(c.length === 2 && c[0].usuario === 'BRUNO TESTE' && c[1].usuario === 'ANA TESTE', 'maior projeção primeiro');
  assert(perto(c[0].valor, 235) && perto(c[0].contratos, 3.5) && perto(c[0].ritmo, 235 / 11) && perto(c[0].projMes, 235 / 11 * 21) && perto(c[0].projContratos, 3.5 / 11 * 21), 'Bruno');
  assert(c[0].linhas.length === 5 && c[0].operacao === 'apex', 'Bruno: 5 linhas até ontem');
  assert(perto(c[1].valor, 205) && c[1].linhas.length === 5, 'Ana: 205 (hoje fora)');

  const t = g => p.tipos.find(x => x.grupo === g);
  assert(p.tipos.length === 6 && p.tipos[0].grupo === 'VOZ - Novo', '6 tipos, Linha Nova primeiro');
  assert(t('VOZ - Novo').label === 'Linha Nova' && perto(t('VOZ - Novo').valor, 245) && t('VOZ - Novo').pedidos === 5, 'Linha Nova: 245 em 5 pedidos');
  assert(perto(t('VOZ - Novo').pct, 245 / 440) && perto(t('VOZ - Novo').projMes, 245 / 11 * 21), 'Linha Nova: % e projeção');
  assert(t('SVA MÓVEL').label === 'Claro Monitor' && perto(t('SVA MÓVEL').valor, 5), 'SVA Móvel com o rótulo da Visão Diária');
  assert(t('GRUPO NOVO X').label === 'GRUPO NOVO X' && perto(t('GRUPO NOVO X').valor, 10), 'grupo novo aparece pelo nome');
  assert(perto(p.tipos.reduce((a, x) => a + x.valor, 0), 440), 'tipos somam o realizado');

  const e = k => p.etapas.find(x => x.k === k);
  assert(JSON.stringify(p.etapas.map(x => x.k)) === '["concluido","entrega","antifraude","biometria"]', 'etapas na ordem');
  assert(e('concluido').contratos === 3 && perto(e('concluido').bruto, 235) && perto(e('concluido').valor, 235), 'Concluído: A1, A8 e a convergência');
  assert(e('entrega').contratos === 3 && perto(e('entrega').valor, 130), 'Entrega + eSIM: A2, A3 e M1');
  assert(e('antifraude').contratos === 1 && perto(e('antifraude').bruto, 90) && perto(e('antifraude').valor, 45), 'Antifraude: bruto 90, ponderado 45');
  assert(e('biometria').contratos === 1 && perto(e('biometria').bruto, 60) && perto(e('biometria').valor, 30), 'Biometria: bruto 60, ponderado 30');
  assert(perto(p.etapas.reduce((a, x) => a + x.valor, 0), 440) && p.etapas.reduce((a, x) => a + x.contratos, 0) === 8, 'etapas somam 440 e 8 contratos');

  const camp = w.montarProjecao(FIX_CAMP, { mes: '2026-10', hoje: '2026-10-19', operacao: 'campinas' });
  assert(camp.dias[0].data === '2026-10-06', 'Campinas: gráfico começa em 06/10');
  assert(camp.semanas.length === 4 && camp.semanas[0].de === '2026-10-05' && camp.semanas[0].diasUteis === 4, 'Campinas: 4 semanas, a 1ª com 4 úteis');
  assert(perto(camp.semanas.reduce((a, s) => a + s.valor, 0), 360), 'Campinas: semanas somam 360');
  const tod = w.montarProjecao(FIX_APEX.concat(FIX_CAMP), { mes: '2026-10', hoje: '2026-10-19', operacao: 'todas' });
  const carla = tod.consultores.find(x => x.usuario === 'CARLA CAMPINAS');
  assert(tod.consultores.length === 3 && carla.operacao === 'campinas' && perto(carla.projMes, 360), 'Apex + Campinas: Carla com os dias de Campinas');
  assert(perto(tod.semanas.reduce((a, s) => a + s.valor, 0), 1200), 'Apex + Campinas: semanas somam 1200');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU (exceção em Task 3): TypeError: Cannot read properties of undefined (reading 'length')` (p.dias não existe), exit 1.

- [ ] **Step 3: Implementar**

Em `montarProjecao`, trocar a última linha

```js
  return { mes, hoje, operacao: sel, fechado, semana, calendario, porOperacao, total, linhas, contratos };
```

por

```js
  const p = { mes, hoje, operacao: sel, fechado, semana, calendario, porOperacao, total, linhas, contratos };
  p.dias = projQuebraDias(p);
  p.semanas = projQuebraSemanas(p);
  p.consultores = projQuebraConsultores(p);
  p.tipos = projQuebraTipos(p);
  p.etapas = projQuebraEtapas(p);
  return p;
```

E inserir antes de `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// Dia a dia: cada dia útil do mês (de alguma operação da tela), os feriados de dia de semana e qualquer dia com venda
// (sábado, domingo) — assim o gráfico soma o realizado. Dia futuro = soma dos ritmos das operações que trabalham nele.
function projQuebraDias(p){
  const contratos = [...p.contratos.values()];
  const out = [];
  projDiasDoMes(p.mes).forEach(d => {
    const lsDia = p.linhas.filter(l => l.dia === d);
    const real = { valor: projSoma(lsDia), contratos: projPesoContratos(contratos.filter(c => c.dia === d)) };
    const opsUteis = p.porOperacao.filter(o => o.dias.uteis.indexOf(d) >= 0);
    const wd = projDiaSemana(d);
    let tipo;
    if(opsUteis.length) tipo = d < p.hoje ? 'realizado' : (d === p.hoje ? 'hoje' : 'projetado');
    else if(wd !== 0 && wd !== 6 && isHoliday(d) && p.porOperacao.some(o => !o.dias.inicio || d >= o.dias.inicio)) tipo = 'feriado';
    else if(real.valor > 0) tipo = 'naoUtil';
    else return;
    let valor = real.valor, ctr = real.contratos;
    if(tipo === 'projetado'){
      valor = 0; ctr = 0;
      opsUteis.forEach(o => { if(o.ritmo){ valor += o.ritmo.valor; ctr += o.ritmo.contratos; } });
    }
    out.push({ data: d, tipo, valor, contratos: ctr, linhas: lsDia.map(l => l.r) });
  });
  return out;
}

// Semanas seg–dom cortadas no mês. Fechada: realizado. Atual e futuras: realizado até ontem + ritmo × dias úteis que
// faltam (com hoje), por operação — a soma das semanas é a projeção do mês. Semana sem dia útil e sem venda some.
function projQuebraSemanas(p){
  const contratos = [...p.contratos.values()];
  const semanas = [];
  projDiasDoMes(p.mes).forEach(d => {
    const seg = projSegunda(d);
    let s = semanas.find(x => x.seg === seg);
    if(!s){ s = { seg, de: d, ate: d, dias: [] }; semanas.push(s); }
    s.ate = d;
    s.dias.push(d);
  });
  return semanas.map(s => {
    const naSemana = x => x.dia >= s.de && x.dia <= s.ate;
    let valor = projSoma(p.linhas.filter(l => naSemana(l) && l.dia < p.hoje));
    let ctr = projPesoContratos(contratos.filter(c => naSemana(c) && c.dia < p.hoje));
    p.porOperacao.forEach(o => {
      if(!o.ritmo) return;
      const faltam = s.dias.filter(d => d >= p.hoje && o.dias.uteis.indexOf(d) >= 0).length;
      valor += o.ritmo.valor * faltam;
      ctr += o.ritmo.contratos * faltam;
    });
    const diasUteis = s.dias.filter(d => p.porOperacao.some(o => o.dias.uteis.indexOf(d) >= 0)).length;
    const tipo = s.ate < p.hoje ? 'fechada' : (s.de <= p.hoje ? 'atual' : 'futura');
    return { de: s.de, ate: s.ate, diasUteis, tipo, valor, contratos: ctr, linhas: p.linhas.filter(naSemana).map(l => l.r) };
  }).filter(s => s.diasUteis > 0 || s.valor > 0);
}

// Por consultor (realizado até ontem): ritmo = valor ÷ dias úteis completos da operação dele.
function projQuebraConsultores(p){
  const mapa = new Map();
  p.linhas.forEach(l => {
    if(l.dia >= p.hoje) return;
    const nome = l.r.usuario || '(sem consultor)';
    const k = l.op + '|' + nome;
    if(!mapa.has(k)) mapa.set(k, { usuario: nome, operacao: l.op, valor: 0, contratos: 0, linhas: [] });
    const c = mapa.get(k);
    c.valor += l.valor;
    c.linhas.push(l.r);
  });
  p.contratos.forEach(ct => {
    if(ct.dia >= p.hoje) return;
    const c = mapa.get(ct.op + '|' + ct.usuario);
    if(c) c.contratos += ct.peso;
  });
  return [...mapa.values()].map(c => {
    const o = p.porOperacao.find(x => x.op === c.operacao);
    const dc = o.dias.completos, dt = o.dias.total;
    c.ritmo = dc > 0 ? c.valor / dc : null;
    c.projMes = dc > 0 ? c.valor / dc * dt : null;
    c.projContratos = dc > 0 ? c.contratos / dc * dt : null;
    return c;
  }).sort((a, b) => (b.projMes || 0) - (a.projMes || 0) || b.valor - a.valor || a.usuario.localeCompare(b.usuario, 'pt-BR'));
}

// Por tipo de venda (grupo do NeoCRM), com o rótulo da Visão Diária; grupo novo aparece pelo próprio nome.
function projRotuloTipo(grupo){
  const t = DIARIA_TIPOS_VENDA.find(x => x.grupo === grupo);
  return t ? t.label : (grupo || 'Sem tipo informado');
}
function projQuebraTipos(p){
  const mapa = new Map();
  p.linhas.forEach(l => {
    if(l.dia >= p.hoje) return;
    const g = l.r.grupo || '';
    if(!mapa.has(g)) mapa.set(g, { grupo: g, label: projRotuloTipo(g), valor: 0, chaves: new Set(), porOp: {}, linhas: [] });
    const t = mapa.get(g);
    t.valor += l.valor;
    t.chaves.add(l.contrato);
    t.porOp[l.op] = (t.porOp[l.op] || 0) + l.valor;
    t.linhas.push(l.r);
  });
  const totalReal = p.total.realizado ? p.total.realizado.valor : 0;
  return [...mapa.values()].map(t => {
    let proj = 0, temRitmo = false;
    Object.keys(t.porOp).forEach(op => {
      const o = p.porOperacao.find(x => x.op === op);
      if(o && o.dias.completos > 0){ temRitmo = true; proj += t.porOp[op] / o.dias.completos * o.dias.total; }
    });
    return { grupo: t.grupo, label: t.label, pedidos: t.chaves.size, valor: t.valor, pct: totalReal > 0 ? t.valor / totalReal : 0,
      projMes: temRitmo ? proj : null, linhas: t.linhas };
  }).sort((a, b) => b.valor - a.valor || a.label.localeCompare(b.label, 'pt-BR'));
}

// Por etapa: composição do realizado até ontem. Bruto e ponderado por linha; contratos pela faixa principal.
function projQuebraEtapas(p){
  const totalReal = p.total.realizado ? p.total.realizado.valor : 0;
  return PROJ_FAIXAS.map(f => {
    const ls = p.linhas.filter(l => l.faixa === f && l.dia < p.hoje);
    let contratos = 0;
    p.contratos.forEach(c => { if(c.faixa === f && c.dia < p.hoje) contratos++; });
    const valor = projSoma(ls);
    return { k: f.k, label: f.label, peso: f.peso, contratos, bruto: ls.reduce((s, l) => s + l.bruto, 0), valor,
      pct: totalReal > 0 ? valor / totalReal : 0, linhas: ls.map(l => l.r) };
  });
}
```

Run: `python dashboard_tpl.py empacotar`

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `0 falharam`, exit 0.

- [ ] **Step 5: Commit**

```bash
python build_painel.py
git add test_projecao_ganho.js _template.html painel_clientes_apex.html
git commit -F - <<'EOF'
feat(projecao): quebras por dia, semana, consultor, tipo de venda e etapa

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Tela da sub-aba

**Files:**
- Modify: `_dashboard_producao.html` — CSS (antes do único `</style>`), HTML (painel novo antes de `    <div class="footer-note">Apex Smart Solutions &middot; Dashboard de Produção Claro</div>`), `switchTab`, `window.atualizarDadosDashboard`, inicialização no fim do script e JS no fim da seção PROJEÇÃO DE GANHO.
- Test: `test_projecao_ganho.js`

**Interfaces:**
- Consumes: `montarProjecao`, `projMesesDisponiveis`, `projHoje`, `PROJ_*` (Tasks 1–3); `fmtBRL`, `fmtPct`, `monthLabel`, `fmtDateOnly`, `escHtml`, `escAttr`, `openDrilldown`, `DATA` (existentes).
- Produces: `renderProjecao()`, `renderProjecaoSeguro()`, `onCliqueProjecao(ev)`, `PROJ_ATUAL` (última projeção desenhada — usada pelo Excel da Task 5), `PROJ_DIA_ROTULO`, `PROJ_SEMANA_ROTULO`, `projDataCurta(iso) → 'dd/mm'`, `projFmtNum`, `projFmtBRL`, `projFmtCtr`; elementos `#tabProjecao`, `#projMes`, `#projExportBtn`, `#projMsg`, `#projCards`, `#projProgresso`, `#projDias`, `#projSemanas`, `#projEtapas`, `#projOperacoesBloco`, `#projOperacoes`, `#projConsultores`, `#projTipos`, `#projTitulo`, `#projSub`, `#projRegra`.

- [ ] **Step 1: Escrever os testes**

Run: `python dashboard_tpl.py extrair`

Acrescentar antes de `// ---------------- fim ----------------`:

```js
// ---------------- Task 4: tela ----------------
secao('Task 4', () => {
  const w = montarDashboard();
  const d = w.document;
  const btn = d.querySelector('.tabs [data-tab="projecao"]');
  assert(!!btn && btn.textContent === 'Projeção de Ganho', 'botão da sub-aba para admin/supervisor');
  assert(btn && btn.previousElementSibling && btn.previousElementSibling.dataset.tab === 'perdidas', 'logo depois de Vendas Perdidas');
  w.switchTab('projecao');
  assert(d.getElementById('tabProjecao').classList.contains('active') && d.body.classList.contains('tab-projecao'), 'switchTab abre a sub-aba e esconde os filtros');
  assert(txt(d.getElementById('projTitulo').textContent) === 'Projeção de Ganho · Operação Apex', 'título com a operação');
  const opts = [...d.querySelectorAll('#projMes option')].map(o => o.value);
  assert(JSON.stringify(opts) === '["2026-10","2026-09"]' && d.getElementById('projMes').value === '2026-10', 'seletor de mês abre no mês atual');
  assert(/Antifraude 50%/.test(txt(d.getElementById('projRegra').textContent)) && /Demais etapas 0%/.test(txt(d.getElementById('projRegra').textContent)), 'selos da regra');

  const cards = [...d.querySelectorAll('#projCards .card')];
  const lab = i => txt(cards[i].querySelector('.label').textContent), val = i => txt(cards[i].querySelector('.value').textContent), sub = i => txt(cards[i].querySelector('.proj-card-sub').textContent);
  assert(cards.length === 4, '4 cards');
  assert(lab(0) === 'Projeção do mês · 21 dias úteis' && val(0) === 'R$ 840,00' && cards[0].classList.contains('proj-hero'), 'card do mês: ' + lab(0) + ' / ' + val(0));
  assert(lab(1) === 'Projeção da semana · 19/10 a 23/10' && val(1) === 'R$ 200,00' && /5 dias úteis/.test(sub(1)), 'card da semana: ' + lab(1) + ' / ' + val(1));
  assert(val(2) === 'R$ 40,00' && /contratos por dia/.test(sub(2)), 'card diário');
  assert(val(3) === 'R$ 440,00' && /7,0 contratos até ontem/.test(sub(3)) && /hoje \(parcial\): R\$ 50,00/.test(sub(3)), 'card realizado: ' + sub(3));
  const prog = txt(d.getElementById('projProgresso').textContent);
  assert(/52,4% da projeção do mês já realizado/.test(prog) && /11 de 21 dias úteis completos · faltam 10 \(com hoje\)/.test(prog), 'barra de progresso: ' + prog);

  assert(d.querySelectorAll('#projDias .proj-col').length === 23, '23 barras');
  assert(d.querySelectorAll('#projDias .proj-hoje').length === 1 && d.querySelectorAll('#projDias .proj-projetado').length === 9, 'hoje + 9 projetadas');
  assert(d.querySelectorAll('#projDias .proj-feriado').length === 1 && d.querySelectorAll('#projDias .proj-naoUtil').length === 1, 'feriado e sábado');
  assert(/ritmo R\$ 40,00/.test(txt(d.querySelector('#projDias .proj-ritmo').textContent)), 'linha do ritmo');

  const semRows = d.querySelectorAll('#projSemanas tbody tr');
  assert(semRows.length === 6 && /01\/10–04\/10/.test(txt(semRows[0].textContent)) && /R\$ 160,00/.test(txt(semRows[0].textContent)), 'semanas + total');
  assert(semRows[3].classList.contains('proj-atual') && /R\$ 840,00/.test(txt(semRows[5].textContent)), 'semana atual marcada e total do mês');
  const etRows = d.querySelectorAll('#projEtapas tbody tr');
  assert(etRows.length === 5 && /Concluído/.test(etRows[0].textContent) && /R\$ 235,00/.test(txt(etRows[0].textContent)) && /100%/.test(etRows[0].textContent), 'etapas: Concluído');
  assert(/Antifraude/.test(etRows[2].textContent) && /50%/.test(etRows[2].textContent) && /R\$ 45,00/.test(txt(etRows[2].textContent)), 'etapas: Antifraude');
  const coRows = d.querySelectorAll('#projConsultores tbody tr');
  assert(!/Operação/.test(d.querySelector('#projConsultores thead').textContent), 'sem coluna Operação numa operação só');
  assert(coRows.length === 2 && /BRUNO TESTE/.test(coRows[0].textContent) && /R\$ 448,64/.test(txt(coRows[0].textContent)), 'consultores: Bruno primeiro');
  const tiRows = d.querySelectorAll('#projTipos tbody tr');
  assert(tiRows.length === 6 && /Linha Nova/.test(tiRows[0].textContent) && /Claro Monitor/.test(d.getElementById('projTipos').textContent), 'tipos de venda');
  assert(d.getElementById('projOperacoesBloco').style.display === 'none', 'quadro Por operação escondido numa operação só');

  // clique abre o analítico com os pedidos por trás do número
  coRows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(d.getElementById('drilldownTitle').textContent === 'Projeção — BRUNO TESTE' && w.eval('DRILLDOWN_RECORDS.length') === 5, 'analítico do consultor');
  d.querySelector('#projDias [data-proj="dia:2026-10-14"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(w.eval('DRILLDOWN_RECORDS.length') === 2, 'analítico do dia 14/10');

  // mês fechado
  d.getElementById('projMes').value = '2026-09';
  w.renderProjecaoSeguro();
  const c2 = [...d.querySelectorAll('#projCards .card')];
  assert(txt(c2[0].querySelector('.label').textContent) === 'Mês fechado · 21 dias úteis' && txt(c2[0].querySelector('.value').textContent) === 'R$ 70,00', 'setembro fechado');
  assert(txt(c2[1].querySelector('.value').textContent) === '—', 'sem semana em mês fechado');
  // atualização de 1 h mantém o mês escolhido
  w.atualizarDadosDashboard(FIX_APEX.concat([ped({ numero_pedido: 'A11', cadastro: dia('2026-10-16'), valor: 110 })]), '19/10/2026, 15:59:02');
  assert(d.getElementById('projMes').value === '2026-09', 'atualização de 1 h não troca o mês escolhido');
  d.getElementById('projMes').value = '2026-10';
  w.renderProjecaoSeguro();
  assert(txt(d.querySelector('#projCards .card .value').textContent) === 'R$ 1.050,00', 'dados novos entram na projeção (550 ÷ 11 × 21)');

  // Apex + Campinas
  const wt = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP) });
  const dt = wt.document;
  assert(txt(dt.getElementById('projTitulo').textContent) === 'Projeção de Ganho · Apex + Campinas', 'título Apex + Campinas');
  assert(txt(dt.querySelector('#projCards .card .value').textContent) === 'R$ 1.200,00', 'mês das duas = 1.200');
  assert(dt.getElementById('projOperacoesBloco').style.display === '' && dt.querySelectorAll('#projOperacoes tbody tr').length === 2, 'quadro Por operação');
  const linhaCamp = txt(dt.querySelectorAll('#projOperacoes tbody tr')[1].textContent);
  assert(/Campinas/.test(linhaCamp) && /desde 06\/10/.test(linhaCamp) && /R\$ 360,00/.test(linhaCamp), 'linha de Campinas: ' + linhaCamp);
  assert(/Operação/.test(dt.querySelector('#projConsultores thead').textContent) && dt.querySelectorAll('#projConsultores tbody tr').length === 3, 'consultores com a coluna Operação');
  // Jaime: só Campinas
  const wc = montarDashboard({ operacao: 'campinas', data: FIX_CAMP });
  const cc = wc.document.querySelector('#projCards .card');
  assert(txt(cc.querySelector('.value').textContent) === 'R$ 360,00' && /18 dias úteis/.test(cc.querySelector('.label').textContent), 'Campinas: 360 em 18 dias úteis');
  assert(JSON.stringify([...wc.document.querySelectorAll('#projMes option')].map(o => o.value)) === '["2026-10"]', 'Campinas: sem meses antes do início');
  // consultor: a sub-aba não existe
  const wn = montarDashboard({ adminMode: false });
  assert(!wn.document.getElementById('tabProjecao') && !wn.document.querySelector('[data-tab="projecao"]'), 'consultor não vê a sub-aba');
  // 1º dia útil e Campinas sem dia completo
  const w1 = montarDashboard({ agora: Date.parse('2026-10-01T10:00:00-03:00') });
  const k1 = w1.document.querySelector('#projCards .card');
  assert(txt(k1.querySelector('.value').textContent) === '—' && /a projeção começa no 2º dia útil/.test(k1.textContent), '1º dia útil sem projeção');
  const w6 = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP), agora: Date.parse('2026-10-06T10:00:00-03:00') });
  assert(/Operação Campinas ainda sem dia útil completo/.test(w6.document.getElementById('projMsg').textContent), 'aviso de Campinas sem dia completo');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU: botão da sub-aba para admin/supervisor` e outras falhas/exceção na Task 4, exit 1.

- [ ] **Step 3: CSS** — inserir imediatamente antes do único `</style>` do `_dashboard_producao.html`:

```css
  /* ---------- PROJEÇÃO DE GANHO (19/10/2026) — ver REGRAS_NEGOCIO.md seção 101 ----------
     Sub-aba só de admin/supervisor. Reaproveita .cards/.card, .alerta-toolbar, .alerta-tabela e .btn-export; aqui só o
     que é novo. Cores pelas variáveis do Dashboard: 100% = --ganho, 50% = --andamento. */
  body.tab-projecao .layout{grid-template-columns:1fr;}
  body.tab-projecao .layout .panel{display:none;}
  /* com a 6ª aba a linha de abas não cabe até 900px — quebra linha */
  @media (max-width:900px){ .tabs{flex-wrap:wrap;row-gap:6px;} }
  .proj-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;}
  .proj-acoes{margin:0;}
  .proj-regra{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px 0;}
  .proj-chip{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11.5px;color:var(--muted);}
  .proj-chip b{color:var(--text);}
  .proj-chip.proj-peso-cem b,.proj-peso.proj-peso-cem{color:var(--ganho);}
  .proj-chip.proj-peso-meio b,.proj-peso.proj-peso-meio{color:var(--andamento);}
  .proj-peso{font-weight:700;}
  .cards.proj-cards{grid-template-columns:1.35fr 1fr 1fr 1fr;}
  .card.proj-hero{background:var(--bordo);border-color:var(--bordo);}
  .card.proj-hero .label,.card.proj-hero .value,.card.proj-hero .proj-card-sub{color:var(--panel);}
  .proj-card-sub{font-size:12px;color:var(--muted);margin-top:4px;}
  .proj-progresso{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:6px;}
  .proj-prog-txt{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted);}
  .proj-barra{height:10px;background:var(--rosa);border-radius:99px;overflow:hidden;margin-top:6px;}
  .proj-barra i{display:block;height:100%;background:var(--accent);}
  .proj-grafico{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:6px;overflow-x:auto;}
  .proj-barras{position:relative;display:flex;align-items:flex-end;gap:4px;height:160px;border-bottom:1px solid var(--border);min-width:520px;}
  .proj-col{flex:1;height:100%;display:flex;align-items:flex-end;cursor:pointer;}
  .proj-col i{display:block;width:100%;border-radius:4px 4px 0 0;background:var(--accent);}
  .proj-col.proj-hoje i{background:repeating-linear-gradient(45deg,var(--accent) 0 3px,var(--panel) 3px 6px);border:1px solid var(--accent);}
  .proj-col.proj-projetado i{background:transparent;border:2px dashed var(--border);border-bottom:0;}
  .proj-col.proj-feriado,.proj-col.proj-naoUtil{flex:.45;}
  .proj-col.proj-feriado i{background:var(--panel2);border-radius:0;}
  .proj-col.proj-naoUtil i{background:var(--muted);}
  .proj-ritmo{position:absolute;left:0;right:0;border-top:2px solid var(--bordo);pointer-events:none;}
  .proj-ritmo span{position:absolute;right:0;top:-18px;font-size:11px;font-weight:700;color:var(--bordo);background:var(--panel);padding:0 4px;}
  .proj-eixo{display:flex;gap:4px;font-size:10px;color:var(--muted);margin-top:4px;min-width:520px;}
  .proj-eixo span{flex:1;text-align:center;}
  .proj-eixo span.proj-estreito{flex:.45;}
  .proj-duas{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  table.alerta-tabela.proj-tabela{min-width:0;}
  .proj-tabela tr[data-proj]{cursor:pointer;}
  .proj-tabela tr.proj-atual td{background:var(--alerta-min-bg);}
  .proj-tabela tr.proj-futura td{color:var(--muted);font-style:italic;}
  .proj-tabela tr.proj-total td{font-weight:700;border-top:2px solid var(--border);}
  .proj-rolagem{max-height:420px;overflow-y:auto;}
  .proj-vazio{color:var(--muted);text-align:center;}
  .proj-nota{font-size:11px;color:var(--muted);font-weight:400;}
  @media (max-width:720px){ .cards.proj-cards{grid-template-columns:1fr 1fr;} .proj-duas{grid-template-columns:1fr;} }
```

- [ ] **Step 4: HTML** — inserir imediatamente antes de `    <div class="footer-note">Apex Smart Solutions &middot; Dashboard de Produção Claro</div>`:

```html
    <!-- Projeção de Ganho (19/10/2026, só admin/supervisor — o script remove este bloco quando ADMIN_MODE é false).
         Valor ponderado pela etapa atual e projetado pelo ritmo dos dias úteis. Ver REGRAS_NEGOCIO.md seção 101.
         Os filtros da barra lateral não se aplicam aqui. -->
    <div id="tabProjecao" class="tab-panel">
      <div class="proj-topo">
        <div>
          <div class="section-title" style="margin-top:0;" id="projTitulo">Projeção de Ganho</div>
          <p class="section-sub" id="projSub"></p>
        </div>
        <div class="alerta-toolbar proj-acoes">
          <label>Mês<select id="projMes" onchange="renderProjecaoSeguro()"></select></label>
          <button type="button" class="btn-export" id="projExportBtn" onclick="exportarProjecaoExcel()">&#128190; Baixar Excel</button>
        </div>
      </div>
      <div class="proj-regra" id="projRegra"></div>
      <p class="alerta-msg" id="projMsg"></p>
      <div class="cards proj-cards" id="projCards"></div>
      <div class="proj-progresso" id="projProgresso"></div>
      <div class="section-title">Dia a dia (dias úteis)</div>
      <p class="section-sub">Cheia = realizado ponderado · hachurada = hoje (parcial, fora do ritmo) · tracejada = projetado pelo ritmo. Clique numa barra para ver os pedidos.</p>
      <div class="proj-grafico" id="projDias"></div>
      <div class="proj-duas">
        <div>
          <div class="section-title">Semana a semana</div>
          <p class="section-sub">Semanas fechadas mostram o realizado; a atual e as futuras somam o ritmo × dias úteis que faltam (*).</p>
          <div class="alerta-tabela-wrap"><table class="alerta-tabela proj-tabela" id="projSemanas"></table></div>
        </div>
        <div>
          <div class="section-title">Por etapa</div>
          <p class="section-sub">De onde vem o realizado (até ontem): valor bruto × peso.</p>
          <div class="alerta-tabela-wrap"><table class="alerta-tabela proj-tabela" id="projEtapas"></table></div>
        </div>
      </div>
      <div id="projOperacoesBloco" style="display:none">
        <div class="section-title">Por operação</div>
        <div class="alerta-tabela-wrap"><table class="alerta-tabela proj-tabela" id="projOperacoes"></table></div>
      </div>
      <div class="section-title">Por consultor</div>
      <p class="section-sub">Ordenado pela projeção do mês · ritmo de cada um = realizado até ontem ÷ dias úteis completos da operação.</p>
      <div class="alerta-tabela-wrap proj-rolagem"><table class="alerta-tabela proj-tabela" id="projConsultores"></table></div>
      <div class="section-title">Por tipo de venda</div>
      <p class="section-sub">Um pedido pode ter mais de um tipo (ex.: Voz + Claro Monitor), por isso a soma dos pedidos pode passar do total.</p>
      <div class="alerta-tabela-wrap"><table class="alerta-tabela proj-tabela" id="projTipos"></table></div>
    </div>

```

- [ ] **Step 5: `switchTab`, atualização de 1 h e inicialização**

Em `switchTab`, trocar

```js
  const PAINEIS = { daily: 'tabDaily', diaria: 'tabDiaria', alertas: 'tabAlertas', perdidas: 'tabPerdidas' };
```

por

```js
  const PAINEIS = { daily: 'tabDaily', diaria: 'tabDiaria', alertas: 'tabAlertas', perdidas: 'tabPerdidas', projecao: 'tabProjecao' };
```

e, logo depois da linha `  document.body.classList.toggle('tab-perdidas', name === 'perdidas'); // Vendas Perdidas: idem (seção 70)`, acrescentar:

```js
  document.body.classList.toggle('tab-projecao', name === 'projecao'); // Projeção de Ganho: idem (seção 101)
```

Em `window.atualizarDadosDashboard`, trocar

```js
  applyFilters();
  renderVisaoDiaria();
  renderPedidosAlerta();
};
```

por

```js
  applyFilters();
  renderVisaoDiaria();
  renderPedidosAlerta();
  renderProjecaoSeguro(); // seção 101: mantém o mês escolhido
};
```

No fim do script, trocar

```js
applyFilters();
renderPedidosAlerta();
renderVendasPerdidasSeguro();
```

por

```js
applyFilters();
renderPedidosAlerta();
renderVendasPerdidasSeguro();
renderProjecaoSeguro();
```

- [ ] **Step 6: JS da tela** — inserir antes de `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// ----- Tela da Projeção de Ganho -----
const PROJ_DIA_ROTULO = { realizado: 'realizado', hoje: 'hoje (parcial)', projetado: 'projetado', feriado: 'feriado', naoUtil: 'fim de semana' };
const PROJ_SEMANA_ROTULO = { fechada: 'realizado', atual: 'atual (realizado + projetado)', futura: 'projetado' };
const PROJ_SEM_RITMO = 'a projeção começa no 2º dia útil';
let PROJ_ATUAL = null;

function projFmtNum(v, casas){ return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
function projFmtBRL(v){ return v == null ? '—' : fmtBRL(v); }
function projFmtCtr(v){ return v == null ? '—' : projFmtNum(v, 1); }
function projDataCurta(dia){ return dia.slice(8, 10) + '/' + dia.slice(5, 7); }

function projCardsHtml(p){
  const t = p.total, cal = p.calendario;
  const card = (classe, rotulo, valor, sub) =>
    `<div class="card ${classe}"><div class="label">${escHtml(rotulo)}</div><div class="value">${escHtml(valor)}</div><div class="proj-card-sub">${sub}</div></div>`;
  const ctr = v => escHtml(projFmtCtr(v)) + ' contratos';
  const mes = p.fechado
    ? card('proj-hero', 'Mês fechado · ' + cal.total + ' dias úteis', projFmtBRL(t.realizado.valor), ctr(t.realizado.contratos))
    : card('proj-hero', 'Projeção do mês · ' + cal.total + ' dias úteis', projFmtBRL(t.mes && t.mes.valor), t.mes ? ctr(t.mes.contratos) : PROJ_SEM_RITMO);
  let semana;
  if(p.fechado) semana = card('', 'Projeção da semana', '—', 'mês fechado');
  else {
    const rotulo = 'Projeção da semana · ' + projDataCurta(p.semana.de) + ' a ' + projDataCurta(projSomaDias(p.semana.de, 4));
    semana = card('', rotulo, projFmtBRL(t.semana && t.semana.valor), t.semana ? ctr(t.semana.contratos) + ' · ' + t.semana.uteis + ' dias úteis' : PROJ_SEM_RITMO);
  }
  const diaria = card('', p.fechado ? 'Média por dia útil' : 'Projeção diária · por dia útil', projFmtBRL(t.ritmo && t.ritmo.valor),
    t.ritmo ? escHtml(projFmtCtr(t.ritmo.contratos)) + ' contratos por dia' : PROJ_SEM_RITMO);
  const real = card('', 'Realizado ponderado', projFmtBRL(t.realizado.valor),
    ctr(t.realizado.contratos) + (p.fechado ? ' no mês' : ' até ontem · <b>hoje (parcial): ' + escHtml(fmtBRL(t.hoje.valor)) + '</b>'));
  return mes + semana + diaria + real;
}

function projProgressoHtml(p){
  const cal = p.calendario, t = p.total;
  if(p.fechado) return `<div class="proj-prog-txt"><span><b>Mês fechado</b> · ${cal.total} dias úteis</span><span>Projeção = realizado</span></div>`;
  const pct = t.mes && t.mes.valor > 0 ? Math.min(1, t.realizado.valor / t.mes.valor) : 0;
  return `<div class="proj-prog-txt"><span><b>${escHtml(fmtPct(pct))}</b> da projeção do mês já realizado</span>`
    + `<span>${cal.completos} de ${cal.total} dias úteis completos · faltam ${cal.restantes} (com hoje)</span></div>`
    + `<div class="proj-barra"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>`;
}

function projGraficoHtml(p){
  const ritmo = p.total.ritmo && !p.fechado ? p.total.ritmo.valor : null;
  const max = Math.max(1, ritmo || 0, ...p.dias.map(d => d.valor));
  const estreito = d => d.tipo === 'feriado' || d.tipo === 'naoUtil';
  const cols = p.dias.map(d => {
    const altura = d.tipo === 'feriado' ? 100 : Math.round(d.valor / max * 100);
    const dica = projDataCurta(d.data) + ' · ' + PROJ_DIA_ROTULO[d.tipo] + ' · ' + fmtBRL(d.valor) + ' · ' + projFmtNum(d.contratos, 1) + ' contratos';
    return `<div class="proj-col proj-${d.tipo}" data-proj="dia:${d.data}" title="${escAttr(dica)}"><i style="height:${altura}%"></i></div>`;
  }).join('');
  const linha = ritmo != null ? `<div class="proj-ritmo" style="bottom:${(ritmo / max * 100).toFixed(1)}%"><span>ritmo ${escHtml(fmtBRL(ritmo))}</span></div>` : '';
  const eixo = p.dias.map(d => `<span${estreito(d) ? ' class="proj-estreito"' : ''}>${d.tipo === 'hoje' ? '<b>' + d.data.slice(8, 10) + '</b>' : d.data.slice(8, 10)}</span>`).join('');
  return `<div class="proj-barras">${linha}${cols}</div><div class="proj-eixo">${eixo}</div>`;
}

function projSemanasHtml(p){
  const cab = '<thead><tr><th>Semana</th><th class="num">Dias úteis</th><th class="num">R$</th><th class="num">Contratos</th></tr></thead>';
  const linhas = p.semanas.map(s => {
    const proj = s.tipo !== 'fechada' ? '*' : '';
    return `<tr class="proj-${s.tipo}" data-proj="semana:${s.de}"><td>${projDataCurta(s.de)}–${projDataCurta(s.ate)}${s.tipo === 'atual' ? ' · atual' : ''}</td>`
      + `<td class="num">${s.diasUteis}</td><td class="num">${escHtml(fmtBRL(s.valor))}${proj}</td><td class="num">${escHtml(projFmtNum(s.contratos, 1))}${proj}</td></tr>`;
  }).join('');
  const t = p.fechado ? p.total.realizado : p.total.mes;
  const total = `<tr class="proj-total"><td>Mês</td><td class="num">${p.calendario.total}</td><td class="num">${escHtml(projFmtBRL(t && t.valor))}</td><td class="num">${escHtml(projFmtCtr(t && t.contratos))}</td></tr>`;
  return cab + '<tbody>' + linhas + total + '</tbody>';
}

function projEtapasHtml(p){
  const cab = '<thead><tr><th>Etapa</th><th class="num">Contratos</th><th class="num">Bruto</th><th class="num">Peso</th><th class="num">Ponderado</th><th class="num">%</th></tr></thead>';
  const linhas = p.etapas.map(e => `<tr data-proj="etapa:${e.k}"><td>${escHtml(e.label)}</td><td class="num">${e.contratos}</td>`
    + `<td class="num">${escHtml(fmtBRL(e.bruto))}</td><td class="num"><span class="proj-peso proj-peso-${e.peso === 1 ? 'cem' : 'meio'}">${escHtml(fmtPct(e.peso))}</span></td>`
    + `<td class="num">${escHtml(fmtBRL(e.valor))}</td><td class="num">${escHtml(fmtPct(e.pct))}</td></tr>`).join('');
  const tc = p.etapas.reduce((s, e) => s + e.contratos, 0), tb = p.etapas.reduce((s, e) => s + e.bruto, 0), tv = p.etapas.reduce((s, e) => s + e.valor, 0);
  const total = `<tr class="proj-total"><td>Total</td><td class="num">${tc}</td><td class="num">${escHtml(fmtBRL(tb))}</td><td></td>`
    + `<td class="num">${escHtml(fmtBRL(tv))}</td><td class="num">${tv > 0 ? '100%' : '—'}</td></tr>`;
  return cab + '<tbody>' + linhas + total + '</tbody>';
}

function projConsultoresHtml(p){
  const comOp = p.operacao === 'todas';
  const cab = '<thead><tr><th>#</th><th>Consultor</th>' + (comOp ? '<th>Operação</th>' : '')
    + '<th class="num">Contratos</th><th class="num">Realizado</th><th class="num">Ritmo / dia útil</th><th class="num">Projeção mês</th><th class="num">Contratos proj.</th></tr></thead>';
  if(!p.consultores.length) return cab + `<tbody><tr><td colspan="${comOp ? 8 : 7}" class="proj-vazio">Nenhum pedido ponderado até ontem neste mês.</td></tr></tbody>`;
  const linhas = p.consultores.map((c, i) => `<tr data-proj="consultor:${i}"><td>${i + 1}</td><td>${escHtml(c.usuario)}</td>`
    + (comOp ? `<td>${escHtml(PROJ_OPERACAO_CURTO[c.operacao])}</td>` : '')
    + `<td class="num">${escHtml(projFmtNum(c.contratos, 1))}</td><td class="num">${escHtml(fmtBRL(c.valor))}</td><td class="num">${escHtml(projFmtBRL(c.ritmo))}</td>`
    + `<td class="num"><b>${escHtml(projFmtBRL(c.projMes))}</b></td><td class="num">${escHtml(projFmtCtr(c.projContratos))}</td></tr>`).join('');
  return cab + '<tbody>' + linhas + '</tbody>';
}

function projTiposHtml(p){
  const cab = '<thead><tr><th>Tipo</th><th class="num">Pedidos</th><th class="num">Realizado</th><th class="num">%</th><th class="num">Projeção mês</th></tr></thead>';
  if(!p.tipos.length) return cab + '<tbody><tr><td colspan="5" class="proj-vazio">Nenhum pedido ponderado até ontem neste mês.</td></tr></tbody>';
  return cab + '<tbody>' + p.tipos.map((t, i) => `<tr data-proj="tipo:${i}"><td>${escHtml(t.label)}</td><td class="num">${t.pedidos}</td>`
    + `<td class="num">${escHtml(fmtBRL(t.valor))}</td><td class="num">${escHtml(fmtPct(t.pct))}</td><td class="num">${escHtml(projFmtBRL(t.projMes))}</td></tr>`).join('') + '</tbody>';
}

function projOperacoesHtml(p){
  const cab = '<thead><tr><th>Operação</th><th class="num">Dias úteis completos</th><th class="num">Realizado</th><th class="num">Hoje (parcial)</th>'
    + '<th class="num">Ritmo / dia útil</th><th class="num">Projeção semana</th><th class="num">Projeção mês</th></tr></thead>';
  return cab + '<tbody>' + p.porOperacao.map(o => {
    const desde = o.dias.inicio && o.dias.inicio.slice(0, 7) === p.mes ? ` <span class="proj-nota">desde ${projDataCurta(o.dias.inicio)}</span>` : '';
    return `<tr><td>${escHtml(PROJ_OPERACAO_CURTO[o.op])}${desde}</td><td class="num">${o.dias.completos} de ${o.dias.total}</td>`
      + `<td class="num">${escHtml(fmtBRL(o.realizado.valor))}</td><td class="num">${escHtml(fmtBRL(o.hoje.valor))}</td>`
      + `<td class="num">${escHtml(projFmtBRL(o.ritmo && o.ritmo.valor))}</td><td class="num">${escHtml(projFmtBRL(o.semana && o.semana.valor))}</td>`
      + `<td class="num"><b>${escHtml(projFmtBRL(o.mes && o.mes.valor))}</b></td></tr>`;
  }).join('') + '</tbody>';
}

function renderProjecao(){
  const painel = document.getElementById('tabProjecao');
  if(!painel) return;
  const hoje = projHoje();
  const sel = OPERACAO_SELECIONADA;
  const selMes = document.getElementById('projMes');
  const meses = projMesesDisponiveis(DATA, sel, hoje);
  const anterior = selMes.value;
  selMes.innerHTML = meses.map(m => `<option value="${m}">${escHtml(monthLabel(m))}</option>`).join('');
  selMes.value = meses.indexOf(anterior) >= 0 ? anterior : meses[0];
  const p = montarProjecao(DATA, { mes: selMes.value, hoje, operacao: sel });
  PROJ_ATUAL = p;
  document.getElementById('projTitulo').textContent = 'Projeção de Ganho · ' + PROJ_OPERACAO_ROTULO[sel];
  const upd = document.querySelector('.topbar .updated');
  document.getElementById('projSub').textContent = 'Ritmo = ponderado até ontem ÷ dias úteis completos · mês pela data de cadastro do pedido'
    + (upd ? ' · ' + upd.textContent : '');
  document.getElementById('projRegra').innerHTML = PROJ_FAIXAS.map(f =>
    `<span class="proj-chip proj-peso-${f.peso === 1 ? 'cem' : 'meio'}">${escHtml(f.label)} <b>${escHtml(fmtPct(f.peso))}</b></span>`).join('')
    + '<span class="proj-chip">Demais etapas <b>0%</b></span><span class="proj-chip">Dias úteis: seg–sex, sem feriados nacionais</span>';
  const semDia = p.fechado ? [] : p.porOperacao.filter(o => !o.ritmo && o.dias.total > 0).map(o => PROJ_OPERACAO_ROTULO[o.op]);
  document.getElementById('projMsg').textContent = semDia.length && p.porOperacao.length > 1
    ? semDia.join(' e ') + ' ainda sem dia útil completo neste mês — fica fora da projeção.' : '';
  document.getElementById('projCards').innerHTML = projCardsHtml(p);
  document.getElementById('projProgresso').innerHTML = projProgressoHtml(p);
  document.getElementById('projDias').innerHTML = projGraficoHtml(p);
  document.getElementById('projSemanas').innerHTML = projSemanasHtml(p);
  document.getElementById('projEtapas').innerHTML = projEtapasHtml(p);
  document.getElementById('projConsultores').innerHTML = projConsultoresHtml(p);
  document.getElementById('projTipos').innerHTML = projTiposHtml(p);
  document.getElementById('projOperacoesBloco').style.display = sel === 'todas' ? '' : 'none';
  document.getElementById('projOperacoes').innerHTML = sel === 'todas' ? projOperacoesHtml(p) : '';
}
// Um erro inesperado na sub-aba nunca pode apagar o resto do Dashboard.
function renderProjecaoSeguro(){
  try{ renderProjecao(); }catch(e){ console.error('Projeção de Ganho:', e); }
}

// Clique em barra/linha abre o analítico (drilldown) que já existe, com os pedidos por trás do número.
function onCliqueProjecao(ev){
  const alvo = ev.target.closest('[data-proj]');
  if(!alvo || !PROJ_ATUAL) return;
  const sep = alvo.dataset.proj.indexOf(':');
  const tipo = alvo.dataset.proj.slice(0, sep), chave = alvo.dataset.proj.slice(sep + 1);
  const p = PROJ_ATUAL;
  let recs = null, titulo = '';
  if(tipo === 'dia'){ const x = p.dias.find(d => d.data === chave); if(x){ recs = x.linhas; titulo = 'Projeção — ' + fmtDateOnly(chave); } }
  else if(tipo === 'semana'){ const x = p.semanas.find(s => s.de === chave); if(x){ recs = x.linhas; titulo = 'Projeção — semana ' + projDataCurta(x.de) + ' a ' + projDataCurta(x.ate); } }
  else if(tipo === 'consultor'){ const x = p.consultores[Number(chave)]; if(x){ recs = x.linhas; titulo = 'Projeção — ' + x.usuario; } }
  else if(tipo === 'tipo'){ const x = p.tipos[Number(chave)]; if(x){ recs = x.linhas; titulo = 'Projeção — ' + x.label; } }
  else if(tipo === 'etapa'){ const x = p.etapas.find(e => e.k === chave); if(x){ recs = x.linhas; titulo = 'Projeção — ' + x.label; } }
  if(recs && recs.length) openDrilldown(recs, titulo);
}

// A sub-aba só existe pra admin/supervisor, logo depois de "Vendas Perdidas"; pro consultor, some até o painel do DOM.
if(ADMIN_MODE){
  const abas = document.querySelector('.tabs');
  const btnProjecao = '<button type="button" class="tab-btn" data-tab="projecao" onclick="switchTab(\'projecao\')">Projeção de Ganho</button>';
  const antes = abas && (abas.querySelector('[data-tab="perdidas"]') || abas.querySelector('[data-tab="alertas"]'));
  if(antes) antes.insertAdjacentHTML('afterend', btnProjecao);
  else if(abas) abas.insertAdjacentHTML('beforeend', btnProjecao);
  const painelProjecao = document.getElementById('tabProjecao');
  if(painelProjecao) painelProjecao.addEventListener('click', onCliqueProjecao);
} else {
  const painelProjecao = document.getElementById('tabProjecao');
  if(painelProjecao) painelProjecao.remove();
}
```

Run: `python dashboard_tpl.py empacotar`

- [ ] **Step 7: Rodar e ver passar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `0 falharam`, exit 0. (O `exportarProjecaoExcel` ainda não existe; o botão só é clicado na Task 5.)

Run: `NODE_PATH=../../crm/node_modules node test_visao_diaria.js && NODE_PATH=../../crm/node_modules node test_vendas_perdidas.js && NODE_PATH=../../crm/node_modules node test_dashboard_ajustes.js`
Expected: todos com `0 falharam`.

- [ ] **Step 8: Commit**

```bash
python build_painel.py
git add test_projecao_ganho.js _template.html painel_clientes_apex.html
git commit -F - <<'EOF'
feat(projecao): sub-aba Projeção de Ganho no Dashboard (admin e supervisor)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Excel

**Files:**
- Modify: `_dashboard_producao.html` (fim da seção PROJEÇÃO DE GANHO)
- Test: `test_projecao_ganho.js` (função `testarExcel` antes de `// ---------------- fim ----------------`)

**Interfaces:**
- Consumes: `PROJ_ATUAL` e helpers da Task 4; `carregarExcelJS()`, `baixarArquivo(buffer, nome)`, `WEEKDAY_NAMES`, `shortEtapa`, `monthLabel` (existentes).
- Produces: `gerarExcelProjecao(ExcelJS, p, { atualizadoEm }) → Workbook` (7 abas: Resumo, Dia a dia, Semana a semana, Por consultor, Por tipo de venda, Por etapa, Pedidos), `projPedidosExcel(p) → [{ numero, op, usuario, tipos:Set, etapas:Set, dia, bruto, valor, peso, cliente, cnpj }]`, `exportarProjecaoExcel()` (async).

- [ ] **Step 1: Escrever os testes**

Run: `python dashboard_tpl.py extrair`

Acrescentar antes de `// ---------------- fim ----------------`:

```js
// ---------------- Task 5: Excel ----------------
// ExcelJS do Node só pra RELER o arquivo. Quem GERA é o bundle de navegador (o mesmo do cdnjs) carregado no jsdom.
async function testarExcel(){
  const ExcelJS = require('exceljs');
  const bundle = fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8');
  const baixar = async (w) => {
    let baixado = null;
    w.baixarArquivo = (buffer, nome) => { baixado = { buffer, nome }; };
    await w.exportarProjecaoExcel();
    const wb = new ExcelJS.Workbook();
    if(baixado) await wb.xlsx.load(Buffer.from(baixado.buffer));
    return { nome: baixado && baixado.nome, wb };
  };
  const w = montarDashboard();
  w.eval(bundle);
  const { nome, wb } = await baixar(w);
  assert(nome === 'ProjecaoGanho_Apex_2026-10.xlsx', 'nome do arquivo: ' + nome);
  assert(JSON.stringify(wb.worksheets.map(s => s.name)) === JSON.stringify(['Resumo', 'Dia a dia', 'Semana a semana', 'Por consultor', 'Por tipo de venda', 'Por etapa', 'Pedidos']), '7 abas');
  const r = wb.getWorksheet('Resumo');
  assert(String(r.getCell('A1').value) === 'Projeção de Ganho — Operação Apex — Outubro/2026', 'título: ' + r.getCell('A1').value);
  assert(String(r.getCell('A2').value).indexOf('Base de 19/10/2026, 14:59:02') === 0, 'linha 2 com a base');
  assert(r.getCell('A3').value === 'Indicador' && r.getCell('A3').fill.fgColor.argb === 'FF1D1F20' && r.getCell('A3').font.color.argb === 'FFFFFFFF', 'cabeçalho grafite');
  assert(r.views[0] && r.views[0].state === 'frozen' && r.views[0].ySplit === 3, 'cabeçalho congelado');
  assert(r.getCell('A4').value === 'Projeção do mês' && perto(r.getCell('B4').value, 840) && String(r.getCell('B4').numFmt).indexOf('R$') >= 0, 'projeção do mês em R$');
  assert(perto(r.getCell('B5').value, 200) && perto(r.getCell('B6').value, 40) && perto(r.getCell('B7').value, 440) && perto(r.getCell('B8').value, 50), 'semana, dia, realizado e hoje');
  assert(r.getCell('A9').value === 'Dias úteis do mês' && r.getCell('B9').value === 21 && r.getCell('B9').numFmt === '0', 'dias úteis como número');
  const dd = wb.getWorksheet('Dia a dia');
  assert(dd.actualRowCount === 3 + 23, '23 dias');
  assert(dd.getCell('A4').value instanceof Date && dd.getCell('A4').value.getUTCDate() === 1 && dd.getCell('A4').numFmt === 'dd/mm/yyyy', 'data real do Excel');
  let linhaProj = null;
  dd.eachRow((row, n) => { if(n > 3 && row.getCell(3).value === 'projetado' && !linhaProj) linhaProj = row; });
  assert(linhaProj && linhaProj.getCell(1).font && linhaProj.getCell(1).font.italic === true && perto(linhaProj.getCell(4).value, 40), 'dia projetado em itálico com o ritmo');
  const ss = wb.getWorksheet('Semana a semana');
  assert(ss.actualRowCount === 3 + 5 + 1 && ss.getCell('A9').value === 'Mês' && perto(ss.getCell('D9').value, 840), 'semanas + linha do mês');
  const et = wb.getWorksheet('Por etapa');
  assert(et.getCell('A4').value === 'Concluído' && et.getCell('D4').value === 1 && et.getCell('D4').numFmt === '0%' && et.getCell('D4').fill.fgColor.argb === 'FF1F7A45', 'peso 100% verde');
  assert(et.getCell('D6').value === 0.5 && et.getCell('D6').fill.fgColor.argb === 'FFEAB308', 'peso 50% amarelo');
  const pe = wb.getWorksheet('Pedidos');
  assert(pe.actualRowCount === 3 + 10, '10 pedidos (M1 numa linha só, C1 e C2 separados)');
  let m1 = null, c1 = null, a9 = null;
  pe.eachRow((row, n) => { const v = row.getCell(1).value; if(v === 'M1') m1 = row; if(v === 'C1') c1 = row; if(v === 'A9') a9 = row; });
  assert(m1 && perto(m1.getCell(8).value, 40) && m1.getCell(9).value === 1 && perto(m1.getCell(10).value, 35), 'M1: bruto 40, peso 100%, ponderado 35');
  assert(m1 && m1.getCell(4).value === 'Linha Nova + Claro Monitor' && m1.getCell(5).value === 'ENTREGA + ANTIFRAUDE', 'M1: tipos e etapas juntos');
  assert(c1 && c1.getCell(12).value === '22222222000100' && c1.getCell(12).numFmt === '@' && c1.getCell(1).numFmt === '@', 'nº e CNPJ como texto');
  assert(a9 && a9.getCell(7).value === 'hoje (parcial)', 'pedido de hoje marcado como parcial');

  const wt = montarDashboard({ operacao: 'todas', data: FIX_APEX.concat(FIX_CAMP) });
  wt.eval(bundle);
  const t = await baixar(wt);
  assert(t.nome === 'ProjecaoGanho_ApexCampinas_2026-10.xlsx', 'arquivo das duas operações: ' + t.nome);
  assert(t.wb.getWorksheet('Por consultor').getCell('B3').value === 'Operação', 'coluna Operação no Excel');
  let campRow = null;
  t.wb.getWorksheet('Resumo').eachRow(row => { if(row.getCell(1).value === 'Projeção do mês — Campinas') campRow = row; });
  assert(campRow && perto(campRow.getCell(2).value, 360), 'Resumo com a projeção de cada operação');

  // falha ao carregar a biblioteca: aviso e botão reabilitado
  w.carregarExcelJS = () => Promise.reject(new Error('sem internet'));
  const errOrig = w.console.error; w.console.error = () => {};
  await w.exportarProjecaoExcel();
  w.console.error = errOrig;
  assert(/Não foi possível gerar o Excel/.test(w.document.getElementById('projMsg').textContent), 'aviso quando a ExcelJS não carrega');
  assert(w.document.getElementById('projExportBtn').disabled === false, 'botão volta a ficar habilitado');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU (exceção no teste do Excel): TypeError: w.exportarProjecaoExcel is not a function`, exit 1.

- [ ] **Step 3: Implementar** — antes de `// Chamada pelo painel externo (loadProducaoDashboard(), a cada 1h) com os dados mais recentes de`:

```js
// ----- Excel da Projeção de Ganho (ExcelJS, carregada só no clique — a mesma dos Pedidos em Alerta) -----
const PROJ_EXCEL = { cabFundo: 'FF1D1F20', cabTexto: 'FFFFFFFF', cem: 'FF1F7A45', meio: 'FFEAB308', cinza: 'FF666666' };
const PROJ_FMT_RS = '"R$" #,##0.00';
const PROJ_FMT_CTR = '0.0';
const PROJ_FMT_PCT = '0.0%';

function projExcelData(dia){ const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function projExcelAba(wb, nome, titulo, sub, cab, linhas, formatos){
  const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = sub;
  ws.getCell('A2').font = { italic: true, color: { argb: PROJ_EXCEL.cinza } };
  const cabRow = ws.getRow(3);
  cab.forEach((t, i) => {
    const c = cabRow.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: PROJ_EXCEL.cabTexto } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROJ_EXCEL.cabFundo } };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cab.length } };
  linhas.forEach((vals, i) => {
    const row = ws.getRow(4 + i);
    vals.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      if(formatos[c]) cell.numFmt = formatos[c];
    });
  });
  cab.forEach((t, i) => {
    let max = t.length;
    linhas.forEach(vals => { const v = vals[i]; const len = v instanceof Date ? 12 : String(v == null ? '' : v).length; if(len > max) max = len; });
    ws.getColumn(i + 1).width = Math.min(50, max + 2);
  });
  return ws;
}
function projExcelItalico(ws, linha){
  ws.getRow(linha).eachCell(c => { c.font = { italic: true, color: { argb: PROJ_EXCEL.cinza } }; });
}
function projPintarPeso(cell, peso){
  const cem = peso === 1;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cem ? PROJ_EXCEL.cem : PROJ_EXCEL.meio } };
  cell.font = { bold: true, color: { argb: cem ? 'FFFFFFFF' : 'FF000000' } };
}
// Uma linha por pedido (numero_pedido) do mês com peso > 0; linhas sem número ficam pela chave do contrato.
function projPedidosExcel(p){
  const mapa = new Map();
  p.linhas.forEach(l => {
    const temNumero = l.r.numero_pedido != null && String(l.r.numero_pedido).trim() !== '';
    const k = temNumero ? 'N' + String(l.r.numero_pedido) : l.contrato;
    if(!mapa.has(k)){
      mapa.set(k, { numero: temNumero ? String(l.r.numero_pedido) : '', op: l.op, usuario: l.r.usuario || '', tipos: new Set(), etapas: new Set(),
        dia: l.dia, bruto: 0, valor: 0, peso: 0, cliente: l.r.cliente || '', cnpj: l.r.cnpj ? String(l.r.cnpj) : '' });
    }
    const x = mapa.get(k);
    x.tipos.add(projRotuloTipo(l.r.grupo));
    x.etapas.add(shortEtapa(String(l.r.etapa || '')));
    x.bruto += l.bruto;
    x.valor += l.valor;
    if(l.peso > x.peso) x.peso = l.peso;
  });
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia) || a.numero.localeCompare(b.numero));
}

function gerarExcelProjecao(ExcelJS, p, ctx){
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex Smart Solutions';
  const titulo = 'Projeção de Ganho — ' + PROJ_OPERACAO_ROTULO[p.operacao] + ' — ' + monthLabel(p.mes);
  const sub = 'Base de ' + ((ctx && ctx.atualizadoEm) || '—')
    + ' · Pesos: Concluído 100%, Entrega + Validação eSIM 100%, Antifraude 50%, Biometria 50%, demais etapas 0%'
    + ' · Ritmo = ponderado até ontem ÷ dias úteis completos · dias úteis: seg–sex sem feriados nacionais';
  const t = p.total, cal = p.calendario;
  const v = x => (x == null ? null : x);
  const comOp = p.operacao === 'todas';

  const resumo = [
    p.fechado ? ['Mês fechado (realizado)', t.realizado.valor, t.realizado.contratos] : ['Projeção do mês', v(t.mes && t.mes.valor), v(t.mes && t.mes.contratos)],
    ['Projeção da semana' + (p.semana ? ' (' + projDataCurta(p.semana.de) + ' a ' + projDataCurta(projSomaDias(p.semana.de, 4)) + ')' : ''), v(t.semana && t.semana.valor), v(t.semana && t.semana.contratos)],
    [p.fechado ? 'Média por dia útil' : 'Projeção diária (por dia útil)', v(t.ritmo && t.ritmo.valor), v(t.ritmo && t.ritmo.contratos)],
    ['Realizado ponderado até ontem', t.realizado.valor, t.realizado.contratos],
    ['Hoje (parcial)', t.hoje.valor, t.hoje.contratos],
    ['Dias úteis do mês', cal.total, null],
    ['Dias úteis completos', cal.completos, null],
    ['Dias úteis restantes (com hoje)', cal.restantes, null],
  ];
  if(comOp) p.porOperacao.forEach(o => resumo.push(['Projeção do mês — ' + PROJ_OPERACAO_CURTO[o.op], v(o.mes && o.mes.valor), v(o.mes && o.mes.contratos)]));
  const wsR = projExcelAba(wb, 'Resumo', titulo, sub, ['Indicador', 'R$', 'Contratos'], resumo, [null, PROJ_FMT_RS, PROJ_FMT_CTR]);
  [9, 10, 11].forEach(n => { wsR.getRow(n).getCell(2).numFmt = '0'; });
  wsR.getRow(4).eachCell(c => { c.font = { bold: true }; });

  const wsD = projExcelAba(wb, 'Dia a dia', titulo, sub, ['Data', 'Dia da semana', 'Situação', 'R$', 'Contratos'],
    p.dias.map(d => [projExcelData(d.data), WEEKDAY_NAMES[projDiaSemana(d.data)], PROJ_DIA_ROTULO[d.tipo], d.valor, d.contratos]),
    ['dd/mm/yyyy', null, null, PROJ_FMT_RS, PROJ_FMT_CTR]);
  p.dias.forEach((d, i) => { if(d.tipo === 'projetado') projExcelItalico(wsD, 4 + i); });

  const mesLinha = p.fechado ? t.realizado : t.mes;
  const semanas = p.semanas.map(s => [projDataCurta(s.de) + ' a ' + projDataCurta(s.ate), s.diasUteis, PROJ_SEMANA_ROTULO[s.tipo], s.valor, s.contratos]);
  semanas.push(['Mês', cal.total, p.fechado ? 'realizado' : 'projeção', v(mesLinha && mesLinha.valor), v(mesLinha && mesLinha.contratos)]);
  const wsS = projExcelAba(wb, 'Semana a semana', titulo, sub, ['Semana', 'Dias úteis', 'Situação', 'R$', 'Contratos'], semanas, [null, '0', null, PROJ_FMT_RS, PROJ_FMT_CTR]);
  p.semanas.forEach((s, i) => { if(s.tipo === 'futura') projExcelItalico(wsS, 4 + i); });
  wsS.getRow(4 + p.semanas.length).eachCell(c => { c.font = { bold: true }; });

  projExcelAba(wb, 'Por consultor', titulo, sub,
    ['Consultor'].concat(comOp ? ['Operação'] : [], ['Contratos', 'Realizado', 'Ritmo / dia útil', 'Projeção mês', 'Contratos proj.']),
    p.consultores.map(c => [c.usuario].concat(comOp ? [PROJ_OPERACAO_CURTO[c.operacao]] : [], [c.contratos, c.valor, v(c.ritmo), v(c.projMes), v(c.projContratos)])),
    [null].concat(comOp ? [null] : [], [PROJ_FMT_CTR, PROJ_FMT_RS, PROJ_FMT_RS, PROJ_FMT_RS, PROJ_FMT_CTR]));

  projExcelAba(wb, 'Por tipo de venda', titulo, sub, ['Tipo', 'Grupo no NeoCRM', 'Pedidos', 'Realizado', '%', 'Projeção mês'],
    p.tipos.map(x => [x.label, x.grupo, x.pedidos, x.valor, x.pct, v(x.projMes)]), [null, null, '0', PROJ_FMT_RS, PROJ_FMT_PCT, PROJ_FMT_RS]);

  const wsE = projExcelAba(wb, 'Por etapa', titulo, sub, ['Etapa', 'Contratos', 'Bruto', 'Peso', 'Ponderado', '%'],
    p.etapas.map(e => [e.label, e.contratos, e.bruto, e.peso, e.valor, e.pct]), [null, '0', PROJ_FMT_RS, '0%', PROJ_FMT_RS, PROJ_FMT_PCT]);
  p.etapas.forEach((e, i) => projPintarPeso(wsE.getRow(4 + i).getCell(4), e.peso));

  const pedidos = projPedidosExcel(p);
  const wsP = projExcelAba(wb, 'Pedidos', titulo, sub,
    ['Nº Pedido', 'Operação', 'Consultor', 'Tipo(s)', 'Etapa(s)', 'Cadastro', 'Situação', 'Valor bruto', 'Peso', 'Valor ponderado', 'Cliente', 'CNPJ/CPF'],
    pedidos.map(x => [x.numero, PROJ_OPERACAO_CURTO[x.op], x.usuario, [...x.tipos].join(' + '), [...x.etapas].join(' + '), projExcelData(x.dia),
      x.dia === p.hoje ? 'hoje (parcial)' : 'realizado', x.bruto, x.peso, x.valor, x.cliente, x.cnpj]),
    ['@', null, null, null, null, 'dd/mm/yyyy', null, PROJ_FMT_RS, '0%', PROJ_FMT_RS, null, '@']);
  pedidos.forEach((x, i) => projPintarPeso(wsP.getRow(4 + i).getCell(9), x.peso));
  return wb;
}

async function exportarProjecaoExcel(){
  const p = PROJ_ATUAL;
  const btn = document.getElementById('projExportBtn');
  const msg = document.getElementById('projMsg');
  if(!p || !btn) return;
  btn.disabled = true;
  try{
    const ExcelJS = await carregarExcelJS();
    const upd = document.querySelector('.topbar .updated');
    const atualizadoEm = upd ? upd.textContent.replace(/^Atualizado em:\s*/, '') : '';
    const wb = gerarExcelProjecao(ExcelJS, p, { atualizadoEm });
    const buffer = await wb.xlsx.writeBuffer();
    baixarArquivo(buffer, 'ProjecaoGanho_' + PROJ_OPERACAO_CURTO[p.operacao].replace(/[^A-Za-z]/g, '') + '_' + p.mes + '.xlsx');
  }catch(err){
    console.error('Erro ao gerar o Excel da Projeção de Ganho:', err);
    if(msg) msg.textContent = 'Não foi possível gerar o Excel agora — tente de novo.';
  }finally{
    btn.disabled = false;
  }
}
```

Run: `python dashboard_tpl.py empacotar`

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `0 falharam`, exit 0.

Run: `NODE_PATH=../../crm/node_modules node test_pedidos_alerta.js`
Expected: as mesmas 2 falhas antigas (`resumo TOTAL` e `resumo do Excel filtrado soma 2`) e nenhuma outra.

- [ ] **Step 5: Commit**

```bash
python build_painel.py
git add test_projecao_ganho.js _template.html painel_clientes_apex.html
git commit -F - <<'EOF'
feat(projecao): Excel da Projeção de Ganho com 7 abas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: "Apex + Campinas" no painel de fora

**Files:**
- Modify: `_template.html` (HTML dos dois seletores; funções da seção OPERAÇÃO CAMPINAS; `loadProducaoDashboard`; `loadFechamento`)
- Modify: `build_painel.py` (`RUNTIME_PLACEHOLDERS`)
- Test: `test_operacao_campinas.js` (atualizar) e `test_projecao_ganho.js` (seção nova)

**Interfaces:**
- Consumes: `OPERACOES`, `operacaoDoVendedor`, `foraDoDashboard`, `podeTrocarOperacao`, `minhaOperacao` (existentes).
- Produces: `OPERACAO_TODAS = 'todas'`, `operacaoDoSeletorValida(op) → bool`, `daOperacao(nome, op) → bool`; `filtrarDashboardPedidos` passa a devolver os pedidos com `r.operacao` preenchido; `loadProducaoDashboard` troca `__OPERACAO__` por `JSON.stringify(operacaoAtiva())`.

- [ ] **Step 1: Escrever os testes**

Em `test_projecao_ganho.js`, antes de `// ---------------- fim ----------------`:

```js
// ---------------- Task 6: painel de fora ----------------
secao('Task 6', () => {
  const iOp = outerHtml.indexOf("tpl = tpl.replace('__OPERACAO__', () => JSON.stringify(operacaoAtiva()));");
  const iData = outerHtml.indexOf("tpl = tpl.replace('__DATA__'");
  assert(iOp > 0 && iData > iOp, 'loadProducaoDashboard preenche a operação antes dos pedidos');
  assert(/"__OPERACAO__"/.test(fs.readFileSync('build_painel.py', 'utf8')), 'build_painel.py aceita o placeholder da operação');
  assert(/filter\(r => daOperacao\(r\.usuario, op\)\)/.test(outerHtml), 'Fechamento usa daOperacao (aceita "todas")');
  assert(/if\(operacaoAtiva\(\) !== 'apex' && frame\)/.test(outerHtml), 'Boletim volta o Dashboard para a Apex também a partir de "Apex + Campinas"');
  assert((outerHtml.match(/data-operacao="todas">Apex \+ Campinas</g) || []).length === 2, 'botão "Apex + Campinas" nos dois seletores');
});
```

Em `test_operacao_campinas.js`, trocar

```js
  assert(selDash && selDash.querySelectorAll('button[data-operacao]').length === 2, 'duas opções');
```

por

```js
  assert(selDash && selDash.querySelectorAll('button[data-operacao]').length === 3, 'três opções (Apex, Campinas e Apex + Campinas)');
```

e, logo depois da linha `  assert(chamadas.length === 0, 'clicar na operação que já está não recarrega');`, acrescentar (o arquivo monta o teste dentro de um template literal: não usar crase nem `${}` aqui):

```js
  // seção 101: "Apex + Campinas" (só admin) — as duas operações juntas no Dashboard e no Fechamento
  assert(/Apex \+ Campinas/.test(selDash.textContent) && !!selFech.querySelector('button[data-operacao="todas"]'), 'botão "Apex + Campinas" no Dashboard e no Fechamento');
  chamadas = [];
  selDash.querySelector('button[data-operacao="todas"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert(operacaoSelecionada === 'todas' && operacaoAtiva() === 'todas', 'admin escolhe Apex + Campinas');
  assert(chamadas.indexOf('dash:todas') >= 0 && chamadas.indexOf('fech:todas') >= 0, 'recarrega Dashboard e Fechamento com as duas — chamadas: ' + chamadas.join(','));
  assert(selFech.querySelector('button[data-operacao="todas"]').classList.contains('active'), 'o seletor do Fechamento acompanha (todas)');
  const doisLados = filtrarDashboardPedidos(PEDIDOS.map(p => Object.assign({}, p)));
  assert(ids(doisLados) === '1,2,3,4,5,6', 'Apex + Campinas: as duas operações, sem quem está fora — achou ' + ids(doisLados));
  assert(doisLados.find(p => p.numero_pedido === '3').operacao === 'campinas' && doisLados.find(p => p.numero_pedido === '2').operacao === 'apex', 'cada pedido sai marcado com a operação do vendedor');
  assert(filtrarDashboardPedidos([{ numero_pedido: '9', usuario: 'Caio Costa Santana' }], 'apex')[0].operacao === 'apex', 'marca também com operação explícita');
  assert(filtrarDashboardEquipe(EQUIPE).length === 3, 'equipe ("quem zerou") das duas operações');
  assert(filtrarDashboardPerdidas(PERD).length === 2, 'vendas perdidas das duas operações');
  assert(daOperacao('JUAN DE MELO FERNANDES', 'todas') && !daOperacao('JUAN DE MELO FERNANDES', 'apex') && daOperacao('JUAN DE MELO FERNANDES', 'campinas'), 'daOperacao');
  assert(bmFora('JUAN DE MELO FERNANDES'), 'boletim continua só Apex com "Apex + Campinas"');
  currentUser = { id: 's1', role: 'supervisor', operacao: 'campinas' };
  assert(operacaoAtiva() === 'campinas', 'supervisor ignora "todas" (fica na própria operação)');
  currentUser = { id: 'a1', role: 'admin', operacao: 'apex' };
  definirVendedoresOperacao([
    { nome: 'CAIO COSTA SANTANA', operacao: 'apex' },
    { nome: 'VITORIA PRISCILA DA SILVA SANTOS', operacao: 'campinas' },
    { nome: 'BEATRIZ CRISTINA GERMANIA SILVA', operacao: 'campinas' },
    { nome: 'RANNIELE DA SILVA VIEIRA COTRIM', operacao: 'campinas' },
    { nome: 'JUAN DE MELO FERNANDES', operacao: 'campinas' },
    { nome: 'FULANO TODAS', operacao: 'todas' },
  ]);
  assert(operacaoDoVendedor('FULANO TODAS') === 'apex', '"todas" nunca é operação de vendedor');
  operacaoSelecionada = 'apex';
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=../../crm/node_modules node test_operacao_campinas.js; NODE_PATH=../../crm/node_modules node test_projecao_ganho.js`
Expected: `FALHOU: três opções …` (e o resto do bloco novo) no primeiro; `FALHOU: loadProducaoDashboard preenche a operação antes dos pedidos` etc. no segundo; ambos exit 1.

- [ ] **Step 3: HTML dos seletores** — em `_template.html`, a linha

```html
        <button type="button" class="filterPill" data-operacao="campinas">Operação Campinas</button>
```

aparece duas vezes (Dashboard e Fechamento). Nas duas (Edit com `replace_all`), trocar por:

```html
        <button type="button" class="filterPill" data-operacao="campinas">Operação Campinas</button>
        <button type="button" class="filterPill" data-operacao="todas">Apex + Campinas</button>
```

- [ ] **Step 4: Funções de operação** — trocar

```js
const OPERACOES = { apex: 'Operação Apex', campinas: 'Operação Campinas' };
```

por

```js
const OPERACOES = { apex: 'Operação Apex', campinas: 'Operação Campinas' };
// seção 101: "Apex + Campinas" — 3º botão do seletor, só para admin (Dashboard e Fechamento). Nunca é operação de perfil
// nem de vendedor (OPERACOES continua só com as duas de verdade).
const OPERACAO_TODAS = 'todas';
function operacaoDoSeletorValida(op){ return !!OPERACOES[op] || op === OPERACAO_TODAS; }
function daOperacao(nome, op){ return op === OPERACAO_TODAS || operacaoDoVendedor(nome) === op; }
```

trocar

```js
function operacaoAtiva(){ return podeTrocarOperacao() && OPERACOES[operacaoSelecionada] ? operacaoSelecionada : minhaOperacao(); }
```

por

```js
function operacaoAtiva(){ return podeTrocarOperacao() && operacaoDoSeletorValida(operacaoSelecionada) ? operacaoSelecionada : minhaOperacao(); }
```

trocar as três linhas

```js
function filtrarDashboardPedidos(rows, op){ const o = op || operacaoAtiva(); return (rows || []).filter(r => !foraDoDashboard(r.usuario) && operacaoDoVendedor(r.usuario) === o); }
function filtrarDashboardEquipe(nomes, op){ const o = op || operacaoAtiva(); return (nomes || []).filter(n => !foraDoDashboard(n) && operacaoDoVendedor(n) === o); }
```

e

```js
function filtrarDashboardPerdidas(linhas, op){ const o = op || operacaoAtiva(); return Array.isArray(linhas) ? linhas.filter(x => operacaoDoVendedor(x && x.usuario) === o) : linhas; }
```

por

```js
// seção 101: cada pedido vai para o Dashboard marcado com a operação do vendedor (a Projeção de Ganho separa e soma por operação)
function filtrarDashboardPedidos(rows, op){
  const o = op || operacaoAtiva();
  const out = (rows || []).filter(r => !foraDoDashboard(r.usuario) && daOperacao(r.usuario, o));
  out.forEach(r => { r.operacao = operacaoDoVendedor(r.usuario); });
  return out;
}
function filtrarDashboardEquipe(nomes, op){ const o = op || operacaoAtiva(); return (nomes || []).filter(n => !foraDoDashboard(n) && daOperacao(n, o)); }
```

e

```js
function filtrarDashboardPerdidas(linhas, op){ const o = op || operacaoAtiva(); return Array.isArray(linhas) ? linhas.filter(x => daOperacao(x && x.usuario, o)) : linhas; }
```

(o comentário `// null = erro na busca …` entre elas fica como está). Em `trocarOperacao`, trocar

```js
  if(!podeTrocarOperacao() || !OPERACOES[op] || op === operacaoSelecionada) return;
```

por

```js
  if(!podeTrocarOperacao() || !operacaoDoSeletorValida(op) || op === operacaoSelecionada) return;
```

- [ ] **Step 5: Fechamento e Dashboard** — em `loadFechamento`, trocar

```js
  // seção 78: só a operação escolhida no seletor (Apex ou Campinas); Rafael e Isabelly continuam (comissão)
  const op = operacaoAtiva();
  fechamentoRegistrosCache = filtrarProducaoPedidos(data).filter(r => operacaoDoVendedor(r.usuario) === op);
```

por

```js
  // seção 78: só a operação escolhida no seletor (Apex, Campinas ou as duas — seção 101); Rafael e Isabelly continuam (comissão)
  const op = operacaoAtiva();
  fechamentoRegistrosCache = filtrarProducaoPedidos(data).filter(r => daOperacao(r.usuario, op));
```

Em `loadProducaoDashboard`, trocar

```js
  tpl = tpl.replace('__PERDIDAS_SYNC__', () => jsonParaScript(perdidasSync));
```

por

```js
  tpl = tpl.replace('__OPERACAO__', () => JSON.stringify(operacaoAtiva())); // seção 101: Projeção de Ganho (apex | campinas | todas)
  tpl = tpl.replace('__PERDIDAS_SYNC__', () => jsonParaScript(perdidasSync));
```

- [ ] **Step 6: `build_painel.py`** — trocar

```python
                            "__PERDIDAS__", "__PERDIDAS_SYNC__"}  # Vendas Perdidas no Dashboard: 05/10/2026, seção 70
```

por

```python
                            "__PERDIDAS__", "__PERDIDAS_SYNC__",  # Vendas Perdidas no Dashboard: 05/10/2026, seção 70
                            "__OPERACAO__"}  # Projeção de Ganho: operação escolhida (apex | campinas | todas), 19/10/2026, seção 101
```

- [ ] **Step 7: Rodar e ver passar**

Run: `python build_painel.py && NODE_PATH=../../crm/node_modules node test_operacao_campinas.js && NODE_PATH=../../crm/node_modules node test_projecao_ganho.js && NODE_PATH=../../crm/node_modules node test_producao_filtro_pessoas.js`
Expected: build `OK — painel_clientes_apex.html gerado (…), sem placeholders pendentes.`; os três testes com `0 falharam`.

- [ ] **Step 8: Commit**

```bash
git add _template.html build_painel.py painel_clientes_apex.html test_operacao_campinas.js test_projecao_ganho.js
git commit -F - <<'EOF'
feat(operacao): botão Apex + Campinas no seletor do admin e operação de cada pedido no Dashboard

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Suíte completa, conferência com dados reais e regras de negócio

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova §101 no fim), `docs/superpowers/specs/2026-10-19-projecao-ganho-design.md` (§3.4, semana)
- Scratchpad (fora do git): `conferencia_projecao.js`, `conferencia_dados.json`

**Interfaces:**
- Consumes: tudo das Tasks 1–6.
- Produces: documentação e evidência de conferência; nenhum código novo no painel.

- [ ] **Step 1: Suíte completa**

Run: `npm install --no-save --no-audit --no-fund docx && git checkout -- package-lock.json; NODE_PATH=../../crm/node_modules bash run_tests.sh`
Expected: `Falharam: test_pedidos_alerta.js(exit 1) test_redesign_shell.js(exit 1)` (as duas antigas, com as mesmas mensagens da linha de base) e `test_projecao_ganho.js` entre os aprovados. Conferir nos logs (`$TMPDIR/apex_tests/test_pedidos_alerta.js.log` e `test_redesign_shell.js.log`) que as falhas são exatamente as antigas. Qualquer outra falha: parar e corrigir antes de seguir.

- [ ] **Step 2: Conferência com dados reais (somente leitura)**

Com a ferramenta de SQL do Supabase (projeto `mdgfboijyqfkggcrhptn`), rodar (CNPJ vai como hash — só serve para achar convergência; a lista de excluídos é a de `PRODUCAO_USUARIOS_EXCLUIDOS` + `PRODUCAO_FORA_DO_DASHBOARD` do `_template.html` — conferir antes):

```sql
with vo as (select upper(trim(nome)) as nome, operacao from vendedores_operacao())
select p.numero_pedido, p.grupo, p.usuario, p.etapa, p.cadastro, p.valor, md5(p.cnpj) as cnpj,
       coalesce(vo.operacao, 'apex') as operacao
from producao_pedidos p
left join vo on vo.nome = upper(trim(p.usuario))
where p.cadastro >= '2026-10-01T00:00:00-03:00'
  and upper(trim(p.usuario)) not in ('VITOR QUEIROZ CAVALCANTE','DANILO MORAIS ARAUJO','GABRIEL MACEDO MARTINS',
                                     'RAFAEL SANTIAGO ANGELÃO','ISABELLY FONSECA BATISTA DA SILVA');
```

Salvar o resultado (array JSON) em `<scratchpad>/conferencia_dados.json` e criar `<scratchpad>/conferencia_projecao.js`:

```js
// Conferência (fora do git): roda o dashboard de verdade com os pedidos reais de outubro e imprime a projeção.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const RAIZ = process.argv[2]; // raiz do worktree
const dados = JSON.parse(fs.readFileSync(path.join(__dirname, 'conferencia_dados.json'), 'utf8'));
const outer = fs.readFileSync(path.join(RAIZ, '_template.html'), 'utf8');
const tpl = Buffer.from(outer.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/)[1], 'base64').toString('utf8');
const js = tpl.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]
  .replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(dados) + ';')
  .replace('__ADMIN_MODE__', 'true').replace('__OPERACAO__', '"todas"');
const w = new JSDOM(tpl.replace(/<script>[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', url: 'http://localhost/' }).window;
w.eval(js);
const p = w.montarProjecao(dados, { mes: '2026-10', hoje: w.projHoje(), operacao: 'todas' });
const r = x => x == null ? null : Math.round(x * 100) / 100;
p.porOperacao.concat([{ op: 'TOTAL', dias: p.calendario, realizado: p.total.realizado, hoje: p.total.hoje, ritmo: p.total.ritmo, mes: p.total.mes, semana: p.total.semana }])
  .forEach(o => console.log(o.op, 'dias', o.dias.completos + '/' + o.dias.total, 'realizado', r(o.realizado.valor), r(o.realizado.contratos),
    'hoje', r(o.hoje.valor), 'ritmo', r(o.ritmo && o.ritmo.valor), 'semana', r(o.semana && o.semana.valor), 'mês', r(o.mes && o.mes.valor), r(o.mes && o.mes.contratos)));
```

Run (da raiz do worktree): `NODE_PATH=$PWD/node_modules:$PWD/../../crm/node_modules node <scratchpad>/conferencia_projecao.js "$PWD"`

E a conta de controle, direto no banco (mesma janela, até ontem em São Paulo):

```sql
with vo as (select upper(trim(nome)) as nome, operacao from vendedores_operacao()),
l as (
  select coalesce(vo.operacao, 'apex') as op, (p.cadastro at time zone 'America/Sao_Paulo')::date as dia, p.valor,
         case when p.etapa in ('CONCLUIDO (NEOCRM)','ENTREGA (NEOCRM)','VALIDAÇÃO ESIM (NEOCRM)') then 1.0
              when p.etapa in ('ANTIFRAUDE (NEOCRM)','BIOMETRIA (NEOCRM)') then 0.5 else 0 end as peso
  from producao_pedidos p left join vo on vo.nome = upper(trim(p.usuario))
  where p.cadastro >= '2026-10-01T00:00:00-03:00'
    and upper(trim(p.usuario)) not in ('VITOR QUEIROZ CAVALCANTE','DANILO MORAIS ARAUJO','GABRIEL MACEDO MARTINS',
                                       'RAFAEL SANTIAGO ANGELÃO','ISABELLY FONSECA BATISTA DA SILVA')
)
select op, round(sum(valor * peso) filter (where dia < (now() at time zone 'America/Sao_Paulo')::date)::numeric, 2) as realizado_ate_ontem,
       round(sum(valor * peso) filter (where dia = (now() at time zone 'America/Sao_Paulo')::date)::numeric, 2) as hoje
from l group by op order by op;
```

Expected: `realizado` e `hoje` de cada operação iguais aos do banco (diferença ≤ R$ 0,01); dias de Campinas contando de 06/10. Anotar os números para a §101. Diferença maior: parar e investigar (systematic-debugging) antes de seguir.

- [ ] **Step 3: Ajustar a spec (semana)** — em `docs/superpowers/specs/2026-10-19-projecao-ganho-design.md`, §3.4, trocar o item

```markdown
- **Projeção semanal** = ritmo × dias úteis da semana atual (seg–sex que contém hoje; no sábado e no
  domingo, a semana seguinte). Conta a semana inteira, mesmo que passe para o outro mês.
```

por

```markdown
- **Projeção semanal** = realizado ponderado da semana até ontem + ritmo × dias úteis que faltam na semana
  (com hoje). Semana de segunda a domingo; no sábado e no domingo vale a semana seguinte (inteira projetada).
  Conta a semana inteira, mesmo que passe para o outro mês. Na segunda-feira é igual a ritmo × dias úteis da
  semana; no meio da semana bate com a linha "atual" da tabela "Semana a semana".
```

- [ ] **Step 4: Escrever a §101 no `REGRAS_NEGOCIO.md`** (no fim do arquivo, no formato da §100), cobrindo: pedido do usuário (citação literal da primeira mensagem), pesos e o "só nesta aba", ritmo/semana/mês/diária, hoje parcial, dias úteis e o calendário usado, início de Campinas (06/10/2026, constante `OPERACAO_INICIO`), "Apex + Campinas" como soma e o 3º botão (Dashboard inteiro + Fechamento; Boletim continua Apex), quem vê, quebras, Excel (nome e 7 abas), limitações (consultor que entra no meio do mês; separação só de exibição §78; feriados só nacionais), testes (`test_projecao_ganho.js`, `test_operacao_campinas.js` atualizado) e os números da conferência do Step 2. Spec e plano referenciados pelos caminhos em `docs/superpowers/`.

- [ ] **Step 5: Commit**

```bash
git add REGRAS_NEGOCIO.md docs/superpowers/specs/2026-10-19-projecao-ganho-design.md
git commit -F - <<'EOF'
docs(regras): §101 Projeção de Ganho e botão Apex + Campinas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: Publicação (SÓ com o OK explícito do usuário, pedido na hora)

**Files:** nenhum código; `REGRAS_NEGOCIO.md` (§101.1 Publicado) no fim.

- [ ] **Step 1: Pedir o OK** — mostrar ao usuário o resumo do que vai ao ar e perguntar se pode publicar e para qual remoto vai o push (`oficial` = atmizuta, `origin` = fork). Sem OK, parar aqui.

- [ ] **Step 2: Trazer o `oficial/main` mais novo** — `git fetch oficial && git log --oneline HEAD..oficial/main`. Se houver commits novos: `git merge oficial/main` (resolver conflitos no `_template.html` juntando as duas versões, nunca descartando a outra), `python build_painel.py`, e repetir a Task 7 Step 1.

- [ ] **Step 3: Conferir o que está no ar (§45)**

```bash
ssh hostinger 'md5sum domains/apexsmart.com.br/public_html/painel_clientes_apex.html'
git show oficial/main:painel_clientes_apex.html | md5sum
```

Expected: os dois MD5 iguais. Se forem diferentes, alguém publicou por fora: baixar (`scp hostinger:domains/apexsmart.com.br/public_html/painel_clientes_apex.html <scratchpad>/no_ar.html`), comparar com `git show oficial/main:painel_clientes_apex.html`, juntar o que faltar no `_template.html` e voltar ao Step 2. Nunca sobrescrever.

- [ ] **Step 4: Backup e envio**

```bash
python build_painel.py && md5sum painel_clientes_apex.html
ssh hostinger 'cp domains/apexsmart.com.br/public_html/painel_clientes_apex.html ~/deploy_backups/painel_clientes_apex_$(date +%Y%m%d_%H%M%S)_antes_projecao_ganho.html'
scp painel_clientes_apex.html hostinger:domains/apexsmart.com.br/public_html/painel_clientes_apex.html.novo
ssh hostinger 'md5sum domains/apexsmart.com.br/public_html/painel_clientes_apex.html.novo'
```

Só se o MD5 do `.novo` for igual ao local:

```bash
ssh hostinger 'mv domains/apexsmart.com.br/public_html/painel_clientes_apex.html.novo domains/apexsmart.com.br/public_html/painel_clientes_apex.html'
curl -s https://apexsmart.com.br/painel_clientes_apex.html | md5sum
```

Expected: MD5 do site = MD5 local. Abrir o painel no navegador: a tela de login carrega sem erro no console.

- [ ] **Step 5: Registrar e enviar** — acrescentar `### 101.1 Publicado (data, hora)` no `REGRAS_NEGOCIO.md` (MD5 de antes, MD5 publicado, backup, como reverter: copiar o backup de volta para `domains/apexsmart.com.br/public_html/painel_clientes_apex.html`); commit `docs(regras): §101.1 publicação da Projeção de Ganho` (com a linha Co-Authored-By); `git push <remoto escolhido> feat/projecao-ganho:main` (ou o fluxo de merge que o usuário indicar).
