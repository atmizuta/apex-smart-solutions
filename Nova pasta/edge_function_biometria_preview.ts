// ============================================================
// Edge Function: biometria-preview
// ------------------------------------------------------------
// Página-ponte PÚBLICA (sem autenticação) usada pelo link de "biometria facial" que o consultor
// envia pelo WhatsApp (aba Biometria do painel, 09/09/2026 — ver REGRAS_NEGOCIO.md).
//
// Por que essa página existe: no WhatsApp, uma imagem sozinha nunca é clicável — só um link em texto
// puro vira um card grande e clicável, e esse card usa as tags Open Graph (og:title, og:description,
// og:image) da página que o link aponta. A página real de biometria (do sistema da Claro) não tem
// essas tags configuradas do jeito que a gente quer (e não temos como editar essa página, que é de
// terceiro). Esta função serve de "ponte": devolve um HTML com as tags OG fixas (sempre a mesma
// imagem, com a identidade visual da Claro Empresas — biometria_preview.png, hospedada no próprio
// apexsmart.com.br) e, visível pro cliente, uma saudação com o nome dele e um botão "Clique aqui" que
// leva pro link real e específico daquele cliente.
//
// Chamada como:
//   {SUPABASE_URL}/functions/v1/biometria-preview?nome=<nome do cliente>&link=<link real da Claro>
// (os dois parâmetros vão via URLSearchParams no painel, então já saem corretamente urlencoded)
//
// IMPORTANTE: verify_jwt precisa ficar DESLIGADO nesta função (diferente do padrão do resto do
// projeto, onde toda função exige um usuário logado) — tanto o robô que gera o preview no WhatsApp
// quanto o navegador do próprio cliente abrem essa URL diretamente, sem nenhum token de autenticação.
// Isso é uma exceção deliberada e segura: a função não lê nem grava nada no banco, só monta uma
// página de redirecionamento visível a partir de dados que o próprio consultor forneceu no painel.
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto, vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: biometria-preview
// 3. Cole todo o conteúdo deste arquivo no editor.
// 4. IMPORTANTE: desmarque "Verify JWT" antes de publicar (ver justificativa acima).
// ============================================================

// URL pública da imagem de preview (única, compartilhada por todos os clientes — ver REGRAS_NEGOCIO.md).
const PREVIEW_IMAGE_URL = "https://apexsmart.com.br/biometria_preview.png";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Só aceita URLs absolutas http/https — bloqueia esquemas perigosos (javascript:, data:, etc.) e
// entradas que não sejam URL nenhuma. Devolve null se inválido.
export function validarLink(linkParam: string) {
  try {
    const u = new URL(linkParam);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

export function paginaErro(mensagem: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Link inválido</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#0d0d0d;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<div><h1 style="color:#ff5468;font-size:22px">Link inválido</h1><p>${escapeHtml(mensagem)}</p></div>
</body></html>`;
}

// Monta a página-ponte final. `linkDestino` já deve ser uma string de URL válida (resultado de
// validarLink(...).toString()) — só é escapada aqui por segurança extra antes de entrar no HTML.
export function paginaBridge(linkDestino: string, nomeParam: string): string {
  const nomeSeguro = escapeHtml((nomeParam || "").trim().slice(0, 100));
  const linkSeguro = escapeHtml(linkDestino);
  const saudacao = nomeSeguro ? `Olá, ${nomeSeguro}!` : "Olá!";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claro Empresas — Biometria facial</title>
<meta property="og:title" content="Claro Empresas — Biometria facial">
<meta property="og:description" content="Confirme sua identidade para concluir a ativação.">
<meta property="og:image" content="${PREVIEW_IMAGE_URL}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<style>
  body{margin:0;font-family:Arial,Helvetica,sans-serif;background:linear-gradient(135deg,#0d0d0d,#520b05);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:440px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:36px 28px}
  h1{font-size:22px;margin:0 0 12px}
  p{color:#e6e6e6;font-size:15px;line-height:1.5;margin:0 0 26px}
  a.btn{display:inline-block;background:#fff;color:#a80e26;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:16px}
  .hint{margin-top:16px;font-size:12px;color:#c9c9c9}
</style>
</head>
<body>
  <div class="card">
    <h1>${saudacao}</h1>
    <p>Falta só um passo para concluir a sua ativação na Claro Empresas: confirme sua identidade com a biometria facial.</p>
    <a class="btn" href="${linkSeguro}">Clique aqui →</a>
    <div class="hint">Você será direcionado para o ambiente oficial de biometria.</div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const linkParam = url.searchParams.get("link") || "";
  const nomeParam = url.searchParams.get("nome") || "";

  const destino = validarLink(linkParam);
  if (!destino) {
    return new Response(paginaErro("O link informado não é uma URL válida (precisa começar com http:// ou https://)."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const html = paginaBridge(destino.toString(), nomeParam);
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
