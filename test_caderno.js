// Testa o Caderno de Ligação (06/10/2026) — REGRAS_NEGOCIO.md §72. DADOS FICTÍCIOS (CPF/CNPJ de exemplo, válidos só no dígito).
const { montarPainel } = require('./painel_teste_base.js');
const { window, rodar } = montarPainel();
window.__JSDOM = require('jsdom').JSDOM;
rodar(`
  // ==== TASK 5: funções puras ====
  assert(cdCpfValido('123.456.789-09') && !cdCpfValido('123.456.789-00') && !cdCpfValido('111.111.111-11'), 'CPF: dígito e repetidos');
  assert(cdCnpjValido('11.222.333/0001-81') && !cdCnpjValido('11.222.333/0001-80') && !cdCnpjValido('00000000000000'), 'CNPJ: dígito e repetidos');
  eq(cdReconhecer('cnpj 11.222.333/0001-81 cpf 123.456.789-09 tel (19) 99000-0001 cep 13010-000 x@teste.com'),
     { email: 'x@teste.com', cnpj: '11222333000181', cpf: '12345678909', telefone: '19990000001', cep: '13010000' }, 'reconhece os 5');
  eq(cdReconhecer('ligar 11987654321'), { telefone: '11987654321' }, '11 dígitos com 9 na 3ª posição = celular, não CPF');
  eq(cdReconhecer('doc 12345678909'), { cpf: '12345678909' }, '11 dígitos com CPF válido e 3º dígito ≠ 9 = CPF');
  eq(cdReconhecer('fixo 1932541000'), { telefone: '1932541000' }, 'fixo com DDD');
  eq(cdReconhecer('12 linhas, paga 900'), {}, 'texto comercial não vira dado');
  const n0 = cdNovaNota();
  assert(/^[0-9a-f-]{36}$/.test(n0.id) && n0.texto === '' && Array.isArray(n0.objecoes), 'nota nova com uuid');
  assert(cdNotaVazia(n0), 'nota nova é vazia');
  const n1 = Object.assign(cdNovaNota(), { telefone: '19990000001', texto: 'cpf 123.456.789-09, cnpj 11.222.333/0001-81' });
  eq(cdSugestoesPreencher(n1), [{ campo: 'cpf', valor: '12345678909' }, { campo: 'cnpj', valor: '11222333000181' }], 'só sugere campo vazio (telefone já preenchido)');
  eq([cdNum('1.234,56'), cdNum('12'), cdNum(''), cdNum('abc')], [1234.56, 12, null, null], 'números em formato BR');
  const n2 = Object.assign(cdNovaNota(), { telefone: '(19) 99000-0001', nome: ' Empresa Teste ', cnpj: '11.222.333/0001-81', cep: '13010-000', qtd_linhas: '12', valor_plano: '899,90', fidelidade_vence: '2027-03', texto: 'linha 1\\nlinha 2' });
  const p2 = cdPayload(n2);
  eq([p2.cnpj, p2.cep, p2.qtd_linhas, p2.valor_plano, p2.fidelidade_vence, p2.nome], ['11222333000181', '13010000', 12, 899.9, '2027-03-01', 'Empresa Teste'], 'payload normalizado');
  assert(!('atualizado_em' in p2) && p2.id === n2.id, 'payload sem atualizado_em (o banco preenche)');
  const r2 = cdRetornoDaNota(n2, '2026-10-07T09:00:00-03:00', 'manual');
  eq([r2.nome, r2.telefone, r2.qtd_linhas, r2.valor_plano, r2.observacao, r2.nota_id, r2.origem, r2.tipo], ['Empresa Teste', '(19) 99000-0001', 12, 899.9, 'linha 1', n2.id, 'manual', 'ligacao'], 'retorno nasce da nota');
  assert(/^[0-9a-f-]{36}$/.test(r2.id), 'retorno com uuid');
  eq(cdRetornoDaNota(Object.assign(cdNovaNota(), { telefone: '19990000001', cnpj: '11222333000181' }), '2026-10-07T09:00:00-03:00', 'manual').nome, 'CNPJ 11.222.333/0001-81', 'sem nome usa o CNPJ');
  eq(cdSugestaoFidelidade('2027-03', '2026-10-06'), { dia: '2027-01-15', rotulo: 'Agendar retorno 45 dias antes do vencimento (15/01)' }, 'fidelidade: 45 dias antes do dia 1º');
  eq(cdSugestaoFidelidade('2026-11', '2026-10-06').dia, '2026-10-07', 'já dentro da janela: amanhã');
  eq(cdSugestaoFidelidade('', '2026-10-06'), null, 'sem vencimento');
  const ctx = cdContextoIA(Object.assign(cdNovaNota(), { nome: 'Fulano Teste', cpf: '12345678909', telefone: '19990000001', qtd_linhas: '12', operadora_atual: 'Vivo', texto: 'falar com 19 99000-0001 ou x@teste.com' }));
  eq(Object.keys(ctx).sort(), ['fidelidade_vence', 'interesse', 'operadora_atual', 'qtd_linhas', 'texto', 'valor_plano'], 'contexto só com campos permitidos');
  assert(!/99000|teste\\.com/.test(ctx.texto) && ctx.texto.includes('[TELEFONE]'), 'texto mascarado no navegador');
  assert(!cdTemContexto(cdNovaNota()) && cdTemContexto(Object.assign(cdNovaNota(), { operadora_atual: 'Vivo' })), 'tem contexto');

  // ==== mais testes entram aqui ====
  // cdMascarar: mesma regra do mascarar() da Edge Function caderno-ia (ia.ts) — classificador único por quantidade de dígitos.
  eq(cdMascarar('13010000'), '[CEP]', 'mascarar: 8 dígitos seguidos = CEP');
  eq(cdMascarar('123 456 789-09'), '[CPF]', 'mascarar: 11 dígitos com separadores livres, 3º dígito ≠ 9 = CPF');
  eq(cdMascarar('019 99000-0001'), '[TELEFONE]', 'mascarar: 0 de tronco cai, sobra 11 dígitos com 9 na 3ª posição = telefone');
  eq(cdMascarar('06/10/2026'), '06/10/2026', 'mascarar: data dd/mm/aaaa não é mascarada');
  eq(cdMascarar('12 linhas'), '12 linhas', 'mascarar: menos de 8 dígitos não é mascarado');

  // cdNum: tipagem BR — "." só é separador de milhar com 3 dígitos e sem vírgula; com vírgula é decimal BR.
  eq(cdNum('899,90'), 899.9, 'num: vírgula decimal BR');
  eq(cdNum('1.200'), 1200, 'num: ponto como milhar (3 dígitos, sem vírgula)');
  eq(cdNum('12.500'), 12500, 'num: ponto como milhar (outro caso)');
  eq(cdNum('99.90'), 99.9, 'num: ponto decimal (não são 3 dígitos após o ponto, sem vírgula)');
  eq(cdNum(42), 42, 'num: número já pronto passa direto');
  fim();
`);
