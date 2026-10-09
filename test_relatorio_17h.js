// Testa o botão "Gerar relatório 17h" da Visão Diária (30/09/2026, REGRAS_NEGOCIO.md seção 56): texto com as
// vendas do dia até as 17h (linhas, banda larga, migração, portabilidade, linha nova, renovação, aparelho, telefone
// fixo, Claro Monitor e valor total). Mesma técnica de test_dashboard_ajustes.js (template embutido + jsdom).
// Dados FICTÍCIOS.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplRaw = Buffer.from(m[1], 'base64').toString('utf8');
const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const jsOriginal = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

function montarDashboard({ data = [], adminMode = true } = {}){
  const html = htmlNoScript.replace('__ADMIN_BADGE__', '').replace('__APEX_B64__', '').replace('__CLARO_B64__', '').replace('__UPDATED_AT__', '30/09/2026, 20:00:00');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  w.eval(jsOriginal.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(data) + ';').replace('__ADMIN_MODE__', adminMode ? 'true' : 'false'));
  return w;
}
const DIA = '2026-09-30'; // quarta-feira
// 08/10/2026 (seção 76): o corte das 17h passou a usar a hora de entrada na sincronização (criado_em). Nas fixtures
// antigas a hora estava em `cadastro`; por padrão criado_em = cadastro, então os casos antigos seguem iguais.
function ped(over){ const r = Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'CONCLUIDO (NEOCRM)',
  cadastro: '2026-09-30T10:00:00-03:00', atualizacao: '2026-09-30T10:00:00-03:00',
  valor: 100, quantidade: 1, produto: 'Plano Teste', cliente: 'EMPRESA FICTICIA LTDA', cnpj: null, tag: null,
}, over); if(!('criado_em' in (over || {}))) r.criado_em = r.cadastro; return r; }

const DADOS = [
  // dentro do corte (até 16:59 em São Paulo)
  ped({ numero_pedido: 'N1', grupo: 'VOZ - Novo', valor: 50, quantidade: 1, cadastro: '2026-09-30T09:00:00-03:00' }),
  ped({ numero_pedido: 'N2', grupo: 'VOZ - Novo', valor: 60, quantidade: 2, cadastro: '2026-09-30T12:30:00-03:00' }),       // 1 linha do card, 2 linhas móveis
  ped({ numero_pedido: 'P1', grupo: 'VOZ - Portabilidade', valor: 70, cadastro: '2026-09-30T16:59:00-03:00' }),             // 16:59 entra
  ped({ numero_pedido: 'P2', grupo: 'VOZ - Portabilidade', valor: 80, cadastro: '2026-09-30T19:30:00+00:00' }),             // 16:30 em SP (UTC 19:30) entra
  ped({ numero_pedido: 'R1', grupo: 'VOZ - Renovação', valor: 90 }),
  ped({ numero_pedido: 'T1', grupo: 'VOZ - Tranf. Titularidade', valor: 40 }),
  ped({ numero_pedido: 'B1', grupo: 'BANDA LARGA - Novo', valor: 120 }),
  ped({ numero_pedido: 'B2', grupo: 'BANDA LARGA - Novo', valor: 130 }),
  ped({ numero_pedido: 'A1', grupo: 'APARELHO', valor: 3000 }),
  ped({ numero_pedido: 'F1', grupo: 'SVA FIXA', valor: 10 }),
  ped({ numero_pedido: 'M1', grupo: 'SVA MÓVEL', produto: 'CLARO MONITOR', valor: 5 }),
  ped({ numero_pedido: 'M2', grupo: 'SVA MÓVEL', produto: 'CLARO MONITOR', valor: 5 }),
  // fora do corte: 17:00 em ponto, depois das 17h, UTC que vira 17h+ em São Paulo
  ped({ numero_pedido: 'X1', grupo: 'VOZ - Portabilidade', valor: 1000, cadastro: '2026-09-30T17:00:00-03:00' }),
  ped({ numero_pedido: 'X2', grupo: 'VOZ - Novo', valor: 1000, cadastro: '2026-09-30T18:45:00-03:00' }),
  ped({ numero_pedido: 'X3', grupo: 'BANDA LARGA - Novo', valor: 1000, cadastro: '2026-09-30T20:00:00+00:00' }),            // 17:00 em SP
  // outro dia
  ped({ numero_pedido: 'D1', grupo: 'VOZ - Portabilidade', valor: 999, cadastro: '2026-09-29T10:00:00-03:00' }),
  ped({ numero_pedido: 'D2', grupo: 'VOZ - Novo', valor: 999, cadastro: '2026-10-01T10:00:00-03:00' }),
  // 06/10/2026 (pedido do usuário): o relatório divergia da Visão Diária porque não excluía pedidos
  // em "AGUARDANDO INTERACAO (NEOCRM)"/"PROPOSTA (NEOCRM)" (seção 16.16) — dia isolado pra testar.
  ped({ numero_pedido: 'EXCL-1', grupo: 'VOZ - Novo', etapa: 'AGUARDANDO INTERACAO (NEOCRM)', valor: 900, cadastro: '2026-09-28T09:00:00-03:00' }),
  ped({ numero_pedido: 'EXCL-2', grupo: 'VOZ - Novo', etapa: 'PROPOSTA (NEOCRM)',             valor: 900, cadastro: '2026-09-28T09:10:00-03:00' }),
  ped({ numero_pedido: 'EXCL-3', grupo: 'VOZ - Novo', etapa: 'CONCLUIDO (NEOCRM)',            valor: 80,  cadastro: '2026-09-28T09:20:00-03:00' }),
  // 08/10/2026 (seção 76): como vem da API — cadastro 00:00, hora real na entrada da sincronização
  ped({ numero_pedido: 'E-1', grupo: 'VOZ - Novo',          valor: 10, cadastro: '2026-10-02T00:00:00-03:00', criado_em: '2026-10-02T16:40:00-03:00' }),
  ped({ numero_pedido: 'E-2', grupo: 'VOZ - Portabilidade', valor: 20, cadastro: '2026-10-02T00:00:00-03:00', criado_em: '2026-10-02T18:10:00-03:00' }),
  ped({ numero_pedido: 'E-3', grupo: 'VOZ - Novo',          valor: 40, cadastro: '2026-10-02T00:00:00-03:00', criado_em: null }),
];

let w = montarDashboard({ data: DADOS });
let d = w.document;
d.getElementById('diariaDate').value = DIA;

// ---------------------------------------------------------------- 1) botão
const btn = d.getElementById('relatorioBtn');
assert(!!btn && btn.textContent.trim() === 'Gerar relatório 17h', 'existe o botão "Gerar relatório 17h"');
assert(btn && btn.previousElementSibling && btn.previousElementSibling.id === 'tvModeBtn', 'o botão fica logo ao lado do Modo TV');
assert(!d.getElementById('relatorioOverlay').classList.contains('open'), 'a janela do relatório começa fechada');

// ---------------------------------------------------------------- 2) contagem (mesmas regras da Visão Diária, até as 17h)
const dados = w.dadosRelatorioDia(DIA, 17);
const por = Object.fromEntries(dados.itens.map(i => [i.grupo, i.qtd]));
assert(dados.rows.length === 12, 'entram só os 12 pedidos do dia até 16:59 (fora: 17:00, 18:45, 17:00 via UTC e outros dias) — achou ' + dados.rows.length);
assert(por['VOZ - Novo'] === 2 && por['VOZ - Portabilidade'] === 2 && por['VOZ - Renovação'] === 1 && por['VOZ - Tranf. Titularidade'] === 1, 'voz: 2 novas, 2 portabilidades, 1 renovação, 1 titularidade');
assert(por['BANDA LARGA - Novo'] === 2 && por['APARELHO'] === 1 && por['SVA FIXA'] === 1 && por['SVA MÓVEL'] === 2, 'banda larga 2, aparelho 1, telefone fixo 1, Claro Monitor 2');
assert(dados.linhas === 7, 'Linhas do dia = soma das quantidades dos grupos VOZ - * (1+2+1+1+1+1 = 7) — achou ' + dados.linhas);
assert(dados.valor === 50 + 60 + 70 + 80 + 90 + 40 + 120 + 130 + 3000 + 10 + 5 + 5, 'valor total soma todos os pedidos do dia até as 17h — achou ' + dados.valor);
assert(w.dadosRelatorioDia(DIA, null).rows.length === 15, 'sem corte, o dia tem 15 pedidos (confere com a Visão Diária)');

// --- 2.1) 06/10/2026: pedidos em "AGUARDANDO INTERACAO"/"PROPOSTA" não contam no relatório (mesma
// regra da Visão Diária, seção 16.16) — só o EXCL-3 (CONCLUIDO) deve aparecer ---
const dadosExcluidos = w.dadosRelatorioDia('2026-09-28', null);
assert(dadosExcluidos.rows.length === 1, 'dia com pedidos em aguardando interação/proposta: só 1 pedido conta (o concluído) — achou ' + dadosExcluidos.rows.length);
assert(dadosExcluidos.valor === 80, 'dia com pedidos em aguardando interação/proposta: valor soma só R$ 80 (EXCL-1 e EXCL-2 ficam de fora) — achou ' + dadosExcluidos.valor);

// --- 2.2) 08/10/2026 (seção 76): o corte é pela hora de entrada (antes todo pedido caía às 00h e nada era cortado)
const dadosEntrada = w.dadosRelatorioDia('2026-10-02', 17);
assert(dadosEntrada.rows.length === 2 && dadosEntrada.valor === 50, 'corte das 17h pela entrada: E-1 (16:40) e E-3 (sem hora) contam; E-2 (18:10) fica de fora — achou ' + dadosEntrada.rows.length + ' / ' + dadosEntrada.valor);
assert(w.dadosRelatorioDia('2026-10-02', null).rows.length === 3, 'sem corte, os 3 pedidos do dia contam');

// ---------------------------------------------------------------- 3) texto
const agoraDepois = { date: DIA, hora: '17:05' };
const txt = w.textoRelatorio(DIA, 17, agoraDepois);
const linhas = txt.split('\n');
assert(linhas[0] === 'RELATÓRIO DE VENDAS — 30/09/2026 (quarta-feira)', 'título com o dia e o dia da semana — "' + linhas[0] + '"');
assert(linhas[1] === 'Posição das 17h (pedidos cadastrados até as 17:00)', 'explica o corte das 17h');
const esperado = ['Linhas do dia: 7', 'Banda larga: 2', 'Migração (titularidade): 1', 'Portabilidade: 2', 'Linha nova: 2', 'Renovação: 1', 'Aparelho: 1', 'Telefone fixo: 1', 'Claro Monitor: 2'];
assert(JSON.stringify(linhas.slice(3, 12)) === JSON.stringify(esperado), 'as 9 linhas pedidas, na ordem: ' + JSON.stringify(linhas.slice(3, 12)));
assert(/^Valor total: R\$ 3\.660,00$/.test(linhas[13]), 'mostra o valor total (R$ 3.660,00) — "' + linhas[13] + '"');
assert(!txt.includes(' '), 'o texto não tem espaço "inquebrável" (cola limpo no WhatsApp)');
assert(!txt.includes('Obs.:'), 'gerado depois das 17h: sem aviso de parcial');

// gerado ANTES das 17h, no próprio dia: avisa que é parcial
const txtParcial = w.textoRelatorio(DIA, 17, { date: DIA, hora: '14:32' });
assert(txtParcial.endsWith('Obs.: relatório gerado às 14:32, antes das 17h — os números são parciais.'), 'antes das 17h no mesmo dia: avisa que os números são parciais');
assert(!w.textoRelatorio(DIA, 17, { date: '2026-10-01', hora: '09:00' }).includes('Obs.:'), 'relatório de um dia passado nunca é "parcial"');

// dia sem nenhuma venda: tudo zerado, sem quebrar
const txtVazio = w.textoRelatorio('2026-09-20', 17, { date: '2026-09-30', hora: '18:00' });
assert(txtVazio.includes('Linhas do dia: 0') && txtVazio.includes('Banda larga: 0') && txtVazio.includes('Valor total: R$ 0,00'), 'dia sem vendas gera o texto com zeros');

// ---------------------------------------------------------------- 4) janela: abrir, texto pronto, copiar, WhatsApp, fechar
btn.click();
assert(d.getElementById('relatorioOverlay').classList.contains('open'), 'clicar no botão abre a janela do relatório');
const ta = d.getElementById('relatorioTexto');
assert(ta.value.startsWith('RELATÓRIO DE VENDAS — 30/09/2026 (quarta-feira)') && ta.value.includes('Portabilidade: 2'), 'a janela já vem com o texto do dia escolhido na Visão Diária');
assert(/30\/09\/2026/.test(d.getElementById('relatorioTitulo').textContent), 'título da janela cita a data');
ta.value = ta.value + '\nObservação do chefe.';
assert(ta.value.endsWith('Observação do chefe.'), 'o texto pode ser editado antes de copiar');

let copiado = null;
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { copiado = t; } }, configurable: true });
(async () => {
  await w.copiarRelatorio();
  assert(copiado === ta.value, 'Copiar envia exatamente o texto da janela (inclusive a edição)');
  assert(/copiado/i.test(d.getElementById('relatorioMsg').textContent), 'mostra a confirmação "Texto copiado"');

  // clipboard indisponível: cai no execCommand e, se também falhar, orienta a copiar à mão
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('negado'); } }, configurable: true });
  d.execCommand = () => true;
  await w.copiarRelatorio();
  assert(/copiado/i.test(d.getElementById('relatorioMsg').textContent), 'sem permissão do navegador, usa o método alternativo de copiar');
  d.execCommand = () => false;
  await w.copiarRelatorio();
  assert(/Ctrl\+C/.test(d.getElementById('relatorioMsg').textContent), 'se nada funcionar, orienta a usar Ctrl+C');

  let aberto = null;
  w.open = (url, alvo, feat) => { aberto = { url, alvo, feat }; };
  w.enviarRelatorioWhatsApp();
  assert(aberto && aberto.url.startsWith('https://wa.me/?text=') && decodeURIComponent(aberto.url).includes('Observação do chefe.') && decodeURIComponent(aberto.url).includes('Linhas do dia: 7'), 'WhatsApp abre com o texto (já editado) pronto para escolher o contato');
  assert(aberto && /noopener/.test(aberto.feat), 'o WhatsApp abre em nova aba sem dar acesso à página');

  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert(!d.getElementById('relatorioOverlay').classList.contains('open'), 'Esc fecha a janela');
  btn.click();
  d.querySelector('#relatorioOverlay .modal-close').click();
  assert(!d.getElementById('relatorioOverlay').classList.contains('open'), 'o X fecha a janela');
  btn.click();
  d.getElementById('relatorioOverlay').click();
  assert(!d.getElementById('relatorioOverlay').classList.contains('open'), 'clicar fora da janela fecha');

  // trocar o dia da Visão Diária muda o relatório
  d.getElementById('diariaDate').value = '2026-09-29';
  btn.click();
  assert(d.getElementById('relatorioTexto').value.includes('29/09/2026') && d.getElementById('relatorioTexto').value.includes('Portabilidade: 1') && d.getElementById('relatorioTexto').value.includes('Valor total: R$ 999,00'),
    'trocando o dia na Visão Diária o relatório acompanha: 29/09 tem 1 portabilidade e R$ 999,00');

  // ---------------------------------------------------------------- 5) só admin/supervisor veem o botão
  const wConsultor = montarDashboard({ data: DADOS, adminMode: false });
  assert(!wConsultor.document.getElementById('relatorioBtn'), 'consultor não vê o botão do relatório');

  // Modo TV esconde o botão (só o Modo TV fica)
  const css = [...d.querySelectorAll('style')].map(s => s.textContent).join('\n');
  assert(/body\.tv-mode \.rel-btn\{display:none;\}/.test(css), 'no Modo TV o botão do relatório some');

  // ---------------------------------------------------------------- 6) posição da janela dentro do iframe alto (bug de 30/09/2026)
  // O dashboard roda num iframe com a altura do conteúdo; um "fixed" comum ficava no meio do iframe inteiro, longe da tela.
  const pos = (topo, tela, total) => w.calcularPosicaoOverlay(topo, tela, total);
  let p = pos(-2407, 768, 4972);
  assert(p.topo === 2407 && p.altura === 768, 'página rolada 2407px: a janela fica no trecho visível (topo 2407, altura 768) — ' + JSON.stringify(p));
  p = pos(100, 768, 4972);
  assert(p.topo === 0 && p.altura === 668, 'iframe começando 100px abaixo do topo da tela: só os 668px visíveis — ' + JSON.stringify(p));
  p = pos(-4500, 768, 4972);
  assert(p.topo === 4500 && p.altura === 472, 'no fim da página a janela não passa do fim do iframe (altura 472) — ' + JSON.stringify(p));
  p = pos(0, 200, 4972);
  assert(p.altura === 240, 'tela muito baixa: altura mínima de 240px — ' + JSON.stringify(p));
  assert(pos(-10, 812, 3000).maxCartao === 650, 'o cartão da janela nunca passa de ~85% da tela real, menos folga (812px → 650px)');

  // a janela do relatório usa o mesmo mecanismo do analítico, e abrir não rola a página até o campo de texto
  const fonteDash = tplRaw;
  assert(/\['drilldownOverlay', 'relatorioOverlay'\]\.forEach\(ajustarPosicaoOverlay\)/.test(fonteDash), 'o posicionamento vale para o analítico E para o relatório');
  assert(/classList\.add\('open'\);\s*ajustarPosicaoDrilldown\(\);/.test(fonteDash), 'abrir o relatório já posiciona a janela na parte visível');
  assert(/focus\(\{ preventScroll: true \}\)/.test(fonteDash), 'o foco no texto não rola a página');

  // ---------------------------------------------------------------- 7) altura do iframe acompanha o conteúdo (rolagem "infinita" em branco)
  assert(/const h = doc\.body \? Math\.ceil\(doc\.body\.getBoundingClientRect\(\)\.height\)/.test(outerHtml), 'a altura do iframe é a do CORPO do dashboard (antes usava documentElement.scrollHeight, que nunca diminui)');
  assert(!/const h = Math\.max\(doc\.documentElement\.scrollHeight/.test(outerHtml), 'a medição antiga (que só crescia) foi removida');
  assert(!/id="producaoFrame"[^>]*min-height:2400px/.test(outerHtml), 'o iframe não tem mais o mínimo de 2400px (abas curtas não sobram em branco)');

  console.log('--- test_relatorio_17h RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
})();
