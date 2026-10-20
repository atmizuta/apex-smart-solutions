// PNG do comparativo: monta o MESMO cartão da prévia numa área fora da tela e o
// converte em imagem (html-to-image). Só no navegador. Montar sob demanda, em vez
// de depender de um nó visível, faz a imagem sair igual para a proposta em
// andamento e para uma proposta salva.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { toBlob } from "html-to-image";
import { ComparativoCartao } from "@/components/documento/comparativo-cartao";
import type { ModeloDocumento } from "@/lib/proposta/modelo-documento";

async function esperarImagens(raiz: HTMLElement): Promise<void> {
  const imagens = Array.from(raiz.querySelectorAll("img"));
  await Promise.all(
    imagens.map((imagem) => (imagem.complete ? Promise.resolve() : imagem.decode().catch(() => undefined)))
  );
}

export async function gerarPng(modelo: ModeloDocumento): Promise<Blob> {
  const area = document.createElement("div");
  area.style.cssText = "position:fixed;left:-10000px;top:0;width:1080px;pointer-events:none;";
  document.body.appendChild(area);
  const raiz = createRoot(area);
  try {
    flushSync(() => raiz.render(createElement(ComparativoCartao, { modelo })));
    const cartao = area.firstElementChild as HTMLElement | null;
    if (!cartao) throw new Error("Não foi possível montar a imagem");
    await esperarImagens(cartao);
    // skipFonts: o cartão usa só fontes do sistema (Arial); sem isso o html-to-image
    // tenta ler o CSS das fontes web da página (bloqueado por CORS) e polui o console.
    const blob = await toBlob(cartao, {
      pixelRatio: 2,
      cacheBust: true,
      skipFonts: true,
      backgroundColor: "#ffffff",
    });
    if (!blob) throw new Error("Não foi possível gerar a imagem");
    return blob;
  } finally {
    raiz.unmount();
    area.remove();
  }
}
