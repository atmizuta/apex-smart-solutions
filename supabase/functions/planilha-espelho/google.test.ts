import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarJwt, obterToken, criarSheets } from "./google.ts";

async function chaveFalsa() {
  const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return { par, pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` };
}
const b64urlDec = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

test("JWT RS256 com claims do Google e assinatura válida", async () => {
  const { par, pem } = await chaveFalsa();
  const jwt = await assinarJwt({ client_email: "zz@zz.iam.gserviceaccount.com", private_key: pem }, 1000);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(b64urlDec(h).toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(b64urlDec(c).toString());
  assert.deepEqual(claims, { iss: "zz@zz.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", par.publicKey, b64urlDec(s), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true);
});

test("obterToken troca o JWT por access_token", async () => {
  const { pem } = await chaveFalsa();
  let corpo = "";
  const f = async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    corpo = String(init?.body);
    return new Response(JSON.stringify({ access_token: "tok-zz" }), { status: 200 });
  };
  assert.equal(await obterToken({ client_email: "zz@zz", private_key: pem }, 1000, f), "tok-zz");
  assert.match(corpo, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
});

test("obterToken com erro do Google lança sem vazar a chave", async () => {
  const { pem } = await chaveFalsa();
  const f = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
  await assert.rejects(obterToken({ client_email: "zz@zz", private_key: pem }, 1000, f), (e: Error) => /token do Google: 400/.test(e.message) && !e.message.includes("PRIVATE"));
});

test("cliente do Sheets monta as URLs e corpos certos", async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes("?fields=")) return new Response(JSON.stringify({ sheets: [{ properties: { title: "ZZ - OUTUBRO", index: 0 } }] }), { status: 200 });
    if (url.includes("/values/") && !init?.method) return new Response(JSON.stringify({ values: [["a", "b"]] }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const s = criarSheets("tok", "SID", f);
  assert.deepEqual(await s.guias(), [{ titulo: "ZZ - OUTUBRO", indice: 0 }]);
  assert.deepEqual(await s.ler("ZZ - OUTUBRO"), [["a", "b"]]);
  await s.escrever([{ range: "'ZZ'!A2", values: [["x"]] }]);
  await s.acrescentar("ZZ - OUTUBRO", [["l:1", "x"]]);
  assert.equal(chamadas[0].url, "https://sheets.googleapis.com/v4/spreadsheets/SID?fields=sheets.properties(title%2Cindex)");
  assert.equal(chamadas[1].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values/'ZZ%20-%20OUTUBRO'?valueRenderOption=FORMATTED_VALUE");
  assert.equal(chamadas[2].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values:batchUpdate");
  assert.deepEqual(JSON.parse(String(chamadas[2].init?.body)), { valueInputOption: "RAW", data: [{ range: "'ZZ'!A2", values: [["x"]] }] });
  assert.equal(chamadas[3].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values/'ZZ%20-%20OUTUBRO'!A1:append?valueInputOption=RAW&insertDataOption=OVERWRITE");   // não empurra linhas (revisão final)
  assert.equal((chamadas[3].init?.headers as Record<string, string>).Authorization, "Bearer tok");
});

test("escrever vazio não chama a API", async () => {
  let n = 0;
  const s = criarSheets("tok", "SID", async () => { n++; return new Response("{}"); });
  await s.escrever([]);
  await s.acrescentar("X", []);
  assert.equal(n, 0);
});
