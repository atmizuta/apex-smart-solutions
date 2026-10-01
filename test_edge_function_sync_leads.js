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
  .replace(/: \{ aba: string; id: string \}\[\]/g, '') // deduplicarLeads(registros: { aba: string; id: string }[])
  .replace(/^type .*$/gm, '')        // 01/10/2026: type LeadAba = {...} (trava de mês)
  .replace(/: LeadAba\[\]/g, '')
  .replace(/: Record<string, Record<string, number>>/g, '')
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
  sandbox.deduplicarLeads = deduplicarLeads;
  sandbox.SHEET_TABS = SHEET_TABS;
  sandbox.sheetTabCsvUrl = sheetTabCsvUrl;
  sandbox.mesSP = mesSP;
  sandbox.verificarTrava = verificarTrava;
  sandbox.iguais = iguais;
  sandbox.TRAVA_LIMITE = TRAVA_LIMITE;
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
// 01/10/2026: o gid 1292366194 foi RENOMEADO para Outubro na planilha; Setembro foi para o gid 1519521435 (REGRAS seção 60).
assert(Array.isArray(sandbox.SHEET_TABS) && sandbox.SHEET_TABS.length === 4, 'SHEET_TABS tem as 4 abas conhecidas (Agosto + Setembro + Outubro + REPIQUE)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'FORM- LEADS CLARO B2B APEX - AGOSTO' && t.gid === '0'), 'SHEET_TABS inclui a aba de Agosto com o gid certo (0)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'LEADS CLARO B2B APEX - SETEMBRO 26' && t.gid === '1519521435'), 'SHEET_TABS inclui a aba de Setembro no gid novo (1519521435)');
assert(sandbox.SHEET_TABS.some(t => t.label === 'LEADS CLARO B2B APEX - OUTUBRO' && t.gid === '1292366194'), 'SHEET_TABS inclui a aba de Outubro (gid 1292366194, a antiga aba de Setembro renomeada)');
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

// =====================================================================================
// 30/09/2026 — aba Digital: abas separadas, consultor da aba de Setembro e novas regras de status.
// =====================================================================================

// --- cada aba tem a sua chave (vira leads.aba e o seletor da aba Digital) ---
assert(sandbox.SHEET_TABS.map(t => t.aba).join(',') === 'AGOSTO,SETEMBRO,OUTUBRO,REPIQUE', 'SHEET_TABS tem as chaves de aba AGOSTO, SETEMBRO, OUTUBRO e REPIQUE');
assert(sandbox.SHEET_TABS.find(t => t.gid === '1519521435').aba === 'SETEMBRO', 'o gid novo de Setembro aponta pra chave SETEMBRO');
assert(sandbox.SHEET_TABS.find(t => t.gid === '1292366194').aba === 'OUTUBRO', 'o gid 1292366194 (renomeado) aponta pra chave OUTUBRO, não mais SETEMBRO');
assert(new Set(sandbox.SHEET_TABS.map(t => t.gid)).size === sandbox.SHEET_TABS.length, 'nenhum gid repetido entre as abas');
assert(sandbox.SHEET_TABS.find(t => t.gid === '532368128').aba === 'REPIQUE', 'o gid da aba REPIQUE aponta pra chave REPIQUE');

// --- mapearLinha carimba de qual aba o lead veio ---
assert(sandbox.mapearLinha({ id: 'l:1' }, 'SETEMBRO').aba === 'SETEMBRO', 'mapearLinha grava a aba de origem');
assert(sandbox.mapearLinha({ id: 'l:1' }).aba === '', 'sem aba informada, fica vazio (nunca inventa uma aba)');

// --- a aba de SETEMBRO tem a coluna do consultor com o cabeçalho EM BRANCO ---
// (cabeçalho real da aba: ...,lead_status, <coluna sem nome>, STATUS, OBS, CONVERTEU?, RECEITA)
const HEADER_SETEMBRO = 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,qual_o_tipo_da_sua_empresa?,qual_a_quantidade_de_linhas?,qual_o_seu_cnpj?,email,full_name,city,state,phone_number,lead_status, ,STATUS,OBS,CONVERTEU?,RECEITA';
const linhaSet = (id, consultor, status, sim, receita) => id + ',2026-09-10T10:00:00-03:00,a,b,c,d,e,f,g,h,false,fb,mei,1_linha,123,x@y.com,Nome,Cidade,SP,p:+55,CREATED,' + consultor + ',' + status + ',obs,' + sim + ',' + receita;
const csvSetBranco = HEADER_SETEMBRO + '\n' + linhaSet('l:s1', 'Mariana', 'PEDIDO CONCLUIDO (VENDA)', '', '') + '\n' + linhaSet('l:s2', 'Gabriel', 'EM NEGOCIAÇÂO', '', '') + '\n' + linhaSet('l:s3', '', 'CLIENTE NÃO RESPONDE', '', '');
const regsSetBranco = sandbox.parseSheetCsv(csvSetBranco, 'SETEMBRO (teste)', 'SETEMBRO');
assert(regsSetBranco.length === 3, 'aba de Setembro com coluna de consultor sem cabeçalho: lê as 3 linhas');
assert(regsSetBranco.find(r => r.id === 'l:s1').consultor === 'Mariana', 'lê o consultor da coluna sem cabeçalho (antes ficava "(Sem consultor)")');
assert(regsSetBranco.find(r => r.id === 'l:s2').consultor === 'Gabriel', 'lê o consultor de outra linha da aba de Setembro');
assert(regsSetBranco.find(r => r.id === 'l:s3').consultor === null, 'linha de Setembro sem consultor preenchido continua null');
assert(regsSetBranco.every(r => r.aba === 'SETEMBRO'), 'todos os leads da aba de Setembro saem com aba = SETEMBRO');
assert(regsSetBranco.find(r => r.id === 'l:s1').converteu === true, 'venda concluída em Setembro conta como convertido');
// as outras abas (cabeçalho "CONSULTOR ") continuam lendo normalmente e não são afetadas pelo ajuste
const csvComConsultor = HEADER_SETEMBRO.replace('lead_status, ,STATUS', 'lead_status,CONSULTOR ,STATUS') + '\n' + linhaSet('l:r1', 'Yasmin', 'CLIENTE NÃO RESPONDE', '', '');
const regsComConsultor = sandbox.parseSheetCsv(csvComConsultor, 'REPIQUE (teste)', 'REPIQUE');
assert(regsComConsultor[0].consultor === 'Yasmin' && regsComConsultor[0].aba === 'REPIQUE', 'aba com cabeçalho CONSULTOR continua funcionando e carimba REPIQUE');
// o ajuste só vale pra coluna SEM nome: uma coluna nomeada qualquer antes de STATUS não é tomada como consultor
const csvOutraColuna = HEADER_SETEMBRO.replace('lead_status, ,STATUS', 'lead_status,OUTRA COISA,STATUS') + '\n' + linhaSet('l:o1', 'Fulano', 'CLIENTE NÃO RESPONDE', '', '');
assert(sandbox.parseSheetCsv(csvOutraColuna, 'X (teste)', 'X')[0].consultor === null, 'coluna com nome próprio antes de STATUS não é confundida com a do consultor');

// --- status NOVOS viram VENDA PERDIDA (decisão do usuário, 30/09/2026) ---
['TELEFONE ERRADO OU SEM WHATSAPP', 'TELEFONE ERRADO ou  SEM WHATSAPP', 'TELEFONE ERRADO ou Sem Whatsapp', 'LEAD FORA DO PERFIL', 'CLIENTE SO QUERIA APARELHO',
  'CLIENTE SÓ QUERIA FIBRA', 'CNPJ REPROVADO', 'SUSPEITA DE FRAUDE', 'Cliente não quer no CNPJ'].forEach(s => {
  assert(sandbox.categoriaDoStatus(s) === 'perdido', 'status "' + s + '" é venda perdida');
});
assert(sandbox.categoriaDoStatus('PEDIDO EM ANÁLISE') === 'andamento', 'PEDIDO EM ANÁLISE segue em andamento');
assert(sandbox.categoriaDoStatus('pedido em analise') === 'andamento', 'PEDIDO EM ANÁLISE sem acento e em minúsculas também é andamento (conhecido, não "desconhecido")');
assert(sandbox.categoriaDoStatus('EM NEGOCIACAO') === 'andamento' && sandbox.categoriaDoStatus('em negociaçâo') === 'andamento', 'comparação de status ignora acento, caixa e o "Â" da planilha');
assert(sandbox.categoriaDoStatus('CLIENTE  NÃO   RESPONDE') === 'perdido', 'espaços repetidos no meio do status são ignorados');

// --- regra de convertido: primeiro a coluna CONVERTEU?="sim"; sem "sim", o STATUS de venda concluída ---
assert(sandbox.calcConverteu('CLIENTE NÃO RESPONDE', 'sim') === true, '"sim" na coluna vale mesmo com outro status (a coluna vem primeiro)');
assert(sandbox.calcConverteu('CNPJ INAPTO', 'SIM') === true, '"SIM" maiúsculo também vale');
assert(sandbox.calcConverteu('PEDIDO CONCLUIDO (VENDA)', '') === true, 'sem "sim", o status PEDIDO CONCLUIDO (VENDA) conta como convertido');
assert(sandbox.calcConverteu('pedido concluido (venda)', 'e') === true, 'valor estranho na coluna ("e") não impede o status de converter');
assert(sandbox.calcConverteu('EM NEGOCIAÇÂO', 'e') === false && sandbox.calcConverteu('EM NEGOCIAÇÂO', 'f') === false, 'valores soltos ("e", "f") na coluna CONVERTEU? não contam como sim');
assert(sandbox.calcConverteu('PEDIDO EM ANÁLISE', '') === false, 'pedido em análise ainda não é convertido');

// --- junta as abas SEM misturar: a chave é (aba, id) ---
const dupAgosto = { aba: 'AGOSTO', id: 'l:dup', consultor: 'Rafael', status: 'EM NEGOCIAÇÂO' };
const dupSetembro = { aba: 'SETEMBRO', id: 'l:dup', consultor: 'Rafael', status: 'PEDIDO CONCLUIDO (VENDA)' };
const dupRepique = { aba: 'REPIQUE', id: 'l:dup', consultor: 'Yasmin', status: 'CLIENTE NÃO RESPONDE' };
const juntos = sandbox.deduplicarLeads([dupAgosto, dupSetembro, dupRepique, { aba: 'AGOSTO', id: 'l:so-agosto' }]);
assert(juntos.length === 4, 'o mesmo id em 3 abas vira 3 linhas (uma por aba) + 1 lead só de Agosto = 4 — achou ' + juntos.length);
assert(juntos.find(r => r.aba === 'SETEMBRO' && r.id === 'l:dup').consultor === 'Rafael', 'a linha de Setembro NÃO é sobrescrita pela do Repique (o consultor continua Rafael)');
assert(juntos.find(r => r.aba === 'REPIQUE' && r.id === 'l:dup').consultor === 'Yasmin', 'a linha do Repique fica com o consultor do Repique');
// repetido dentro da MESMA aba: mantém a última (evita o erro do upsert do Postgres)
const repetido = sandbox.deduplicarLeads([{ aba: 'REPIQUE', id: 'l:r', status: 'antigo' }, { aba: 'REPIQUE', id: 'l:r', status: 'novo' }]);
assert(repetido.length === 1 && repetido[0].status === 'novo', 'id repetido dentro da mesma aba mantém a última ocorrência');

// =====================================================================================
// 01/10/2026 — sincronização automática (pg_cron a cada 30 min) e trava de mês (REGRAS seção 62).
// =====================================================================================
// mesSP: mês (1-12) no horário de São Paulo (UTC-3), não em UTC
assert(sandbox.mesSP('2026-10-01T02:31:49Z') === 9, 'mesSP: 01/10 02:31 UTC ainda é 30/09 em SP');
assert(sandbox.mesSP('2026-10-01T10:00:00-03:00') === 10, 'mesSP: data com fuso -03:00');
assert(sandbox.mesSP('') === 0 && sandbox.mesSP(null) === 0 && sandbox.mesSP('lixo') === 0, 'mesSP: vazio/inválido = 0');

const L = (aba, iso) => ({ aba, id: 'l:' + Math.random(), criado_em_lead: iso });
const setembroOk = Array.from({ length: 50 }, () => L('SETEMBRO', '2026-09-15T12:00:00-03:00'));
assert(sandbox.verificarTrava(setembroOk) === '', 'trava: aba com leads do próprio mês passa');
// o caso de 01/10: aba "SETEMBRO" lendo a aba que foi renomeada para Outubro
const misturado = setembroOk.concat(Array.from({ length: 22 }, () => L('SETEMBRO', '2026-10-01T10:00:00-03:00')));
const erroMist = sandbox.verificarTrava(misturado);
assert(erroMist.includes('SETEMBRO') && erroMist.includes('22') && erroMist.includes('outubro'), 'trava: 22 leads de outubro na aba SETEMBRO param a sincronização (' + erroMist + ')');
// tolerância: até TRAVA_LIMITE leads de mês posterior passam (virada do mês, digitação atrasada)
const poucos = setembroOk.concat(Array.from({ length: sandbox.TRAVA_LIMITE }, () => L('SETEMBRO', '2026-10-01T08:00:00-03:00')));
assert(sandbox.verificarTrava(poucos) === '', 'trava: até ' + sandbox.TRAVA_LIMITE + ' leads do mês seguinte passam');
// mês ANTERIOR não trava (lead antigo colado na aba nova) e virada de ano conta como anterior
assert(sandbox.verificarTrava(Array.from({ length: 30 }, () => L('OUTUBRO', '2026-09-20T12:00:00-03:00'))) === '', 'trava: leads de mês anterior não travam');
assert(sandbox.verificarTrava(Array.from({ length: 30 }, () => L('JANEIRO', '2026-12-20T12:00:00-03:00'))) === '', 'trava: dezembro numa aba de JANEIRO é mês anterior (virada de ano)');
assert(sandbox.verificarTrava(Array.from({ length: 30 }, () => L('DEZEMBRO', '2027-01-05T12:00:00-03:00'))) !== '', 'trava: janeiro numa aba de DEZEMBRO é mês posterior');
// REPIQUE (não é mês) e lead sem data nunca travam
assert(sandbox.verificarTrava(Array.from({ length: 30 }, () => L('REPIQUE', '2026-10-01T12:00:00-03:00'))) === '', 'trava: Repique não é aba de mês');
assert(sandbox.verificarTrava(Array.from({ length: 30 }, () => L('AGOSTO', null))) === '', 'trava: lead sem data não conta');
assert(sandbox.verificarTrava([]) === '', 'trava: lista vazia');

// iguais(): comparação do segredo do cron (tempo constante)
assert(sandbox.iguais('abc', 'abc') === true && sandbox.iguais('abc', 'abd') === false && sandbox.iguais('abc', 'abcd') === false, 'iguais compara o segredo');

// o handler aceita o cron só com segredo configurado e igual; segredo vazio nunca libera
const handler = src.slice(src.indexOf('Deno.serve'));
assert(/SYNC_CRON_SECRET/.test(handler) && /x-cron-secret/.test(handler), 'handler lê o segredo do cron (x-cron-secret / SYNC_CRON_SECRET)');
assert(/cronSecret !== ""/.test(handler), 'segredo do cron vazio nunca libera a chamada');
assert(handler.indexOf('verificarTrava(') > 0 && handler.indexOf('verificarTrava(') < handler.indexOf('.upsert(lote'), 'a trava roda ANTES de gravar os leads');
assert(/leads_sync_erro/.test(handler), 'erro da sincronização fica registrado em config.leads_sync_erro');

console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
if(fail > 0) process.exitCode = 1;
