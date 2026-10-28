# Meus leads, redesign Fase 1 (ficha nova + Hoje B): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar a aba Hoje pela "ideia B" e levar o Classificar para dentro de uma ficha nova, no visual claro aprovado pelo Rafael em 28/10.
- **Ideia B:** fila à esquerda e ficha aberta ao lado, com "Salvar e ir para o próximo".
- **Classificar:** sai a janela por cima da tela, e ele passa a morar dentro da ficha.

**Architecture:**
- Tudo fica no `_template.html`, como o resto do painel.
- **Ficha:** continua sendo um nó só (`#kbFicha`), e o lugar dele muda conforme a aba:
  - na Hoje, ela é movida para dentro do painel da direita (`#kbHojeFicha`, classe `noPainel`);
  - nas outras abas, volta para a "casa" dela (`#kbFichaCasa`) e abre como gaveta de 560 px;
  - na janela flutuante, continua indo para o PiP, como já acontece.
- **Classificar:** é desenhado pela ficha (`kbClassificarHtml`). Mantém os mesmos ids de antes (`kbClassStatus`, `kbClassObs`…) e salva pelas mesmas RPCs.
- **Fila da Hoje:** é calculada no navegador por uma função pura (`kbFilaHoje`), com os dados que já chegam (`leads_kanban3` + `leads_hoje`).
- **Banco:** nenhuma mudança.

**Tech Stack:** HTML, CSS e JS sem framework, no `_template.html`. O build é `python build_painel.py`. Os testes são `node test_*.js` com jsdom, rodados por `bash run_tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md`, seções 2, 3, 6, 7, 8 e 9. As 5 decisões da seção 9 foram confirmadas pelo Rafael em 28/10.

**Mockups (referência visual, fora do repositório):**
- `.superpowers/brainstorm/395-1793217071/content/06-hoje.html`: a Hoje B, clicável;
- `05-ficha.html`: a ficha;
- `ml.css`: os valores visuais.

## Global Constraints

- **Ponto de partida e branch:**
  - Trabalhar no worktree `.worktrees/meus-leads-redesign` (branch `feat/meus-leads-redesign`, que parte de `oficial/main` 370c762).
  - Antes da Task 1, rodar `git fetch oficial && git merge --ff-only oficial/main`, se houver commits novos. Se não der fast-forward, parar e avisar.
- **Arquivos:** só se edita o `_template.html`. O `painel_clientes_apex.html` é gerado e nunca se edita à mão. Manter LF.
- **O shell não muda:**
  - o bloco "SISTEMA VISUAL SINAL DE ÁPICE" e o menu lateral;
  - `#pageHead`, `ApexMotion`, `mostrarAviso` e `fecharOverlay`.
- **Cores:**
  - só por `var(--…)`;
  - hex novo só nas declarações `--ml-ink-2:#464A4E` e `--ml-surface-2:#F7F7F8`;
  - as linhas `[data-st=…]` da §121 continuam como estão;
  - o único verde é `--st-ganho`, também usado como `--ml-ok`.
- **Tokens da aba**, declarados exatamente assim no começo do bloco CSS de Meus leads:
  `#panel-meusleads,#kbFicha{--ml-ink:var(--c-grafite);--ml-ink-2:#464A4E;--ml-ink-3:var(--c-cinza);--ml-ground:var(--c-papel);--ml-surface:var(--c-branco);--ml-surface-2:#F7F7F8;--ml-surface-3:var(--c-cinza-claro);--ml-late:var(--c-sinal-600);--ml-late-soft:var(--st-perdido-bg);--ml-soon:var(--st-andamento);--ml-soon-soft:var(--st-andamento-bg);--ml-ok:var(--st-ganho);--ml-ok-soft:var(--st-ganho-bg);--ml-novo:var(--c-sinal);--ml-novo-soft:var(--c-rosa);--ml-float:0 12px 32px rgba(29,31,32,.16);}`
- **Texto:**
  - rótulos em frase normal, sem caixa alta pequena com espaçamento;
  - a Barlow Condensed fica só para números grandes, o nome do lead na ficha e a hora da fila;
  - números com `font-variant-numeric:tabular-nums`.
- **Avisos e escape:**
  - avisos só por `mostrarAviso(msg,'ok'|'erro'|'info')`, nunca `alert()`;
  - todo texto que vem do banco passa por `escapeHtml`.
- **Testes com dados fictícios** (o repositório é público):
  - nomes começando com "Zz";
  - telefones `119000000xx`;
  - e-mails `@teste.invalid`;
  - CNPJ `000000000001xx`.
- **Commits** terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Push e publicação só com o ok do Rafael na hora (Task 5).
- **Fora da Fase 1** (fica para as Fases 2 e 3):
  - o cartão e as colunas do Quadro;
  - a tabela da Lista e o nome "Todos" → "Lista";
  - a Equipe;
  - a janela Redistribuir, que continua igual.

## Review Focus

Os cinco casos com mais chance de pegar alguém, e que os testes da spec sozinhos não cobrem:

1. **Lead com campos vazios ou STATUS antigo fora de `leads_status_opcoes`.** A ficha não pode mostrar "undefined" nem "null". O status antigo aparece em texto, e nenhum botão do Classificar fica marcado. → teste na Task 3, Step 1, bloco "RF1".
2. **Nome, OBS ou STATUS com HTML.** Tudo tem que sair escapado na fila, na ficha e nos botões. → testes na Task 3, Step 1 ("RF2") e na Task 4, Step 1 ("RF2-fila").
3. **Erro do banco ao salvar** (rede ou RLS). O consultor fica no mesmo lead, vê "Não foi possível salvar agora" e não perde a OBS digitada. Na Hoje, a fila não avança. → testes na Task 3, Step 1 ("RF3") e na Task 4, Step 1 ("RF3-hoje").
4. **Duplo clique em "Salvar e ir para o próximo" ou Ctrl+Enter duas vezes.** Só pode sair uma chamada de `leads_classificar`. → teste na Task 3, Step 1 ("RF4").
5. **Ficha flutuante (PiP) aberta pela Hoje e troca de aba.** A ficha não pode ser puxada de volta enquanto flutua. Ao fechar a flutuante, ela volta para o lugar certo: o painel da Hoje ou a casa da gaveta. → teste na Task 4, Step 1 ("RF5").

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `_template.html`, CSS de Meus leads (bloco que começa em `/* Meus leads — Kanban (§112…`) | tokens `--ml-*`, botões `.kbBtn*`, `.kbSeg`, `.kbTag`, barra da aba, ficha nova, Hoje B; sai o CSS da Hoje antiga e da janela Classificar |
| `_template.html`, markup do `#panel-meusleads` | barra da aba nova (sai o `.card` com `.kbTopo`), `#kbHoje` com estrutura fixa, `#kbFichaCasa` envolvendo `#kbFicha`, sai o `#kbClassOverlay` |
| `_template.html`, JS de Meus leads (`kb*`) | funções puras novas, `kbFichaHtml` e `kbClassificarHtml`, Classificar dentro da ficha, Hoje B, `kbFichaLugar` |
| `test_meus_leads_redesign.js` (novo) | os testes da Fase 1 |
| `test_leads_kanban.js`, `test_leads_hoje.js`, `test_leads_painel_hoje.js` | ajustes onde a marcação mudou de propósito: janela → ficha, Hoje antiga → Hoje B |
| `REGRAS_NEGOCIO.md` | §126.1, só depois de publicar (Task 5) |

---

### Task 1: Funções puras do redesign

**Files:**
- Create: `test_meus_leads_redesign.js`
- Modify: `_template.html`. Inserir um bloco novo logo **antes** da linha `// Ficha do lead (gaveta lateral). Lead Livre sem dado de contato (consultor) mostra o convite para pegar.`

**Interfaces:**
- Consumes (já existem): `kbMs`, `kbPartesSP`, `kbDiaSP`, `kbSomaDias`, `kbColunaDoLead`, `kbAbertoCol`, `kbDiasParado`, `kbUltimaAcao` e `kbTempoDesde`.
- Produces:
  - `kbStTexto(t: string|null) → string`;
  - `KB_FILA_GRUPOS: [chave, título][]`;
  - `kbFilaHoje(leads, retornos, agoraMs) → Item[]`, em que `Item = { chave:'aba|id', aba, lead_id, nome, grupo:'atrasados'|'agora'|'tarde'|'nunca'|'parados', rotulo, classe:''|'late'|'novo', lead: obj|null }`;
  - `kbProximoHoje(antes: string[], chave: string, depois: string[]) → string|null`;
  - `kbAtalhosRetorno(agoraMs) → {rotulo, data:'AAAA-MM-DD', hora:'HH:MM'}[]`;
  - `kbObsParaSalvar(digitado, anterior) → string`;
  - `kbUrgenciaFicha(l, retorno:{quando,vencido}|null, agoraMs) → {classe, texto}|null`;
  - `kbDataLongaSP(ms) → string`.

- [ ] **Step 1: Criar o arquivo de teste com o mesmo esqueleto dos testes de Meus leads e os testes das funções puras**

Criar `test_meus_leads_redesign.js`:

```js
// Testa o §126.1 (redesign de Meus leads, Fase 1: ficha nova com Classificar dentro + Hoje B).
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
window.alert = (m) => window.__alertas.push(String(m));   // sem ApexMotion no jsdom, mostrarAviso cai aqui
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
  const SP = (s) => Date.parse(s + '-03:00');   // horário de São Paulo
  // ==== Task 1: funções puras ====
  eq([kbStTexto('AGENDADO RETORNO'), kbStTexto('CNPJ INAPTO'), kbStTexto('CLIENTE SÓ QUERIA FIBRA'), kbStTexto(null)],
     ['Agendado retorno', 'CNPJ inapto', 'Cliente só queria fibra', ''], 'STATUS em frase normal, siglas em maiúscula');
  eq(kbDataLongaSP(SP('2026-10-28T15:12:00')), 'Quarta, 28 de outubro · 15:12', 'data longa em SP');
  const ag1 = SP('2026-10-28T15:12:00');   // quarta 15:12
  const LF = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, ultima_ligacao: '2026-10-28T13:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  const L1 = [
    LF('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T15:06:00-03:00' }),
    LF('n2', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T14:00:00-03:00' }),
    LF('s1', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-28T12:40:00-03:00' }),
    LF('s2', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-27T10:00:00-03:00' }),
    LF('p1', { ligacoes: 2, ultima_ligacao: '2026-10-24T10:00:00-03:00', classificado_em: '2026-10-24T10:05:00-03:00' }),
    LF('p2', { ligacoes: 2, ultima_ligacao: '2026-10-26T10:00:00-03:00' }),
    LF('a1', { ligacoes: 3, ultima_ligacao: '2026-10-27T17:40:00-03:00' }),
    LF('r1'), LF('r2'), LF('r3', { ultima_ligacao: '2026-10-26T11:00:00-03:00' }),
    LF('c1', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)' }),
    LF('l1', { livre: true, categoria: 'sem_contato', status: null }),
  ];
  const R1 = [
    { aba: 'O', lead_id: 's1', nome: 'Zz s1', quando: '2026-10-28T18:00:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r2', nome: 'Zz r2', quando: '2026-10-28T16:45:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r1', nome: 'Zz r1', quando: '2026-10-28T15:30:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'a1', nome: 'Zz a1', quando: '2026-10-28T14:00:00-03:00', vencido: true },
    { aba: 'O', lead_id: 'r3', nome: 'Zz r3', quando: '2026-10-27T17:30:00-03:00', vencido: true },
  ];
  const f1 = kbFilaHoje(L1, R1, ag1);
  eq(f1.map(i => i.lead_id), ['r3', 'a1', 'n2', 'n1', 'r1', 'r2', 's1', 's2', 'p1'], 'fila: atrasados → agora (novos, depois retorno da próxima 1 h) → mais tarde → nunca ligados → parados; cada lead uma vez');
  eq(f1.map(i => i.grupo), ['atrasados', 'atrasados', 'agora', 'agora', 'agora', 'tarde', 'tarde', 'nunca', 'parados'], 'grupos da fila');
  eq(f1.map(i => i.rotulo), ['ontem', '14:00', 'novo', 'novo', '15:30', '16:45', '18:00', '—', '4 d'], 'rótulo da coluna da esquerda');
  eq(f1.map(i => i.classe), ['late', 'late', 'novo', 'novo', '', '', '', '', ''], 'cor do rótulo');
  assert(!f1.some(i => ['c1', 'l1', 'p2'].includes(i.lead_id)), 'convertido, livre e parado há só 2 dias ficam fora');
  eq(f1[0].chave, 'O|r3', 'chave aba|id');
  eq(kbFilaHoje([LF('b1')], [{ aba: 'O', lead_id: 'b1', nome: 'Zz b1', quando: '2026-10-28T16:12:00-03:00', vencido: false }], ag1)[0].grupo, 'agora', 'retorno em exatamente 60 min entra em Agora');
  eq(kbFilaHoje([LF('b2')], [{ aba: 'O', lead_id: 'b2', nome: 'Zz b2', quando: '2026-10-28T16:13:00-03:00', vencido: false }], ag1)[0].grupo, 'tarde', 'retorno em 61 min vai para Mais tarde');
  const fora = kbFilaHoje([], [{ aba: 'O', lead_id: 'zz', nome: 'Zz Fora do Quadro', quando: '2026-10-28T09:00:00-03:00', vencido: true }], ag1);
  eq([fora.length, fora[0].nome, fora[0].lead], [1, 'Zz Fora do Quadro', null], 'retorno de lead que não veio no Quadro entra com o nome do retorno');
  eq(kbFilaHoje([LF('t1')], [{ aba: 'O', lead_id: 't1', nome: 'Zz t1', quando: '2026-10-29T10:00:00-03:00', vencido: false }], ag1).length, 0, 'retorno de amanhã não entra');
  eq(kbFilaHoje(null, null, ag1), [], 'sem dados: fila vazia');
  eq([kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd']), kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'b', 'c', 'd']),
      kbProximoHoje(['a', 'b', 'c'], 'c', ['a', 'b']), kbProximoHoje(['a'], 'a', []), kbProximoHoje(['a', 'b'], 'b', ['b']),
      kbProximoHoje(['a', 'b', 'c'], 'b', ['a', 'b'])],
     ['c', 'c', 'a', null, null, 'a'], 'próximo depois de salvar: o seguinte que ainda existe; senão o primeiro que não é o atual');
  const at = kbAtalhosRetorno(ag1);
  eq(at.map(a => a.rotulo), ['Hoje 17h', 'Amanhã 10h', 'Amanhã 14h', 'Em 3 dias', 'Próxima semana'], 'atalhos de retorno às 15:12');
  eq(at.map(a => a.data + ' ' + a.hora), ['2026-10-28 17:00', '2026-10-29 10:00', '2026-10-29 14:00', '2026-10-31 10:00', '2026-11-02 10:00'], 'datas e horas dos atalhos');
  assert(!kbAtalhosRetorno(SP('2026-10-28T17:00:00')).some(a => a.rotulo === 'Hoje 17h'), 'a partir das 17h some o Hoje 17h');
  eq([kbAtalhosRetorno(SP('2026-11-02T09:00:00')).pop().data, kbAtalhosRetorno(SP('2026-11-01T09:00:00')).pop().data], ['2026-11-09', '2026-11-02'], 'próxima semana = próxima segunda');
  eq([kbObsParaSalvar('  ', 'Zz antiga'), kbObsParaSalvar('Zz nova', 'Zz antiga'), kbObsParaSalvar('', null)], ['Zz antiga', 'Zz nova', ''], 'OBS em branco mantém a atual (decisão 1)');
  const u = (l, r) => kbUrgenciaFicha(l, r, ag1);
  eq(u(LF('a1'), { quando: '2026-10-28T14:00:00-03:00', vencido: true }), { classe: 'late', texto: 'retorno era às 14:00' }, 'urgência: retorno vencido hoje');
  eq(u(LF('r3'), { quando: '2026-10-27T17:30:00-03:00', vencido: true }).texto, 'retorno era ontem às 17:30', 'urgência: retorno vencido ontem');
  eq(u(LF('r9'), { quando: '2026-10-25T10:00:00-03:00', vencido: true }).texto, 'retorno era 25/10 às 10:00', 'urgência: retorno vencido há dias');
  eq(u(LF('r1'), { quando: '2026-10-28T15:30:00-03:00', vencido: false }), { classe: 'ok', texto: 'retorno hoje às 15:30' }, 'urgência: retorno hoje');
  eq(u(L1[0], null), { classe: 'novo', texto: 'lead novo · pego há 6 min' }, 'urgência: lead novo');
  eq(u(L1[2], null), { classe: 'soon', texto: 'classificado, mas nunca ligado' }, 'urgência: nunca ligado');
  eq(u(L1[4], null), { classe: 'soon', texto: 'parado há 4 dias' }, 'urgência: parado');
  eq(u(L1[10], null), null, 'convertido sem urgência');
  eq(u(LF('lv', { livre: true, categoria: 'sem_contato', status: null, criado_em_lead: '2026-10-28T14:47:00-03:00' }), null), { classe: 'novo', texto: 'livre · chegou há 25 min' }, 'urgência: livre');
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

Run: `node test_meus_leads_redesign.js`
Expected: `FALHA: ReferenceError: kbStTexto is not defined`

- [ ] **Step 3: Implementar as funções**

Inserir em `_template.html`, imediatamente antes de `// Ficha do lead (gaveta lateral). Lead Livre sem dado de contato (consultor) mostra o convite para pegar.`:

```js
// ===== §126.1 (redesign de Meus leads, Fase 1): funções puras da ficha nova e da Hoje B =====
// STATUS em frase normal, siglas em maiúscula (era o bonito() de dentro do Classificar)
function kbStTexto(t){
  const x = String(t || '').toLowerCase().replace(/\b(cnpj|cpf|neo|mei|pj|pf)\b/g, m => m.toUpperCase()).replace(/\bclaro\b/g, 'Claro');
  return x.charAt(0).toUpperCase() + x.slice(1);
}
const KB_DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const KB_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function kbDataLongaSP(ms){ const p = kbPartesSP(ms); return `${KB_DIAS_SEMANA[p.dow]}, ${Number(p.dia.slice(8, 10))} de ${KB_MESES[Number(p.dia.slice(5, 7)) - 1]} · ${p.hora}`; }
// Fila da Hoje B (spec 3.2): cada lead uma vez, no primeiro grupo em que se encaixa. Só leads em aberto (Meus novos,
// Sem ligação, Em andamento); retorno da Agenda entra mesmo se o lead não veio no Quadro (vale o nome do retorno).
const KB_FILA_GRUPOS = [['atrasados', 'Atrasados'], ['agora', 'Agora'], ['tarde', 'Mais tarde hoje'], ['nunca', 'Nunca ligados'], ['parados', 'Parados há 3 dias ou mais']];
function kbFilaHoje(leads, retornos, agoraMs){
  const meus = (leads || []).filter(l => !l.livre && kbAbertoCol(kbColunaDoLead(l)));
  const porChave = new Map(meus.map(l => [l.aba + '|' + l.lead_id, l]));
  const hoje = kbDiaSP(agoraMs), vistos = new Set(), itens = [];
  const add = (grupo, aba, id, nome, rotulo, classe) => {
    const chave = aba + '|' + id;
    if(vistos.has(chave)) return;
    vistos.add(chave);
    const l = porChave.get(chave) || null;
    itens.push({ chave, aba, lead_id: id, nome: (l && l.nome) || nome || '', grupo, rotulo, classe, lead: l });
  };
  const rets = (retornos || []).map(r => ({ r, t: kbMs(r.quando) })).filter(x => x.t !== null).sort((a, b) => a.t - b.t);
  const pego = (l) => kbMs(l.pego_em || l.criado_em_lead) || 0;
  rets.filter(x => x.r.vencido || x.t <= agoraMs).forEach(({ r, t }) => {
    const dia = kbDiaSP(t);
    const rot = dia === hoje ? kbPartesSP(t).hora : dia === kbSomaDias(hoje, -1) ? 'ontem' : dia.slice(8, 10) + '/' + dia.slice(5, 7);
    add('atrasados', r.aba, r.lead_id, r.nome, rot, 'late');
  });
  meus.filter(l => kbColunaDoLead(l) === 'novos').sort((a, b) => pego(a) - pego(b)).forEach(l => add('agora', l.aba, l.lead_id, l.nome, 'novo', 'novo'));
  const futurosHoje = rets.filter(x => !x.r.vencido && x.t > agoraMs && kbDiaSP(x.t) === hoje);
  futurosHoje.filter(x => x.t <= agoraMs + 3600000).forEach(({ r, t }) => add('agora', r.aba, r.lead_id, r.nome, kbPartesSP(t).hora, ''));
  futurosHoje.filter(x => x.t > agoraMs + 3600000).forEach(({ r, t }) => add('tarde', r.aba, r.lead_id, r.nome, kbPartesSP(t).hora, ''));
  meus.filter(l => kbColunaDoLead(l) === 'semlig').sort((a, b) => pego(a) - pego(b)).forEach(l => add('nunca', l.aba, l.lead_id, l.nome, '—', ''));
  meus.filter(l => (kbDiasParado(l, agoraMs) || 0) >= 3).sort((a, b) => (kbUltimaAcao(a) || 0) - (kbUltimaAcao(b) || 0))
    .forEach(l => add('parados', l.aba, l.lead_id, l.nome, kbDiasParado(l, agoraMs) + ' d', ''));
  return itens;
}
// "Salvar e ir para o próximo": o seguinte (na ordem de antes) que ainda está na fila; senão o primeiro que não é o atual.
function kbProximoHoje(antes, chave, depois){
  const ainda = new Set(depois || []);
  const i = (antes || []).indexOf(chave);
  for(const c of (antes || []).slice(i + 1)) if(c !== chave && ainda.has(c)) return c;
  return (depois || []).find(c => c !== chave) || null;
}
// Atalhos de "Quando ligar de novo?": "Hoje 17h" só antes das 17h; "Próxima semana" = próxima segunda às 10h.
function kbAtalhosRetorno(agoraMs){
  const p = kbPartesSP(agoraMs), hoje = p.dia, amanha = kbSomaDias(hoje, 1);
  const a = [];
  if(p.min < 17 * 60) a.push({ rotulo: 'Hoje 17h', data: hoje, hora: '17:00' });
  a.push({ rotulo: 'Amanhã 10h', data: amanha, hora: '10:00' }, { rotulo: 'Amanhã 14h', data: amanha, hora: '14:00' },
    { rotulo: 'Em 3 dias', data: kbSomaDias(hoje, 3), hora: '10:00' }, { rotulo: 'Próxima semana', data: kbSomaDias(hoje, ((8 - p.dow) % 7) || 7), hora: '10:00' });
  return a;
}
// Decisão 1 do Rafael (28/10): OBS em branco mantém a atual; texto novo substitui (a anterior fica no Histórico).
function kbObsParaSalvar(digitado, anterior){ const t = String(digitado || '').trim(); return t || String(anterior || ''); }
// Marcador do topo da ficha: retorno vencido/de hoje, livre, lead novo, nunca ligado, parado há 3+ dias.
function kbUrgenciaFicha(l, retorno, agoraMs){
  if(!l) return null;
  const t = retorno ? kbMs(retorno.quando) : null, hoje = kbDiaSP(agoraMs);
  if(t !== null){
    const p = kbPartesSP(t);
    if(retorno.vencido || t <= agoraMs){
      const quando = p.dia === hoje ? 'às ' + p.hora : p.dia === kbSomaDias(hoje, -1) ? 'ontem às ' + p.hora : p.dia.slice(8, 10) + '/' + p.dia.slice(5, 7) + ' às ' + p.hora;
      return { classe: 'late', texto: 'retorno era ' + quando };
    }
    if(p.dia === hoje) return { classe: 'ok', texto: 'retorno hoje às ' + p.hora };
  }
  const ha = (iso) => { const x = kbTempoDesde(iso, agoraMs); return x === '—' ? '' : x; };
  if(l.livre){ const x = ha(l.criado_em_lead); return { classe: 'novo', texto: 'livre' + (x ? ' · chegou ' + x : '') }; }
  const col = kbColunaDoLead(l);
  if(col === 'novos'){ const x = ha(l.pego_em || l.criado_em_lead); return { classe: 'novo', texto: 'lead novo' + (x ? ' · pego ' + x : '') }; }
  if(col === 'semlig') return { classe: 'soon', texto: 'classificado, mas nunca ligado' };
  const d = kbAbertoCol(col) ? kbDiasParado(l, agoraMs) : null;
  if(d !== null && d >= 3) return { classe: 'soon', texto: `parado há ${d} dias` };
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_meus_leads_redesign.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---`

- [ ] **Step 5: Commit**

```bash
git add _template.html test_meus_leads_redesign.js
git commit -m "feat(meus-leads): funcoes puras do redesign (fila da Hoje B, atalhos de retorno, urgencia) (secao 126.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tokens, componentes e a barra nova da aba

**Files:**
- Modify: `_template.html`:
  - CSS no começo do bloco de Meus leads (linha `/* Meus leads — Kanban (§112; …) */`);
  - regras `.kbTopo`, `.kbResumo`, `.kbBuscaBox`, `.kbBusca`, `.kbBusca:focus` e `.kbAbas`;
  - markup do topo do `#panel-meusleads`;
  - JS: atalho `/`.
- Test: `test_meus_leads_redesign.js`

**Interfaces:**
- Consumes: `kbTrocarAba`, que já existe e liga a classe `active` em `#kbAbas [data-kb-aba]` e esconde as abas que o perfil não vê.
- Produces:
  - classes CSS `.kbBtn`, `.kbBtnP`, `.kbBtnQ`, `.kbBtnG`, `.kbBtnLg`, `.kbBtnSm`, `.kbBtnIco`, `.kbSeg`, `.kbTag` (com `late`, `soon`, `ok` e `novo`), `.kbN` / `.kbN.hot` e `.kbMaisMenu` / `.kbMaisLista`;
  - os ids de antes continuam valendo: `kbAbas`, `kbBusca`, `kbBuscaRes`, `kbStatus`, `kbResumo`, `kbAviso`, `kbFiltrosGestor`, `kbDono`, `kbSoDiverg`, `kbReescrever`, `kbBadgeHoje` e `kbBadgeEquipe`.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_redesign.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 2: tokens e barra da aba ====
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  assert(css.includes('#panel-meusleads,#kbFicha{--ml-ink:var(--c-grafite);--ml-ink-2:#464A4E;'), 'tokens da aba declarados');
  const stKb = [...document.querySelectorAll('style')].map(s => s.textContent).find(t => t.includes('/* Meus leads — Kanban')) || '';
  const cssKb = stKb.slice(stKb.indexOf('/* Meus leads — Kanban'));   // o bloco de Meus leads vai até o fim desse <style>
  const hexSolto = cssKb.split('\\n').filter(l => /#[0-9a-fA-F]{3,6}\\b/.test(l) && !/^\\s*\\[data-st=/.test(l) && !/--ml-ink-2:#464A4E;.*--ml-surface-2:#F7F7F8;/.test(l));
  eq(hexSolto, [], 'CSS de Meus leads: hex só nos tokens e nas cores de STATUS');
  const seg = document.getElementById('kbAbas');
  assert(seg.classList.contains('kbSeg'), 'abas viram controle segmentado');
  eq([...seg.querySelectorAll('[data-kb-aba]')].map(b => b.dataset.kbAba), ['equipe', 'hoje', 'quadro', 'todos'], 'Equipe primeiro (só o gestor vê)');
  assert(document.querySelector('.kbBarra #kbBusca') && document.querySelector('.kbBarra .kbAtalhoTecla').textContent === '/', 'busca na barra, com o atalho /');
  assert(document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbSoDiverg') && document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbReescrever'), 'Só divergências e Reescrever no menu ⋯ do gestor');
  assert(!document.querySelector('#panel-meusleads .kbTopo'), 'sai o cartão antigo do topo');
  const painel = document.getElementById('panel-meusleads');
  painel.classList.add('active');
  const tecla = (k, alvo) => (alvo || document).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  document.body.focus();
  tecla('/');
  assert(document.activeElement === document.getElementById('kbBusca'), '/ leva para a busca');
  const ta = document.createElement('textarea'); document.body.appendChild(ta); ta.focus();
  tecla('/', ta);
  assert(document.activeElement === ta, '/ dentro de um campo de texto não rouba o foco');
  ta.remove();
  painel.classList.remove('active');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_redesign.js`
Expected: `FALHOU: tokens da aba declarados` (e as asserções seguintes da Task 2)

- [ ] **Step 3: CSS. Tokens e componentes**

Em `_template.html`, logo depois da linha `  /* Meus leads — Kanban (§112; visual refeito em 26/10 à noite a pedido do Rafael). Só tokens do design, nenhuma cor fixa. */`, inserir:

```css
  /* §126 (redesign 28/10, pedido do Rafael): tokens da aba. Hex novo só em --ml-ink-2 e --ml-surface-2; o resto reaproveita o sistema. */
  #panel-meusleads,#kbFicha{--ml-ink:var(--c-grafite);--ml-ink-2:#464A4E;--ml-ink-3:var(--c-cinza);--ml-ground:var(--c-papel);--ml-surface:var(--c-branco);--ml-surface-2:#F7F7F8;--ml-surface-3:var(--c-cinza-claro);--ml-late:var(--c-sinal-600);--ml-late-soft:var(--st-perdido-bg);--ml-soon:var(--st-andamento);--ml-soon-soft:var(--st-andamento-bg);--ml-ok:var(--st-ganho);--ml-ok-soft:var(--st-ganho-bg);--ml-novo:var(--c-sinal);--ml-novo-soft:var(--c-rosa);--ml-float:0 12px 32px rgba(29,31,32,.16);}
  /* §126: botões planos de 8 px (decididos uma vez), controle segmentado, marcadores e contadores */
  .kbBtn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border:0;border-radius:8px;font:inherit;font-size:var(--fs-base);font-weight:600;line-height:1;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast),transform var(--dur-fast);}
  .kbBtn:active{transform:translateY(1px);}
  .kbBtn svg{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
  .kbBtn svg circle{fill:currentColor;}
  .kbBtnP{background:var(--c-sinal);color:var(--c-branco);}
  .kbBtnP:hover{background:var(--c-sinal-600);}
  .kbBtnQ{background:var(--ml-surface-3);color:var(--ml-ink);}
  .kbBtnQ:hover{background:var(--c-linha-forte);}
  .kbBtnG{background:none;color:var(--ml-ink-2);}
  .kbBtnG:hover{background:var(--ml-surface-2);color:var(--ml-ink);}
  .kbBtnLg{height:46px;padding:0 20px;font-size:var(--fs-md);border-radius:10px;}
  .kbBtnSm{height:30px;padding:0 10px;font-size:var(--fs-sm);}
  .kbBtnIco{width:32px;height:32px;padding:0;}
  .kbSeg{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:var(--ml-surface-3);}
  .kbSeg button{display:inline-flex;align-items:center;gap:7px;border:0;background:none;padding:7px 14px;border-radius:8px;font:inherit;font-size:var(--fs-base);font-weight:600;color:var(--ml-ink-2);cursor:pointer;transition:background var(--dur-fast),color var(--dur-fast);}
  .kbSeg button:hover{color:var(--ml-ink);}
  .kbSeg button.active{background:var(--ml-surface);color:var(--ml-ink);box-shadow:var(--shadow-sm);}
  .kbTag{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:var(--fs-xs);font-weight:600;white-space:nowrap;background:var(--ml-surface-2);color:var(--ml-ink-2);}
  .kbTag svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;}
  .kbTag.late{background:var(--ml-late-soft);color:var(--ml-late);}
  .kbTag.soon{background:var(--ml-soon-soft);color:var(--ml-soon);}
  .kbTag.ok{background:var(--ml-ok-soft);color:var(--ml-ok);}
  .kbTag.novo{background:var(--ml-novo-soft);color:var(--ml-novo);}
  .kbN{min-width:20px;padding:0 6px;border-radius:999px;background:var(--ml-surface-2);color:var(--ml-ink-2);font-size:var(--fs-xs);font-weight:700;line-height:18px;text-align:center;}
  .kbN:empty{display:none;}
  .kbN.hot{background:var(--c-sinal);color:var(--c-branco);}
  .kbMaisMenu{position:relative;display:inline-block;}
  .kbMaisMenu > summary{list-style:none;}
  .kbMaisMenu > summary::-webkit-details-marker{display:none;}
  .kbMaisLista{position:absolute;right:0;top:calc(100% + 4px);min-width:210px;padding:6px;border-radius:12px;background:var(--ml-surface);box-shadow:var(--ml-float);z-index:5;display:flex;flex-direction:column;gap:2px;}
  .kbMaisLista .kbBtn,.kbMaisLista .filterPill{justify-content:flex-start;width:100%;}
  .kbPerigo{color:var(--c-sinal-600);}
  /* §126: barra da aba (sub-abas, busca com "/", seletor de consultor e menu ⋯ do gestor) */
  .kbBarra{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2);}
  .kbBarra .kbBuscaBox{margin-left:auto;flex:1 1 280px;max-width:460px;}
  .kbBarra .kbBusca{height:38px;padding:0 36px;}
  .kbBuscaIco{position:absolute;left:12px;top:11px;width:16px;height:16px;stroke:var(--ml-ink-3);fill:none;stroke-width:2;pointer-events:none;}
  .kbAtalhoTecla{position:absolute;right:10px;top:9px;padding:1px 6px;border-radius:5px;background:var(--ml-surface-2);color:var(--ml-ink-3);font-size:11px;font-weight:600;pointer-events:none;}
  .kbDono{height:38px;border:0;border-radius:10px;background:var(--ml-surface);padding:0 12px;font:inherit;font-weight:600;color:var(--ml-ink);}
  .kbStatusLinha{font-size:var(--fs-xs);color:var(--ml-ink-3);}
```

Trocar as regras antigas:
- `  .kbTopo{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--space-3);flex-wrap:wrap;}` → **apagar a linha**.
- `  .kbFiltros{display:flex;gap:var(--space-2);align-items:flex-end;flex-wrap:wrap;}` → `  .kbFiltros{display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;}`
- `  .kbResumo{display:flex;gap:var(--space-6);flex-wrap:wrap;margin-top:var(--space-3);font-size:var(--fs-sm);color:var(--muted);}` → `  .kbResumo{display:flex;gap:var(--space-6);flex-wrap:wrap;margin:0 0 var(--space-3);font-size:var(--fs-sm);color:var(--ml-ink-2);}`
- `  .kbResumo strong{font-family:var(--font-head);font-size:var(--fs-lg);font-weight:700;color:var(--c-grafite);margin-right:6px;}` → `  .kbResumo strong{font-family:var(--font-head);font-size:var(--fs-lg);font-weight:700;color:var(--ml-ink);margin-right:6px;font-variant-numeric:tabular-nums;}`
- `  .kbBuscaBox{position:relative;flex:1 1 320px;max-width:520px;}` (fica como está).
- `  .kbBusca{width:100%;padding:10px 14px;border:1px solid var(--c-linha-forte);border-radius:var(--radius-lg);font:inherit;font-size:var(--fs-base);background:var(--c-branco);}` → `  .kbBusca{width:100%;padding:10px 14px;border:0;border-radius:10px;font:inherit;font-size:var(--fs-base);background:var(--ml-surface);color:var(--ml-ink);}`
- `  .kbAbas{margin-top:var(--space-3);}` → **apagar a linha**.

- [ ] **Step 4: Markup da barra**

Em `_template.html`, trocar o bloco que começa em `    <section class="panel" id="panel-meusleads">` e vai até a linha `      </div>` logo depois de `        <div class="kbAviso" id="kbAviso" style="display:none"></div>` (o `.card` inteiro com `.kbTopo` e `#kbAbas`) por:

```html
    <section class="panel" id="panel-meusleads">
      <div class="kbBarra">
        <nav class="kbSeg" id="kbAbas" aria-label="Visões de Meus leads">
          <button type="button" data-kb-aba="equipe">Equipe <span class="kbBadge" id="kbBadgeEquipe"></span></button>
          <button type="button" data-kb-aba="hoje">Hoje <span class="kbBadge" id="kbBadgeHoje"></span></button>
          <button type="button" data-kb-aba="quadro">Quadro</button>
          <button type="button" data-kb-aba="todos">Todos</button>
        </nav>
        <span class="kbStatusLinha" id="kbStatus"></span>
        <div class="kbBuscaBox"><svg class="kbBuscaIco" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" id="kbBusca" class="kbBusca" placeholder="Buscar lead por nome, CNPJ ou telefone" autocomplete="off" aria-label="Buscar lead"><span class="kbAtalhoTecla" aria-hidden="true">/</span><div class="kbBuscaRes" id="kbBuscaRes"></div></div>
        <div class="kbFiltros" id="kbFiltrosGestor" style="display:none">
          <select id="kbDono" class="kbDono" aria-label="Consultor"></select>
          <details class="kbMaisMenu"><summary class="kbBtn kbBtnG kbBtnIco" title="Mais opções" aria-label="Mais opções"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg></summary>
            <div class="kbMaisLista"><button type="button" class="filterPill" id="kbSoDiverg">Só divergências</button><button type="button" class="kbBtn kbBtnG kbBtnSm" id="kbReescrever" style="display:none">Reescrever planilha</button></div></details>
        </div>
      </div>
      <div class="kbResumo" id="kbResumo"></div>
      <div class="kbAviso" id="kbAviso" style="display:none"></div>
```

(O que vem depois, a partir de `      <div id="kbHoje" …`, continua igual nesta task.)

- [ ] **Step 5: JS. Atalho "/"**

Em `_template.html`, logo depois da linha `document.addEventListener('click', (e) => { if(!e.target.closest('.kbBuscaBox')) document.getElementById('kbBuscaRes').style.display = 'none'; });`, inserir:

```js
// §126: "/" leva à busca de Meus leads (fora de campo de texto e só com a aba à vista)
document.addEventListener('keydown', (e) => {
  if(e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const a = document.activeElement;
  if(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
  const p = document.getElementById('panel-meusleads');
  if(!p || !p.classList.contains('active')) return;
  e.preventDefault();
  document.getElementById('kbBusca').focus();
});
```

- [ ] **Step 6: Rodar os testes**

Run: `node test_meus_leads_redesign.js && node test_leads_kanban.js && node test_leads_hoje.js && node test_leads_painel_hoje.js`
Expected: os quatro terminam com `0 falharam`. Os testes antigos não dependem do `.card` do topo, só dos ids, que continuam os mesmos.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_meus_leads_redesign.js
git commit -m "feat(meus-leads): tokens da aba, botoes planos e barra nova com busca e atalho / (secao 126.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Ficha nova com o Classificar dentro (sai a janela)

**Files:**
- Modify `_template.html`:
  - **markup:** apagar o `<div class="overlay" id="kbClassOverlay">…</div>` inteiro e envolver o `<aside class="kbFicha" …>` com `<div id="kbFichaCasa">…</div>`;
  - **CSS:** regras da ficha e do Classificar;
  - **JS:** trocar `kbFichaHtml`, `kbAbrirFicha`, `kbAbrirClassificar`, `kbClassAjustar`, `kbSalvarClassificacao`, `kbCarregarDetalhes` e o listener de clique da ficha;
  - **JS, apagar:** `kbRetornoRapido` e os listeners da janela antiga;
  - **JS, cliques:** a lista de navegação nos cliques do Quadro e da tabela Todos;
  - **JS, retorno:** `kbPegar` passa a devolver true ou false.
- Modify: `test_leads_kanban.js`, `test_leads_hoje.js` e `test_leads_painel_hoje.js` (só onde a janela foi usada).
- Test: `test_meus_leads_redesign.js`

**Interfaces:**
- Consumes (Task 1): `kbStTexto`, `kbAtalhosRetorno`, `kbObsParaSalvar` e `kbUrgenciaFicha`.
- Produces:
  - `kbFichaHtml(f, op) → string`, com `op = { gestor, agoraMs, flutuando, podePegar, opcoes, grupo, naHoje, pos, total, retorno }`;
  - `kbClassificarHtml(f, opcoes, op:{grupo, agoraMs}) → string`;
  - `kbAbrirFicha(aba, id, opc?:{lista?:string[]|null, grupo?:string}) → Promise`;
  - `kbAbrirClassificar(aba, id, grupo) → Promise`, que agora abre a ficha;
  - `kbSalvarClassificacao(opc?:{proximo?:boolean}) → Promise<boolean>`;
  - `kbFichaSuja() → boolean`;
  - `kbFichaMover(d:-1|1)`;
  - `kbFichaTrocarAba(nome)`;
  - `kbClassEscolher(status)`;
  - `kbEstado.fichaLista`, `kbEstado.salvando`;
  - o ponto de extensão `kbDepoisDeSalvar(alvo, opc)`, que a Task 4 usa para avançar a fila da Hoje;
  - ids dentro da ficha:
    - formulário: `kbClassStatus` (select escondido), `kbClassGrupos`, `kbClassRetornoBox`, `kbClassRetorno`, `kbClassHora`, `kbClassVenda`, `kbClassReceita`, `kbClassConverteu`, `kbClassNeo`, `kbClassObs` e `kbClassErro`;
    - botões de salvar: `kbClassSalvar`, mais `kbClassSalvarProx` quando `op.naHoje`;
    - detalhes: `kbFichaResumo`, `kbLinhaTempo`, `kbFichaUltimos` e `kbFichaAnuncio`.

- [ ] **Step 1: Escrever os testes novos**

Em `test_meus_leads_redesign.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 3: ficha nova com Classificar dentro ====
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const F3 = { aba: 'OUTUBRO', lead_id: 'f3', nome: 'Zz Padaria', cidade: 'Campinas', uf: 'SP', qtd_linhas: '6', tipo_empresa: 'MEI', telefone: '11900000031',
    email: 'zz@teste.invalid', cnpj: '00000000000131', status: 'AGENDADO RETORNO', categoria: 'andamento', obs: 'Zz ligar depois do almoço', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_nome: 'Zzkcon Teste', ligacoes: 3 };
  const h3 = kbFichaHtml(F3, { gestor: false, agoraMs: ag1, opcoes: OPC, retorno: { quando: '2026-10-28T14:00:00-03:00', vencido: true } });
  ['Zz Padaria', '(11) 90000-0031', 'zz@teste.invalid', '00000000000131', 'MEI · 6 linhas · Campinas/SP', 'Zz Campanha', 'Zz ligar depois do almoço', 'retorno era às 14:00', 'Agendado retorno']
    .forEach(x => assert(h3.includes(x), 'ficha nova mostra ' + x));
  assert(h3.includes('data-kb-ficha-aba="classificar"') && h3.includes('data-kb-ficha-pane="historico"') && h3.includes('data-kb-ficha-pane="anuncio"'), 'abas Classificar · Histórico · Anúncio');
  assert(h3.includes('id="kbClassStatus"') && h3.includes('data-kb-status="CNPJ INAPTO"') && h3.includes('Sem resposta ou perdido') && h3.includes('Venda'), 'Classificar dentro da ficha, com os grupos renomeados');
  assert(h3.includes('class="kbStatusChip kbSt ativo" data-st="agendado-retorno"'), 'status atual já vem marcado');
  assert(h3.includes('id="kbClassSalvar"') && !h3.includes('kbClassSalvarProx'), 'na gaveta o botão é só Salvar');
  assert(kbFichaHtml(F3, { gestor: false, agoraMs: ag1, opcoes: OPC, naHoje: true }).includes('id="kbClassSalvarProx"'), 'na Hoje tem Salvar e ir para o próximo');
  assert(!h3.includes('kbMaisMenu') && kbFichaHtml(F3, { gestor: true, agoraMs: ag1, opcoes: OPC }).includes('data-kb-ficha-redistribuir'), 'menu ⋯ (Redistribuir, Apagar) só para o gestor');
  const hLivre = kbFichaHtml({ aba: 'O', lead_id: 'lv', nome: 'Zz Livre', livre: true, categoria: 'sem_contato', qtd_linhas: '10', campanha: 'Zz Camp' }, { gestor: false, agoraMs: ag1, podePegar: true, opcoes: OPC });
  assert(hLivre.includes('data-kb-ficha-pegar') && hLivre.includes('aparecem quando você pega o lead') && !hLivre.includes('kbClassStatus'), 'livre: prévia com Pegar e sem Classificar');
  // RF1: campos vazios e STATUS antigo
  const hVazio = kbFichaHtml({ aba: 'O', lead_id: 'v', nome: null, livre: false, categoria: 'andamento', status: 'STATUS ANTIGO QUALQUER' }, { gestor: false, agoraMs: ag1, opcoes: OPC });
  assert(!/undefined|>null</.test(hVazio) && hVazio.includes('Status antigo qualquer') && !hVazio.includes('kbSt ativo'), 'RF1: sem undefined/null; status antigo em texto e nenhum botão marcado');
  // RF2: HTML no nome, OBS e STATUS
  const hX = kbFichaHtml({ aba: 'O', lead_id: 'x', nome: '<img src=x onerror=alert(1)>', obs: '<script>zz</script>', status: '<b>zz</b>', livre: false, categoria: 'andamento', telefone: '11900000032' }, { gestor: false, agoraMs: ag1, opcoes: OPC });
  assert(!hX.includes('<img') && !hX.includes('<script>') && !hX.includes('<b>zz'), 'RF2: ficha escapa nome, OBS e status');
  // tela: abrir pelo arraste destaca o grupo e não salva nada
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F3, { lead_id: 'f3' }), Object.assign({}, F3, { lead_id: 'f4', nome: 'Zz Segundo', status: null, categoria: 'sem_contato' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F3, { lead_id: a.p_id, nome: a.p_id === 'f4' ? 'Zz Segundo' : 'Zz Padaria' })], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: { campanha: 'Zz Camp', conjunto: 'Zz Conj' }, resumo: { ligacoes: 3, atendidas: 1, cliques: 0, ultimo: new Date().toISOString() },
    eventos: [{ em: new Date().toISOString(), tipo: 'ligacao', titulo: 'Ligação não atendida', quem: 'zz.usuario' }] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const nClass0 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  await kbAbrirClassificar('OUTUBRO', 'f3', 'perdido');
  const ficha = document.getElementById('kbFicha');
  assert(ficha.classList.contains('aberta') && ficha.querySelector('[data-kb-grupo="perdido"]').classList.contains('kbDestaque'), 'arrastar para Perdido abre a ficha com o grupo de perda em destaque');
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length, nClass0, 'abrir pelo arraste não salva nada');
  assert(document.getElementById('kbFichaResumo').textContent.includes('3 tentativas') && document.getElementById('kbFichaAnuncio').textContent.includes('Zz Conj'), 'resumo e anúncio carregados');
  ficha.querySelector('[data-kb-ficha-aba="historico"]').click();
  assert(!ficha.querySelector('[data-kb-ficha-pane="historico"]').hidden && ficha.querySelector('[data-kb-ficha-pane="classificar"]').hidden, 'trocar para a aba Histórico');
  ficha.querySelector('[data-kb-ficha-aba="classificar"]').click();
  // escolher status mostra os blocos certos
  ficha.querySelector('[data-kb-status="PEDIDO CONCLUIDO (VENDA)"]').click();
  assert(document.getElementById('kbClassVenda').style.display !== 'none' && document.getElementById('kbClassRetornoBox').style.display === 'none', 'venda mostra Receita/Converteu');
  document.getElementById('kbClassRetorno').value = '';
  ficha.querySelector('[data-kb-status="AGENDADO RETORNO"]').click();
  assert(document.getElementById('kbClassRetornoBox').style.display !== 'none' && document.getElementById('kbClassRetorno').value === kbSomaDias(kbDiaSP(Date.now()), 1), 'retorno vem em Amanhã 10h');
  [...ficha.querySelectorAll('[data-kb-ret-data]')].find(b => b.textContent === 'Em 3 dias').click();
  eq([document.getElementById('kbClassRetorno').value, document.getElementById('kbClassHora').value], [kbSomaDias(kbDiaSP(Date.now()), 3), '10:00'], 'atalho Em 3 dias preenche data e hora');
  // OBS em branco mantém a anterior; Ctrl+Enter salva
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_agendar_retorno = { data: null, error: null };
  ficha.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await espera(80);
  const c3 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop();
  eq([c3.args.p_id, c3.args.p_status, c3.args.p_obs], ['f3', 'AGENDADO RETORNO', 'Zz ligar depois do almoço'], 'Ctrl+Enter salva; OBS em branco mantém a anterior');
  assert(/T10:00:00-03:00$/.test(window.__rpcCalls.filter(c => c.nome === 'leads_agendar_retorno').pop().args.p_quando), 'retorno com a hora escolhida');
  assert(document.getElementById('kbFicha').classList.contains('aberta') && document.getElementById('kbClassObs').value === '', 'depois de salvar a ficha reabre com a OBS em branco');
  // RF3: erro do banco não perde a OBS
  window.__rpcRespostas.leads_classificar = { data: null, error: { message: 'rede' } };
  document.getElementById('kbClassStatus').value = 'EM NEGOCIAÇÂO';
  document.getElementById('kbClassObs').value = 'Zz texto que não pode sumir';
  const ok3 = await kbSalvarClassificacao();
  assert(ok3 === false && document.getElementById('kbClassErro').textContent.includes('Não foi possível salvar agora') && document.getElementById('kbClassObs').value === 'Zz texto que não pode sumir', 'RF3: erro avisa e mantém a OBS');
  // RF4: dois cliques seguidos = uma chamada só
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  const n4 = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  await Promise.all([kbSalvarClassificacao(), kbSalvarClassificacao()]);
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length - n4, 1, 'RF4: duplo salvar chama o banco uma vez');
  // setas trocam de lead na lista de onde a ficha veio; Esc fecha a gaveta
  await kbAbrirFicha('OUTUBRO', 'f3', { lista: ['OUTUBRO|f3', 'OUTUBRO|f4'] });
  assert(document.getElementById('kbFicha').textContent.includes('1 de 2'), 'posição na lista');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  document.getElementById('panel-meusleads').classList.add('active');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'f4' && document.getElementById('kbFicha').textContent.includes('Zz Segundo'), 'seta para baixo abre o próximo da lista');
  document.getElementById('kbClassObs').value = 'Zz pendente';
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'f4', 'com OBS digitada a seta não troca de lead');
  document.getElementById('kbClassObs').value = '';
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!document.getElementById('kbFicha').classList.contains('aberta'), 'Esc fecha a gaveta');
  document.getElementById('panel-meusleads').classList.remove('active');
  assert(!document.getElementById('kbClassOverlay'), 'a janela Classificar saiu do painel');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_redesign.js`
Expected: falhas a partir de `ficha nova mostra MEI · 6 linhas · Campinas/SP`. A ficha antiga não tem abas, grupos renomeados nem `kbClassStatus`.

- [ ] **Step 3: Markup**

Em `_template.html`, apagar o bloco inteiro que começa em `    <div class="overlay" id="kbClassOverlay">` e termina no `    </div>` que fecha esse overlay, logo antes de `    <aside class="kbFicha" id="kbFicha" …>`. Depois, trocar a linha:

```html
    <aside class="kbFicha" id="kbFicha" aria-label="Ficha do lead"><div class="kbFichaCorpo" id="kbFichaCorpo"></div></aside>
```

por:

```html
    <div id="kbFichaCasa"><aside class="kbFicha" id="kbFicha" aria-label="Ficha do lead"><div class="kbFichaCorpo" id="kbFichaCorpo"></div></aside></div>
```

Conferir o equilíbrio: `grep -c "<div" _template.html` e `grep -c "</div>" _template.html` têm que mudar o mesmo tanto em relação ao commit anterior (memória "divs balanceadas").

- [ ] **Step 4: CSS da ficha nova**

Em `_template.html`, no bloco de Meus leads:

1. `  #kbClassOverlay,#kbRedOverlay{backdrop-filter:none;}` → `  #kbRedOverlay{backdrop-filter:none;}`
2. `  .kbClassRotulo{display:block;font-family:var(--font-head);font-size:var(--fs-sm);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:var(--space-2);}` → `  .kbClassRotulo{display:block;font-size:var(--fs-xs);font-weight:600;color:var(--ml-ink-2,var(--muted));margin-bottom:var(--space-2);}`
3. `  .kbClassBloco{background:var(--c-papel);border:1px solid var(--c-linha);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-4);}` → `  .kbClassBloco{background:var(--ml-surface-2,var(--c-papel));border-radius:12px;padding:var(--space-3) 14px;margin:var(--space-1) 0 14px;}`
4. Apagar as linhas `.kbFichaFlutuar{…}`, `.kbFichaFlutuar:hover{…}`, `.kbFicha.flutuante{…}`, `.kbFicha{…}`, `.kbFicha.aberta{…}`, `.kbFichaCorpo{…}`, `.kbFichaFechar{…}`, `.kbFichaCab{…}`, `.kbFichaCab h3{…}`, `.kbFichaAcoes{…}`. Ficam `.kbFicha a.btn,.kbIcone{…}`, `.kbFichaSecao h5`, `.kbFichaLinha*`, `.kbFichaBotoes`, `.kbFichaAviso` e `.kbApagarBox*`. No lugar das linhas apagadas, inserir:

```css
  /* §126: ficha nova — gaveta de 560 px presa à direita, rodapé fixo; na Hoje vira o painel da direita (.noPainel) */
  .kbFicha{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--ml-surface);z-index:45;transform:translateX(100%);transition:transform var(--dur) var(--ease-out);display:flex;flex-direction:column;}
  .kbFicha.aberta{transform:none;box-shadow:var(--ml-float);}
  .kbFicha.flutuante{position:static;transform:none;width:auto;height:100vh;box-shadow:none;}
  .kbFicha.noPainel{position:static;transform:none;width:auto;height:100%;min-height:0;box-shadow:none;z-index:auto;transition:none;}
  .kbFicha[hidden]{display:none;}
  .kbFichaCorpo{display:flex;flex-direction:column;min-height:0;height:100%;}
  .kbFichaRolagem{flex:1;min-height:0;overflow-y:auto;padding:var(--space-4) var(--space-6) var(--space-3);}
  .kbFichaBarra{display:flex;align-items:center;gap:4px;margin-bottom:var(--space-2);}
  .kbFichaPos{margin-right:auto;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .noPainel [data-kb-ficha-fechar]{display:none;}
  .kbFichaNome{margin:var(--space-2) 0 0;font:700 30px/1.05 var(--font-head);color:var(--ml-ink);}
  .kbFichaSub{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-3);align-items:center;margin-top:var(--space-2);font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbFichaContato{margin-top:var(--space-4);padding:var(--space-3) var(--space-4);border-radius:14px;background:var(--ml-surface-2);}
  .kbFichaTel{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;}
  .kbFichaTel strong{font:600 24px/1 var(--font-head);letter-spacing:.01em;font-variant-numeric:tabular-nums;color:var(--ml-ink);}
  .kbFichaTel .kbBtnQ{background:var(--ml-surface);}
  .kbFichaDir{margin-left:auto;display:flex;gap:6px;}
  .kbFichaOutros{display:grid;grid-template-columns:auto 1fr auto;gap:4px var(--space-3);align-items:center;margin-top:var(--space-3);font-size:var(--fs-sm);}
  .kbFichaOutros span{color:var(--ml-ink-3);}
  .kbFichaOutros b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ml-ink);}
  .kbFichaResumo{margin:var(--space-2) 2px 0;font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbObsAnt{margin:var(--space-3) 0 0;padding:var(--space-3) 14px;border-radius:10px;background:var(--ml-surface-2);font-size:var(--fs-base);line-height:1.5;color:var(--ml-ink);white-space:pre-wrap;}
  .kbObsAnt small{display:block;font-size:var(--fs-xs);color:var(--ml-ink-3);margin-bottom:3px;}
  .kbFichaAbas{margin:var(--space-4) 0 var(--space-3);}
  .kbComoFoi{margin:0 0 var(--space-2);font-size:var(--fs-md);font-weight:600;color:var(--ml-ink);}
  .kbFichaTravado{margin-top:var(--space-4);padding:var(--space-4);border-radius:14px;background:var(--ml-surface-2);display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;}
  .kbFichaTravado p{margin:0;flex:1;min-width:220px;color:var(--ml-ink-2);}
  .kbFichaUltimos{margin-top:var(--space-4);}
  .kbFichaUltimos h4{margin:0 0 var(--space-2);font-size:var(--fs-base);font-weight:600;}
  .kbFichaRodape{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-6);box-shadow:0 -1px 0 var(--ml-surface-3);background:var(--ml-surface);}
  .kbFichaRodape .kbMeta{margin:0 0 0 auto;}
  .kbClassGrupo.kbG-perdido .kbStatusChip.kbSt:not(.ativo){background:var(--ml-surface-2);color:var(--ml-ink-2);box-shadow:none;font-weight:500;}
  .kbClassGrupo.kbDestaque{padding:var(--space-2);margin-left:calc(-1 * var(--space-2));border-radius:12px;box-shadow:inset 0 0 0 2px var(--c-sinal);}
  .kbAtalhos .kbAtalho{border:0;border-radius:8px;padding:6px 10px;background:var(--ml-surface);font:inherit;font-size:var(--fs-sm);font-weight:600;color:var(--ml-ink);cursor:pointer;}
  .kbAtalhos .kbAtalho.ativo{background:var(--ml-ink);color:var(--c-branco);}
  .kbClass .field textarea{width:100%;border:1px solid var(--c-linha);border-radius:10px;padding:9px 12px;font:inherit;resize:vertical;}
  @media (prefers-reduced-motion: reduce){ .kbFicha{transition:none;} }
```

- [ ] **Step 5: JS. `kbFichaHtml` e `kbClassificarHtml`**

Em `_template.html`, trocar a função `kbFichaHtml` inteira (de `function kbFichaHtml(f, op){` até o `}` antes da linha em branco que antecede `const kbEstado = {`) por:

```js
// §126: ícones da ficha (traço de 2 px, mesmo desenho do mockup aprovado)
const KB_ICO = {
  tel: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 1a4 4 0 0 1-2.5-2.5l1-1-1-2z"/></svg>',
  copiar: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  cima: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  baixo: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  pip: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/></svg>',
  mais: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  fechar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  relogio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  mao: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-6a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L4 14.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/></svg>',
  seta: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
// §126: o Classificar mora dentro da ficha (sai a janela). Os ids são os de antes; o select escondido guarda a escolha.
const KB_GRUPO_ROTULO = { andamento: 'Em andamento', convertido: 'Venda', perdido: 'Sem resposta ou perdido' };
function kbClassificarHtml(f, opcoes, op){
  const o = op || {}, ops = kbOpcoesDoGrupo(opcoes, null);
  const atual = f.status && ops.some(x => x.status === f.status) ? f.status : '';
  const grupoAtual = (ops.find(x => x.status === atual) || {}).grupo || '';
  const select = `<select id="kbClassStatus" class="kbOculto" aria-hidden="true" tabindex="-1"><option value="">Escolha…</option>${ops.map(x => `<option value="${escapeHtml(x.status)}"${x.status === atual ? ' selected' : ''}>${escapeHtml(x.status)}</option>`).join('')}</select>`;
  const grupos = ['andamento', 'convertido', 'perdido'].map(g => {
    const doG = ops.filter(x => x.grupo === g);
    return doG.length ? `<div class="kbClassGrupo kbG-${g}${o.grupo === g ? ' kbDestaque' : ''}" data-kb-grupo="${g}"><span class="kbClassRotulo">${KB_GRUPO_ROTULO[g]}</span><div class="kbStatusChips">${doG.map(x =>
      `<button type="button" class="kbStatusChip kbSt${x.status === atual ? ' ativo' : ''}" data-st="${escapeHtml(kbStSlug(x.status))}" data-kb-status="${escapeHtml(x.status)}">${escapeHtml(kbStTexto(x.status))}</button>`).join('')}</div></div>` : '';
  }).join('');
  const atalhos = kbAtalhosRetorno(o.agoraMs || Date.now()).map(a => `<button type="button" class="kbAtalho" data-kb-ret-data="${a.data}" data-kb-ret-hora="${a.hora}">${a.rotulo}</button>`).join('');
  const retData = f.retorno_em ? String(f.retorno_em).slice(0, 10) : '';
  const receita = f.receita ? String(f.receita).replace('.', ',') : (f.receita_neo ? String(f.receita_neo).replace('.', ',') : '');
  return `<div class="kbClass" id="kbClassForm">${select}
    <p class="kbComoFoi">Como foi?</p>
    <div class="kbClassGrupos" id="kbClassGrupos">${grupos}</div>
    <div class="kbClassBloco" id="kbClassRetornoBox" style="display:${atual === 'AGENDADO RETORNO' ? '' : 'none'}"><span class="kbClassRotulo">Quando ligar de novo?</span>
      <div class="kbAtalhos">${atalhos}</div>
      <div class="kbRetornoCampos"><label class="field"><span>Data</span><input type="date" id="kbClassRetorno" value="${escapeHtml(retData)}"></label><label class="field"><span>Hora</span><input type="time" id="kbClassHora" value="10:00"></label></div></div>
    <div class="kbClassBloco" id="kbClassVenda" style="display:${grupoAtual === 'convertido' ? '' : 'none'}"><span class="kbClassRotulo">Venda</span>
      <div class="kbVendaCampos"><label class="field"><span>Receita (R$)</span><input type="text" id="kbClassReceita" inputmode="decimal" placeholder="0,00" value="${escapeHtml(receita)}"></label>
      <label class="kbCheck"><input type="checkbox" id="kbClassConverteu"${f.converteu || f.venda_neo ? ' checked' : ''}> Converteu</label></div>
      <p class="desc" id="kbClassNeo">${f.venda_neo ? 'O NEO tem venda neste CNPJ — conferido e pré-preenchido.' : ''}</p></div>
    <label class="field kbClassObs"><span>OBS</span><textarea id="kbClassObs" rows="3" placeholder="O que o cliente disse e o próximo passo"></textarea></label>
    <p class="desc kbClassErro" id="kbClassErro"></p>
  </div>`;
}
// §126: ficha nova (spec 3.1). op = { gestor, agoraMs, flutuando, podePegar, opcoes, grupo, naHoje, pos, total, retorno }.
function kbFichaHtml(f, op){
  const o = op || {}, agoraMs = o.agoraMs || Date.now();
  const v = (x) => escapeHtml(x == null || x === '' ? '—' : String(x));
  const tel = String(f.telefone || '').replace(/\D/g, '');
  const local = [f.cidade, f.uf].filter(Boolean).join('/');
  const div = kbDivergencia(f), col = kbColunaDoLead(f);
  const semContato = f.livre && !tel && !f.email && !f.cnpj;
  const urg = kbUrgenciaFicha(f, o.retorno || null, agoraMs);
  const pos = `<span class="kbFichaPos">${o.total ? `${o.pos} de ${o.total}${o.naHoje ? ' na sua fila' : ''}` : ''}</span>`;
  const setas = o.total ? `<button type="button" class="kbBtn kbBtnG kbBtnIco" data-kb-ficha-mover="-1" title="Lead anterior (↑)" aria-label="Lead anterior">${KB_ICO.cima}</button><button type="button" class="kbBtn kbBtnG kbBtnIco" data-kb-ficha-mover="1" title="Próximo lead (↓)" aria-label="Próximo lead">${KB_ICO.baixo}</button>` : '';
  const flutuar = o.flutuando ? '' : `<button type="button" class="kbBtn kbBtnG kbBtnIco" data-kb-ficha-flutuar title="Deixar a ficha por cima do ProContact" aria-label="Flutuar">${KB_ICO.pip}</button>`;
  const mais = o.gestor ? `<details class="kbMaisMenu"><summary class="kbBtn kbBtnG kbBtnIco" title="Mais opções" aria-label="Mais opções">${KB_ICO.mais}</summary><div class="kbMaisLista">
      <button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-ficha-redistribuir>Redistribuir</button><button type="button" class="kbBtn kbBtnG kbBtnSm kbPerigo" data-kb-ficha-apagar>Apagar do painel</button></div></details>` : '';
  const barra = `<div class="kbFichaBarra">${pos}${setas}${flutuar}${mais}<button type="button" class="kbBtn kbBtnG kbBtnIco" data-kb-ficha-fechar title="Fechar (Esc)" aria-label="Fechar">${KB_ICO.fechar}</button></div>`;
  const apagar = o.gestor ? `<div class="kbApagarBox" data-kb-apagar-box hidden><strong>Apagar este lead do painel?</strong> Some do Quadro, dos alertas e da busca; a planilha não muda.
      <input type="text" maxlength="200" placeholder="Motivo (opcional), ex.: duplicado, teste"><div class="kbFichaBotoes"><button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-apagar-confirmar>Apagar</button><button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-apagar-cancelar>Cancelar</button></div></div>` : '';
  const chips = [f.status ? `<span class="kbSt" data-st="${escapeHtml(kbStSlug(f.status))}">${escapeHtml(kbStTexto(f.status))}</span>` : `<span class="kbSt">${f.livre ? 'Livre' : 'Sem status'}</span>`];
  if(plParaResgatar(f)) chips.push('<span class="badge">para resgatar</span>');
  if(f.venda_neo) chips.push('<span class="catBadge convertido">✓ venda no NEO</span>');
  const sub = [chips.join('')];
  const empresa = [f.tipo_empresa, f.qtd_linhas ? f.qtd_linhas + ' linhas' : '', local].filter(Boolean).join(' · ');
  if(empresa) sub.push(`<span>${escapeHtml(empresa)}</span>`);
  sub.push(`<span>${escapeHtml(['chegou ' + (kbDataHoraBR(f.criado_em_lead) || '—'), f.campanha].filter(Boolean).join(' · '))}</span>`);
  if(!f.livre && f.dono_nome) sub.push(`<span>com ${escapeHtml(f.dono_nome)}</span>`);
  const cab = `${urg ? `<span class="kbTag ${urg.classe}">${KB_ICO.relogio}${escapeHtml(urg.texto)}</span>` : ''}<h3 class="kbFichaNome">${v(f.nome)}</h3><div class="kbFichaSub">${sub.join('')}</div>`;
  const copiar = (rot, valor, mostrar) => valor ? `<span>${rot}</span><b>${escapeHtml(mostrar || valor)}</b><button type="button" class="kbLink" data-kb-ficha-copiar="${escapeHtml(String(valor))}">Copiar</button>` : '';
  let contato;
  if(semContato){
    contato = o.podePegar === false
      ? '<div class="kbFichaTravado"><p>Você não está liberado para pegar leads.</p></div>'
      : `<div class="kbFichaTravado"><p>Celular, e-mail e CNPJ aparecem quando você pega o lead. Ele vai direto para a sua fila.</p><button type="button" class="kbBtn kbBtnP kbBtnLg" data-kb-ficha-pegar>${KB_ICO.mao}Pegar este lead</button></div>`;
  } else {
    const msg = tel ? encodeURIComponent(col === 'novos' || f.livre ? vlMensagemPrimeiroContato(f, ppPrimeiroNome()) : plMensagemWhats(f, ppPrimeiroNome())) : '';
    contato = `<div class="kbFichaContato">${tel ? `<div class="kbFichaTel"><strong>${escapeHtml(kbFoneBR(f.telefone))}</strong>
        <button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-ficha-copiar="${escapeHtml(kbTelCopiar(f.telefone))}">${KB_ICO.copiar}Copiar</button>
        <span class="kbFichaDir"><a class="kbBtn kbBtnP" data-kb-contato="ligar" data-kb-ligar href="#" title="Copia o número e abre o ProContact">${KB_ICO.tel}Ligar</a><a class="kbBtn kbBtnQ" data-kb-contato="whatsapp" target="_blank" rel="noopener" href="https://wa.me/55${escapeHtml(tel.replace(/^55/, ''))}?text=${msg}">${KB_ICO.wa}WhatsApp</a></span></div>` : '<p class="kbMeta">Lead sem celular.</p>'}
      <div class="kbFichaOutros">${copiar('E-mail', f.email)}${copiar('CNPJ', f.cnpj)}</div></div>`
      + (f.livre ? `<div class="kbFichaBotoes"><button type="button" class="kbBtn kbBtnP" data-kb-ficha-pegar>${KB_ICO.mao}Pegar este lead</button></div>` : '');
  }
  const obsAnt = f.obs ? `<p class="kbObsAnt"><small>Última OBS${f.classificado_em ? ' · ' + escapeHtml(kbDataHoraBR(f.classificado_em)) : ''}</small>${escapeHtml(f.obs)}</p>` : '';
  const aviso = div ? `<p class="kbFichaAviso">⚠ ${escapeHtml(div)}</p>` : '';
  const corpo = f.livre
    ? `<div class="kbFichaSecao"><h5>Anúncio</h5><div id="kbFichaAnuncio"></div></div>`
    : `<nav class="kbSeg kbFichaAbas" aria-label="Partes da ficha"><button type="button" class="active" data-kb-ficha-aba="classificar">Classificar</button><button type="button" data-kb-ficha-aba="historico">Histórico</button><button type="button" data-kb-ficha-aba="anuncio">Anúncio</button></nav>
      <div data-kb-ficha-pane="classificar">${kbClassificarHtml(f, o.opcoes || [], { grupo: o.grupo, agoraMs })}<div class="kbFichaUltimos" id="kbFichaUltimos"></div></div>
      <div data-kb-ficha-pane="historico" hidden><div id="kbLinhaTempo"></div></div>
      <div data-kb-ficha-pane="anuncio" hidden><div id="kbFichaAnuncio"></div></div>`;
  const rodape = f.livre ? '' : `<div class="kbFichaRodape">${o.naHoje
      ? `<button type="button" class="kbBtn kbBtnP kbBtnLg" id="kbClassSalvarProx" data-kb-salvar="prox">Salvar e ir para o próximo${KB_ICO.seta}</button><button type="button" class="kbBtn kbBtnG" id="kbClassSalvar" data-kb-salvar="so">Só salvar</button>`
      : `<button type="button" class="kbBtn kbBtnP kbBtnLg" id="kbClassSalvar" data-kb-salvar="so">Salvar</button>`}<span class="kbMeta">Ctrl+Enter</span></div>`;
  return `<div class="kbFichaRolagem">${barra}${apagar}${cab}${contato}<p class="kbFichaResumo" id="kbFichaResumo"></p>${aviso}${obsAnt}${corpo}</div>${rodape}`;
}
```

- [ ] **Step 6: JS. Abrir, classificar, salvar e navegar**

1. Trocar a função `kbAbrirClassificar` inteira (de `function kbAbrirClassificar(aba, id, grupo){` até o `}` antes de `function kbClassAjustar(){`), a função `kbClassAjustar` e os listeners de `#kbClassGrupos`, `#kbClassRetornoBox`, `#kbClassFechar` e `#kbClassOverlay` (até a linha `document.getElementById('kbClassOverlay').addEventListener('keydown', …);`) por:

```js
// §126: Classificar = abrir a ficha. O grupo da coluna de destino (arrastar) fica em destaque; nada é salvo sozinho.
function kbAbrirClassificar(aba, id, grupo){ return kbAbrirFicha(aba, id, { grupo: grupo || null }); }
function kbClassAjustar(){
  const sel = kbFichaEl('kbClassStatus');
  if(!sel) return;
  const st = sel.value, op = kbEstado.opcoes.find(o => o.status === st);
  kbFichaEl('kbClassVenda').style.display = op && op.grupo === 'convertido' ? '' : 'none';
  kbFichaEl('kbClassRetornoBox').style.display = st === 'AGENDADO RETORNO' ? '' : 'none';
  kbFichaNo().querySelectorAll('#kbClassGrupos [data-kb-status]').forEach(b => b.classList.toggle('ativo', b.dataset.kbStatus === st));
}
function kbClassEscolher(st){
  const sel = kbFichaEl('kbClassStatus');
  if(!sel) return;
  sel.value = st;
  if(st === 'AGENDADO RETORNO' && !kbFichaEl('kbClassRetorno').value){
    const a = kbAtalhosRetorno(Date.now()).find(x => x.rotulo === 'Amanhã 10h');
    kbFichaEl('kbClassRetorno').value = a.data; kbFichaEl('kbClassHora').value = a.hora;
    kbFichaNo().querySelectorAll('[data-kb-ret-data]').forEach(b => b.classList.toggle('ativo', b.dataset.kbRetData === a.data && b.dataset.kbRetHora === a.hora));
  }
  kbFichaEl('kbClassErro').textContent = '';
  kbClassAjustar();
}
// Ficha "suja" = OBS digitada ou status escolhido e ainda não salvo (spec 3.1: a recarga não pode apagar isso).
function kbFichaSuja(){
  const obs = kbFichaEl('kbClassObs'), sel = kbFichaEl('kbClassStatus'), f = kbEstado.fichaLead;
  if(!obs || !sel) return false;
  const atual = f && f.status && [...sel.options].some(o => o.value === f.status) ? f.status : '';
  return !!obs.value.trim() || sel.value !== atual;
}
function kbFichaTrocarAba(nome){
  const no = kbFichaNo();
  no.querySelectorAll('.kbFichaAbas [data-kb-ficha-aba]').forEach(b => b.classList.toggle('active', b.dataset.kbFichaAba === nome));
  no.querySelectorAll('[data-kb-ficha-pane]').forEach(p => { p.hidden = p.dataset.kbFichaPane !== nome; });
}
function kbFichaMover(d){
  const lista = kbEstado.fichaLista || [], alvo = kbEstado.fichaAlvo;
  if(!alvo || !lista.length) return;
  if(kbFichaSuja()){ mostrarAviso('Salve ou apague o que digitou antes de trocar de lead.', 'info'); return; }
  const prox = lista[lista.indexOf(alvo.aba + '|' + alvo.id) + d];
  if(!prox) return;
  if(typeof kbHojeSelecionar === 'function' && kbEstado.aba === 'hoje' && kbFichaNo().classList.contains('noPainel')){ kbHojeSelecionar(prox); return; }
  const [aba, id] = prox.split('|');
  kbAbrirFicha(aba, id);
}
// Ponto de extensão: a Hoje (Task 4) troca por "ir para o próximo da fila". Aqui: recarrega e reabre o mesmo lead.
async function kbDepoisDeSalvar(alvo){ await kbCarregar(); await kbAbrirFicha(alvo.aba, alvo.id); }
```

2. Trocar a função `kbSalvarClassificacao` inteira e apagar a função `kbRetornoRapido` inteira (as duas ficam juntas, antes de `// A cada 10 s pergunta só a versão`). No lugar, colocar:

```js
async function kbSalvarClassificacao(opc){
  const alvo = kbEstado.fichaAlvo, el = kbFichaEl;
  if(!alvo || !el('kbClassStatus') || kbEstado.salvando) return false;
  const l = kbEstado.fichaLead || kbAcharLead(alvo.aba, alvo.id) || {};
  const status = el('kbClassStatus').value;
  const op = kbEstado.opcoes.find(o => o.status === status);
  const venda = !!op && op.grupo === 'convertido';
  const form = { status, grupo: op ? op.grupo : null, receita: venda ? el('kbClassReceita').value : '', retorno: el('kbClassRetorno').value };
  const erro = kbValidar(form, hojeSP());
  el('kbClassErro').textContent = erro;
  if(erro) return false;
  kbEstado.salvando = true;
  try {
    const hora = el('kbClassHora').value;
    const r = await ppSeguro(() => sb.rpc('leads_classificar', {
      p_aba: alvo.aba, p_id: alvo.id, p_status: status, p_obs: kbObsParaSalvar(el('kbClassObs').value, l.obs),
      p_converteu: venda && el('kbClassConverteu').checked, p_receita: venda ? kbNumeroBR(form.receita) : null,
      p_retorno: status === 'AGENDADO RETORNO' ? form.retorno : null,
    }));
    if(!r || r.error){ el('kbClassErro').textContent = 'Não foi possível salvar agora. Tente de novo.'; return false; }
    // §118: o banco já criou o retorno às 10:00; aqui vale a hora escolhida
    if(status === 'AGENDADO RETORNO'){
      const ag = await ppSeguro(() => sb.rpc('leads_agendar_retorno', { p_aba: alvo.aba, p_id: alvo.id, p_quando: kbQuandoSP(form.retorno, hora) }));
      if(!ag || ag.error) mostrarAviso('Lead classificado, mas a hora do retorno ficou 10:00 (não foi possível ajustar).', 'info');
    }
    mostrarAviso(`Salvo. ${l.nome || 'Lead'} → ${kbStTexto(status)}${status === 'AGENDADO RETORNO' ? `, ${ppFmtDia(form.retorno)} às ${hora}` : ''}. A planilha atualiza em segundos.`, 'ok');
    agAvisarMudou();   // o alarme da Agenda recarrega na hora (retorno fechado ou com hora nova)
    await kbDepoisDeSalvar(alvo, opc || {});
    kbCarregarAlertas(false);
    return true;
  } finally { kbEstado.salvando = false; }
}
```

3. Trocar a função `kbAbrirFicha` inteira por:

```js
async function kbAbrirFicha(aba, id, opc){
  const o = opc || {};
  kbEstado.fichaAlvo = { aba, id };
  if('lista' in o) kbEstado.fichaLista = o.lista || null;
  if(typeof kbFichaLugar === 'function') kbFichaLugar();
  const el = kbFichaNo(), corpo = kbFichaEl('kbFichaCorpo'), vazio = document.getElementById('kbHojeVazio');
  el.hidden = false;
  if(vazio && el.classList.contains('noPainel')) vazio.hidden = true;   // na Hoje, a ficha toma o lugar do "Tudo em dia"
  corpo.innerHTML = '<p class="kbMeta" style="padding:var(--space-5)">Carregando…</p>';
  el.classList.add('aberta');
  const r = await ppSeguro(() => sb.rpc('leads_ficha', { p_aba: aba, p_id: id }));
  if(!kbEstado.fichaAlvo || kbEstado.fichaAlvo.id !== id) return;
  const f = r && !r.error && Array.isArray(r.data) ? r.data[0] : null;
  kbEstado.fichaLead = f;
  const lista = kbEstado.fichaLista || [], chave = aba + '|' + id;
  const ret = ((kbEstado.hoje || {}).retornos || []).find(x => x.aba === aba && x.lead_id === id) || null;
  corpo.innerHTML = f ? kbFichaHtml(f, { gestor: kbGestor(), agoraMs: Date.now(), flutuando: !!kbEstado.fichaJanela, podePegar: kbGestor() || kbPodePegar(),
      opcoes: kbEstado.opcoes, grupo: o.grupo || null, naHoje: kbEstado.aba === 'hoje' && el.classList.contains('noPainel'),
      pos: lista.indexOf(chave) + 1, total: lista.includes(chave) ? lista.length : 0, retorno: ret })
    : `<div class="kbFichaRolagem"><div class="kbFichaBarra"><span class="kbFichaPos"></span><button type="button" class="kbBtn kbBtnG kbBtnIco" data-kb-ficha-fechar aria-label="Fechar">${KB_ICO.fechar}</button></div><p class="kbMeta">Não foi possível abrir a ficha agora.</p></div>`;
  if(!f) return;
  const sel = kbFichaEl('kbClassStatus');
  if(sel) sel.addEventListener('change', kbClassAjustar);
  if(o.grupo){ const g = kbFichaNo().querySelector(`[data-kb-grupo="${o.grupo}"]`); if(g && g.scrollIntoView) g.scrollIntoView({ block: 'center' }); }
  await kbCarregarDetalhes(aba, id);
}
```

4. Trocar o listener `kbFichaNo().addEventListener('click', async (e) => { … });` inteiro e as três linhas que vêm depois dele:
   - `document.getElementById('kbClassStatus').addEventListener('change', kbClassAjustar);`
   - `document.getElementById('kbClassSalvar').addEventListener('click', kbSalvarClassificacao);`
   - `document.getElementById('kbClassCancelar').addEventListener(…);`

   A linha `document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && kbEstado.fichaAlvo) kbFecharFicha(); });` também sai e é substituída. Colocar no lugar:

```js
kbFichaNo().addEventListener('click', async (e) => {
  const alvo = kbEstado.fichaAlvo;
  if(e.target.closest('[data-kb-ficha-fechar]')){ kbFecharFicha(); return; }
  if(e.target.closest('[data-kb-ficha-flutuar]')){ kbFlutuarFicha(); return; }
  if(!alvo) return;
  const aba = e.target.closest('[data-kb-ficha-aba]');
  if(aba){ kbFichaTrocarAba(aba.dataset.kbFichaAba); return; }
  const mv = e.target.closest('[data-kb-ficha-mover]');
  if(mv){ kbFichaMover(Number(mv.dataset.kbFichaMover)); return; }
  const ch = e.target.closest('[data-kb-status]');
  if(ch){ kbClassEscolher(ch.dataset.kbStatus); return; }
  const at = e.target.closest('[data-kb-ret-data]');
  if(at){ kbFichaEl('kbClassRetorno').value = at.dataset.kbRetData; kbFichaEl('kbClassHora').value = at.dataset.kbRetHora; kbFichaNo().querySelectorAll('[data-kb-ret-data]').forEach(b => b.classList.toggle('ativo', b === at)); return; }
  const sv = e.target.closest('[data-kb-salvar]');
  if(sv){ kbSalvarClassificacao({ proximo: sv.dataset.kbSalvar === 'prox' }); return; }
  const cp = e.target.closest('[data-kb-ficha-copiar]');
  if(cp){ try { await (kbFichaNo().ownerDocument.defaultView || window).navigator.clipboard.writeText(cp.dataset.kbFichaCopiar); mostrarAviso('Copiado.', 'ok'); } catch(_) { mostrarAviso('Não foi possível copiar.', 'erro'); } return; }
  const caixa = kbFichaNo().querySelector('[data-kb-apagar-box]');
  if(e.target.closest('[data-kb-ficha-apagar]')){ if(caixa){ caixa.hidden = false; const i = caixa.querySelector('input'); if(i) i.focus(); } return; }
  if(e.target.closest('[data-kb-apagar-cancelar]')){ if(caixa) caixa.hidden = true; return; }
  if(e.target.closest('[data-kb-apagar-confirmar]')){ kbApagarLead(alvo.aba, alvo.id, caixa ? caixa.querySelector('input').value : ''); return; }
  if(e.target.closest('[data-kb-ficha-pegar]')){ const ok = await kbPegar(alvo.aba, alvo.id); if(ok !== false) await kbDepoisDePegar(alvo); return; }
  if(e.target.closest('[data-kb-ficha-redistribuir]')){ if(!kbFichaNo().classList.contains('noPainel')) kbFecharFicha(); kbAbrirRedistribuir(alvo.aba, alvo.id); return; }
  const ct = e.target.closest('[data-kb-contato]');
  if(ct && ct.hasAttribute('data-kb-ligar')){ e.preventDefault(); if(kbEstado.fichaLead) kbLigar(kbEstado.fichaLead.telefone); }
  if(ct) ppSeguro(() => sb.rpc('registrar_contato_lead', { p_aba: alvo.aba, p_lead_id: alvo.id, p_canal: ct.dataset.kbContato }));
});
kbFichaNo().addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && kbFichaEl('kbClassStatus')){ e.preventDefault(); kbSalvarClassificacao({ proximo: kbFichaNo().classList.contains('noPainel') }); }
});
// Ponto de extensão: a Hoje (Task 4) leva o lead pego para a fila.
async function kbDepoisDePegar(alvo){ mostrarAviso('Lead pego. Ligue agora.', 'ok'); await kbAbrirFicha(alvo.aba, alvo.id); }
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && kbEstado.fichaAlvo && !kbFichaNo().classList.contains('noPainel')){ kbFecharFicha(); return; }
  if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const a = document.activeElement;
  if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const p = document.getElementById('panel-meusleads');
  if(!p || !p.classList.contains('active') || !kbEstado.fichaAlvo) return;
  e.preventDefault();
  kbFichaMover(e.key === 'ArrowDown' ? 1 : -1);
});
```

Atenção: a ordem dos testes do Step 1 depende do Esc, que precisa funcionar com o painel ativo ou não. O `Escape` é tratado antes do teste de painel ativo, de propósito.

5. `kbPegar`: trocar o corpo para devolver o resultado:

```js
async function kbPegar(aba, id){
  const r = await ppSeguro(() => sb.rpc('leads_pegar', { p_aba: aba, p_id: id }));
  if(!r || r.error){ mostrarAviso('Não foi possível pegar o lead agora.', 'erro'); return false; }
  const ok = !(r.data && r.data.ok === false);
  if(!ok) mostrarAviso(`Esse lead já foi pego por ${r.data.dono}`, 'info');
  await kbCarregar();
  return ok;
}
```

6. `kbCarregarDetalhes`: trocar a função inteira por:

```js
async function kbCarregarDetalhes(aba, id){
  const r = await ppSeguro(() => sb.rpc('leads_ficha_detalhes', { p_aba: aba, p_id: id }));
  if(!kbEstado.fichaAlvo || kbEstado.fichaAlvo.id !== id) return;
  const d = r && !r.error ? r.data : null;
  if(!d) return;
  kbEstado.fichaEventos = d.eventos || [];
  const an = d.anuncio || {}, ev = kbEstado.fichaEventos;
  const linhaAn = (rot, v) => `<div class="kbFichaLinha"><span>${rot}</span><strong>${escapeHtml(v == null || v === '' ? '—' : String(v))}</strong><i></i></div>`;
  const por = (idEl, html) => { const el = kbFichaEl(idEl); if(el) el.innerHTML = html; };
  por('kbFichaResumo', d.resumo ? escapeHtml(kbResumoContatoTexto(d.resumo, Date.now())) : '');
  por('kbLinhaTempo', kbLinhaTempoHtml(ev, 30));
  por('kbFichaUltimos', ev.length ? `<h4>Últimos contatos</h4>${kbLinhaTempoHtml(ev.slice(0, 4), 4)}${ev.length > 4 ? `<button type="button" class="kbLink" data-kb-ficha-aba="historico">Ver histórico completo (${ev.length})</button>` : ''}` : '');
  por('kbFichaAnuncio', linhaAn('Campanha', an.campanha) + linhaAn('Conjunto', an.conjunto) + linhaAn('Anúncio', an.anuncio) + linhaAn('Formulário', an.formulario) + linhaAn('Plataforma', an.plataforma) + linhaAn('Orgânico', an.organico ? 'sim' : 'não'));
}
```

7. **Cliques no Quadro.**
   - Apagar a linha `  else if(e.target.closest('[data-kb-retorno]')) kbRetornoRapido(aba, id, Number(e.target.closest('[data-kb-retorno]').dataset.kbRetorno));`.
   - Trocar `  else if(!e.target.closest('a,button')) kbAbrirFicha(aba, id);   // clique no cartão abre a ficha` por:

```js
  else if(!e.target.closest('a,button')){   // clique no cartão abre a ficha; ↑ ↓ andam pela coluna
    const lista = card.closest('.kbColLista');
    kbAbrirFicha(aba, id, { lista: lista ? [...lista.querySelectorAll('.kbCard')].map(c => c.dataset.aba + '|' + c.dataset.id) : null });
  }
```

8. **Cliques na tabela Todos e na busca.** No listener de clique do `#panel-meusleads`, trocar `  if(ab){ const [aba, id] = ab.dataset.kbAbrir.split('|'); document.getElementById('kbBuscaRes').style.display = 'none'; kbAbrirFicha(aba, id); return; }` por:

```js
  if(ab){
    const [aba, id] = ab.dataset.kbAbrir.split('|'), tabela = ab.closest('#kbTodosTabela');
    document.getElementById('kbBuscaRes').style.display = 'none';
    kbAbrirFicha(aba, id, { lista: tabela ? [...tabela.querySelectorAll('tr[data-kb-abrir]')].map(t => t.dataset.kbAbrir) : null });
    return;
  }
```

9. **"Ver tudo" da linha do tempo.** Apagar o listener antigo inteiro: `kbFichaNo().addEventListener('click', (e) => { if(e.target.closest('[data-kb-ver-tudo]')){ … } });`. No lugar, colocar o mesmo comportamento, que agora preenche a aba Histórico:

```js
kbFichaNo().addEventListener('click', (e) => {
  if(e.target.closest('[data-kb-ver-tudo]')){ const el = kbFichaEl('kbLinhaTempo'); if(el) el.innerHTML = kbLinhaTempoHtml(kbEstado.fichaEventos, 1000); }
});
```

- [ ] **Step 7: Ajustar os testes antigos que usavam a janela**

`test_leads_kanban.js`:
1. Trocar o trecho que começa em `  // classificar: modal filtra pelo grupo da coluna e valida` e termina em `  assert(document.getElementById('kbClassErro').textContent.includes('data do retorno'), 'mostra o erro no modal');` por:

```js
  // §126: classificar abre a ficha (sem janela) com o grupo da coluna em destaque e valida
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [L(a.p_id, { telefone: '11900000001' })], error: null });
  await kbAbrirClassificar('OUTUBRO', 'm1', 'perdido');
  eq([...document.querySelectorAll('#kbFicha #kbClassStatus option')].map(o => o.value).filter(Boolean), ['EM NEGOCIAÇÂO', 'AGENDADO RETORNO', 'PEDIDO CONCLUIDO (VENDA)', 'CNPJ INAPTO'], 'a ficha traz todas as tabulações');
  assert(document.querySelector('#kbFicha [data-kb-grupo="perdido"]').classList.contains('kbDestaque'), 'arrastar para Perdido destaca o grupo de perda');
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  await kbSalvarClassificacao();
  const call = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop();
  eq([call.args.p_aba, call.args.p_id, call.args.p_status], ['OUTUBRO', 'm1', 'CNPJ INAPTO'], 'classificar manda aba/id/status');
  await kbAbrirClassificar('OUTUBRO', 'm1', null);
  document.getElementById('kbClassStatus').value = 'AGENDADO RETORNO';
  document.getElementById('kbClassRetorno').value = '';
  const antes = window.__rpcCalls.length;
  await kbSalvarClassificacao();
  assert(window.__rpcCalls.length === antes, 'AGENDADO RETORNO sem data não chama o banco');
  assert(document.getElementById('kbClassErro').textContent.includes('data do retorno'), 'mostra o erro na ficha');
  kbFecharFicha();
```
2. Trocar `  assert(kbFichaHtml(L('a1', { categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }), { gestor: false, agoraMs: Date.now() }).includes('data-kb-ficha-retorno="3"'), 'ficha de lead em andamento tem Em 3 dias');` por:
```js
  assert(kbFichaHtml(L('a1', { categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }), { gestor: false, agoraMs: Date.now() }).includes('>Em 3 dias</button>'), 'ficha de lead em andamento tem o atalho Em 3 dias');
```
3. No bloco `// ==== Revisão final (crítico 1) …`, trocar as linhas de `  kbAbrirClassificar('OUTUBRO', 'm9', null);` até `  assert(!aberto('kbClassOverlay'), 'Classificar fecha depois de Salvar');` por:
```js
  window.__rpcRespostas.leads_ficha = { data: [L('m9', { dono_id: 'u-zz', telefone: '11900000001', obs: 'Zz obs antiga' })], error: null };
  await kbAbrirClassificar('OUTUBRO', 'm9', 'perdido');
  assert(document.getElementById('kbFicha').classList.contains('aberta'), 'Classificar abre a ficha (não há mais janela)');
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  document.getElementById('kbClassObs').value = 'Zz obs nova';
  await kbSalvarClassificacao();
  await espera(60);
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop().args.p_obs, 'Zz obs nova', 'OBS digitada vai para o banco');
  assert(document.getElementById('kbClassObs').value === '', 'depois de salvar a ficha reabre com a OBS em branco');
  kbFecharFicha();
```
4. Trocar `  assert(window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length === antesPegar + 1 && !document.getElementById('kbClassOverlay').classList.contains('active'), 'soltar Livre em Perdido não faz nada');` por:
```js
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_pegar').length === antesPegar + 1 && !document.getElementById('kbFicha').classList.contains('aberta'), 'soltar Livre em Perdido não faz nada');
```
5. Trocar `  assert(h2.includes('Pegue o lead para ver') && h2.includes('data-kb-ficha-pegar') && !h2.includes('11900000001'), 'ficha de lead Livre esconde contato e oferece Pegar');` por:
```js
  assert(h2.includes('aparecem quando você pega o lead') && h2.includes('data-kb-ficha-pegar') && !h2.includes('11900000001'), 'ficha de lead Livre esconde contato e oferece Pegar');
```

`test_leads_hoje.js`:
1. No trecho `// classificar AGENDADO RETORNO com hora chama leads_agendar_retorno`, trocar `  kbAbrirClassificar('OUTUBRO', 'h1', null);` por `  await kbAbrirClassificar('OUTUBRO', 'h1', null);`.
2. Apagar as 3 linhas do `// retorno rápido da ficha também vai para a Agenda (10:00)` (o comentário, o `await kbRetornoRapido('OUTUBRO', 'h1', 1);` e o `assert(rr2 …)` com o `const rr2`).
3. No bloco `// Important 1:`:
   - apagar `  await kbRetornoRapido('OUTUBRO', 'h1', 1);`;
   - trocar `  kbAbrirClassificar('OUTUBRO', 'h1', null);` por `  window.__rpcRespostas.leads_ficha = { data: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }], error: null };\n  await kbAbrirClassificar('OUTUBRO', 'h1', null);`;
   - trocar `  eq(mudou, 3, 'retorno rápido, classificar e redistribuir avisam a Agenda');` por `  eq(mudou, 2, 'classificar e redistribuir avisam a Agenda');`.
4. No bloco `// Classificar novo: chips por grupo, atalhos de data, Ctrl+Enter`, trocar o trecho de `  kbAbrirClassificar('OUTUBRO', 'a1', null);` até o segundo `  fecharOverlay(document.getElementById('kbClassOverlay'));` (inclusive) por:
```js
  window.__rpcRespostas.leads_ficha = { data: [{ aba: 'OUTUBRO', lead_id: 'a1', nome: 'Zz a1', livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }], error: null };
  await kbAbrirClassificar('OUTUBRO', 'a1', null);
  const chips = [...document.querySelectorAll('#kbClassGrupos [data-kb-status]')];
  eq(chips.length, 4, 'um botão por tabulação');
  document.querySelector('#kbClassGrupos [data-kb-status="AGENDADO RETORNO"]').click();
  assert(document.getElementById('kbClassStatus').value === 'AGENDADO RETORNO' && document.getElementById('kbClassRetornoBox').style.display !== 'none'
    && document.querySelector('#kbClassGrupos [data-kb-status="AGENDADO RETORNO"]').classList.contains('ativo'), 'clicar na tabulação escolhe e mostra data/hora');
  [...document.querySelectorAll('#kbClassRetornoBox [data-kb-ret-data]')].find(b => b.textContent === 'Amanhã 10h').click();
  eq(document.getElementById('kbClassRetorno').value, somaDiasStr(hojeSP(), 1), 'atalho Amanhã preenche a data');
  assert(document.querySelector('#kbFicha #kbClassGrupos'), 'Classificar fica dentro da ficha');
  await kbAbrirClassificar('OUTUBRO', 'a1', 'perdido');
  assert(document.querySelector('#kbClassGrupos [data-kb-grupo="perdido"]').classList.contains('kbDestaque'), 'arrastar para Perdido destaca as de perda');
  eq(document.querySelector('#kbClassGrupos [data-kb-status="CNPJ INAPTO"]').textContent, 'CNPJ inapto', 'sigla continua em maiúscula no botão');
  kbFecharFicha();
```
5. Trocar `  assert(document.getElementById('kbClassOverlay').parentElement === document.getElementById('kbRedOverlay').parentElement, 'modais de Meus leads no mesmo lugar');` por:
```js
  assert(document.getElementById('kbFichaCasa').parentElement === document.getElementById('kbRedOverlay').parentElement, 'ficha e Redistribuir no mesmo lugar');
```
6. No fim (bloco das cores), trocar:
```js
  kbAbrirClassificar('OUTUBRO', 'a1', null);
  assert(document.querySelector('#kbClassGrupos [data-kb-status="CNPJ INAPTO"]').getAttribute('data-st') === 'cnpj-inapto', 'botão do Classificar com a cor da tabulação');
  fecharOverlay(document.getElementById('kbClassOverlay'));
```
por:
```js
  await kbAbrirClassificar('OUTUBRO', 'a1', null);
  assert(document.querySelector('#kbClassGrupos [data-kb-status="CNPJ INAPTO"]').getAttribute('data-st') === 'cnpj-inapto', 'botão do Classificar com a cor da tabulação');
  kbFecharFicha();
```

`test_leads_painel_hoje.js`: nada a trocar nesta task. As asserções de `kbFichaHtml` dele já valem: Copiar sem `p:+55`, "não está liberado", `data-kb-ficha-pegar`.

- [ ] **Step 8: Rodar tudo**

Run: `node test_meus_leads_redesign.js && node test_leads_kanban.js && node test_leads_hoje.js && node test_leads_painel_hoje.js`
Expected: os quatro com `0 falharam`. Se algum teste antigo falhar por causa de `#kbClassOverlay`, `kbRetornoRapido` ou de uma chamada a `kbAbrirClassificar` sem `await`, tratar como no Step 7. Qualquer outra falha é bug: corrigir o código, não o teste.

- [ ] **Step 9: Commit**

```bash
git add _template.html test_meus_leads_redesign.js test_leads_kanban.js test_leads_hoje.js
git commit -m "feat(meus-leads): ficha nova com Classificar dentro, sai a janela (secao 126.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Hoje B (fila à esquerda, ficha ao lado)

**Files:**
- Modify `_template.html`:
  - **markup:** `#kbHoje` passa a ter estrutura fixa;
  - **CSS:** sai a Hoje antiga e entra a Hoje B;
  - **JS:** `kbRenderHoje` reescrita, `kbFichaLugar`, `kbHojeSelecionar`, `kbHojeVazioHtml`, `kbPegarProximoLivre`, `kbDepoisDeSalvar` e `kbDepoisDePegar` (versão Hoje), `kbTrocarAba`, `kbCarregar`, `kbRecolherFicha` e `kbAjustarAltura`;
  - **JS, sai:** `kbCartoesHoje`, `kbFacaAgora`, `kbProximoDaFila`, `kbProximo`, `KB_EXCECAO_MS` e os cliques dos cartões antigos.
- Modify: `test_leads_hoje.js` e `test_leads_painel_hoje.js` (só as partes da Hoje antiga).
- Test: `test_meus_leads_redesign.js`

**Interfaces:**
- Consumes:
  - Task 1: `kbFilaHoje`, `KB_FILA_GRUPOS`, `kbProximoHoje` e `kbDataLongaSP`;
  - Task 3: `kbAbrirFicha(aba,id,{lista})`, `kbFichaSuja`, `kbDepoisDeSalvar` e `kbDepoisDePegar` (aqui redefinidas), `KB_ICO` e `kbPegar → boolean`.
- Produces:
  - `kbRenderHoje()`;
  - `kbFichaLugar()`;
  - `kbHojeSelecionar(chave)`;
  - `kbHojeVazioHtml() → string`;
  - `kbEstado.filaAba` (`'fazer'`, `'livres'` ou `'alertas'`), `kbEstado.filaHoje` (`string[]`) e `kbEstado.hojeSel`.

- [ ] **Step 1: Escrever os testes**

Em `test_meus_leads_redesign.js`, trocar `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 4: Hoje B ====
  const agora4 = Date.now();
  const iso = (minDelta) => new Date(agora4 + minDelta * 60000).toISOString();
  const L4 = [
    { aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Novo', categoria: 'sem_contato', livre: false, pego_em: iso(-10), criado_em_lead: iso(-12) },
    { aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno Vencido', categoria: 'andamento', status: 'AGENDADO RETORNO', livre: false, ligacoes: 2, ultima_ligacao: iso(-60), obs: 'Zz obs h2' },
    { aba: 'OUTUBRO', lead_id: 'h3', nome: 'Zz Nunca', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 0, pego_em: iso(-120) },
    { aba: 'OUTUBRO', lead_id: 'lv1', nome: 'Zz Livre Antigo', categoria: 'sem_contato', livre: true, criado_em_lead: iso(-30), cidade: 'Campinas', qtd_linhas: '10' },
    { aba: 'OUTUBRO', lead_id: 'lv2', nome: 'Zz Livre Novo', categoria: 'sem_contato', livre: true, criado_em_lead: iso(-2) },
  ];
  const R4 = [{ aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno Vencido', quando: iso(-30), vencido: true }];
  window.__rpcRespostas.leads_kanban3 = { data: L4, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: R4, livres: 2, placar: { classificacoes: 7, retornos_hoje: 2, retornos_cumpridos: 1 } }, error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [{ lig_hoje: 23, meta_ligacoes_dia: 80, tem_telefonia: true, tem_dados: true }], error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Novo', desde: iso(-10) }], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000041' }, L4.find(l => l.lead_id === a.p_id) || { aba: 'OUTUBRO', lead_id: a.p_id, nome: 'Zz ?', categoria: 'andamento' })], error: null });
  kbFecharFicha();
  document.getElementById('panel-meusleads').classList.add('active');
  await kbCarregar();
  kbTrocarAba('hoje');
  await espera(120);
  const hoje4 = document.getElementById('kbHoje'), lista4 = document.getElementById('kbFilaLista');
  assert(hoje4.querySelector('#kbHojeTopo').textContent.includes('23') && hoje4.textContent.includes('/ 80') && hoje4.textContent.includes('1 de 2') && hoje4.querySelector('#kbHojeTopo').textContent.includes('7'), 'placar: ligações/meta, classificados, retornos cumpridos');
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|h2', 'OUTUBRO|h1', 'OUTUBRO|h3'], 'fila: atrasado, novo, nunca ligado');
  assert(lista4.textContent.includes('Atrasados') && lista4.textContent.includes('Agora') && lista4.textContent.includes('Nunca ligados'), 'títulos dos grupos');
  const no4 = document.getElementById('kbFicha');
  assert(no4.parentElement.id === 'kbHojeFicha' && no4.classList.contains('noPainel'), 'na Hoje a ficha mora no painel da direita');
  assert(kbEstado.fichaAlvo && kbEstado.fichaAlvo.id === 'h2' && no4.textContent.includes('Zz Retorno Vencido') && no4.textContent.includes('1 de 3 na sua fila'), 'o primeiro da fila já abre ao lado');
  assert(no4.querySelector('#kbClassSalvarProx'), 'na Hoje o botão é Salvar e ir para o próximo');
  eq(document.getElementById('kbFilaNFazer').textContent, '3', 'contador de Fazer agora');
  // clicar em outro lead troca a ficha; com OBS digitada não troca
  lista4.querySelector('[data-kb-fila="OUTUBRO|h3"]').click();
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'h3' && lista4.querySelector('[data-kb-fila="OUTUBRO|h3"]').classList.contains('sel'), 'clicar na fila abre o lead ao lado');
  document.getElementById('kbClassObs').value = 'Zz digitando';
  lista4.querySelector('[data-kb-fila="OUTUBRO|h1"]').click();
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'h3', 'com OBS digitada, clicar em outro lead não troca');
  // a recarga de 10 s não apaga o que foi digitado
  const nFicha = window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length;
  await kbCarregar();
  assert(document.getElementById('kbClassObs').value === 'Zz digitando' && window.__rpcCalls.filter(c => c.nome === 'leads_ficha').length === nFicha, 'recarga não redesenha a ficha com OBS digitada');
  // RF3-hoje: erro ao salvar não avança
  window.__rpcRespostas.leads_classificar = { data: null, error: { message: 'rede' } };
  document.getElementById('kbClassStatus').value = 'EM NEGOCIAÇÂO';
  document.getElementById('kbClassSalvarProx').click();
  await espera(80);
  assert(kbEstado.fichaAlvo.id === 'h3' && document.getElementById('kbClassObs').value === 'Zz digitando', 'RF3-hoje: erro não avança e mantém a OBS');
  // Salvar e ir para o próximo: h3 sai da fila (agora tem ligação) e o próximo da ordem antiga abre
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: L4.map(l => l.lead_id === 'h3' ? Object.assign({}, l, { ligacoes: 1, ultima_ligacao: iso(0) }) : l), error: null };
  document.getElementById('kbClassSalvarProx').click();
  await espera(150);
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|h2', 'OUTUBRO|h1'], 'lead salvo que não se encaixa mais sai da fila');
  assert(kbEstado.fichaAlvo.id === 'h2' && kbEstado.hojeSel === 'OUTUBRO|h2', 'h3 era o último: volta para o primeiro que sobrou');
  // setas na Hoje andam pela fila
  document.body.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await espera(60);
  assert(kbEstado.hojeSel === 'OUTUBRO|h1' && kbEstado.fichaAlvo.id === 'h1', 'seta para baixo vai para o próximo da fila');
  // Livres: do mais antigo para o mais novo; prévia e Pegar
  hoje4.querySelector('[data-kb-fila-aba="livres"]').click();
  eq([...lista4.querySelectorAll('[data-kb-fila]')].map(b => b.dataset.kbFila), ['OUTUBRO|lv1', 'OUTUBRO|lv2'], 'Livres do mais antigo para o mais novo');
  assert(lista4.querySelector('[data-kb-pegar-proximo]'), 'Pegar o próximo livre na aba Livres');
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [L4.find(l => l.lead_id === a.p_id)], error: null });
  lista4.querySelector('[data-kb-fila="OUTUBRO|lv1"]').click();
  await espera(60);
  assert(no4.querySelector('[data-kb-ficha-pegar]') && !no4.querySelector('#kbClassStatus'), 'livre: prévia com Pegar');
  window.__rpcRespostas.leads_pegar = { data: { ok: true }, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: L4.map(l => l.lead_id === 'lv1' ? Object.assign({}, l, { livre: false, pego_em: iso(0) }) : l), error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000042' }, L4.find(l => l.lead_id === a.p_id), a.p_id === 'lv1' ? { livre: false, pego_em: iso(0) } : {})], error: null });
  no4.querySelector('[data-kb-ficha-pegar]').click();
  await espera(150);
  assert(kbEstado.filaAba === 'fazer' && kbEstado.hojeSel === 'OUTUBRO|lv1' && hoje4.querySelector('[data-kb-fila-aba="fazer"]').classList.contains('active'), 'pegar leva para Fazer agora com o lead selecionado');
  // Alertas
  hoje4.querySelector('[data-kb-fila-aba="alertas"]').click();
  assert(lista4.textContent.includes('Pego e sem contato') && lista4.textContent.includes('Zz Novo'), 'aba Alertas lista os alertas');
  lista4.querySelector('[data-kb-fila="OUTUBRO|h1"]').click();
  await espera(60);
  assert(kbEstado.fichaAlvo.id === 'h1', 'clicar no alerta abre o lead');
  hoje4.querySelector('[data-kb-fila-aba="fazer"]').click();
  // RF2-fila: nome com HTML na fila sai escapado
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'x9', nome: '<img src=x onerror=alert(1)>', categoria: 'sem_contato', livre: false, pego_em: iso(-1) }];
  kbRenderHoje();
  assert(!lista4.innerHTML.includes('<img'), 'RF2-fila: nome escapado');
  // Tudo em dia
  kbEstado.leads = []; kbEstado.hoje = { fila: [], retornos: [], livres: 0, placar: {} };
  kbFecharFicha(); kbEstado.fichaAlvo = null;
  kbRenderHoje();
  assert(!document.getElementById('kbHojeVazio').hidden && document.getElementById('kbHojeVazio').textContent.includes('Tudo em dia') && no4.hidden, 'fila vazia: Tudo em dia no lugar da ficha');
  // RF5: flutuar na Hoje, trocar de aba e fechar a flutuante
  window.__rpcRespostas.leads_kanban3 = { data: L4, error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({ telefone: '11900000041' }, L4.find(l => l.lead_id === a.p_id))], error: null });
  await kbCarregar(); await espera(100);
  const pip4 = document.implementation.createHTMLDocument('pip');
  const win4 = { document: pip4, addEventListener: (ev, fn) => { if(ev === 'pagehide') win4._ph = fn; }, close(){ if(win4._ph) win4._ph(); } };
  window.documentPictureInPicture = { requestWindow: async () => win4 };
  await kbFlutuarFicha(); await espera(60);
  kbTrocarAba('quadro'); kbRenderHoje();
  assert(pip4.getElementById('kbFicha') && !document.getElementById('kbFicha'), 'RF5: flutuando, trocar de aba não puxa a ficha de volta');
  kbTrocarAba('hoje'); await espera(80);
  kbFecharFicha(); await espera(80);
  assert(document.getElementById('kbFicha') && document.getElementById('kbFicha').parentElement.id === 'kbHojeFicha', 'RF5: fechar a flutuante na Hoje devolve a ficha ao painel da direita');
  delete window.documentPictureInPicture;
  // sair da Hoje: ficha volta para a casa e fecha (sem nada digitado)
  kbTrocarAba('quadro');
  assert(document.getElementById('kbFicha').parentElement.id === 'kbFichaCasa' && !document.getElementById('kbFicha').classList.contains('aberta'), 'fora da Hoje a ficha volta a ser gaveta, fechada');
  // gestor sem consultor escolhido
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  kbEstado.dono = '';
  kbTrocarAba('hoje'); await espera(80);
  assert(document.getElementById('kbFilaLista').textContent.includes('Escolha um consultor'), 'gestor sem consultor escolhido vê o aviso');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  document.getElementById('panel-meusleads').classList.remove('active');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_redesign.js`
Expected: `FALHOU: placar: ligações/meta…`, entre outras. A Hoje antiga não tem `#kbHojeTopo`.

- [ ] **Step 3: Markup**

Em `_template.html`, trocar `      <div id="kbHoje" class="kbHoje" style="display:none"></div>` por:

```html
      <div id="kbHoje" class="kbHoje" style="display:none">
        <div class="kbHojeTopo" id="kbHojeTopo"></div>
        <div class="kbHojeArea">
          <div class="kbFilaLado">
            <nav class="kbSeg kbFilaAbas" id="kbFilaAbas" aria-label="Fila de hoje">
              <button type="button" class="active" data-kb-fila-aba="fazer">Fazer agora <span class="kbN" id="kbFilaNFazer"></span></button>
              <button type="button" data-kb-fila-aba="livres">Livres <span class="kbN" id="kbFilaNLivres"></span></button>
              <button type="button" data-kb-fila-aba="alertas">Alertas <span class="kbN" id="kbFilaNAlertas"></span></button>
            </nav>
            <div class="kbFilaLista" id="kbFilaLista"></div>
          </div>
          <div class="kbHojeFicha" id="kbHojeFicha"><div class="kbHojeVazio" id="kbHojeVazio" hidden></div></div>
        </div>
      </div>
```

Conferir o equilíbrio de `<div>` e `</div>`: ficam +7 e +7.

- [ ] **Step 4: CSS**

Em `_template.html`, apagar estas linhas:
- `.kbProximoBox`, `.kbProximo`, `.kbHojeGrade{…}`;
- `.kbCartoes`, `.kbCartao`, `.kbCartao.active`, `.kbCartaoN`, `.kbCartaoRot`, `.kbFaca`, `.kbPlacar`, `.kbPlacar strong`, `.kbAlertasLinha`.

E também:
- trocar `  .kbHojeGrade h4,.kbEquipe h4{…}` por `  .kbEquipe h4{margin:0 0 var(--space-3);font-family:var(--font-head);text-transform:uppercase;letter-spacing:.05em;font-size:var(--fs-md);}`. A Equipe não muda nesta fase;
- manter `.kbCartaoLista`, que é usada pela Equipe.

Depois, inserir no fim do bloco de Meus leads, antes do `</style>`:

```css
  /* §126: Hoje B — placar no topo, fila à esquerda e ficha à direita na altura da tela */
  .kbHojeTopo{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--space-6);flex-wrap:wrap;margin:var(--space-3) 0 var(--space-4);}
  .kbSaudacao{margin:0;font:600 24px/1.15 var(--font-body);letter-spacing:-.01em;color:var(--ml-ink);text-transform:none;}
  .kbHojeTopo .kbMeta{margin:4px 0 0;font-size:var(--fs-base);color:var(--ml-ink-2);}
  .kbPlacar{display:flex;gap:28px;flex-wrap:wrap;}
  .kbPlacar > div{display:flex;flex-direction:column;min-width:104px;font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbNumGrande{font:700 30px/1 var(--font-head);color:var(--ml-ink);font-variant-numeric:tabular-nums;margin-bottom:4px;}
  .kbMetaN{font-size:20px;color:var(--ml-ink-3);}
  .kbMedidor{display:block;height:6px;margin-top:8px;border-radius:999px;background:var(--ml-surface-3);overflow:hidden;}
  .kbMedidor i{display:block;height:100%;background:var(--ml-ink);border-radius:999px;}
  .kbHojeArea{display:grid;grid-template-columns:380px minmax(0,1fr);background:var(--ml-surface);border-radius:16px;overflow:hidden;height:var(--kb-hoje-altura,calc(100vh - 300px));min-height:600px;}
  .kbFilaLado{display:flex;flex-direction:column;min-height:0;background:var(--ml-surface-2);box-shadow:inset -1px 0 0 var(--ml-surface-3);}
  .kbFilaAbas{margin:var(--space-3) var(--space-3) var(--space-1);align-self:flex-start;}
  .kbFilaLista{flex:1;min-height:0;overflow-y:auto;padding:var(--space-1) 10px var(--space-3);}
  .kbFilaGrupo{display:flex;align-items:center;gap:var(--space-2);margin:14px 10px 4px;font-weight:600;font-size:var(--fs-sm);color:var(--ml-ink);}
  .kbFilaGrupo i{width:8px;height:8px;border-radius:50%;background:var(--ml-ink-3);}
  .kbFilaGrupo span{color:var(--ml-ink-3);font-weight:500;}
  .kbFG-atrasados i{background:var(--ml-late);}
  .kbFG-agora i{background:var(--ml-novo);}
  .kbFG-nunca i{background:var(--ml-soon);}
  .kbFilaItem{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr);gap:12px;align-items:center;width:100%;padding:9px 10px;border:0;border-radius:10px;background:none;font:inherit;text-align:left;color:var(--ml-ink);cursor:pointer;transition:background var(--dur-fast);}
  .kbFilaItem:hover,.kbFilaItem.sel{background:var(--ml-surface);}
  .kbFilaItem.sel::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--c-sinal);}
  .kbFilaHora{font:600 15px/1 var(--font-head);color:var(--ml-ink-2);font-variant-numeric:tabular-nums;}
  .kbFilaHora.late{color:var(--ml-late);}
  .kbFilaHora.novo{color:var(--ml-novo);}
  .kbFilaTexto{min-width:0;}
  .kbFilaTexto b{display:block;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .kbFilaTexto small{display:block;font-size:var(--fs-sm);color:var(--ml-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .kbFilaAlerta{grid-template-columns:minmax(0,1fr);gap:4px;}
  .kbFilaAlerta .kbTag{justify-self:start;}
  .kbFilaPegar{width:100%;height:42px;margin:var(--space-2) 0;}
  .kbFilaVazia{margin:var(--space-6) 10px;color:var(--ml-ink-3);font-size:var(--fs-sm);}
  .kbHojeFicha{position:relative;min-height:0;min-width:0;display:flex;flex-direction:column;}
  .kbHojeVazio{margin:auto;}
  .kbEmDia{max-width:420px;padding:var(--space-10) var(--space-5);text-align:center;}
  .kbEmDiaIco{width:52px;height:52px;border-radius:16px;background:var(--ml-ok-soft);display:grid;place-items:center;margin:0 auto 14px;}
  .kbEmDiaIco svg{width:26px;height:26px;stroke:var(--ml-ok);fill:none;stroke-width:2.4;}
  .kbEmDia h3{margin:0 0 6px;font:600 22px/1.2 var(--font-body);color:var(--ml-ink);text-transform:none;}
  .kbEmDia p{margin:0 0 18px;color:var(--ml-ink-2);}
  .kbFilaItem.kbSaindo{animation:kbSai .25s var(--ease-out) forwards;}
  @keyframes kbSai{to{opacity:0;transform:translateX(-12px);}}
  @media (prefers-reduced-motion: reduce){ .kbFilaItem.kbSaindo{animation:none;} }
  @media (max-width: 900px){ .kbHojeArea{grid-template-columns:1fr;height:auto;} .kbFilaLista{max-height:50vh;} }
```

- [ ] **Step 5: JS**

1. **Apagar** `const KB_EXCECAO_MS = 2 * 60000;`, a função `kbProximoDaFila` com o comentário dela, `kbCartoesHoje`, `kbFacaAgora`, `async function kbProximo(){…}` e a função `kbRenderHoje` antiga inteira.
   - Na linha `kbEstado.aba = null; kbEstado.excecoes = {}; kbEstado.notificados = new Set(); …`, tirar `kbEstado.excecoes = {}; ` e acrescentar `kbEstado.filaAba = 'fazer'; kbEstado.hojeSel = null; kbEstado.filaHoje = []; `.
   - No listener de clique do `#panel-meusleads`, apagar estas quatro linhas:
     - `const ct = e.target.closest('[data-kb-cartao]'); if(ct){ … }`
     - `if(e.target.closest('#kbHoje [data-kb-cartao-mais]')){ … }`
     - `if(e.target.closest('[data-kb-ver-alertas]')){ … }`
     - `if(e.target.closest('[data-kb-proximo]')){ kbProximo(); return; }`

2. Inserir no lugar da `kbRenderHoje` antiga:

```js
// §126: Hoje B — placar no topo; fila em grupos (kbFilaHoje), Livres e Alertas à esquerda; ficha ao lado (kbFichaLugar).
const KB_ALERTA_TAG = { sem_contato: 'late', retorno_vencido: 'late', parado: 'soon', perda_suspeita: 'late', lead_novo: 'novo' };
function kbFilaDetalhe(i){
  if(!i.lead) return '';
  return [i.lead.status ? kbStTexto(i.lead.status) : 'Sem status', i.lead.qtd_linhas ? i.lead.qtd_linhas + ' linhas' : ''].filter(Boolean).join(' · ');
}
function kbLivresHoje(){ return kbVeLivres() ? (kbEstado.leads || []).filter(l => l.livre).sort((a, b) => (kbMs(a.criado_em_lead) || 0) - (kbMs(b.criado_em_lead) || 0)) : []; }
function kbRenderHoje(){
  const h = kbEstado.hoje || { fila: [], retornos: [], livres: 0, placar: null };
  const agoraMs = Date.now(), semDono = kbGestor() && !kbEstado.dono;
  if(kbEstado.filaAba === 'livres' && !kbVeLivres()) kbEstado.filaAba = 'fazer';
  // topo: saudação + placar
  const p = h.placar || {}, lg = kbEstado.placarLig, rm = kbResumoMes(kbEstado.leads);
  const temMeta = lg && lg.tem_telefonia !== false && lg.meta_ligacoes_dia;
  const ligTxt = lg && lg.tem_telefonia !== false ? `${lg.lig_hoje || 0}${temMeta ? `<span class="kbMetaN"> / ${lg.meta_ligacoes_dia}</span>` : ''}` : '—';
  const min = kbPartesSP(agoraMs).min, nome = ppPrimeiroNome();
  const saud = (min < 12 * 60 ? 'Bom dia' : min < 18 * 60 ? 'Boa tarde' : 'Boa noite') + (nome ? ', ' + nome : '') + '.';
  document.getElementById('kbHojeTopo').innerHTML = `<div><h2 class="kbSaudacao">${escapeHtml(saud)}</h2><p class="kbMeta">${escapeHtml(kbDataLongaSP(agoraMs))}</p></div>
    <div class="kbPlacar">
      <div><strong class="kbNumGrande">${ligTxt}</strong><span>ligações hoje</span>${temMeta ? `<span class="kbMedidor"><i style="width:${Math.min(100, Math.round(100 * (lg.lig_hoje || 0) / lg.meta_ligacoes_dia))}%"></i></span>` : ''}</div>
      <div><strong class="kbNumGrande">${Number(p.classificacoes) || 0}</strong><span>classificados hoje</span></div>
      <div><strong class="kbNumGrande">${Number(p.retornos_cumpridos) || 0}<span class="kbMetaN"> de ${Number(p.retornos_hoje) || 0}</span></strong><span>retornos cumpridos</span></div>
      <div><strong class="kbNumGrande">${rm.vendas}</strong><span>vendas no mês · ${escapeHtml(kbMoeda(rm.receita) || 'R$ 0,00')}</span></div>
    </div>`;
  // fila
  const fila = semDono ? [] : kbFilaHoje(kbEstado.leads, h.retornos, agoraMs);
  kbEstado.filaHoje = fila.map(i => i.chave);
  const livres = kbLivresHoje(), alertas = kbEstado.alertas || [];
  const nF = document.getElementById('kbFilaNFazer');
  nF.textContent = fila.length ? String(fila.length) : ''; nF.classList.toggle('hot', fila.length > 0);
  document.getElementById('kbFilaNLivres').textContent = livres.length ? String(livres.length) : '';
  document.getElementById('kbFilaNAlertas').textContent = alertas.length ? String(alertas.length) : '';
  document.querySelectorAll('#kbFilaAbas [data-kb-fila-aba]').forEach(b => {
    b.classList.toggle('active', b.dataset.kbFilaAba === kbEstado.filaAba);
    if(b.dataset.kbFilaAba === 'livres') b.style.display = kbVeLivres() ? '' : 'none';
  });
  const sel = kbEstado.hojeSel;
  const linha = (chave, rot, classe, nome, det) => `<button type="button" class="kbFilaItem${chave === sel ? ' sel' : ''}" data-kb-fila="${escapeHtml(chave)}"><span class="kbFilaHora ${classe}">${escapeHtml(rot)}</span><span class="kbFilaTexto"><b>${escapeHtml(nome || '(sem nome)')}</b><small>${escapeHtml(det)}</small></span></button>`;
  let html = '';
  if(kbEstado.filaAba === 'livres'){
    html = livres.length ? `<button type="button" class="kbBtn kbBtnP kbFilaPegar" data-kb-pegar-proximo>${KB_ICO.mao}Pegar o próximo livre</button>`
        + livres.map(l => linha(l.aba + '|' + l.lead_id, kbTempoDesde(l.criado_em_lead, agoraMs).replace(/^há /, ''), '', l.nome, [l.cidade, l.qtd_linhas ? l.qtd_linhas + ' linhas' : ''].filter(Boolean).join(' · '))).join('')
      : '<p class="kbFilaVazia">Nenhum lead livre agora. Quando chegar um, ele aparece aqui e o painel avisa.</p>';
  } else if(kbEstado.filaAba === 'alertas'){
    html = alertas.map(a => { const c = a.aba + '|' + a.lead_id; return `<button type="button" class="kbFilaItem kbFilaAlerta${c === sel ? ' sel' : ''}" data-kb-fila="${escapeHtml(c)}"><span class="kbTag ${KB_ALERTA_TAG[a.tipo] || 'late'}">${escapeHtml(kbAlertaTexto(a))}</span><span class="kbFilaTexto"><b>${escapeHtml(a.nome || '')}</b><small>${escapeHtml(kbTempoDesde(a.desde, agoraMs))}</small></span></button>`; }).join('')
      || '<p class="kbFilaVazia">Nenhum alerta.</p>';
  } else if(semDono){
    html = '<p class="kbFilaVazia">Escolha um consultor no seletor acima para ver a fila dele.</p>';
  } else {
    KB_FILA_GRUPOS.forEach(([g, titulo]) => {
      const itens = fila.filter(i => i.grupo === g);
      if(itens.length) html += `<div class="kbFilaGrupo kbFG-${g}"><i></i>${titulo} <span>${itens.length}</span></div>` + itens.map(i => linha(i.chave, i.rotulo, i.classe, i.nome, kbFilaDetalhe(i))).join('');
    });
    if(!html) html = '<p class="kbFilaVazia">Nada para fazer agora.</p>';
  }
  const lista = document.getElementById('kbFilaLista');
  if(lista.dataset.html !== html){ const topo = lista.scrollTop; lista.innerHTML = html; lista.dataset.html = html; lista.scrollTop = topo; }
  kbHojeSincronizar(fila);
}
// Sem ficha aberta: na aba Fazer agora abre o primeiro da fila; sem fila, mostra o "Tudo em dia" no lugar da ficha.
function kbHojeSincronizar(fila){
  if(kbEstado.aba !== 'hoje') return;
  const no = kbFichaNo(), vazio = document.getElementById('kbHojeVazio'), slot = document.getElementById('kbHojeFicha');
  if(!kbEstado.fichaAlvo && kbEstado.filaAba === 'fazer' && fila.length && !(kbGestor() && !kbEstado.dono)){ kbHojeSelecionar(fila[0].chave); return; }
  const mostrarVazio = !kbEstado.fichaAlvo;
  vazio.hidden = !mostrarVazio;
  if(mostrarVazio) vazio.innerHTML = kbHojeVazioHtml();
  if(no.parentNode === slot) no.hidden = mostrarVazio;
}
function kbHojeVazioHtml(){
  if(kbGestor() && !kbEstado.dono) return '<div class="kbEmDia"><h3>Escolha um consultor</h3><p>Use o seletor acima para ver a fila de alguém da equipe.</p></div>';
  if(kbEstado.filaAba === 'livres') return '<div class="kbEmDia"><h3>Leads livres</h3><p>Clique num lead para ver a prévia e pegar.</p></div>';
  if(kbEstado.filaAba === 'alertas') return '<div class="kbEmDia"><h3>Alertas</h3><p>Clique num alerta para abrir o lead.</p></div>';
  const agoraMs = Date.now(), hoje = kbDiaSP(agoraMs), nome = ppPrimeiroNome();
  const prox = (kbEstado.leads || []).filter(l => !l.livre && l.retorno_em && String(l.retorno_em).slice(0, 10) > hoje).sort((a, b) => String(a.retorno_em).localeCompare(String(b.retorno_em)))[0];
  const livres = kbPodePegar() ? kbLivresHoje().length : 0;
  return `<div class="kbEmDia"><span class="kbEmDiaIco">${KB_ICO.check}</span><h3>${escapeHtml('Tudo em dia' + (nome ? ', ' + nome : '') + '.')}</h3>
    <p>Nenhum retorno vencido e nenhum lead sem ligação.${prox ? ` Seu próximo retorno é ${escapeHtml(ppFmtDia(String(prox.retorno_em).slice(0, 10)))} (${escapeHtml(prox.nome || '')}).` : ''}</p>
    ${livres ? `<button type="button" class="kbBtn kbBtnP kbBtnLg" data-kb-pegar-proximo>${KB_ICO.mao}Pegar o próximo livre (${livres} esperando)</button>` : ''}</div>`;
}
function kbHojeSelecionar(chave){
  if(kbEstado.fichaAlvo && kbEstado.fichaAlvo.aba + '|' + kbEstado.fichaAlvo.id !== chave && kbFichaSuja()){ mostrarAviso('Salve ou apague o que digitou antes de trocar de lead.', 'info'); return; }
  kbEstado.hojeSel = chave;
  document.querySelectorAll('#kbFilaLista [data-kb-fila]').forEach(b => b.classList.toggle('sel', b.dataset.kbFila === chave));
  const [aba, id] = chave.split('|');
  kbAbrirFicha(aba, id, { lista: kbEstado.filaAba === 'fazer' ? kbEstado.filaHoje : null });
}
// A ficha é um nó só: na Hoje mora no painel da direita; nas outras abas volta para a casa e abre como gaveta.
function kbFichaLugar(){
  if(kbEstado.fichaJanela) return;   // na janela flutuante, fica lá
  const no = kbFichaNo(), naHoje = kbEstado.aba === 'hoje';
  const destino = document.getElementById(naHoje ? 'kbHojeFicha' : 'kbFichaCasa');
  if(destino && no.parentNode !== destino) destino.appendChild(no);
  no.classList.toggle('noPainel', naHoje);
  if(!naHoje) no.hidden = false;
}
// Hoje: depois de salvar, recarrega e vai para o próximo da fila (ordem de antes); fora da Hoje, reabre o mesmo lead.
async function kbDepoisDeSalvar(alvo, opc){
  const antes = (kbEstado.filaHoje || []).slice(), chave = alvo.aba + '|' + alvo.id;
  const naHoje = kbEstado.aba === 'hoje' && kbFichaNo().classList.contains('noPainel');
  if(naHoje && opc && opc.proximo){ const el = document.querySelector(`#kbFilaLista [data-kb-fila="${chave.replace(/["\\]/g, '\\$&')}"]`); if(el) el.classList.add('kbSaindo'); }
  await kbCarregar();
  if(naHoje && opc && opc.proximo){
    const prox = kbProximoHoje(antes, chave, kbEstado.filaHoje || []);
    kbEstado.fichaAlvo = null;
    if(prox){ kbHojeSelecionar(prox); return; }
    kbEstado.hojeSel = null; kbRenderHoje(); return;
  }
  await kbAbrirFicha(alvo.aba, alvo.id);
}
async function kbDepoisDePegar(alvo){
  mostrarAviso('Lead pego. Ele já está na sua fila: ligue agora.', 'ok');
  if(kbEstado.aba === 'hoje'){ kbEstado.filaAba = 'fazer'; kbEstado.hojeSel = alvo.aba + '|' + alvo.id; kbRenderHoje(); }
  await kbAbrirFicha(alvo.aba, alvo.id, { lista: kbEstado.aba === 'hoje' ? kbEstado.filaHoje : null });
}
document.getElementById('kbHoje').addEventListener('click', (e) => {
  const ab = e.target.closest('[data-kb-fila-aba]');
  if(ab){
    kbEstado.filaAba = ab.dataset.kbFilaAba;
    if(!kbFichaSuja()){ kbEstado.fichaAlvo = null; kbEstado.hojeSel = null; }
    kbRenderHoje();
    return;
  }
  const it = e.target.closest('[data-kb-fila]');
  if(it) kbHojeSelecionar(it.dataset.kbFila);
});
```

Atenção: as versões de `kbDepoisDeSalvar` e `kbDepoisDePegar` acima **substituem** as da Task 3. Apague as definições antigas da Task 3 para não ficarem duas funções com o mesmo nome. A busca por `async function kbDepoisDeSalvar(` e por `async function kbDepoisDePegar(` tem que achar um resultado só de cada.

O seletor escapa aspas e barras do `aba|id` sem depender de `CSS.escape`, que o jsdom não tem.

3. `kbPegarProximoLivre`: trocar a função inteira por:

```js
async function kbPegarProximoLivre(){
  const livre = kbLivresHoje()[0] || (kbEstado.leads || []).filter(l => l.livre).sort((a, b) => (kbMs(a.criado_em_lead) || 0) - (kbMs(b.criado_em_lead) || 0))[0];
  if(!livre){ mostrarAviso('Nenhum lead livre agora.', 'info'); return; }
  const ok = await kbPegar(livre.aba, livre.lead_id);
  if(ok !== false) await kbDepoisDePegar({ aba: livre.aba, id: livre.lead_id });
}
```

4. `kbTrocarAba`: logo depois da linha `  kbEstado.aba = abas.includes(aba) ? aba : kbAbaPadrao(kbGestor());`, inserir:

```js
  // §126: saindo da Hoje a ficha volta a ser gaveta; fecha, a não ser que tenha algo digitado
  const no = kbFichaNo();
  if(kbEstado.aba !== 'hoje' && no.classList.contains('noPainel') && !kbEstado.fichaJanela && !kbFichaSuja()){ kbEstado.fichaAlvo = null; no.classList.remove('aberta'); }
  kbFichaLugar();
  document.getElementById('kbResumo').style.display = kbEstado.aba === 'hoje' ? 'none' : '';
```

E trocar `  if(kbEstado.aba === 'quadro') kbAjustarAltura();` por `  if(kbEstado.aba === 'quadro' || kbEstado.aba === 'hoje') kbAjustarAltura();`.

5. `kbAjustarAltura`: trocar a função inteira por:

```js
function kbAjustarAltura(){
  [['kbBoard', '--kb-altura', 420], ['kbHojeArea', '--kb-hoje-altura', 600]].forEach(([id, varCss, minimo]) => {
    const b = id === 'kbHojeArea' ? document.querySelector('#kbHoje .kbHojeArea') : document.getElementById(id);
    if(!b || b.offsetParent === null || !b.getBoundingClientRect) return;
    const topo = Math.max(0, b.getBoundingClientRect().top);
    b.style.setProperty(varCss, Math.max(minimo, Math.round(window.innerHeight - topo - 16)) + 'px');
  });
}
```

6. `kbCarregar`: trocar `  else if(kbEstado.aba === 'hoje') kbCarregarHoje();` por `  else if(kbEstado.aba === 'hoje') await kbCarregarHoje();`. O "Salvar e ir para o próximo" precisa da fila nova.

7. `kbRecolherFicha`: logo antes do `}` final da função, inserir `  kbFichaLugar(); if(kbEstado.aba === 'hoje') kbRenderHoje();`.

- [ ] **Step 6: Ajustar os testes antigos da Hoje**

`test_leads_hoje.js`:
1. Apagar as 4 linhas `eq(kbProximoDaFila(…` e a linha `const fila = …` que as prepara, logo acima delas, se ela só servir a esses testes.
2. Trocar o trecho de `  assert(document.getElementById('kbHoje').textContent.includes('Zz Retorno') && document.querySelector('#kbHoje [data-kb-ver-alertas]'), 'Hoje mostra retornos (Faça agora) e a linha de alertas');` até `  kbFecharFicha();` (o primeiro depois dele) por:

```js
  const filaTxt = document.getElementById('kbFilaLista').textContent;
  assert(filaTxt.includes('Atrasados') && filaTxt.includes('Zz Retorno') && filaTxt.includes('Agora') && filaTxt.includes('Zz Hoje Um'), 'Hoje mostra a fila em grupos (retorno vencido em Atrasados, novo em Agora)');
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha' && c.args.p_id === 'h2'), 'a ficha do primeiro da fila já abre ao lado');
  assert(document.getElementById('kbFichaResumo').textContent.includes('2 tentativas') && document.getElementById('kbFichaAnuncio').textContent.includes('Zz Conj'), 'ficha mostra resumo e anúncio');
  kbFecharFicha();
```

`test_leads_painel_hoje.js`, no bloco `// ==== Task 5 ====`:
1. Apagar as duas linhas `eq(kbCartoesHoje(…` e as quatro de `kbFacaAgora` (`const fz = …` e os três `eq` dele). As de `kbListaDoCartao` e `kbListaCartaoHtml` continuam, porque a Equipe usa.
2. Trocar o trecho de `  const hoje = document.getElementById('kbHoje');` até `  kbEstado.podePegar = true;` (inclusive) por:

```js
  const hoje = document.getElementById('kbHoje');
  assert(hoje.querySelector('#kbHojeTopo').textContent.includes('23') && hoje.textContent.includes('/ 80') && hoje.textContent.includes('1 de 2') && hoje.querySelector('#kbHojeTopo').textContent.includes('7'), 'placar: ligações/meta, classificações, retornos cumpridos');
  assert(!document.getElementById('kbFilaLista').textContent.includes('Zz Venda'), 'convertido não entra na fila');
  eq([...document.querySelectorAll('#kbFilaLista [data-kb-fila]')].map(b => b.dataset.kbFila), ['O|a2', 'O|n2', 'O|n1', 'O|a1'], 'fila: atrasado, novos (pegos há mais tempo primeiro), parado');
  hoje.querySelector('[data-kb-fila-aba="alertas"]').click();
  assert(document.getElementById('kbFilaLista').textContent.includes('Parado em andamento'), 'aba Alertas lista os alertas');
  hoje.querySelector('[data-kb-fila-aba="livres"]').click();
  assert(hoje.querySelector('#kbFilaLista [data-kb-pegar-proximo]') && document.getElementById('kbFilaNLivres').textContent === '1', 'quem pega vê Pegar o próximo livre e quantos esperam');
  kbEstado.podePegar = false;
  kbRenderHoje();
  assert(hoje.querySelector('[data-kb-fila-aba="livres"]').style.display === 'none', 'quem não pega não vê a aba Livres');
  kbEstado.podePegar = true;
  hoje.querySelector('[data-kb-fila-aba="fazer"]').click();
  kbFecharFicha(); kbEstado.fichaAlvo = null;
```

Atenção: na fixture L5, `n1` (pego às 09:00) tem retorno hoje às 17:30. Ele entra em "Agora" como lead novo, que vence a vaga do retorno porque cada lead aparece uma vez. `n2` foi pego às 08:00, então vem antes. A ordem esperada fica a2, n2, n1, a1.

- [ ] **Step 7: Rodar tudo**

Run: `node test_meus_leads_redesign.js && node test_leads_kanban.js && node test_leads_hoje.js && node test_leads_painel_hoje.js`
Expected: os quatro com `0 falharam`.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_meus_leads_redesign.js test_leads_hoje.js test_leads_painel_hoje.js
git commit -m "feat(meus-leads): Hoje B com fila em grupos e ficha ao lado, Salvar e ir para o proximo (secao 126.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificação, prévia para o Rafael e publicação

**Files:**
- Modify: `REGRAS_NEGOCIO.md`, só depois de publicar.

- [ ] **Step 1: Suíte inteira e build**

Run: `bash run_tests.sh`
Expected: `TOTAL: N passaram, 0 falharam`. "Pulado" só vale para os testes de planilha real.

- [ ] **Step 2: Conferências do arquivo**

Run:
```bash
git diff oficial/main -- _template.html | grep -c "^+.*<div" ; git diff oficial/main -- _template.html | grep -c "^+.*</div>"
grep -c "kbClassOverlay\|kbRetornoRapido\|kbCartoesHoje\|kbFacaAgora\|kbProximoDaFila" _template.html
grep -n "data-apex-visual\|<aside class=\"sidebar\">" _template.html | head -2
```
Expected:
- **primeira linha:** a contagem de `<div` e de `</div>` adicionados é coerente. Abrir o `painel_clientes_apex.html` gerado e conferir que todas as `section.panel` estão no mesmo contêiner. O teste "todas as abas … dentro do mesmo contêiner" já cobre isso;
- **segunda linha:** `0`;
- **terceira linha:** o design atual está presente.

- [ ] **Step 3: Prévia com prints**
  - Abrir o painel gerado no Chrome com o login do Rafael, ou servir local e logar.
  - Tirar prints da Hoje B em 1440 px e em 390 px.
  - Tirar prints da ficha em gaveta, aberta pelo Quadro, e da ficha flutuante.
  - Mostrar os prints ao Rafael e pedir o **ok explícito para publicar**.
  - Não publicar sem ele.

- [ ] **Step 4: Publicar (só com o ok)**
  - Seguir a memória "Publicação do painel":
    - `git fetch oficial` e juntar o que tiver entrado na `oficial/main`, nunca sobrescrever;
    - baixar o painel do ar e comparar;
    - backup e MD5 do ar **no mesmo comando** do envio;
    - vigia `-Aceitar`.
  - Anotar o MD5 novo e o nome do backup.

- [ ] **Step 5: REGRAS, commit e push**
  - Escrever no `REGRAS_NEGOCIO.md` a seção **§126.1**, no mesmo formato das §122–§125:
    - o pedido;
    - o que mudou para o consultor e para o supervisor;
    - o que saiu: a janela Classificar, a Hoje antiga e o retorno rápido da ficha;
    - as 5 decisões da seção 9;
    - a publicação, com hora, MD5, backup e como voltar atrás. Para voltar: republicar o backup e reverter os commits da fase.
  - Depois:
    - `git add REGRAS_NEGOCIO.md && git commit` (com o Co-Authored-By);
    - `git fetch oficial`;
    - `git push oficial feat/meus-leads-redesign:main`, sem force, só com o ok do Rafael para o push.
  - Atualizar a memória `apex-meus-leads-redesign`: Fase 1 no ar e próxima é a Fase 2.
