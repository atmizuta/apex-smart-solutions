// Testa a lógica PURA da Edge Function sync-leads (categorização de status, cálculo de conversão,
// parse de receita, mapeamento de linha) direto do arquivo .ts publicado — não uma reimplementação
// à parte — pra garantir que o teste não perde sincronia com o que está de fato publicado no
// Supabase. Como é TypeScript (roda em Deno lá), aqui só removemos anotações de tipo simples pra
// rodar em Node puro (as funções em si são JS válido).
const fs = require('fs');

// parseSheetCsv (09/09/2026) usa Papa.parse de verdade — como o trecho isolado abaixo roda dentro
// de um `new Function(...)` (escopo global/sloppy mode do Node), basta expor Papa como global antes
// de avaliar o trecho pra ele enxergar a mesma lib usada em produção (papaparse@5, mesma versão
// declarada no import do arquivo original).
global.Papa = require('papaparse');

let src = fs.readFileSync('edge_function_sync_leads.ts', 'utf8');

// Remove só as partes que são TypeScript puro (imports, anotações de tipo, "export"), mantendo a
// lógica de negócio 100% igual ao arquivo publicado.
src = src
  .replace(/^import .*$/gm, '')
  .replace(/^const SUPABASE_URL.*$/gm, '')
  .replace(/^const SERVICE_ROLE_KEY.*$/gm, '')
  .replace(/^export function/gm, 'function')
  // 09/09/2026: parseSheetCsv() (nova, com o multi-aba) tem anotações de tipo genérico com `[]` na
  // frente (ex.: `: Record<string, string>[]`, `: ReturnType<typeof mapearLinha>[]`) — precisa
  // remover a versão COM `[]` antes da versão sem, senão sobra um `[]` solto que quebra a sintaxe
  // (ex.: "const rows[] = ..." não é JS válido).
  .replace(/: Record<string, string>\[\]/g, '')
  .replace(/: Record<string, string>/g, '')
  .replace(/: ReturnType<typeof mapearLinha>\[\]/g, '')
  .replace(/: ReturnType<typeof mapearLinha>/g, '')
  .replace(/ as string\[\]\[\]/g, '') // parseSheetCsv: `parsedRaw.data as string[][]`
  .replace(/new Set<string>/g, 'new Set') // parseSheetCsv: dedup de rótulos de cabeçalho
  .replace(/: string/g, '')
  .replace(/: boolean/g, '')
  .replace(/: number/g, '')
  .replace(/\(e as Error\)/g, 'e')
  .replace(/!;/g, ';'); // non-null assertion do TS (ex.: Deno.env.get(...)!;)

// Isola só as funções puras que interessam pro teste (antes do Deno.serve, que depende de Deno/
// rede/Supabase real — isso é o que já é testável sem precisar rodar em Deno de verdade).
const fimTrecho = src.indexOf('Deno.serve');
const trechoPuro = src.slice(0, fimTrecho);

const sandbox = {};
new Function('sandbox', trechoPuro + `
  sandbox.categoriaDoStatus = categoriaDoStatus;
  sandbox.calcConverteu = calcConverteu;
  sandbox.parseReceita = parseReceita;
  sandbox.get = get;
  sandbox.mapearLinha = mapearLinha;
  sandbox.parseSheetCsv = parseSheetCsv;
  sandbox.SHEET_TABS = SHEET_TABS;
  sandbox.sheetTabCsvUrl = sheetTabCsvUrl;
`)(sandbox);

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

// --- categoriaDoStatus: cobre os status reais vistos na planilha (25/08/2026) ---
assert(sandbox.categoriaDoStatus('PEDIDO CONCLUIDO (VENDA)') === 'convertido', 'PEDIDO CONCLUIDO (VENDA) categoriza como convertido');
assert(sandbox.categoriaDoStatus('CLIENTE NÃO RESPONDE ') === 'perdido', 'CLIENTE NÃO RESPONDE (com espaço sobrando) categoriza como perdido');
assert(sandbox.categoriaDoStatus('CLIENTE NÃO ACEITOU VALORES ') === 'perdido', 'CLIENTE NÃO ACEITOU VALORES categoriza como perdido');
assert(sandbox.categoriaDoStatus('CLIENTE SEM INTERESSE NO PLANO') === 'perdido', 'CLIENTE SEM INTERESSE NO PLANO categoriza como perdido');
assert(sandbox.categoriaDoStatus('LEAD PAROU DE RESPONDER') === 'perdido', 'LEAD PAROU DE RESPONDER categoriza como perdido');
assert(sandbox.categoriaDoStatus('CNPJ INAPTO') === 'perdido', 'CNPJ INAPTO categoriza como perdido');
assert(sandbox.categoriaDoStatus('EM NEGOCIAÇÂO') === 'andamento', 'EM NEGOCIAÇÂO categoriza como andamento');
assert(sandbox.categoriaDoStatus('AGENDADO RETORNO') === 'andamento', 'AGENDADO RETORNO categoriza como andamento');
assert(sandbox.categoriaDoStatus('AGUARDANDO DOCUMENTAÇÃO') === 'andamento', 'AGUARDANDO DOCUMENTAÇÃO categoriza como andamento');
assert(sandbox.categoriaDoStatus('AGUARDANDO CLIENTE DECIDIR') === 'andamento', 'AGUARDANDO CLIENTE DECIDIR categoriza como andamento');
assert(sandbox.categoriaDoStatus('') === 'sem_contato', 'status vazio categoriza como sem_contato (lead ainda não trabalhado)');
assert(sandbox.categoriaDoStatus('  ') === 'sem_contato', 'status só com espaços categoriza como sem_contato');
assert(sandbox.categoriaDoStatus('ALGO NOVO QUE NUNCA VIMOS') === 'andamento', 'status desconhecido/novo cai em andamento (não some do funil)');
assert(sandbox.categoriaDoStatus('pedido concluido (venda)') === 'convertido', 'categorização não é sensível a maiúsculas/minúsculas');

// --- calcConverteu: CONVERTEU? às vezes vem vazio mesmo com venda concluída (dado real inconsistente) ---
assert(sandbox.calcConverteu('PEDIDO CONCLUIDO (VENDA)', '') === true, 'venda concluída conta como convertido mesmo se CONVERTEU? veio vazio (inconsistência real da planilha)');
assert(sandbox.calcConverteu('PEDIDO CONCLUIDO (VENDA)', 'sim') === true, 'venda concluída + CONVERTEU=sim continua convertido');
assert(sandbox.calcConverteu('EM NEGOCIAÇÂO', 'Sim') === true, 'CONVERTEU="Sim" (maiúsculo) também conta, mesmo com status diferente');
assert(sandbox.calcConverteu('CLIENTE NÃO RESPONDE', '') === false, 'lead perdido sem CONVERTEU não conta como convertido');
assert(sandbox.calcConverteu('', '') === false, 'lead sem status e sem CONVERTEU não conta como convertido');

// --- parseReceita: formatos reais vistos na planilha ("R$39,99", "R$1.234,56", vazio) ---
assert(sandbox.parseReceita('R$39,99') === 39.99, 'parseReceita converte "R$39,99" pra 39.99 (' + sandbox.parseReceita('R$39,99') + ')');
assert(sandbox.parseReceita('R$374,95') === 374.95, 'parseReceita converte "R$374,95" pra 374.95');
assert(sandbox.parseReceita('') === 0, 'parseReceita trata vazio como 0');
assert(sandbox.parseReceita(undefined) === 0, 'parseReceita trata undefined como 0');
assert(sandbox.parseReceita('R$1.234,56') === 1234.56, 'parseReceita converte valor com milhar "R$1.234,56" pra 1234.56');

// --- get(): tolera cabeçalho com espaço sobrando (ex.: "CONSULTOR " na planilha real) ---
assert(sandbox.get({ 'CONSULTOR ': 'Caio' }, 'CONSULTOR') === 'Caio', 'get() acha a coluna mesmo com espaço sobrando no cabeçalho ("CONSULTOR ")');
assert(sandbox.get({ 'STATUS': '  EM NEGOCIAÇÂO  ' }, 'STATUS') === 'EM NEGOCIAÇÂO', 'get() já retorna o valor sem espaços nas pontas');
assert(sandbox.get({}, 'INEXISTENTE') === '', 'get() retorna string vazia pra coluna que não existe');

// --- mapearLinha(): linha real da planilha (venda concluída) ---
const linhaVenda = sandbox.mapearLinha({
  id: 'l:2055930361682530', created_time: '2026-08-20T17:08:22-05:00',
  ad_id: 'ag:1', ad_name: 'Anuncio', adset_id: 'as:1', adset_name: 'Conjunto', campaign_id: 'c:1', campaign_name: 'Campanha',
  form_id: 'f:1', form_name: 'Form', is_organic: 'false', platform: 'fb',
  'qual_o_tipo_da_sua_empresa?': 'mei', 'qual_a_quantidade_de_linhas?': '1_linha', 'qual_o_seu_cnpj?': '23101393000125',
  email: 'a@b.com', full_name: 'Juliana Spadoni', city: 'Ilhabela', state: 'São Paulo', phone_number: 'p:+5512991722123',
  lead_status: 'CREATED', 'CONSULTOR ': 'Giovanna', STATUS: 'PEDIDO CONCLUIDO (VENDA)',
  OBS: '21/08 uma linha: 12GB- R$39,99', 'CONVERTEU?': 'sim', RECEITA: 'R$39,99',
});
assert(linhaVenda.id === 'l:2055930361682530', 'mapearLinha preserva o id do lead');
assert(linhaVenda.consultor === 'Giovanna', 'mapearLinha lê o consultor certo mesmo com espaço no cabeçalho original');
assert(linhaVenda.categoria === 'convertido', 'mapearLinha categoriza a venda concluída como convertido');
assert(linhaVenda.converteu === true, 'mapearLinha marca converteu=true na venda concluída');
assert(linhaVenda.receita === 39.99, 'mapearLinha converte a receita corretamente');
assert(linhaVenda.is_organic === false, 'mapearLinha converte is_organic "false" (texto) pra boolean false');

// --- mapearLinha(): lead ainda sem status (nunca trabalhado) ---
const linhaSemStatus = sandbox.mapearLinha({ id: 'l:999', STATUS: '', 'CONVERTEU?': '', RECEITA: '', 'CONSULTOR ': '' });
assert(linhaSemStatus.categoria === 'sem_contato', 'lead sem status categoriza como sem_contato');
assert(linhaSemStatus.converteu === false, 'lead sem status não é convertido');
assert(linhaSemStatus.receita === 0, 'lead sem status tem receita 0');
assert(linhaSemStatus.consultor === null, 'lead sem consultor atribuído fica null (não string vazia)');

// --- SHEET_TABS / sheetTabCsvUrl (09/09/2026): consolidação multi-aba (Agosto + Setembro) ---
// 09/09/2026 (correção): o endpoint gviz por NOME corrompia o cabeçalho especificamente da aba de
// Agosto (o Google fundia o rótulo da coluna com o valor da 1ª linha de dado na mesma célula) — a
// versão final usa o endpoint de exportação direta por GID (`export?format=csv&gid=...`), que
// devolve as células cruas sem nenhuma detecção "esperta" de cabeçalho do lado do Google.
// 14/09/2026 (correção): a aba de Setembro foi recriada na planilha (perdeu o prefixo "FORM- " do
// nome) e ganhou um gid novo — o gid antigo (1483781302) passou a devolver HTTP 400, quebrando a
// sincronização inteira. Gid atualizado pro correto (1292366194) e adicionada a aba "REPIQUE"
// (mesma estrutura de colunas, lote de recontato), a pedido do usuário — ver REGRAS_NEGOCIO.md.
assert(Array.isArray(sandbox.SHEET_TABS) && sandbox.SHEET_TABS.length === 3, 'SHEET_TABS tem as 3 abas conhecidas (Agosto + Setembro + REPIQUE)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'FORM- LEADS CLARO B2B APEX - AGOSTO' && t.gid === '0'), 'SHEET_TABS inclui a aba de Agosto com o gid certo (0)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'LEADS CLARO B2B APEX - SETEMBRO' && t.gid === '1292366194'), 'SHEET_TABS inclui a aba de Setembro com o gid corrigido (1292366194)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'REPIQUE' && t.gid === '532368128'), 'SHEET_TABS inclui a aba REPIQUE com o gid certo (532368128)');
assert(!sandbox.SHEET_TABS.some(t => t.gid === '1483781302'), 'SHEET_TABS não usa mais o gid antigo/quebrado da aba de Setembro (1483781302)');
const urlSetembro = sandbox.sheetTabCsvUrl('1292366194');
assert(urlSetembro.includes('export?format=csv'), 'sheetTabCsvUrl usa o endpoint de exportação direta (não o gviz, que corrompia o cabeçalho de Agosto)');
assert(urlSetembro.includes('gid=1292366194'), 'sheetTabCsvUrl monta a URL com o gid certo');
assert(!urlSetembro.includes('gviz'), 'sheetTabCsvUrl não usa mais o endpoint gviz');

// --- parseSheetCsv(): aba "normal", cabeçalho já na linha 1 ---
const HEADER_CSV = 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,qual_o_tipo_da_sua_empresa?,qual_a_quantidade_de_linhas?,qual_o_seu_cnpj?,email,full_name,city,state,phone_number,lead_status,CONSULTOR ,STATUS,OBS,CONVERTEU?,RECEITA';
const csvNormal = HEADER_CSV + '\n' +
  'l:100,2026-08-20T10:00:00-03:00,ag:1,Anuncio,as:1,Conjunto,c:1,Campanha,f:1,Form,false,fb,mei,1_linha,12345678000199,a@b.com,Fulano de Tal,Cidade,SP,p:+551199999999,CREATED,Caio,PEDIDO CONCLUIDO (VENDA),obs qualquer,sim,"R$39,99"';
const regsNormal = sandbox.parseSheetCsv(csvNormal, 'AGOSTO (teste)');
assert(regsNormal.length === 1, 'parseSheetCsv extrai 1 registro de uma aba com cabeçalho normal na linha 1');
assert(regsNormal[0].id === 'l:100', 'parseSheetCsv preserva o id do lead da aba normal');
assert(regsNormal[0].consultor === 'Caio', 'parseSheetCsv lê o consultor certo da aba normal');
assert(regsNormal[0].receita === 39.99, 'parseSheetCsv converte a receita certo da aba normal');

// --- parseSheetCsv(): aba com linha extra ANTES do cabeçalho de verdade (mesmo bug de 04/09/2026,
// agora testado por aba em vez de só na exportação "padrão" antiga) ---
const csvComLinhaExtra = 'Giovanna,2026-08-11,x,campaign_id,y,lead_status,z\n' + HEADER_CSV + '\n' +
  'l:200,2026-08-21T11:00:00-03:00,ag:2,Anuncio2,as:2,Conjunto2,c:2,Campanha2,f:2,Form2,false,ig,mei,2_a_5_linhas_,98765432000188,b@c.com,Beltrana,Outra Cidade,SP,p:+551188888888,CREATED,Giovanna,EM NEGOCIAÇÂO,obs2,,';
const regsExtra = sandbox.parseSheetCsv(csvComLinhaExtra, 'SETEMBRO (teste)');
assert(regsExtra.length === 1, 'parseSheetCsv acha o cabeçalho de verdade mesmo com linha extra garbled na frente');
assert(regsExtra[0].id === 'l:200', 'parseSheetCsv preserva o id certo mesmo com linha extra na frente');
assert(regsExtra[0].categoria === 'andamento', 'parseSheetCsv categoriza corretamente mesmo com linha extra na frente');

// --- parseSheetCsv(): aba sem nenhuma linha de cabeçalho reconhecível — erro claro identificando a aba ---
let erroSemCabecalho = null;
try{ sandbox.parseSheetCsv('a,b,c\n1,2,3', 'OUTUBRO (teste)'); }
catch(e){ erroSemCabecalho = e.message; }
assert(!!erroSemCabecalho && erroSemCabecalho.includes('OUTUBRO (teste)'), 'parseSheetCsv lança erro identificando qual aba não tem cabeçalho reconhecível (' + erroSemCabecalho + ')');

// --- consolidação de múltiplas abas: concatenar + dedup por id (mesmo padrão usado no Deno.serve,
// que mantém a ÚLTIMA ocorrência — aqui simulando Agosto seguido de Setembro, como na lista real) ---
const csvAgosto = HEADER_CSV + '\n' +
  'l:dup,2026-08-05T09:00:00-03:00,ag:3,A3,as:3,C3,c:3,Camp3,f:3,F3,false,fb,mei,1_linha,11111111000199,d@e.com,Cliente Antigo,Cidade,SP,p:+551177777777,CREATED,Rafael,EM NEGOCIAÇÂO,obs agosto,,\n' +
  'l:soagosto,2026-08-06T09:00:00-03:00,ag:4,A4,as:4,C4,c:4,Camp4,f:4,F4,false,fb,mei,1_linha,22222222000199,f@g.com,Só em Agosto,Cidade,SP,p:+551166666666,CREATED,Rafael,EM NEGOCIAÇÂO,obs,,';
const csvSetembro = HEADER_CSV + '\n' +
  'l:dup,2026-09-05T09:00:00-03:00,ag:5,A5,as:5,C5,c:5,Camp5,f:5,F5,false,fb,mei,1_linha,11111111000199,d@e.com,Cliente Antigo,Cidade,SP,p:+551177777777,CREATED,Rafael,PEDIDO CONCLUIDO (VENDA),cliente voltou em setembro e fechou,sim,"R$54,99"';
const regsAgosto = sandbox.parseSheetCsv(csvAgosto, 'AGOSTO (teste)');
const regsSetembro = sandbox.parseSheetCsv(csvSetembro, 'SETEMBRO (teste)');
const consolidados = regsAgosto.concat(regsSetembro);
assert(consolidados.length === 3, 'concatenar as duas abas soma os registros das duas (3 linhas: 2 de agosto + 1 de setembro, antes do dedup)');
const porIdTeste = new Map();
for(const r of consolidados) porIdTeste.set(r.id, r);
const unicosTeste = Array.from(porIdTeste.values());
assert(unicosTeste.length === 2, 'dedup por id consolida o lead repetido (l:dup) num só, mantendo o total de leads únicos');
const dupFinal = unicosTeste.find(r => r.id === 'l:dup');
assert(dupFinal.categoria === 'convertido', 'dedup por id mantém a ÚLTIMA ocorrência (a de Setembro, já convertida) e não a de Agosto');
assert(dupFinal.receita === 54.99, 'dedup por id também traz a receita da última ocorrência (Setembro)');
assert(unicosTeste.some(r => r.id === 'l:soagosto'), 'lead que só existe em Agosto continua presente após consolidar com Setembro');

console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
