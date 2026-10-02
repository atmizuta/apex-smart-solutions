# Robô ProContact — Plano B: o robô (repositório privado `apex-robo-procontact`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um robô agendado no GitHub Actions que entra no ProContact, exporta o relatório de Chamadas Manuais (dia 1 do mês até hoje), lê o Excel e envia as linhas à função `ingest-ligacoes` (Plano A), de hora em hora das 7h às 22h (seg–sáb, São Paulo).

**Architecture:** Lógica pura e testável em módulos pequenos (`expediente`, `periodo`, `parse`, `enviar`), um orquestrador `executar(cfg, io)` com tudo que toca o mundo injetado (por isso testável sem navegador nem rede), e uma casca de navegador (`procontact.js`, Playwright) que só é exercitada nos ensaios reais. O robô nunca recebe a chave do banco: fala com a função por um token próprio.

**Tech Stack:** Node 24 (ESM), Playwright (Chromium), `xlsx` 0.18.5 (SheetJS, o mesmo do painel), `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md` (seções 4, 5, 7, 8, 9, 10). **Depende do Plano A** (função publicada e token cadastrado) para os ensaios reais (Task 7), não para os testes das Tasks 1–5.

## Global Constraints

- **Repositório privado novo**, fora do repositório público `atmizuta/apex-smart-solutions`. Pasta local: `C:\Users\acer1\Downloads\apex-robo-procontact` (não dentro de `apex-smart-solutions`). Criar o repositório no GitHub, cadastrar secrets e ligar o agendamento **só com ok explícito do Rafael**.
- Segredos **somente** nos *secrets* do GitHub: `PROCONTACT_URL`, `PROCONTACT_USUARIO`, `PROCONTACT_SENHA`, `INGEST_URL`, `INGEST_TOKEN`. Nada disso em arquivo, commit, log ou chat. O robô **não** conhece a chave do banco.
- Nunca imprimir telefone, nome, usuário da telefonia ou linha do relatório em log, mensagem de erro ou *artifact*; logs só têm contagens. Sem screenshots nem *traces* do Playwright (a tela de resultado tem telefones).
- O arquivo exportado fica numa pasta temporária do runner e é apagado no fim (`finally`).
- Horário de referência: São Paulo, UTC−3 fixo (sem horário de verão desde 2019).
- Expediente: segunda a sábado, das 07:00 às 21:59 (hora < 22). Fora disso a execução agendada sai com código 0 sem acessar o ProContact.
- Período: dia 1 do mês 00:00 até hoje 23:59; nos dias 1 e 2 começa no dia 1 do mês anterior.
- Lotes de 500 linhas; **sem retentativas automáticas** (1 execução por hora; um erro vira registro no log e aviso do GitHub).
- Regras do relatório idênticas ao upload manual do painel (REGRAS_NEGOCIO.md 59.3 e 65): colunas obrigatórias `ID`, `Usuario`, `Telefone`, `Status`, `DataHora_Geracao`; cabeçalho sem acento/caixa/espaços; `eagle*` fora; `tabulacao` como vem (inclusive `-`); `atendida` = `Status == "ANSWERED"`; `seg_falados` = `Tempo_Chamada` (`hh:mm:ss`) em segundos.

## Review Focus

1. Execução agendada num **domingo** ou às **22:00** (ou 06:59) → não acessa o ProContact e sai 0; manual (`FORCAR=true`) ignora o expediente.
2. Dia **1 e 2 do mês** e **1º de janeiro** → período começa no mês/ano anterior; 23:00 do dia 30 em São Paulo ainda é dia 30 (não vira dia 1 por causa do UTC).
3. Relatório com **`UniqueID` duplicado** no cabeçalho, linha com `ID` vazio, data fora do formato, `eagle.*` e `ID` repetido → contados e ignorados sem derrubar o resto.
4. Relatório **só com cabeçalho** (sem ligações) → sucesso com 0 linhas, nada enviado, log `ok` gravado.
5. Relatório **sem uma coluna obrigatória** (site mudou) → erro claro, registrado em `ligacoes_sync_log`, código 1.
6. Função devolve **500 no meio dos lotes** → para no primeiro erro (sem retentativa), registra `ok=false`, código 1; falha ao registrar o erro **não** esconde o erro original.
7. Login recusado, tela mudada, download que não vem → erro com mensagem sem dados, código 1.
8. Variável de ambiente ausente → falha imediata e clara, sem tentar o login.

---

## File Structure

```
apex-robo-procontact/
  package.json
  .gitignore
  README.md
  src/expediente.js     # partesSP, dentroDoExpediente
  src/periodo.js        # periodoDoRelatorio, formatarTela, paraIso
  src/parse.js          # lerPlanilha, parseRelatorio (porte do mlParseRelatorio do painel)
  src/enviar.js         # chamar, enviarLotes (HTTP para ingest-ligacoes)
  src/main.js           # executar(cfg, io) + main()
  src/procontact.js     # exportarRelatorio (Playwright)
  test/fixture.js       # gera planilhas .xlsx FALSAS para os testes
  test/expediente.test.js  test/periodo.test.js  test/parse.test.js  test/enviar.test.js  test/main.test.js
  .github/workflows/sincronizar.yml
```

Os blocos de código `js` começam com um comentário `// caminho/do/arquivo` indicando onde ele vai; nos demais (JSON, YAML, `.gitignore`, Markdown) o arquivo vem indicado na linha anterior ou no comentário da primeira linha.

---

### Task 1: Repositório, expediente e testes de horário

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`
- Create: `src/expediente.js`
- Test: `test/expediente.test.js`

**Interfaces:**
- Produces: `partesSP(date: Date): { y, m, d, dia, hora, min }` (`dia` 0=domingo…6=sábado; `m` 1–12) e `dentroDoExpediente(date?: Date): boolean`.

- [ ] **Step 1: Criar a pasta e inicializar o git (local, sem GitHub ainda)**

```bash
mkdir -p /c/Users/acer1/Downloads/apex-robo-procontact && cd /c/Users/acer1/Downloads/apex-robo-procontact
git init -b main
mkdir -p src test .github/workflows
```

- [ ] **Step 2: Escrever `package.json`, `.gitignore` e `README.md`**

`package.json`:

```json
{
  "name": "apex-robo-procontact",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test",
    "sincronizar": "node src/main.js"
  },
  "dependencies": {
    "playwright": "^1.49.0",
    "xlsx": "0.18.5"
  }
}
```

`.gitignore`:

```gitignore
node_modules/
.env*
*.xlsx
*.csv
test-results/
playwright-report/
```

(O `.gitignore` bloqueia `*.xlsx`; a fixture dos testes gera as planilhas em memória, nunca em arquivo.)

`README.md`:

```markdown
# apex-robo-procontact

Robô que baixa o relatório de **Chamadas Manuais** do ProContact e envia à função `ingest-ligacoes` (Supabase `apex`).
Repositório **privado**. Spec e planos: repositório `atmizuta/apex-smart-solutions`, `docs/superpowers/`.

- Roda no GitHub Actions de hora em hora (07h–22h, seg–sáb, São Paulo). Liga/desliga pela variável de repositório `ROBO_ATIVO` (`true`/vazio).
- Manual: Actions → "Sincronizar chamadas manuais" → Run workflow → modo `dry` (só confere, não grava) ou `real`.
- Secrets: `PROCONTACT_URL`, `PROCONTACT_USUARIO`, `PROCONTACT_SENHA`, `INGEST_URL`, `INGEST_TOKEN`.
- Testes: `npm test` (não usa navegador nem rede).
- Nunca registrar telefone/usuário em log. Sem screenshots nem traces.
```

- [ ] **Step 3: Instalar dependências**

Run: `npm install`
Expected: cria `node_modules/` e `package-lock.json` sem erros. (Se o Playwright pedir navegadores, só será necessário na Task 6: `npx playwright install chromium`.)

- [ ] **Step 4: Escrever o teste que falha**

```js
// test/expediente.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partesSP, dentroDoExpediente } from '../src/expediente.js';

// 02/10/2026 é sexta; 03 sábado; 04 domingo. São Paulo = UTC-3.
test('partesSP converte para o horário de São Paulo', () => {
  const p = partesSP(new Date('2026-10-01T02:00:00Z')); // 30/09 23:00 em SP
  assert.deepEqual(p, { y: 2026, m: 9, d: 30, dia: 3, hora: 23, min: 0 });
});

test('dentro do expediente: sexta 10:00 SP e sexta 07:00 SP', () => {
  assert.equal(dentroDoExpediente(new Date('2026-10-02T13:00:00Z')), true);
  assert.equal(dentroDoExpediente(new Date('2026-10-02T10:00:00Z')), true);
});
test('fora: 06:59 SP, 22:00 SP e 23:00 SP', () => {
  assert.equal(dentroDoExpediente(new Date('2026-10-02T09:59:00Z')), false);
  assert.equal(dentroDoExpediente(new Date('2026-10-03T01:00:00Z')), false); // sex 22:00 SP
  assert.equal(dentroDoExpediente(new Date('2026-10-03T02:00:00Z')), false); // sex 23:00 SP
});
test('21:59 SP ainda é expediente', () => {
  assert.equal(dentroDoExpediente(new Date('2026-10-03T00:59:00Z')), true);
});
test('sábado dentro do horário conta; domingo nunca', () => {
  assert.equal(dentroDoExpediente(new Date('2026-10-03T15:00:00Z')), true);  // sáb 12:00 SP
  assert.equal(dentroDoExpediente(new Date('2026-10-04T15:00:00Z')), false); // dom 12:00 SP
});
test('domingo 00:30 SP (03:30Z) é domingo; sábado 23:30 SP (02:30Z de domingo) é sábado fora do horário', () => {
  assert.equal(partesSP(new Date('2026-10-04T03:30:00Z')).dia, 0);
  assert.equal(partesSP(new Date('2026-10-04T02:30:00Z')).dia, 6);
  assert.equal(dentroDoExpediente(new Date('2026-10-04T02:30:00Z')), false);
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `node --test test/expediente.test.js`
Expected: FAIL (`Cannot find module '../src/expediente.js'`).

- [ ] **Step 6: Implementar**

```js
// src/expediente.js
// São Paulo não tem horário de verão desde 2019: UTC-3 fixo.
const SP_OFFSET_MS = 3 * 3600_000;

export function partesSP(date) {
  const s = new Date(date.getTime() - SP_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate(), dia: s.getUTCDay(), hora: s.getUTCHours(), min: s.getUTCMinutes() };
}

// Segunda a sábado, das 07:00 às 21:59 (hora de São Paulo).
export function dentroDoExpediente(date = new Date()) {
  const { dia, hora } = partesSP(date);
  return dia !== 0 && hora >= 7 && hora < 22;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test test/expediente.test.js`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore README.md src/expediente.js test/expediente.test.js
git commit -m "feat: estrutura do robô e regra de expediente (seg-sáb 07-22h SP)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Período do relatório

**Files:**
- Create: `src/periodo.js`
- Test: `test/periodo.test.js`

**Interfaces:**
- Consumes: `partesSP` (Task 1).
- Produces:
  - `periodoDoRelatorio(agora?: Date): { inicio: P, fim: P }` com `P = { y, m, d, hh, mm }`
  - `formatarTela(p): string` → `"01/10/2026 00:00 - 02/10/2026 23:59"`
  - `paraIso(x: P, seg?: string): string` → `"2026-10-01T00:00:00-03:00"`

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/periodo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodoDoRelatorio, formatarTela, paraIso } from '../src/periodo.js';

test('meio do mês: do dia 1 deste mês até hoje 23:59', () => {
  const p = periodoDoRelatorio(new Date('2026-10-15T15:00:00Z'));
  assert.equal(formatarTela(p), '01/10/2026 00:00 - 15/10/2026 23:59');
});
test('dias 1 e 2: começa no mês anterior', () => {
  assert.equal(formatarTela(periodoDoRelatorio(new Date('2026-10-01T15:00:00Z'))), '01/09/2026 00:00 - 01/10/2026 23:59');
  assert.equal(formatarTela(periodoDoRelatorio(new Date('2026-10-02T15:00:00Z'))), '01/09/2026 00:00 - 02/10/2026 23:59');
});
test('dia 3 já começa no mês corrente', () => {
  assert.equal(formatarTela(periodoDoRelatorio(new Date('2026-10-03T15:00:00Z'))), '01/10/2026 00:00 - 03/10/2026 23:59');
});
test('janeiro: o mês anterior é dezembro do ano anterior', () => {
  assert.equal(formatarTela(periodoDoRelatorio(new Date('2026-01-01T15:00:00Z'))), '01/12/2025 00:00 - 01/01/2026 23:59');
});
test('23:00 do dia 30 em São Paulo ainda é dia 30 (não vira dia 1 pelo UTC)', () => {
  assert.equal(formatarTela(periodoDoRelatorio(new Date('2026-10-01T02:00:00Z'))), '01/09/2026 00:00 - 30/09/2026 23:59');
});
test('paraIso usa -03:00 e aceita segundos', () => {
  const p = periodoDoRelatorio(new Date('2026-10-15T15:00:00Z'));
  assert.equal(paraIso(p.inicio), '2026-10-01T00:00:00-03:00');
  assert.equal(paraIso(p.fim, '59'), '2026-10-15T23:59:59-03:00');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/periodo.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```js
// src/periodo.js
import { partesSP } from './expediente.js';

const dois = (n) => String(n).padStart(2, '0');

// Dia 1 do mês 00:00 até hoje 23:59 (São Paulo). Nos dias 1 e 2 começa no mês anterior
// (cobre a virada de mês e ligações registradas com atraso).
export function periodoDoRelatorio(agora = new Date()) {
  const { y, m, d } = partesSP(agora);
  let iy = y, im = m;
  if (d <= 2) {
    im = m - 1;
    if (im === 0) { im = 12; iy = y - 1; }
  }
  return { inicio: { y: iy, m: im, d: 1, hh: 0, mm: 0 }, fim: { y, m, d, hh: 23, mm: 59 } };
}

// Formato do filtro "Período" da tela do ProContact: "01/09/2026 00:00 - 01/10/2026 23:59"
export function formatarTela(p) {
  const f = (x) => `${dois(x.d)}/${dois(x.m)}/${x.y} ${dois(x.hh)}:${dois(x.mm)}`;
  return `${f(p.inicio)} - ${f(p.fim)}`;
}

export function paraIso(x, seg = '00') {
  return `${x.y}-${dois(x.m)}-${dois(x.d)}T${dois(x.hh)}:${dois(x.mm)}:${seg}-03:00`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/periodo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/periodo.js test/periodo.test.js
git commit -m "feat: período do relatório (dia 1 até hoje; dias 1-2 voltam ao mês anterior)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Leitura e normalização do relatório (`parse.js`)

**Files:**
- Create: `src/parse.js`
- Create: `test/fixture.js`
- Test: `test/parse.test.js`

**Interfaces:**
- Produces:
  - `lerPlanilha(buffer: Buffer): object[]` — primeira aba, linhas como objetos `{cabeçalho: texto}`.
  - `parseRelatorio(rows: object[]): { linhas: Linha[], lidas: number, invalidas: number, ignoradasEagle: number, faltando: string[] }` com `Linha = { id: number, usuario: string, telefone: string|null, gerada_em: string, atendida: boolean, seg_falados: number, tabulacao: string|null, transferido: string|null, gravacao: string|null }` (sem `chave_tel`: a função calcula).
  - `test/fixture.js`: `CABECALHO`, `linha(sobre?)`, `planilha(linhas): Buffer`.

- [ ] **Step 1: Escrever a fixture (dados **falsos**)**

```js
// test/fixture.js
// Planilhas FALSAS em memória (nunca em arquivo; nenhum dado real)
import XLSX from 'xlsx';

// Mesmo cabeçalho do relatório MANUALCALL_REPORT (inclui "UniqueID" duas vezes).
export const CABECALHO = ['ID', 'UniqueID', 'Cod Integração', 'Campanha', 'Telefone', 'Status', 'Status Discagem', 'Protocolo 1', 'Protocolo 2', 'Usuario', 'DataHora_Geracao', 'DataHora_Atendimento', 'DataHora_Fim', 'Tempo_Total', 'Tempo_Chamada', 'Empresa', 'Canal', 'Gravacao', 'UniqueID', 'Última Tabulação', 'Transferido', 'Destino Transf.', 'TelefoneBr'];

const padrao = {
  ID: '1001', UniqueID: '1759000001.1', 'Cod Integração': null, Campanha: '-', Telefone: '11900000001', Status: 'ANSWERED',
  'Status Discagem': 'ANSWER', 'Protocolo 1': null, 'Protocolo 2': null, Usuario: 'apex.fulano', DataHora_Geracao: '01/10/2026 12:20:59',
  DataHora_Atendimento: '01/10/2026 12:21:10', DataHora_Fim: '01/10/2026 12:22:25', Tempo_Total: '00:01:26', Tempo_Chamada: '00:01:15',
  Empresa: 'EMPRESA TESTE', Canal: 'SIP/Teste', Gravacao: '2026/10/01/MANUAL-1001', 'Última Tabulação': 'RETORNO', Transferido: null,
  'Destino Transf.': '-', TelefoneBr: '(11) 90000-0001',
};

export function linha(sobre = {}) {
  const v = { ...padrao, ...sobre };
  return CABECALHO.map((c, i) => (c === 'UniqueID' && i === 18 ? v.UniqueID2 ?? '1759000001' : v[c] ?? null));
}

export function planilha(linhas) {
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO, ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Worksheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
```

- [ ] **Step 2: Escrever os testes que falham**

```js
// test/parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPlanilha, parseRelatorio } from '../src/parse.js';
import { linha, planilha, CABECALHO } from './fixture.js';

const ler = (linhas) => parseRelatorio(lerPlanilha(planilha(linhas)));

test('linha atendida: campos convertidos (datas ISO -03:00, segundos, telefone só dígitos)', () => {
  const r = ler([linha()]);
  assert.equal(r.lidas, 1);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas[0], {
    id: 1001, usuario: 'apex.fulano', telefone: '11900000001', gerada_em: '2026-10-01T12:20:59-03:00',
    atendida: true, seg_falados: 75, tabulacao: 'RETORNO', transferido: null, gravacao: '2026/10/01/MANUAL-1001',
  });
});
test('FAILED não é atendida; tabulação "-" é mantida como vem', () => {
  const r = ler([linha({ ID: '1002', Status: 'FAILED', Tempo_Chamada: null, 'Última Tabulação': '-' })]);
  assert.equal(r.linhas[0].atendida, false);
  assert.equal(r.linhas[0].seg_falados, 0);
  assert.equal(r.linhas[0].tabulacao, '-');
});
test('telefone formatado vira só dígitos', () => {
  const r = ler([linha({ Telefone: '(11) 90000-0001' })]);
  assert.equal(r.linhas[0].telefone, '11900000001');
});
test('cabeçalho com UniqueID duplicado não atrapalha', () => {
  assert.equal(CABECALHO.filter((c) => c === 'UniqueID').length, 2);
  assert.equal(ler([linha()]).linhas.length, 1);
});
test('eagle.* e " EAGLE.x " ficam fora e são contados; apex.eagleton entra', () => {
  const r = ler([linha({ ID: '1', Usuario: 'eagle.juliana' }), linha({ ID: '2', Usuario: ' EAGLE.Maria ' }), linha({ ID: '3', Usuario: 'apex.eagleton' })]);
  assert.equal(r.ignoradasEagle, 2);
  assert.deepEqual(r.linhas.map((l) => l.id), [3]);
});
test('inválidas: ID vazio, ID não numérico, data fora do formato, usuário vazio', () => {
  const r = ler([
    linha({ ID: null }), linha({ ID: 'abc' }), linha({ ID: '5', DataHora_Geracao: '2026/10/01' }), linha({ ID: '6', Usuario: null }),
    linha({ ID: '7' }),
  ]);
  assert.equal(r.invalidas, 4);
  assert.deepEqual(r.linhas.map((l) => l.id), [7]);
});
test('ID repetido entra uma vez só', () => {
  const r = ler([linha({ ID: '9', Tempo_Chamada: '00:00:10' }), linha({ ID: '9', Tempo_Chamada: '00:09:59' })]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].seg_falados, 10);
});
test('relatório só com cabeçalho: sem linhas, sem erro de colunas', () => {
  const r = ler([]);
  assert.deepEqual(r, { linhas: [], lidas: 0, invalidas: 0, ignoradasEagle: 0, faltando: [] });
});
test('coluna obrigatória ausente: devolve quais faltam e não lê linhas', () => {
  const sem = XLSX_sem_coluna('Telefone');
  const r = parseRelatorio(sem);
  assert.deepEqual(r.faltando, ['telefone']);
  assert.equal(r.linhas.length, 0);
});
test('cabeçalho sem acento/caixa/espaços é reconhecido', () => {
  const r = parseRelatorio([{ ' id ': '1', USUARIO: 'apex.a', 'Telefone ': '11900000001', 'STATUS': 'ANSWERED', 'datahora_geracao': '01/10/2026 08:00:00' }]);
  assert.equal(r.faltando.length, 0);
  assert.equal(r.linhas.length, 1);
});

function XLSX_sem_coluna(col) {
  const rows = lerPlanilha(planilha([linha()]));
  return rows.map((o) => { const c = { ...o }; delete c[col]; return c; });
}
```


- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/parse.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Implementar**

```js
// src/parse.js
// Porte de mlParseRelatorio (_template.html, REGRAS_NEGOCIO.md 59.3 e 65). Manter as duas versões iguais.
import XLSX from 'xlsx';

// Colunas do relatório (nome já normalizado por normCol).
const COLUNAS = { id: 'id', usuario: 'usuario', telefone: 'telefone', gerada: 'datahorageracao', status: 'status', tempo: 'tempochamada', tab: 'ultimatabulacao', transf: 'transferido', grav: 'gravacao' };
const OBRIGATORIAS = ['id', 'usuario', 'telefone', 'gerada', 'status'];

export const normCol = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function segundos(t) {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
}

// "08/09/2026 12:20:59" (ou ISO "2026-09-08 12:20:59") -> "2026-09-08T12:20:59-03:00"; qualquer outra coisa -> null
export function dataHora(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00`;
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00` : null;
}

export const ehEagle = (usuario) => /^eagle/i.test(String(usuario || '').trim());

// Primeira aba; cada linha vira {cabeçalho: texto}. raw:false mantém o texto como aparece no Excel.
export function lerPlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: null });
}

export function parseRelatorio(rows) {
  const out = { linhas: [], lidas: 0, invalidas: 0, ignoradasEagle: 0, faltando: [] };
  if (!rows || !rows.length) return out; // relatório sem ligações no período: válido
  out.lidas = rows.length;
  const mapa = {};
  Object.keys(rows[0]).forEach((k) => {
    const n = normCol(k);
    Object.keys(COLUNAS).forEach((ch) => { if (COLUNAS[ch] === n && !(ch in mapa)) mapa[ch] = k; });
  });
  out.faltando = OBRIGATORIAS.filter((ch) => !(ch in mapa));
  if (out.faltando.length) { out.lidas = 0; return out; }
  const txt = (r, ch) => (mapa[ch] && r[mapa[ch]] != null && String(r[mapa[ch]]).trim() !== '') ? String(r[mapa[ch]]).trim() : null;
  const vistos = new Set();
  rows.forEach((r) => {
    const id = Number(txt(r, 'id'));
    const gerada = dataHora(txt(r, 'gerada'));
    const usuario = txt(r, 'usuario');
    if (!Number.isFinite(id) || id <= 0 || !gerada || !usuario) { out.invalidas++; return; }
    if (ehEagle(usuario)) { out.ignoradasEagle++; return; }
    if (vistos.has(id)) return;
    vistos.add(id);
    const tel = (txt(r, 'telefone') || '').replace(/\D/g, '');
    out.linhas.push({
      id, usuario, telefone: tel || null, gerada_em: gerada,
      atendida: String(txt(r, 'status') || '').toUpperCase() === 'ANSWERED',
      seg_falados: segundos(txt(r, 'tempo')),
      tabulacao: txt(r, 'tab'), transferido: txt(r, 'transf'), gravacao: txt(r, 'grav'),
    });
  });
  return out;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/parse.test.js`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parse.js test/fixture.js test/parse.test.js
git commit -m "feat: leitura e normalização do relatório (porte do upload manual do painel)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Envio à função (`enviar.js`)

**Files:**
- Create: `src/enviar.js`
- Test: `test/enviar.test.js`

**Interfaces:**
- Produces:
  - `chamar({ url, token, corpo, fetchImpl? }): Promise<object>` — POST JSON com `x-robo-token`; lança `Error("ingest respondeu <status>[: <mensagem>]")` se não for 2xx; timeout de 30 s; a mensagem **nunca** inclui o corpo enviado.
  - `enviarLotes({ url, token, linhas, execucaoId, fetchImpl?, tamanho? }): Promise<{ gravadas: number }>` — lotes de 500 (`acao:"lote"`), soma `gravadas`, **para no primeiro erro**.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/enviar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chamar, enviarLotes } from '../src/enviar.js';

function falso(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url, init, corpo: JSON.parse(init.body) });
    const r = respostas.shift() ?? { status: 200, json: { gravadas: 0 } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return { fetchImpl, chamadas };
}
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, usuario: 'apex.a', telefone: '11900000001', gerada_em: '2026-10-01T10:00:00-03:00', atendida: true, seg_falados: 5, tabulacao: null, transferido: null, gravacao: null }));

test('chamar: envia POST JSON com o token no header', async () => {
  const { fetchImpl, chamadas } = falso([{ status: 200, json: { total: 7 } }]);
  const r = await chamar({ url: 'https://x/ingest', token: 'T0K', corpo: { acao: 'contar' }, fetchImpl });
  assert.deepEqual(r, { total: 7 });
  assert.equal(chamadas[0].init.method, 'POST');
  assert.equal(chamadas[0].init.headers['x-robo-token'], 'T0K');
  assert.equal(chamadas[0].init.headers['content-type'], 'application/json');
});
test('chamar: erro HTTP lança com o status e sem eco do corpo enviado', async () => {
  const { fetchImpl } = falso([{ status: 500, json: { error: 'erro interno' } }]);
  await assert.rejects(
    chamar({ url: 'https://x', token: 't', corpo: { acao: 'lote', lote: [{ telefone: '11900000001' }] }, fetchImpl }),
    (e) => /500/.test(e.message) && /erro interno/.test(e.message) && !e.message.includes('11900000001'),
  );
});
test('chamar: resposta sem JSON ainda lança com o status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new Error('x'); } });
  await assert.rejects(chamar({ url: 'https://x', token: 't', corpo: {}, fetchImpl }), /502/);
});
test('enviarLotes: 1203 linhas → 3 lotes (500, 500, 203) e soma das gravadas', async () => {
  const { fetchImpl, chamadas } = falso([{ status: 200, json: { gravadas: 500 } }, { status: 200, json: { gravadas: 500 } }, { status: 200, json: { gravadas: 203 } }]);
  const r = await enviarLotes({ url: 'https://x', token: 't', linhas: mk(1203), execucaoId: 'e1', fetchImpl });
  assert.equal(r.gravadas, 1203);
  assert.deepEqual(chamadas.map((c) => c.corpo.lote.length), [500, 500, 203]);
  assert.ok(chamadas.every((c) => c.corpo.acao === 'lote' && c.corpo.execucao_id === 'e1'));
});
test('enviarLotes: sem linhas não chama a função', async () => {
  const { fetchImpl, chamadas } = falso([]);
  const r = await enviarLotes({ url: 'https://x', token: 't', linhas: [], execucaoId: 'e', fetchImpl });
  assert.equal(r.gravadas, 0);
  assert.equal(chamadas.length, 0);
});
test('enviarLotes: para no primeiro erro, sem retentativa e sem mandar os lotes seguintes', async () => {
  const { fetchImpl, chamadas } = falso([{ status: 200, json: { gravadas: 500 } }, { status: 500, json: { error: 'erro interno' } }]);
  await assert.rejects(enviarLotes({ url: 'https://x', token: 't', linhas: mk(1500), execucaoId: 'e', fetchImpl }), /500/);
  assert.equal(chamadas.length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/enviar.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```js
// src/enviar.js
// Fala com a Edge Function ingest-ligacoes (Plano A). Nenhuma mensagem de erro inclui o corpo enviado
// (telefones). Sem retentativas: 1 execução por hora; erro vira registro no log e aviso do GitHub.
export async function chamar({ url, token, corpo, fetchImpl = fetch }) {
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-robo-token': token },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30_000),
  });
  let json = null;
  try { json = await resp.json(); } catch { /* resposta sem JSON */ }
  if (!resp.ok) {
    const detalhe = json && typeof json.error === 'string' ? `: ${json.error.slice(0, 100)}` : '';
    throw new Error(`ingest respondeu ${resp.status}${detalhe}`);
  }
  return json;
}

export async function enviarLotes({ url, token, linhas, execucaoId, fetchImpl = fetch, tamanho = 500 }) {
  let gravadas = 0;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const r = await chamar({ url, token, corpo: { acao: 'lote', execucao_id: execucaoId, lote }, fetchImpl });
    gravadas += Number(r && r.gravadas) || 0;
  }
  return { gravadas };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/enviar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/enviar.js test/enviar.test.js
git commit -m "feat: envio em lotes à função ingest-ligacoes (sem retentativa, sem eco de dados)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orquestrador `executar` e `main`

**Files:**
- Create: `src/main.js`
- Test: `test/main.test.js`

**Interfaces:**
- Consumes: `dentroDoExpediente` (T1), `periodoDoRelatorio/formatarTela/paraIso` (T2), `lerPlanilha/parseRelatorio` (T3), `chamar/enviarLotes` (T4).
- Produces: `executar(cfg, io): Promise<{ codigo: 0|1, pulou?, dry?, validas?, noBanco?, enviadas? }>`.
  - `cfg = { procontactUrl, usuario, senha, ingestUrl, token, modo: 'real'|'dry', forcar: boolean, agora?: Date }`
  - `io = { exportar({url,usuario,senha,textoPeriodo,pasta}) → caminho, ler(caminho) → Buffer, chamar, enviarLotes, uuid(), pastaTemporaria(), limpar(pasta), log(msg) }`
- `main()` liga o mundo real; só executa quando o arquivo é o ponto de entrada.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/main.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { executar } from '../src/main.js';
import { lerPlanilha } from '../src/parse.js';
import { linha, planilha } from './fixture.js';

const SEXTA_10H = new Date('2026-10-02T13:00:00Z');
const DOMINGO = new Date('2026-10-04T15:00:00Z');
const cfg = (sobre = {}) => ({ procontactUrl: 'https://pc', usuario: 'u', senha: 's', ingestUrl: 'https://ing', token: 't', modo: 'real', forcar: false, agora: SEXTA_10H, ...sobre });

function io(sobre = {}) {
  const reg = { exportar: [], chamar: [], lotes: [], limpar: [], logs: [] };
  const buf = planilha([linha({ ID: '1' }), linha({ ID: '2', Status: 'FAILED' }), linha({ ID: '3', Usuario: 'eagle.x' }), linha({ ID: null })]);
  const o = {
    async exportar(a) { reg.exportar.push(a); return '/tmp/x/relatorio.xlsx'; },
    ler: () => buf,
    async chamar(a) { reg.chamar.push(a.corpo); return a.corpo.acao === 'contar' ? { total: 2 } : { ok: true }; },
    async enviarLotes(a) { reg.lotes.push(a); return { gravadas: a.linhas.length }; },
    uuid: () => '123e4567-e89b-42d3-a456-426614174000',
    pastaTemporaria: () => '/tmp/x',
    limpar: (p) => reg.limpar.push(p),
    log: (m) => reg.logs.push(m),
    ...sobre,
  };
  return { o, reg };
}

test('fora do expediente (domingo): não acessa o ProContact e sai 0', async () => {
  const { o, reg } = io();
  const r = await executar(cfg({ agora: DOMINGO }), o);
  assert.equal(r.codigo, 0);
  assert.equal(r.pulou, true);
  assert.equal(reg.exportar.length, 0);
});
test('forçar (execução manual) ignora o expediente', async () => {
  const { o, reg } = io();
  const r = await executar(cfg({ agora: DOMINGO, forcar: true }), o);
  assert.equal(r.codigo, 0);
  assert.equal(reg.exportar.length, 1);
});
test('real: exporta o período certo, envia as linhas válidas e registra o final ok', async () => {
  const { o, reg } = io();
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 0);
  assert.equal(reg.exportar[0].textoPeriodo, '01/09/2026 00:00 - 02/10/2026 23:59');
  assert.equal(reg.lotes[0].linhas.length, 2);
  const fim = reg.chamar.at(-1);
  assert.equal(fim.acao, 'final');
  assert.equal(fim.ok, true);
  assert.equal(fim.lidas, 4);
  assert.equal(fim.enviadas, 2);
  assert.equal(fim.invalidas, 1);
  assert.equal(fim.ignoradas_eagle, 1);
  assert.equal(fim.execucao_id, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(fim.periodo_de, '2026-09-01T00:00:00-03:00');
  assert.equal(fim.periodo_ate, '2026-10-02T23:59:59-03:00');
  assert.deepEqual(reg.limpar, ['/tmp/x']);
});
test('dry: confere com o banco, não envia lotes e não registra final', async () => {
  const { o, reg } = io();
  const r = await executar(cfg({ modo: 'dry' }), o);
  assert.equal(r.codigo, 0);
  assert.equal(r.dry, true);
  assert.equal(r.validas, 2);
  assert.equal(r.noBanco, 2);
  assert.equal(reg.lotes.length, 0);
  assert.deepEqual(reg.chamar.map((c) => c.acao), ['contar']);
});
test('relatório vazio: sucesso com 0 linhas, nada enviado, final ok', async () => {
  const { o, reg } = io({ ler: () => planilha([]) });
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 0);
  assert.equal(reg.lotes.length === 0 || reg.lotes[0].linhas.length === 0, true);
  assert.equal(reg.chamar.at(-1).ok, true);
  assert.equal(reg.chamar.at(-1).lidas, 0);
});
test('exportação falha: registra ok=false com a mensagem, sai 1 e limpa a pasta', async () => {
  const { o, reg } = io({ async exportar() { throw new Error('login recusado'); } });
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 1);
  const fim = reg.chamar.at(-1);
  assert.equal(fim.acao, 'final');
  assert.equal(fim.ok, false);
  assert.equal(fim.erro, 'login recusado');
  assert.deepEqual(reg.limpar, ['/tmp/x']);
});
test('relatório sem coluna obrigatória: erro claro, ok=false, código 1', async () => {
  const { o, reg } = io({ ler: () => semTelefone() });
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 1);
  assert.match(reg.chamar.at(-1).erro, /colunas.*telefone/);
});
test('função falha no meio do envio: ok=false e código 1', async () => {
  const { o, reg } = io({ async enviarLotes() { throw new Error('ingest respondeu 500: erro interno'); } });
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 1);
  assert.equal(reg.chamar.at(-1).ok, false);
  assert.match(reg.chamar.at(-1).erro, /500/);
});
test('falha ao registrar o erro não esconde o erro original (continua código 1)', async () => {
  const { o, reg } = io({
    async exportar() { throw new Error('tela mudou'); },
    async chamar() { throw new Error('ingest respondeu 401'); },
  });
  const r = await executar(cfg(), o);
  assert.equal(r.codigo, 1);
  assert.ok(reg.logs.some((m) => m.includes('tela mudou')));
});
test('mensagens de log não contêm telefone nem usuário da telefonia', async () => {
  const { o, reg } = io();
  await executar(cfg(), o);
  const tudo = reg.logs.join('\n');
  assert.ok(!tudo.includes('11900000001'));
  assert.ok(!tudo.includes('apex.fulano'));
});

function semTelefone() {
  const rows = lerPlanilha(planilha([linha()])).map((o) => { const c = { ...o }; delete c.Telefone; return c; });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Worksheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
```

(O período esperado começa em 01/09 porque a sexta de teste, 02/10, é o **dia 2**: regra "dias 1 e 2 começam no mês anterior".)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/main.test.js`
Expected: FAIL (`executar` não existe).

- [ ] **Step 3: Implementar**

```js
// src/main.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dentroDoExpediente } from './expediente.js';
import { periodoDoRelatorio, formatarTela, paraIso } from './periodo.js';
import { lerPlanilha, parseRelatorio } from './parse.js';
import { chamar, enviarLotes } from './enviar.js';

export async function executar(cfg, io) {
  const agora = cfg.agora ?? new Date();
  if (!cfg.forcar && !dentroDoExpediente(agora)) {
    io.log('Fora do expediente (07h-22h, seg-sáb, horário de São Paulo): nada a fazer.');
    return { codigo: 0, pulou: true };
  }
  const execucaoId = io.uuid();
  const periodo = periodoDoRelatorio(agora);
  const base = { execucao_id: execucaoId, iniciou_em: agora.toISOString(), periodo_de: paraIso(periodo.inicio), periodo_ate: paraIso(periodo.fim, '59') };
  const c = { lidas: 0, enviadas: 0, invalidas: 0, ignoradas_eagle: 0 };
  const pasta = io.pastaTemporaria();
  const chamarIngest = (corpo) => io.chamar({ url: cfg.ingestUrl, token: cfg.token, corpo });
  try {
    const arquivo = await io.exportar({ url: cfg.procontactUrl, usuario: cfg.usuario, senha: cfg.senha, textoPeriodo: formatarTela(periodo), pasta });
    const p = parseRelatorio(lerPlanilha(io.ler(arquivo)));
    if (p.faltando.length) throw new Error('relatório sem as colunas: ' + p.faltando.join(', '));
    c.lidas = p.lidas; c.invalidas = p.invalidas; c.ignoradas_eagle = p.ignoradasEagle;
    io.log(`Lidas ${p.lidas}; válidas ${p.linhas.length}; inválidas ${p.invalidas}; ignoradas (Eagle) ${p.ignoradasEagle}.`);
    if (cfg.modo === 'dry') {
      const { total } = await chamarIngest({ acao: 'contar', de: base.periodo_de, ate: base.periodo_ate });
      io.log(`Conferência (nada foi gravado): o arquivo tem ${p.linhas.length} ligações válidas; o banco tem ${total} no mesmo período.`);
      return { codigo: 0, dry: true, validas: p.linhas.length, noBanco: total };
    }
    if (p.linhas.length) {
      const { gravadas } = await io.enviarLotes({ url: cfg.ingestUrl, token: cfg.token, linhas: p.linhas, execucaoId });
      c.enviadas = gravadas;
    }
    await chamarIngest({ acao: 'final', ...base, ok: true, ...c, erro: null });
    io.log(`Sincronizado: ${c.enviadas} ligações enviadas.`);
    return { codigo: 0, enviadas: c.enviadas };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    io.log('ERRO: ' + msg);
    if (cfg.modo !== 'dry') {
      try { await chamarIngest({ acao: 'final', ...base, ok: false, ...c, erro: msg }); }
      catch (e2) { io.log('Não foi possível registrar o erro: ' + String((e2 && e2.message) || e2).slice(0, 100)); }
    }
    return { codigo: 1 };
  } finally {
    io.limpar(pasta);
  }
}

function env(k) {
  const v = process.env[k];
  if (!v) throw new Error(`variável de ambiente ausente: ${k}`);
  return v;
}

async function main() {
  const { exportarRelatorio } = await import('./procontact.js'); // import tardio: os testes não precisam do Playwright
  const cfg = {
    procontactUrl: env('PROCONTACT_URL'), usuario: env('PROCONTACT_USUARIO'), senha: env('PROCONTACT_SENHA'),
    ingestUrl: env('INGEST_URL'), token: env('INGEST_TOKEN'),
    modo: process.env.MODO === 'dry' ? 'dry' : 'real', forcar: process.env.FORCAR === 'true',
  };
  const io = {
    exportar: exportarRelatorio, ler: (p) => fs.readFileSync(p), chamar, enviarLotes,
    uuid: () => crypto.randomUUID(),
    pastaTemporaria: () => fs.mkdtempSync(path.join(os.tmpdir(), 'procontact-')),
    limpar: (p) => fs.rmSync(p, { recursive: true, force: true }),
    log: (m) => console.log(m),
  };
  const r = await executar(cfg, io);
  process.exit(r.codigo);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('ERRO: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos os testes de todas as Tasks PASS (expediente, periodo, parse, enviar, main).

- [ ] **Step 5: Commit**

```bash
git add src/main.js test/main.test.js
git commit -m "feat: orquestrador executar (expediente, dry, real, erro registrado) e main

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Casca do navegador (`procontact.js`) e reconhecimento da tela

**Files:**
- Create: `src/procontact.js`

**Interfaces:**
- Consumes: Playwright.
- Produces: `exportarRelatorio({ url, usuario, senha, textoPeriodo, pasta }): Promise<string>` — caminho do arquivo baixado em `pasta`.

Esta peça só pode ser comprovada contra o site real; **não há teste unitário**. Os seletores abaixo vêm das capturas de tela (menu *Relatório → Call Center → Chamadas Manuais*, botões *Buscar* e *Exportar*, campo *Período* no formato `01/09/2026 00:00 - 01/10/2026 23:59`) e de suposições sobre a tela de login e o seletor de datas. **A etapa de reconhecimento confirma ou corrige cada suposição antes de ligar o agendamento.**

- [ ] **Step 1: Escrever `src/procontact.js`**

```js
// src/procontact.js
// Única peça que fala com o site do ProContact. Sem screenshots/traces (a tela mostra telefones).
import path from 'node:path';
import { chromium } from 'playwright';

const TEMPO = 45_000;

async function entrar(page, usuario, senha) {
  await page.getByLabel(/usu[aá]rio|login|e-?mail/i).first().fill(usuario);
  await page.getByLabel(/senha/i).first().fill(senha);
  await page.getByRole('button', { name: /entrar|login|acessar/i }).first().click();
  const menu = page.getByText('Relatório', { exact: true }).first();
  const recusado = page.getByText(/senha inv[aá]lida|usu[aá]rio inv[aá]lido|credenciais|incorret/i).first();
  const resultado = await Promise.race([
    menu.waitFor({ timeout: TEMPO }).then(() => 'ok'),
    recusado.waitFor({ timeout: TEMPO }).then(() => 'recusado'),
  ]).catch(() => 'timeout');
  if (resultado === 'recusado') throw new Error('login recusado pelo ProContact');
  if (resultado === 'timeout') throw new Error('o menu não apareceu depois do login (tela mudou?)');
}

async function abrirChamadasManuais(page) {
  await page.getByText('Relatório', { exact: true }).first().click();
  // "Call Center" existe no menu principal e dentro de Relatório; o de dentro vem depois no DOM.
  await page.getByText('Call Center', { exact: true }).last().click();
  await page.getByText('Chamadas Manuais', { exact: true }).click();
  await page.getByText(/^filtros$/i).first().waitFor({ timeout: TEMPO });
}

async function campoPeriodo(page) {
  const porRotulo = page.getByLabel(/per[ií]odo/i).first();
  if (await porRotulo.count()) return porRotulo;
  return page.locator('input[value*="/20"]').first();
}

async function definirPeriodo(page, texto) {
  const campo = await campoPeriodo(page);
  await campo.click();
  await campo.press('Control+A');
  await campo.fill(texto);
  await campo.press('Enter');
  const aplicar = page.getByRole('button', { name: /aplicar|ok|confirmar/i }).first();
  if (await aplicar.isVisible().catch(() => false)) await aplicar.click();
  const valor = await campo.inputValue();
  if (valor.trim() !== texto) throw new Error('não consegui definir o período no filtro (tela mudou?)');
}

export async function exportarRelatorio({ url, usuario, senha, textoPeriodo, pasta }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(TEMPO);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await entrar(page, usuario, senha);
    await abrirChamadasManuais(page);
    await definirPeriodo(page, textoPeriodo);
    await page.getByRole('button', { name: /buscar/i }).click();
    await page.getByText('TOTAL', { exact: true }).first().waitFor({ timeout: TEMPO });
    await page.waitForLoadState('networkidle');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 300_000 }),
      page.getByRole('button', { name: /exportar/i }).click(),
    ]);
    const destino = path.join(pasta, 'relatorio');
    await download.saveAs(destino);
    return destino;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Instalar o Chromium localmente e conferir a sintaxe**

Run: `npx playwright install chromium && node --check src/procontact.js`
Expected: instala o navegador; `--check` sem saída (sintaxe válida).

- [ ] **Step 3: Reconhecimento da tela (feito com o Rafael, no computador dele, com `headless: false`)**

O Rafael roda uma vez, na máquina dele, **com a própria senha digitada no terminal da máquina dele — nunca no chat**:

```bash
# PowerShell, na pasta do robô. A senha é digitada pelo próprio Rafael; não colar aqui.
$env:PROCONTACT_URL = "<endereço da tela de login do ProContact>"
npx playwright codegen $env:PROCONTACT_URL
```

No navegador que abrir: entrar, ir em *Relatório → Call Center → Chamadas Manuais*, mudar o *Período*, clicar *Buscar* e *Exportar*. O `codegen` mostra os seletores que o Playwright escolheu. Registrar, **sem copiar telefone nem senha**, os pontos abaixo e ajustar `src/procontact.js` conforme as respostas:

| Ponto | Pergunta | Se a suposição estiver errada |
|---|---|---|
| Login | Os campos têm rótulo "usuário/login" e "senha"? O botão se chama "Entrar"? | Trocar os seletores em `entrar()` pelos do `codegen` |
| Menu | O segundo "Call Center" (dentro de *Relatório*) é mesmo o último no DOM? | Escopar o seletor ao submenu de *Relatório* |
| Período | O campo tem rótulo "Período"? Aceita digitar ou só escolher no calendário? Existe botão "Aplicar"? | Ajustar `definirPeriodo()` (ex.: clicar nos dias do calendário) |
| Resultado | O card "TOTAL" aparece depois do *Buscar*? | Trocar a espera por outro marcador |
| Exportar | O arquivo baixa **na hora** ou fica em uma fila/lista de downloads? Qual o formato (.xlsx/.csv)? | Se for fila: esperar o item e clicar em baixar; se for .csv, `parse.js` já lê (SheetJS lê CSV) |

- [ ] **Step 4: Ensaio local com o navegador visível, só leitura (sem enviar nada)**

O Rafael roda na máquina dele (variáveis digitadas por ele; `INGEST_*` podem ficar vazias porque o ensaio abaixo não chama a função):

```powershell
$env:PROCONTACT_URL="<url>"; $env:PROCONTACT_USUARIO="<usuário do robô>"; $env:PROCONTACT_SENHA="<digitar aqui, não no chat>"
node -e "import('./src/procontact.js').then(async m=>{const os=await import('node:os');const fs=await import('node:fs');const p=fs.mkdtempSync(os.tmpdir()+'/pc-');const {periodoDoRelatorio,formatarTela}=await import('./src/periodo.js');const f=await m.exportarRelatorio({url:process.env.PROCONTACT_URL,usuario:process.env.PROCONTACT_USUARIO,senha:process.env.PROCONTACT_SENHA,textoPeriodo:formatarTela(periodoDoRelatorio()),pasta:p});const {lerPlanilha,parseRelatorio}=await import('./src/parse.js');const r=parseRelatorio(lerPlanilha(fs.readFileSync(f)));console.log({lidas:r.lidas,validas:r.linhas.length,invalidas:r.invalidas,eagle:r.ignoradasEagle,faltando:r.faltando});fs.rmSync(p,{recursive:true,force:true});})"
```

Expected: imprime só contagens, por exemplo `{ lidas: ~17500, validas: ~8800, invalidas: 0..n, eagle: ~8700, faltando: [] }`. Comparar `validas` com o que o painel mostra hoje para o mesmo período. Se algo falhar, ajustar `procontact.js` e repetir.

- [ ] **Step 5: Commit**

```bash
git add src/procontact.js
git commit -m "feat: casca do navegador (Playwright) para exportar Chamadas Manuais

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Workflow, repositório privado e entrada em operação

**Files:**
- Create: `.github/workflows/sincronizar.yml`

**Interfaces:**
- Consumes: `src/main.js`; secrets `PROCONTACT_URL`, `PROCONTACT_USUARIO`, `PROCONTACT_SENHA`, `INGEST_URL`, `INGEST_TOKEN`; variável de repositório `ROBO_ATIVO`.
- Produces: execução agendada de hora em hora; execução manual com modo `dry` ou `real`.

- [ ] **Step 1: Escrever o workflow**

```yaml
# .github/workflows/sincronizar.yml
name: Sincronizar chamadas manuais

on:
  schedule:
    # 10:17 a 01:17 UTC = 07:17 a 22:17 em São Paulo; o próprio robô recusa domingo e fora de 07-22h.
    - cron: '17 10-23,0-1 * * *'
  workflow_dispatch:
    inputs:
      modo:
        description: 'dry = só confere (não grava); real = grava'
        type: choice
        options: [dry, real]
        default: dry

concurrency:
  group: procontact
  cancel-in-progress: false

jobs:
  sincronizar:
    # a execução agendada só roda com a variável de repositório ROBO_ATIVO = true (é o "liga/desliga")
    if: github.event_name == 'workflow_dispatch' || vars.ROBO_ATIVO == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: node src/main.js
        env:
          MODO: ${{ inputs.modo || 'real' }}
          FORCAR: ${{ github.event_name == 'workflow_dispatch' }}
          PROCONTACT_URL: ${{ secrets.PROCONTACT_URL }}
          PROCONTACT_USUARIO: ${{ secrets.PROCONTACT_USUARIO }}
          PROCONTACT_SENHA: ${{ secrets.PROCONTACT_SENHA }}
          INGEST_URL: ${{ secrets.INGEST_URL }}
          INGEST_TOKEN: ${{ secrets.INGEST_TOKEN }}
```

- [ ] **Step 2: Commit local**

```bash
git add .github/workflows/sincronizar.yml
git commit -m "ci: workflow agendado (hora em hora) com modo dry/real e liga/desliga ROBO_ATIVO

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Pedir autorização e criar o repositório privado**

Perguntar ao Rafael: "Posso criar o repositório **privado** `apex-robo-procontact` na sua conta do GitHub e enviar o código?" Só com "sim":

```bash
gh repo create apex-robo-procontact --private --source=. --remote=origin --push
gh repo view apex-robo-procontact --json visibility -q .visibility   # deve imprimir PRIVATE
```

Se não imprimir `PRIVATE`, **parar** e avisar.

- [ ] **Step 4: O Rafael cadastra os secrets (eu não vejo os valores)**

```bash
# no terminal do Rafael; digitar cada valor quando o comando pedir — nunca colar no chat
gh secret set PROCONTACT_URL
gh secret set PROCONTACT_USUARIO
gh secret set PROCONTACT_SENHA
gh secret set INGEST_URL      # https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-ligacoes
gh secret set INGEST_TOKEN    # o mesmo valor do secret INGEST_LIGACOES_TOKEN do Plano A
```

- [ ] **Step 5: Ensaio no GitHub em modo `dry` (não grava)**

Actions → *Sincronizar chamadas manuais* → *Run workflow* → modo `dry`. (Ou `gh workflow run sincronizar.yml -f modo=dry`, depois `gh run watch`.)
Expected: o log mostra só contagens e a linha "Conferência (nada foi gravado): o arquivo tem N ligações válidas; o banco tem M…". Se falhar por bloqueio de IP do GitHub, **parar** e avisar o Rafael (risco 8.1 da spec: plano B = outro servidor/IP fixo).

- [ ] **Step 6: Primeira execução real manual, comparada com o upload manual**

Com a autorização do Rafael para gravar: Run workflow → modo `real`. Depois conferir (leitura) no Supabase:

```sql
select count(*), min(gerada_em), max(gerada_em) from public.ligacoes_manuais;
select ok, lidas, enviadas, invalidas, ignoradas_eagle, erro from public.ligacoes_sync_log order by id desc limit 3;
```

Expected: `ok = true`; `enviadas` bate com as ligações válidas (sem Eagle) do mesmo período; a contagem total em `ligacoes_manuais` não cai e não duplica (referência de 01/10: 8.815 sem Eagle). Repetir a execução `real`: a contagem total **não muda**.

- [ ] **Step 7: Ligar o agendamento (somente com o "sim" do Rafael)**

```bash
gh variable set ROBO_ATIVO --body true
```

Acompanhar 24 horas (Actions → execuções; `ligacoes_sync_log`). Para desligar: `gh variable set ROBO_ATIVO --body false` (ou apagar a variável). Para revogar acesso: trocar `INGEST_LIGACOES_TOKEN` no Supabase e `INGEST_TOKEN` no GitHub.

**Critério de pronto do Plano B:** `npm test` verde; ensaio `dry` bate com o banco; execução `real` repetida não duplica; agendamento ligado e `ligacoes_sync_log` recebendo uma linha `ok` por hora útil.
