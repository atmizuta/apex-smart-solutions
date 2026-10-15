// test_proposta_manual_docs.js — modo manual (§83, 15/10/2026): os 3 formatos de emissão (Word, PDF consultor,
// PDF cliente) com dados extras do cliente e bloco de valores únicos/parcelados. Requer: npm i jsdom jspdf docx
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('painel_clientes_apex.html','utf8');
const htmlNoScript=html.replace(/<script>[\s\S]*?<\/script>/g,'');
const jsCode=html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const dom=new JSDOM(htmlNoScript,{runScripts:'outside-only',url:'http://localhost/'});
const {window}=dom;
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},from:()=>({select:()=>({order:()=>({then:()=>{}})})}),functions:{invoke:async()=>({data:{},error:null})}})};
const {jsPDF}=require('jspdf'); const texts=[];
class J extends jsPDF{ constructor(...a){ super(...a); const o=this.text.bind(this); this.text=(t,...r)=>{ texts.push(String(Array.isArray(t)?t.join(' '):t)); return o(t,...r); }; } }
window.jspdf={jsPDF:J}; window.docx=require('docx'); window.alert=()=>{};
window.__texts=texts;
const t=`
currentUser={id:'u1',nome:'Cons',username:'c',role:'consultor'};
openProposal({razao_social:'X LTDA',cnpj:'1',cidade:'SP',ddd:'11',linhas_atuais:1,valor_contrato:10,arpu:1,cep_cabeado:''},{avulsa:true,tipoAvulsa:'novo'});
proposalState.modoManual=true;
proposalState.clienteManual={contato:'Maria',telefone:'1199',email:'m@x.com',endereco:'Rua A'};
proposalState.itensManuais=[{categoria:'Nova linha',descricao:'Plano 30GB',valorUnit:44.99,qtd:10,cobranca:'mensal',parcelas:12},{categoria:'Aparelho',descricao:'Smartphone X',valorUnit:200,qtd:2,cobranca:'parcelado',parcelas:10},{categoria:'Produto avançado',descricao:'Instalacao PABX',valorUnit:500,qtd:1,cobranca:'unico',parcelas:1}];
const m=buildPropostaDocModel();
let r={};
const d1=montarPdfProposta(m); r.pdf1=d1.getNumberOfPages();
const d2=montarPdfPropostaCliente(m); r.pdf2=d2.getNumberOfPages();
r.docxPromise=montarDocxProposta(m).then(b=>b.size||b.length||1);
r;`;
(async()=>{const r=window.eval(jsCode+'\n'+t);r.docx=await r.docxPromise;delete r.docxPromise;console.log(JSON.stringify(r));
const all=window.__texts.join('|');
let ok=0,fail=0;
for(const k of ['VALORES ÚNICOS / APARELHOS','INVESTIMENTO ÚNICO / APARELHOS','Valor único / parcelado','Contato: Maria','(mensal)','TOTAL ÚNICO']){ if(all.includes(k)) ok++; else { fail++; console.log('FALHOU: texto ausente nos PDFs:',k);} }
if(r.docx>1000) ok++; else { fail++; console.log('FALHOU: docx nao gerado'); }
console.log('RESULTADO: '+ok+' passaram, '+fail+' falharam'); if(fail) process.exitCode=1;})().catch(e=>{console.error('ERR',e.stack);process.exit(1)});
