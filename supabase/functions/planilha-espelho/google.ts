// Conta de serviço do Google (JWT RS256 via WebCrypto) + cliente mínimo da Sheets API v4 (§112).
// Nada aqui loga ou devolve a chave privada; erros do Google levam só status e o início da resposta.
import type { Guia } from "./planilha.ts";

export type ContaServico = { client_email: string; private_key: string };
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type Sheets = {
  guias(): Promise<Guia[]>;
  ler(titulo: string): Promise<string[][]>;
  escrever(dados: { range: string; values: string[][] }[]): Promise<void>;
  acrescentar(titulo: string, linhas: string[][]): Promise<void>;
};

const ESCOPO = "https://www.googleapis.com/auth/spreadsheets";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

function b64url(dados: Uint8Array | string): string {
  const bytes = typeof dados === "string" ? new TextEncoder().encode(dados) : dados;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemParaDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function assinarJwt(sa: ContaServico, agoraSeg: number): Promise<string> {
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: ESCOPO, aud: URL_TOKEN, iat: agoraSeg, exp: agoraSeg + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", pemParaDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(`${cab}.${claims}`)));
  return `${cab}.${claims}.${b64url(assinatura)}`;
}

export async function obterToken(sa: ContaServico, agoraSeg: number, f: FetchFn): Promise<string> {
  const jwt = await assinarJwt(sa, agoraSeg);
  const corpo = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString();
  const r = await f(URL_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo });
  const txt = await r.text();
  if (!r.ok) throw new Error(`token do Google: ${r.status} ${txt.slice(0, 120)}`);
  const tok = JSON.parse(txt).access_token;
  if (!tok) throw new Error("token do Google: resposta sem access_token");
  return tok;
}

function intervalo(titulo: string): string { return `'${titulo.replace(/'/g, "''")}'`; }

export function criarSheets(token: string, sheetId: string, f: FetchFn): Sheets {
  const auth = { Authorization: `Bearer ${token}` };
  const chamar = async (url: string, init?: RequestInit) => {
    const r = await f(url, { ...init, headers: { ...auth, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${txt.slice(0, 200)}`);
    return txt ? JSON.parse(txt) : {};
  };
  return {
    async guias() {
      const j = await chamar(`${API}/${sheetId}?fields=${encodeURIComponent("sheets.properties(title,index)")}`);
      return (j.sheets ?? []).map((s: { properties: { title: string; index: number } }) => ({ titulo: s.properties.title, indice: s.properties.index }));
    },
    async ler(titulo) {
      const j = await chamar(`${API}/${sheetId}/values/${encodeURI(intervalo(titulo))}?valueRenderOption=FORMATTED_VALUE`);
      return (j.values ?? []) as string[][];
    },
    async escrever(dados) {
      if (!dados.length) return;
      await chamar(`${API}/${sheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: dados }) });
    },
    async acrescentar(titulo, linhas) {
      if (!linhas.length) return;
      await chamar(`${API}/${sheetId}/values/${encodeURI(intervalo(titulo) + "!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: linhas }) });
    },
  };
}
