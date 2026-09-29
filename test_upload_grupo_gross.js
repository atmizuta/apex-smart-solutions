// Upload do Dashboard de Produção ignora o grupo "GROSS" (29/09/2026, REGRAS_NEGOCIO.md seção 49).
// Caso real: uma exportação do NeoCRM veio com o grupo "GROSS", que repete cada linha do pedido (o
// mesmo produto/valor aparece no grupo real — "VOZ - Novo", "VOZ - Portabilidade"… — e de novo como
// "GROSS"). O painel somava as duas e o faturado quase dobrou (R$ 16,7 mil → R$ 30,7 mil). Dados
// fictícios; as funções são lidas do _template.html (o mesmo código do upload), não reimplementadas.
const fs = require('fs');
const vm = require('vm');

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

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

const ctx = {};
vm.createContext(ctx);
try{
  vm.runInContext("const FUSO_SAO_PAULO = '-03:00';\n"
    + ['parseDataProducao', 'normalizarHeaderProducao', 'ehGrupoAgregadoProducao', 'contarLinhasGrupoAgregado', 'extractProducaoRecords']
      .map(n => extrairFuncao(outer, n)).join('\n')
    + '\nthis.extract = extractProducaoRecords; this.contar = contarLinhasGrupoAgregado; this.ehAgregado = ehGrupoAgregadoProducao;', ctx);
}catch(err){
  console.log('FALHOU:', err.message);
  console.log('--- test_upload_grupo_gross RESULTADO:', ok, 'passaram,', fail + 1, 'falharam ---');
  process.exit(1);
}

const CAB = ['GRUPO', 'NUMERO PEDIDO', 'PROPRIETÁRIO DO PEDIDO', 'ETAPA PEDIDO', 'CADASTRO', 'ATUALIZACAO', 'VALOR UNIT', 'QUANTIDADE', 'PRODUTO'];
const linha = (grupo, num, valor, produto) => [grupo, num, 'Consultor Teste', 'ENTREGA (NEOCRM)', '28/09/2026', '28/09/2026 10:00:00', valor, 1, produto];
const rows = [
  CAB,
  linha('VOZ - Novo', 1001, 39.99, 'Plano A'),
  linha('GROSS', 1001, 39.99, 'Plano A'),          // cópia agregada da linha acima
  linha('VOZ - Portabilidade', 1002, 29.99, 'Plano B'),
  linha(' gross ', 1002, 29.99, 'Plano B'),        // mesma coisa com espaços/minúsculas
  linha('BANDA LARGA - Novo', 1003, 100, 'Fibra'),
];

const recs = ctx.extract(rows);
assert(recs.length === 3, 'as 2 linhas do grupo GROSS são ignoradas (sobram 3 de 5): ' + recs.length);
assert(!recs.some(r => /gross/i.test(r.grupo)), 'nenhum registro com grupo GROSS');
const total = recs.reduce((s, r) => s + r.valor, 0);
assert(Math.abs(total - 169.98) < 0.001, 'valor total sem as cópias (169,98): ' + total);
assert(ctx.contar(rows) === 2, 'contarLinhasGrupoAgregado conta as 2 linhas GROSS pro aviso do upload: ' + ctx.contar(rows));
assert(ctx.ehAgregado('GROSS') && ctx.ehAgregado(' Gross ') && !ctx.ehAgregado('VOZ - Novo') && !ctx.ehAgregado(null), 'ehGrupoAgregadoProducao reconhece GROSS (maiúsc./minúsc./espaços) e só ele');

// (29/09/2026) o upload de planilha saiu do painel — a produção é sincronizada sozinha pela Edge Function
// sync-producao, que também descarta o GROSS (ver supabase/functions/sync-producao/mapper.ts). As funções
// acima ficam como fallback documentado e seguem ignorando GROSS; o aviso de confirmação do upload saiu com ele.

console.log('--- test_upload_grupo_gross RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
