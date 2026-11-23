// test_ranking_contexto.js (§164): o painel de fora monta o contexto do Ranking (nome do login no NEO + equipe por operação)
// e troca __RANKING__ antes de __DATA__. Roda só as duas funções novas, recortadas do _template.html.
const fs = require('fs');
const src = fs.readFileSync('_template.html', 'utf8');
let ok = 0, fail = 0;
function assert(c, m){ if(c) ok++; else { fail++; console.log('FALHOU:', m); } }
function recorta(nome){
  const i = src.indexOf(nome); if(i < 0) return '';
  let j = src.indexOf('{', i), n = 0;
  for(let k = j; k < src.length; k++){ if(src[k] === '{') n++; else if(src[k] === '}'){ n--; if(n === 0) return src.slice(src.lastIndexOf('\n', i) + 1, k + 1); } }
  return '';
}
const fCtx = recorta('function rankingContexto(');
const fEu = recorta('async function rankingEuNeo(');
assert(fCtx && fEu, 'funções rankingContexto e rankingEuNeo existem');
assert(src.includes('rankingEuNeo().catch(() => null)'), 'erro no nome do NEO não derruba a carga do Dashboard');
assert(/\.neq\('usuario', ''\)/.test(fEu), 'nome em branco no NEO é ignorado como o nulo');

const iR = src.indexOf("tpl.replace('__RANKING__'"), iD = src.indexOf("tpl.replace('__DATA__'");
assert(iR > 0 && iR < iD, '__RANKING__ é trocado antes de __DATA__');
assert(/tpl\.replace\('__RANKING__', \(\) => jsonParaScript\(/.test(src), '__RANKING__ usa jsonParaScript (escapa </script>)');

const ops = { 'ANA TESTE': 'apex', 'DARIO TESTE': 'campinas' };
const operacaoDoVendedor = n => ops[String(n).trim().toUpperCase()] || 'apex';
const rankingContexto = new Function('operacaoDoVendedor', fCtx + '; return rankingContexto;')(operacaoDoVendedor);
const c = rankingContexto('ana teste ', ['Ana Teste', 'DARIO TESTE']);
assert(c.eu === 'ANA TESTE', 'eu em maiúsculo e sem espaço');
assert(JSON.stringify(c.equipe) === JSON.stringify([{ nome: 'ANA TESTE', operacao: 'apex' }, { nome: 'DARIO TESTE', operacao: 'campinas' }]), 'equipe com operação');
assert(rankingContexto(null, null).eu === null && rankingContexto(null, null).equipe.length === 0, 'sem nada: vazio');

// rankingEuNeo: vínculo → nome no NEO; sem vínculo → nome do perfil; erro → nome do perfil
function fakeSb(vinculo, nomeNeo){
  return { from(t){ const q = { t, select(){ return q; }, eq(){ return q; }, not(){ return q; }, neq(){ return q; }, order(){ return q; }, limit(){ return q; },
    maybeSingle(){ return Promise.resolve(t === 'consultor_neo' ? { data: vinculo, error: null } : { data: null, error: null }); },
    then(res){ return Promise.resolve(t === 'producao_pedidos_neo' ? { data: nomeNeo ? [{ usuario: nomeNeo }] : [], error: null } : { data: null, error: null }).then(res); } };
    return q; } };
}
const ppSeguro = fn => { try{ return Promise.resolve(fn()).catch(error => ({ data: null, error })); }catch(error){ return Promise.resolve({ data: null, error }); } };
const montaEu = (sb, currentUser) => new Function('sb', 'ppSeguro', 'currentUser', fEu + '; return rankingEuNeo;')(sb, ppSeguro, currentUser);
(async () => {
  assert(await montaEu(fakeSb({ neo_usuario_id: 7 }, 'Ana Teste'), { id: 'u1', nome: 'Ana Perfil' })() === 'ANA TESTE', 'com vínculo: nome do NEO');
  assert(await montaEu(fakeSb(null, null), { id: 'u1', nome: 'Rafael Perfil' })() === 'RAFAEL PERFIL', 'sem vínculo: nome do perfil');
  assert(await montaEu(fakeSb(null, null), null)() === null, 'sem login: null');
  console.log(`--- RESULTADO: ${ok} passaram, ${fail} falharam ---`);
  if(fail) process.exitCode = 1;
})();
