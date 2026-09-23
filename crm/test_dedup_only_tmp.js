const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.supabase = { createClient: () => ({ auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}, from:()=>({select:()=>({order:()=>({then:()=>{}})})}) }) };

window.eval(jsCode);

const header = ['GRUPO','PROPRIETÁRIO DO PEDIDO','ETAPA PEDIDO','CADASTRO','ATUALIZACAO','VALOR UNIT','NUMERO PEDIDO','PRODUTO','NOME CLIENTE','CPF/CNPJ','TAGS ATIVIDADE','QUANTIDADE'];
function linha(vals){
  const row = new Array(header.length).fill(null);
  Object.keys(vals).forEach(k => { row[header.indexOf(k)] = vals[k]; });
  return row;
}
const rowsSintetico = [header,
  linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  linha({'GRUPO':'VOZ - Portabilidade','PROPRIETÁRIO DO PEDIDO':'CONSULTOR X','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'01/09/2026','ATUALIZACAO':'01/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'111','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'FULANO','CPF/CNPJ':'12345678900','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  linha({'GRUPO':'APARELHO','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Y','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'02/09/2026','ATUALIZACAO':'02/09/2026','VALOR UNIT':999,'NUMERO PEDIDO':'222','PRODUTO':'IPHONE 13','NOME CLIENTE':'CICLANO','CPF/CNPJ':'98765432100','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  linha({'GRUPO':'VOZ - Novo','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Y','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'02/09/2026','ATUALIZACAO':'02/09/2026','VALOR UNIT':39.99,'NUMERO PEDIDO':'222','PRODUTO':'CLARO PÓS 10GB','NOME CLIENTE':'CICLANO','CPF/CNPJ':'98765432100','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
  linha({'GRUPO':'VOZ - Renovação','PROPRIETÁRIO DO PEDIDO':'CONSULTOR Z','ETAPA PEDIDO':'CONCLUIDO (NEOCRM)','CADASTRO':'03/09/2026','ATUALIZACAO':'03/09/2026','VALOR UNIT':29.99,'NUMERO PEDIDO':'333','PRODUTO':'CLARO PÓS 6GB','NOME CLIENTE':'BELTRANO','CPF/CNPJ':'11122233344','TAGS ATIVIDADE':null,'QUANTIDADE':1}),
];
const recs = window.extractProducaoRecords(rowsSintetico);
console.log('total:', recs.length);
console.log('111:', recs.filter(r=>r.numero_pedido==='111').length);
console.log('222:', recs.filter(r=>r.numero_pedido==='222').length);
console.log('333:', recs.filter(r=>r.numero_pedido==='333').length);
