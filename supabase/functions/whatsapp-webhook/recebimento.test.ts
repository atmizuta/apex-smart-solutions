import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { assinaturaValida, lerPayload, verificacao } from "./recebimento.ts";

const SEGREDO = "zz-segredo-de-teste";
const assinar = (s: string) => "sha256=" + createHmac("sha256", SEGREDO).update(s).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);

test("assinatura: certa passa; errada, ausente ou sem segredo falha", async () => {
  const corpo = '{"a":"ação"}';
  assert.equal(await assinaturaValida(enc(corpo), assinar(corpo), SEGREDO), true);
  assert.equal(await assinaturaValida(enc(corpo), assinar(corpo).toUpperCase().replace("SHA256=", "sha256="), SEGREDO), true);
  assert.equal(await assinaturaValida(enc(corpo + " "), assinar(corpo), SEGREDO), false);
  assert.equal(await assinaturaValida(enc(corpo), null, SEGREDO), false);
  assert.equal(await assinaturaValida(enc(corpo), "sha256=abc", SEGREDO), false);
  assert.equal(await assinaturaValida(enc(corpo), assinar(corpo), ""), false);
});

test("verificação do webhook (GET)", () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  assert.equal(verificacao(q({ "hub.mode": "subscribe", "hub.verify_token": "t1", "hub.challenge": "123" }), "t1"), "123");
  assert.equal(verificacao(q({ "hub.mode": "subscribe", "hub.verify_token": "t2", "hub.challenge": "123" }), "t1"), null);
  assert.equal(verificacao(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), ""), null);
});

const mudanca = (field: string, value: unknown) => ({ object: "whatsapp_business_account", entry: [{ id: "0", changes: [{ field, value }] }] });

test("mensagens do cliente: texto, imagem com legenda, documento, áudio e tipo desconhecido", () => {
  const ev = lerPayload(mudanca("messages", {
    contacts: [{ wa_id: "550000000001", profile: { name: "Zz Perfil" } }],
    messages: [
      { from: "550000000001", id: "wamid.t1", timestamp: "1764000000", type: "text", text: { body: "Oi" } },
      { from: "550000000001", id: "wamid.i1", timestamp: "1764000001", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "fatura" } },
      { from: "550000000001", id: "wamid.d1", timestamp: "1764000002", type: "document", document: { id: "m2", mime_type: "application/pdf", filename: "conta.pdf" } },
      { from: "550000000001", id: "wamid.a1", timestamp: "1764000003", type: "audio", audio: { id: "m3", mime_type: "audio/ogg; codecs=opus" } },
      { from: "550000000001", id: "wamid.s1", timestamp: "1764000004", type: "sticker", sticker: { id: "m4" } },
      { from: "550000000001", id: "wamid.r1", timestamp: "1764000005", type: "reaction", reaction: { emoji: "👍" } },
    ],
  }));
  assert.equal(ev.length, 5, "reação é ignorada");
  assert.deepEqual(ev[0], { tipo: "cliente", wamid: "wamid.t1", telefone: "550000000001", nome_perfil: "Zz Perfil", em: "2025-11-24T16:00:00.000Z", formato: "texto", texto: "Oi", midia: null });
  assert.deepEqual([ev[1].formato, ev[1].texto, ev[1].midia], ["imagem", "fatura", { id: "m1", mime: "image/jpeg", nome: null }]);
  assert.deepEqual([ev[2].formato, ev[2].midia?.nome], ["documento", "conta.pdf"]);
  assert.deepEqual([ev[3].formato, ev[3].midia?.id], ["audio", "m3"]);
  assert.deepEqual([ev[4].formato, ev[4].midia], ["outro", null]);
});

test("eco do consultor (coexistência) usa o telefone de destino; status e payload estranho não viram evento", () => {
  const ev = lerPayload(mudanca("smb_message_echoes", {
    message_echoes: [{ from: "550000000099", to: "550000000001", id: "wamid.e1", timestamp: "1764000000", type: "text", text: { body: "Boa noite" } }],
  }));
  assert.deepEqual(ev.map((e) => [e.tipo, e.telefone, e.texto]), [["eco", "550000000001", "Boa noite"]]);
  assert.deepEqual(lerPayload(mudanca("messages", { statuses: [{ id: "wamid.x", status: "read" }] })), []);
  for (const lixo of [null, "x", 1, {}, { entry: "x" }, { entry: [{ changes: [null] }] }]) assert.deepEqual(lerPayload(lixo), []);
});
