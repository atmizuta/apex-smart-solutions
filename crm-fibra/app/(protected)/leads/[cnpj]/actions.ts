"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { atribuirLead, registrarMensagem, buscarLeadPorCnpj, LeadJaAtribuidoError } from "@/lib/leads";
import {
  criarProposta,
  listarPropostasPorCnpj,
  validarItensProposta,
  type NovoItemProposta,
} from "@/lib/propostas";
import { validarSituacaoAtual, type SituacaoAtual } from "@/lib/fatura/tipos";
import { criarAbordagem } from "@/lib/abordagens";
import { interpretarResposta, montarPedidoAbordagem } from "@/lib/ia/abordagem";
import { mensagemDeErroIa } from "@/lib/ia/erros";
import { gerarJson, MODELO_GEMINI } from "@/lib/ia/gemini";

async function sessaoAtiva() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo) redirect("/login");
  return consultor;
}

// O erro do Supabase traz `details` com a linha que falhou (aí iria a situação
// atual do cliente): no log do servidor vão só a mensagem e o código.
// Função privada: arquivo "use server" só pode exportar funções assíncronas.
function resumoDoErro(err: unknown): { message: string; code?: string } {
  const bruto = (err ?? {}) as { message?: unknown; code?: unknown };
  return {
    message: typeof bruto.message === "string" ? bruto.message : "erro desconhecido",
    ...(typeof bruto.code === "string" ? { code: bruto.code } : {}),
  };
}

export async function atribuirLeadAction(cnpjDigits: string): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();
  try {
    await atribuirLead(getSupabaseAdmin(), cnpjDigits, consultor.id);
  } catch (err) {
    if (err instanceof LeadJaAtribuidoError) {
      return { erro: err.message };
    }
    throw err;
  }
  revalidatePath(`/leads/${cnpjDigits}`);
  revalidatePath("/leads");
  return {};
}

export async function registrarMensagemAction(
  cnpjDigits: string,
  conteudo: string,
  canal: "whatsapp" | "ligacao" | "email"
): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();

  const lead = await buscarLeadPorCnpj(getSupabaseAdmin(), cnpjDigits);
  if (!lead || lead.donoConsultorId !== consultor.id) {
    return { erro: "Você precisa ser o dono deste lead para registrar contato" };
  }

  if (!conteudo.trim()) {
    return { erro: "A mensagem não pode ficar em branco" };
  }

  await registrarMensagem(getSupabaseAdmin(), {
    cnpjDigits,
    consultorId: consultor.id,
    canal,
    conteudo: conteudo.trim(),
  });

  revalidatePath(`/leads/${cnpjDigits}`);
  return {};
}

export async function salvarPropostaAction(
  cnpjDigits: string,
  itens: NovoItemProposta[],
  situacaoAtual: SituacaoAtual | null = null
): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();

  // Argumentos de Server Action vêm do navegador: normaliza antes de confiar.
  const itensLimpos: NovoItemProposta[] = (Array.isArray(itens) ? itens : []).map((item) => ({
    catalogoPlanoId: typeof item?.catalogoPlanoId === "string" ? item.catalogoPlanoId : null,
    descricao: String(item?.descricao ?? "").trim(),
    valor: Number(item?.valor),
    quantidade: Number(item?.quantidade),
    franquiaGb: item?.franquiaGb === null || item?.franquiaGb === undefined ? null : Number(item.franquiaGb),
  }));

  const erro = validarItensProposta(itensLimpos);
  if (erro) return { erro };

  const situacao = validarSituacaoAtual(situacaoAtual);
  if (!situacao.ok) return { erro: situacao.erro };

  // Um erro do banco aqui não pode estourar: no cliente isso derruba a página
  // inteira e o consultor perde o rascunho da proposta que ele montou.
  try {
    const lead = await buscarLeadPorCnpj(getSupabaseAdmin(), cnpjDigits);
    if (!lead) return { erro: "Lead não encontrado" };

    await criarProposta(getSupabaseAdmin(), {
      cnpjDigits,
      consultorId: consultor.id,
      itens: itensLimpos,
      situacaoAtual: situacao.valor,
    });
  } catch (err) {
    console.error("salvarPropostaAction falhou", resumoDoErro(err));
    return { erro: "Não foi possível salvar a proposta agora. Tente de novo em instantes." };
  }

  revalidatePath(`/leads/${cnpjDigits}`);
  return {};
}

export async function gerarAbordagemAction(cnpjDigits: string): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();

  // Falha da IA ou do banco nunca estoura: no cliente isso derrubaria a página,
  // e o roteiro anterior (que continua salvo) sumiria da tela.
  try {
    const admin = getSupabaseAdmin();

    const lead = await buscarLeadPorCnpj(admin, cnpjDigits);
    if (!lead) return { erro: "Lead não encontrado" };

    const propostas = await listarPropostasPorCnpj(admin, cnpjDigits);
    const proposta = propostas[0] ?? null;

    const texto = await gerarJson(montarPedidoAbordagem({ lead, proposta }));
    const etapas = interpretarResposta(texto);

    await criarAbordagem(admin, {
      cnpjDigits,
      consultorId: consultor.id,
      propostaId: proposta?.id ?? null,
      etapas,
      modelo: MODELO_GEMINI,
    });
  } catch (err) {
    console.error("gerarAbordagemAction falhou", err);
    return { erro: mensagemDeErroIa(err) };
  }

  revalidatePath(`/leads/${cnpjDigits}`);
  return {};
}
