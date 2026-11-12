// Testa o botão "Vendi!" (§149). DADOS FICTÍCIOS (repo público).
const { rodar } = require('./tv_vendas_harness.js');
rodar(`
  TV_TEMPOS.mini = 200;
  const btn = document.getElementById('btnVendi');
  currentUser = { id: 'u-cp', nome: 'Zz Campinas', role: 'consultor', operacao: 'campinas' };
  vdAplicarPermissao(); eq(btn.style.display, 'none', 'consultor de Campinas não vê');
  currentUser = { id: 'u-ag', nome: 'Zz Agência', role: 'agencia', operacao: 'apex' };
  vdAplicarPermissao(); eq(btn.style.display, 'none', 'agência não vê');
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor', operacao: 'apex' };
  vdAplicarPermissao(); assert(btn.style.display !== 'none', 'consultor da Apex vê');

  btn.click();
  const ov = document.getElementById('vdModal');
  assert(ov && ov.classList.contains('active'), 'janela abre');
  assert(ov.textContent.includes('Venda do discador'), 'fora da Renovação = discador');
  eq(document.getElementById('vdCnpj').value, '', 'CNPJ vazio');
  const v100 = OFFERS_MOBILE.find(o => o.id === 'p57-100').valor, v40 = OFFERS_MOBILE.find(o => o.id === 'p57-40').valor;
  let sel = ov.querySelector('[data-vd-plano]'); sel.value = 'p57-100'; disparar(sel, 'change');
  let lin = ov.querySelector('[data-vd-linhas]'); lin.value = '5'; disparar(lin, 'input');
  ov.querySelector('[data-vd-mais]').click();
  eq(ov.querySelectorAll('.vdItem').length, 2, '+ outro plano cria a 2ª linha');
  sel = ov.querySelectorAll('[data-vd-plano]')[1]; sel.value = 'p57-40'; disparar(sel, 'change');
  lin = ov.querySelectorAll('[data-vd-linhas]')[1]; lin.value = '2'; disparar(lin, 'input');
  eq(document.getElementById('vdReceita').textContent, fmtBRL(vdReceita([{ valor_linha: v100, linhas: 5 }, { valor_linha: v40, linhas: 2 }])), 'receita somada');
  ov.querySelectorAll('[data-vd-tirar]')[1].click();
  eq(ov.querySelectorAll('.vdItem').length, 1, 'tirar remove a linha');
  eq(document.getElementById('vdReceita').textContent, fmtBRL(vdReceita([{ valor_linha: v100, linhas: 5 }])), 'receita recalcula');
  ov.querySelector('[data-vd-tirar]').click();
  eq(ov.querySelectorAll('.vdItem').length, 1, 'a última linha fica');

  const cn = document.getElementById('vdCnpj');
  cn.value = '11222333000181'; disparar(cn, 'input');
  eq(cn.value, '11.222.333/0001-81', 'máscara');
  cn.value = '11.222.333/0001-80';
  document.getElementById('vdConfirmar').click(); await espera();
  eq(chamadas('vendi').length, 0, 'CNPJ inválido não chama o banco');
  eq(document.getElementById('vdErro').textContent, 'CNPJ inválido: confira os 14 números.', 'erro do CNPJ');

  window.__rpcRespostas.vendi = () => new Promise(res => setTimeout(() => res({ data: { id: 41, receita: 474.95, linhas: 5, aviso: 'Você já marcou este CNPJ hoje às 14:03. Se foi engano, use Desfazer.' }, error: null }), 30));
  cn.value = '11.222.333/0001-81';
  document.getElementById('vdConfirmar').click();
  document.getElementById('vdConfirmar').click();
  await espera(80);
  eq(chamadas('vendi').length, 1, 'duplo clique = uma venda');
  const a = chamadas('vendi')[0].args;
  eq([a.p_cnpj, a.p_origem, a.p_itens.length, a.p_itens[0].plano_id, a.p_itens[0].linhas, a.p_itens[0].valor_linha], ['11222333000181', 'discador', 1, 'p57-100', 5, v100], 'argumentos do vendi');
  assert(!ov.classList.contains('active'), 'janela fecha');
  assert(window.__alertas.some(m => m.includes('já marcou este CNPJ')), 'aviso do CNPJ repetido');
  const faixa = document.getElementById('vdDesfazer');
  assert(!!faixa && faixa.textContent.includes('Marcou errado?'), 'faixa Desfazer');
  assert(!!document.querySelector('.vdMini'), 'VENDEU! curto na tela do consultor');
  await espera(200);
  assert(!document.querySelector('.vdMini'), 'VENDEU! curto some');

  window.__rpcRespostas.vendi_cancelar = { data: null, error: { message: 'Passou de 10 minutos: peça ao gestor para cancelar.', code: '42501' } };
  // §149.2: Desfazer abre o motivo; Confirmar desfazer é que cancela
  faixa.querySelector('[data-vd-desfazer]').click(); await espera();
  document.querySelector('#vdDesfazer [data-vd-desfazer-ok]').click(); await espera();
  assert(document.getElementById('vdDesfazerErro').textContent.includes('Passou de 10 minutos'), 'erro do desfazer aparece');
  assert(!!document.getElementById('vdDesfazer'), 'faixa continua se falhou');
  window.__rpcRespostas.vendi_cancelar = { data: null, error: null };
  document.querySelector('#vdDesfazer [data-vd-desfazer-ok]').click(); await espera();
  eq(chamadas('vendi_cancelar').pop().args, { p_id: 41, p_motivo: null }, 'desfaz a venda certa');
  assert(!document.getElementById('vdDesfazer'), 'faixa some');

  // Renovação: CNPJ da ficha aberta, origem renovacao
  rnEstado.lista = [{ id: 7, cnpj_digits: '11444777000161', razao_social: 'Zz Renova' }];
  rnEstado.fichaId = 7;
  document.querySelectorAll('#tabsNav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tabBtnRenovacao').classList.add('active');
  btn.click();
  eq(document.getElementById('vdCnpj').value, '11.444.777/0001-61', 'CNPJ vem da ficha da Renovação');
  sel = document.querySelector('#vdModal [data-vd-plano]'); sel.value = 'p57-40'; disparar(sel, 'change');
  window.__rpcRespostas.vendi = { data: null, error: { message: 'Plano 1: valor por linha fora da faixa (R$ 20 a R$ 400).', code: '22023' } };
  document.getElementById('vdConfirmar').click(); await espera();
  eq(chamadas('vendi').pop().args.p_origem, 'renovacao', 'origem renovacao');
  eq(document.getElementById('vdErro').textContent, 'Plano 1: valor por linha fora da faixa (R$ 20 a R$ 400).', 'erro do banco na janela');
  assert(document.getElementById('vdModal').classList.contains('active'), 'janela fica aberta no erro');
  window.__rpcRespostas.vendi = { data: null, error: { message: 'connection reset', code: 'XX000' } };
  document.getElementById('vdConfirmar').click(); await espera();
  eq(document.getElementById('vdErro').textContent, 'Não foi possível marcar agora. Tente de novo.', 'erro técnico vira mensagem simples');
  document.querySelector('#vdModal [data-vd-fechar]').click();
  assert(!document.getElementById('vdModal').classList.contains('active'), 'Cancelar fecha');
`);
