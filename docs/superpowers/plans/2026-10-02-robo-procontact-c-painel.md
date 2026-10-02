# Robô ProContact — Plano C: faixa de aviso "sincronização das ligações parada" no painel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a admin e supervisor uma faixa no topo do painel quando a sincronização automática das ligações (robô ProContact) ficar mais de 3 horas **úteis** sem sucesso, e registrar a feature em `REGRAS_NEGOCIO.md`.

**Architecture:** O painel lê a última linha `ok = true` de `ligacoes_sync_log` (Plano A) e calcula, em JavaScript puro, quantos minutos de expediente (seg–sáb, 07–22h, São Paulo) passaram desde então. Sem cron nem função nova: reaproveita os mesmos pontos de disparo da faixa de produção (`verificarAlertaSyncProducao`). Não mexe no design.

**Tech Stack:** HTML/JS único (`_template.html` → `build_painel.py` → `painel_clientes_apex.html`), jsdom nos testes, Supabase (leitura com RLS admin/supervisor).

**Spec:** `docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md` (seções 4 e 9). **Depende do Plano A** (tabela `ligacoes_sync_log` existente no banco) para funcionar no ar; os testes não dependem.

## Global Constraints

- Trabalhar no worktree `.worktrees/robo-procontact` (branch `feat/robo-procontact`, base `oficial/main`); `git fetch oficial` antes de qualquer merge/push; push sem `--force`, **só com autorização explícita do Rafael**.
- Editar **só** o `_template.html` (o `painel_clientes_apex.html` é gerado por `python build_painel.py`, nunca à mão). Manter o `_template.html` em **LF**.
- **O design não muda**: não mexer no bloco `<style>` do "Sinal de Ápice", no menu lateral, no cabeçalho de página nem em `ApexMotion`/`mostrarAviso`/`fecharOverlay`. A faixa reaproveita `.card`, `role="alert"` e variáveis de cor (`var(--st-perdido)`, `var(--st-perdido-bg)`), **sem cor fixa em hex**.
- Texto da faixa em português, sem `alert()`.
- **Publicar no ar só com autorização explícita do Rafael**, depois de baixar o painel no ar e compará-lo com o do repositório (se tiver algo que o repo não tem, juntar, nunca sobrescrever). Backup no servidor antes; MD5 depois; vigia atualizado; registro em `REGRAS_NEGOCIO.md`.
- Seção nova de `REGRAS_NEGOCIO.md`: usar o **próximo número livre** depois de `git fetch oficial` (na base de hoje a última é a 65).
- Baseline de testes conhecido e **não relacionado**: `test_conversao_vendas.js` (relógio) e `test_pedidos_alerta.js` (falta `exceljs`) falham mesmo na `oficial/main`; o critério é "nenhuma falha nova".

## Review Focus

1. Tabela `ligacoes_sync_log` vazia (robô ainda não ligado) → **nenhuma faixa** (não pode acusar problema antes da feature existir).
2. Última sincronização no **domingo** ou **depois das 22h** → o tempo parado fora do expediente **não conta** (sábado 21:30 → segunda 08:00 = 90 min, sem faixa).
3. Exatamente 180 min úteis → sem faixa; 181 → com faixa (limite é "mais de 3 h").
4. Consulta falha (sem permissão/rede) → faixa escondida, tela não quebra (mesmo critério da faixa de produção).
5. **Consultor** nunca vê nem consulta a tabela; sem usuário logado, faixa escondida; sair do sistema esconde.
6. Parado há mais de 14 dias → faixa (sem travar o navegador com laço longo).
7. A faixa nova não interfere na faixa de produção (as duas podem aparecer juntas; o teste existente `test_alerta_sync_banner.js` continua verde).

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `_template.html` | Nova `<div id="syncLigacoesBanner">` logo antes da faixa de produção; funções `ligMinutosUteisSemSync` e `verificarSyncLigacoes` antes de `verificarAlertaSyncProducao`; uma chamada nova no começo de `verificarAlertaSyncProducao` |
| `test_ligacoes_sync_banner.js` | Novo teste (jsdom), no padrão de `test_alerta_sync_banner.js` |
| `painel_clientes_apex.html` | Regenerado por `python build_painel.py` (commitado, como nos outros trabalhos) |
| `REGRAS_NEGOCIO.md` | Seção nova (próximo número livre) |

---

### Task 1: Teste que falha (faixa + cálculo de horas úteis)

**Files:**
- Create: `test_ligacoes_sync_banner.js`

**Interfaces:**
- Produces (a implementação da Task 2 precisa satisfazer): função global `ligMinutosUteisSemSync(ultimoOkMs: number, agoraMs: number): number` (minutos de expediente entre as duas datas; `Infinity` se passar de 14 dias), constante `LIG_SYNC_LIMITE_MIN = 180`, função `async verificarSyncLigacoes(): Promise<void>`, elementos `#syncLigacoesBanner` (dentro de `#appMain`, `role="alert"`) e `#syncLigacoesTexto`.

- [ ] **Step 1: Confirmar a base limpa e anotar o baseline dos testes**

Run: `git fetch oficial && git status --short | head && git log --oneline -1 && bash run_tests.sh test_alerta_sync_banner.js`
Expected: árvore limpa (a não ser pelos arquivos desta feature), teste existente passa. Rodar também `bash run_tests.sh` uma vez e anotar quais testes já falham antes de qualquer mudança (esperado: `test_conversao_vendas.js` e `test_pedidos_alerta.js`).

- [ ] **Step 2: Escrever `test_ligacoes_sync_banner.js`**

```js
// Faixa de aviso "sincronização das ligações parada" (robô ProContact, spec 2026-10-01-robo-procontact-ligacoes-design.md).
// Aparece no topo para admin e supervisor quando a última sincronização com sucesso (ligacoes_sync_log) tem mais de
// 3 horas ÚTEIS (seg-sáb, 07-22h, São Paulo). Sem nenhuma linha no log (robô ainda não ligado) não mostra nada.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__ligOk = null;      // linha devolvida pela consulta (ou null = nenhuma sincronização registrada)
window.__ligErro = false;   // simula falha na consulta
window.__ligConsultas = 0;  // quantas vezes ligacoes_sync_log foi consultada
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => ({
    select: () => {
      const b = {
        eq: () => b, is: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => {
          if(table === 'ligacoes_sync_log'){
            window.__ligConsultas++;
            if(window.__ligErro) throw new Error('boom: sem permissão');
            return { data: window.__ligOk, error: null };
          }
          return { data: null, error: null };
        },
        range: () => ({ then: (resolve) => resolve({ data: [], error: null }) }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return b;
    },
  }),
  functions: { invoke: async () => ({data:{},error:null}) },
})) };

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  const banner = () => document.getElementById('syncLigacoesBanner');
  const visivel = () => banner().style.display !== 'none';
  const texto = () => banner().textContent;
  // São Paulo = UTC-3. 02/10/2026 é sexta; 03 sábado; 04 domingo; 05 segunda.
  const utc = (iso) => new Date(iso).getTime();

  // --- 1) estrutura: existe, escondida, anunciada como alerta e dentro de #appMain ---
  assert(banner() !== null, 'faixa syncLigacoesBanner existe');
  assert(banner().parentElement.id === 'appMain', 'a faixa fica dentro de #appMain');
  assert(banner().getAttribute('role') === 'alert', 'a faixa tem role="alert"');
  assert(!visivel(), 'a faixa começa escondida');
  assert(typeof verificarSyncLigacoes === 'function', 'verificarSyncLigacoes existe');
  assert(typeof ligMinutosUteisSemSync === 'function', 'ligMinutosUteisSemSync existe');
  assert(LIG_SYNC_LIMITE_MIN === 180, 'limite de 180 minutos úteis');
  assert(!/#[0-9a-fA-F]{3,6}\\b/.test(banner().getAttribute('style') || ''), 'a faixa não usa cor fixa em hex');

  // --- 2) cálculo de minutos úteis (função pura) ---
  const sex10 = utc('2026-10-02T13:00:00Z'); // sexta 10:00 SP
  assert(ligMinutosUteisSemSync(sex10, sex10 + 10 * 60000) === 10, '10 minutos em horário útil = 10');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 180 * 60000) === 180, 'exatamente 3 h úteis = 180');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 181 * 60000) === 181, '3 h e 1 min úteis = 181');
  assert(ligMinutosUteisSemSync(sex10, sex10) === 0 && ligMinutosUteisSemSync(sex10, sex10 - 60000) === 0, 'agora <= último ok = 0');
  assert(ligMinutosUteisSemSync(NaN, sex10) === 0, 'data inválida = 0');
  // sexta 20:00 SP -> sábado 09:00 SP: 2 h (sexta 20-22) + 2 h (sábado 07-09) = 240
  assert(ligMinutosUteisSemSync(utc('2026-10-02T23:00:00Z'), utc('2026-10-03T12:00:00Z')) === 240, 'sexta 20h -> sábado 9h = 240 min úteis');
  // sábado 21:30 SP -> segunda 08:00 SP: 30 min (sábado) + domingo inteiro (0) + 60 min (segunda 07-08) = 90
  assert(ligMinutosUteisSemSync(utc('2026-10-04T00:30:00Z'), utc('2026-10-05T11:00:00Z')) === 90, 'sábado 21:30 -> segunda 8h = 90 min úteis');
  // domingo o dia todo = 0
  assert(ligMinutosUteisSemSync(utc('2026-10-04T12:00:00Z'), utc('2026-10-04T23:00:00Z')) === 0, 'domingo = 0');
  // noite (22h-07h) = 0
  assert(ligMinutosUteisSemSync(utc('2026-10-03T01:00:00Z'), utc('2026-10-03T09:00:00Z')) === 0, 'sexta 22h -> sábado 6h = 0');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 15 * 24 * 3600000) === Infinity, 'parado há mais de 14 dias = Infinity');

  const recente = () => new Date(Date.now() - 10 * 60000).toISOString();
  const antigo = () => new Date(Date.now() - 30 * 24 * 3600000).toISOString();

  // --- 3) tabela vazia (robô ainda não ligado): nenhuma faixa ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = null;
  await verificarSyncLigacoes();
  assert(!visivel(), 'sem nenhuma sincronização registrada, a faixa não aparece');

  // --- 4) sincronização recente: sem faixa ---
  window.__ligOk = { terminou_em: recente() };
  await verificarSyncLigacoes();
  assert(!visivel(), 'sincronização de 10 minutos atrás: sem faixa');

  // --- 5) sincronização antiga: admin e supervisor veem, com a data e o caminho do upload manual ---
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  assert(visivel(), 'admin vê a faixa quando a última sincronização é antiga');
  assert(texto().includes('Monitoramento Leads'), 'texto cita o Monitoramento Leads (' + texto() + ')');
  assert(!texto().includes('null') && !texto().includes('Invalid') && !texto().includes('undefined'), 'texto não vaza null/Invalid/undefined (' + texto() + ')');
  currentUser = { id: 'u2', nome: 'Sup', username: 'sup', role: 'supervisor' };
  await verificarSyncLigacoes();
  assert(visivel(), 'supervisor também vê a faixa');

  // --- 6) consultor: nunca vê e nem consulta ---
  currentUser = { id: 'u3', nome: 'Cons', username: 'cons', role: 'consultor' };
  const antes = window.__ligConsultas;
  await verificarSyncLigacoes();
  assert(!visivel(), 'consultor não vê a faixa');
  assert(window.__ligConsultas === antes, 'consultor nem consulta a tabela');

  // --- 7) voltou a sincronizar: a faixa some ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  assert(visivel(), 'faixa visível com sincronização antiga');
  window.__ligOk = { terminou_em: recente() };
  await verificarSyncLigacoes();
  assert(!visivel(), 'com sincronização recente a faixa some');

  // --- 8) falha na consulta: não quebra e não deixa a faixa presa ---
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  window.__ligErro = true;
  let lancou = false;
  try { await verificarSyncLigacoes(); } catch(e){ lancou = true; }
  assert(!lancou, 'falha na consulta não lança');
  assert(!visivel(), 'falha na consulta esconde a faixa');
  window.__ligErro = false;

  // --- 9) sem usuário logado: escondida ---
  currentUser = null;
  await verificarSyncLigacoes();
  assert(!visivel(), 'sem usuário logado a faixa fica escondida');

  // --- 10) ligada aos pontos de disparo existentes (sem timer próprio) ---
  assert(String(verificarAlertaSyncProducao).includes('verificarSyncLigacoes'), 'verificarAlertaSyncProducao também verifica a faixa das ligações');
  const esperar = () => new Promise(r => setTimeout(r, 30));
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = { terminou_em: antigo() };
  window.dispatchEvent(new window.Event('focus'));
  await esperar();
  assert(visivel(), 'ao voltar o foco para a janela a faixa é atualizada');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

(async () => {
  await window.eval('(async () => {' + jsCode + testScript + '})()');
  setTimeout(() => {
    if(window.__testResult !== 'OK') process.exitCode = 1;
  }, 500);
})();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bash run_tests.sh test_ligacoes_sync_banner.js`
Expected: FAIL (`syncLigacoesBanner` não existe / funções indefinidas).

- [ ] **Step 4: Commit do teste**

```bash
git add test_ligacoes_sync_banner.js
git commit -m "test(ligacoes): faixa de sincronização das ligações parada (horas úteis)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Implementar a faixa no `_template.html`

**Files:**
- Modify: `_template.html` (três pontos: HTML da faixa, funções novas, uma chamada)
- Regenerate: `painel_clientes_apex.html`

**Interfaces:**
- Consumes: `sb` (cliente Supabase), `currentUser`, `ligacoes_sync_log(terminou_em, ok)` (Plano A).
- Produces: as funções e elementos exigidos pelo teste da Task 1.

- [ ] **Step 1: Inserir o HTML da faixa (antes da faixa de produção)**

Em `_template.html`, trocar:

```html
    <!-- Aviso de sincronização da produção parada (admin/supervisor) — ver verificarAlertaSyncProducao() -->
```

por:

```html
    <!-- Aviso de sincronização das ligações parada (admin/supervisor) — ver verificarSyncLigacoes() -->
    <div id="syncLigacoesBanner" class="card" role="alert" style="display:none;border-left:4px solid var(--st-perdido);background:var(--st-perdido-bg);margin-bottom:14px">
      <b>Sincronização das ligações parada.</b> <span id="syncLigacoesTexto"></span>
    </div>
    <!-- Aviso de sincronização da produção parada (admin/supervisor) — ver verificarAlertaSyncProducao() -->
```

- [ ] **Step 2: Inserir as funções (antes de `verificarAlertaSyncProducao`)**

Trocar:

```js
async function verificarAlertaSyncProducao(){
  const el = document.getElementById('syncAlertaBanner');
  if(!el) return;
```

por:

```js
/* ============ Faixa de aviso: sincronização das ligações (robô ProContact) parada — admin/supervisor ============ */
// O robô (repositório privado apex-robo-procontact) grava uma linha em ligacoes_sync_log a cada execução.
// Aqui só se avisa se a última com sucesso ficou para trás por mais de 3 h ÚTEIS (seg-sáb, 07-22h, São Paulo).
// Sem nenhuma linha (robô ainda não ligado) não se mostra nada.
const LIG_SYNC_LIMITE_MIN = 180;
function ligMinutosUteisSemSync(ultimoOkMs, agoraMs){
  if(!Number.isFinite(ultimoOkMs) || !Number.isFinite(agoraMs) || agoraMs <= ultimoOkMs) return 0;
  const PASSO = 5 * 60000;
  let min = 0;
  for(let t = ultimoOkMs, i = 0; t < agoraMs; t += PASSO, i++){
    if(i >= 12 * 24 * 14) return Infinity;      // parado há mais de 14 dias
    const sp = new Date(t - 3 * 3600000);        // São Paulo = UTC-3 fixo
    const h = sp.getUTCHours(), d = sp.getUTCDay();
    if(d !== 0 && h >= 7 && h < 22) min += Math.min(5, (agoraMs - t) / 60000);
  }
  return min;
}
async function verificarSyncLigacoes(){
  const el = document.getElementById('syncLigacoesBanner');
  if(!el) return;
  const podeVer = currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor');
  if(!podeVer){ el.style.display = 'none'; return; }
  let ultimo = null;
  try{
    const { data, error } = await sb.from('ligacoes_sync_log').select('terminou_em')
      .eq('ok', true).order('terminou_em', { ascending: false }).limit(1).maybeSingle();
    if(error) throw error;
    ultimo = data;
  }catch(err){
    // sem como confirmar: não mostra um aviso que pode ser falso, e não quebra a tela
    console.error('verificarSyncLigacoes:', err);
    el.style.display = 'none';
    return;
  }
  if(!ultimo || !ultimo.terminou_em){ el.style.display = 'none'; return; }
  const ms = new Date(ultimo.terminou_em).getTime();
  if(!(ligMinutosUteisSemSync(ms, Date.now()) > LIG_SYNC_LIMITE_MIN)){ el.style.display = 'none'; return; }
  const quando = Number.isFinite(ms)
    ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'data desconhecida';
  document.getElementById('syncLigacoesTexto').textContent = 'A última sincronização automática das ligações foi em ' + quando
    + '. O Monitoramento Leads pode estar desatualizado; enquanto isso, envie o relatório à mão em Digital → Monitoramento Leads e avise o responsável técnico.';
  el.style.display = 'block';
}

async function verificarAlertaSyncProducao(){
  verificarSyncLigacoes(); // faixa das ligações (robô ProContact): mesmos pontos de disparo, sem timer próprio
  const el = document.getElementById('syncAlertaBanner');
  if(!el) return;
```

- [ ] **Step 3: Rodar o teste novo e o da faixa de produção**

Run: `bash run_tests.sh test_ligacoes_sync_banner.js && bash run_tests.sh test_alerta_sync_banner.js`
Expected: os dois PASS (o segundo prova que a faixa de produção segue intacta).

- [ ] **Step 4: Rodar a suíte inteira e comparar com o baseline**

Run: `bash run_tests.sh`
Expected: nenhuma falha **além** das do baseline anotado na Task 1 (`test_conversao_vendas.js`, `test_pedidos_alerta.js`). Se aparecer outra falha, investigar antes de seguir.

- [ ] **Step 5: Conferir que o design não foi tocado**

Run: `git diff --stat oficial/main -- _template.html && git diff oficial/main -- _template.html | grep -E "^[-+]" | grep -v -E "syncLigacoes|verificarSyncLigacoes|ligMinutosUteis|LIG_SYNC|Sincronização das ligações|^(\+\+\+|---)" | head -40`
Expected: o diff do `_template.html` contém só linhas desta feature (nenhuma mudança em `<style>`, menu, cabeçalho ou ApexMotion). Linhas fora desse padrão, se houver, são as do corpo das funções novas; nenhuma deve estar fora das três regiões descritas.

- [ ] **Step 6: Commit**

```bash
git add _template.html painel_clientes_apex.html
git commit -m "feat(painel): faixa de aviso quando a sincronização das ligações para (3 h úteis)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Registrar em `REGRAS_NEGOCIO.md`

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (seção nova no fim do arquivo)

- [ ] **Step 1: Descobrir o próximo número livre**

Run: `git fetch oficial && git show oficial/main:REGRAS_NEGOCIO.md | grep -n "^## [0-9]" | tail -3`
Expected: a última seção (hoje a 65). O número novo é o seguinte (N). Se o `main` andou, usar o próximo livre e **não** reaproveitar números.

- [ ] **Step 2: Acrescentar a seção ao fim do arquivo**

(Substituir `N` pelo número livre.)

```markdown
## N. Sincronização automática das chamadas manuais (robô ProContact) (02/10/2026)

- **O quê:** o relatório de Chamadas Manuais do ProContact (telefonia, sem API) passa a chegar sozinho em `ligacoes_manuais`, de hora em hora, das 07h às 22h, de segunda a sábado (horário de São Paulo). O upload manual de **Digital → Monitoramento Leads** continua existindo como contingência.
- **Como:** um robô (Playwright) num repositório **privado** `apex-robo-procontact` (GitHub Actions) entra no ProContact, exporta *Relatório → Call Center → Chamadas Manuais* (do dia 1 do mês até hoje; nos dias 1 e 2, desde o dia 1 do mês anterior) e envia as linhas em lotes de 500 à Edge Function `ingest-ligacoes` (Supabase `apex`), que valida e faz `upsert` por `id` — reenviar o período inteiro não duplica. As regras do relatório são as da seção 59.3 e 65 (colunas obrigatórias, `chave_tel`, usuários `eagle*` fora, tabulação como vem).
- **Segurança:** o robô nunca recebe a chave do banco; só um token próprio (`x-robo-token`, secret `INGEST_LIGACOES_TOKEN` na função e `INGEST_TOKEN` no GitHub). Senha do ProContact só nos *secrets* do GitHub, numa conta exclusiva do robô com permissão só de relatórios. Nenhum telefone em log; sem screenshots nem *traces*. Repositório público nunca recebe segredo nem dado de cliente.
- **Banco:** migration `supabase/migrations/20261002000000_ligacoes_sync_log.sql` (rollback em `supabase/rollback/`), tabela `ligacoes_sync_log` (uma linha por execução: `ok`, `lidas`, `enviadas`, `invalidas`, `ignoradas_eagle`, período, erro curto); leitura só admin/supervisor, escrita só pela função.
- **Aviso no painel:** faixa "Sincronização das ligações parada" para admin/supervisor quando a última execução com sucesso passou de **3 h úteis** (seg–sáb, 07–22h); sem nenhuma linha no log (robô ainda não ligado) não aparece. Função `verificarSyncLigacoes()` no `_template.html`, disparada pelos mesmos pontos da faixa da seção 52.
- **Liga/desliga:** variável de repositório `ROBO_ATIVO` (`true` liga o agendamento; qualquer outro valor desliga). Execução manual: Actions → *Run workflow* → `dry` (só confere, não grava) ou `real`. Revogar acesso: trocar o token nos dois lados.
- **Spec e planos:** `docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md`; planos A (banco e função), B (robô) e C (painel) em `docs/superpowers/plans/2026-10-02-robo-procontact-*.md`.
- **Riscos conhecidos:** o ProContact pode bloquear IPs do GitHub; mudança de layout quebra o robô (a falha vira linha `ok=false` no log e e-mail do GitHub); termos de uso do ProContact precisam permitir acesso automatizado (decisão do Rafael).
- **Publicação:** registrar aqui, na hora de publicar, a data/hora, o MD5 do painel, o backup e como reverter (Task 4 do Plano C).
```

- [ ] **Step 3: Commit**

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): seção N — sincronização automática das chamadas manuais (robô ProContact)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Publicar no ar (somente com autorização explícita e depois do Plano A)

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (registro da publicação)

**Pré-condições:** Plano A concluído (tabela `ligacoes_sync_log` existe no Supabase; sem ela a faixa fica escondida por erro de consulta, o que é seguro, mas não útil). Rafael diz "pode publicar".

- [ ] **Step 1: Atualizar a base e regenerar**

```bash
git fetch oficial
git merge oficial/main          # se houver conflito no _template.html: ver o aviso abaixo
bash run_tests.sh               # nenhuma falha além do baseline
```

Aviso (de `CLAUDE.md` e da memória do projeto): conflitos no `_template.html` costumam ser a linha base64 do dashboard — decodificar base/ours/theirs, `git merge-file`, depois `python dashboard_tpl.py empacotar` e `python build_painel.py`. Manter LF. `REGRAS_NEGOCIO.md`: renumerar a seção se o número já foi tomado.

- [ ] **Step 2: Comparar o painel no ar com o do repositório (antes da mudança)**

```bash
curl -s https://apexsmart.com.br/painel_clientes_apex.html -o /tmp/painel_no_ar.html
git show oficial/main:painel_clientes_apex.html > /tmp/painel_oficial_main.html
md5sum /tmp/painel_no_ar.html /tmp/painel_oficial_main.html
```

Expected: MD5 **iguais**. Se forem diferentes, alguém publicou por fora: **parar**, juntar as duas versões (nunca sobrescrever) e avisar o Rafael.

- [ ] **Step 3: Pedir autorização e publicar com backup**

Perguntar: "O painel no ar é idêntico à `oficial/main`. Posso publicar a faixa de aviso das ligações (backup antes, MD5 depois)?" Só com "sim":

```bash
STAMP=$(date +%Y%m%d_%H%M%S)
ssh hostinger "cp domains/apexsmart.com.br/public_html/painel_clientes_apex.html ~/deploy_backups/painel_clientes_apex_${STAMP}_antes_faixa_ligacoes.html && ls -l ~/deploy_backups/painel_clientes_apex_${STAMP}_antes_faixa_ligacoes.html"
scp painel_clientes_apex.html hostinger:domains/apexsmart.com.br/public_html/painel_clientes_apex.html
md5sum painel_clientes_apex.html
curl -s https://apexsmart.com.br/painel_clientes_apex.html | md5sum
```

Expected: os dois MD5 finais **iguais**. Se diferirem, restaurar o backup e investigar:
`ssh hostinger "cp ~/deploy_backups/painel_clientes_apex_${STAMP}_antes_faixa_ligacoes.html domains/apexsmart.com.br/public_html/painel_clientes_apex.html"`.

- [ ] **Step 4: Atualizar o vigia**

O vigia fica na pasta principal (`apex-smart-solutions/vigia/`), não neste worktree:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:/Users/acer1/Downloads/apex-smart-solutions/vigia/vigia_painel.ps1" -Aceitar
```

- [ ] **Step 5: Registrar a publicação e enviar (com autorização)**

Acrescentar ao fim da seção N de `REGRAS_NEGOCIO.md` a linha de publicação com os valores **reais** obtidos acima (data/hora de São Paulo, MD5 publicado, caminho do backup, comando para reverter), commitar e, só com autorização para push na `main` do repositório oficial:

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): registra a publicação da seção N (MD5, backup, como reverter)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git fetch oficial && git merge oficial/main   # a main anda várias vezes por dia
git push oficial HEAD:main                    # sem --force
```

- [ ] **Step 6: Verificar no navegador**

Entrar no painel como admin; a faixa **não** deve aparecer enquanto `ligacoes_sync_log` estiver vazia ou recente. Para ver a faixa uma vez, inserir (com ok do Rafael) uma linha de teste antiga e removê-la depois, ou confiar nos testes automatizados (cobrem os dois estados).

**Critério de pronto do Plano C:** teste novo e o da faixa de produção passam; suíte inteira sem falhas além do baseline; painel publicado com MD5 conferido; seção registrada em `REGRAS_NEGOCIO.md`.
