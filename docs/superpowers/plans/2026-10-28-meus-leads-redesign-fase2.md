# Meus leads, redesign Fase 2 (Quadro e Lista): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aplicar ao Quadro e à aba Todos (que vira "Lista") o visual claro aprovado pelo Rafael em 28/10.
- **Quadro:**
  - cartão novo em 3 níveis, com ícone de urgência no canto e faixa vermelha só no que precisa de ação agora;
  - Convertido e Perdido recolhidos;
  - filtros em botões compactos e escolha de densidade.
- **Lista:** visões prontas e uma tabela limpa.

**Architecture:**
- Tudo fica no `_template.html`, nas funções `kb*` de Meus leads.
- **Funções puras novas**, testadas sozinhas: urgência do cartão, faixa vermelha, etiqueta de retorno, visões da Lista, iniciais e cor da idade do livre.
- **Reescritas:** `kbCard`, o cabeçalho das colunas (`kbGarantirColunas`), `kbFiltroBarraHtml`, `kbCelulaTabela` e `kbRenderTodos`.
- **Sem mudança no banco.**
- **Continuam iguais:**
  - o desempenho da §120: redesenho só da coluna que mudou, `content-visibility` e "Ver mais";
  - a ordem e o botão da §125;
  - o arrastar;
  - a ficha da Fase 1.

**Tech Stack:** HTML, CSS e JS sem framework, no `_template.html`. O build é `python build_painel.py`. Os testes são `node test_*.js` com jsdom, rodados por `bash run_tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md`, seções 2, 4 (4.1, 4.2 e 4.3), 6, 7 e 8. A Fase 1 já está no ar (§126.1, oficial 8d9b7c8).

**Mockups (referência visual, fora do repositório):**
- `.superpowers/brainstorm/395-1793217071/content/02-quadro.html` e `03-lista.html`;
- `ml.css`.

## Global Constraints

- **Ponto de partida:** o worktree `.worktrees/meus-leads-redesign` (branch `feat/meus-leads-redesign`).
  - Antes da Task 1: `git fetch oficial && git merge --ff-only oficial/main`.
  - Se não der fast-forward, parar e avisar.
- **Arquivos:** só se edita o `_template.html`. O `painel_clientes_apex.html` é gerado; não editar nem commitar. Manter LF.
  - Gravar arquivos com a ferramenta de escrita ou com Python `newline=''`, porque redirecionar a saída no Windows gera CRLF.
- **Shell e Fase 1 não mudam:**
  - o shell: menu lateral, `#pageHead`, `ApexMotion`, `mostrarAviso`, `fecharOverlay` e o bloco "SISTEMA VISUAL SINAL DE ÁPICE";
  - a ficha da Fase 1: `kbFichaHtml`, `kbClassificarHtml`, Hoje B e `kbPodeDescartar`.
- **Cores:**
  - só por `var(--…)`, usando os tokens `--ml-*` da Fase 1;
  - **nenhum hex novo**, nem sequer nas linhas `[data-st=…]` da §121, que continuam iguais;
  - o ponto do STATUS (`.kbStP`) usa `var(--kb-st-bg)` com anel `var(--kb-st-fg)`;
  - o único verde é `--st-ganho` / `--ml-ok`.
- **Cantos:** `var(--radius-lg)` (8 px) ou 6 px nos botões internos. Nada de 10, 12 ou 14 px (o `test_redesign_shell` proíbe).
- **Texto:** rótulos em frase normal, sem caixa alta pequena; números com `font-variant-numeric:tabular-nums`.
- **Escape e avisos:** todo texto do banco passa por `escapeHtml`; avisos só por `mostrarAviso`.
- **Testes com dados fictícios:** nomes "Zz…", telefones `119000000xx`, CNPJ `000000000001xx`.
- **Commits** terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Push e publicação só com o ok do Rafael na hora (Task 6).
- **Fora da Fase 2:** a Equipe, o Redistribuir, a função nova do banco (Fase 3) e as pendências pequenas da Fase 1, que estão no ledger.

## Review Focus

1. **Cartão com nome muito longo, OBS de várias linhas, STATUS antigo ou campos vazios.** O cartão corta o texto (2 linhas), não mostra "undefined"/"null" e escapa HTML. → testes "RF1" e "RF2" da Task 2.
2. **localStorage bloqueado** (modo anônimo ou política da empresa). As colunas recolhidas e a densidade voltam ao padrão sem quebrar. → teste "RF3" da Task 1.
3. **Filtro ativo com coluna recolhida.** A faixa recolhida mostra a contagem já filtrada, e abrir a coluna mostra só os filtrados. → teste "RF4" da Task 3.
4. **Clicar em Ligar ou WhatsApp numa linha da Lista** não abre a ficha. → teste "RF5" da Task 5.
5. **Arrastar um cartão para Convertido ou Perdido recolhido.** A coluna recolhida aceita o soltar e abre a ficha com o grupo em destaque. → teste "RF6" da Task 3.

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `_template.html`, CSS de Meus leads | cartão novo, colunas novas (cabeçalho, faixa recolhida, Livres em tom, "Solte aqui"), filtros em botões, densidade, Lista; sai o CSS da barra de atalhos (`.kbNavQuadro`, `.kbNavCol`, `.kbSeta`) e do cartão antigo |
| `_template.html`, markup | sai o `#kbNavQuadro`; `#kbFiltroBarra` sem a classe `card`; `#kbTodos` com as visões; a sub-aba "Todos" passa a se chamar "Lista" |
| `_template.html`, JS | funções puras novas; `kbCard`, `kbGarantirColunas`, `kbListaHtml`, `kbRender`, `kbFiltroBarraHtml`, `kbCelulaTabela` e `kbRenderTodos` reescritas; saem `kbIrColuna`, `kbRolarColunas` e `kbEstado.perdidoAberto` |
| `test_meus_leads_fase2.js` (novo) | os testes da Fase 2 |
| `test_leads_kanban.js`, `test_leads_hoje.js`, `test_leads_painel_hoje.js` | ajustes onde a marcação mudou de propósito |
| `REGRAS_NEGOCIO.md` | §126.2, só depois de publicar |

---

### Task 1: Funções puras do Quadro e da Lista

**Files:**
- Create: `test_meus_leads_fase2.js`
- Modify: `_template.html`. Inserir o bloco logo **depois** da função `kbUrgenciaFicha` (que termina antes de `// ===== §126.1` ou da próxima função; procurar `function kbUrgenciaFicha(` e inserir depois do `}` que fecha essa função).

**Interfaces:**
- Consumes (já existem): `kbMs`, `kbDiaSP`, `kbSomaDias`, `kbColunaDoLead`, `kbAbertoCol`, `kbAtrasado`, `kbTempoDesde` e `kbEstado`.
- Produces:
  - `kbIniciais(nome) → string`;
  - `kbRetornoFaixa(l, agoraMs) → 'late'|'hoje'|'fut'|null`;
  - `kbUrgenciaCartao(l, agoraMs) → 'late'|'hoje'|'fut'|'nada'|null`;
  - `kbFaixaVermelha(l, agoraMs) → boolean`;
  - `kbRetornoTag(l, agoraMs) → {classe, texto}|null`;
  - `kbCorIdadeLivre(l, agoraMs) → 'novo'|''|'soon'|'late'`;
  - `KB_VISOES`, `kbNaVisao(l, visao) → boolean` e `kbContarVisoes(leads) → {visao: n}`;
  - `KB_COL_RECOLHIVEIS`, `kbLerColAbertas() → obj`, `kbSalvarColAbertas()` e `kbColAberta(col) → boolean` (lê `kbEstado.colAbertas`);
  - `kbLerDensidade() → 'conforto'|'compacto'` e `kbSalvarDensidade()`.

- [ ] **Step 1: Criar o arquivo de teste**

Criar `test_meus_leads_fase2.js`:

```js
// Testa o §126.2 (redesign de Meus leads, Fase 2: Quadro e Lista).
// Spec: docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md. DADOS FICTÍCIOS (repo público).
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
window.__tabelas = {};
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.__alertas = [];
window.alert = (m) => window.__alertas.push(String(m));
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
  const SP = (s) => Date.parse(s + '-03:00');
  // ==== Task 1: funções puras ====
  const ag = SP('2026-10-28T15:00:00');
  const LA = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, criado_em_lead: '2026-10-20T10:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  eq([kbIniciais('Zzkcon Teste'), kbIniciais('caio'), kbIniciais('  zz  meio  fim '), kbIniciais(null)], ['ZT', 'C', 'ZF', ''], 'iniciais do dono');
  eq([kbRetornoFaixa(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoFaixa(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoFaixa(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoFaixa(LA('d'), ag)],
     ['late', 'hoje', 'fut', null], 'faixa do retorno pela data');
  eq([kbUrgenciaCartao(LA('a', { retorno_em: '2026-10-27' }), ag), kbUrgenciaCartao(LA('d'), ag), kbUrgenciaCartao(LA('c', { categoria: 'convertido' }), ag), kbUrgenciaCartao(LA('l', { livre: true, categoria: 'sem_contato' }), ag)],
     ['late', 'nada', null, null], 'ícone de urgência só em lead em aberto');
  eq([kbFaixaVermelha(LA('a', { retorno_em: '2026-10-27' }), ag),
      kbFaixaVermelha(LA('s1', { ligacoes: 0, pego_em: '2026-10-26T10:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('s2', { ligacoes: 0, pego_em: '2026-10-28T13:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('n', { categoria: 'sem_contato', status: null, ligacoes: undefined, criado_em_lead: '2026-10-28T14:40:00-03:00' }), ag),
      kbFaixaVermelha(LA('d'), ag),
      kbFaixaVermelha(LA('p', { categoria: 'perdido', status: 'CNPJ INAPTO', retorno_em: '2026-10-27' }), ag)],
     [true, true, false, true, false, false], 'faixa vermelha: retorno vencido, Sem ligação há mais de 1 dia, novo sem contato há 15+ min; nunca em perdido');
  eq([kbRetornoTag(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoTag(LA('a', { retorno_em: '2026-10-25' }), ag), kbRetornoTag(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoTag(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoTag(LA('d'), ag)],
     [{ classe: 'late', texto: 'retorno ontem · atrasado' }, { classe: 'late', texto: 'retorno 25/10 · atrasado' }, { classe: 'ok', texto: 'retorno hoje' }, { classe: '', texto: 'retorno 30/10' }, null], 'etiqueta do retorno');
  const lv = (min) => ({ livre: true, criado_em_lead: new Date(ag - min * 60000).toISOString() });
  eq([kbCorIdadeLivre(lv(3), ag), kbCorIdadeLivre(lv(10), ag), kbCorIdadeLivre(lv(20), ag), kbCorIdadeLivre(lv(40), ag), kbCorIdadeLivre({ livre: true }, ag)], ['novo', '', 'soon', 'late', ''], 'cor da idade do livre');
  const LV = [LA('a1', { retorno_em: '2026-10-29' }), LA('a2'), LA('s1', { ligacoes: 0 }), LA('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined }),
    LA('r1', { categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE' }), LA('c1', { categoria: 'convertido' }), LA('p1', { categoria: 'perdido', status: 'CNPJ INAPTO' })];
  eq(kbContarVisoes(LV), { todos: 7, aberto: 4, retornos: 1, semlig: 1, semresp: 1, convertido: 1, perdido: 1 }, 'contagem das visões da Lista');
  eq(LV.filter(l => kbNaVisao(l, 'aberto')).map(l => l.lead_id), ['a1', 'a2', 's1', 'n1'], 'Em aberto = Meus novos, Sem ligação e Em andamento');
  eq(KB_VISOES.map(v => v[1]), ['Todos', 'Em aberto', 'Retornos', 'Sem ligação', 'Sem resposta', 'Convertidos', 'Perdidos'], 'nomes das visões');
  kbEstado.colAbertas = {};
  eq([kbColAberta('convertido'), kbColAberta('perdido'), kbColAberta('andamento')], [false, false, true], 'Convertido e Perdido começam recolhidos');
  kbEstado.colAbertas = { perdido: true }; kbSalvarColAbertas();
  eq([kbColAberta('perdido'), kbLerColAbertas()], [true, { perdido: true }], 'abrir o Perdido fica guardado');
  window.localStorage.setItem('kbDensidade', 'compacto');
  eq(kbLerDensidade(), 'compacto', 'densidade guardada');
  const lsReal = window.localStorage;
  Object.defineProperty(window, 'localStorage', { get(){ throw new Error('bloqueado'); }, configurable: true });
  eq([kbLerDensidade(), kbLerColAbertas()], ['conforto', {}], 'RF3: localStorage bloqueado volta ao padrão');
  kbSalvarDensidade(); kbSalvarColAbertas();
  Object.defineProperty(window, 'localStorage', { value: lsReal, configurable: true, writable: true });
  window.localStorage.removeItem('kbDensidade'); window.localStorage.removeItem('kbColAbertas'); kbEstado.colAbertas = {};
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

Run: `node test_meus_leads_fase2.js 2>&1 | head -3`
Expected: `FALHA: ReferenceError: kbIniciais is not defined`

- [ ] **Step 3: Implementar**

Inserir em `_template.html`, logo depois do `}` que fecha `function kbUrgenciaFicha(`:

```js
// ===== §126.2 (Fase 2): Quadro e Lista — funções puras =====
// Iniciais do dono no cartão do gestor ("Zzkcon Teste" → "ZT").
function kbIniciais(nome){ const p = String(nome || '').trim().split(/\s+/).filter(Boolean); return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }
// Retorno pela data da planilha (retorno_em): atrasado, hoje ou marcado para frente.
function kbRetornoFaixa(l, agoraMs){
  if(!l || !l.retorno_em) return null;
  const r = String(l.retorno_em).slice(0, 10), hoje = kbDiaSP(agoraMs);
  return r < hoje ? 'late' : r === hoje ? 'hoje' : 'fut';
}
// Ícone do canto do cartão (só lead em aberto): late = retorno atrasado, hoje = retorno hoje, fut = marcado, nada = nada agendado.
function kbUrgenciaCartao(l, agoraMs){
  if(!l || l.livre || !kbAbertoCol(kbColunaDoLead(l))) return null;
  return kbRetornoFaixa(l, agoraMs) || 'nada';
}
// Faixa vermelha = precisa de ação agora: retorno vencido, novo sem contato há 15+ min, Sem ligação pego há mais de 1 dia.
function kbFaixaVermelha(l, agoraMs){
  if(!l || l.livre) return false;
  const col = kbColunaDoLead(l);
  if(!kbAbertoCol(col)) return false;
  if(kbRetornoFaixa(l, agoraMs) === 'late' || kbAtrasado(l, agoraMs)) return true;
  const pego = kbMs(l.pego_em || l.criado_em_lead);
  return col === 'semlig' && pego !== null && agoraMs - pego > 86400000;
}
function kbRetornoTag(l, agoraMs){
  const f = kbRetornoFaixa(l, agoraMs);
  if(!f) return null;
  const d = String(l.retorno_em).slice(0, 10), dm = d.slice(8, 10) + '/' + d.slice(5, 7);
  if(f === 'late') return { classe: 'late', texto: 'retorno ' + (d === kbSomaDias(kbDiaSP(agoraMs), -1) ? 'ontem' : dm) + ' · atrasado' };
  if(f === 'hoje') return { classe: 'ok', texto: 'retorno hoje' };
  return { classe: '', texto: 'retorno ' + dm };
}
// Cor da idade do lead livre: novo até 5 min, neutro até 15, atenção até 30, atrasado depois.
function kbCorIdadeLivre(l, agoraMs){
  const t = kbMs(l && l.criado_em_lead);
  if(t === null) return '';
  const min = (agoraMs - t) / 60000;
  return min <= 5 ? 'novo' : min < 15 ? '' : min < 30 ? 'soon' : 'late';
}
// Visões prontas da Lista (spec 4.2).
const KB_VISOES = [['todos', 'Todos'], ['aberto', 'Em aberto'], ['retornos', 'Retornos'], ['semlig', 'Sem ligação'], ['semresp', 'Sem resposta'], ['convertido', 'Convertidos'], ['perdido', 'Perdidos']];
function kbNaVisao(l, visao){
  const col = kbColunaDoLead(l);
  if(!visao || visao === 'todos') return true;
  if(visao === 'aberto') return kbAbertoCol(col);
  if(visao === 'retornos') return kbAbertoCol(col) && !!l.retorno_em;
  return col === visao;
}
function kbContarVisoes(leads){ const n = {}; KB_VISOES.forEach(([v]) => { n[v] = (leads || []).filter(l => kbNaVisao(l, v)).length; }); return n; }
// Convertido e Perdido começam recolhidos; a escolha e a densidade ficam guardadas no navegador.
const KB_COL_RECOLHIVEIS = ['convertido', 'perdido'];
function kbLerColAbertas(){ try { const v = JSON.parse(window.localStorage.getItem('kbColAbertas') || '{}'); return v && typeof v === 'object' ? v : {}; } catch(_e) { return {}; } }
function kbSalvarColAbertas(){ try { window.localStorage.setItem('kbColAbertas', JSON.stringify(kbEstado.colAbertas || {})); } catch(_e) {} }
function kbColAberta(col){ return !KB_COL_RECOLHIVEIS.includes(col) || !!(kbEstado.colAbertas || {})[col]; }
function kbLerDensidade(){ try { return window.localStorage.getItem('kbDensidade') === 'compacto' ? 'compacto' : 'conforto'; } catch(_e) { return 'conforto'; } }
function kbSalvarDensidade(){ try { window.localStorage.setItem('kbDensidade', kbEstado.densidade === 'compacto' ? 'compacto' : 'conforto'); } catch(_e) {} }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_meus_leads_fase2.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---`

- [ ] **Step 5: Commit**

```bash
git add _template.html test_meus_leads_fase2.js
git commit -m "feat(meus-leads): funcoes puras do Quadro e da Lista (urgencia, faixa, retorno, visoes) (secao 126.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Cartão novo

**Files:**
- Modify: `_template.html`, a função `kbCard` e o CSS do cartão.
- Modify: `test_leads_hoje.js` (2 asserções do cartão) e `test_leads_kanban.js` (1 asserção do dono).
- Test: `test_meus_leads_fase2.js`

**Interfaces:**
- Consumes:
  - Task 1: `kbUrgenciaCartao`, `kbFaixaVermelha`, `kbRetornoTag`, `kbCorIdadeLivre` e `kbIniciais`;
  - Fase 1: `KB_ICO` (`tel`, `wa`, `relogio`), `kbStTexto` e `kbPodePegar`;
  - já existentes: `kbStSlug`, `kbDuracao`, `kbMoeda`, `kbDivergencia` e `plParaResgatar`.
- Produces:
  - `kbCard(l, agoraMs) → string`, que mantém `class="kbCard"`, `data-aba`, `data-id`, `data-col`, `draggable="true"`, `.kbNome`, os links `[data-kb-contato="ligar"][data-kb-ligar]` e `[data-kb-contato="whatsapp"][data-kb-whats]`, e `[data-kb-pegar]` no livre;
  - classes `.kbStP`, `.kbUrg-*`, `.kbCartDono` e `.kbCardLivre`.
  - Sai o link "Classificar/Reclassificar" do cartão: clicar no cartão abre a ficha.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_fase2.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 2: cartão novo ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  kbEstado.podePegar = true;
  const agC = Date.now(), isoC = (min) => new Date(agC + min * 60000).toISOString(), hojeC = kbDiaSP(agC);
  const c1 = kbCard(LA('c1', { retorno_em: kbSomaDias(hojeC, -1), qtd_linhas: '6', cidade: 'Campinas', uf: 'SP', telefone: '11900000011', obs: 'Zz pediu proposta <b>',
    ultima_ligacao: isoC(-120), ultima_atendida: true, ultima_seg: 95, criado_em_lead: isoC(-60 * 24 * 4) }), agC);
  assert(c1.includes('class="kbCard kbAtrasado"') && c1.includes('kbUrg kbUrg-late'), 'retorno vencido: faixa vermelha e ícone vermelho');
  assert(c1.includes('class="kbStP" data-st="em-negociacao"') && c1.includes('>Em negociaçâo<'), 'STATUS como ponto + texto em frase normal (a planilha grava NEGOCIAÇÂO)');
  assert(c1.includes('Campinas/SP · 6 linhas') && c1.includes('retorno ontem · atrasado') && c1.includes('Ligou há 2 h') && c1.includes('atendida · 1 min 35 s') && c1.includes('há 4 dias'), 'cartão em 3 níveis: meta, retorno, última ligação e chegada');
  assert(c1.includes('Zz pediu proposta &lt;b&gt;') && c1.includes('data-kb-contato="ligar"') && c1.includes('data-kb-whats') && !c1.includes('wa.me') && !c1.includes('data-kb-classificar'), 'OBS escapada; Ligar e WhatsApp sem link pronto; sem link Classificar');
  const c2 = kbCard(LA('c2', { retorno_em: kbSomaDias(hojeC, 2) }), agC);
  assert(!c2.includes('kbAtrasado') && c2.includes('kbUrg-fut') && c2.includes('retorno ' + kbSomaDias(hojeC, 2).slice(8, 10) + '/'), 'retorno marcado: sem faixa, ícone cinza');
  assert(kbCard(LA('c3'), agC).includes('kbUrg-nada') && kbCard(LA('c4', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 899.9, venda_neo: true }), agC).includes('✓ NEO'), 'nada agendado (amarelo); convertido com receita e NEO, sem ícone');
  assert(!kbCard(LA('c5', { categoria: 'convertido' }), agC).includes('kbUrg'), 'convertido sem ícone de urgência');
  const cl = kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', cidade: 'Jundiaí', uf: 'SP', qtd_linhas: '10', criado_em_lead: isoC(-40) }, agC);
  assert(cl.includes('kbCardLivre') && cl.includes('data-kb-pegar') && cl.includes('kbTag late') && cl.includes('Jundiaí/SP · 10 linhas') && !cl.includes('kbUrg'), 'livre: cidade, linhas, idade com cor e Pegar');
  kbEstado.podePegar = false;
  assert(!kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, agC).includes('data-kb-pegar'), 'quem não pega não vê Pegar');
  kbEstado.podePegar = true;
  // RF1/RF2: campos vazios, STATUS antigo, HTML
  const cv = kbCard({ aba: 'O', lead_id: 'v', nome: null, livre: false, categoria: 'andamento', status: 'STATUS ANTIGO QUALQUER', ligacoes: 1 }, agC);
  assert(!/undefined|>null</.test(cv) && cv.includes('(sem nome)') && cv.includes('Status antigo qualquer'), 'RF1: cartão sem undefined/null e com status antigo em texto');
  const cx = kbCard({ aba: 'O', lead_id: 'x', nome: '<img src=x onerror=alert(1)>', obs: '<script>zz</script>', status: '<b>zz</b>', livre: false, categoria: 'andamento', ligacoes: 1 }, agC);
  assert(!cx.includes('<img') && !cx.includes('<script>') && !cx.includes('<b>zz'), 'RF2: cartão escapa nome, OBS e status');
  // gestor: iniciais e nome do dono
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  const cg = kbCard(LA('g1', { dono_nome: 'Zzkcon Teste' }), agC);
  assert(cg.includes('title="Com Zzkcon Teste"') && cg.includes('<b>ZT</b>Zzkcon'), 'gestor vê as iniciais e o primeiro nome do dono');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase2.js 2>&1 | grep -E "FALHOU|RESULTADO" | head`
Expected: falhas a partir de `retorno vencido: faixa vermelha e ícone vermelho`.

- [ ] **Step 3: Implementar o cartão**

Trocar a função `kbCard` inteira (de `function kbCard(l, agoraMs){` até o `}` antes de `const KB_POR_COLUNA = 100;`) por:

```js
// §126.2: cartão novo em três níveis — nome; cidade · linhas e STATUS (ponto); OBS, retorno, última ligação e chegada.
// Ícone de urgência no canto (só em aberto), faixa vermelha só no que precisa de ação agora, Ligar/WhatsApp ao passar o mouse.
const KB_URG_TITULO = { late: 'Retorno atrasado', hoje: 'Retorno hoje', fut: 'Retorno marcado', nada: 'Nada agendado' };
function kbCard(l, agoraMs){
  const col = kbColunaDoLead(l), div = kbDivergencia(l);
  const meta = [[l.cidade, l.uf].filter(Boolean).join('/'), l.qtd_linhas ? l.qtd_linhas + ' linhas' : ''].filter(Boolean).join(' · ');
  const tel = String(l.telefone || '').replace(/\D/g, '');
  const attrs = `data-aba="${escapeHtml(l.aba)}" data-id="${escapeHtml(l.lead_id)}" data-col="${col}" draggable="true"`;
  const nome = `<div class="kbNome">${escapeHtml(l.nome || '(sem nome)')}</div>`;
  const metaHtml = meta ? `<div class="kbCartMeta">${escapeHtml(meta)}</div>` : '';
  if(col === 'livres'){
    const cor = kbCorIdadeLivre(l, agoraMs);
    return `<div class="kbCard kbCardLivre" ${attrs}>${nome}${metaHtml}<div class="kbCartRodape"><span class="kbTag${cor ? ' ' + cor : ''}">${escapeHtml(kbTempoDesde(l.criado_em_lead, agoraMs))}</span>${kbPodePegar() ? '<button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-pegar>Pegar</button>' : ''}</div></div>`;
  }
  const urg = kbUrgenciaCartao(l, agoraMs);
  const st = l.status ? `<span class="kbStP" data-st="${escapeHtml(kbStSlug(l.status))}">${escapeHtml(kbStTexto(l.status))}</span>` : '<span class="kbStP">Sem status</span>';
  const extras = [];
  if(plParaResgatar(l)) extras.push('<span class="badge">para resgatar</span>');
  if(col === 'convertido' && (l.receita || l.receita_neo)) extras.push(`<span class="kbCartReceita">${escapeHtml(kbMoeda(l.receita || l.receita_neo))}${l.venda_neo ? ' · ✓ NEO' : ''}</span>`);
  const ret = kbAbertoCol(col) ? kbRetornoTag(l, agoraMs) : null;
  const lig = l.ultima_ligacao ? `<span class="kbCartLig${l.ultima_atendida ? ' ok' : ''}">${KB_ICO.tel}${escapeHtml('Ligou ' + kbTempoDesde(l.ultima_ligacao, agoraMs))} · ${l.ultima_atendida ? 'atendida' + (l.ultima_seg ? ' · ' + escapeHtml(kbDuracao(l.ultima_seg)) : '') : 'não atendida'}</span>` : '';
  const dono = kbGestor() && l.dono_nome ? `<span class="kbCartDono" title="Com ${escapeHtml(l.dono_nome)}"><b>${escapeHtml(kbIniciais(l.dono_nome))}</b>${escapeHtml(String(l.dono_nome).trim().split(/\s+/)[0])}</span>` : '';
  const acoes = tel ? `<div class="kbCartAcoes"><a class="kbBtn kbBtnP kbBtnIco" title="Ligar pelo ProContact (copia o número)" data-kb-contato="ligar" data-kb-ligar href="#">${KB_ICO.tel}</a><a class="kbBtn kbBtnQ kbBtnIco" title="WhatsApp" data-kb-contato="whatsapp" data-kb-whats href="#">${KB_ICO.wa}</a></div>` : '';
  return `<div class="kbCard${kbFaixaVermelha(l, agoraMs) ? ' kbAtrasado' : ''}" ${attrs}>
    ${urg ? `<span class="kbUrg kbUrg-${urg}" title="${KB_URG_TITULO[urg]}">${KB_ICO.relogio}</span>` : ''}${nome}${metaHtml}
    <div class="kbCartSt">${st}${extras.join('')}</div>
    ${l.obs ? `<div class="kbObs" title="${escapeHtml(l.obs)}">${escapeHtml(l.obs)}</div>` : ''}${div ? `<div class="kbDiv">⚠ ${escapeHtml(div)}</div>` : ''}
    <div class="kbCartRodape">${ret ? `<span class="kbTag ${ret.classe}">${escapeHtml(ret.texto)}</span>` : ''}${lig}${dono}<span class="kbTempo" title="Chegada do lead">${escapeHtml(kbTempoDesde(l.criado_em_lead, agoraMs))}</span></div>${acoes}
  </div>`;
}
```

- [ ] **Step 4: CSS do cartão**

No bloco de Meus leads, **apagar** estas linhas:
- `.kbUltLig{…}`, `.kbUltLig::before{…}` e `.kbUltLig.kbAtendida{…}`;
- `.kbObs{…}`;
- `.kbCard{…}`, `.kbCard:hover{…}`, `.kbCardTopo{…}` e `.kbNome{…}`;
- `.kbRodape{…}`, `.kbTempo{…}` e `.kbCard.kbAtrasado .kbTempo{…}`;
- `.kbIcones{…}`, `.kbIcone{…}`, `.kbIcone:hover{…}` e `.kbIcone svg{…}`.

**Manter:** `.kbCard:active`, `.kbCard.kbArrastado`, `.kbMeta`, `.kbChips`, `.kbLink`, `.kbMais`, `.kbVazio` e `.kbDiv`.

No lugar da linha `.kbCard{…}` apagada, inserir:

```css
  /* §126.2: cartão novo — três níveis, ícone de urgência, faixa vermelha só no que precisa de ação, ações ao passar o mouse */
  .kbCard{position:relative;background:var(--ml-surface);border-radius:var(--radius-lg);padding:12px 12px 10px;margin-bottom:var(--space-2);cursor:pointer;content-visibility:auto;contain-intrinsic-size:auto 128px;transition:box-shadow var(--dur-fast);}
  .kbCard:hover{box-shadow:0 0 0 1px var(--c-linha),0 4px 12px rgba(29,31,32,.08);}
  .kbCard.kbAtrasado::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--ml-late);}
  .kbNome{font-weight:600;font-size:14.5px;line-height:1.25;color:var(--ml-ink);padding-right:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .kbCartMeta{margin-top:2px;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbCartSt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;}
  .kbStP{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbStP::before{content:"";width:9px;height:9px;border-radius:50%;flex:none;background:var(--kb-st-bg,var(--c-linha-forte));box-shadow:inset 0 0 0 1.5px var(--kb-st-fg,transparent);}
  .kbObs{margin-top:8px;font-size:var(--fs-sm);color:var(--ml-ink-2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .kbCartRodape{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbTempo{margin-left:auto;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbCartLig{display:inline-flex;align-items:center;gap:4px;}
  .kbCartLig svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;}
  .kbCartLig.ok{color:var(--ml-ok);}
  .kbCartDono{display:inline-flex;align-items:center;gap:5px;color:var(--ml-ink-2);}
  .kbCartDono b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:var(--ml-surface-3);color:var(--ml-ink);font-size:10px;font-weight:700;}
  .kbCartReceita{font-size:var(--fs-xs);font-weight:600;color:var(--ml-ok);}
  .kbUrg{position:absolute;top:11px;right:10px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;}
  .kbUrg svg{width:12px;height:12px;stroke:var(--c-branco);fill:none;stroke-width:2.4;}
  .kbUrg-late{background:var(--ml-late);}
  .kbUrg-hoje{background:var(--ml-ok);}
  .kbUrg-fut{background:var(--ml-ink-3);}
  .kbUrg-nada{background:var(--ml-soon);}
  .kbCartAcoes{position:absolute;right:8px;bottom:8px;display:flex;gap:4px;opacity:0;transition:opacity var(--dur-fast);}
  .kbCard:hover .kbCartAcoes,.kbCard:focus-within .kbCartAcoes{opacity:1;}
  .kbCartAcoes .kbBtnIco{width:28px;height:28px;}
  .kbCardLivre .kbCartRodape .kbBtn{margin-left:auto;}
  .kbBoard.kbCompacto .kbObs,.kbBoard.kbCompacto .kbCartLig,.kbBoard.kbCompacto .kbCartMeta{display:none;}
```

- [ ] **Step 5: Ajustar os testes antigos do cartão**

`test_leads_hoje.js`:
- trocar `  assert(cartao.includes('Última ligação há 2 h') && cartao.includes('atendida · 1 min 35 s'), 'cartão mostra a última ligação');` por `  assert(cartao.includes('Ligou há 2 h') && cartao.includes('atendida · 1 min 35 s'), 'cartão mostra a última ligação');`;
- trocar `  assert(cartaoCor.includes('class="kbSt" data-st="em-negociacao"'), 'cartão usa a cor da tabulação');` por `  assert(cartaoCor.includes('class="kbStP" data-st="em-negociacao"'), 'cartão usa a cor da tabulação (ponto)');`.

`test_leads_kanban.js`:
- trocar `  assert(document.querySelector('#kbBoard [data-id="m1"]').textContent.includes('Com Zzkcon Teste'), 'card mostra com quem está');` por `  assert(document.querySelector('#kbBoard [data-id="m1"] .kbCartDono').title === 'Com Zzkcon Teste', 'card mostra com quem está');`.

- [ ] **Step 6: Rodar**

Run: `node test_meus_leads_fase2.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_leads_painel_hoje.js && node test_meus_leads_redesign.js`
Expected: os cinco com `0 falharam`.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_meus_leads_fase2.js test_leads_hoje.js test_leads_kanban.js
git commit -m "feat(meus-leads): cartao novo do Quadro com icone de urgencia e faixa vermelha (secao 126.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Colunas novas, Convertido e Perdido recolhidos, sem barra de atalhos

**Files:**
- Modify `_template.html`:
  - **CSS:** colunas, faixa recolhida e "Solte aqui"; sai `.kbNavQuadro`, `.kbNavCols`, `.kbNavCol`, `.kbNavCol b`, `.kbNavCol:hover`, `.kbSeta` e `.kbSeta:hover`;
  - **markup:** sai o `#kbNavQuadro`;
  - **JS:** `kbGarantirColunas`, `kbListaHtml`, `kbRender`, o clique do `#kbBoard`, `kbTrocarAba` e o estado inicial; saem `kbIrColuna`, `kbRolarColunas` e o listener do `#kbNavQuadro`.
- Modify: `test_leads_kanban.js`, `test_leads_hoje.js` e `test_leads_painel_hoje.js` (só onde usam `#kbNavQuadro` ou `perdidoAberto`).
- Test: `test_meus_leads_fase2.js`

**Interfaces:**
- Consumes (Task 1): `kbColAberta`, `kbSalvarColAbertas`, `KB_COL_RECOLHIVEIS` e `kbLerColAbertas`.
- Produces:
  - **Coluna:** `.kbCol[data-kb-col]` com `.kbColTopo` (`.kbColCor`, `h4`, `.kbConta`, `.kbColAcoes`), `.kbColSub`, `.kbColFaixa[data-kb-abrircol]` (só nas recolhíveis) e `.kbColLista`;
  - **Classes e atributos:** classe `kbRecolhida`; `[data-kb-recolher]`; "Pegar próximo" (`[data-kb-pegar-proximo]`) no cabeçalho dos Livres;
  - **Estado:** `kbEstado.colAbertas` (no lugar de `kbEstado.perdidoAberto`) e `kbEstado.densidade`.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_fase2.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 3: colunas ====
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const LQ = [LA('q1', { telefone: '11900000021' }), LA('q2', { cidade: 'Campinas', telefone: '11900000022' }), LA('cv1', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 100 }), LA('cv2', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)', receita: 50.5, cidade: 'Campinas' }),
    LA('pp1', { categoria: 'perdido', status: 'CNPJ INAPTO' }), { aba: 'O', lead_id: 'lv1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', criado_em_lead: isoC(-3) }];
  window.__rpcRespostas.leads_kanban3 = { data: LQ, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 1, placar: {} }, error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000021' }, LQ.find(l => l.lead_id === a.p_id) || {})], error: null });
  await kbAplicarPermissao(); await kbCarregar();
  kbTrocarAba('quadro'); await espera(40);
  const col = (c) => document.querySelector('#kbBoard .kbCol[data-kb-col="' + c + '"]');
  assert(!document.getElementById('kbNavQuadro'), 'sai a barra de atalhos das colunas');
  eq(col('andamento').querySelector('.kbColSub').textContent, 'Pela chegada do lead', 'subtítulo explica a coluna');
  assert(col('livres').querySelector('.kbColAcoes [data-kb-pegar-proximo]') && col('livres').querySelector('.kbColAcoes [data-kb-pegar-proximo]').style.display !== 'none', 'Livres com Pegar próximo no cabeçalho');
  assert(col('convertido').classList.contains('kbRecolhida') && col('perdido').classList.contains('kbRecolhida') && !col('convertido').querySelector('.kbCard'), 'Convertido e Perdido começam recolhidos, sem montar cartões');
  assert(col('convertido').querySelector('.kbColFaixa').textContent.includes('2') && col('convertido').querySelector('.kbColFaixa').textContent.includes('150,50'), 'faixa do Convertido com contagem e receita');
  col('convertido').querySelector('[data-kb-abrircol="convertido"]').click();
  assert(!col('convertido').classList.contains('kbRecolhida') && col('convertido').querySelector('.kbCard[data-id="cv1"]') && String(window.localStorage.getItem('kbColAbertas')).includes('"convertido":true'), 'clicar na faixa abre a coluna e guarda');
  col('convertido').querySelector('[data-kb-recolher="convertido"]').click();
  assert(col('convertido').classList.contains('kbRecolhida'), 'Recolher fecha de novo');
  // RF4: filtro ativo com coluna recolhida
  kbEstado.filtros = { cidade: 'Campinas' }; kbAoMudarFiltros();
  assert(col('convertido').querySelector('.kbColFaixa').textContent.includes('1') && col('convertido').querySelector('.kbConta').textContent === '1', 'RF4: faixa recolhida conta só os filtrados');
  kbEstado.filtros = {}; kbAoMudarFiltros();
  // RF6: soltar num Convertido recolhido abre a ficha com o grupo em destaque
  const soltar = (alvoSel, dados) => { const ev = new window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => JSON.stringify(dados) } }); document.querySelector(alvoSel).dispatchEvent(ev); };
  const nCls = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  soltar('#kbBoard .kbCol[data-kb-col="convertido"] .kbColFaixa', { aba: 'O', id: 'q1', col: 'andamento' });
  await espera(60);
  assert(kbEstado.fichaAlvo && kbEstado.fichaAlvo.id === 'q1' && document.querySelector('#kbFicha [data-kb-grupo="convertido"]').classList.contains('kbDestaque') && window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length === nCls, 'RF6: soltar no Convertido recolhido abre a ficha com Venda em destaque');
  kbFecharFicha(true);
  // densidade
  kbEstado.densidade = 'compacto'; kbRender();
  assert(document.getElementById('kbBoard').classList.contains('kbCompacto'), 'densidade compacta no Quadro');
  kbEstado.densidade = 'conforto'; kbRender();
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase2.js 2>&1 | grep -E "FALHOU|RESULTADO|FALHA" | head`
Expected: `FALHOU: sai a barra de atalhos das colunas`, entre outras.

- [ ] **Step 3: Markup**

Em `_template.html`, apagar o bloco inteiro que começa em `      <div class="kbNavQuadro" id="kbNavQuadro" style="display:none">` e termina no `      </div>` logo depois de `        <button type="button" class="kbSeta" data-kb-seta="1" aria-label="Colunas à direita">›</button>`. Conferir que `<div` e `</div>` diminuem na mesma quantidade (2 e 2).

- [ ] **Step 4: CSS das colunas**

1. Trocar estas linhas pelo bloco abaixo:
   - `  .kbBoard{display:grid;grid-template-columns:repeat(7,minmax(250px,1fr));…}`;
   - `  .kbCol{--kb-cor:var(--c-cinza);display:flex;…}`;
   - `  .kbColTopo{…}`;
   - `  .kbColTopo h4{…}`;
   - `  .kbConta{…}`.

   O bloco novo:

```css
  /* §126.2: colunas sem caixa — marcador de cor, nome, contagem, subtítulo e ações; Convertido e Perdido recolhem numa faixa */
  .kbBoard{display:flex;gap:14px;overflow-x:auto;padding:2px 2px var(--space-3);align-items:stretch;height:var(--kb-altura,calc(100vh - 230px));min-height:420px;}
  .kbCol{--kb-cor:var(--ml-ink-3);flex:0 0 262px;display:flex;flex-direction:column;min-height:0;border-radius:var(--radius-lg);transition:opacity var(--dur-fast),box-shadow var(--dur-fast),background var(--dur-fast);}
  .kbCol[data-kb-col="livres"]{flex-basis:232px;}
  .kbCol[data-kb-col="livres"] .kbColLista{background:var(--ml-surface-3);border-radius:var(--radius-lg);padding:8px;margin:0;}
  .kbCol[data-kb-col="semresp"]{--kb-cor:var(--st-perdido);}
  .kbColTopo{display:flex;align-items:center;gap:8px;padding:2px 4px 6px;}
  .kbColCor{width:9px;height:9px;border-radius:3px;background:var(--kb-cor);flex:none;}
  .kbColTopo h4{margin:0;font:600 var(--fs-md)/1.2 var(--font-body);text-transform:none;letter-spacing:0;color:var(--ml-ink);}
  .kbConta{font-size:var(--fs-sm);font-weight:600;color:var(--ml-ink-3);font-variant-numeric:tabular-nums;}
  .kbColAcoes{margin-left:auto;display:flex;align-items:center;gap:4px;}
  .kbColSub{margin:-2px 4px 10px;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbColFaixa{display:none;}
  .kbCol.kbRecolhida{flex:0 0 52px;background:var(--ml-surface);}
  .kbCol.kbRecolhida .kbColTopo,.kbCol.kbRecolhida .kbColSub,.kbCol.kbRecolhida .kbColLista{display:none;}
  .kbCol.kbRecolhida .kbColFaixa{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;height:100%;padding:12px 0;border:0;border-radius:var(--radius-lg);background:none;font:inherit;cursor:pointer;color:var(--ml-ink);}
  .kbCol.kbRecolhida .kbColFaixa:hover{background:var(--ml-surface-2);}
  .kbColFaixa i{width:9px;height:9px;border-radius:3px;background:var(--kb-cor);}
  .kbColFaixa b{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:600;font-size:var(--fs-base);display:flex;gap:10px;align-items:center;}
  .kbColFaixa b span{color:var(--ml-ink-3);font-weight:500;}
  .kbBoard.kbArrastando .kbCol.kbAceita[data-kb-col="novos"] .kbColLista::before{content:"Solte aqui para pegar este lead";display:block;margin-bottom:var(--space-2);padding:14px 10px;border:2px dashed var(--c-sinal);border-radius:var(--radius-lg);background:var(--ml-novo-soft);color:var(--c-sinal-600);font-weight:600;font-size:var(--fs-sm);text-align:center;}
```

2. Trocar `  .kbBoard.kbArrastando .kbCol.kbAceita{opacity:1;box-shadow:inset 0 0 0 2px var(--kb-cor);}` por `  .kbBoard.kbArrastando .kbCol.kbAceita{opacity:1;box-shadow:inset 0 0 0 2px var(--kb-cor);border-radius:var(--radius-lg);}`.
3. Trocar `  .kbCol.kbAlvo{background:var(--c-branco);}` por `  .kbCol.kbAlvo{background:var(--ml-surface);}`.
4. Apagar as 7 linhas `.kbNavQuadro{…}`, `.kbNavCols{…}`, `.kbNavCol{…}`, `.kbNavCol b{…}`, `.kbNavCol:hover{…}`, `.kbSeta{…}` e `.kbSeta:hover{…}`.
5. Dentro do `@media (max-width: 900px){`, trocar `    .kbBoard{grid-template-columns:repeat(6,82vw);height:auto;}` por `    .kbBoard{height:auto;}\n    .kbCol{flex-basis:82vw;}`.

- [ ] **Step 5: JS**

1. Trocar a função `kbGarantirColunas` inteira por:

```js
// §126.2: cabeçalho das colunas (marcador de cor, nome, contagem, subtítulo, ações) e a faixa das recolhíveis.
const KB_COL_SUB = { livres: 'Arraste para "Meus novos" ou clique em Pegar', semlig: 'Classificados, mas ninguém ligou ainda', novos: 'Pegos por você, ainda sem status',
  andamento: 'Pela chegada do lead', semresp: 'Todos os meses · pela chegada do lead', convertido: 'Vendas do mês · pela chegada do lead', perdido: 'Perdidos do mês' };
function kbGarantirColunas(board){
  if(board.querySelector('.kbColLista')) return;
  board.innerHTML = KB_COLUNAS.map(col => {
    const acoes = (col === 'livres' ? `<button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-pegar-proximo>${KB_ICO.mao}Pegar próximo</button>` : '')
      + (KB_COL_ORDEM.includes(col) ? `<button type="button" class="kbOrdem" data-kb-ordem="${col}" title="Ordem pela chegada do lead"></button>` : '')
      + (KB_COL_RECOLHIVEIS.includes(col) ? `<button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-recolher="${col}" title="Recolher a coluna">Recolher</button>` : '');
    const faixa = KB_COL_RECOLHIVEIS.includes(col) ? `<button type="button" class="kbColFaixa" data-kb-abrircol="${col}" title="Abrir ${KB_TITULOS[col]}"><i></i><b>${KB_TITULOS[col]} <span>0</span></b></button>` : '';
    return `<div class="kbCol" data-kb-col="${col}"><div class="kbColTopo"><i class="kbColCor"></i><h4>${KB_TITULOS[col]}</h4><span class="kbConta">0</span><span class="kbColAcoes">${acoes}</span></div><p class="kbColSub">${escapeHtml(KB_COL_SUB[col])}</p>${faixa}<div class="kbColLista"></div></div>`;
  }).join('');
  kbEstado.colHtml = {};
}
```

2. Em `kbListaHtml`, trocar as duas primeiras linhas do corpo:

```js
  if(col === 'perdido' && !kbEstado.perdidoAberto)
    return todos.length ? `<button type="button" class="kbLink kbMais" data-kb-abrirperdido>Mostrar perdidos do mês (${todos.length})</button>` : `<div class="kbVazio">Nada aqui</div>`;
```
   por:
```js
  if(!kbColAberta(col)) return '';   // §126.2: coluna recolhida não monta cartões
```

3. Em `kbRender`, dentro do `KB_COLUNAS.forEach(col => {`:
   - trocar `    el.classList.toggle('kbFechada', col === 'perdido' && !kbEstado.perdidoAberto);` por:

```js
    el.classList.toggle('kbRecolhida', !kbColAberta(col));
    const faixa = el.querySelector('.kbColFaixa span');
    if(faixa) faixa.textContent = col === 'convertido' ? `${c[col].length} · ${kbMoeda(c[col].reduce((s, l) => s + (Number(l.receita || l.receita_neo) || 0), 0)) || 'R$ 0,00'}` : String(c[col].length);
    const pp = el.querySelector('.kbColAcoes [data-kb-pegar-proximo]');
    if(pp) pp.style.display = kbPodePegar() ? '' : 'none';
```
   - apagar as três linhas da barra de atalhos: `    const nav = document.querySelector(…);`, `    if(nav) nav.textContent = …;` e `    if(nav && nav.parentElement) …;`.
   - logo depois de `  kbGarantirColunas(board);`, inserir `  board.classList.toggle('kbCompacto', kbEstado.densidade === 'compacto');`.

4. Apagar as funções `kbIrColuna` e `kbRolarColunas` e o listener `document.getElementById('kbNavQuadro').addEventListener('click', …);` (3 linhas).

5. No clique do `#kbBoard`, trocar `  if(e.target.closest('[data-kb-abrirperdido]')){ kbEstado.perdidoAberto = true; kbRender(); return; }` por:

```js
  const ac = e.target.closest('[data-kb-abrircol]'), rc = e.target.closest('[data-kb-recolher]');
  if(ac || rc){ kbEstado.colAbertas = Object.assign({}, kbEstado.colAbertas, { [(ac || rc).dataset[ac ? 'kbAbrircol' : 'kbRecolher']]: !!ac }); kbSalvarColAbertas(); kbRender(); return; }
```

6. Em `kbTrocarAba`, apagar a linha `  document.getElementById('kbNavQuadro').style.display = kbEstado.aba === 'quadro' ? '' : 'none';`.

7. Logo depois da linha `kbEstado.filtros = kbLerFiltros();`, inserir `kbEstado.colAbertas = kbLerColAbertas(); kbEstado.densidade = kbLerDensidade();`.

8. Conferir: `grep -n "perdidoAberto\|kbNavQuadro\|kbIrColuna\|kbRolarColunas\|data-kb-abrirperdido\|kbFechada" _template.html` não acha nada.

- [ ] **Step 6: Ajustar os testes antigos**

`test_leads_kanban.js`:
1. Trocar `  kbEstado.perdidoAberto = true; kbRender();   // §120: o Perdido só monta os cartões quando é aberto` por `  kbEstado.colAbertas = { perdido: true }; kbRender();   // §126.2: Perdido recolhido não monta cartões`.
2. No bloco `// ==== Task 10: supervisão ====`, logo antes da linha `  await kbCarregar();` que vem depois de `  await kbCarregarFiltros();`, inserir `  kbEstado.colAbertas = { convertido: true };   // §126.2: Convertido começa recolhido`.

`test_leads_hoje.js`:
1. Trocar `  assert(!document.querySelector('#kbBoard [data-kb-col="perdido"] .kbCard') && document.querySelector('#kbBoard [data-kb-abrirperdido]'), 'Perdido fechado não monta cartões');` por `  assert(!document.querySelector('#kbBoard [data-kb-col="perdido"] .kbCard') && document.querySelector('#kbBoard [data-kb-abrircol="perdido"]'), 'Perdido recolhido não monta cartões');`.
2. Trocar as 5 linhas que vão de `  // navegação: setas e atalhos das colunas; atalho do Perdido abre a coluna` até `  assert(document.getElementById('kbNavQuadro').style.display === 'none', 'barra só no Quadro');` (a linha `kbTrocarAba('hoje');` entre elas também sai) por:
```js
  // §126.2: a faixa do Perdido recolhido mostra a contagem e abre a coluna
  assert(document.querySelector('#kbBoard [data-kb-abrircol="perdido"]').textContent.includes('1'), 'faixa do Perdido com contagem');
  document.querySelector('#kbBoard [data-kb-abrircol="perdido"]').click();
  assert(document.querySelector('#kbBoard [data-kb-col="perdido"] .kbCard[data-id="pp1"]'), 'clicar na faixa abre o Perdido');
  kbEstado.colAbertas = {}; kbSalvarColAbertas();
  kbTrocarAba('hoje');
  assert(!document.getElementById('kbNavQuadro'), 'barra de atalhos das colunas saiu');
```
3. Trocar `  assert(document.querySelector('#kbNavQuadro [data-kb-ir="semlig"]').textContent.includes('1'), 'atalho Sem ligação com contagem');` por `  eq(document.querySelector('#kbBoard [data-kb-col="semlig"] .kbConta').textContent, '1', 'Sem ligação com contagem');`.

`test_leads_painel_hoje.js`:
1. Apagar a linha `  assert(document.querySelector('#kbNavQuadro [data-kb-ir="livres"]').style.display === 'none', 'atalho Livres some');`.
2. Trocar `  assert(document.querySelector('#kbNavQuadro [data-kb-ir="semresp"]'), 'atalho da coluna no topo do Quadro');` por `  eq(document.querySelector('#kbBoard [data-kb-col="semresp"] .kbColTopo h4').textContent, 'Sem resposta', 'coluna Sem resposta com título');`.

- [ ] **Step 7: Rodar**

Run: `node test_meus_leads_fase2.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_leads_painel_hoje.js && node test_meus_leads_redesign.js`
Expected: os cinco com `0 falharam`. Contar `<div` e `</div>` no `<body>` (Python) e conferir que estão iguais.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_meus_leads_fase2.js test_leads_hoje.js test_leads_kanban.js test_leads_painel_hoje.js
git commit -m "feat(meus-leads): colunas novas, Convertido e Perdido recolhidos, sai a barra de atalhos (secao 126.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Filtros em botões e densidade

**Files:**
- Modify `_template.html`:
  - **JS:** `kbFiltroBarraHtml`, `kbRenderFiltroBarra` e os listeners do `#kbFiltroBarra` (sai o de `change`);
  - **CSS:** filtros;
  - **markup:** `#kbFiltroBarra` sem a classe `card`.
- Modify: `test_leads_painel_hoje.js` (o `select` da cidade e o filtro guardado que sumiu).
- Test: `test_meus_leads_fase2.js`

**Interfaces:**
- Consumes: `KB_FILTROS`, `kbOpcoesFiltro`, `kbAoMudarFiltros` e `kbRenderTodos` (já existem); da Task 1, `kbSalvarDensidade`.
- Produces:
  - `kbFiltroBarraHtml(leads, filtros, agoraMs, opc?:{densidade}) → string`, com:
    - `details.kbFiltroMenu[data-kb-menu=g]` e `summary.kbFb`;
    - `button.kbFiltroOp[data-kb-filtro][data-valor]`, `[data-kb-filtro-tirar]` e `[data-kb-filtro-limpar]`;
    - `[data-kb-densidade]`.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_fase2.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 4: filtros em botões e densidade ====
  const hf = kbFiltroBarraHtml(LQ, { cidade: 'Campinas' }, Date.now(), { densidade: 'conforto' });
  assert(hf.includes('data-kb-menu="cidade"') && hf.includes('class="kbFb on">Cidade: <b>Campinas</b><span class="kbFbX" data-kb-filtro-tirar="cidade"') && hf.includes('class="kbFiltroOp" data-kb-filtro-tirar="cidade">Todos'), 'filtro ativo: botão escuro com o valor, × e opção Todos');
  assert(hf.includes('class="kbFiltroOp ativo" data-kb-filtro="cidade" data-valor="Campinas"') && !hf.includes('<select'), 'opções em lista de botões, sem select');
  assert(hf.includes('data-kb-filtro="ligacao"') && hf.includes('data-kb-densidade="compacto"') && hf.includes('Limpar filtros (1)'), 'Nunca ligado direto, densidade e Limpar');
  assert(kbFiltroBarraHtml([{ aba: 'O', lead_id: 'x', cidade: 'Santos', livre: false }], { cidade: 'Campinas' }, Date.now()).includes('Cidade: <b>Campinas</b>'), 'filtro guardado que sumiu dos leads continua à vista');
  kbTrocarAba('quadro'); kbRenderFiltroBarra();
  const barraF = document.getElementById('kbFiltroBarra');
  assert(!barraF.classList.contains('card'), 'barra de filtros sem caixa');
  barraF.querySelector('[data-kb-filtro="cidade"][data-valor="Campinas"]').click();
  eq(kbEstado.filtros.cidade, 'Campinas', 'clicar na opção liga o filtro');
  barraF.querySelector('.kbFbX[data-kb-filtro-tirar="cidade"]').click();
  assert(!kbEstado.filtros.cidade, 'o × tira o filtro do grupo');
  barraF.querySelector('[data-kb-densidade="compacto"]').click();
  assert(kbEstado.densidade === 'compacto' && document.getElementById('kbBoard').classList.contains('kbCompacto') && window.localStorage.getItem('kbDensidade') === 'compacto', 'densidade compacta aplicada e guardada');
  document.getElementById('kbFiltroBarra').querySelector('[data-kb-densidade="conforto"]').click();
  // menu aberto fecha ao clicar fora
  const menu = document.querySelector('#kbFiltroBarra details[data-kb-menu="cidade"]');
  menu.open = true; document.body.click();
  assert(!menu.open, 'menu de filtro fecha ao clicar fora');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase2.js 2>&1 | grep -E "FALHOU|RESULTADO" | head`
Expected: falha em `filtro ativo: botão escuro com o valor e opção Todos`.

- [ ] **Step 3: Implementar**

1. Trocar a função `kbFiltroBarraHtml` inteira por:

```js
// §126.2: filtros em botões compactos que abrem uma lista; o ativo fica escuro com o valor. Mesma lógica (KB_FILTROS) e o mesmo guardado no navegador.
function kbFiltroBarraHtml(leads, filtros, agoraMs, opc){
  const f = filtros || {}, o = opc || {};
  const itens = Object.keys(KB_FILTROS).map(g => {
    const def = KB_FILTROS[g], ops = kbOpcoesFiltro(leads, g, f, agoraMs);
    if(f[g] && !ops.some(x => x.valor === f[g])) ops.unshift({ valor: f[g], rotulo: f[g], n: 0 });   // valor guardado que sumiu dos leads: continua à vista
    if(!ops.length && !f[g]) return '';
    if(g === 'ligacao'){ const op = ops[0]; return `<button type="button" class="kbFb${f[g] ? ' on' : ''}" data-kb-filtro="${g}" data-valor="${escapeHtml(op.valor)}">${escapeHtml(op.rotulo)} <b>${op.n}</b></button>`; }
    const atual = f[g] ? ((ops.find(x => x.valor === f[g]) || {}).rotulo || f[g]) : '';
    return `<details class="kbFiltroMenu" data-kb-menu="${g}"><summary class="kbFb${f[g] ? ' on' : ''}">${def.rotulo}${f[g] ? `: <b>${escapeHtml(atual)}</b><span class="kbFbX" data-kb-filtro-tirar="${g}" title="Tirar o filtro">×</span>` : '<span class="kbFbSeta" aria-hidden="true">▾</span>'}</summary>`
      + `<div class="kbFiltroLista">${f[g] ? `<button type="button" class="kbFiltroOp" data-kb-filtro-tirar="${g}">Todos</button>` : ''}${ops.map(x =>
        `<button type="button" class="kbFiltroOp${f[g] === x.valor ? ' ativo' : ''}" data-kb-filtro="${g}" data-valor="${escapeHtml(x.valor)}">${escapeHtml(x.rotulo)} <b>${x.n}</b></button>`).join('')}</div></details>`;
  }).join('');
  const ativos = Object.keys(f).filter(g => f[g]).length;
  const dens = o.densidade ? `<nav class="kbSeg kbDensidade" aria-label="Densidade"><button type="button" data-kb-densidade="conforto"${o.densidade === 'conforto' ? ' class="active"' : ''}>Confortável</button><button type="button" data-kb-densidade="compacto"${o.densidade === 'compacto' ? ' class="active"' : ''}>Compacto</button></nav>` : '';
  return `<div class="kbFiltrosLinha">${itens}${ativos ? `<button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-filtro-limpar>Limpar filtros (${ativos})</button>` : ''}</div>${dens}`;
}
```

2. Em `kbRenderFiltroBarra`, trocar `  const html = kbFiltroBarraHtml(kbFonteFiltros(), kbEstado.filtros, Date.now());` por `  const html = kbFiltroBarraHtml(kbFonteFiltros(), kbEstado.filtros, Date.now(), { densidade: kbEstado.densidade || 'conforto' });`.

3. Trocar o listener `document.getElementById('kbFiltroBarra').addEventListener('click', …);` inteiro e o de `change` logo abaixo (os dois) por:

```js
document.getElementById('kbFiltroBarra').addEventListener('click', (e) => {
  if(e.target.closest('[data-kb-filtro-limpar]')){ kbEstado.filtros = {}; kbAoMudarFiltros(); return; }
  const dn = e.target.closest('[data-kb-densidade]');
  if(dn){ kbEstado.densidade = dn.dataset.kbDensidade === 'compacto' ? 'compacto' : 'conforto'; kbSalvarDensidade(); if(kbEhTabela(kbEstado.aba)) kbRenderTodos(); else kbRender(); kbRenderFiltroBarra(); return; }
  const tr = e.target.closest('[data-kb-filtro-tirar]');
  if(tr){ e.preventDefault(); delete kbEstado.filtros[tr.dataset.kbFiltroTirar]; kbAoMudarFiltros(); return; }   // preventDefault: o × no summary não abre o menu
  const b = e.target.closest('button[data-kb-filtro]');
  if(!b) return;
  const g = b.dataset.kbFiltro, v = b.dataset.valor;
  if(kbEstado.filtros[g] === v) delete kbEstado.filtros[g]; else kbEstado.filtros[g] = v;
  kbAoMudarFiltros();
});
// menu de filtro aberto fecha ao clicar fora dele
document.addEventListener('click', (e) => { document.querySelectorAll('#kbFiltroBarra details.kbFiltroMenu[open]').forEach(d => { if(!d.contains(e.target)) d.open = false; }); });
```

4. Markup: trocar `      <div id="kbFiltroBarra" class="kbFiltroBarra card" style="display:none"></div>` por `      <div id="kbFiltroBarra" class="kbFiltroBarra" style="display:none"></div>`.

5. CSS: apagar `.kbFiltroBarra{…}`, `.kbFiltroGrupo{…}`, `.kbFiltroGrupo .kbMeta{…}`, `.kbFiltroCampo{…}` e `.kbFiltroBarra .filterPill b{…}`. No lugar, inserir:

```css
  /* §126.2: filtros em botões compactos + densidade */
  .kbFiltroBarra{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;margin:0 0 var(--space-3);}
  .kbFiltrosLinha{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
  .kbFb{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px 0 12px;border:0;border-radius:var(--radius-lg);background:var(--ml-surface);font:inherit;font-size:var(--fs-sm);font-weight:600;color:var(--ml-ink-2);cursor:pointer;list-style:none;}
  .kbFb::-webkit-details-marker{display:none;}
  .kbFb:hover{color:var(--ml-ink);}
  .kbFb.on{background:var(--ml-ink);color:var(--c-branco);}
  .kbFb b{font-weight:700;font-variant-numeric:tabular-nums;}
  .kbFbSeta{font-size:10px;opacity:.7;}
  .kbFbX{margin-left:2px;padding:0 2px;opacity:.85;}
  .kbFbX:hover{opacity:1;}
  .kbFiltroMenu{position:relative;}
  .kbFiltroLista{position:absolute;left:0;top:calc(100% + 4px);min-width:210px;max-height:300px;overflow-y:auto;padding:6px;border-radius:var(--radius-lg);background:var(--ml-surface);box-shadow:var(--ml-float);z-index:20;display:flex;flex-direction:column;gap:2px;}
  .kbFiltroOp{display:flex;justify-content:space-between;gap:12px;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;font:inherit;font-size:var(--fs-sm);text-align:left;color:var(--ml-ink);cursor:pointer;}
  .kbFiltroOp:hover{background:var(--ml-surface-2);}
  .kbFiltroOp.ativo{background:var(--ml-surface-3);font-weight:600;}
  .kbFiltroOp b{color:var(--ml-ink-3);font-weight:600;}
```

- [ ] **Step 4: Ajustar os testes antigos**

`test_leads_painel_hoje.js`:
1. Trocar as 3 linhas
```js
  const cidadeSel = barra.querySelector('select[data-kb-filtro="cidade"]');
  cidadeSel.value = 'Campinas'; cidadeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(kbEstado.filtros.cidade, 'Campinas', 'select liga o filtro');
```
   por
```js
  barra.querySelector('[data-kb-filtro="cidade"][data-valor="Campinas"]').click();
  eq(kbEstado.filtros.cidade, 'Campinas', 'opção da lista liga o filtro');
```
2. Trocar `  assert(htmlRF.includes('<option value="Campinas" selected>Campinas (0)</option>'), 'filtro guardado que sumiu dos leads continua selecionado com (0)');` por `  assert(htmlRF.includes('Cidade: <b>Campinas</b>') && htmlRF.includes('data-valor="Campinas"'), 'filtro guardado que sumiu dos leads continua à vista');`.

- [ ] **Step 5: Rodar**

Run: `node test_meus_leads_fase2.js && node test_leads_painel_hoje.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_meus_leads_redesign.js`
Expected: os cinco com `0 falharam`.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_meus_leads_fase2.js test_leads_painel_hoje.js
git commit -m "feat(meus-leads): filtros em botoes compactos e densidade Confortavel/Compacto (secao 126.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Lista (ex-Todos)

**Files:**
- Modify `_template.html`:
  - **markup:** `#kbTodos` e o texto da sub-aba;
  - **CSS:** Lista;
  - **JS:** `KB_ABA_TITULOS`, `KB_TODOS_COLUNAS`, `kbValorOrdem`, `kbEstadoTabela`, `kbCelulaTabela`, `kbRenderTodos` e o listener do `#kbTodos`.
- Test: `test_meus_leads_fase2.js`

**Interfaces:**
- Consumes (Task 1): `KB_VISOES`, `kbNaVisao`, `kbContarVisoes`, `kbRetornoTag` e `kbIniciais`. Também `kbEstado.densidade`, já existente.
- Produces:
  - `#kbVisoes` com `[data-kb-visao]`;
  - tabela `table.kbTabelaTodos` (sem `.tbl`), com:
    - `td.kbTd-<coluna>`;
    - linha `tr[data-kb-abrir]`;
    - ações `.kbLnAcoes [data-kb-contato]`;
  - `kbEstadoTabela().visao`.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_fase2.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 5: Lista ====
  eq(document.querySelector('#kbAbas [data-kb-aba="todos"]').textContent.trim(), 'Lista', 'a sub-aba Todos passa a se chamar Lista');
  const LL = [LA('t1', { nome: 'Zz Alfa', cidade: 'Campinas', uf: 'SP', campanha: 'Zz Camp', telefone: '11900000031', retorno_em: kbSomaDias(hojeC, -1), ultima_ligacao: isoC(-120), ultima_atendida: true, ultima_seg: 240, qtd_linhas: '12' }),
    LA('t2', { nome: 'Zz Beta', telefone: '11900000032', ligacoes: 0 }), LA('t3', { nome: 'Zz Gama', categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)' }),
    LA('t4', { nome: 'Zz Delta', categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE' })];
  window.__rpcRespostas.leads_kanban3 = (args) => ({ data: args.p_todos ? LL : LQ, error: null });
  kbEstado.filtros = {};
  kbTrocarAba('todos'); await espera(80);
  const vis = [...document.querySelectorAll('#kbVisoes [data-kb-visao]')];
  eq(vis.map(b => b.dataset.kbVisao), ['todos', 'aberto', 'retornos', 'semlig', 'semresp', 'convertido', 'perdido'], 'visões prontas');
  assert(vis[0].classList.contains('active') && vis[0].textContent.includes('4') && vis[1].textContent.includes('2'), 'visões com contagem');
  vis[1].click();
  eq([...document.querySelectorAll('#kbTodos tbody tr')].map(t => t.dataset.kbAbrir).sort(), ['O|t1', 'O|t2'], 'visão Em aberto filtra a tabela');
  document.querySelector('#kbVisoes [data-kb-visao="todos"]').click();
  const ths = [...document.querySelectorAll('#kbTodos thead th[data-kb-ord]')].map(t => t.textContent.replace(/[▲▼]/g, '').trim());
  eq(ths, ['Empresa', 'Etapa', 'STATUS', 'Último contato', 'Próximo retorno', 'Linhas', 'Pego em'], 'colunas da Lista (consultor)');
  const lt1 = document.querySelector('#kbTodos tr[data-kb-abrir="O|t1"]');
  assert(lt1.querySelector('.kbTd-nome').textContent.includes('Campinas/SP · Zz Camp') && lt1.querySelector('.kbTd-etapa .kbEtapa') && lt1.querySelector('.kbTd-status .kbStP'), 'Empresa com cidade e campanha; etapa e STATUS com marcador');
  assert(lt1.querySelector('.kbTd-contato').textContent.includes('atendida · 4 min') && lt1.querySelector('.kbTd-retorno .kbTag.late') && lt1.querySelector('.kbTd-linhas').textContent.trim() === '12', 'último contato, retorno atrasado e linhas');
  assert(document.querySelector('#kbTodos tr[data-kb-abrir="O|t2"] .kbTd-contato').textContent.includes('nunca ligado'), 'nunca ligado');
  assert(!document.querySelector('#kbTodos table').classList.contains('tbl') && document.querySelector('#kbTodos table').classList.contains('kbTabelaTodos'), 'tabela própria da Lista');
  // RF5: Ligar na linha não abre a ficha
  const nF = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  const abertosL = []; const openL = window.open; window.open = (u) => { abertosL.push(String(u)); return null; };
  lt1.querySelector('.kbLnAcoes [data-kb-whats]').click();
  await espera(40);
  window.open = openL;
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nF && abertosL.some(u => u.includes('wa.me/5511900000031')), 'RF5: WhatsApp na linha abre a conversa sem abrir a ficha');
  lt1.querySelector('.kbTd-nome').click();
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nF + 1, 'clicar na linha abre a ficha');
  kbFecharFicha(true);
  // densidade e gestor
  kbEstado.densidade = 'compacto'; kbRenderTodos();
  assert(document.querySelector('#kbTodos table').classList.contains('kbCompacto'), 'densidade compacta na Lista');
  kbEstado.densidade = 'conforto';
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  kbEstado.todos = LL.map(l => Object.assign({}, l, { dono_nome: 'Zzkcon Teste' })); kbRenderTodos();
  assert([...document.querySelectorAll('#kbTodos thead th[data-kb-ord]')].some(t => t.textContent.includes('Consultor')) && document.querySelector('#kbTodos .kbTd-dono').textContent.includes('Zzkcon'), 'gestor vê a coluna Consultor');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase2.js 2>&1 | grep -E "FALHOU|RESULTADO|FALHA" | head`
Expected: falha em `a sub-aba Todos passa a se chamar Lista`.

- [ ] **Step 3: Markup**

1. Trocar `          <button type="button" data-kb-aba="todos">Todos</button>` por `          <button type="button" data-kb-aba="todos">Lista</button>`.
2. Trocar o bloco
```html
      <div id="kbTodos" class="kbTodos" style="display:none">
        <div class="card"><input type="search" id="kbTodosBusca" class="kbBusca" placeholder="Buscar nos seus leads por nome, telefone ou CNPJ…" autocomplete="off"><div id="kbTodosTabela"></div></div>
      </div>
```
   por
```html
      <div id="kbTodos" class="kbTodos" style="display:none">
        <div class="kbListaTopo"><nav class="kbVisoes" id="kbVisoes" aria-label="Visões da lista"></nav><input type="search" id="kbTodosBusca" class="kbBusca kbListaBusca" placeholder="Buscar na lista por nome, telefone ou CNPJ" autocomplete="off" aria-label="Buscar na lista"></div>
        <div class="kbListaTabela" id="kbTodosTabela"></div>
      </div>
```

- [ ] **Step 4: JS**

1. Trocar `const KB_ABA_TITULOS = { hoje: 'Hoje', quadro: 'Quadro', todos: 'Todos', equipe: 'Equipe' };` por `const KB_ABA_TITULOS = { hoje: 'Hoje', quadro: 'Quadro', todos: 'Lista', equipe: 'Equipe' };   // §126.2: Todos vira Lista (chave interna continua 'todos')`.
2. Trocar a linha `const KB_TODOS_COLUNAS = …;` por `const KB_TODOS_COLUNAS = [['nome', 'Empresa'], ['etapa', 'Etapa'], ['status', 'STATUS'], ['contato', 'Último contato'], ['retorno', 'Próximo retorno'], ['linhas', 'Linhas'], ['pego', 'Pego em']];`.
3. Em `kbValorOrdem`, logo antes de `  return '';`, inserir `  if(col === 'dono') return String(l.dono_nome || '').toLowerCase();`.
4. Trocar `function kbEstadoTabela(){ return kbEstado.todosEstado || (kbEstado.todosEstado = { busca: '', col: 'pego', desc: true, pagina: 1 }); }` por `function kbEstadoTabela(){ return kbEstado.todosEstado || (kbEstado.todosEstado = { busca: '', col: 'pego', desc: true, pagina: 1, visao: 'todos' }); }`.
5. Trocar as funções `kbCelulaTabela` e `kbRenderTodos` (com o comentário `// Tabela da aba Todos (leads_kanban3 com p_todos)` entre elas) e o listener `document.getElementById('kbTodos').addEventListener('click', …);` por:

```js
// §126.2: células da Lista — Empresa (nome; cidade · campanha), Etapa e STATUS com marcador, último contato, retorno, linhas, pego em.
function kbCelulaTabela(l, col, agoraMs){
  const c = kbColunaDoLead(l);
  if(col === 'nome') return `<b>${escapeHtml(l.nome || '(sem nome)')}</b><small>${escapeHtml([[l.cidade, l.uf].filter(Boolean).join('/'), l.campanha].filter(Boolean).join(' · '))}</small>`;
  if(col === 'dono') return l.dono_nome ? `<span class="kbCartDono"><b>${escapeHtml(kbIniciais(l.dono_nome))}</b>${escapeHtml(l.dono_nome)}</span>` : '<span class="kbMuted">—</span>';
  if(col === 'etapa') return `<span class="kbEtapa kbEt-${c}">${escapeHtml(KB_TITULOS[c] || '')}</span>`;
  if(col === 'status') return l.status ? `<span class="kbStP" data-st="${escapeHtml(kbStSlug(l.status))}">${escapeHtml(kbStTexto(l.status))}</span>` : '<span class="kbMuted">—</span>';
  if(col === 'contato') return l.ultima_ligacao ? `${escapeHtml(kbTempoDesde(l.ultima_ligacao, agoraMs))}<small>${l.ultima_atendida ? 'atendida' + (l.ultima_seg ? ' · ' + escapeHtml(kbDuracao(l.ultima_seg)) : '') : 'não atendida'}</small>` : '<span class="kbMuted">nunca ligado</span>';
  if(col === 'retorno'){ const t = kbAbertoCol(c) ? kbRetornoTag(l, agoraMs) : null; return t ? `<span class="kbTag ${t.classe}">${escapeHtml(t.texto.replace(/^retorno /, ''))}</span>` : '<span class="kbMuted">—</span>'; }
  if(col === 'linhas') return escapeHtml(String((String(l.qtd_linhas || '').match(/\d+/) || ['—'])[0]));
  if(col === 'pego') return l.pego_em ? escapeHtml(kbDataHoraBR(l.pego_em)) : '<span class="kbMuted">—</span>';
  return '';
}
// Lista (ex-Todos; leads_kanban3 com p_todos): visões prontas, tabela de 52 px (40 no compacto), ações ao passar o mouse.
function kbRenderTodos(){
  const st = kbEstadoTabela(), agoraMs = Date.now();
  const cols = kbGestor() ? [KB_TODOS_COLUNAS[0], ['dono', 'Consultor'], ...KB_TODOS_COLUNAS.slice(1)] : KB_TODOS_COLUNAS;
  const base = kbFiltrar(kbEstado.todos || [], kbEstado.filtros, agoraMs).filter(l => kbBuscaLocal(l, st.busca));
  const n = kbContarVisoes(base);
  document.getElementById('kbVisoes').innerHTML = KB_VISOES.map(([v, t]) => `<button type="button" class="kbVisao${st.visao === v ? ' active' : ''}" data-kb-visao="${v}">${t} <span>${n[v]}</span></button>`).join('');
  const lista = kbOrdenar(base.filter(l => kbNaVisao(l, st.visao)), st.col, st.desc);
  const pg = kbPagina(lista, st.pagina, KB_TODOS_POR_PAGINA);
  st.pagina = pg.pagina;
  const busca = document.getElementById('kbTodosBusca');
  if(busca && document.activeElement !== busca) busca.value = st.busca || '';
  const cab = cols.map(([c, r]) => `<th data-kb-ord="${c}" class="kbOrdenavel${st.col === c ? ' ord' : ''}${c === 'linhas' ? ' num' : ''}">${r}${st.col === c ? `<span class="kbOrdSeta">${st.desc ? '▼' : '▲'}</span>` : ''}</th>`).join('') + '<th aria-label="Ações"></th>';
  const acoes = (l) => String(l.telefone || '').replace(/\D/g, '') ? `<div class="kbLnAcoes"><a class="kbBtn kbBtnP kbBtnIco" title="Ligar pelo ProContact (copia o número)" data-kb-contato="ligar" data-kb-ligar href="#">${KB_ICO.tel}</a><a class="kbBtn kbBtnQ kbBtnIco" title="WhatsApp" data-kb-contato="whatsapp" data-kb-whats href="#">${KB_ICO.wa}</a></div>` : '';
  const linhas = pg.itens.map(l => `<tr data-kb-abrir="${escapeHtml(l.aba)}|${escapeHtml(l.lead_id)}">${cols.map(([c]) => `<td class="kbTd-${c}">${kbCelulaTabela(l, c, agoraMs)}</td>`).join('')}<td class="kbTdAcoes">${acoes(l)}</td></tr>`).join('');
  const botoes = Array.from({ length: pg.total }, (_, i) => i + 1).filter(p => p === 1 || p === pg.total || Math.abs(p - pg.pagina) <= 2)
    .map(p => `<button type="button" class="kbFb${p === pg.pagina ? ' on' : ''}" data-kb-pag="${p}">${p}</button>`).join('');
  document.getElementById('kbTodosTabela').innerHTML = `<table class="kbTabelaTodos${kbEstado.densidade === 'compacto' ? ' kbCompacto' : ''}"><thead><tr>${cab}</tr></thead><tbody>${linhas || `<tr><td colspan="${cols.length + 1}" class="kbMuted">Nenhum lead com esses filtros.</td></tr>`}</tbody></table>
    <div class="kbPaginacao"><span class="kbMeta">${lista.length} leads · Página ${pg.pagina} de ${pg.total}</span>${pg.total > 1 ? botoes : ''}</div>`;
}
document.getElementById('kbTodos').addEventListener('click', (e) => {
  const st = kbEstadoTabela();
  const ct = e.target.closest('[data-kb-contato]');
  if(ct){   // Ligar/WhatsApp na linha não abrem a ficha
    e.preventDefault(); e.stopPropagation();
    const [aba, id] = ct.closest('tr[data-kb-abrir]').dataset.kbAbrir.split('|');
    const l = (kbEstado.todos || []).find(x => x.aba === aba && x.lead_id === id);
    if(l && ct.hasAttribute('data-kb-ligar')) kbLigar(l.telefone);
    if(l && ct.hasAttribute('data-kb-whats')) kbAbrirWhats(l, kbColunaDoLead(l));
    ppSeguro(() => sb.rpc('registrar_contato_lead', { p_aba: aba, p_lead_id: id, p_canal: ct.dataset.kbContato }));
    return;
  }
  const vs = e.target.closest('[data-kb-visao]');
  if(vs){ st.visao = vs.dataset.kbVisao; st.pagina = 1; kbRenderTodos(); return; }
  const th = e.target.closest('th[data-kb-ord]');
  if(th){ const c = th.dataset.kbOrd; if(st.col === c) st.desc = !st.desc; else { st.col = c; st.desc = false; } st.pagina = 1; kbRenderTodos(); return; }
  const pb = e.target.closest('[data-kb-pag]');
  if(pb){ st.pagina = Number(pb.dataset.kbPag); kbRenderTodos(); }
});
```

- [ ] **Step 5: CSS**

Apagar `.kbTodos .kbBusca{…}`, `.kbTabelaTodos tbody tr{cursor:pointer;}` e `.kbTabelaTodos td,.kbTabelaTodos th{white-space:nowrap;}`. No lugar, inserir:

```css
  /* §126.2: Lista — visões prontas e tabela limpa (52 px; 40 no compacto), cabeçalho fixo em tom */
  .kbListaTopo{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-3);}
  .kbVisoes{display:flex;gap:4px;flex-wrap:wrap;}
  .kbVisao{display:inline-flex;align-items:center;gap:7px;border:0;background:none;padding:7px 12px;border-radius:var(--radius-lg);font:inherit;font-size:var(--fs-base);font-weight:600;color:var(--ml-ink-2);cursor:pointer;}
  .kbVisao:hover{background:var(--ml-surface);color:var(--ml-ink);}
  .kbVisao.active{background:var(--ml-ink);color:var(--c-branco);}
  .kbVisao span{color:var(--ml-ink-3);font-weight:600;font-variant-numeric:tabular-nums;}
  .kbVisao.active span{color:var(--c-branco);opacity:.75;}
  .kbListaBusca{margin-left:auto;max-width:360px;height:36px;}
  .kbListaTabela{background:var(--ml-surface);border-radius:var(--radius-lg);overflow:auto;}
  .kbTabelaTodos{width:100%;border-collapse:collapse;}
  .kbTabelaTodos thead th{position:sticky;top:0;z-index:1;background:var(--ml-surface-2);text-align:left;font-size:var(--fs-xs);font-weight:600;color:var(--ml-ink-2);padding:10px 14px;white-space:nowrap;text-transform:none;letter-spacing:0;}
  .kbTabelaTodos thead th.ord{color:var(--ml-ink);}
  .kbOrdSeta{color:var(--c-sinal);margin-left:4px;}
  .kbTabelaTodos th.num,.kbTabelaTodos td.kbTd-linhas{text-align:right;font-variant-numeric:tabular-nums;}
  .kbTabelaTodos tbody td{height:52px;padding:0 14px;border-top:1px solid var(--ml-surface-3);white-space:nowrap;font-size:var(--fs-base);color:var(--ml-ink);}
  .kbTabelaTodos.kbCompacto tbody td{height:40px;}
  .kbTabelaTodos tbody tr{cursor:pointer;transition:background var(--dur-fast);}
  .kbTabelaTodos tbody tr:hover{background:var(--ml-surface-2);}
  .kbTd-nome b{display:block;font-weight:600;}
  .kbTd-nome small,.kbTd-contato small{display:block;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbTabelaTodos.kbCompacto .kbTd-nome small,.kbTabelaTodos.kbCompacto .kbTd-contato small{display:none;}
  .kbEtapa{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbEtapa::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--kb-cor,var(--ml-ink-3));}
  .kbEt-livres{--kb-cor:var(--c-grafite);}
  .kbEt-semlig{--kb-cor:var(--c-bordo);}
  .kbEt-novos{--kb-cor:var(--c-sinal);}
  .kbEt-andamento{--kb-cor:var(--st-andamento);}
  .kbEt-semresp{--kb-cor:var(--st-perdido);}
  .kbEt-convertido{--kb-cor:var(--st-ganho);}
  .kbEt-perdido{--kb-cor:var(--ml-ink-3);}
  .kbTdAcoes{width:80px;}
  .kbLnAcoes{display:flex;gap:4px;justify-content:flex-end;opacity:0;transition:opacity var(--dur-fast);}
  .kbTabelaTodos tbody tr:hover .kbLnAcoes,.kbTabelaTodos tbody tr:focus-within .kbLnAcoes{opacity:1;}
  .kbLnAcoes .kbBtnIco{width:30px;height:30px;}
  .kbMuted{color:var(--ml-ink-3);}
```

- [ ] **Step 6: Rodar**

Run: `node test_meus_leads_fase2.js && node test_leads_painel_hoje.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_meus_leads_redesign.js`
Expected: os cinco com `0 falharam`. Os testes antigos da aba Todos continuam valendo: 50 por página, "Página 1 de 3", "120 leads", `th[data-kb-ord="nome"]`, `data-kb-pag`, `kbTodosBusca`, "60 leads" com filtro e clique na linha.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_meus_leads_fase2.js
git commit -m "feat(meus-leads): Lista no lugar de Todos, com visoes prontas e tabela nova (secao 126.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verificação, revisão, prévia e publicação

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (§126.2), só depois de publicar.

- [ ] **Step 1: Suíte e conferências**
  - Rodar `bash run_tests.sh`.
    - Esperado: as mesmas 6 falhas que já existiam: `test_pedidos_alerta`, `test_producao_filtro_pessoas`, `test_redesign_shell`, `test_projecao_ganho`, `test_proposta_manual_docs` e `test_proposta_timbrada`.
    - O resto passa.
  - Rodar `grep -c "perdidoAberto\|kbNavQuadro\|kbIrColuna" _template.html`. Esperado: `0`.
  - Contar `<div` e `</div>` no `<body>`: têm que dar o mesmo número.
- [ ] **Step 2: Revisão independente.** Um único revisor de contexto novo (modelo mais capaz) olha o branch desde o commit do plano, com este plano, a spec e o Review Focus. Corrigir os itens Critical e Important, cada um com um teste que falha antes.
- [ ] **Step 3: Prévia.**
  - Gerar o painel e montar a prévia: trocar o `<script src=…supabase.js>` por `C:/Users/acer1/Downloads/apex-smart-solutions/.superpowers/meus-leads-redesign/previa_mock.js` e servir pelo companion, na tela nova.
  - Tirar prints do Quadro (com uma coluna recolhida e outra aberta, e com filtro ativo) e da Lista, em 1440×900 e 1366×768, usando `medir.mjs`.
  - Mostrar os prints ao Rafael e pedir o **ok para publicar**.
- [ ] **Step 4: Publicar (só com o ok).**
  1. `git fetch oficial` e juntar o que tiver entrado.
  2. Conferir que o painel do ar é igual ao build da oficial atual (MD5).
  3. Num comando só: MD5 do ar (abortar se mudou), backup `~/deploy_backups/painel_clientes_apex_<data_SP>_antes_meus_leads_redesign_fase2.html`, envio por `scp` e MD5 depois.
  4. `vigia/vigia_painel.ps1 -Aceitar` (na pasta principal).
  5. Conferir no navegador que o painel no ar carrega `kbNaVisao`, sem o `kbNavQuadro`.
- [ ] **Step 5: REGRAS, commit e push.**
  - Escrever a §126.2 no `REGRAS_NEGOCIO.md`, no formato da §126.1:
    - o que mudou no Quadro e na Lista;
    - o que saiu: a barra de atalhos, os selects dos filtros e o nome "Todos";
    - a publicação, com hora, MD5, backup e como voltar atrás.
  - Fazer o commit, `git fetch oficial`, conferir o fast-forward e `git push oficial HEAD:main`, sem force.
  - Atualizar a memória `apex-meus-leads-redesign`.
