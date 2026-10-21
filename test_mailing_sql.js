// Trava de estrutura e de LGPD das migrations da base de mailing (seção 102).
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (decisão 7: colunas que NÃO sobem).
const fs = require('fs');
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
const ler = f => { try { return fs.readFileSync(f, 'utf8').toLowerCase(); } catch(e){ return ''; } };
const schema = ler('supabase/migrations/20261021090000_mailing_schema.sql');
const indices = ler('supabase/migrations/20261021090100_mailing_indices.sql');
const rbSchema = ler('supabase/rollback/20261021090000_mailing_schema_rollback.sql');
const rbIndices = ler('supabase/rollback/20261021090100_mailing_indices_rollback.sql');

assert(schema.length > 0, 'migration do schema existe');
for (const t of ['empresa', 'socio', 'municipio', 'operadora_nome', 'linha', 'extracao', 'opcao', 'carga']) {
  assert(schema.includes(`create table mailing.${t} (`), `tabela mailing.${t}`);
}
assert(schema.includes('revoke all on schema mailing from public, anon, authenticated'), 'schema fechado para anon/authenticated');
assert(schema.includes('revoke all on all tables in schema mailing from public, anon, authenticated'), 'tabelas fechadas');
assert(schema.includes('check (quantidade_pedida between 1 and 100000)'), 'limite de 100 mil no registro');
assert(schema.includes('socio_obito boolean not null default false'), 'socio_obito não nulo (índice parcial depende disso)');
assert(!/create index/.test(schema), 'índices de filtro ficam na migration de índices (carga rápida)');
// compara nomes (identificadores) do SQL sem comentários — trecho solto pegaria "quantidade"/"cidade" por causa de "idade"
const nomes = new Set(schema.replace(/--.*$/gm, '').match(/[a-z_][a-z0-9_]*/g));
// 21/10: sexo e geração liberados pelo Rafael só como filtro (§102.7); o resto continua proibido
const trechosProibidos = ['nome_mae', 'nascimento', 'renda', 'score', 'persona', 'propensao', 'presumido',
  'demografica', 'profissao', 'bolsa', 'fgts', 'veiculo', 'imovel', 'saque', 'email', 'logradouro', 'complemento', 'bairro',
  'latitude', 'longitude', 'area_risco'];
const nomesProibidos = ['idade', 'end_cep', 'end_numero', 'end_cidade', 'end_uf'];
for (const p of trechosProibidos) assert(![...nomes].some(n => n.includes(p)), `coluna proibida pela LGPD ausente: ${p}`);
for (const p of nomesProibidos) assert(!nomes.has(p), `coluna proibida pela LGPD ausente: ${p}`);
// 21/10 (revisão final): índice sem condição — com o parcial, qualquer filtro fora do padrão lia a tabela inteira
assert(indices.includes('create index if not exists linha_prioridade on mailing.linha (ultima_extracao nulls first, sorteio);'), 'índice de prioridade para qualquer filtro');
assert(!/linha_prioridade[^;]*where/.test(indices), 'índice de prioridade sem condição');
assert(indices.includes('drop index if exists mailing.linha_padrao_prioridade'), 'remove o índice parcial antigo');
assert(indices.includes('analyze mailing.linha'), 'analyze depois dos índices');
assert(rbSchema.includes('drop schema if exists mailing cascade'), 'rollback do schema');
assert(rbIndices.includes('drop index if exists mailing.linha_prioridade'), 'rollback dos índices');

// 21/10: desempenho no servidor Micro — amostra fixa para contar e dados de exportação na própria linha
const desemp = ler('supabase/migrations/20261021090200_mailing_desempenho.sql');
const rbDesemp = ler('supabase/rollback/20261021090200_mailing_desempenho_rollback.sql');
assert(desemp.includes('create table mailing.amostra ('), 'tabela mailing.amostra');
assert(desemp.includes('linha_id bigint primary key'), 'amostra aponta para a linha');
for (const c of ['add column socio_nome text', 'add column razao_social text', 'add column primeira_da_empresa boolean not null default false',
  'add column primeira_do_fone boolean not null default false']) assert(desemp.includes(c), `linha: ${c}`);
assert(desemp.includes('revoke all on mailing.amostra from public, anon, authenticated'), 'amostra fechada para a API');
const nomesDesemp = new Set(desemp.replace(/--.*$/gm, '').match(/[a-z_][a-z0-9_]*/g));
for (const p of trechosProibidos) assert(![...nomesDesemp].some(n => n.includes(p)), `migration de desempenho sem coluna proibida: ${p}`);
assert(rbDesemp.includes('drop table if exists mailing.amostra'), 'rollback da amostra');
assert(rbDesemp.includes('drop column if exists socio_nome'), 'rollback das colunas da linha');
assert(!indices.includes('linha_operadora_ddd'), 'índice de operadora/ddd só entra se a medição provar ganho');

// 21/10: filtros do sócio (sexo, geração, faixa de risco) na linha e na amostra
const filtSoc = ler('supabase/migrations/20261021090300_mailing_filtros_socio.sql');
const rbFiltSoc = ler('supabase/rollback/20261021090300_mailing_filtros_socio_rollback.sql');
for (const t of ['linha', 'amostra']) {
  assert(filtSoc.includes(`alter table mailing.${t}
  add column sexo text,
  add column geracao text,
  add column faixa_risco text;`), `${t}: sexo, geração e faixa de risco`);
}
const nomesFiltSoc = new Set(filtSoc.replace(/--.*$/gm, '').match(/[a-z_][a-z0-9_]*/g));
for (const p of trechosProibidos) assert(![...nomesFiltSoc].some(n => n.includes(p)), `filtros do sócio sem coluna proibida: ${p}`);
assert(rbFiltSoc.includes('alter table mailing.linha drop column if exists sexo'), 'rollback dos filtros do sócio');
// 21/10: posição do telefone na planilha (linha e amostra) e DDD da cidade na amostra
const posDdd = ler('supabase/migrations/20261021090400_mailing_posicao_ddd_cidade.sql');
const rbPosDdd = ler('supabase/rollback/20261021090400_mailing_posicao_ddd_cidade_rollback.sql');
assert(posDdd.includes('alter table mailing.linha add column posicao smallint;'), 'linha: posição do telefone');
assert(posDdd.includes('alter table mailing.amostra\n  add column posicao smallint,\n  add column rf_ddd_cidade smallint;'), 'amostra: posição e DDD da cidade');
assert(rbPosDdd.includes('alter table mailing.linha drop column if exists posicao'), 'rollback da posição');
console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
process.exit(fail > 0 ? 1 : 0);
