import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirAlerta, enviarTelegram, executarAlerta, montarMensagem } from "./alerta.ts";
import type { AlertaAberto, DepsAlerta } from "./alerta.ts";

const HORA = 3_600_000;
const AGORA = new Date("2026-09-30T18:00:00Z"); // 15:00 SP
const ha = (h: number) => new Date(AGORA.getTime() - h * HORA);

// ---------------------------------------------------------------- decidirAlerta (regra pura)
test("decidirAlerta: sincronização recente e nenhum alerta aberto → nada", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: ha(1), alertaAberto: false, limiteHoras: 3 }), "nada");
});
test("decidirAlerta: passou do limite sem alerta aberto → abrir", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: ha(3.5), alertaAberto: false, limiteHoras: 3 }), "abrir");
});
test("decidirAlerta: exatamente no limite ainda não alerta (só passando dele)", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: ha(3), alertaAberto: false, limiteHoras: 3 }), "nada");
});
test("decidirAlerta: continua parado com alerta já aberto → nada (sem repetir)", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: ha(8), alertaAberto: true, limiteHoras: 3 }), "nada");
});
test("decidirAlerta: voltou a sincronizar com alerta aberto → resolver", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: ha(0.2), alertaAberto: true, limiteHoras: 3 }), "resolver");
});
test("decidirAlerta: nenhuma sincronização bem-sucedida registrada conta como parado", () => {
  assert.equal(decidirAlerta({ agora: AGORA, ultimoOkEm: null, alertaAberto: false, limiteHoras: 3 }), "abrir");
});

// ---------------------------------------------------------------- montarMensagem
test("montarMensagem (abertura): traz o tempo parado, a última sincronização e o erro", () => {
  const m = montarMensagem("abertura", { agora: AGORA, ultimoOkEm: ha(4.2), ultimoErro: "NeoSales recusou a consulta: Token Estrutura Inválido" });
  assert.match(m, /parada/i);
  assert.match(m, /4 h/);
  assert.match(m, /Token Estrutura Inválido/);
  assert.match(m, /30\/09/); // data da última sincronização
});
test("montarMensagem (abertura): sem nenhuma sincronização ok, diz isso em vez de inventar horário", () => {
  const m = montarMensagem("abertura", { agora: AGORA, ultimoOkEm: null, ultimoErro: null });
  assert.match(m, /nenhuma sincronização bem-sucedida/i);
});
test("montarMensagem (resolução): avisa que voltou ao normal", () => {
  const m = montarMensagem("resolucao", { agora: AGORA, ultimoOkEm: ha(0.1), ultimoErro: null, horasParado: 5.5 });
  assert.match(m, /voltou ao normal/i);
  assert.match(m, /5[,.]5 h|6 h/);
});

// ---------------------------------------------------------------- enviarTelegram
test("enviarTelegram: chama a API do Telegram com o chat e o texto, sem parse_mode", async () => {
  let visto: { url?: string; body?: Record<string, unknown> } = {};
  const fetchImpl = (url: string, init?: RequestInit) => {
    visto = { url, body: JSON.parse(String(init!.body)) };
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  };
  await enviarTelegram({ token: "123:ABC", chatId: "999" }, "olá <b>x</b>", fetchImpl as unknown as typeof fetch);
  assert.equal(visto.url, "https://api.telegram.org/bot123:ABC/sendMessage");
  assert.deepEqual(visto.body, { chat_id: "999", text: "olá <b>x</b>" });
});
test("enviarTelegram: erro do Telegram vira exceção e o token NUNCA aparece na mensagem", async () => {
  const fetchImpl = () => Promise.resolve(new Response('{"ok":false,"description":"chat not found"}', { status: 400 }));
  await assert.rejects(
    enviarTelegram({ token: "123:SEGREDO", chatId: "999" }, "x", fetchImpl as unknown as typeof fetch),
    (e: Error) => /chat not found/.test(e.message) && !e.message.includes("SEGREDO"),
  );
});
test("enviarTelegram: falha de rede não vaza o token", async () => {
  const fetchImpl = () => Promise.reject(new TypeError("fetch failed https://api.telegram.org/bot123:SEGREDO/sendMessage"));
  await assert.rejects(
    enviarTelegram({ token: "123:SEGREDO", chatId: "999" }, "x", fetchImpl as unknown as typeof fetch),
    (e: Error) => !e.message.includes("SEGREDO"),
  );
});

// ---------------------------------------------------------------- executarAlerta (orquestração)
function criar(o: {
  ultimoOkEm?: Date | null; aberto?: AlertaAberto | null; canal?: boolean; erroEnvio?: boolean; ultimoErro?: string | null;
} = {}) {
  const reg = { abertos: 0, resolvidos: [] as number[], marcados: [] as string[], msgs: [] as string[] };
  let aberto: AlertaAberto | null = o.aberto ?? null;
  const deps: DepsAlerta = {
    agora: () => AGORA,
    ultimoOkEm: () => Promise.resolve(o.ultimoOkEm === undefined ? ha(0.5) : o.ultimoOkEm),
    ultimoErro: () => Promise.resolve(o.ultimoErro ?? null),
    alertaAberto: () => Promise.resolve(aberto),
    abrirAlerta: (info) => {
      reg.abertos++;
      aberto = { id: 77, abertoEm: AGORA, notificadoAbertura: false };
      void info;
      return Promise.resolve(77);
    },
    resolverAlerta: (id) => { reg.resolvidos.push(id); aberto = null; return Promise.resolve(); },
    marcarNotificado: (id, tipo) => { reg.marcados.push(`${id}:${tipo}`); if (aberto && tipo === "abertura") aberto.notificadoAbertura = true; return Promise.resolve(); },
    notificar: (texto) => {
      if (o.erroEnvio) return Promise.reject(new Error("telegram fora do ar"));
      if (o.canal === false) return Promise.resolve(false);
      reg.msgs.push(texto);
      return Promise.resolve(true);
    },
  };
  return { deps, reg };
}
const limite = { limiteHoras: 3 };

test("executarAlerta: tudo bem → não abre, não notifica", async () => {
  const { deps, reg } = criar();
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "nada");
  assert.equal(reg.abertos, 0);
  assert.equal(reg.msgs.length, 0);
});
test("executarAlerta: parado além do limite → abre 1 alerta e notifica 1 vez", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(4), ultimoErro: "Token Estrutura Inválido" });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "abrir");
  assert.equal(reg.abertos, 1);
  assert.equal(reg.msgs.length, 1);
  assert.match(reg.msgs[0], /Token Estrutura Inválido/);
  assert.deepEqual(reg.marcados, ["77:abertura"]);
});
test("executarAlerta: alerta já aberto e notificado → silêncio (não repete a cada 15 min)", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(9), aberto: { id: 5, abertoEm: ha(6), notificadoAbertura: true } });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "nada");
  assert.equal(reg.msgs.length, 0);
  assert.equal(reg.abertos, 0);
});
test("executarAlerta: voltou → resolve e avisa a recuperação", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(0.1), aberto: { id: 5, abertoEm: ha(5), notificadoAbertura: true } });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "resolver");
  assert.deepEqual(reg.resolvidos, [5]);
  assert.equal(reg.msgs.length, 1);
  assert.match(reg.msgs[0], /voltou ao normal/i);
});
test("executarAlerta: voltou, mas ninguém chegou a ser avisado do problema → resolve sem mensagem de recuperação", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(0.1), aberto: { id: 5, abertoEm: ha(5), notificadoAbertura: false } });
  await executarAlerta(deps, limite);
  assert.deepEqual(reg.resolvidos, [5]);
  assert.equal(reg.msgs.length, 0);
});
test("executarAlerta: sem canal configurado → abre o alerta, não quebra e não marca como notificado", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(4), canal: false });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "abrir");
  assert.equal(r.notificado, false);
  assert.equal(reg.abertos, 1);
  assert.deepEqual(reg.marcados, []);
});
test("executarAlerta: canal configurado DEPOIS de o alerta abrir → a próxima execução envia o aviso pendente", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(9), aberto: { id: 5, abertoEm: ha(6), notificadoAbertura: false } });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "nada");
  assert.equal(r.notificado, true);
  assert.equal(reg.msgs.length, 1);
  assert.deepEqual(reg.marcados, ["5:abertura"]);
});
test("executarAlerta: falha ao enviar não derruba a execução; o alerta fica aberto para tentar de novo", async () => {
  const { deps, reg } = criar({ ultimoOkEm: ha(4), erroEnvio: true });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "abrir");
  assert.equal(r.notificado, false);
  assert.match(r.erroEnvio ?? "", /telegram fora do ar/);
  assert.equal(reg.abertos, 1);
  assert.deepEqual(reg.marcados, []);
});
test("executarAlerta: nenhuma sincronização bem-sucedida registrada → alerta", async () => {
  const { deps, reg } = criar({ ultimoOkEm: null });
  const r = await executarAlerta(deps, limite);
  assert.equal(r.acao, "abrir");
  assert.match(reg.msgs[0], /nenhuma sincronização bem-sucedida/i);
});
