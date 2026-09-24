// ============================================================
// Edge Function: sync-leads
// ------------------------------------------------------------
// Busca a planilha de leads do Google (exportação de anúncios Facebook/Instagram) direto do
// servidor (sem o problema de CORS que um fetch feito no navegador teria) e grava/atualiza a
// tabela public.leads — usada pelo dashboard "Conversão de Vendas" (25/08/2026).
//
// Só admin e supervisor podem chamar (mesma restrição de quem vê o dashboard — ver
// REGRAS_NEGOCIO.md, seção do dashboard de Conversão de Vendas).
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto, vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: sync-leads
// 3. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// (A service_role key já fica disponível automaticamente dentro da função,
//  não precisa configurar nada a mais.)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Planilha "Leads Google" (exportação de campanhas Facebook/Instagram) — o time cria uma aba nova
// por mês (ex.: "FORM- LEADS CLARO B2B APEX - AGOSTO", depois "...SETEMBRO"), todas com a mesma
// estrutura de colunas. Precisa estar compartilhada como "qualquer pessoa com o link pode ver" pro
// fetch server-side funcionar sem autenticação.
//
// 09/09/2026: antes a função buscava só a exportação "padrão" (?format=csv, sem indicar aba), que
// pega SEMPRE a aba mais à esquerda da planilha — funcionava enquanto só existia uma aba, mas
// quando o time criou a aba de Setembro (deixando-a antes da de Agosto), a sincronização passou a
// trazer só Setembro e "esquecer" os leads de Agosto (ver REGRAS_NEGOCIO.md, seção do dashboard
// Digital).
//
// Uma primeira correção usou o endpoint gviz (`gviz/tq?tqx=out:csv&sheet=<nome da aba>`), que
// resolve por NOME em vez de posição — mas esse endpoint faz uma detecção "esperta" de cabeçalho
// do lado do Google, e por algum motivo (só na aba de Agosto, não na de Setembro) essa detecção
// funde o rótulo da coluna com o valor da 1ª linha de dado na mesma célula (ex.: a coluna vira
// literalmente `"id l:1087703643780439"`), fazendo a função não achar o cabeçalho de jeito nenhum
// nessa aba — foi o erro "Não foi possível localizar a linha de cabeçalho" visto em produção.
// A correção final: usar o endpoint de exportação DIRETA por `gid` (`export?format=csv&gid=<gid>`,
// mesmo endpoint já usado antes, só que agora por gid explícito em vez de depender de qual aba está
// mais à esquerda) — esse endpoint devolve as células cruas, sem nenhuma "inteligência" de
// cabeçalho do lado do Google, então não sofre desse problema. O `gid` de cada aba foi obtido
// direto na planilha (clicando em cada aba e olhando a URL, ex. `.../edit?gid=1483781302`).
//
// IMPORTANTE: quando o time criar a aba de um novo mês, é preciso (1) abrir a planilha, clicar na
// aba nova e copiar o `gid` da URL, e (2) adicionar um item aqui com o `label` (só pra aparecer nas
// mensagens de erro) e esse `gid`, e reimplantar esta função — as abas antigas continuam sendo
// somadas também, nada precisa ser removido.
// 14/09/2026: a aba de Setembro foi recriada na planilha (o nome perdeu o prefixo "FORM- ") e
// ganhou um gid novo — o gid antigo (1483781302) passou a devolver HTTP 400 ("A planilha não
// retornou nenhuma linha válida" / erro genérico do Google), fazendo a sincronização inteira falhar
// havia dias sem ninguém perceber (a aba de Agosto continuava funcionando normalmente). Gid corrigido
// pro atual (1292366194), obtido de novo direto na planilha. Também adicionada a aba "REPIQUE"
// (mesma estrutura de colunas, um lote de recontato de leads), a pedido do usuário.
const SHEET_ID = "1nu3yNLedr3ier2f7S6dI95XX6gxyJpsg4dtpi66AP5w";
const SHEET_TABS = [
  { label: "FORM- LEADS CLARO B2B APEX - AGOSTO", gid: "0" },
  { label: "LEADS CLARO B2B APEX - SETEMBRO", gid: "1292366194" },
  { label: "REPIQUE", gid: "532368128" },
];
function sheetTabCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

// Categorização do status interno de atendimento (coluna STATUS da planilha) — mesmo espírito da
// categorização Ganho/Perdido/Andamento do Dashboard de Produção (ver seção 16.2 do
// REGRAS_NEGOCIO.md), adaptada aos status que o time usa nessa planilha de leads.
const STATUS_CONVERTIDO = ["PEDIDO CONCLUIDO (VENDA)"];
const STATUS_PERDIDO = [
  "CLIENTE NÃO RESPONDE",
  "CLIENTE NÃO ACEITOU VALORES",
  "CLIENTE SEM INTERESSE NO PLANO",
  "LEAD PAROU DE RESPONDER",
  "CNPJ INAPTO",
];
const STATUS_ANDAMENTO = [
  "EM NEGOCIAÇÂO",
  "AGENDADO RETORNO",
  "AGUARDANDO DOCUMENTAÇÃO",
  "AGUARDANDO CLIENTE DECIDIR",
];

function normalizaStatus(s: string): string {
  return (s || "").trim().toUpperCase();
}

export function categoriaDoStatus(statusBruto: string): string {
  const s = normalizaStatus(statusBruto);
  if (!s) return "sem_contato";
  if (STATUS_CONVERTIDO.includes(s)) return "convertido";
  if (STATUS_PERDIDO.includes(s)) return "perdido";
  if (STATUS_ANDAMENTO.includes(s)) return "andamento";
  return "andamento"; // status desconhecido/novo entra como andamento, não some do funil
}

export function calcConverteu(statusBruto: string, converteuBruto: string): boolean {
  if (normalizaStatus(statusBruto) === "PEDIDO CONCLUIDO (VENDA)") return true;
  return (converteuBruto || "").trim().toLowerCase() === "sim";
}

export function parseReceita(v: string): number {
  if (!v) return 0;
  const limpo = String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function get(row: Record<string, string>, key: string): string {
  // os cabeçalhos da planilha têm espaço sobrando em alguns nomes (ex.: "CONSULTOR ") — normaliza
  // comparando sem espaços nas pontas.
  const foundKey = Object.keys(row).find((k) => k.trim() === key);
  return foundKey ? (row[foundKey] ?? "").trim() : "";
}

// Parseia o CSV de UMA aba e devolve os registros já mapeados (mesma lógica de detecção de
// cabeçalho tolerante a linha extra na frente, usada desde o fix de 04/09/2026 — ver comentário
// mais abaixo, ao lado de onde essa função é chamada). Lança erro (com mensagem amigável,
// identificando a aba) se não achar a linha de cabeçalho.
export function parseSheetCsv(csvText: string, tabLabel: string): ReturnType<typeof mapearLinha>[] {
  const parsedRaw = Papa.parse(csvText, { skipEmptyLines: true });
  if (parsedRaw.errors && parsedRaw.errors.length > 0) {
    console.error(`Erros ao parsear CSV da aba "${tabLabel}":`, parsedRaw.errors.slice(0, 5));
  }
  const allRows = parsedRaw.data as string[][];
  const headerIdx = allRows.findIndex(
    (r) => (r[1] || "").trim() === "created_time" && r.includes("campaign_id") && r.includes("lead_status"),
  );
  if (headerIdx === -1) {
    throw new Error(
      `Não foi possível localizar a linha de cabeçalho na aba "${tabLabel}" (esperava 'created_time' na 2ª coluna).`,
    );
  }
  const rawHeaders = allRows[headerIdx].map((h) => (h || "").trim());
  if (!rawHeaders[0]) rawHeaders[0] = "id";
  const vistos = new Set<string>();
  const headers = rawHeaders.map((h, i) => {
    if (!h) return `__col${i}`;
    if (vistos.has(h)) return `__dup_${h}_${i}`;
    vistos.add(h);
    return h;
  });
  const rows: Record<string, string>[] = allRows
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? "").toString(); });
      return obj;
    })
    .filter((r) => get(r, "id"));

  return rows.map(mapearLinha).filter((r) => r.id);
}

export function mapearLinha(row: Record<string, string>) {
  const status = get(row, "STATUS");
  const converteuBruto = get(row, "CONVERTEU?");
  return {
    id: get(row, "id"),
    criado_em_lead: get(row, "created_time") || null,
    ad_id: get(row, "ad_id") || null,
    ad_name: get(row, "ad_name") || null,
    adset_id: get(row, "adset_id") || null,
    adset_name: get(row, "adset_name") || null,
    campaign_id: get(row, "campaign_id") || null,
    campaign_name: get(row, "campaign_name") || null,
    form_id: get(row, "form_id") || null,
    form_name: get(row, "form_name") || null,
    is_organic: get(row, "is_organic").toLowerCase() === "true",
    platform: get(row, "platform") || null,
    tipo_empresa: get(row, "qual_o_tipo_da_sua_empresa?") || null,
    qtd_linhas: get(row, "qual_a_quantidade_de_linhas?") || null,
    cnpj: get(row, "qual_o_seu_cnpj?") || null,
    email: get(row, "email") || null,
    full_name: get(row, "full_name") || null,
    city: get(row, "city") || null,
    state: get(row, "state") || null,
    phone_number: get(row, "phone_number") || null,
    lead_status: get(row, "lead_status") || null,
    consultor: get(row, "CONSULTOR") || null,
    status: status || null,
    categoria: categoriaDoStatus(status),
    obs: get(row, "OBS") || null,
    converteu: calcConverteu(status, converteuBruto),
    receita: parseReceita(get(row, "RECEITA")),
    atualizado_em: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401, corsHeaders);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401, corsHeaders);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (profileErr || !callerProfile) {
      return json({ error: "Perfil do solicitante não encontrado." }, 403, corsHeaders);
    }
    if (callerProfile.role !== "admin" && callerProfile.role !== "supervisor") {
      return json({ error: "Você não tem permissão para sincronizar os leads." }, 403, corsHeaders);
    }

    // 09/09/2026: busca cada aba (um mês cada) separadamente pelo GID e consolida tudo — ver
    // comentário junto de SHEET_TABS acima (e por que é por gid, não por nome). Se uma aba
    // específica falhar (HTTP ou cabeçalho não encontrado), a sincronização inteira é abortada com
    // uma mensagem identificando qual aba deu problema, em vez de gravar um total parcial
    // silenciosamente.
    //
    // A detecção de cabeçalho tolerante a linha extra na frente (parseSheetCsv, acima) continua
    // valendo pra cada aba individualmente — mesmo fix do bug de 04/09/2026 (ver REGRAS_NEGOCIO.md
    // seção 16.1 / seção do dashboard Digital), que também protege contra o "id" da 1ª coluna sem
    // rótulo e/ou duplicado numa coluna vazia no fim.
    let registros: ReturnType<typeof mapearLinha>[] = [];
    for (const tab of SHEET_TABS) {
      const resp = await fetch(sheetTabCsvUrl(tab.gid));
      if (!resp.ok) {
        return json(
          {
            error: `Não foi possível acessar a aba "${tab.label}" da planilha (HTTP ${resp.status}). Verifique se ela continua compartilhada como "qualquer pessoa com o link pode ver" e se o gid (${tab.gid}) ainda é válido.`,
          },
          502,
          corsHeaders,
        );
      }
      const csvText = await resp.text();
      try {
        registros = registros.concat(parseSheetCsv(csvText, tab.label));
      } catch (e) {
        return json({ error: (e as Error).message }, 502, corsHeaders);
      }
    }
    if (registros.length === 0) {
      return json({ error: "A planilha não retornou nenhuma linha válida (sem coluna 'id') em nenhuma das abas." }, 502, corsHeaders);
    }

    // de-duplica por id antes de gravar — um upsert com o mesmo id repetido no mesmo lote quebra
    // com erro do Postgres ("ON CONFLICT DO UPDATE command cannot affect row a second time"); em
    // caso de duplicata mantém a última ocorrência (linha mais recente na planilha).
    const porId = new Map<string, ReturnType<typeof mapearLinha>>();
    for (const r of registros) porId.set(r.id, r);
    const registrosUnicos = Array.from(porId.values());

    // upsert em lotes de 500 (mesmo padrão usado no upload da base de clientes e de produção)
    for (let i = 0; i < registrosUnicos.length; i += 500) {
      const lote = registrosUnicos.slice(i, i + 500);
      const { error: upsertErr } = await admin.from("leads").upsert(lote, { onConflict: "id" });
      if (upsertErr) {
        console.error("Erro ao gravar leads:", upsertErr);
        return json({ error: "Erro ao gravar leads: " + upsertErr.message }, 500, corsHeaders);
      }
    }

    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await admin.from("config").upsert({ chave: "leads_atualizado_em", valor: agora }, { onConflict: "chave" });

    return json({ ok: true, total: registrosUnicos.length, atualizado_em: agora }, 200, corsHeaders);
  } catch (e) {
    console.error("Erro inesperado em sync-leads:", e);
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
