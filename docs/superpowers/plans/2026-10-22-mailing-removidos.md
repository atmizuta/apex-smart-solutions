# Base de Mailing — Remover duplicados e cruzar com o NEO — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a exportação da aba Mailing tira, completando a quantidade, empresas com pedido no NeoSales e telefones repetidos, entrega um arquivo REMOVIDOS com o motivo, e o painel ganha uma caixa para limpar CSVs já gerados.

**Architecture:** a função `mailing-api` ganha duas ações pequenas (`neo`: lista de CNPJs com pedido; `fechar_parte`: grava os removidos de cada arquivo no histórico). A classificação (fica × removido) é uma função pura do painel, usada no laço de exportação em trechos (seção 102.10) e na limpeza de arquivos. O banco só ganha duas colunas em `mailing.extracao`.

**Tech Stack:** Deno Edge Function com `npm:postgres@3.4.5` (testes com `node --test`, Node 24), painel em `_template.html` (testes jsdom em `test_mailing.js`, `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules`), Postgres 17.

**Spec:** `docs/superpowers/specs/2026-10-22-mailing-removidos-design.md`

## Global Constraints

- "Estar no NEO" = CNPJ (14 dígitos, só números) com pedido em `public.producao_pedidos_neo`, **em qualquer etapa**. Cruzamento só por CNPJ.
- As duas caixas da exportação ("Cruzar com o NEO", "Remover duplicados") vêm **marcadas por padrão**.
- Com "Cruzar com o NEO" marcado, se a lista não vier, o pedido **não começa**. Aviso: "Não foi possível carregar os pedidos do NeoSales. Tente de novo ou desmarque Cruzar com o NEO."
- Ordem da classificação: primeiro pedido no NeoSales, depois telefone repetido. O primeiro de cada telefone fica.
- A quantidade pedida conta só o que vai para o arquivo; removidos não contam.
- Arquivo de removidos: `;`, Windows-1252, CRLF. Colunas `motivo;detalhe;socio;razao_social;cnpj;telefone;operadora;porte;cidade`. Na limpeza de arquivos vem `arquivo` antes de tudo. CNPJ e telefone saem formatados (o Excel não estraga).
- Limpar arquivo: lê Windows-1252 (ou UTF-8 com marca); exige `documento2` e `fone1` no cabeçalho; até 1.000.000 de linhas por arquivo; não mexe no banco.
- Design "Sinal de Ápice": só classes existentes (`.card`, `.mbAcoes`, `.mbChecks`, `.field`, `.btn btn-sm btn-outline`, `.desc`); sem cor fixa; avisos com `mostrarAviso`.
- Repositório público: testes só com dados fictícios.
- Publicação (migration, função v8, painel) só com ok do Rafael, no processo de sempre.

## Review Focus

- Trecho em que **todas** as linhas são removidas (filtro cheio de empresas do NEO): o pedido continua até completar ou o filtro acabar, sem travar. Teste: Task 3, cenário "tudo removido".
- Repetido **entre trechos e entre arquivos** do mesmo pedido, e telefone escrito com máscara num CSV antigo ("(11) 90000-0002"): continua sendo repetido. Teste: Task 2 (`c2`) e Task 3 (cenário de 3 chamadas).
- CNPJ que o Excel salvou sem o zero da frente (13 dígitos) num CSV antigo: ainda cruza com o NEO. Teste: Task 2 (`mbChaveCnpj`).
- CSV antigo salvo pelo Excel como "CSV UTF-8" (com marca no começo) ou com o cabeçalho em maiúsculas: é lido certo. Teste: Task 4.
- `fechar_parte` falhando (rede): os arquivos baixam do mesmo jeito e o aviso diz que o histórico não registrou as removidas. Teste: Task 3.

---

### Task 1: Banco e função — lista do NEO e removidos no histórico

**Files:**
- Create: `supabase/migrations/20261022100000_mailing_extracao_removidos.sql`
- Create: `supabase/rollback/20261022100000_mailing_extracao_removidos_rollback.sql`
- Modify: `supabase/functions/mailing-api/consulta.ts` (constantes SQL perto de `SQL_REGISTRAR_PARTE` e `SQL_HISTORICO`)
- Modify: `supabase/functions/mailing-api/api.ts` (`DepsApi`, `processar`)
- Modify: `supabase/functions/mailing-api/index.ts` (`criarDeps`)
- Test: `supabase/functions/mailing-api/consulta.test.ts`, `supabase/functions/mailing-api/api.test.ts`, `test_mailing_sql.js`

**Interfaces:**
- Produces (função): ação `neo` → `{ empresas: [{ cnpj, pedidos, numero_pedido, etapa, consultor, cadastro }] }`; ação `fechar_parte` com `{ pedido, parte, neo, repetidos }` → `200 { ok: true }`, `400` (validação) ou `404 { erro: "Parte do pedido não encontrada." }`; `historico` passa a trazer `removidos_neo` e `removidos_repetidos`.
- Produces (código): `SQL_NEO`, `SQL_FECHAR_PARTE` em `consulta.ts`; `DepsApi.neo(): Promise<unknown[]>`, `DepsApi.fecharParte(pedido: string, parte: number, userId: string, neo: number, repetidos: number): Promise<boolean>`.

- [ ] **Step 1: Testes que falham (consulta, api, migration)**

Em `consulta.test.ts`, acrescentar `SQL_NEO, SQL_FECHAR_PARTE, SQL_HISTORICO` ao import de `./consulta.ts` e, no fim do arquivo:

```ts
// 22/10 (seção 102.12): cruzar com o NEO = CNPJ com pedido no NeoSales em qualquer etapa; removidos no histórico
test("SQL_NEO: um registro por CNPJ de 14 dígitos com o último pedido, em qualquer etapa", () => {
  const s = SQL_NEO.replace(/\s+/g, " ");
  assert.match(s, /from public\.producao_pedidos_neo/);
  assert.match(s, /regexp_replace\(cnpj, '\[\^0-9\]', '', 'g'\) as cnpj/);
  assert.match(s, /where length\(cnpj\) = 14 group by cnpj/);
  assert.match(s, /\(array_agg\(etapa order by cadastro desc nulls last\)\)\[1\] as etapa/);
  assert.match(s, /\(array_agg\(usuario order by cadastro desc nulls last\)\)\[1\] as consultor/);
  assert.doesNotMatch(s, /etapa\s*(=|in|not in|<>)/i);
});

test("SQL_FECHAR_PARTE grava só no registro do próprio usuário; histórico traz os removidos", () => {
  assert.match(SQL_FECHAR_PARTE, /set removidos_neo = \$4, removidos_repetidos = \$5/);
  assert.match(SQL_FECHAR_PARTE, /where pedido = \$1::uuid and parte = \$2 and user_id = \$3::uuid returning id/);
  assert.match(SQL_HISTORICO, /removidos_neo, removidos_repetidos/);
});
```

Em `api.test.ts`, logo depois de `const LINHA = {...};`:

```ts
const EMPRESA_NEO = { cnpj: "00000000000191", pedidos: 2, numero_pedido: "1", etapa: "CONCLUIDO (NEOCRM)", consultor: "fulano",
  cadastro: "2026-10-01T12:00:00.000Z" };
```

No objeto `deps` de `criar()`, junto das outras funções falsas:

```ts
    async neo() { chamadas.push(["neo"]); return [EMPRESA_NEO]; },
    async fecharParte(...a) { chamadas.push(["fecharParte", ...a]); return true; },
```

E no fim do arquivo (depois de `const PEDIDO`):

```ts
test("neo: lista das empresas com pedido no NeoSales (só admin e supervisor)", async () => {
  const { deps, chamadas } = criar();
  assert.deepEqual(await processar({ acao: "neo" }, supCampinas, deps), { status: 200, body: { empresas: [EMPRESA_NEO] } });
  assert.deepEqual(chamadas.at(-1), ["neo"]);
  assert.equal((await processar({ acao: "neo" }, consultor, deps)).status, 403);
});

test("fechar_parte: valida e grava os removidos da parte do próprio usuário", async () => {
  const { deps, chamadas } = criar();
  const base = { acao: "fechar_parte", pedido: PEDIDO, parte: 2, neo: 3, repetidos: 40 };
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ pedido: "x" }, /pedido/], [{ parte: 0 }, /parte/], [{ neo: -1 }, /removidos/], [{ repetidos: 1.5 }, /removidos/],
    [{ neo: "3" }, /removidos/],
  ];
  for (const [over, msg] of casos) {
    const r = await processar({ ...base, ...over }, admin, deps);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(String(r.body.erro), msg);
  }
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await processar(base, admin, deps), { status: 200, body: { ok: true } });
  assert.deepEqual(chamadas.at(-1), ["fecharParte", PEDIDO, 2, admin.id, 3, 40]);
  const nao = criar({ async fecharParte() { return false; } });
  const r404 = await processar(base, admin, nao.deps);
  assert.equal(r404.status, 404);
  assert.match(String(r404.body.erro), /não encontrada/);
});
```

Em `test_mailing_sql.js`, antes do `console.log('--- RESULTADO:'`:

```js
// 22/10: removidos (pedido no NeoSales e telefone repetido) por arquivo, no histórico
const remov = ler('supabase/migrations/20261022100000_mailing_extracao_removidos.sql');
const rbRemov = ler('supabase/rollback/20261022100000_mailing_extracao_removidos_rollback.sql');
assert(remov.includes('alter table mailing.extracao\n  add column removidos_neo integer not null default 0,\n  add column removidos_repetidos integer not null default 0;'), 'extracao: removidos por motivo');
assert(!/mailing\.linha/.test(remov.replace(/--.*$/gm, '')), 'removidos não mexe na base de 12 mi');
assert(rbRemov.includes('drop column if exists removidos_neo'), 'rollback dos removidos');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"` e `node test_mailing_sql.js | tail -2` (na raiz do worktree)
Expected: falhas (import inexistente / ação inválida / arquivo de migration ausente).

- [ ] **Step 3: Migration e rollback**

`supabase/migrations/20261022100000_mailing_extracao_removidos.sql`:

```sql
-- Base de Mailing (seção 102.12): remover duplicados e cruzar com o NEO (22/10/2026, pedido do Rafael).
-- O painel tira do arquivo as empresas com pedido no NeoSales e os telefones repetidos, completando a quantidade.
-- quantidade_entregue continua sendo o que saiu da base; estas colunas dizem quantas dessas linhas o painel removeu.
alter table mailing.extracao
  add column removidos_neo integer not null default 0,
  add column removidos_repetidos integer not null default 0;
```

`supabase/rollback/20261022100000_mailing_extracao_removidos_rollback.sql`:

```sql
-- Desfaz 20261022100000_mailing_extracao_removidos.sql.
alter table mailing.extracao drop column if exists removidos_neo, drop column if exists removidos_repetidos;
```

- [ ] **Step 4: SQL em `consulta.ts`**

Logo depois de `SQL_REGISTRAR_PARTE`:

```ts
// 22/10 (seção 102.12): empresas com pedido da Apex no NeoSales, em qualquer etapa — uma linha por CNPJ, com o último
// pedido. Só CNPJ de 14 dígitos: os pedidos não têm telefone, e os poucos feitos com CPF ficam de fora.
export const SQL_NEO = `with p as (
  select regexp_replace(cnpj, '[^0-9]', '', 'g') as cnpj, numero_pedido, etapa, usuario, cadastro from public.producao_pedidos_neo
)
select cnpj, count(*)::int as pedidos,
  (array_agg(numero_pedido order by cadastro desc nulls last))[1] as numero_pedido,
  (array_agg(etapa order by cadastro desc nulls last))[1] as etapa,
  (array_agg(usuario order by cadastro desc nulls last))[1] as consultor,
  max(cadastro) as cadastro
  from p where length(cnpj) = 14 group by cnpj`;
// Ao fechar cada arquivo, o painel grava quantas linhas daquela parte removeu (só no registro do próprio usuário).
export const SQL_FECHAR_PARTE = `update mailing.extracao set removidos_neo = $4, removidos_repetidos = $5
  where pedido = $1::uuid and parte = $2 and user_id = $3::uuid returning id`;
```

E trocar `SQL_HISTORICO` por:

```ts
export const SQL_HISTORICO = `select criado_em, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida,
  quantidade_entregue, removidos_neo, removidos_repetidos from mailing.extracao order by criado_em desc limit 100`;
```

- [ ] **Step 5: Ações em `api.ts`**

No tipo `DepsApi`, depois de `extrairTrecho(...)`:

```ts
  neo(): Promise<unknown[]>;
  fecharParte(pedido: string, parte: number, userId: string, neo: number, repetidos: number): Promise<boolean>;
```

Depois de `const RE_UUID = ...`:

```ts
function validarPedidoParte(c: Record<string, unknown>): { ok: true; pedido: string; parte: number } | { ok: false; erro: string } {
  if (typeof c.pedido !== "string" || !RE_UUID.test(c.pedido)) return { ok: false, erro: "pedido inválido" };
  if (!Number.isInteger(c.parte) || (c.parte as number) < 1 || (c.parte as number) > 1000) return { ok: false, erro: "parte inválida" };
  return { ok: true, pedido: c.pedido.toLowerCase(), parte: c.parte as number };
}
const ehContagem = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 10_000_000;
```

Em `processar`, logo depois da linha do `historico`:

```ts
    // 22/10 (seção 102.12): lista do NeoSales para cruzar; removidos de cada arquivo no histórico
    if (acao === "neo") return { status: 200, body: { empresas: await deps.neo() } };
    if (acao === "fechar_parte") {
      const pp = validarPedidoParte(c);
      if (!pp.ok) return { status: 400, body: { erro: pp.erro } };
      if (!ehContagem(c.neo) || !ehContagem(c.repetidos)) return { status: 400, body: { erro: "removidos: use números inteiros a partir de 0" } };
      const gravou = await deps.fecharParte(pp.pedido, pp.parte, usuario.id, c.neo as number, c.repetidos as number);
      return gravou ? { status: 200, body: { ok: true } } : { status: 404, body: { erro: "Parte do pedido não encontrada." } };
    }
```

E no caminho `trecho`, trocar as duas validações de pedido/parte por:

```ts
      const pp = validarPedidoParte(c);
      if (!pp.ok) return { status: 400, body: { erro: pp.erro } };
```

e a chamada por `deps.extrairTrecho(w, ped, { ...registro, pedido: pp.pedido, parte: pp.parte })`.

- [ ] **Step 6: Banco em `index.ts`**

Acrescentar `SQL_NEO, SQL_FECHAR_PARTE` ao import de `./consulta.ts` e, em `criarDeps`, depois de `extrairTrecho`:

```ts
    async neo() {
      return [...(await sql.unsafe(SQL_NEO))];
    },
    async fecharParte(pedido, parte, userId, neo, repetidos) {
      return (await sql.unsafe(SQL_FECHAR_PARTE, [pedido, parte, userId, neo, repetidos] as never[])).length > 0;
    },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts 2>&1 | grep -E "^ℹ (pass|fail)" && node --check index.ts` e, na raiz, `node test_mailing_sql.js | tail -1`
Expected: `fail 0`, sintaxe ok, `0 falharam`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261022100000_mailing_extracao_removidos.sql supabase/rollback/20261022100000_mailing_extracao_removidos_rollback.sql supabase/functions/mailing-api/ test_mailing_sql.js
git commit -m "feat(mailing): ações neo e fechar_parte na mailing-api; removidos no histórico (seção 102.12)"
```

---

### Task 2: Painel — classificar, montar REMOVIDOS e ler CSV (funções puras)

**Files:**
- Modify: `_template.html` (bloco da Base de Mailing, depois de `mbNovoPedido`)
- Test: `test_mailing.js` (antes de `const colsExp`)

**Interfaces:**
- Produces: `MB_MOTIVO_NEO`, `MB_MOTIVO_REPETIDO`, `MB_CAB_REMOVIDOS`, `MB_LIMPAR_MAX`; `mbSoDigitos(v): string`; `mbChaveCnpj(v): string` (14 dígitos ou ''); `mbFmtCnpj(v): string`; `mbFmtFone(v): string`; `mbDetalheNeo(p): string`; `mbClassificar(colunas: string[], linhas: string[][], opcoes: { neo: Map<string, object>|null, duplicados: boolean }, estado: { vistos: Map<string, string> }): { ficam: string[][], removidos: object[] }` (cada removido: `{ motivo, detalhe, socio, razao_social, cnpj, telefone, operadora, porte, cidade }`); `mbMontarRemovidos(removidos, comArquivo?): string`; `mbLerCsv(texto): string[][]`; `mbDecodificar(buffer: ArrayBuffer): string`.

- [ ] **Step 1: Testes que falham**

Em `test_mailing.js`, antes de `const colsExp = [...]` (dentro do `testScript`; atenção: é string de template, então `\\r\\n` vira `\r\n`):

```js
  // ==== 22/10 (seção 102.12): remover duplicados e cruzar com o NEO — funções puras ====
  eq(mbChaveCnpj('1.234.567/0001-90'), '01234567000190', 'CNPJ sem o zero da frente (Excel) volta a 14 dígitos');
  eq(mbChaveCnpj(''), '', 'CNPJ vazio');
  eq(mbFmtCnpj('00000000000191'), '00.000.000/0001-91', 'CNPJ formatado no REMOVIDOS');
  eq([mbFmtFone('11912345678'), mbFmtFone('1132345678'), mbFmtFone('123')], ['(11) 91234-5678', '(11) 3234-5678', '123'], 'telefone formatado');
  eq(mbDetalheNeo({ numero_pedido: '123', etapa: 'CONCLUIDO (NEOCRM)', consultor: 'fulano', cadastro: '2026-10-10T15:00:00Z' }),
    'pedido 123 · CONCLUIDO · fulano · 10/10/2026', 'detalhe do pedido, sem o (NEOCRM)');
  const colsC = ['nome', 'descricao', 'documento1', 'documento2', 'fone1', 'campo1', 'campo2', 'campo3'];
  const L = (cnpj, fone) => ['SOCIO TESTE', 'EMPRESA TESTE', '00000000191', cnpj, fone, 'CLARO S.A.', 'MEI', 'SAO PAULO'];
  const neoMapa = new Map([['00000000000191', { numero_pedido: '9', etapa: 'VENDA PERDIDA (NEOCRM)', consultor: 'ciclano', cadastro: null }]]);
  const est = { vistos: new Map() };
  const k1 = mbClassificar(colsC, [L('00000000000191', '11900000001'), L('00000000000272', '11900000002'), L('00000000000353', '11900000002'),
    L('00000000000434', ''), L('00000000000515', '11900000001')], { neo: neoMapa, duplicados: true }, est);
  eq(k1.ficam.map(l => l[3]), ['00000000000272', '00000000000434', '00000000000515'], 'fica o primeiro de cada telefone, quem não tem telefone e o telefone de empresa do NEO');
  eq(k1.removidos.map(r => [r.motivo, r.detalhe]), [['Pedido no NeoSales', 'pedido 9 · VENDA PERDIDA · ciclano'],
    ['Telefone repetido', 'ficou no CNPJ 00.000.000/0002-72']], 'removidos com motivo e detalhe (NEO antes de repetido)');
  eq([k1.removidos[1].cnpj, k1.removidos[1].telefone, k1.removidos[1].socio], ['00.000.000/0003-53', '(11) 90000-0002', 'SOCIO TESTE'], 'CNPJ e telefone formatados no removido');
  const k2 = mbClassificar(colsC, [L('00000000000596', '(11) 90000-0002')], { neo: null, duplicados: true }, est);
  eq(k2.removidos.length, 1, 'repetido vale entre trechos/arquivos e com telefone escrito com máscara');
  const k3 = mbClassificar(colsC, [L('00000000000191', '11900000009')], { neo: null, duplicados: false }, { vistos: new Map() });
  eq([k3.ficam.length, k3.removidos.length], [1, 0], 'opções desmarcadas: nada sai');
  eq(mbMontarRemovidos(k1.removidos).split('\\r\\n')[0], 'motivo;detalhe;socio;razao_social;cnpj;telefone;operadora;porte;cidade', 'cabeçalho do REMOVIDOS');
  eq(mbMontarRemovidos([Object.assign({ arquivo: 'A.csv' }, k1.removidos[0])], true).split('\\r\\n')[1].split(';').slice(0, 3),
    ['A.csv', 'Pedido no NeoSales', 'pedido 9 · VENDA PERDIDA · ciclano'], 'REMOVIDOS da limpeza leva o arquivo de origem');
  eq(mbLerCsv('a;b\\r\\n"x;1";"di ""oi"""\\r\\n"l1\\nl2";z'), [['a', 'b'], ['x;1', 'di "oi"'], ['l1\\nl2', 'z']], 'lê aspas, ; e quebra de linha dentro do campo');
  eq(mbLerCsv('a;b\\n1;2\\n'), [['a', 'b'], ['1', '2']], 'aceita só LF e linha final vazia');
  eq(mbLerCsv(mbMontarCsv(colsC, [L('00000000000191', '11900000001')]))[1].length, 20, 'lê de volta o CSV que o painel gera (20 colunas)');
  eq(mbDecodificar(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41, 0xC3, 0xA7]).buffer), 'Aç', 'CSV UTF-8 do Excel (com marca)');
  eq(mbDecodificar(new Uint8Array([0x41, 0xE7]).buffer), 'Aç', 'CSV Windows-1252 do painel');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -3`
Expected: `FALHA: ReferenceError: mbChaveCnpj is not defined`

- [ ] **Step 3: Implementar**

Em `_template.html`, logo depois da função `mbNovoPedido(){...}`:

```js
// ===== 22/10 (seção 102.12, pedido do Rafael): remover duplicados e cruzar com o NEO =====
// Spec: docs/superpowers/specs/2026-10-22-mailing-removidos-design.md. NEO = CNPJ com pedido no NeoSales, em qualquer etapa.
const MB_MOTIVO_NEO = 'Pedido no NeoSales', MB_MOTIVO_REPETIDO = 'Telefone repetido';
const MB_CAB_REMOVIDOS = ['motivo', 'detalhe', 'socio', 'razao_social', 'cnpj', 'telefone', 'operadora', 'porte', 'cidade'];
const MB_LIMPAR_MAX = 1000000;
function mbSoDigitos(v){ return String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); }
// o Excel tira o zero da frente do CNPJ: completa até 14 dígitos para cruzar
function mbChaveCnpj(v){ const d = mbSoDigitos(v); return d ? d.padStart(14, '0') : ''; }
function mbFmtCnpj(v){
  const d = mbChaveCnpj(v);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(v === null || v === undefined ? '' : v);
}
function mbFmtFone(v){
  const d = mbSoDigitos(v);
  if(d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if(d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return String(v === null || v === undefined ? '' : v);
}
function mbDetalheNeo(p){
  const data = p.cadastro ? new Date(p.cadastro).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  return ['pedido ' + (p.numero_pedido || '—'), String(p.etapa || '').replace(/\s*\(NEOCRM\)\s*$/i, ''), p.consultor || '', data]
    .filter(Boolean).join(' · ');
}
// Separa o que vai para o arquivo e o que sai. Primeiro o CNPJ com pedido no NeoSales; depois o telefone já visto
// (estado.vistos: telefone → CNPJ que ficou, vale para o pedido inteiro ou para todos os arquivos da limpeza).
function mbClassificar(colunas, linhas, opcoes, estado){
  const idx = {};
  (colunas || []).forEach((c, i) => { idx[String(c).trim().toLowerCase()] = i; });
  const v = (l, c) => (c in idx && l[idx[c]] !== null && l[idx[c]] !== undefined ? String(l[idx[c]]) : '');
  const ficam = [], removidos = [];
  for(const l of (linhas || [])){
    const cnpj = mbChaveCnpj(v(l, 'documento2')), fone = mbSoDigitos(v(l, 'fone1'));
    let motivo = '', detalhe = '';
    const p = opcoes.neo && cnpj ? opcoes.neo.get(cnpj) : null;
    if(p){ motivo = MB_MOTIVO_NEO; detalhe = mbDetalheNeo(p); }
    else if(opcoes.duplicados && fone){
      if(estado.vistos.has(fone)){ motivo = MB_MOTIVO_REPETIDO; detalhe = 'ficou no CNPJ ' + mbFmtCnpj(estado.vistos.get(fone)); }
      else estado.vistos.set(fone, cnpj);
    }
    if(!motivo){ ficam.push(l); continue; }
    removidos.push({ motivo, detalhe, socio: v(l, 'nome'), razao_social: v(l, 'descricao'), cnpj: mbFmtCnpj(v(l, 'documento2')),
      telefone: mbFmtFone(v(l, 'fone1')), operadora: v(l, 'campo1'), porte: v(l, 'campo2'), cidade: v(l, 'campo3') });
  }
  return { ficam, removidos };
}
function mbMontarRemovidos(removidos, comArquivo){
  const cab = (comArquivo ? ['arquivo'] : []).concat(MB_CAB_REMOVIDOS);
  const saida = [cab.join(';')];
  for(const r of (removidos || [])) saida.push(cab.map(c => mbCampoCsv(r[c])).join(';'));
  return saida.join('\r\n') + '\r\n';
}
// Lê o CSV que o painel gera (';', campos entre aspas, CRLF ou LF). Devolve listas; a primeira é o cabeçalho.
function mbLerCsv(texto){
  const s = String(texto || ''), linhas = [];
  let campo = '', linha = [], aspas = false;
  for(let i = 0; i < s.length; i++){
    const ch = s[i];
    if(aspas){
      if(ch === '"'){ if(s[i + 1] === '"'){ campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if(ch === '"') aspas = true;
    else if(ch === ';'){ linha.push(campo); campo = ''; }
    else if(ch === '\n' || ch === '\r'){
      if(ch === '\r' && s[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if(linha.length > 1 || linha[0] !== '') linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  if(campo !== '' || linha.length){ linha.push(campo); linhas.push(linha); }
  return linhas;
}
// o painel gera Windows-1252; o Excel pode salvar "CSV UTF-8", que começa com a marca EF BB BF
function mbDecodificar(buffer){
  const b = new Uint8Array(buffer);
  if(b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  return new TextDecoder('windows-1252').decode(b);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -2`
Expected: `--- RESULTADO: N passaram, 0 falharam ---`

- [ ] **Step 5: Commit**

```bash
git add _template.html test_mailing.js
git commit -m "feat(mailing): classificar removidos (NEO e repetidos), REMOVIDOS e leitura de CSV (seção 102.12)"
```

---

### Task 3: Painel — exportação com "Cruzar com o NEO" e "Remover duplicados"

**Files:**
- Modify: `_template.html` (cartão "Exportar para o ProContact"; `mbExportar`, `mbExportarPedido`, `mbRenderHistorico`)
- Test: `test_mailing.js`

**Interfaces:**
- Consumes: Task 1 (ações `neo`, `fechar_parte`, campos `removidos_*` no histórico); Task 2 (`mbClassificar`, `mbMontarRemovidos`, `mbChaveCnpj`, `MB_MOTIVO_NEO`).
- Produces: `mbCarregarNeo(): Promise<{ mapa: Map<string, object> } | { erro: string }>`; `mbExportarPedido(carga, total, filtros, opcoes: { neo: boolean, duplicados: boolean })`; elementos `#mbCruzarNeo`, `#mbRemoverDuplicados` (marcados).

- [ ] **Step 1: Testes que falham**

Em `test_mailing.js`, logo depois de `const extrairChamadas = ...`:

```js
  eq([document.getElementById('mbCruzarNeo').checked, document.getElementById('mbRemoverDuplicados').checked], [true, true], 'as duas caixas vêm marcadas');
  // os testes de exportação abaixo são do comportamento sem as opções (o mesmo de antes de 22/10)
  document.getElementById('mbCruzarNeo').checked = false; document.getElementById('mbRemoverDuplicados').checked = false;
```

E logo antes de `window.__fnRespostas.contar = { data: null, error: { context:` (fim dos testes de exportação):

```js
  // 22/10 (seção 102.12): exportar tirando empresas com pedido no NeoSales e telefones repetidos, completando a quantidade
  document.getElementById('mbCruzarNeo').checked = true; document.getElementById('mbRemoverDuplicados').checked = true;
  const empresaNeo = { cnpj: '00000000000191', pedidos: 1, numero_pedido: '9', etapa: 'CONCLUIDO (NEOCRM)', consultor: 'ciclano', cadastro: null };
  const respostasNeo = () => [
    [L('00000000000191', '11900000001'), L('00000000000272', '11900000002'), L('00000000000353', '11900000002'), L('00000000000434', '11900000003')],
    [L('00000000000515', '11900000003'), L('00000000000596', '11900000004'), L('00000000000677', '11900000005'), L('00000000000758', '11900000006')],
    [L('00000000000839', '11900000007')],
  ];
  const extrairNeo = (fila, nomeArq) => (body) => {
    const linhas = (fila.shift() || []).slice(0, body.quantidade);
    return { data: { colunas: colsExp, linhas, quantidade_entregue: linhas.length, nome_arquivo: nomeArq,
      proxima: fila.length ? { fase: 1, pagina: body.trecho.pagina + body.trecho.paginas } : null, paginas_total: 380000, paginas_lidas: body.trecho.paginas }, error: null };
  };
  window.__fnRespostas.neo = { data: { empresas: [empresaNeo] }, error: null };
  window.__fnRespostas.fechar_parte = { data: { ok: true }, error: null };
  window.__fnRespostas.extrair = extrairNeo(respostasNeo(), 'NEO_2026-10-22.csv');
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = 'NEO'; document.getElementById('mbQtd').value = '6';
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq(chamadas.map(c => c.body.acao).slice(0, 2), ['neo', 'extrair'], 'busca a lista do NeoSales antes de extrair');
  eq(extrairChamadas().map(b => b.quantidade), [6, 4, 1], 'removidos não contam: pede de novo até completar');
  eq(baixados.map(b => b.nome), ['NEO_2026-10-22.csv', 'NEO_2026-10-22_REMOVIDOS.csv'], 'mailing e REMOVIDOS');
  const ficamEsperado = [L('00000000000272', '11900000002'), L('00000000000434', '11900000003'), L('00000000000596', '11900000004'),
    L('00000000000677', '11900000005'), L('00000000000758', '11900000006'), L('00000000000839', '11900000007')];
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, ficamEsperado)).length, 'mailing com as 6 linhas que ficaram');
  const remEsperado = mbClassificar(colsExp, respostasNeo().flat(), { neo: new Map([['00000000000191', empresaNeo]]), duplicados: true }, { vistos: new Map() }).removidos;
  eq(remEsperado.map(r => r.motivo), ['Pedido no NeoSales', 'Telefone repetido', 'Telefone repetido'], 'repetido entre trechos também sai');
  eq(baixados[1] && baixados[1].blob.size, mbParaCp1252(mbMontarRemovidos(remEsperado)).length, 'REMOVIDOS com as 3 linhas');
  eq(chamadas.filter(c => c.body.acao === 'fechar_parte').map(c => [c.body.parte, c.body.neo, c.body.repetidos]), [[1, 1, 2]], 'histórico recebe as removidas da parte');
  assert(avisos[0] && avisos[0][0] === 'ok' && avisos[0][1].includes('6 linhas') && avisos[0][1].includes('1 com pedido no NeoSales')
    && avisos[0][1].includes('2 telefones repetidos'), 'aviso com as removidas por motivo');

  // tudo removido num trecho e o filtro acaba: não trava e baixa só o REMOVIDOS
  window.__fnRespostas.extrair = extrairNeo([[L('00000000000191', '11900000001')]], 'SO_2026-10-22.csv');
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq(baixados.map(b => b.nome), ['SO_2026-10-22_REMOVIDOS.csv'], 'tudo removido: só o arquivo REMOVIDOS');
  assert(avisos[0] && avisos[0][0] === 'info' && avisos[0][1].includes('Nenhuma linha ficou'), 'aviso de que nada ficou');
  eq(chamadas.filter(c => c.body.acao === 'fechar_parte').map(c => [c.body.parte, c.body.neo, c.body.repetidos]), [[1, 1, 0]], 'histórico recebe as removidas mesmo sem arquivo');

  // fechar_parte falha: os arquivos saem e o aviso diz que o histórico não registrou
  window.__fnRespostas.fechar_parte = { data: null, error: { message: 'Failed to fetch' } };
  window.__fnRespostas.extrair = extrairNeo(respostasNeo(), 'NEO_2026-10-22.csv');
  baixados.length = 0; avisos.length = 0;
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  assert(baixados.length === 2 && avisos[0] && avisos[0][0] === 'ok' && avisos[0][1].includes('histórico não registrou'), 'falha no histórico não perde os arquivos');
  window.__fnRespostas.fechar_parte = { data: { ok: true }, error: null };

  // sem a lista do NeoSales o pedido não começa
  window.__fnRespostas.neo = { data: null, error: { message: 'Failed to fetch' } };
  baixados.length = 0; avisos.length = 0; chamadas.length = 0;
  document.getElementById('btnMbExportar').click(); await ateTerminar();
  eq([extrairChamadas().length, baixados.length, avisos[0] && avisos[0][0]], [0, 0, 'erro'], 'sem a lista do NeoSales nada é extraído');
  assert(avisos[0] && avisos[0][1].includes('desmarque Cruzar com o NEO'), 'aviso explica como seguir');
  window.__fnRespostas.neo = { data: { empresas: [empresaNeo] }, error: null };

  // histórico: linhas do arquivo e removidas
  mbRenderHistorico([{ criado_em: '2026-10-22T20:00:00Z', username: 'adm', nome_carga: 'NEO', filtros: {}, quantidade_entregue: 9,
    removidos_neo: 1, removidos_repetidos: 2 }]);
  assert(document.getElementById('mbHistorico').innerHTML.includes('6 (+3 removidas)'), 'histórico mostra o que foi para o arquivo e as removidas');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -3`
Expected: `FALHA: TypeError: Cannot read properties of null (reading 'checked')` (caixas ainda não existem).

- [ ] **Step 3: HTML das caixas**

No cartão "Exportar para o ProContact", logo depois do `</div>` que fecha o `<div class="mbAcoes" style="align-items:flex-end">` do botão Exportar CSV:

```html
        <div class="mbChecks">
          <label><input type="checkbox" id="mbCruzarNeo" checked> Cruzar com o NEO (tira empresas com pedido no NeoSales)</label>
          <label><input type="checkbox" id="mbRemoverDuplicados" checked> Remover duplicados (cada telefone sai uma vez)</label>
        </div>
```

E no parágrafo de explicação do cartão, antes de "O arquivo já vem no layout de importação do ProContact.", inserir: `As linhas removidas (empresa com pedido no NeoSales ou telefone repetido) saem num arquivo REMOVIDOS, com o motivo, e a quantidade é completada com outras.`

- [ ] **Step 4: Exportação**

Trocar `mbExportar` e `mbExportarPedido` (do comentário "Todas as chamadas levam a hora do início do pedido" até o fim de `mbExportarPedido`) por:

```js
async function mbExportar(){
  if(!canSeeMailing() || mbEstado.exportando) return;
  const carga = document.getElementById('mbCarga').value.trim();
  if(!carga){ mostrarAviso('Informe o nome da carga (ex.: ICP-D-MEI-VIVO-APEX).', 'erro'); return; }
  const quantidade = mbValidarQuantidade(document.getElementById('mbQtd').value);
  if(!quantidade){ mostrarAviso('Quantidade deve ser um número inteiro a partir de 1.', 'erro'); return; }
  const opcoes = { neo: document.getElementById('mbCruzarNeo').checked, duplicados: document.getElementById('mbRemoverDuplicados').checked };
  await mbExportarPedido(carga, quantidade, mbLerFiltros(), opcoes);
  const h = await mbChamar('historico');
  if(!h.erro) mbRenderHistorico(h.data.extracoes || []);
}
async function mbCarregarNeo(){
  const r = await mbChamar('neo');
  if(r.erro) return { erro: r.erro };
  const mapa = new Map();
  for(const p of (r.data.empresas || [])){ const k = mbChaveCnpj(p.cnpj); if(k) mapa.set(k, p); }
  return { mapa };
}
// Todas as chamadas levam a hora do início do pedido (extraida_antes_de): o que já saiu não volta. As linhas se juntam em
// arquivos de até MB_MAX_QTD; cada arquivo é uma "parte" no histórico. "Parar" e erro baixam o que já saiu (já está marcado).
// 22/10 (seção 102.12): com as opções, o que é removido (pedido no NeoSales, telefone repetido) vai para o arquivo REMOVIDOS,
// não conta na quantidade e é registrado na parte (fechar_parte).
async function mbExportarPedido(carga, total, filtros, opcoes){
  const op = opcoes || { neo: false, duplicados: false };
  let neo = null;
  if(op.neo){
    const r = await mbCarregarNeo();
    if(r.erro){ mostrarAviso('Não foi possível carregar os pedidos do NeoSales. Tente de novo ou desmarque Cruzar com o NEO.', 'erro'); return; }
    neo = r.mapa;
  }
  const n = Math.ceil(total / MB_MAX_QTD);
  const pedido = mbNovoPedido();
  const f = Object.assign({}, filtros, { extraida_antes_de: new Date().toISOString() });
  const prog = document.getElementById('mbProgresso'), txt = document.getElementById('mbProgressoTexto'), btn = document.getElementById('btnMbExportar');
  mbEstado.exportando = true; mbEstado.parar = false;
  prog.hidden = false; btn.disabled = true;
  txt.textContent = 'Procurando na base…';
  const estado = { vistos: new Map() }, removidos = [];
  let entregue = 0, arquivos = 0, erro = null, acabou = false, lidas = 0, achadas = 0, semHistorico = false;
  let buf = [], colunas = null, nome = null, trecho = { fase: 1, pagina: 0 };
  let parteNeo = 0, parteRep = 0, parteUsada = false;
  const fecharArquivo = async () => {
    const numero = arquivos + 1;
    if(buf.length){
      arquivos++;
      mbBaixarCsv({ colunas, linhas: buf }, mbNomeParte(nome, arquivos, n));
      entregue += buf.length; buf = [];
    }
    if(parteUsada && (op.neo || op.duplicados)){
      const r = await mbChamar('fechar_parte', { pedido, parte: numero, neo: parteNeo, repetidos: parteRep });
      if(r.erro) semHistorico = true;
    }
    parteNeo = 0; parteRep = 0; parteUsada = false;
  };
  try{
    while(!mbEstado.parar){
      const faltam = Math.min(MB_MAX_QTD - buf.length, total - entregue - buf.length);
      if(faltam <= 0) break;
      const t = trecho.fase === 1 ? { fase: 1, pagina: trecho.pagina, paginas: mbPaginasTrecho(faltam, lidas, achadas) } : trecho;
      const r = await mbChamar('extrair', { filtros: f, quantidade: faltam, nome_carga: carga, pedido, parte: arquivos + 1, trecho: t });
      if(r.erro){ erro = r.erro; break; }
      const d = r.data, linhas = d.linhas || [];
      colunas = d.colunas; nome = d.nome_arquivo;
      if(linhas.length) parteUsada = true;
      const c = mbClassificar(colunas, linhas, { neo, duplicados: op.duplicados }, estado);
      for(const l of c.ficam) buf.push(l); // sem push(...): 100 mil argumentos estouram a pilha em alguns navegadores
      for(const x of c.removidos){ removidos.push(x); if(x.motivo === MB_MOTIVO_NEO) parteNeo++; else parteRep++; }
      if(t.fase === 1){ lidas += d.paginas_lidas || 0; achadas += linhas.length; }
      if(buf.length >= MB_MAX_QTD) await fecharArquivo();
      if(!d.proxima){ acabou = true; break; }
      trecho = d.proxima;
      const ate = mbFmtNum(entregue + buf.length) + ' de ' + mbFmtNum(total) + ' linhas'
        + (removidos.length ? ' · ' + mbFmtNum(removidos.length) + ' removidas' : '');
      txt.textContent = trecho.fase === 1 && d.paginas_total
        ? 'Procurando na base… ' + Math.min(99, Math.floor(100 * trecho.pagina / d.paginas_total)) + '% lida · ' + ate + '.'
        : 'Conferindo os números já usados há mais tempo… · ' + ate + '.';
    }
  } finally {
    try{
      await fecharArquivo();
      if(removidos.length){
        downloadBlob(new Blob([mbParaCp1252(mbMontarRemovidos(removidos))], { type: 'text/csv;charset=windows-1252' }),
          String(nome || carga + '.csv').replace(/(\.csv)?$/i, '_REMOVIDOS.csv'));
      }
    } finally {
      mbEstado.exportando = false;
      prog.hidden = true; btn.disabled = false;
    }
  }
  const parou = mbEstado.parar;
  mbEstado.parar = false;
  const nNeo = removidos.filter(x => x.motivo === MB_MOTIVO_NEO).length, nRep = removidos.length - nNeo;
  const rem = removidos.length ? ' · removidas: ' + [nNeo ? mbFmtNum(nNeo) + ' com pedido no NeoSales' : '', nRep ? mbFmtNum(nRep) + ' telefones repetidos' : '']
    .filter(Boolean).join(' e ') + ' (arquivo REMOVIDOS)' : '';
  const extra = (semHistorico ? ' O histórico não registrou as removidas.' : '') + (neo && !neo.size ? ' A lista do NeoSales veio vazia.' : '');
  const feito = mbFmtNum(entregue) + ' linhas em ' + arquivos + (arquivos === 1 ? ' arquivo' : ' arquivos') + rem;
  if(erro) mostrarAviso(erro + (entregue || removidos.length ? ' Já baixados: ' + feito + '.' : '') + extra, 'erro');
  else if(!entregue && removidos.length) mostrarAviso('Nenhuma linha ficou: as ' + mbFmtNum(removidos.length) + ' encontradas foram removidas (arquivo REMOVIDOS).' + extra, 'info');
  else if(!entregue) mostrarAviso('Nenhuma linha com esses filtros. Nada foi exportado.' + extra, 'info');
  else if(parou) mostrarAviso(feito + ' — parou a seu pedido.' + extra, 'ok');
  else if(acabou && entregue < total) mostrarAviso(feito + ' — são todas as linhas do filtro. A contagem (≈) é estimativa; este é o número exato.' + extra, 'ok');
  else mostrarAviso(feito + '.' + extra, 'ok');
}
```

- [ ] **Step 5: Histórico**

Em `mbRenderHistorico`, trocar a célula `<td style="text-align:right">${e(mbFmtNum(x.quantidade_entregue))}</td>` por `<td style="text-align:right">${e(mbLinhasHistorico(x))}</td>` e acrescentar, antes de `mbRenderHistorico`:

```js
// 22/10 (seção 102.12): "Linhas" = o que foi para o arquivo; as removidas (NEO e repetidos) aparecem ao lado
function mbLinhasHistorico(x){
  const rem = (Number(x.removidos_neo) || 0) + (Number(x.removidos_repetidos) || 0);
  return mbFmtNum((Number(x.quantidade_entregue) || 0) - rem) + (rem ? ' (+' + mbFmtNum(rem) + ' removidas)' : '');
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -2`
Expected: `0 falharam`

- [ ] **Step 7: Commit**

```bash
git add _template.html test_mailing.js
git commit -m "feat(mailing): exportar com Cruzar com o NEO e Remover duplicados, arquivo REMOVIDOS (seção 102.12)"
```

---

### Task 4: Painel — limpar arquivo já gerado, registro e suíte

**Files:**
- Modify: `_template.html` (novo cartão logo depois do cartão de exportação; `mbLimparArquivos` e os dois botões)
- Modify: `REGRAS_NEGOCIO.md` (seção 102.12, depois da 102.11)
- Modify: `docs/superpowers/specs/2026-10-22-mailing-removidos-design.md` (3.4: "cartão logo abaixo" em vez de "no mesmo cartão")
- Test: `test_mailing.js`

**Interfaces:**
- Consumes: Task 2 (`mbClassificar`, `mbMontarRemovidos`, `mbLerCsv`, `mbDecodificar`, `MB_LIMPAR_MAX`); Task 3 (`mbCarregarNeo`).
- Produces: `mbLimparArquivos(arquivos: File[]|FileList|{name, arrayBuffer}[], modo: 'duplicados'|'neo'): Promise<void>`; `mbLerArquivo(a): Promise<ArrayBuffer>`; elementos `#mbArquivosLimpar`, `#btnMbRemoverDuplicados`, `#btnMbCruzarNeo`.

- [ ] **Step 1: Testes que falham**

Em `test_mailing.js`, logo depois do teste do histórico com removidas (Task 3):

```js
  // 22/10 (seção 102.12): limpar arquivo já gerado
  assert(document.getElementById('btnMbRemoverDuplicados') && document.getElementById('btnMbCruzarNeo') && document.getElementById('mbArquivosLimpar'),
    'caixa de limpar arquivo com os dois botões');
  const csvA = mbMontarCsv(colsExp, [L('00000000000191', '11900000001'), L('00000000000272', '11900000002')]);
  const csvB = mbMontarCsv(colsExp, [L('00000000000353', '11900000002'), L('00000000000434', '11900000003')]);
  const arq = (name, buf) => ({ name, arrayBuffer: async () => buf });
  const cp = t => mbParaCp1252(t).slice().buffer;
  const comMarca = t => { const b = mbParaCp1252(t); const u = new Uint8Array(b.length + 3); u.set([0xEF, 0xBB, 0xBF]); u.set(b, 3); return u.buffer; };
  const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  baixados.length = 0; avisos.length = 0;
  await mbLimparArquivos([arq('A.csv', cp(csvA)), arq('B.csv', comMarca(csvB.replace('documento2', 'DOCUMENTO2')))], 'duplicados');
  eq(baixados.map(b => b.nome), ['A_LIMPO.csv', 'B_LIMPO.csv', 'REMOVIDOS_' + hojeSP + '.csv'], 'um LIMPO por arquivo e um REMOVIDOS');
  eq(baixados[1] && baixados[1].blob.size, mbParaCp1252(mbMontarCsv(colsExp, [L('00000000000434', '11900000003')])).length,
    'repetido entre arquivos sai do segundo (UTF-8 com marca e cabeçalho em maiúsculas lidos certo)');
  assert(avisos[0] && avisos[0][0] === 'ok' && avisos[0][1].includes('2 arquivos limpos') && avisos[0][1].includes('removidas: 1'), 'aviso da limpeza');
  baixados.length = 0; avisos.length = 0;
  await mbLimparArquivos([arq('A.csv', cp(csvA))], 'neo');
  eq(baixados.map(b => b.nome), ['A_LIMPO.csv', 'REMOVIDOS_' + hojeSP + '.csv'], 'Cruzar com o NEO num arquivo antigo');
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, [L('00000000000272', '11900000002')])).length, 'tirou a empresa com pedido');
  baixados.length = 0; avisos.length = 0;
  await mbLimparArquivos([arq('X.csv', cp('a;b\\r\\n1;2\\r\\n'))], 'duplicados');
  eq([baixados.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'arquivo fora do layout: nada sai');
  assert(avisos[0] && avisos[0][1].includes('X.csv não está no layout do ProContact'), 'aviso diz qual arquivo');
  avisos.length = 0;
  await mbLimparArquivos([], 'duplicados');
  assert(avisos[0] && avisos[0][0] === 'erro' && avisos[0][1].includes('Escolha'), 'sem arquivo: aviso');
  window.__fnRespostas.neo = { data: null, error: { message: 'Failed to fetch' } };
  baixados.length = 0; avisos.length = 0;
  await mbLimparArquivos([arq('A.csv', cp(csvA))], 'neo');
  eq([baixados.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'sem a lista do NeoSales a limpeza não sai');
  window.__fnRespostas.neo = { data: { empresas: [empresaNeo] }, error: null };
```
- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -3`
Expected: `FALHOU: caixa de limpar arquivo com os dois botões` seguido de `ReferenceError: mbLimparArquivos is not defined`.

- [ ] **Step 3: HTML do cartão**

Logo depois do `</div>` que fecha o cartão "Exportar para o ProContact" (antes do cartão "Histórico de extrações"):

```html
      <div class="card">
        <h3 style="margin:0 0 var(--space-3)">Limpar arquivo já gerado</h3>
        <div class="mbAcoes" style="align-items:flex-end">
          <div class="field" style="margin:0"><label for="mbArquivosLimpar">Arquivos CSV do ProContact</label><input type="file" id="mbArquivosLimpar" accept=".csv,text/csv" multiple></div>
          <button type="button" class="btn btn-sm btn-outline" id="btnMbRemoverDuplicados" style="width:auto">Remover duplicados</button>
          <button type="button" class="btn btn-sm btn-outline" id="btnMbCruzarNeo" style="width:auto">Cruzar com o NEO</button>
        </div>
        <p class="desc" style="margin:var(--space-2) 0 0">Sai um arquivo _LIMPO para cada arquivo escolhido e um REMOVIDOS com o que saiu e o motivo. Com vários arquivos, um telefone que já apareceu num arquivo sai dos seguintes. Não muda nada na base.</p>
      </div>
```

- [ ] **Step 4: JS da limpeza**

Logo depois de `mbExportarPedido`:

```js
function mbLerArquivo(a){
  if(a && typeof a.arrayBuffer === 'function') return a.arrayBuffer();
  return new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ko(fr.error); fr.readAsArrayBuffer(a); });
}
// 22/10 (seção 102.12): limpa CSVs já gerados, sem mexer na base. Lê todos antes (layout errado não baixa nada pela metade).
async function mbLimparArquivos(arquivos, modo){
  if(!canSeeMailing() || mbEstado.limpando) return;
  const lista = Array.from(arquivos || []);
  if(!lista.length){ mostrarAviso('Escolha um ou mais arquivos CSV.', 'erro'); return; }
  const botoes = ['btnMbRemoverDuplicados', 'btnMbCruzarNeo'].map(id => document.getElementById(id));
  mbEstado.limpando = true;
  botoes.forEach(b => { b.disabled = true; });
  try{
    const lidos = [];
    for(const a of lista){
      let tab;
      try{ tab = mbLerCsv(mbDecodificar(await mbLerArquivo(a))); }
      catch(_){ mostrarAviso('Não foi possível ler o arquivo ' + a.name + '.', 'erro'); return; }
      const cab = (tab[0] || []).map(c => String(c).trim().toLowerCase());
      if(!cab.includes('documento2') || !cab.includes('fone1')){ mostrarAviso('O arquivo ' + a.name + ' não está no layout do ProContact.', 'erro'); return; }
      if(tab.length - 1 > MB_LIMPAR_MAX){ mostrarAviso('O arquivo ' + a.name + ' é grande demais (mais de 1 milhão de linhas).', 'erro'); return; }
      lidos.push({ nome: a.name, cab, linhas: tab.slice(1) });
    }
    let neo = null;
    if(modo === 'neo'){
      const r = await mbCarregarNeo();
      if(r.erro){ mostrarAviso('Não foi possível carregar os pedidos do NeoSales. Tente de novo.', 'erro'); return; }
      neo = r.mapa;
    }
    const estado = { vistos: new Map() }, removidos = [];
    let ficaram = 0;
    for(const f of lidos){
      const c = mbClassificar(f.cab, f.linhas, { neo, duplicados: modo === 'duplicados' }, estado);
      c.removidos.forEach(x => { x.arquivo = f.nome; removidos.push(x); });
      downloadBlob(new Blob([mbParaCp1252(mbMontarCsv(f.cab, c.ficam))], { type: 'text/csv;charset=windows-1252' }),
        String(f.nome).replace(/(\.csv)?$/i, '_LIMPO.csv'));
      ficaram += c.ficam.length;
    }
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    if(removidos.length){
      downloadBlob(new Blob([mbParaCp1252(mbMontarRemovidos(removidos, true))], { type: 'text/csv;charset=windows-1252' }), 'REMOVIDOS_' + hoje + '.csv');
    }
    const qual = modo === 'neo' ? 'empresas com pedido no NeoSales' : 'telefones repetidos';
    mostrarAviso(lidos.length + (lidos.length === 1 ? ' arquivo limpo: ' : ' arquivos limpos: ') + mbFmtNum(ficaram) + ' linhas ficaram · '
      + (removidos.length ? 'removidas: ' + mbFmtNum(removidos.length) + ' (' + qual + ', arquivo REMOVIDOS).' : 'nada a remover (' + qual + ').')
      + (neo && !neo.size ? ' A lista do NeoSales veio vazia.' : ''), 'ok');
  } finally {
    mbEstado.limpando = false;
    botoes.forEach(b => { b.disabled = false; });
  }
}
document.getElementById('btnMbRemoverDuplicados').addEventListener('click', () => { mbLimparArquivos(document.getElementById('mbArquivosLimpar').files, 'duplicados'); });
document.getElementById('btnMbCruzarNeo').addEventListener('click', () => { mbLimparArquivos(document.getElementById('mbArquivosLimpar').files, 'neo'); });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_mailing.js 2>&1 | tail -2`
Expected: `0 falharam`

- [ ] **Step 6: Registro e spec**

No `REGRAS_NEGOCIO.md`, depois do fim da 102.11 (antes de `## 103.`):

```markdown
### 102.12 Remover duplicados e cruzar com o NEO (22/10/2026, pedido do Rafael)
- **Exportação:** duas caixas, marcadas por padrão.
  - **Cruzar com o NEO:** tira as empresas (CNPJ) com pedido da Apex no NeoSales, em qualquer etapa. Eram 1.112 empresas em 22/10.
  - **Remover duplicados:** cada telefone sai uma vez, na primeira empresa em que aparecer, dentro do pedido.
  - As linhas removidas não contam na quantidade: o painel busca outras até completar.
  - As removidas ficam marcadas como usadas na base e saem num arquivo **`<CARGA>_<data>_REMOVIDOS.csv`** com motivo e detalhe (pedido, etapa, consultor, data; ou "ficou no CNPJ tal").
  - O histórico mostra as linhas do arquivo e "(+N removidas)". Colunas `removidos_neo` e `removidos_repetidos` em `mailing.extracao` (migration `20261022100000`), gravadas pela ação `fechar_parte`.
  - Se a lista do NeoSales não vier, o pedido não começa.
- **Limpar arquivo já gerado** (cartão próprio): botões **Remover duplicados** e **Cruzar com o NEO** sobre um ou mais CSVs do ProContact. Sai um `_LIMPO.csv` por arquivo e um `REMOVIDOS_<data>.csv`. Não mexe na base.
- **Fica de fora:** telefone repetido entre pedidos de dias diferentes (exigiria índice por telefone na base); para isso vale "Nunca extraídos".
```

Na spec, seção 3.4, trocar "**Caixa no mesmo cartão:** \"Limpar arquivo já gerado\"." por "**Cartão logo abaixo da exportação:** \"Limpar arquivo já gerado\".".

- [ ] **Step 7: Suíte inteira**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules bash run_tests.sh 2>&1 | tail -4` e `cd supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: só as 5 falhas conhecidas de antes (`test_pedidos_alerta`, `test_projecao_ganho`, `test_proposta_manual_docs`, `test_proposta_timbrada` por falta de módulo; `test_redesign_shell` pelos cantos que já estão na oficial); função `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_mailing.js REGRAS_NEGOCIO.md docs/superpowers/specs/2026-10-22-mailing-removidos-design.md painel_clientes_apex.html
git commit -m "feat(mailing): limpar arquivo já gerado (Remover duplicados, Cruzar com o NEO); seção 102.12"
```

---

### Task 5: Publicação (cada passo só com ok do Rafael)

- [ ] **Step 1:** `git fetch oficial` e juntar se a oficial andou.
- [ ] **Step 2: Migration** via `execute_sql` com `begin; ...; commit;` e conferir as colunas em `information_schema.columns`.
- [ ] **Step 3: Função `mailing-api` v8** via `deploy_edge_function` (index.ts, api.ts, consulta.ts; `verify_jwt` true). Conferir o código com `get_edge_function` e a fumaça: 401 sem token, 403 sem perfil.
- [ ] **Step 4: Painel:** `python build_painel.py`; MD5 do ar igual ao último publicado (`7f030293…`) **no mesmo comando** do backup e do `scp`; conferir o MD5 depois e pela internet; `vigia/vigia_painel.ps1 -Aceitar`.
- [ ] **Step 5:** registrar a publicação na 102.12, commit e `git push oficial HEAD:main` (sem force).
