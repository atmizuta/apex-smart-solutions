export function construirPromptCliente(cenario: {
  titulo: string;
  descricao: string;
  promptIaCliente: string;
  nomeCliente: string;
  empresaCliente: string;
}): string {
  return (
    `Você está simulando um cliente em uma conversa de vendas de WhatsApp, para treinar um ` +
    `consultor de vendas da Apex Smart Solutions (revenda Claro Empresas).\n\n` +
    `Cenário: ${cenario.titulo}\n` +
    `Contexto: ${cenario.descricao}\n` +
    `Seu nome: ${cenario.nomeCliente}\n` +
    `Sua empresa: ${cenario.empresaCliente}\n\n` +
    `Como agir: ${cenario.promptIaCliente}\n\n` +
    `Regras: responda sempre como o cliente, em português, em mensagens curtas de WhatsApp. ` +
    `Nunca saia do personagem, nunca mencione que você é uma IA, nunca explique a simulação.`
  );
}
