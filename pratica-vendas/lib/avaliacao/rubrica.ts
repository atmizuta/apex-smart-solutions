export const CRITERIOS_RUBRICA: string[] = [
  'Personalizou a abertura com o nome do cliente e a necessidade mencionada no cenário? (citar o nome da empresa é um bônus, mas não é obrigatório — não penalize por faltar só isso)',
  'Abriu pelo plano de 100GB ou 70GB, não pelo plano de entrada?',
  'Só desceu de plano porque o cliente questionou o valor, não de primeira?',
  'Evitou oferecer o plano regional de R$44,99/15GB?',
  'Fez uma pergunta de fechamento, não uma pergunta aberta?',
  'Tratou a objeção seguindo a lógica do guia (ex.: sem viabilidade não é "não", redirecionar pra linha móvel)?',
];

export function construirPromptAvaliacao(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): string {
  const transcricaoFormatada = transcricao
    .map((m) => `${m.remetente === 'consultor' ? 'CONSULTOR' : 'CLIENTE'}: ${m.texto}`)
    .join('\n');

  const criteriosFormatados = CRITERIOS_RUBRICA.map((c, i) => `${i + 1}. ${c}`).join('\n');

  return (
    `Você vai avaliar a conversa de um consultor de vendas com um cliente simulado, usando ` +
    `exatamente os critérios abaixo (baseados no guia de atendimento da Apex Smart Solutions):\n\n` +
    `${criteriosFormatados}\n\n` +
    `Transcrição:\n${transcricaoFormatada}\n\n` +
    `Se a nota for menor que 100, liste em "dicas" no mínimo 5 sugestões concretas e específicas ` +
    `(citando o que o consultor deveria ter dito ou feito diferente) pra ele melhorar — mesmo que a ` +
    `nota esteja próxima de 100, como 99. Se a nota for exatamente 100, "dicas" pode vir como lista vazia.\n\n` +
    `Responda SOMENTE com um JSON no formato ` +
    `{"nota": <número de 0 a 100>, "feedback": "<2-4 frases específicas, citando trechos da conversa quando possível>", ` +
    `"dicas": ["<dica 1>", "<dica 2>", "..."]}, sem nenhum texto antes ou depois do JSON.`
  );
}
