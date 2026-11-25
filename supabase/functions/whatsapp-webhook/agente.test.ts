import { test } from "node:test";
import assert from "node:assert/strict";
import { atender, FERRAMENTAS, MODELO } from "./agente.ts";
import type { Contexto, DepsAgente, Msg, RespostaClaude, Salvar } from "./agente.ts";

const CNPJ = "11222333000181";
const msg = (id: string, autor: Msg["autor"], texto: string | null, o: Partial<Msg> = {}): Msg =>
  ({ id, autor, formato: "texto", texto, caminho: null, mime: null, ...o });
const texto = (t: string): RespostaClaude => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const ferramenta = (name: string, input: unknown, id = "tu1"): RespostaClaude =>
  ({ stop_reason: "tool_use", content: [{ type: "text", text: "" }, { type: "tool_use", id, name, input }] });

function montar(o: { ctx?: Partial<Contexto>; conversa?: Partial<Contexto["conversa"]>; roteiro?: (RespostaClaude | Error)[];
  expedienteNoEnvio?: boolean; ultima?: string | null; travar?: boolean; falharEnvio?: boolean } = {}) {
  const log = { pedidos: [] as Record<string, unknown>[], salvos: [] as Salvar[], enviados: [] as { texto: string; formato: string }[],
    avisos: [] as [string, unknown][], adiados: 0, avisouFalha: 0, liberou: 0, travou: 0 };
  const ctx: Contexto = {
    no_expediente: false, modo: "ligado", numeros_ensaio: [], max_respostas_noite: 40,
    agora_texto: "sábado, 22/11 22:40", proximo_expediente: "segunda-feira a partir das 14h",
    conversa: { id: "c1", telefone: "550000000001", estado: "em_andamento", ficha: {}, respostas_noite: 0, silenciosa: false, avisou_falha: false, ...o.conversa },
    lead: null,
    mensagens: [msg("w1", "cliente", "Oi, quero portar 2 linhas")],
    ...o.ctx,
  };
  const roteiro = [...(o.roteiro ?? [texto("Olá! Sou o assistente virtual da Apex.")])];
  const d: DepsAgente = {
    async contexto() { return ctx; },
    async travar() { log.travou++; return o.travar ?? true; },
    async liberar() { log.liberou++; },
    async adiar() { log.adiados++; },
    async avisouFalha() { log.avisouFalha++; },
    async claude(p) {
      log.pedidos.push(structuredClone(p));
      const r = roteiro.shift();
      if (!r) throw new Error("roteiro acabou");
      if (r instanceof Error) throw r;
      return r;
    },
    async midiaBase64(caminho) { return "QUJD-" + caminho; },
    async salvar(_c, s) { log.salvos.push(structuredClone(s)); },
    async situacaoCnpj() { return "ATIVA"; },
    async noExpediente() { return o.expedienteNoEnvio ?? false; },
    async ultimaDoCliente() { return o.ultima === undefined ? ctx.mensagens.filter((m) => m.autor === "cliente").at(-1)?.id ?? null : o.ultima; },
    async enviar(_t, t) { if (o.falharEnvio) throw new Error("graph HTTP 400"); log.enviados.push({ texto: t, formato: "" }); return "wamid.out" + log.enviados.length; },
    async registrarEnvio(_c, _w, t, formato) { const e = log.enviados.find((x) => x.texto === t && !x.formato); if (e) e.formato = formato; },
    async aviso(chave, valor) { log.avisos.push([chave, valor]); },
    ms: () => 0,
    log: () => {},
  };
  return { d, log, ctx };
}

test("pedido: modelo, fallback, esforço, ferramentas e estado no fim", async () => {
  const { d, log } = montar();
  assert.equal(await atender("c1", d), "respondeu");
  const p = log.pedidos[0] as Record<string, any>;
  assert.equal(p.model, MODELO);
  assert.equal(MODELO, "claude-opus-5-5");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.output_config, { effort: "medium" });
  assert.equal(p.thinking, undefined);
  assert.equal(p.tool_choice, undefined);
  assert.deepEqual(p.tools.map((t: { name: string }) => t.name), FERRAMENTAS.map((t) => t.name));
  assert.deepEqual(p.tools.map((t: { name: string }) => t.name), ["salvar_ficha", "guardar_documento", "pedir_humano", "ficha_completa"]);
  assert.equal(p.messages[0].role, "user");
  assert.equal(p.messages.at(-1).role, "system");
  assert.match(p.messages.at(-1).content, /segunda-feira a partir das 14h/);
  assert.match(p.messages.at(-1).content, /primeira resposta da noite/);
  assert.deepEqual(log.enviados, [{ texto: "Olá! Sou o assistente virtual da Apex.", formato: "texto" }]);
  assert.equal(log.liberou, 1);
});

test("não responde: expediente, desligado, fora do ensaio, silêncio, última não é do cliente, travada", async () => {
  const casos: [Parameters<typeof montar>[0], string][] = [
    [{ ctx: { no_expediente: true } }, "expediente"],
    [{ ctx: { modo: "desligado" } }, "desligado"],
    [{ ctx: { modo: "ensaio", numeros_ensaio: ["5511999999999"] } }, "fora_do_ensaio"],
    [{ conversa: { silenciosa: true } }, "silencio"],
    [{ ctx: { mensagens: [msg("w1", "cliente", "Oi"), msg("w2", "consultor", "Já te respondo")] } }, "sem_mensagem_nova"],
    [{ travar: false }, "travada"],
  ];
  for (const [o, esperado] of casos) {
    const { d, log } = montar(o);
    assert.equal(await atender("c1", d), esperado, esperado);
    assert.equal(log.pedidos.length + log.enviados.length, 0, esperado);
  }
});

test("ensaio: número da lista responde mesmo sem o nono dígito", async () => {
  const { d } = montar({ ctx: { modo: "ensaio", numeros_ensaio: ["+55 (00) 90000-0001"] }, conversa: { telefone: "550000000001" } });
  assert.equal(await atender("c1", d), "respondeu");
});

test("rajada: se chegou mensagem mais nova, quem esperava a antiga não responde", async () => {
  const { d, log } = montar({ ctx: { mensagens: [msg("w1", "cliente", "Oi"), msg("w2", "cliente", "tudo bem?")] } });
  assert.equal(await atender("c1", d, "w1"), "nova_mensagem");
  assert.equal(log.travou, 0);
});

test("mensagem nova durante a resposta: não envia", async () => {
  const { d, log } = montar({ ultima: "w9" });
  assert.equal(await atender("c1", d), "nova_mensagem");
  assert.equal(log.enviados.length, 0);
});

test("expediente abriu enquanto pensava: não envia (consultor assume)", async () => {
  const { d, log } = montar({ expedienteNoEnvio: true });
  assert.equal(await atender("c1", d), "nao_enviou");
  assert.equal(log.enviados.length, 0);
});

test("salvar_ficha: grava, consulta CNPJ e devolve o que falta num único tool_result", async () => {
  const { d, log } = montar({ roteiro: [ferramenta("salvar_ficha", { campos: { nome: "Zz Teste Silva", cnpj: CNPJ } }), texto("Anotei! Qual o CPF?")] });
  assert.equal(await atender("c1", d), "respondeu");
  assert.equal(log.salvos[0].ficha?.cnpj, CNPJ);
  assert.equal(log.salvos[0].ficha?.cnpj_situacao, "ATIVA");
  const segundo = log.pedidos[1] as Record<string, any>;
  const ultimo = segundo.messages.at(-1);
  assert.equal(ultimo.role, "user");
  assert.equal(ultimo.content.length, 1);
  assert.equal(ultimo.content[0].type, "tool_result");
  assert.equal(ultimo.content[0].tool_use_id, "tu1");
  assert.match(ultimo.content[0].content, /Guardado\. Ainda falta: CPF; tipo de serviço/);
  assert.equal(ultimo.content[0].is_error, undefined);
  assert.equal(segundo.messages.at(-2).role, "assistant");
});

test("salvar_ficha com CNPJ inválido: is_error e não grava o CNPJ", async () => {
  const { d, log } = montar({ roteiro: [ferramenta("salvar_ficha", { campos: { cnpj: "11222333000182" } }), texto("Pode conferir o CNPJ?")] });
  await atender("c1", d);
  const tr = (log.pedidos[1] as Record<string, any>).messages.at(-1).content[0];
  assert.equal(tr.is_error, true);
  assert.match(tr.content, /cnpj: inválido/);
  assert.equal(log.salvos[0].ficha?.cnpj, undefined);
});

test("ficha_completa: recusa se falta algo; marca pronto quando completa", async () => {
  const a = montar({ roteiro: [ferramenta("ficha_completa", {}), texto("Falta o CPF.")] });
  await atender("c1", a.d);
  assert.equal((a.log.pedidos[1] as Record<string, any>).messages.at(-1).content[0].is_error, true);
  assert.equal(a.log.salvos.length, 0);
  const completa = { nome: "Zz Teste", cpf: "52998224725", cnpj: CNPJ, servicos: ["outro" as const], outro: "Zz quer TV" };
  const b = montar({ conversa: { ficha: completa }, roteiro: [ferramenta("ficha_completa", {}), texto("Prontinho!")] });
  assert.equal(await atender("c1", b.d), "respondeu");
  assert.deepEqual(b.log.salvos, [{ estado: "pronto" }]);
});

test("guardar_documento: só foto/PDF desta conversa", async () => {
  const mensagens = [msg("w1", "cliente", "segue"), msg("w2", "cliente", null, { formato: "imagem", caminho: "m/w2.jpg", mime: "image/jpeg" })];
  const a = montar({ ctx: { mensagens }, roteiro: [ferramenta("guardar_documento", { mensagem_id: "w1", tipo: "fatura" }), texto("Pode mandar a foto?")] });
  await atender("c1", a.d);
  assert.equal((a.log.pedidos[1] as Record<string, any>).messages.at(-1).content[0].is_error, true);
  const b = montar({ ctx: { mensagens }, roteiro: [ferramenta("guardar_documento", { mensagem_id: "w2", tipo: "fatura" }), texto("Recebi a fatura.")] });
  await atender("c1", b.d);
  assert.deepEqual(b.log.salvos[0].ficha?.documentos, [{ mensagem_id: "w2", tipo: "fatura" }]);
});

test("mídia do lote vai como imagem/PDF com o mensagem_id; áudio vira aviso em texto", async () => {
  const mensagens = [
    msg("w0", "cliente", "oi"), msg("w0b", "agente", "Olá!"),
    msg("w1", "cliente", "fatura", { formato: "imagem", caminho: "m/w1.jpg", mime: "image/jpeg" }),
    msg("w2", "cliente", null, { formato: "documento", caminho: "m/w2.pdf", mime: "application/pdf" }),
    msg("w3", "cliente", null, { formato: "audio", caminho: "m/w3.ogg", mime: "audio/ogg" }),
  ];
  const { d, log } = montar({ ctx: { mensagens } });
  await atender("c1", d);
  const conteudos = (log.pedidos[0] as Record<string, any>).messages.flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content : []);
  assert.ok(conteudos.some((c: any) => c.type === "image" && c.source.data === "QUJD-m/w1.jpg" && c.source.media_type === "image/jpeg"));
  assert.ok(conteudos.some((c: any) => c.type === "document" && c.source.media_type === "application/pdf"));
  assert.ok(conteudos.some((c: any) => c.type === "text" && /mensagem_id=w1\]/.test(c.text) && /Legenda: fatura/.test(c.text)));
  assert.ok(conteudos.some((c: any) => c.type === "text" && /áudio/.test(c.text)));
});

test("pedir_humano: salva motivo e manda o aviso escrito pelo modelo", async () => {
  const { d, log } = montar({ roteiro: [ferramenta("pedir_humano", { motivo: "quer cancelar" }), texto("Anotei, um consultor fala com você segunda-feira a partir das 14h.")] });
  assert.equal(await atender("c1", d), "respondeu");
  assert.deepEqual(log.salvos, [{ estado: "precisa_humano", motivo: "quer cancelar" }]);
});

test("recusa: precisa de humano + mensagem fixa com o próximo atendimento", async () => {
  const { d, log } = montar({ roteiro: [{ stop_reason: "refusal", content: [] }] });
  assert.equal(await atender("c1", d), "recusa");
  assert.equal(log.salvos[0].estado, "precisa_humano");
  assert.match(log.enviados[0].texto, /segunda-feira a partir das 14h/);
});

test("Claude falha 2 vezes: aviso na Equipe, adia, avisa o cliente uma vez só por noite", async () => {
  const a = montar({ roteiro: [new Error("529"), new Error("529")] });
  assert.equal(await atender("c1", a.d), "falha");
  assert.deepEqual(a.log.avisos.map((x) => x[0]), ["wa_erro"]);
  assert.ok(a.log.adiados >= 1);
  assert.equal(a.log.enviados.length, 1);
  assert.equal(a.log.enviados[0].formato, "aviso");
  assert.equal(a.log.avisouFalha, 1);
  assert.equal(a.log.liberou, 1);
  const b = montar({ conversa: { avisou_falha: true }, roteiro: [new Error("529"), new Error("529")] });
  assert.equal(await atender("c1", b.d), "falha");
  assert.equal(b.log.enviados.length, 0);
});

test("Claude falha 1 vez e acerta na 2ª: responde normal", async () => {
  const { d, log } = montar({ roteiro: [new Error("timeout"), texto("Olá!")] });
  assert.equal(await atender("c1", d), "respondeu");
  assert.equal(log.avisos.length, 0);
});

test("envio da Meta falha: aviso de envio e adia", async () => {
  const { d, log } = montar({ falharEnvio: true });
  assert.equal(await atender("c1", d), "nao_enviou");
  assert.deepEqual(log.avisos.map((x) => (x[1] as { erro: string }).erro), ["envio"]);
  assert.equal(log.adiados, 1);
});

test("limite de respostas da noite: passa para humano sem chamar o Claude", async () => {
  const { d, log } = montar({ conversa: { respostas_noite: 40 } });
  assert.equal(await atender("c1", d), "limite");
  assert.equal(log.pedidos.length, 0);
  assert.equal(log.salvos[0].estado, "precisa_humano");
  assert.match(log.enviados[0].texto, /segunda-feira a partir das 14h/);
});

test("voltas demais: falha em vez de laço infinito", async () => {
  const roteiro = Array.from({ length: 10 }, (_, i) => ferramenta("ficha_completa", {}, "tu" + i));
  const { d, log } = montar({ roteiro });
  assert.equal(await atender("c1", d), "falha");
  assert.equal(log.pedidos.length, 5);
});

test("resposta só com ferramenta e sem texto: não envia e adia", async () => {
  const { d, log } = montar({ roteiro: [{ stop_reason: "end_turn", content: [{ type: "text", text: "  " }] }] });
  assert.equal(await atender("c1", d), "sem_texto");
  assert.equal(log.adiados, 1);
});
