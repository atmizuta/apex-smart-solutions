// §167: entrada do webhook da Meta (Cloud API, coexistência). Confere X-Hub-Signature-256 (HMAC-SHA256 do corpo cru
// com a chave do app) e transforma o payload em eventos simples. Sem rede: testado com node --test.
import { soDigitos } from "./telefone.ts";

export type Formato = "texto" | "imagem" | "documento" | "audio" | "outro";
export type Evento = {
  tipo: "cliente" | "eco"; wamid: string; telefone: string; nome_perfil: string | null; em: string;
  formato: Formato; texto: string | null; midia: { id: string; mime: string; nome: string | null } | null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const FORMATOS: Record<string, Formato> = { text: "texto", image: "imagem", document: "documento", audio: "audio" };
const IGNORAR = ["reaction", "system", "unsupported", "request_welcome"];

export async function assinaturaValida(corpo: Uint8Array, cabecalho: string | null, segredo: string): Promise<boolean> {
  const m = /^sha256=([0-9a-f]{64})$/.exec((cabecalho ?? "").trim().toLowerCase());
  if (!m || !segredo) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = hex(await crypto.subtle.sign("HMAC", chave, corpo));
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperado.charCodeAt(i) ^ m[1].charCodeAt(i);   // comparação em tempo constante
  return dif === 0;
}

export function verificacao(q: URLSearchParams, token: string): string | null {
  return token && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token ? q.get("hub.challenge") : null;
}

function evento(m: Record<string, unknown>, tipo: Evento["tipo"], telefone: unknown, nome: string | null): Evento | null {
  const t = String(m.type ?? "");
  if (!m.id || IGNORAR.includes(t) || !soDigitos(telefone)) return null;
  const formato = FORMATOS[t] ?? "outro";
  const md = obj(m[t]);
  const midia = formato !== "texto" && formato !== "outro" && md.id
    ? { id: String(md.id), mime: String(md.mime_type ?? ""), nome: md.filename ? String(md.filename) : null } : null;
  const texto = formato === "texto" ? String(obj(m.text).body ?? "") : (md.caption ? String(md.caption) : null);
  const ts = Number(m.timestamp);
  return {
    tipo, wamid: String(m.id), telefone: soDigitos(telefone), nome_perfil: nome,
    em: new Date((Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now())).toISOString(), formato, texto, midia,
  };
}

export function lerPayload(corpo: unknown): Evento[] {
  const out: Evento[] = [];
  for (const e of arr(obj(corpo).entry)) {
    for (const c of arr(obj(e).changes)) {
      const ch = obj(c), v = obj(ch.value);
      if (ch.field === "messages") {
        const nomes = new Map(arr(v.contacts).map((x) => [soDigitos(obj(x).wa_id), String(obj(obj(x).profile).name ?? "") || null]));
        for (const m of arr(v.messages)) {
          const o = obj(m);
          const ev = evento(o, "cliente", o.from, nomes.get(soDigitos(o.from)) ?? null);
          if (ev) out.push(ev);
        }
      } else if (ch.field === "smb_message_echoes") {
        for (const m of arr(v.message_echoes)) {
          const o = obj(m);
          const ev = evento(o, "eco", o.to, null);
          if (ev) out.push(ev);
        }
      }
    }
  }
  return out;
}
