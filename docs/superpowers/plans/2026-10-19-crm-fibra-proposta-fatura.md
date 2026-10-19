# CRM Fibra — Proposta com fatura, comparativo e exportação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a aba Proposta do CRM Fibra no gerador do painel: ler a fatura Claro em PDF (ou digitar), sugerir o plano de cada linha pelo consumo, comparar situação atual × nova proposta e exportar Word, PDF consultor, PDF cliente e PNG, com envio por WhatsApp.

**Architecture:** Tudo que toca a fatura e os arquivos roda no navegador (`pdfjs-dist`, `jspdf`, `docx`, `html-to-image`, carregados sob demanda); o servidor só guarda a proposta (itens + situação atual já mascarada). A lógica fica em funções puras testadas em Node (leitor, média, sugestão, agrupamento, modelo do documento); os desenhistas de arquivo são finos e recebem o modelo pronto.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Tailwind 3 + shadcn/ui, Supabase JS (schema `crm_fibra`), Vitest (ambiente node), `pdfjs-dist`, `jspdf` + `jspdf-autotable`, `docx`, `html-to-image`.

**Spec:** `docs/superpowers/specs/2026-10-19-crm-fibra-proposta-fatura-design.md`

## Global Constraints

Todo comando roda a partir de `crm-fibra/` (o worktree é `.worktrees/crm-fibra-proposta-fatura`). Cada tarefa abaixo herda esta lista.

- **Dependências novas, versões exatas** (`--save-exact`, todas com mais de duas semanas de publicadas): `pdfjs-dist@6.3.289`, `jspdf@4.2.1`, `jspdf-autotable@5.0.7`, `docx@9.8.1`, `html-to-image@1.11.13`; devDependency `jszip@3.10.2`. Nada de outra biblioteca de UI, PDF ou imagem.
- **A fatura nunca sai do navegador.** Nenhuma Server Action, `fetch` ou log recebe o PDF, o texto extraído ou um telefone completo.
- **Telefone mascarado:** a linha da fatura vira `(DD) ••••• NNNN` (DDD + 4 últimos dígitos) assim que sai de `mesclar.ts`. **Qualquer rótulo com 8 ou mais dígitos no total (ignorando espaços, parênteses e hífen) é recusado** (origem fatura ou digitada).
- **Limites:** até 500 linhas; rótulo ≤ 60; quantidade inteira 1 a 1000; `planoGb`/`franquiaGb` nulo ou inteiro 1 a 1000; `valorUnitario` finito, > 0 e ≤ 1.000.000; `consumoMb` nulo ou finito ≥ 0 e ≤ 1.000.000.000; `faturasAnalisadas` 0 a 6; descrição ≤ 300 (`LIMITE_DESCRICAO`); até 6 PDFs por vez, cada um com até 10 MB.
- **`proposta_itens.valor` é o subtotal da linha** (quantidade × valor unitário). `total = soma dos valor`. O unitário é `valor / quantidade` arredondado a centavos. Somas sempre em centavos inteiros (`somarValores`).
- **Cores dos documentos:** preto `0D0D0D`, vermelho da marca `B3101F`, cinza de fundo `F3F4F6`, borda `D1D5DB`, texto cinza `6B7280`, verde `16A34A`, âmbar `B45309`.
- **Validade** = data de emissão + 1 dia; datas em `dd/mm/aaaa`, fuso `America/Sao_Paulo`.
- **Claro Monitor** é o item cuja descrição começa com "Claro Monitor": soma no total, **não** vira linha do documento e aparece como benefício.
- **Mensagens de WhatsApp nunca falam em economia** (o comparativo pode ser um aumento).
- **Repositório público:** os testes usam só dados sintéticos (telefones `(17) 90000-0001` e parecidos, CNPJ `11222333000181`, nomes inventados). Nunca colar telefone, CNPJ, nome de cliente ou fatura real em arquivo, teste ou commit.
- **Server Actions:** `sessaoAtiva()` fora do `try`; validar tudo que vem do navegador; erro do banco vira mensagem genérica e o detalhe vai para `console.error` **sem** a situação atual nem telefones; chamar do cliente com `chamarAcaoComSeguranca` + `unstable_rethrow`.
- **DDL** idempotente (`if not exists`). **Aplicar em produção exige OK do usuário e não faz parte das tarefas.**
- **Texto da interface em português.** Componentes de `components/ui` existentes; `<select>` nativo como no construtor atual. Bibliotecas pesadas só por `import()` dinâmico, nunca no topo de um componente de página.
- **Commits:** `tipo(crm-fibra): resumo` em inglês, no estilo do repositório, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Arquivos sempre com quebra de linha LF; nunca gravar arquivo por Python no Windows (vira CRLF).

## Review Focus

Entradas e falhas que o desenho implica e que os testes de comportamento normal não pegam. Cada linha tem um teste fixado na tarefa que dona o código.

1. **PDF escaneado, protegido ou corrompido** → mensagem clara e tabela pronta para digitar, nunca tela vazia nem exceção do `pdfjs-dist` solta. *Teste:* Task 1 (`extrairTextoDePaginas` com bytes inválidos lança `FaturaIlegivelError`; PDF sem texto devolve `""`) e Task 4 (`interpretarLeitura` separa `sem_texto` de `sem_linhas`).
2. **Layout de fatura diferente do conhecido** (o painel só foi validado com dois modelos) → o leitor devolve `[]` ou linhas com `valorMensal` nulo; a linha nunca pode ser gravada com valor nulo. *Teste:* Task 4 (blocos sem plano/valor), Task 3 (`validarSituacaoAtual` recusa valor ≤ 0) e Task 14 (`validarSituacaoDaTela` bloqueia exportar/salvar com linha sem mensalidade).
3. **Número completo vazando** em tabela, banco, documento ou log. *Teste:* Task 3 (rótulo com telefone completo recusado), Task 5 (`paraLinhasAtuais` não carrega o número e o JSON não tem 8 dígitos), Task 9 (`console.error` da action não recebe a situação atual).
4. **Arredondamento e totais** com centavos (`39,99 × 7`), consolidado + Claro Monitor e proposta sem item de Pós. *Teste:* Task 8, Task 10 (invariante `soma dos itens visíveis + Monitor = total`, em todas as combinações).
5. **Muitos ou grandes PDFs** → a aba não trava. *Teste:* Task 1 (`validarArquivos`: mais de 6, maior que 10 MB, vazio e não-PDF) e Task 14 (`processarFaturas`: leitura em sequência, um arquivo por vez, com falha isolada por arquivo).

## Mapa de arquivos

Novos (em `crm-fibra/`): `lib/fatura/{tipos,extrair,mesclar,sugestao,pdf-texto,processar}.ts`, `lib/proposta/{agrupar,estado,modelo-documento}.ts`, `lib/documentos/{marca,formato,fixtures,docx,pdf-base,pdf-consultor,pdf-cliente,png,baixar,exportar,mensagens-whatsapp}.ts`, `components/documento/comparativo-cartao.tsx`, `public/marca/{apex-logo.png,claro-logo.jpg}`, `db/rollback-proposta-fatura.sql`, e na ficha `app/(protected)/leads/[cnpj]/{proposta-workspace,situacao-atual,nova-proposta,comparativo,exportar,enviar-whatsapp,exportar-salva}.tsx`, com um teste ao lado de cada módulo (menos `fixtures.ts`, que só apoia os testes dos desenhistas, e as telas, conferidas por `tsc`, `next build` e no navegador).

Alterados: `db/schema.sql` (+ `db/schema.test.ts`), `lib/formato.ts`, `lib/catalogo.ts`, `lib/propostas.ts`, `lib/proposta-rascunho.ts`, `lib/ia/abordagem.ts`, `app/(protected)/catalogo/{actions.ts,novo-plano-form.tsx}`, `app/(protected)/leads/[cnpj]/{actions.ts,aba-proposta.tsx,propostas-salvas.tsx,page.tsx}`, `README.md`, `package.json`, `package-lock.json`, e os testes dos arquivos alterados. `proposta-builder.tsx` é absorvido por `nova-proposta.tsx` e removido.

---

### Task 1: Dependências, logos da marca e leitura do texto do PDF

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `public/marca/apex-logo.png`, `public/marca/claro-logo.jpg`
- Create: `lib/documentos/marca.ts`, `lib/documentos/marca.test.ts`
- Create: `lib/fatura/pdf-texto.ts`, `lib/fatura/pdf-texto.test.ts`
- Throwaway (não commitar): `app/login/harness-tmp/page.tsx`

**Interfaces:**
- Produces (`lib/fatura/pdf-texto.ts`):
  - `LIMITE_ARQUIVOS = 6`, `LIMITE_BYTES = 10 * 1024 * 1024`
  - `interface ArquivoInfo { name: string; size: number; type: string }`
  - `validarArquivos(arquivos: ArquivoInfo[]): string | null` (mensagem de erro ou `null`)
  - `class FaturaIlegivelError extends Error { arquivo: string }`
  - `interface PdfjsMinimo` (o recorte de `pdfjs-dist` que usamos; permite injetar a build "legacy" nos testes)
  - `extrairTextoDePaginas(pdfjs: PdfjsMinimo, dados: Uint8Array, nomeArquivo: string, opcoesExtras?: Record<string, unknown>): Promise<string>` (páginas separadas por `"\n"`)
  - `lerTextoDoArquivo(arquivo: File): Promise<string>` (só navegador)
- Produces (`lib/documentos/marca.ts`):
  - `LOGO_APEX = { arquivo: "/marca/apex-logo.png", formato: "PNG", largura: 300, altura: 327 }`, `LOGO_CLARO = { arquivo: "/marca/claro-logo.jpg", formato: "JPEG", largura: 260, altura: 260 }`
  - `interface Logos { apex: Uint8Array; claro: Uint8Array }`
  - `carregarLogos(): Promise<Logos>` (só navegador, `fetch` do mesmo domínio)

- [ ] **Step 1: Instalar as dependências**

O worktree não tem `node_modules`. Rode, a partir de `crm-fibra/`:

```bash
npm install
npm install --save-exact pdfjs-dist@6.3.289 jspdf@4.2.1 jspdf-autotable@5.0.7 docx@9.8.1 html-to-image@1.11.13
npm install --save-dev --save-exact jszip@3.10.2
```

Expected: sem erro; `package.json` lista as cinco dependências com versão exata (sem `^`) e `jszip` em `devDependencies`. Confira com `grep -E '"(pdfjs-dist|jspdf|jspdf-autotable|docx|html-to-image|jszip)"' package.json`.

- [ ] **Step 2: Escrever o teste dos logos (vai falhar: os arquivos ainda não existem)**

Crie `lib/documentos/marca.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOGO_APEX, LOGO_CLARO } from "./marca";

function ler(arquivo: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../public/marca/${arquivo}`, import.meta.url)));
}

// Percorre os marcadores JPEG até o primeiro SOF, onde ficam altura e largura.
function dimensoesJpeg(b: Buffer): { largura: number; altura: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marcador = b[i + 1];
    if (marcador >= 0xc0 && marcador <= 0xc2) {
      return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("SOF não encontrado");
}

describe("logos da marca (public/marca)", () => {
  it("apex-logo.png é um PNG com as dimensões declaradas em LOGO_APEX", () => {
    const b = ler("apex-logo.png");
    expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(b.readUInt32BE(16)).toBe(LOGO_APEX.largura);
    expect(b.readUInt32BE(20)).toBe(LOGO_APEX.altura);
  });

  it("claro-logo.jpg é um JPEG com as dimensões declaradas em LOGO_CLARO", () => {
    const b = ler("claro-logo.jpg");
    expect(b[0]).toBe(0xff);
    expect(b[1]).toBe(0xd8);
    expect(dimensoesJpeg(b)).toEqual({ largura: LOGO_CLARO.largura, altura: LOGO_CLARO.altura });
  });
});
```

- [ ] **Step 3: Escrever o teste da leitura do PDF**

Crie `lib/fatura/pdf-texto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  FaturaIlegivelError,
  LIMITE_ARQUIVOS,
  LIMITE_BYTES,
  extrairTextoDePaginas,
  validarArquivos,
  type PdfjsMinimo,
} from "./pdf-texto";

const require = createRequire(import.meta.url);
const FONTES = pathToFileURL(
  join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + sep
).href;
const pdfjsReal = pdfjs as unknown as PdfjsMinimo;
const OPCOES = { standardFontDataUrl: FONTES };

// Linhas curtas: uma linha mais larga que a página é cortada na borda e perde o final.
function pdfComPaginas(paginas: string[][]): Uint8Array {
  const doc = new jsPDF();
  doc.setFontSize(9);
  paginas.forEach((linhas, indice) => {
    if (indice > 0) doc.addPage();
    linhas.forEach((linha, i) => doc.text(linha, 10, 20 + i * 8));
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("extrairTextoDePaginas", () => {
  it("lê o texto de um PDF, com acentos", async () => {
    const dados = pdfComPaginas([["Mensalidades e Pacotes", "Oferta Conjunta Claro MIX 48,49", "Claro Pós 10GB -"]]);
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(texto).toContain("Mensalidades e Pacotes");
    expect(texto).toContain("Oferta Conjunta Claro MIX 48,49");
    expect(texto).toContain("Claro Pós 10GB -");
  });

  it("junta as páginas na ordem, separadas por quebra de linha", async () => {
    const dados = pdfComPaginas([["Pagina um"], ["Pagina dois"]]);
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(texto.indexOf("Pagina um")).toBeLessThan(texto.indexOf("Pagina dois"));
    expect(texto.split("\n")).toHaveLength(2);
  });

  it("PDF sem camada de texto (escaneado) devolve texto vazio, sem lançar", async () => {
    const doc = new jsPDF();
    doc.rect(10, 10, 50, 50);
    const dados = new Uint8Array(doc.output("arraybuffer"));
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "scan.pdf", OPCOES);
    expect(texto.trim()).toBe("");
  });

  it("bytes que não são um PDF viram FaturaIlegivelError com o nome do arquivo", async () => {
    const promessa = extrairTextoDePaginas(pdfjsReal, new Uint8Array([1, 2, 3]), "quebrado.pdf", OPCOES);
    await expect(promessa).rejects.toBeInstanceOf(FaturaIlegivelError);
    await expect(promessa).rejects.toMatchObject({ arquivo: "quebrado.pdf" });
  });

  it("não consome o buffer que o chamador passou (o pdf.js destrói o que recebe)", async () => {
    const dados = pdfComPaginas([["Texto"]]);
    const tamanho = dados.byteLength;
    await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(dados.byteLength).toBe(tamanho);
  });
});

describe("validarArquivos", () => {
  const pdf = { name: "fatura.pdf", size: 1000, type: "application/pdf" };

  it("aceita de 1 até o limite de PDFs", () => {
    expect(validarArquivos([pdf])).toBeNull();
    expect(validarArquivos(Array.from({ length: LIMITE_ARQUIVOS }, () => pdf))).toBeNull();
  });

  it("aceita PDF cujo navegador não informou o tipo, pela extensão", () => {
    expect(validarArquivos([{ name: "FATURA.PDF", size: 10, type: "" }])).toBeNull();
  });

  it("recusa lista vazia", () => {
    expect(validarArquivos([])).toMatch(/pelo menos um/i);
  });

  it("recusa mais PDFs que o limite", () => {
    const lista = Array.from({ length: LIMITE_ARQUIVOS + 1 }, () => pdf);
    expect(validarArquivos(lista)).toMatch(new RegExp(String(LIMITE_ARQUIVOS)));
  });

  it("recusa arquivo que não é PDF, citando o nome", () => {
    expect(validarArquivos([{ name: "foto.png", size: 10, type: "image/png" }])).toMatch(/foto\.png/);
  });

  it("recusa arquivo acima de 10 MB e arquivo vazio", () => {
    expect(validarArquivos([{ ...pdf, size: LIMITE_BYTES + 1 }])).toMatch(/10 MB/);
    expect(validarArquivos([{ ...pdf, size: 0 }])).toMatch(/vazio/);
  });
});
```

- [ ] **Step 4: Rodar os testes e ver falhar**

Run: `npx vitest run lib/documentos/marca.test.ts lib/fatura/pdf-texto.test.ts`
Expected: FAIL — `Cannot find module './marca'` e `./pdf-texto` (e, quando existirem, `ENOENT` nos logos).

- [ ] **Step 5: Extrair os logos do painel publicado**

O repositório não tem os logos soltos; eles vivem embutidos em base64 no `painel_clientes_apex.html` da raiz (ativos de marca já públicos). Rode, a partir de `crm-fibra/`:

```bash
mkdir -p public/marca
node -e '
const fs = require("fs");
const html = fs.readFileSync("../painel_clientes_apex.html", "utf8");
const png = html.match(/data:image\/png;base64,([A-Za-z0-9+\/=]+)/);
const jpg = html.match(/data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)/);
if (!png || !jpg) throw new Error("logos não encontrados no painel");
fs.writeFileSync("public/marca/apex-logo.png", Buffer.from(png[1], "base64"));
fs.writeFileSync("public/marca/claro-logo.jpg", Buffer.from(jpg[1], "base64"));
'
ls -l public/marca
```

Expected: `apex-logo.png` com 32870 bytes e `claro-logo.jpg` com 8175 bytes. Abra os dois com a ferramenta Read: o primeiro é o triângulo vermelho "Apex Smart Solutions" e o segundo é "Claro empresas" branco em fundo vinho. Se algum for outra imagem, pare e avise.

- [ ] **Step 6: Implementar `marca.ts`**

Crie `lib/documentos/marca.ts`:

```ts
// Logos que vão no cabeçalho dos documentos (Word, PDF e PNG). Os arquivos
// vêm do painel publicado e ficam em public/marca; as dimensões abaixo são
// conferidas por marca.test.ts para ninguém trocar a imagem sem querer.
export const LOGO_APEX = {
  arquivo: "/marca/apex-logo.png",
  formato: "PNG" as const,
  largura: 300,
  altura: 327,
};

export const LOGO_CLARO = {
  arquivo: "/marca/claro-logo.jpg",
  formato: "JPEG" as const,
  largura: 260,
  altura: 260,
};

export interface Logos {
  apex: Uint8Array;
  claro: Uint8Array;
}

async function baixar(arquivo: string): Promise<Uint8Array> {
  const resposta = await fetch(arquivo);
  if (!resposta.ok) throw new Error(`Não foi possível carregar ${arquivo}`);
  return new Uint8Array(await resposta.arrayBuffer());
}

// Só no navegador: o mesmo domínio serve os arquivos, sem bloqueio de CORS.
export async function carregarLogos(): Promise<Logos> {
  const [apex, claro] = await Promise.all([baixar(LOGO_APEX.arquivo), baixar(LOGO_CLARO.arquivo)]);
  return { apex, claro };
}
```

- [ ] **Step 7: Implementar `pdf-texto.ts`**

Crie `lib/fatura/pdf-texto.ts`:

```ts
// Leitura do texto de um PDF de fatura, toda no navegador: o arquivo nunca
// vai ao servidor. `pdfjs-dist` só é carregado quando o consultor anexa algo.
export const LIMITE_ARQUIVOS = 6;
export const LIMITE_BYTES = 10 * 1024 * 1024;

export interface ArquivoInfo {
  name: string;
  size: number;
  type: string;
}

export function validarArquivos(arquivos: ArquivoInfo[]): string | null {
  if (arquivos.length === 0) return "Escolha pelo menos um PDF";
  if (arquivos.length > LIMITE_ARQUIVOS) {
    return `Anexe no máximo ${LIMITE_ARQUIVOS} faturas por vez`;
  }
  for (const arquivo of arquivos) {
    const ehPdf = arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf");
    if (!ehPdf) return `"${arquivo.name}" não é PDF. A leitura automática só aceita PDF`;
    if (arquivo.size === 0) return `"${arquivo.name}" está vazio`;
    if (arquivo.size > LIMITE_BYTES) return `"${arquivo.name}" passa de 10 MB`;
  }
  return null;
}

export class FaturaIlegivelError extends Error {
  constructor(public readonly arquivo: string) {
    super(`Não foi possível ler "${arquivo}": o PDF está protegido, corrompido ou não é uma fatura.`);
    this.name = "FaturaIlegivelError";
  }
}

// O recorte de pdfjs-dist que usamos. Os testes injetam a build "legacy" (que
// roda em Node); o navegador injeta a build normal.
export interface PdfjsMinimo {
  getDocument(opcoes: { data: Uint8Array } & Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(numero: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
}

export async function extrairTextoDePaginas(
  pdfjs: PdfjsMinimo,
  dados: Uint8Array,
  nomeArquivo: string,
  opcoesExtras: Record<string, unknown> = {}
): Promise<string> {
  try {
    // O pdf.js destrói (transfere) o buffer que recebe: passa uma cópia.
    const pdf = await pdfjs.getDocument({ data: dados.slice(), isEvalSupported: false, ...opcoesExtras })
      .promise;
    const paginas: string[] = [];
    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const pagina = await pdf.getPage(numero);
      const conteudo = await pagina.getTextContent();
      paginas.push(conteudo.items.map((item) => item.str ?? "").join(" "));
    }
    await pdf.destroy?.();
    return paginas.join("\n");
  } catch {
    throw new FaturaIlegivelError(nomeArquivo);
  }
}

// Só no navegador.
export async function lerTextoDoArquivo(arquivo: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  return extrairTextoDePaginas(pdfjs as unknown as PdfjsMinimo, dados, arquivo.name);
}
```

- [ ] **Step 8: Rodar os testes e ver passar**

Run: `npx vitest run lib/documentos/marca.test.ts lib/fatura/pdf-texto.test.ts`
Expected: PASS (2 + 11 testes). O pdf.js pode imprimir avisos `UnknownErrorException: Unable to load font data` durante os testes: são inofensivos (o texto é extraído mesmo assim) e não indicam falha. Se o teste "lê o texto de um PDF" falhar por texto cortado, a linha passou da borda da página: encurte a linha do teste, não o código.

- [ ] **Step 9: Conferir tipos e rodar a suíte inteira**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` sem erro; suíte toda verde (os 303 testes anteriores + os novos).

- [ ] **Step 10: Página descartável para testar no navegador de verdade**

O Vitest roda em Node: ele não prova que o worker do pdf.js é servido nem que o bundler resolve o `new URL(...)`. Crie uma página temporária, em rota aberta (`/login/*` não passa pelo middleware) e fora do Git:

```bash
echo "crm-fibra/app/login/harness-tmp/" >> "$(git rev-parse --git-path info/exclude)"
mkdir -p "app/login/harness-tmp"
```

Crie `app/login/harness-tmp/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { lerTextoDoArquivo } from "@/lib/fatura/pdf-texto";

export default function Harness() {
  const [saida, setSaida] = useState("aguardando PDF…");
  return (
    <main style={{ padding: 24 }}>
      <input
        type="file"
        accept="application/pdf"
        data-testid="pdf"
        onChange={async (e) => {
          const arquivo = e.target.files?.[0];
          if (!arquivo) return;
          try {
            const texto = await lerTextoDoArquivo(arquivo);
            setSaida(`OK ${texto.length} caracteres:\n${texto.slice(0, 400)}`);
          } catch (erro) {
            setSaida(`ERRO ${String(erro)}`);
          }
        }}
      />
      <pre data-testid="saida">{saida}</pre>
    </main>
  );
}
```

Gere um PDF sintético de teste (fora do repositório) e suba o servidor:

```bash
node -e '
const { jsPDF } = require("jspdf");
const d = new jsPDF();
d.text("Claro Pós 10GB - teste de leitura", 10, 20);
require("fs").writeFileSync(process.env.TEMP + "/harness.pdf", Buffer.from(d.output("arraybuffer")));
console.log("PDF em " + process.env.TEMP + "/harness.pdf");
'
```

Inicie o servidor com `preview_start` (crie `.claude/launch.json` na raiz do worktree, **sem commitar**, com `{"version":"0.0.1","configurations":[{"name":"crm-fibra","runtimeExecutable":"npm","runtimeArgs":["--prefix","crm-fibra","run","dev"],"port":3000}]}`), abra `http://localhost:3000/login/harness-tmp`, anexe o PDF com `form_input`/`file_upload` no `data-testid="pdf"` e leia `data-testid="saida"`.
Expected: `OK … caracteres` com o texto "Claro Pós 10GB - teste de leitura"; `read_console_messages` sem erro de worker. Se aparecer erro de worker (404, `Setting up fake worker failed`), troque a linha do `workerSrc` por uma cópia estática: `mkdir -p public && cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs`, use `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"` e registre o `Ruling:` no ledger (custo se errado: um arquivo de 1 MB versionado que precisa acompanhar a versão do `pdfjs-dist`).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json public/marca lib/documentos/marca.ts lib/documentos/marca.test.ts lib/fatura/pdf-texto.ts lib/fatura/pdf-texto.test.ts
git commit -m "feat(crm-fibra): add PDF text reading and brand logos for the proposal flow

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(A página `harness-tmp` e o `.claude/launch.json` **não** entram no commit; a Task 16 apaga os dois.)

---

### Task 2: Banco — colunas novas, rollback e testes do schema

**Files:**
- Modify: `db/schema.sql` (acrescentar no fim)
- Create: `db/rollback-proposta-fatura.sql`
- Modify: `db/schema.test.ts` (acrescentar no fim)

**Interfaces:**
- Produces (SQL): `crm_fibra.catalogo_planos.franquia_gb integer null`, `crm_fibra.proposta_itens.quantidade integer not null default 1`, `crm_fibra.proposta_itens.franquia_gb integer null`, `crm_fibra.propostas.situacao_atual jsonb null`.

- [ ] **Step 1: Escrever os testes do schema (vão falhar)**

Acrescente ao final de `db/schema.test.ts`:

```ts
const MARCADOR_FATURA = "-- Proposta com fatura (sub-projeto 5)";

function blocoDaFatura(sql: string): string {
  const inicio = sql.indexOf(MARCADOR_FATURA);
  return inicio === -1 ? "" : sql.slice(inicio);
}

describe("db/schema.sql — proposta com fatura", () => {
  it("tem o bloco do sub-projeto 5", () => {
    expect(blocoDaFatura(ler("schema.sql"))).not.toBe("");
  });

  it("dá franquia_gb ao catálogo, nula ou positiva", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.catalogo_planos");
    expect(bloco).toMatch(/add column if not exists franquia_gb integer check \(franquia_gb is null or franquia_gb > 0\)/);
  });

  it("preenche a franquia dos Pós a partir do nome, sem sobrescrever o que já existe", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("update crm_fibra.catalogo_planos");
    expect(bloco).toContain("substring(nome from '^Pós ([0-9]+)GB')");
    expect(bloco).toContain("categoria in ('pos_nacional', 'pos_regional')");
    expect(bloco).toContain("franquia_gb is null");
  });

  it("dá quantidade (1 a 1000, padrão 1) e franquia_gb aos itens da proposta", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.proposta_itens");
    expect(bloco).toMatch(
      /add column if not exists quantidade integer not null default 1 check \(quantidade between 1 and 1000\)/
    );
    expect(bloco).toMatch(/add column if not exists franquia_gb integer check \(franquia_gb is null or franquia_gb > 0\)/);
  });

  it("guarda a situação atual em jsonb opcional", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.propostas add column if not exists situacao_atual jsonb;");
  });

  it("é idempotente: toda coluna nova usa if not exists", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    const todas = bloco.match(/add column/g) ?? [];
    const seguras = bloco.match(/add column if not exists/g) ?? [];
    expect(todas.length).toBe(4);
    expect(seguras.length).toBe(todas.length);
  });

  it("não cria policy nem mexe nos 22 planos semeados", () => {
    const sql = ler("schema.sql");
    expect(sql).not.toMatch(/create policy/i);
    expect(linhasDoSeed(sql)).toHaveLength(22);
  });
});

describe("db/rollback-proposta-fatura.sql", () => {
  it("remove as quatro colunas e só elas", () => {
    const sql = ler("rollback-proposta-fatura.sql");
    expect(sql).toContain("alter table crm_fibra.propostas drop column if exists situacao_atual;");
    expect(sql).toContain("alter table crm_fibra.proposta_itens drop column if exists franquia_gb;");
    expect(sql).toContain("alter table crm_fibra.proposta_itens drop column if exists quantidade;");
    expect(sql).toContain("alter table crm_fibra.catalogo_planos drop column if exists franquia_gb;");
    expect(sql).not.toMatch(/drop table/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run db/schema.test.ts`
Expected: FAIL — "tem o bloco do sub-projeto 5" e `ENOENT rollback-proposta-fatura.sql`. Os testes antigos continuam verdes.

- [ ] **Step 3: Acrescentar o DDL ao fim de `db/schema.sql`**

Confira que o arquivo termina com quebra de linha (`tail -c1 db/schema.sql | xxd`); se não, acrescente uma. Depois acrescente exatamente:

```sql

-- Proposta com fatura (sub-projeto 5) — idempotente, seguro para rodar de novo.
-- Ordem: aplicar esta migração ANTES de publicar o código novo.

-- Franquia em GB dos planos Pós: hoje só existe dentro do nome ("Pós 40GB").
-- A sugestão por consumo e o "consolidar valores" dependem do número.
alter table crm_fibra.catalogo_planos
  add column if not exists franquia_gb integer check (franquia_gb is null or franquia_gb > 0);

update crm_fibra.catalogo_planos
   set franquia_gb = (substring(nome from '^Pós ([0-9]+)GB'))::int
 where categoria in ('pos_nacional', 'pos_regional')
   and franquia_gb is null
   and nome ~ '^Pós [0-9]+GB';

-- `valor` do item continua sendo o subtotal da linha (quantidade x unitário):
-- o total da proposta segue sendo a soma de `valor`. `franquia_gb` é a cópia
-- que a proposta guarda, como já faz com descrição e valor.
alter table crm_fibra.proposta_itens
  add column if not exists quantidade integer not null default 1 check (quantidade between 1 and 1000),
  add column if not exists franquia_gb integer check (franquia_gb is null or franquia_gb > 0);

-- Retrato da situação atual do cliente ({ faturasAnalisadas, linhas[] }), com o
-- telefone das linhas já mascarado pelo navegador; nulo = proposta sem fatura.
alter table crm_fibra.propostas add column if not exists situacao_atual jsonb;
```

- [ ] **Step 4: Criar o rollback**

Crie `db/rollback-proposta-fatura.sql`:

```sql
-- Desfaz a proposta com fatura (sub-projeto 5): remove as quatro colunas e o que elas guardam.
-- Republique ANTES o código anterior: a ficha lê essas colunas e quebraria sem elas.
alter table crm_fibra.propostas drop column if exists situacao_atual;
alter table crm_fibra.proposta_itens drop column if exists franquia_gb;
alter table crm_fibra.proposta_itens drop column if exists quantidade;
alter table crm_fibra.catalogo_planos drop column if exists franquia_gb;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run db/schema.test.ts`
Expected: PASS (todos, incluindo os 16 anteriores).

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql db/rollback-proposta-fatura.sql db/schema.test.ts
git commit -m "feat(crm-fibra): add quantity, franchise and current-situation columns

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tipos da situação atual, máscara do rótulo e validação

**Files:**
- Create: `lib/fatura/tipos.ts`, `lib/fatura/tipos.test.ts`

**Interfaces:**
- Produces (`lib/fatura/tipos.ts`):
  - constantes `LIMITE_LINHAS = 500`, `LIMITE_ROTULO = 60`, `LIMITE_QUANTIDADE = 1000`, `LIMITE_FRANQUIA_GB = 1000`, `LIMITE_VALOR_UNITARIO = 1_000_000`, `LIMITE_CONSUMO_MB = 1_000_000_000`, `LIMITE_FATURAS = 6`, `LIMITE_DESCRICAO_PROPOSTO = 300`
  - `interface PlanoProposto { descricao: string; valorUnitario: number }`
  - `interface LinhaAtual { rotulo: string; quantidade: number; planoGb: number | null; valorUnitario: number; consumoMb: number | null; origem: "fatura" | "digitada"; proposto: PlanoProposto | null }`
  - `interface SituacaoAtual { faturasAnalisadas: number; linhas: LinhaAtual[] }`
  - `contarDigitos(texto: string): number`, `temNumeroCompleto(texto: string): boolean`
  - `rotuloDaLinha(ddd: string, numero: string): string`
  - `type ResultadoSituacao = { ok: true; valor: SituacaoAtual | null } | { ok: false; erro: string }`
  - `validarSituacaoAtual(entrada: unknown): ResultadoSituacao`

- [ ] **Step 1: Escrever os testes (vão falhar)**

Crie `lib/fatura/tipos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  LIMITE_LINHAS,
  contarDigitos,
  rotuloDaLinha,
  temNumeroCompleto,
  validarSituacaoAtual,
  type LinhaAtual,
} from "./tipos";

const linha: LinhaAtual = {
  rotulo: "(17) ••••• 0001",
  quantidade: 1,
  planoGb: 10,
  valorUnitario: 48.49,
  consumoMb: 5120.5,
  origem: "fatura",
  proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
};

const situacao = { faturasAnalisadas: 2, linhas: [linha] };

describe("rotuloDaLinha", () => {
  it("mostra só o DDD e os 4 últimos dígitos", () => {
    expect(rotuloDaLinha("17", "900000001")).toBe("(17) ••••• 0001");
    expect(rotuloDaLinha("11", "30000002")).toBe("(11) ••••• 0002");
  });

  it("o rótulo gerado nunca conta como número completo", () => {
    expect(temNumeroCompleto(rotuloDaLinha("17", "900000001"))).toBe(false);
  });
});

describe("temNumeroCompleto / contarDigitos", () => {
  it.each(["(17) 99219-9652", "17992199652", "Filial 12345678", "55 17 3000-0001"])(
    "%s conta como número completo (8 ou mais dígitos, ignorando separadores)",
    (texto) => {
      expect(temNumeroCompleto(texto)).toBe(true);
    }
  );

  it.each(["Escritório 2024", "(17) ••••• 9652", "Linhas do 2º andar", ""])("%s não conta", (texto) => {
    expect(temNumeroCompleto(texto)).toBe(false);
  });

  it("conta dígitos no total", () => {
    expect(contarDigitos("a1b22c333")).toBe(6);
  });
});

describe("validarSituacaoAtual", () => {
  it("aceita nulo (proposta sem fatura)", () => {
    expect(validarSituacaoAtual(null)).toEqual({ ok: true, valor: null });
    expect(validarSituacaoAtual(undefined)).toEqual({ ok: true, valor: null });
  });

  it("aceita uma situação válida e devolve uma cópia normalizada", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 2,
      linhas: [{ ...linha, rotulo: "  (17) ••••• 0001  ", valorUnitario: 48.494, consumoMb: 5120.504 }],
    });
    expect(resultado).toEqual({
      ok: true,
      valor: { faturasAnalisadas: 2, linhas: [{ ...linha, valorUnitario: 48.49, consumoMb: 5120.5 }] },
    });
  });

  it("aceita linha digitada, sem consumo, sem plano e sem proposto", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 0,
      linhas: [
        { rotulo: "Linhas do escritório", quantidade: 5, planoGb: null, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null },
      ],
    });
    expect(resultado.ok).toBe(true);
  });

  it.each([42, "texto", [], true])("recusa entrada que não é objeto (%s)", (entrada) => {
    expect(validarSituacaoAtual(entrada)).toMatchObject({ ok: false });
  });

  it("recusa situação sem nenhuma linha", () => {
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [] })).toMatchObject({
      ok: false,
      erro: expect.stringMatching(/pelo menos uma linha/),
    });
  });

  it("recusa mais linhas que o limite", () => {
    const linhas = Array.from({ length: LIMITE_LINHAS + 1 }, () => linha);
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas })).toMatchObject({
      ok: false,
      erro: expect.stringContaining(String(LIMITE_LINHAS)),
    });
  });

  it.each([-1, 7, 1.5, "2", null])("recusa faturasAnalisadas %s", (faturasAnalisadas) => {
    expect(validarSituacaoAtual({ faturasAnalisadas, linhas: [linha] })).toMatchObject({ ok: false });
  });

  it("recusa telefone completo no rótulo, digitado ou vindo de chamada forjada", () => {
    for (const rotulo of ["(17) 90000-0001", "17900000001", "Linha 55 17 9000 0001"]) {
      expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, rotulo }] })).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/número completo/),
      });
    }
  });

  const camposInvalidos: Array<[string, unknown]> = [
    ["rotulo", ""],
    ["rotulo", "   "],
    ["rotulo", "x".repeat(61)],
    ["rotulo", 5],
    ["quantidade", 0],
    ["quantidade", 1001],
    ["quantidade", 1.5],
    ["quantidade", "3"],
    ["planoGb", 0],
    ["planoGb", 1001],
    ["planoGb", 2.5],
    ["valorUnitario", 0],
    ["valorUnitario", -1],
    ["valorUnitario", Number.NaN],
    ["valorUnitario", Number.POSITIVE_INFINITY],
    ["valorUnitario", 1_000_001],
    ["valorUnitario", "48,49"],
    ["consumoMb", -1],
    ["consumoMb", 1_000_000_001],
    ["consumoMb", "10"],
    ["origem", "manual"],
    ["origem", undefined],
  ];

  it.each(camposInvalidos)("recusa %s = %s", (campo, valor) => {
    const resultado = validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, [campo]: valor }] });
    expect(resultado).toMatchObject({ ok: false });
  });

  it("aponta o número da linha com problema", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 1,
      linhas: [linha, { ...linha, valorUnitario: 0 }],
    });
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/^Linha 2:/) });
  });

  it.each([
    [{ descricao: "", valorUnitario: 10 }],
    [{ descricao: "x".repeat(301), valorUnitario: 10 }],
    [{ descricao: "Pós", valorUnitario: 0 }],
    [{ descricao: 5, valorUnitario: 10 }],
    ["texto"],
  ])("recusa plano proposto inválido (%j)", (proposto) => {
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, proposto }] })).toMatchObject({ ok: false });
  });

  it("não deixa campos extras passarem para o banco", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 1,
      linhas: [{ ...linha, telefoneCompleto: "17900000001" }],
      extra: "x",
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok && resultado.valor) {
      expect(JSON.stringify(resultado.valor)).not.toContain("17900000001");
      expect(Object.keys(resultado.valor)).toEqual(["faturasAnalisadas", "linhas"]);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/fatura/tipos.test.ts`
Expected: FAIL — `Cannot find module './tipos'`.

- [ ] **Step 3: Implementar**

Crie `lib/fatura/tipos.ts`:

```ts
export const LIMITE_LINHAS = 500;
export const LIMITE_ROTULO = 60;
export const LIMITE_QUANTIDADE = 1000;
export const LIMITE_FRANQUIA_GB = 1000;
export const LIMITE_VALOR_UNITARIO = 1_000_000;
export const LIMITE_CONSUMO_MB = 1_000_000_000;
export const LIMITE_FATURAS = 6;
// Mesmo teto de descrição das linhas da proposta (LIMITE_DESCRICAO em propostas.ts).
export const LIMITE_DESCRICAO_PROPOSTO = 300;

// Retrato do plano escolhido para a linha: é o que permite remontar o
// comparativo por linha a partir de uma proposta salva.
export interface PlanoProposto {
  descricao: string;
  valorUnitario: number;
}

export interface LinhaAtual {
  rotulo: string; // "(17) ••••• 9652" ou texto digitado, até 60 caracteres
  quantidade: number; // 1 para linha de fatura; N para grupo digitado ("5 linhas")
  planoGb: number | null; // franquia atual
  valorUnitario: number; // mensalidade de UMA linha, maior que zero
  consumoMb: number | null; // média do período, quando veio da fatura
  origem: "fatura" | "digitada";
  proposto: PlanoProposto | null; // plano da nova proposta para esta linha
}

export interface SituacaoAtual {
  faturasAnalisadas: number; // 0 a 6
  linhas: LinhaAtual[]; // 1 a 500
}

export function contarDigitos(texto: string): number {
  return (texto.match(/\d/g) ?? []).length;
}

// Conta os dígitos no total, não só os seguidos: "(17) 99219-9652" tem no máximo
// 5 seguidos e passaria por uma checagem de 8 seguidos.
export function temNumeroCompleto(texto: string): boolean {
  return contarDigitos(texto) >= 8;
}

// Só DDD e os 4 últimos dígitos: o número completo existe apenas dentro do
// leitor e da média, nunca na tela, no banco ou nos documentos.
export function rotuloDaLinha(ddd: string, numero: string): string {
  const ultimos = numero.replace(/\D/g, "").slice(-4);
  return `(${ddd.replace(/\D/g, "").slice(0, 2)}) ••••• ${ultimos}`;
}

export type ResultadoSituacao =
  | { ok: true; valor: SituacaoAtual | null }
  | { ok: false; erro: string };

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

function inteiroEntre(valor: unknown, minimo: number, maximo: number): number | null {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
  return valor >= minimo && valor <= maximo ? valor : null;
}

function dinheiro(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return valor > 0 && valor <= LIMITE_VALOR_UNITARIO ? arredondar(valor) : null;
}

function ausente(valor: unknown): boolean {
  return valor === null || valor === undefined;
}

function validarProposto(valor: unknown, numero: number): PlanoProposto | null | string {
  if (ausente(valor)) return null;
  if (typeof valor !== "object" || Array.isArray(valor)) return `Linha ${numero}: plano proposto inválido`;
  const bruto = valor as Record<string, unknown>;
  const descricao = typeof bruto.descricao === "string" ? bruto.descricao.trim() : "";
  const valorUnitario = dinheiro(bruto.valorUnitario);
  if (!descricao || descricao.length > LIMITE_DESCRICAO_PROPOSTO || valorUnitario === null) {
    return `Linha ${numero}: plano proposto inválido`;
  }
  return { descricao, valorUnitario };
}

function validarLinha(item: unknown, numero: number): LinhaAtual | string {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return `Linha ${numero}: formato inválido`;
  }
  const bruto = item as Record<string, unknown>;

  const rotulo = typeof bruto.rotulo === "string" ? bruto.rotulo.trim() : "";
  if (!rotulo) return `Linha ${numero}: informe o nome da linha`;
  if (rotulo.length > LIMITE_ROTULO) return `Linha ${numero}: o nome passou de ${LIMITE_ROTULO} caracteres`;
  if (temNumeroCompleto(rotulo)) {
    return `Linha ${numero}: não use o número completo do telefone no nome da linha`;
  }

  const quantidade = inteiroEntre(bruto.quantidade, 1, LIMITE_QUANTIDADE);
  if (quantidade === null) return `Linha ${numero}: a quantidade deve ser um número de 1 a ${LIMITE_QUANTIDADE}`;

  const planoGb = ausente(bruto.planoGb) ? null : inteiroEntre(bruto.planoGb, 1, LIMITE_FRANQUIA_GB);
  if (!ausente(bruto.planoGb) && planoGb === null) {
    return `Linha ${numero}: a franquia deve ser um número de 1 a ${LIMITE_FRANQUIA_GB}`;
  }

  const valorUnitario = dinheiro(bruto.valorUnitario);
  if (valorUnitario === null) return `Linha ${numero}: informe a mensalidade (maior que zero)`;

  let consumoMb: number | null = null;
  if (!ausente(bruto.consumoMb)) {
    const consumo = bruto.consumoMb;
    if (typeof consumo !== "number" || !Number.isFinite(consumo) || consumo < 0 || consumo > LIMITE_CONSUMO_MB) {
      return `Linha ${numero}: consumo inválido`;
    }
    consumoMb = arredondar(consumo);
  }

  if (bruto.origem !== "fatura" && bruto.origem !== "digitada") return `Linha ${numero}: origem inválida`;

  const proposto = validarProposto(bruto.proposto, numero);
  if (typeof proposto === "string") return proposto;

  return { rotulo, quantidade, planoGb, valorUnitario, consumoMb, origem: bruto.origem, proposto };
}

// Tudo que chega do navegador passa por aqui antes de ir ao banco: devolve uma
// cópia só com os campos conhecidos (campos extras são descartados).
export function validarSituacaoAtual(entrada: unknown): ResultadoSituacao {
  if (ausente(entrada)) return { ok: true, valor: null };
  if (typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, erro: "Situação atual em formato inválido" };
  }
  const bruto = entrada as Record<string, unknown>;

  const faturasAnalisadas = inteiroEntre(bruto.faturasAnalisadas, 0, LIMITE_FATURAS);
  if (faturasAnalisadas === null) {
    return { ok: false, erro: "Quantidade de faturas analisadas inválida" };
  }
  if (!Array.isArray(bruto.linhas) || bruto.linhas.length === 0) {
    return { ok: false, erro: "A situação atual precisa de pelo menos uma linha" };
  }
  if (bruto.linhas.length > LIMITE_LINHAS) {
    return { ok: false, erro: `A situação atual passou de ${LIMITE_LINHAS} linhas` };
  }

  const linhas: LinhaAtual[] = [];
  for (const [indice, item] of bruto.linhas.entries()) {
    const resultado = validarLinha(item, indice + 1);
    if (typeof resultado === "string") return { ok: false, erro: resultado };
    linhas.push(resultado);
  }
  return { ok: true, valor: { faturasAnalisadas, linhas } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/fatura/tipos.test.ts`
Expected: PASS. Se `recusa faturasAnalisadas null` falhar (porque `null` vira "sem fatura" noutro lugar), lembre que `faturasAnalisadas: null` deve ser recusado: `inteiroEntre(null, …)` devolve `null`, o que dispara o erro. Não mexa no teste.

- [ ] **Step 5: Commit**

```bash
git add lib/fatura/tipos.ts lib/fatura/tipos.test.ts
git commit -m "feat(crm-fibra): add current-situation types, phone masking and validation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Leitor da fatura (extrair linhas do texto)

**Files:**
- Create: `lib/fatura/extrair.ts`, `lib/fatura/extrair.test.ts`

**Interfaces:**
- Produces (`lib/fatura/extrair.ts`):
  - `interface LinhaLida { ddd: string; numero: string; valorMensal: number | null; planoGb: number | null; temMonitor: boolean; consumoMb: number }` (`numero` = os 8 ou 9 dígitos sem DDD, **completo: só pode existir dentro de `extrair`/`mesclar`**)
  - `normalizarAcentosPdf(texto: string): string`
  - `extrairLinhasFatura(textoBruto: string): LinhaLida[]`
  - `type Leitura = { tipo: "sem_texto" } | { tipo: "sem_linhas" } | { tipo: "ok"; linhas: LinhaLida[] }`
  - `interpretarLeitura(texto: string): Leitura`
  - `mensagemDeLeitura(nomeArquivo: string, leitura: { tipo: "sem_texto" } | { tipo: "sem_linhas" }): string`

- [ ] **Step 1: Escrever os testes (vão falhar)**

Crie `lib/fatura/extrair.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  extrairLinhasFatura,
  interpretarLeitura,
  mensagemDeLeitura,
  normalizarAcentosPdf,
} from "./extrair";

interface OpcoesBloco {
  ddd: string;
  parte1: string;
  parte2: string;
  valor?: string;
  gb?: number;
  mb?: string;
  monitor?: boolean;
  apps?: boolean;
}

// Fixture SINTÉTICA no formato da fatura Claro, com o artefato do pdf.js
// (espaço colado em cada caractere acentuado: "LIGA ÇÕ ES"). Nenhum número real.
function bloco(o: OpcoesBloco): string {
  return [
    "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR",
    `(${o.ddd}) ${o.parte1}-${o.parte2}`,
    "Mensalidades e Pacotes Promocionais",
    o.valor ? `Oferta Conjunta Claro MIX ${o.valor}` : "",
    o.gb ? `Claro P ó s ${o.gb}GB -` : "",
    o.monitor ? "Claro Monitor lite -" : "",
    o.apps ? "Aplicativos Digitais -" : "",
    "Liga çõ es Locais 0,00",
    o.mb ? `Internet (MB) Descri çã o Subtotal ${o.mb} 0,0000` : "",
    "TOTAL 99,99",
  ]
    .filter(Boolean)
    .join(" ");
}

const CAPA = "Fatura Claro Empresas Resumo da conta 1.234,56 ";

describe("normalizarAcentosPdf", () => {
  it("cola de volta as palavras que o pdf.js separou nos acentos", () => {
    expect(normalizarAcentosPdf("LIGA ÇÕ ES")).toBe("LIGAÇÕES");
    expect(normalizarAcentosPdf("Descri çã o")).toBe("Descrição");
    expect(normalizarAcentosPdf("P ó s")).toBe("Pós");
  });

  it("não mexe nos espaços entre palavras sem acento nem nos números", () => {
    expect(normalizarAcentosPdf("Oferta Conjunta Claro MIX 48,49")).toBe("Oferta Conjunta Claro MIX 48,49");
  });
});

describe("extrairLinhasFatura", () => {
  it("extrai telefone, valor, plano, consumo e Claro Monitor de cada linha", () => {
    const texto =
      CAPA +
      bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10, mb: "5.120,50", monitor: true }) +
      " " +
      bloco({ ddd: "11", parte1: "3000", parte2: "0002", valor: "58,99", gb: 20, mb: "800,00" });
    expect(extrairLinhasFatura(texto)).toEqual([
      { ddd: "17", numero: "900000001", valorMensal: 48.49, planoGb: 10, temMonitor: true, consumoMb: 5120.5 },
      { ddd: "11", numero: "30000002", valorMensal: 58.99, planoGb: 20, temMonitor: false, consumoMb: 800 },
    ]);
  });

  it("linha sem a seção Internet (MB) tem consumo zero, não 'sem dado'", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10 }));
    expect(linha.consumoMb).toBe(0);
  });

  it("lê valor com separador de milhar", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "1.234,56", gb: 10 }));
    expect(linha.valorMensal).toBe(1234.56);
  });

  it("devolve valorMensal nulo quando só o plano foi reconhecido", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", gb: 10 }));
    expect(linha.valorMensal).toBeNull();
    expect(linha.planoGb).toBe(10);
  });

  it("devolve planoGb nulo quando só o valor foi reconhecido", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49" }));
    expect(linha.planoGb).toBeNull();
    expect(linha.valorMensal).toBe(48.49);
  });

  it("ignora o bloco sem plano nem valor (linha sem uso no período)", () => {
    expect(extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001" }))).toEqual([]);
  });

  it("ignora o bloco sem telefone reconhecível", () => {
    const texto = "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR sem numero Mensalidades e Pacotes Promocionais Oferta Conjunta Claro MIX 10,00 TOTAL 1";
    expect(extrairLinhasFatura(texto)).toEqual([]);
  });

  it("outro layout de fatura (sem o título do detalhamento) devolve lista vazia", () => {
    expect(extrairLinhasFatura("Fatura de outra operadora Plano Controle 30GB R$ 49,90")).toEqual([]);
  });

  it("texto vazio devolve lista vazia", () => {
    expect(extrairLinhasFatura("")).toEqual([]);
  });

  it("aceita telefone de 8 dígitos (fixo) e de 9 (celular)", () => {
    const texto =
      bloco({ ddd: "17", parte1: "3000", parte2: "0001", valor: "10,00", gb: 5 }) +
      " " +
      bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "10,00", gb: 5 });
    expect(extrairLinhasFatura(texto).map((l) => l.numero)).toEqual(["30000001", "900000001"]);
  });
});

describe("interpretarLeitura", () => {
  it("texto vazio ou só espaço é PDF sem texto (escaneado)", () => {
    expect(interpretarLeitura("")).toEqual({ tipo: "sem_texto" });
    expect(interpretarLeitura(" \n \n")).toEqual({ tipo: "sem_texto" });
  });

  it("texto sem nenhuma linha reconhecida é 'sem_linhas'", () => {
    expect(interpretarLeitura("Fatura de outra operadora")).toEqual({ tipo: "sem_linhas" });
  });

  it("texto com linhas é 'ok' e traz as linhas", () => {
    const leitura = interpretarLeitura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10 }));
    expect(leitura.tipo).toBe("ok");
    if (leitura.tipo === "ok") expect(leitura.linhas).toHaveLength(1);
  });
});

describe("mensagemDeLeitura", () => {
  it("cita o arquivo e manda digitar, nos dois casos", () => {
    expect(mensagemDeLeitura("fatura.pdf", { tipo: "sem_texto" })).toMatch(/fatura\.pdf.*escaneado/i);
    expect(mensagemDeLeitura("fatura.pdf", { tipo: "sem_linhas" })).toMatch(/fatura\.pdf.*digite/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/fatura/extrair.test.ts`
Expected: FAIL — `Cannot find module './extrair'`.

- [ ] **Step 3: Implementar**

Crie `lib/fatura/extrair.ts`:

```ts
// Leitor da fatura Claro Empresas, portado de extractFaturaLinhas() do painel
// (REGRAS_NEGOCIO.md seção 22). Regra confirmada com o usuário: cada linha móvel
// tem um bloco "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (DDD) NÚMERO";
// o plano é o "Claro Pós <N>GB" com traço em "Mensalidades e Pacotes
// Promocionais", a mensalidade é a "Oferta Conjunta Claro MIX" e o consumo é o
// "Subtotal" depois de "Internet (MB)".

// `numero` é o telefone completo (sem DDD). Ele só pode existir dentro do leitor
// e da média (mesclar.ts), que o descarta ao mascarar o rótulo.
export interface LinhaLida {
  ddd: string;
  numero: string;
  valorMensal: number | null;
  planoGb: number | null;
  temMonitor: boolean;
  consumoMb: number;
}

// O pdf.js extrai cada glifo acentuado como um item de texto à parte, e o join
// com espaço deixa um espaço de sobra colado ao acento ("LIGAÇÕES" vira
// "LIGA ÇÕ ES", "Pós" vira "P ó s"). Remove o espaço dos dois lados de cada
// caractere acentuado latino, o que reconstrói a palavra sem afetar o espaço
// entre palavras sem acento.
export function normalizarAcentosPdf(texto: string): string {
  return texto.replace(/\s+(?=[À-ÖØ-öø-ÿ])/g, "").replace(/(?<=[À-ÖØ-öø-ÿ])\s+/g, "");
}

// Formato brasileiro: "1.234,56" vira 1234.56. Vazio ou ilegível vira 0.
function lerNumeroBR(texto: string): number {
  const limpo = texto.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const numero = parseFloat(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

const TITULO_DO_BLOCO = "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR";

export function extrairLinhasFatura(textoBruto: string): LinhaLida[] {
  if (!textoBruto) return [];
  const texto = normalizarAcentosPdf(textoBruto);
  const blocos = texto.split(TITULO_DO_BLOCO).slice(1);

  const linhas: LinhaLida[] = [];
  for (const bloco of blocos) {
    const cabecalho = bloco.match(/\((\d{2})\)\s*(\d{4,5})[\s-]*(\d{4})/);
    if (!cabecalho) continue;

    const trechoMatch = bloco.match(
      /Mensalidades e Pacotes Promocionais([\s\S]*?)(?:Interurbanas|Ligações Locais|Serviços \(Torpedos|TOTAL\s)/
    );
    const trecho = trechoMatch ? trechoMatch[1] : bloco.slice(0, 1000);
    const oferta = trecho.match(/Oferta Conjunta Claro MIX\s+([\d.,]+)/);
    const plano = trecho.match(/Claro P[oó]s\s+(\d+)\s*GB\s*-/i);
    if (!oferta && !plano) continue; // linha sem uso no período

    // O primeiro "Subtotal" depois de "Internet (MB)" é o total de MB da linha,
    // porque o bloco já termina no próximo "DETALHAMENTO...". Sem a seção, o
    // consumo é zero (não usou internet), não "sem dado".
    const internet = bloco.match(/Internet \(MB\)[\s\S]*?Subtotal\s+([\d.,]+)/);

    linhas.push({
      ddd: cabecalho[1],
      numero: cabecalho[2] + cabecalho[3],
      valorMensal: oferta ? lerNumeroBR(oferta[1]) : null,
      planoGb: plano ? parseInt(plano[1], 10) : null,
      temMonitor: /Claro Monitor(?: lite)?\s*-/i.test(trecho),
      consumoMb: internet ? lerNumeroBR(internet[1]) : 0,
    });
  }
  return linhas;
}

export type Leitura =
  | { tipo: "sem_texto" }
  | { tipo: "sem_linhas" }
  | { tipo: "ok"; linhas: LinhaLida[] };

// Separa "o PDF não tem texto" (escaneado ou foto) de "tem texto, mas não é o
// layout que o leitor conhece": as duas mandam o consultor digitar, com avisos
// diferentes.
export function interpretarLeitura(texto: string): Leitura {
  if (!texto.trim()) return { tipo: "sem_texto" };
  const linhas = extrairLinhasFatura(texto);
  return linhas.length > 0 ? { tipo: "ok", linhas } : { tipo: "sem_linhas" };
}

export function mensagemDeLeitura(
  nomeArquivo: string,
  leitura: { tipo: "sem_texto" } | { tipo: "sem_linhas" }
): string {
  if (leitura.tipo === "sem_texto") {
    return `"${nomeArquivo}" não tem texto (parece escaneado ou foto). Digite as linhas na tabela abaixo.`;
  }
  return `Não encontrei linhas de celular em "${nomeArquivo}". O leitor só conhece a fatura Claro com detalhamento por linha; digite as linhas na tabela abaixo.`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/fatura/extrair.test.ts`
Expected: PASS. Se o teste "extrai telefone, valor…" falhar na comparação do valor `5120.5`, confira `lerNumeroBR("5.120,50")`: tem vírgula, então remove os pontos e troca a vírgula (`5120.50`).

- [ ] **Step 5: Commit**

```bash
git add lib/fatura/extrair.ts lib/fatura/extrair.test.ts
git commit -m "feat(crm-fibra): add invoice line reader ported from the painel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Média de faturas e conversão para linhas da situação atual

**Files:**
- Create: `lib/fatura/mesclar.ts`, `lib/fatura/mesclar.test.ts`

**Interfaces:**
- Consumes: `LinhaLida` (`lib/fatura/extrair.ts`); `LinhaAtual`, `rotuloDaLinha` (`lib/fatura/tipos.ts`).
- Produces (`lib/fatura/mesclar.ts`):
  - `interface LinhaMesclada { ddd: string; numero: string; planoGb: number | null; planoGbDistintos: number[]; valorMensal: number | null; valorMensalMin: number | null; valorMensalMax: number | null; consumoMb: number; consumoMbMin: number; consumoMbMax: number; temMonitor: boolean; faturasEncontradas: number; totalFaturas: number }`
  - `mesclarFaturas(listas: LinhaLida[][]): LinhaMesclada[]`
  - `avisosDaLinha(linha: LinhaMesclada): string[]`
  - `paraLinhasAtuais(linhas: LinhaMesclada[]): LinhaAtual[]` (descarta o número completo: devolve só o rótulo mascarado)

- [ ] **Step 1: Escrever os testes (vão falhar)**

Crie `lib/fatura/mesclar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LinhaLida } from "./extrair";
import { avisosDaLinha, mesclarFaturas, paraLinhasAtuais } from "./mesclar";
import { temNumeroCompleto } from "./tipos";

function lida(parcial: Partial<LinhaLida> = {}): LinhaLida {
  return { ddd: "17", numero: "900000001", valorMensal: 48.49, planoGb: 10, temMonitor: false, consumoMb: 1000, ...parcial };
}

describe("mesclarFaturas", () => {
  it("com uma fatura nada muda: média = valor, faixa = valor, 1 de 1", () => {
    expect(mesclarFaturas([[lida()]])).toEqual([
      {
        ddd: "17",
        numero: "900000001",
        planoGb: 10,
        planoGbDistintos: [10],
        valorMensal: 48.49,
        valorMensalMin: 48.49,
        valorMensalMax: 48.49,
        consumoMb: 1000,
        consumoMbMin: 1000,
        consumoMbMax: 1000,
        temMonitor: false,
        faturasEncontradas: 1,
        totalFaturas: 1,
      },
    ]);
  });

  it("com duas faturas calcula média e faixa de valor e de consumo", () => {
    const [m] = mesclarFaturas([
      [lida({ valorMensal: 48.5, consumoMb: 1000 })],
      [lida({ valorMensal: 50.5, consumoMb: 3001 })],
    ]);
    expect(m.valorMensal).toBe(49.5);
    expect(m.valorMensalMin).toBe(48.5);
    expect(m.valorMensalMax).toBe(50.5);
    expect(m.consumoMb).toBe(2000.5);
    expect(m.consumoMbMin).toBe(1000);
    expect(m.consumoMbMax).toBe(3001);
    expect(m.faturasEncontradas).toBe(2);
    expect(m.totalFaturas).toBe(2);
  });

  it("linha que aparece só em uma das faturas fica marcada (1 de 2)", () => {
    const resultado = mesclarFaturas([[lida(), lida({ numero: "900000002" })], [lida()]]);
    expect(resultado.map((l) => [l.numero, l.faturasEncontradas, l.totalFaturas])).toEqual([
      ["900000001", 2, 2],
      ["900000002", 1, 2],
    ]);
  });

  it("plano que mudou: vale o da fatura anexada por último e lista os distintos", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: 20 })], [lida({ planoGb: 30 })]]);
    expect(m.planoGb).toBe(30);
    expect(m.planoGbDistintos).toEqual([20, 30]);
  });

  it("plano mais frequente vence (20, 20, 30 → 20)", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: 20 })], [lida({ planoGb: 20 })], [lida({ planoGb: 30 })]]);
    expect(m.planoGb).toBe(20);
  });

  it("valor nulo em todas as faturas continua nulo; em uma só, a média usa as que têm valor", () => {
    expect(mesclarFaturas([[lida({ valorMensal: null })]])[0]).toMatchObject({
      valorMensal: null,
      valorMensalMin: null,
      valorMensalMax: null,
    });
    const [m] = mesclarFaturas([[lida({ valorMensal: null })], [lida({ valorMensal: 60 })]]);
    expect(m.valorMensal).toBe(60);
  });

  it("plano nulo em todas as faturas continua nulo", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: null })]]);
    expect(m.planoGb).toBeNull();
    expect(m.planoGbDistintos).toEqual([]);
  });

  it("mesmo número com DDD diferente não se mistura", () => {
    expect(mesclarFaturas([[lida({ ddd: "17" }), lida({ ddd: "11" })]])).toHaveLength(2);
  });

  it("mantém a ordem da primeira aparição e soma o Claro Monitor se qualquer fatura tiver", () => {
    const resultado = mesclarFaturas([
      [lida({ numero: "900000002" }), lida({ numero: "900000001" })],
      [lida({ numero: "900000001", temMonitor: true })],
    ]);
    expect(resultado.map((l) => l.numero)).toEqual(["900000002", "900000001"]);
    expect(resultado[1].temMonitor).toBe(true);
    expect(resultado[0].temMonitor).toBe(false);
  });

  it("sem faturas devolve lista vazia", () => {
    expect(mesclarFaturas([])).toEqual([]);
    expect(mesclarFaturas([[]])).toEqual([]);
  });
});

describe("avisosDaLinha", () => {
  const base = mesclarFaturas([[lida()]])[0];

  it("linha normal de uma fatura não tem aviso", () => {
    expect(avisosDaLinha(base)).toEqual([]);
  });

  it("avisa quando a linha só apareceu em parte das faturas", () => {
    expect(avisosDaLinha({ ...base, faturasEncontradas: 1, totalFaturas: 2 })).toEqual(["Linha achada em 1 de 2 faturas."]);
  });

  it("avisa quando o plano mudou no período", () => {
    expect(avisosDaLinha({ ...base, planoGbDistintos: [20, 30] })).toEqual(["Plano mudou no período (20GB, 30GB)."]);
  });

  it("avisa quando a mensalidade ou o plano não foram encontrados", () => {
    expect(avisosDaLinha({ ...base, valorMensal: null })).toEqual(["Mensalidade não encontrada na fatura: preencha o valor."]);
    expect(avisosDaLinha({ ...base, planoGb: null })).toEqual([
      "Plano atual não identificado: a sugestão por consumo fica indisponível.",
    ]);
  });
});

describe("paraLinhasAtuais", () => {
  const mescladas = mesclarFaturas([[lida({ numero: "900000001" }), lida({ ddd: "11", numero: "30000002", valorMensal: null })]]);
  const linhas = paraLinhasAtuais(mescladas);

  it("vira linha da situação atual: quantidade 1, origem fatura, ainda sem plano proposto", () => {
    expect(linhas[0]).toEqual({
      rotulo: "(17) ••••• 0001",
      quantidade: 1,
      planoGb: 10,
      valorUnitario: 48.49,
      consumoMb: 1000,
      origem: "fatura",
      proposto: null,
    });
  });

  it("valor não encontrado vira 0, para o consultor preencher", () => {
    expect(linhas[1].valorUnitario).toBe(0);
    expect(linhas[1].rotulo).toBe("(11) ••••• 0002");
  });

  it("o número completo não sobrevive à conversão", () => {
    for (const linha of linhas) {
      expect(temNumeroCompleto(linha.rotulo)).toBe(false);
      expect(Object.keys(linha)).not.toContain("numero");
    }
    const json = JSON.stringify(linhas);
    expect(json).not.toContain("900000001");
    expect(json).not.toContain("30000002");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/fatura/mesclar.test.ts`
Expected: FAIL — `Cannot find module './mesclar'`.

- [ ] **Step 3: Implementar**

Crie `lib/fatura/mesclar.ts`:

```ts
// Média de 1 a 6 faturas por linha, portada de mesclarLinhasFaturas() do painel
// (REGRAS_NEGOCIO.md seção 29): o consumo de um único mês pode ser atípico, então
// valor e consumo viram a média do período, com a faixa observada.
import type { LinhaLida } from "./extrair";
import { rotuloDaLinha, type LinhaAtual } from "./tipos";

export interface LinhaMesclada {
  ddd: string;
  numero: string; // completo: só vive aqui dentro, paraLinhasAtuais() o descarta
  planoGb: number | null;
  planoGbDistintos: number[];
  valorMensal: number | null;
  valorMensalMin: number | null;
  valorMensalMax: number | null;
  consumoMb: number;
  consumoMbMin: number;
  consumoMbMax: number;
  temMonitor: boolean;
  faturasEncontradas: number;
  totalFaturas: number;
}

const arredondar = (valor: number) => Math.round(valor * 100) / 100;
const media = (valores: number[]) => valores.reduce((soma, valor) => soma + valor, 0) / valores.length;

// Plano mais frequente; no empate vale o da fatura anexada por último (a mais
// recente, se os arquivos foram anexados em ordem cronológica).
function planoMaisFrequente(gbs: number[]): number | null {
  if (gbs.length === 0) return null;
  const contagem = new Map<number, number>();
  for (const gb of gbs) contagem.set(gb, (contagem.get(gb) ?? 0) + 1);
  let melhor = gbs[gbs.length - 1];
  let maior = 0;
  for (const gb of gbs) {
    const quantas = contagem.get(gb) ?? 0;
    if (quantas >= maior) {
      maior = quantas;
      melhor = gb;
    }
  }
  return melhor;
}

export function mesclarFaturas(listas: LinhaLida[][]): LinhaMesclada[] {
  const totalFaturas = listas.length;
  const grupos = new Map<string, LinhaLida[]>();
  for (const linhas of listas) {
    for (const linha of linhas) {
      const chave = `${linha.ddd}${linha.numero}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
    }
  }

  return [...grupos.values()].map((ocorrencias) => {
    const valores = ocorrencias.map((o) => o.valorMensal).filter((v): v is number => v !== null);
    const consumos = ocorrencias.map((o) => o.consumoMb);
    const gbs = ocorrencias.map((o) => o.planoGb).filter((v): v is number => v !== null);
    return {
      ddd: ocorrencias[0].ddd,
      numero: ocorrencias[0].numero,
      planoGb: planoMaisFrequente(gbs),
      planoGbDistintos: gbs.filter((gb, indice) => gbs.indexOf(gb) === indice),
      valorMensal: valores.length ? arredondar(media(valores)) : null,
      valorMensalMin: valores.length ? Math.min(...valores) : null,
      valorMensalMax: valores.length ? Math.max(...valores) : null,
      consumoMb: arredondar(media(consumos)),
      consumoMbMin: Math.min(...consumos),
      consumoMbMax: Math.max(...consumos),
      temMonitor: ocorrencias.some((o) => o.temMonitor),
      faturasEncontradas: ocorrencias.length,
      totalFaturas,
    };
  });
}

export function avisosDaLinha(linha: LinhaMesclada): string[] {
  const avisos: string[] = [];
  if (linha.valorMensal === null) avisos.push("Mensalidade não encontrada na fatura: preencha o valor.");
  if (linha.planoGb === null) {
    avisos.push("Plano atual não identificado: a sugestão por consumo fica indisponível.");
  }
  if (linha.totalFaturas > 1 && linha.faturasEncontradas < linha.totalFaturas) {
    avisos.push(`Linha achada em ${linha.faturasEncontradas} de ${linha.totalFaturas} faturas.`);
  }
  if (linha.planoGbDistintos.length > 1) {
    avisos.push(`Plano mudou no período (${linha.planoGbDistintos.map((gb) => `${gb}GB`).join(", ")}).`);
  }
  return avisos;
}

// Aqui o número completo é descartado: só o rótulo mascarado segue adiante.
export function paraLinhasAtuais(linhas: LinhaMesclada[]): LinhaAtual[] {
  return linhas.map((linha) => ({
    rotulo: rotuloDaLinha(linha.ddd, linha.numero),
    quantidade: 1,
    planoGb: linha.planoGb,
    valorUnitario: linha.valorMensal ?? 0,
    consumoMb: linha.consumoMb,
    origem: "fatura" as const,
    proposto: null,
  }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/fatura/mesclar.test.ts`
Expected: PASS. (No teste "avisos", a ordem dos avisos é: mensalidade, plano, achada em, mudou. Os testes isolam cada caso, então a ordem só importa se vários coincidirem.)

- [ ] **Step 5: Commit**

```bash
git add lib/fatura/mesclar.ts lib/fatura/mesclar.test.ts
git commit -m "feat(crm-fibra): average several invoices per line and mask phone numbers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Catálogo com franquia (lib e cadastro do admin)

**Files:**
- Modify: `lib/catalogo.ts`, `lib/catalogo.test.ts`
- Modify: `app/(protected)/catalogo/actions.ts`, `app/(protected)/catalogo/actions.test.ts`, `app/(protected)/catalogo/novo-plano-form.tsx`

**Interfaces:**
- Produces (`lib/catalogo.ts`):
  - `PlanoCatalogo` ganha `franquiaGb: number | null`
  - `CATEGORIAS_COM_FRANQUIA: readonly CategoriaCatalogo[]` (= `["pos_nacional", "pos_regional"]`) e `categoriaTemFranquia(categoria: CategoriaCatalogo): boolean`
  - `criarPlano` aceita `franquiaGb?: number | null` e grava `franquia_gb`

- [ ] **Step 1: Escrever os testes novos de `lib/catalogo.test.ts` (vão falhar)**

Em `lib/catalogo.test.ts`, acrescente `categoriaTemFranquia` à lista de imports de `"./catalogo"`:

```ts
import {
  listarCatalogo,
  agruparPorCategoria,
  criarPlano,
  atualizarPlano,
  definirPlanoAtivo,
  categoriaTemFranquia,
  PlanoJaExisteError,
  CATEGORIAS_CATALOGO,
  type PlanoCatalogo,
} from "./catalogo";
```

Troque as duas fixtures do topo (`row` e `plano`) por estas, que ganham a franquia:

```ts
const row = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
  franquia_gb: null,
};

const plano: PlanoCatalogo = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
  franquiaGb: null,
};
```

No teste "insere os campos do plano e devolve o plano criado", acrescente `franquia_gb: null` ao objeto esperado de `client.__inserted` (depois de `observacao: ...`). Depois, acrescente ao **fim** do arquivo:

```ts
describe("franquia dos planos Pós", () => {
  const rowPos = { ...row, categoria: "pos_nacional", nome: "Pós 40GB", franquia_gb: 40 };

  it("mapeia franquia_gb para franquiaGb", async () => {
    const client = makeQueryFake({ data: [rowPos], error: null });
    const [lido] = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(lido.franquiaGb).toBe(40);
  });

  it("linha sem franquia_gb (ou nula) vira franquiaGb nulo", async () => {
    const { franquia_gb: _removida, ...semFranquia } = row;
    const client = makeQueryFake({ data: [semFranquia], error: null });
    const [lido] = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(lido.franquiaGb).toBeNull();
  });

  it("criarPlano grava franquia_gb quando informada", async () => {
    const client = makeQueryFake({ data: rowPos, error: null });
    const criado = await criarPlano(client as unknown as SupabaseClient, {
      categoria: "pos_nacional",
      nome: "Pós 40GB",
      valor: 54.99,
      franquiaGb: 40,
    });
    expect(client.__inserted.franquia_gb).toBe(40);
    expect(criado.franquiaGb).toBe(40);
  });

  it("criarPlano grava franquia_gb nula quando omitida", async () => {
    const client = makeQueryFake({ data: row, error: null });
    await criarPlano(client as unknown as SupabaseClient, { categoria: "adicional", nome: "X", valor: 5 });
    expect(client.__inserted.franquia_gb).toBeNull();
  });

  it("só as categorias Pós têm franquia", () => {
    expect(categoriaTemFranquia("pos_nacional")).toBe(true);
    expect(categoriaTemFranquia("pos_regional")).toBe(true);
    for (const categoria of ["convergente", "banda_larga", "adicional"] as const) {
      expect(categoriaTemFranquia(categoria)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/catalogo.test.ts`
Expected: FAIL — `categoriaTemFranquia is not a function` e `franquiaGb` indefinido.

- [ ] **Step 3: Alterar `lib/catalogo.ts`**

Faça estas quatro edições (cada trecho antigo é único no arquivo):

1. Em `export interface PlanoCatalogo {`, acrescente o campo no fim (depois de `ativo: boolean;`):

```ts
export interface PlanoCatalogo {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
  franquiaGb: number | null;
}
```

2. Em `interface PlanoRow {` (a de linha do banco), idem:

```ts
interface PlanoRow {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
  franquia_gb?: number | null;
}
```

3. Em `toPlano`, devolva também a franquia (linha antiga do banco, anterior à migração, vira `null`):

```ts
function toPlano(row: PlanoRow): PlanoCatalogo {
  return {
    id: row.id,
    categoria: row.categoria,
    nome: row.nome,
    valor: row.valor,
    observacao: row.observacao,
    ativo: row.ativo,
    franquiaGb: row.franquia_gb ?? null,
  };
}
```

4. Em `criarPlano`, troque a assinatura e o `insert`:

```ts
export async function criarPlano(
  client: SupabaseClient,
  input: {
    categoria: CategoriaCatalogo;
    nome: string;
    valor: number;
    observacao?: string | null;
    franquiaGb?: number | null;
  }
): Promise<PlanoCatalogo> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .insert({
      categoria: input.categoria,
      nome: input.nome,
      valor: input.valor,
      observacao: input.observacao ?? null,
      franquia_gb: input.franquiaGb ?? null,
    })
    .select()
    .single();
```

(mantenha o restante de `criarPlano`, o tratamento do erro `23505`, como está). Acrescente, logo abaixo de `ROTULO_CATEGORIA`:

```ts
// Só os Pós têm franquia em GB: é ela que a sugestão por consumo e o "consolidar
// valores" usam. Banda larga, convergentes e adicionais não têm.
export const CATEGORIAS_COM_FRANQUIA: readonly CategoriaCatalogo[] = ["pos_nacional", "pos_regional"];

export function categoriaTemFranquia(categoria: CategoriaCatalogo): boolean {
  return CATEGORIAS_COM_FRANQUIA.includes(categoria);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/catalogo.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever os testes novos da action do admin (vão falhar)**

Em `app/(protected)/catalogo/actions.test.ts`:

(a) No teste "cria o plano com valor em formato brasileiro e observação em branco virando null", acrescente `franquiaGb: null,` ao objeto esperado de `toHaveBeenCalledWith` (depois de `observacao: null`).

(b) Dentro de `describe("criarPlanoAction", …)`, antes do teste "devolve a mensagem amigável quando o plano já existe", acrescente:

```ts
  describe("franquia (GB)", () => {
    const pos = { categoria: "pos_nacional", nome: "Pós 40GB", valor: "54,99", observacao: "" };

    it("é obrigatória nos planos Pós", async () => {
      logarComo(admin);
      const resultado = await criarPlanoAction({}, formData(pos));
      expect(resultado.erro).toMatch(/franquia/i);
      expect(criarPlano).not.toHaveBeenCalled();
    });

    it.each(["abc", "0", "4,5", "-3", "1001", "40GB", " "])("recusa franquia %j", async (franquia) => {
      logarComo(admin);
      const resultado = await criarPlanoAction({}, formData({ ...pos, franquia }));
      expect(resultado.erro).toMatch(/franquia/i);
      expect(criarPlano).not.toHaveBeenCalled();
    });

    it("grava a franquia inteira (já sem espaços) nos planos Pós", async () => {
      logarComo(admin);
      criarPlano.mockResolvedValue({ id: "p1" });
      const resultado = await criarPlanoAction({}, formData({ ...pos, franquia: " 40 " }));
      expect(resultado).toEqual({ sucesso: true });
      expect(criarPlano).toHaveBeenCalledWith({}, {
        categoria: "pos_nacional",
        nome: "Pós 40GB",
        valor: 54.99,
        observacao: null,
        franquiaGb: 40,
      });
    });

    it("ignora a franquia nas categorias que não têm", async () => {
      logarComo(admin);
      criarPlano.mockResolvedValue({ id: "p1" });
      await criarPlanoAction({}, formData({ ...camposValidos, franquia: "99" }));
      expect(criarPlano).toHaveBeenCalledWith({}, expect.objectContaining({ categoria: "adicional", franquiaGb: null }));
    });
  });
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run "app/(protected)/catalogo/actions.test.ts"`
Expected: FAIL (a action ainda não lê `franquia`).

- [ ] **Step 7: Alterar a action do admin**

Em `app/(protected)/catalogo/actions.ts`:

1. Acrescente `categoriaTemFranquia` ao import de `@/lib/catalogo`.
2. Logo abaixo de `const ERRO_VALOR = ...`, acrescente (funções **privadas**: arquivo `"use server"` só pode exportar funções assíncronas):

```ts
const ERRO_FRANQUIA = "Informe a franquia em GB (número inteiro de 1 a 1000)";

function lerFranquia(categoria: CategoriaCatalogo, texto: string): number | null | "erro" {
  if (!categoriaTemFranquia(categoria)) return null;
  const limpo = texto.trim();
  if (!/^\d{1,4}$/.test(limpo)) return "erro";
  const numero = Number(limpo);
  return numero >= 1 && numero <= 1000 ? numero : "erro";
}
```

3. Em `criarPlanoAction`, depois do `if (valor === null) return { erro: ERRO_VALOR };`, acrescente:

```ts
  const franquiaGb = lerFranquia(categoria as CategoriaCatalogo, String(formData.get("franquia") ?? ""));
  if (franquiaGb === "erro") return { erro: ERRO_FRANQUIA };
```

4. Na chamada de `criarPlano`, acrescente `franquiaGb,` depois de `observacao,`.

- [ ] **Step 8: Campo no formulário**

Em `app/(protected)/catalogo/novo-plano-form.tsx`, antes do `<div className="space-y-1">` do campo Observação (o que contém `htmlFor="novo-plano-observacao"`), acrescente:

```tsx
      <div className="space-y-1">
        <label htmlFor="novo-plano-franquia" className="text-xs text-muted-foreground">
          Franquia (GB)
        </label>
        <Input
          id="novo-plano-franquia"
          name="franquia"
          inputMode="numeric"
          placeholder="40"
          className="w-24"
        />
        <p className="text-[11px] text-muted-foreground">Obrigatória nos planos Pós</p>
      </div>
```

- [ ] **Step 9: Rodar tudo e conferir tipos**

Run: `npx vitest run && npx tsc --noEmit`
Expected: suíte toda verde; `tsc` sem erro. Se o `tsc` apontar outro arquivo que monta um `PlanoCatalogo` literal sem `franquiaGb`, acrescente `franquiaGb: null` nele (é só fixture).

- [ ] **Step 10: Commit**

```bash
git add lib/catalogo.ts lib/catalogo.test.ts "app/(protected)/catalogo/actions.ts" "app/(protected)/catalogo/actions.test.ts" "app/(protected)/catalogo/novo-plano-form.tsx"
git commit -m "feat(crm-fibra): add franchise (GB) to catalog plans and the admin form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sugestão de plano por consumo

**Files:**
- Create: `lib/fatura/sugestao.ts`, `lib/fatura/sugestao.test.ts`

**Interfaces:**
- Consumes: `PlanoCatalogo` (com `franquiaGb`, Task 6).
- Produces (`lib/fatura/sugestao.ts`):
  - `LIMIAR_UPGRADE_PCT = 90`, `LIMIAR_DOWNGRADE_PCT = 40`, `MARGEM_DOWNGRADE = 0.8`
  - `interface PlanoPos { id: string; nome: string; valor: number; franquiaGb: number }`
  - `planosPosNacional(catalogo: PlanoCatalogo[]): PlanoPos[]`
  - `type AcaoSugestao = "upgrade" | "downgrade" | "manter" | "indefinido"`
  - `interface Sugestao { acao: AcaoSugestao; pctFranquia: number | null; plano: PlanoPos | null }`
  - `sugerirPlano(linha: { planoGb: number | null; consumoMb: number | null }, planos: PlanoPos[]): Sugestao`

- [ ] **Step 1: Escrever os testes (vão falhar)**

Crie `lib/fatura/sugestao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import { planosPosNacional, sugerirPlano, type PlanoPos } from "./sugestao";

const planos: PlanoPos[] = [
  { id: "p12", nome: "Pós 12GB", valor: 39.99, franquiaGb: 12 },
  { id: "p40", nome: "Pós 40GB", valor: 54.99, franquiaGb: 40 },
  { id: "p70", nome: "Pós 70GB", valor: 74.99, franquiaGb: 70 },
  { id: "p100", nome: "Pós 100GB", valor: 89.99, franquiaGb: 100 },
  { id: "p150", nome: "Pós 150GB", valor: 149.99, franquiaGb: 150 },
];

const mb = (gb: number) => gb * 1024;

describe("sugerirPlano — upgrade (consumo a partir de 90% da franquia)", () => {
  it("sugere o menor plano maior que cobre o consumo", () => {
    const s = sugerirPlano({ planoGb: 10, consumoMb: mb(9.5) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p12");
    expect(s.pctFranquia).toBeCloseTo(95, 5);
  });

  it("pula planos que não cobrem o consumo", () => {
    const s = sugerirPlano({ planoGb: 50, consumoMb: mb(50) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p70");
  });

  it("no limite exato de 90% já é upgrade", () => {
    expect(sugerirPlano({ planoGb: 10, consumoMb: 9216 }, planos).acao).toBe("upgrade");
  });

  it("se nem o maior plano cobre o consumo, sugere o maior", () => {
    const s = sugerirPlano({ planoGb: 100, consumoMb: mb(200) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p150");
  });

  it("no maior plano do catálogo não há para onde subir: mantém", () => {
    const s = sugerirPlano({ planoGb: 150, consumoMb: mb(149) }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p150");
  });

  it("desempata planos da mesma franquia pelo mais barato", () => {
    const duplicados: PlanoPos[] = [
      ...planos,
      { id: "p40b", nome: "Pós 40GB promo", valor: 49.99, franquiaGb: 40 },
    ];
    expect(sugerirPlano({ planoGb: 30, consumoMb: mb(29) }, duplicados).plano?.id).toBe("p40b");
  });
});

describe("sugerirPlano — downgrade (consumo até 40% da franquia)", () => {
  it("sugere o maior plano menor cuja franquia, com folga de 20%, ainda cobre o consumo", () => {
    const s = sugerirPlano({ planoGb: 70, consumoMb: 3000 }, planos);
    expect(s.acao).toBe("downgrade");
    expect(s.plano?.id).toBe("p40");
  });

  it("no limite exato de 40% já é downgrade", () => {
    const s = sugerirPlano({ planoGb: 100, consumoMb: 40960 }, planos);
    expect(s.acao).toBe("downgrade");
    expect(s.plano?.id).toBe("p70");
  });

  it("respeita a margem: se o plano menor ficaria apertado, mantém", () => {
    expect(sugerirPlano({ planoGb: 40, consumoMb: 9000 }, planos)).toMatchObject({ acao: "downgrade" });
    expect(sugerirPlano({ planoGb: 40, consumoMb: 10000 }, planos)).toMatchObject({ acao: "manter" });
  });

  it("no menor plano do catálogo não há para onde descer: mantém", () => {
    const s = sugerirPlano({ planoGb: 12, consumoMb: 1000 }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p12");
  });

  it("consumo zero (não usou internet) conta como 0% e permite downgrade", () => {
    expect(sugerirPlano({ planoGb: 70, consumoMb: 0 }, planos).acao).toBe("downgrade");
  });
});

describe("sugerirPlano — manter e indefinido", () => {
  it("entre 40% e 90% mantém, no plano de franquia igual ou maior mais próximo", () => {
    const s = sugerirPlano({ planoGb: 20, consumoMb: mb(10) }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p40");
  });

  it("consumo desconhecido (linha digitada) nunca vira upgrade nem downgrade", () => {
    const s = sugerirPlano({ planoGb: 70, consumoMb: null }, planos);
    expect(s).toMatchObject({ acao: "manter", pctFranquia: null });
    expect(s.plano?.id).toBe("p70");
  });

  it("sem plano atual reconhecido é indefinido, sem plano sugerido", () => {
    expect(sugerirPlano({ planoGb: null, consumoMb: 1000 }, planos)).toEqual({
      acao: "indefinido",
      pctFranquia: null,
      plano: null,
    });
  });

  it("sem planos no catálogo é indefinido", () => {
    expect(sugerirPlano({ planoGb: 10, consumoMb: 1000 }, [])).toMatchObject({ acao: "indefinido", plano: null });
  });
});

describe("planosPosNacional", () => {
  const base: PlanoCatalogo = {
    id: "x",
    categoria: "pos_nacional",
    nome: "Pós 40GB",
    valor: 54.99,
    observacao: "por linha",
    ativo: true,
    franquiaGb: 40,
  };

  it("fica só com planos ativos, Pós Nacional e com franquia", () => {
    const catalogo: PlanoCatalogo[] = [
      base,
      { ...base, id: "inativo", ativo: false },
      { ...base, id: "regional", categoria: "pos_regional" },
      { ...base, id: "semfranquia", franquiaGb: null },
      { ...base, id: "banda", categoria: "banda_larga", franquiaGb: null },
    ];
    expect(planosPosNacional(catalogo)).toEqual([{ id: "x", nome: "Pós 40GB", valor: 54.99, franquiaGb: 40 }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/fatura/sugestao.test.ts`
Expected: FAIL — `Cannot find module './sugestao'`.

- [ ] **Step 3: Implementar**

Crie `lib/fatura/sugestao.ts`:

```ts
// Sugestão de plano por consumo, portada de sugerirPlanoConsumo() do painel
// (REGRAS_NEGOCIO.md seção 23). Limiares em % da franquia contratada, confirmados
// com o usuário: a partir de 90% sugere upgrade, até 40% sugere downgrade; no
// meio, mantém. 1 GB = 1024 MB.
import type { PlanoCatalogo } from "../catalogo";

export const LIMIAR_UPGRADE_PCT = 90;
export const LIMIAR_DOWNGRADE_PCT = 40;
// O plano de downgrade ainda precisa cobrir o consumo com 20% de folga, para não
// sugerir um plano que o cliente estouraria de novo no mês seguinte.
export const MARGEM_DOWNGRADE = 0.8;

export interface PlanoPos {
  id: string;
  nome: string;
  valor: number;
  franquiaGb: number;
}

// Só Pós Nacional ativo com franquia entra na sugestão automática: o regional
// continua disponível como escolha manual do consultor.
export function planosPosNacional(catalogo: PlanoCatalogo[]): PlanoPos[] {
  return catalogo.flatMap((plano) =>
    plano.ativo && plano.categoria === "pos_nacional" && plano.franquiaGb !== null
      ? [{ id: plano.id, nome: plano.nome, valor: plano.valor, franquiaGb: plano.franquiaGb }]
      : []
  );
}

export type AcaoSugestao = "upgrade" | "downgrade" | "manter" | "indefinido";

export interface Sugestao {
  acao: AcaoSugestao;
  pctFranquia: number | null;
  plano: PlanoPos | null;
}

function maisBarato(lista: PlanoPos[]): PlanoPos {
  return [...lista].sort((a, b) => a.valor - b.valor)[0];
}

export function sugerirPlano(
  linha: { planoGb: number | null; consumoMb: number | null },
  planos: PlanoPos[]
): Sugestao {
  const planoAtual = linha.planoGb;
  if (planos.length === 0 || !planoAtual) {
    return { acao: "indefinido", pctFranquia: null, plano: null };
  }

  // Consumo desconhecido (linha digitada) não permite concluir nada: só mantém.
  const consumo = linha.consumoMb ?? 0;
  const pct = linha.consumoMb === null ? null : (consumo / (planoAtual * 1024)) * 100;

  if (pct !== null && pct >= LIMIAR_UPGRADE_PCT) {
    const acima = planos.filter((p) => p.franquiaGb > planoAtual);
    if (acima.length > 0) {
      const cobrem = acima.filter((p) => p.franquiaGb * 1024 >= consumo);
      const candidatos = cobrem.length > 0 ? cobrem : acima; // nem o maior cobre: sugere o maior
      const menor = Math.min(...candidatos.map((p) => p.franquiaGb));
      return {
        acao: "upgrade",
        pctFranquia: pct,
        plano: maisBarato(candidatos.filter((p) => p.franquiaGb === menor)),
      };
    }
  }

  if (pct !== null && pct <= LIMIAR_DOWNGRADE_PCT) {
    const abaixo = planos.filter(
      (p) => p.franquiaGb < planoAtual && p.franquiaGb * 1024 * MARGEM_DOWNGRADE >= consumo
    );
    if (abaixo.length > 0) {
      const maior = Math.max(...abaixo.map((p) => p.franquiaGb));
      return {
        acao: "downgrade",
        pctFranquia: pct,
        plano: maisBarato(abaixo.filter((p) => p.franquiaGb === maior)),
      };
    }
  }

  const igualOuMaior = planos.filter((p) => p.franquiaGb >= planoAtual);
  const alvo =
    igualOuMaior.length > 0
      ? Math.min(...igualOuMaior.map((p) => p.franquiaGb))
      : Math.max(...planos.map((p) => p.franquiaGb));
  return {
    acao: "manter",
    pctFranquia: pct,
    plano: maisBarato(planos.filter((p) => p.franquiaGb === alvo)),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/fatura/sugestao.test.ts`
Expected: PASS. Se "respeita a margem" falhar, confira a conta: 12 GB × 1024 × 0,8 = 9830,4 MB; 9000 cabe e 10000 não.

- [ ] **Step 5: Commit**

```bash
git add lib/fatura/sugestao.ts lib/fatura/sugestao.test.ts
git commit -m "feat(crm-fibra): suggest a plan per line from real data consumption

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Itens da proposta com quantidade, derivados das linhas e CNPJ formatado

**Files:**
- Modify: `lib/propostas.ts` (substituir o arquivo), `lib/propostas.test.ts`
- Modify: `lib/proposta-rascunho.ts` (substituir), `lib/proposta-rascunho.test.ts` (substituir)
- Create: `lib/proposta/agrupar.ts`, `lib/proposta/agrupar.test.ts`
- Modify: `lib/formato.ts`, `lib/formato.test.ts`

**Interfaces:**
- Consumes: `PlanoCatalogo` (Task 6); `LinhaAtual`, `PlanoProposto`, `SituacaoAtual` (Task 3).
- Produces:
  - `lib/propostas.ts`: `NovoItemProposta { catalogoPlanoId: string | null; descricao: string; valor: number; quantidade: number; franquiaGb: number | null }` (`valor` = subtotal); `ItemProposta`; `Proposta` ganha `situacaoAtual: SituacaoAtual | null`; `LIMITE_QUANTIDADE_ITEM = 1000`; `subtotalDaLinha(valorUnitario: number, quantidade: number): number`; `valorUnitarioDoItem(item: { valor: number; quantidade: number }): number`; `criarProposta` aceita `situacaoAtual?: SituacaoAtual | null`.
  - `lib/proposta-rascunho.ts`: `LinhaRascunho` ganha `quantidade` e `franquiaGb`; `lerQuantidade(texto: string): number | null`; `adicionarLinhaCatalogo(rascunho, plano, chave, quantidade = 1)`; `adicionarLinhaAvulsa(rascunho, { descricao, valorTexto, quantidadeTexto? }, chave)`.
  - `lib/proposta/agrupar.ts`: `type LinhaEditavel = Omit<LinhaAtual, "proposto"> & { chave: string; planoId: string | null; avisos: string[] }`; `linhasComProposto(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): LinhaAtual[]`; `itensDasLinhas(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): NovoItemProposta[]`.
  - `lib/formato.ts`: `formatarCnpj(digitos: string): string`.

- [ ] **Step 1: Teste do `formatarCnpj` (vai falhar)**

Em `lib/formato.test.ts`, acrescente `formatarCnpj` ao import (`import { formatarBRL, parseValorBRL, formatarDataHora, formatarCnpj } from "./formato";`) e acrescente ao fim do arquivo:

```ts
describe("formatarCnpj", () => {
  it("formata 14 dígitos como 00.000.000/0000-00", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("aceita o CNPJ já com pontuação", () => {
    expect(formatarCnpj("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });

  it("devolve o texto como veio quando não tem 14 dígitos", () => {
    expect(formatarCnpj("123")).toBe("123");
    expect(formatarCnpj("")).toBe("");
  });
});
```

Run: `npx vitest run lib/formato.test.ts` — Expected: FAIL (`formatarCnpj is not a function`). Depois acrescente ao fim de `lib/formato.ts`:

```ts
// 14 dígitos viram 00.000.000/0000-00; qualquer outra coisa volta como veio
// (um documento incompleto não deve sumir da tela).
export function formatarCnpj(digitos: string): string {
  const d = digitos.replace(/\D/g, "");
  if (d.length !== 14) return digitos;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
```

Run: `npx vitest run lib/formato.test.ts` — Expected: PASS.

- [ ] **Step 2: Atualizar `lib/propostas.test.ts` (vai falhar)**

Faça estas edições (cada trecho antigo é único):

(a) Troque o trecho `const itensEntrada…` por:

```ts
const itensEntrada: NovoItemProposta[] = [
  { catalogoPlanoId: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9, quantidade: 1, franquiaGb: null },
  { catalogoPlanoId: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9, quantidade: 1, franquiaGb: null },
  { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 5, quantidade: 1, franquiaGb: null },
];
```

(b) No teste "grava o cabeçalho e depois os itens…", troque as três linhas de `expect(itens.payload).toEqual([ … ])` por:

```ts
      { proposta_id: "prop1", catalogo_plano_id: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9, quantidade: 1, franquia_gb: null, ordem: 0 },
      { proposta_id: "prop1", catalogo_plano_id: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9, quantidade: 1, franquia_gb: null, ordem: 1 },
      { proposta_id: "prop1", catalogo_plano_id: "p9", descricao: "Claro Monitor", valor: 5, quantidade: 1, franquia_gb: null, ordem: 2 },
```

(c) Em `describe("validarItensProposta", …)`, troque a linha `const ok: NovoItemProposta = …` por:

```ts
  const ok: NovoItemProposta = { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null };
```

(d) No import do topo, acrescente `subtotalDaLinha`, `valorUnitarioDoItem` e `LIMITE_QUANTIDADE_ITEM`:

```ts
import {
  somarValores,
  subtotalDaLinha,
  valorUnitarioDoItem,
  validarItensProposta,
  criarProposta,
  listarPropostasPorCnpj,
  LIMITE_DESCRICAO,
  LIMITE_QUANTIDADE_ITEM,
  type NovoItemProposta,
} from "./propostas";
```

(e) Acrescente ao **fim** do arquivo:

```ts
describe("subtotalDaLinha / valorUnitarioDoItem", () => {
  it("multiplica em centavos inteiros, sem erro de ponto flutuante", () => {
    expect(subtotalDaLinha(39.99, 7)).toBe(279.93);
    expect(subtotalDaLinha(0.1, 3)).toBe(0.3);
    expect(subtotalDaLinha(149.9, 1)).toBe(149.9);
  });

  it("o unitário é o subtotal dividido pela quantidade, em centavos", () => {
    expect(valorUnitarioDoItem({ valor: 279.93, quantidade: 7 })).toBe(39.99);
    expect(valorUnitarioDoItem({ valor: 5, quantidade: 1 })).toBe(5);
  });
});

describe("validarItensProposta — quantidade e franquia", () => {
  const ok: NovoItemProposta = { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null };

  it.each([0, -1, 1.5, Number.NaN, LIMITE_QUANTIDADE_ITEM + 1])("recusa quantidade %s", (quantidade) => {
    expect(validarItensProposta([{ ...ok, quantidade }])).toMatch(/quantidade/);
  });

  it("aceita os extremos de quantidade", () => {
    expect(validarItensProposta([{ ...ok, quantidade: 1 }])).toBeNull();
    expect(validarItensProposta([{ ...ok, quantidade: LIMITE_QUANTIDADE_ITEM }])).toBeNull();
  });

  it.each([0, -3, 2.5, 1001])("recusa franquia %s", (franquiaGb) => {
    expect(validarItensProposta([{ ...ok, franquiaGb }])).toMatch(/franquia/);
  });

  it("aceita franquia nula ou inteira", () => {
    expect(validarItensProposta([{ ...ok, franquiaGb: null }])).toBeNull();
    expect(validarItensProposta([{ ...ok, franquiaGb: 40 }])).toBeNull();
  });
});

describe("criarProposta — quantidade, franquia e situação atual", () => {
  const situacao = {
    faturasAnalisadas: 1,
    linhas: [
      { rotulo: "(17) ••••• 0001", quantidade: 1, planoGb: 10, valorUnitario: 48.49, consumoMb: 1000, origem: "fatura" as const, proposto: null },
    ],
  };

  it("grava quantidade e franquia_gb dos itens, e o total soma os subtotais", async () => {
    const client = bancoQueAceitaTudo();
    const proposta = await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: [
        { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: 279.93, quantidade: 7, franquiaGb: 12 },
        { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 35, quantidade: 7, franquiaGb: null },
      ],
    });
    const itens = client.operacoes.find((op: Operacao) => op.tabela === "proposta_itens");
    expect(itens.payload).toEqual([
      expect.objectContaining({ valor: 279.93, quantidade: 7, franquia_gb: 12, ordem: 0 }),
      expect.objectContaining({ valor: 35, quantidade: 7, franquia_gb: null, ordem: 1 }),
    ]);
    expect(proposta.total).toBe(314.93);
    expect(proposta.itens.map((i) => [i.quantidade, i.franquiaGb])).toEqual([
      [7, 12],
      [7, null],
    ]);
  });

  it("grava a situação atual no cabeçalho (e nulo quando não há fatura)", async () => {
    const comFatura = bancoQueAceitaTudo();
    await criarProposta(comFatura as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
      situacaoAtual: situacao,
    });
    expect(comFatura.operacoes[0].payload.situacao_atual).toEqual(situacao);

    const semFatura = bancoQueAceitaTudo();
    await criarProposta(semFatura as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
    });
    expect(semFatura.operacoes[0].payload.situacao_atual).toBeNull();
  });
});

describe("listarPropostasPorCnpj — campos novos", () => {
  it("devolve quantidade, franquia e situação atual; linha antiga (sem as colunas) vira 1, nulo e nulo", async () => {
    const situacao = { faturasAnalisadas: 1, linhas: [] };
    const client = makeClientFake((op) => {
      if (op.tabela === "propostas") {
        return {
          data: [
            { id: "nova", cnpj_digits: "00005087000190", consultor_id: "c1", criado_em: "2026-10-08T17:32:00Z", situacao_atual: situacao },
            { id: "antiga", cnpj_digits: "00005087000190", consultor_id: "c1", criado_em: "2026-10-01T12:00:00Z" },
          ],
          error: null,
        };
      }
      return {
        data: [
          { id: "i1", proposta_id: "nova", catalogo_plano_id: "p12", descricao: "A", valor: 279.93, ordem: 0, quantidade: 7, franquia_gb: 12 },
          { id: "i2", proposta_id: "antiga", catalogo_plano_id: null, descricao: "B", valor: 10, ordem: 0 },
        ],
        error: null,
      };
    });

    const [nova, antiga] = await listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190");

    expect(nova.situacaoAtual).toEqual(situacao);
    expect(nova.itens[0]).toMatchObject({ quantidade: 7, franquiaGb: 12 });
    expect(antiga.situacaoAtual).toBeNull();
    expect(antiga.itens[0]).toMatchObject({ quantidade: 1, franquiaGb: null });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run lib/propostas.test.ts lib/formato.test.ts`
Expected: FAIL — `subtotalDaLinha is not a function` e os payloads sem `quantidade`.

- [ ] **Step 4: Substituir `lib/propostas.ts`**

Substitua o conteúdo inteiro de `lib/propostas.ts` por:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SituacaoAtual } from "./fatura/tipos";

export interface NovoItemProposta {
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number; // subtotal da linha: quantidade x valor unitário
  quantidade: number;
  franquiaGb: number | null; // só os planos Pós têm; é a cópia que a proposta guarda
}

export interface ItemProposta extends NovoItemProposta {
  id: string;
  ordem: number;
}

export interface Proposta {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  criadoEm: string;
  itens: ItemProposta[];
  total: number;
  situacaoAtual: SituacaoAtual | null;
}

interface PropostaRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  criado_em: string;
  situacao_atual?: SituacaoAtual | null;
}

interface ItemRow {
  id: string;
  proposta_id: string;
  catalogo_plano_id: string | null;
  descricao: string;
  valor: number;
  ordem: number;
  quantidade?: number;
  franquia_gb?: number | null;
}

export const LIMITE_DESCRICAO = 300;
export const LIMITE_QUANTIDADE_ITEM = 1000;
const LIMITE_FRANQUIA_ITEM = 1000;

// Soma em centavos inteiros: 0.1 + 0.2 em ponto flutuante não dá 0.3.
export function somarValores(valores: number[]): number {
  const centavos = valores.reduce((soma, valor) => soma + Math.round(valor * 100), 0);
  return centavos / 100;
}

// Subtotal de uma linha (valor unitário x quantidade), também em centavos
// inteiros: 39,99 x 7 tem que dar 279,93 e não 279,92999999999995.
export function subtotalDaLinha(valorUnitario: number, quantidade: number): number {
  return (Math.round(valorUnitario * 100) * quantidade) / 100;
}

export function valorUnitarioDoItem(item: { valor: number; quantidade: number }): number {
  return Math.round((item.valor * 100) / item.quantidade) / 100;
}

export function validarItensProposta(itens: NovoItemProposta[]): string | null {
  if (itens.length === 0) return "Adicione pelo menos uma linha à proposta";
  for (const item of itens) {
    if (!item.descricao.trim()) return "Toda linha precisa de uma descrição";
    if (item.descricao.length > LIMITE_DESCRICAO) {
      return `A descrição de uma linha passou de ${LIMITE_DESCRICAO} caracteres`;
    }
    if (!Number.isFinite(item.valor) || item.valor <= 0) {
      return "Toda linha precisa de um valor maior que zero";
    }
    if (
      !Number.isInteger(item.quantidade) ||
      item.quantidade < 1 ||
      item.quantidade > LIMITE_QUANTIDADE_ITEM
    ) {
      return `Toda linha precisa de uma quantidade de 1 a ${LIMITE_QUANTIDADE_ITEM}`;
    }
    if (
      item.franquiaGb !== null &&
      (!Number.isInteger(item.franquiaGb) || item.franquiaGb < 1 || item.franquiaGb > LIMITE_FRANQUIA_ITEM)
    ) {
      return "A franquia de uma linha é inválida";
    }
  }
  return null;
}

function toProposta(row: PropostaRow, itensRows: ItemRow[]): Proposta {
  const itens: ItemProposta[] = [...itensRows]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => ({
      id: item.id,
      catalogoPlanoId: item.catalogo_plano_id,
      descricao: item.descricao,
      valor: item.valor,
      quantidade: item.quantidade ?? 1,
      franquiaGb: item.franquia_gb ?? null,
      ordem: item.ordem,
    }));
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    criadoEm: row.criado_em,
    itens,
    total: somarValores(itens.map((item) => item.valor)),
    situacaoAtual: row.situacao_atual ?? null,
  };
}

export async function criarProposta(
  client: SupabaseClient,
  input: {
    cnpjDigits: string;
    consultorId: string;
    itens: NovoItemProposta[];
    situacaoAtual?: SituacaoAtual | null;
  }
): Promise<Proposta> {
  const { data: cabecalho, error: erroCabecalho } = await client
    .schema("crm_fibra")
    .from("propostas")
    .insert({
      cnpj_digits: input.cnpjDigits,
      consultor_id: input.consultorId,
      situacao_atual: input.situacaoAtual ?? null,
    })
    .select()
    .single();
  if (erroCabecalho) throw erroCabecalho;
  const propostaRow = cabecalho as PropostaRow;

  const linhas = input.itens.map((item, ordem) => ({
    proposta_id: propostaRow.id,
    catalogo_plano_id: item.catalogoPlanoId,
    descricao: item.descricao,
    valor: item.valor,
    quantidade: item.quantidade,
    franquia_gb: item.franquiaGb,
    ordem,
  }));
  const { data: itensRows, error: erroItens } = await client
    .schema("crm_fibra")
    .from("proposta_itens")
    .insert(linhas)
    .select();

  if (erroItens) {
    // Sem transação multi-tabela no cliente Supabase: desfaz o cabeçalho
    // para não deixar uma proposta vazia no histórico do cliente.
    await client.schema("crm_fibra").from("propostas").delete().eq("id", propostaRow.id);
    throw erroItens;
  }

  return toProposta(propostaRow, (itensRows as ItemRow[] | null) ?? []);
}

const TAMANHO_PAGINA_ITENS = 1000;

// O PostgREST corta toda resposta em 1000 linhas, em silêncio: uma empresa
// com muitas linhas por proposta e várias revisões passaria disso e a tela
// mostraria itens faltando e um total errado, sem nenhum erro.
async function buscarItens(client: SupabaseClient, propostaIds: string[]): Promise<ItemRow[]> {
  const todos: ItemRow[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_ITENS) {
    const { data, error } = await client
      .schema("crm_fibra")
      .from("proposta_itens")
      .select()
      .in("proposta_id", propostaIds)
      .order("proposta_id", { ascending: true })
      .order("ordem", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA_ITENS - 1);
    if (error) throw error;

    const pagina = (data as ItemRow[] | null) ?? [];
    todos.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA_ITENS) return todos;
  }
}

export async function listarPropostasPorCnpj(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Proposta[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("propostas")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const propostas = (data as PropostaRow[] | null) ?? [];
  if (propostas.length === 0) return [];

  const itens = await buscarItens(
    client,
    propostas.map((proposta) => proposta.id)
  );
  return propostas.map((proposta) =>
    toProposta(
      proposta,
      itens.filter((item) => item.proposta_id === proposta.id)
    )
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/propostas.test.ts lib/formato.test.ts`
Expected: PASS.

- [ ] **Step 6: Reescrever `lib/proposta-rascunho.test.ts` (vai falhar)**

Substitua o conteúdo inteiro de `lib/proposta-rascunho.test.ts` por:

```ts
import { describe, it, expect } from "vitest";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  descricaoDoPlano,
  itensParaSalvar,
  lerQuantidade,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "./proposta-rascunho";
import type { PlanoCatalogo } from "./catalogo";

const planoEscalonado: PlanoCatalogo = {
  id: "p3",
  categoria: "banda_larga",
  nome: "600 Mega (G1 Padrão)",
  valor: 59.9,
  observacao: "Por 3 meses, depois R$99,90",
  ativo: true,
  franquiaGb: null,
};

const planoSimples: PlanoCatalogo = {
  id: "p9",
  categoria: "adicional",
  nome: "Claro Monitor",
  valor: 5,
  observacao: null,
  ativo: true,
  franquiaGb: null,
};

const planoPos: PlanoCatalogo = {
  id: "p12",
  categoria: "pos_nacional",
  nome: "Pós 12GB",
  valor: 39.99,
  observacao: "por linha",
  ativo: true,
  franquiaGb: 12,
};

describe("descricaoDoPlano", () => {
  it("a descrição da linha inclui a observação do plano (preço escalonado não se perde)", () => {
    expect(descricaoDoPlano(planoEscalonado)).toBe("600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90");
  });

  it("usa só o nome quando o plano não tem observação", () => {
    expect(descricaoDoPlano(planoSimples)).toBe("Claro Monitor");
  });
});

describe("lerQuantidade", () => {
  it.each([
    ["1", 1],
    [" 7 ", 7],
    ["1000", 1000],
  ])("aceita %j", (texto, esperado) => {
    expect(lerQuantidade(texto)).toBe(esperado);
  });

  it.each(["", "0", "-1", "1,5", "1.5", "abc", "1001", "1e2"])("recusa %j", (texto) => {
    expect(lerQuantidade(texto)).toBeNull();
  });
});

describe("adicionarLinhaCatalogo", () => {
  it("acrescenta a linha com id, descrição, franquia e valor do plano, sem mexer no rascunho original", () => {
    const original: Rascunho = [];
    const novo = adicionarLinhaCatalogo(original, planoEscalonado, "k1");
    expect(original).toEqual([]);
    expect(novo).toEqual([
      {
        chave: "k1",
        catalogoPlanoId: "p3",
        descricao: "600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90",
        quantidade: 1,
        franquiaGb: null,
        valor: 59.9,
      },
    ]);
  });

  it("com quantidade, o valor da linha é o subtotal em centavos (39,99 × 7 = 279,93)", () => {
    const [linha] = adicionarLinhaCatalogo([], planoPos, "k1", 7);
    expect(linha).toMatchObject({ quantidade: 7, franquiaGb: 12, valor: 279.93 });
  });

  it("permite o mesmo plano mais de uma vez (várias linhas iguais)", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(rascunho).toHaveLength(2);
    expect(totalRascunho(rascunho)).toBe(10);
  });
});

describe("adicionarLinhaAvulsa", () => {
  it("acrescenta uma oferta avulsa sem plano de catálogo, aceitando valor em formato brasileiro", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo negociado", valorTexto: "1.299,90" }, "k1");
    expect(resultado).toEqual({
      ok: true,
      rascunho: [
        { chave: "k1", catalogoPlanoId: null, descricao: "Combo negociado", quantidade: 1, franquiaGb: null, valor: 1299.9 },
      ],
    });
  });

  it("o valor digitado é o unitário: o da linha é o subtotal pela quantidade", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo", valorTexto: "39,99", quantidadeTexto: "7" }, "k1");
    expect(resultado.ok && resultado.rascunho[0]).toMatchObject({ quantidade: 7, valor: 279.93 });
  });

  it("apara os espaços da descrição", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "  Combo  ", valorTexto: "10" }, "k1");
    expect(resultado.ok && resultado.rascunho[0].descricao).toBe("Combo");
  });

  it("recusa descrição em branco", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "   ", valorTexto: "10" }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Descreva a oferta avulsa" });
  });

  it.each(["", "abc", "0", "-3"])("recusa valor inválido %j", (valorTexto) => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo", valorTexto }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Informe um valor válido, por exemplo 149,90" });
  });

  it.each(["0", "abc", "1001", "2,5"])("recusa quantidade inválida %j", (quantidadeTexto) => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo", valorTexto: "10", quantidadeTexto }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Informe uma quantidade de 1 a 1000" });
  });
});

describe("removerLinha", () => {
  it("remove só a linha da chave pedida", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k2");
    expect(removerLinha(rascunho, "k1").map((l) => l.chave)).toEqual(["k2"]);
  });
});

describe("totalRascunho", () => {
  it("soma os valores em centavos", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(totalRascunho(rascunho)).toBe(64.9);
  });

  it("soma subtotais com quantidade sem erro de centavo", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoPos, "k1", 7);
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2", 7);
    expect(totalRascunho(rascunho)).toBe(314.93);
  });

  it("é 0 para um rascunho vazio", () => {
    expect(totalRascunho([])).toBe(0);
  });
});

describe("itensParaSalvar", () => {
  it("tira a chave de tela e mantém a ordem, a quantidade e a franquia", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoPos, "k1", 3);
    const avulsa = adicionarLinhaAvulsa(rascunho, { descricao: "Combo", valorTexto: "10" }, "k2");
    expect(avulsa.ok && itensParaSalvar(avulsa.rascunho)).toEqual([
      { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: 119.97, quantidade: 3, franquiaGb: 12 },
      { catalogoPlanoId: null, descricao: "Combo", valor: 10, quantidade: 1, franquiaGb: null },
    ]);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run lib/proposta-rascunho.test.ts`
Expected: FAIL — `lerQuantidade is not a function` e objetos sem `quantidade`.

- [ ] **Step 8: Substituir `lib/proposta-rascunho.ts`**

Substitua o conteúdo inteiro por:

```ts
import type { PlanoCatalogo } from "./catalogo";
import { parseValorBRL } from "./formato";
import {
  LIMITE_QUANTIDADE_ITEM,
  somarValores,
  subtotalDaLinha,
  type NovoItemProposta,
} from "./propostas";

export interface LinhaRascunho {
  chave: string;
  catalogoPlanoId: string | null;
  descricao: string;
  quantidade: number;
  franquiaGb: number | null;
  valor: number; // subtotal: quantidade x valor unitário
}

export type Rascunho = LinhaRascunho[];

// A observação ("Por 3 meses, depois R$99,90") vai junto na descrição: quem
// lê a proposta depois precisa da condição, não só do número promocional.
export function descricaoDoPlano(plano: Pick<PlanoCatalogo, "nome" | "observacao">): string {
  return plano.observacao ? `${plano.nome} — ${plano.observacao}` : plano.nome;
}

// Quantidade digitada: só inteiro de 1 a 1000. "1,5", "1e2" e vazio são recusados.
export function lerQuantidade(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,4}$/.test(limpo)) return null;
  const quantidade = Number(limpo);
  return quantidade >= 1 && quantidade <= LIMITE_QUANTIDADE_ITEM ? quantidade : null;
}

export function adicionarLinhaCatalogo(
  rascunho: Rascunho,
  plano: PlanoCatalogo,
  chave: string,
  quantidade = 1
): Rascunho {
  return [
    ...rascunho,
    {
      chave,
      catalogoPlanoId: plano.id,
      descricao: descricaoDoPlano(plano),
      quantidade,
      franquiaGb: plano.franquiaGb,
      valor: subtotalDaLinha(plano.valor, quantidade),
    },
  ];
}

export type ResultadoLinhaAvulsa =
  | { ok: true; rascunho: Rascunho }
  | { ok: false; erro: string };

// O valor digitado é o UNITÁRIO; a linha guarda o subtotal (valor x quantidade).
export function adicionarLinhaAvulsa(
  rascunho: Rascunho,
  entrada: { descricao: string; valorTexto: string; quantidadeTexto?: string },
  chave: string
): ResultadoLinhaAvulsa {
  const descricao = entrada.descricao.trim();
  if (!descricao) return { ok: false, erro: "Descreva a oferta avulsa" };

  const valorUnitario = parseValorBRL(entrada.valorTexto);
  if (valorUnitario === null) return { ok: false, erro: "Informe um valor válido, por exemplo 149,90" };

  const quantidade = lerQuantidade(entrada.quantidadeTexto ?? "1");
  if (quantidade === null) {
    return { ok: false, erro: `Informe uma quantidade de 1 a ${LIMITE_QUANTIDADE_ITEM}` };
  }

  return {
    ok: true,
    rascunho: [
      ...rascunho,
      {
        chave,
        catalogoPlanoId: null,
        descricao,
        quantidade,
        franquiaGb: null,
        valor: subtotalDaLinha(valorUnitario, quantidade),
      },
    ],
  };
}

export function removerLinha(rascunho: Rascunho, chave: string): Rascunho {
  return rascunho.filter((linha) => linha.chave !== chave);
}

export function totalRascunho(rascunho: Rascunho): number {
  return somarValores(rascunho.map((linha) => linha.valor));
}

export function itensParaSalvar(rascunho: Rascunho): NovoItemProposta[] {
  return rascunho.map(({ catalogoPlanoId, descricao, valor, quantidade, franquiaGb }) => ({
    catalogoPlanoId,
    descricao,
    valor,
    quantidade,
    franquiaGb,
  }));
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run lib/proposta-rascunho.test.ts`
Expected: PASS.

- [ ] **Step 10: Testes do agrupamento (vão falhar)**

Crie `lib/proposta/agrupar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import { itensDasLinhas, linhasComProposto, type LinhaEditavel } from "./agrupar";
import { somarValores } from "../propostas";

const catalogo: PlanoCatalogo[] = [
  { id: "p12", categoria: "pos_nacional", nome: "Pós 12GB", valor: 39.99, observacao: "por linha", ativo: true, franquiaGb: 12 },
  { id: "p40", categoria: "pos_nacional", nome: "Pós 40GB", valor: 54.99, observacao: "por linha", ativo: true, franquiaGb: 40 },
  { id: "p70", categoria: "pos_nacional", nome: "Pós 70GB", valor: 74.99, observacao: null, ativo: true, franquiaGb: 70 },
];

function linha(parcial: Partial<LinhaEditavel> & { chave: string }): LinhaEditavel {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 1000,
    origem: "fatura",
    planoId: null,
    avisos: [],
    ...parcial,
  };
}

describe("itensDasLinhas", () => {
  it("soma as linhas que escolheram o mesmo plano num item só (10× Pós 12GB)", () => {
    const linhas = Array.from({ length: 10 }, (_, i) => linha({ chave: `k${i}`, planoId: "p12" }));
    expect(itensDasLinhas(linhas, catalogo)).toEqual([
      { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", quantidade: 10, franquiaGb: 12, valor: 399.9 },
    ]);
  });

  it("linha com quantidade N conta N", () => {
    const linhas = [linha({ chave: "a", planoId: "p40", quantidade: 5 }), linha({ chave: "b", planoId: "p40" })];
    expect(itensDasLinhas(linhas, catalogo)[0]).toMatchObject({ quantidade: 6, valor: 329.94 });
  });

  it("subtotal em centavos, sem erro de ponto flutuante (39,99 × 7)", () => {
    const linhas = Array.from({ length: 7 }, (_, i) => linha({ chave: `k${i}`, planoId: "p12" }));
    expect(itensDasLinhas(linhas, catalogo)[0].valor).toBe(279.93);
  });

  it("ordena da maior franquia para a menor e dá um item por plano", () => {
    const linhas = [
      linha({ chave: "a", planoId: "p12" }),
      linha({ chave: "b", planoId: "p70" }),
      linha({ chave: "c", planoId: "p40" }),
    ];
    expect(itensDasLinhas(linhas, catalogo).map((i) => i.catalogoPlanoId)).toEqual(["p70", "p40", "p12"]);
  });

  it("linha sem plano proposto, ou com plano que não está no catálogo, não gera item", () => {
    const linhas = [linha({ chave: "a", planoId: null }), linha({ chave: "b", planoId: "apagado" })];
    expect(itensDasLinhas(linhas, catalogo)).toEqual([]);
  });

  it("o total dos itens é a soma dos subtotais", () => {
    const linhas = [
      ...Array.from({ length: 7 }, (_, i) => linha({ chave: `a${i}`, planoId: "p12" })),
      linha({ chave: "b", planoId: "p70" }),
    ];
    expect(somarValores(itensDasLinhas(linhas, catalogo).map((i) => i.valor))).toBe(354.92);
  });
});

describe("linhasComProposto", () => {
  it("grava o retrato do plano escolhido (descrição e valor unitário) em cada linha", () => {
    const [resultado] = linhasComProposto([linha({ chave: "a", planoId: "p12" })], catalogo);
    expect(resultado.proposto).toEqual({ descricao: "Pós 12GB — por linha", valorUnitario: 39.99 });
  });

  it("linha sem plano, ou com plano que saiu do catálogo, fica com proposto nulo", () => {
    const resultado = linhasComProposto(
      [linha({ chave: "a", planoId: null }), linha({ chave: "b", planoId: "apagado" })],
      catalogo
    );
    expect(resultado.map((l) => l.proposto)).toEqual([null, null]);
  });

  it("não deixa campos de tela (chave, planoId, avisos) vazarem para o que vai ao servidor", () => {
    const [resultado] = linhasComProposto([linha({ chave: "a", planoId: "p12", avisos: ["x"] })], catalogo);
    expect(Object.keys(resultado).sort()).toEqual(
      ["consumoMb", "origem", "planoGb", "proposto", "quantidade", "rotulo", "valorUnitario"].sort()
    );
  });
});
```

- [ ] **Step 11: Rodar e ver falhar**

Run: `npx vitest run lib/proposta/agrupar.test.ts`
Expected: FAIL — `Cannot find module './agrupar'`.

- [ ] **Step 12: Implementar `agrupar.ts`**

Crie `lib/proposta/agrupar.ts`:

```ts
import type { PlanoCatalogo } from "../catalogo";
import type { LinhaAtual } from "../fatura/tipos";
import { descricaoDoPlano } from "../proposta-rascunho";
import { subtotalDaLinha, type NovoItemProposta } from "../propostas";

// Uma linha da situação atual como a tela a edita: além dos dados que vão ao
// servidor, guarda o plano escolhido para a nova proposta e os avisos da leitura.
export type LinhaEditavel = Omit<LinhaAtual, "proposto"> & {
  chave: string; // identidade estável para a tela
  planoId: string | null; // plano do catálogo escolhido para esta linha
  avisos: string[]; // avisos da leitura (média de faturas, valor ausente...)
};

function indicePorId(catalogo: PlanoCatalogo[]): Map<string, PlanoCatalogo> {
  return new Map(catalogo.map((plano) => [plano.id, plano]));
}

// O que vai ao servidor: só os campos de LinhaAtual, com o retrato do plano
// escolhido. Nunca chave, planoId nem avisos.
export function linhasComProposto(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): LinhaAtual[] {
  const porId = indicePorId(catalogo);
  return linhas.map((linha) => {
    const plano = linha.planoId ? porId.get(linha.planoId) : undefined;
    return {
      rotulo: linha.rotulo,
      quantidade: linha.quantidade,
      planoGb: linha.planoGb,
      valorUnitario: linha.valorUnitario,
      consumoMb: linha.consumoMb,
      origem: linha.origem,
      proposto: plano ? { descricao: descricaoDoPlano(plano), valorUnitario: plano.valor } : null,
    };
  });
}

// Itens da nova proposta derivados das escolhas por linha: um item por plano,
// com a soma das quantidades. Recalculados a cada troca de plano e não editáveis
// à mão, o que garante que a tabela por linha e o total nunca divergem.
export function itensDasLinhas(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): NovoItemProposta[] {
  const porId = indicePorId(catalogo);
  const quantidades = new Map<string, number>();
  for (const linha of linhas) {
    if (!linha.planoId || !porId.has(linha.planoId)) continue;
    quantidades.set(linha.planoId, (quantidades.get(linha.planoId) ?? 0) + linha.quantidade);
  }

  return [...quantidades.entries()]
    .map(([id, quantidade]) => ({ plano: porId.get(id) as PlanoCatalogo, quantidade }))
    .sort(
      (a, b) =>
        (b.plano.franquiaGb ?? 0) - (a.plano.franquiaGb ?? 0) || a.plano.nome.localeCompare(b.plano.nome)
    )
    .map(({ plano, quantidade }) => ({
      catalogoPlanoId: plano.id,
      descricao: descricaoDoPlano(plano),
      quantidade,
      franquiaGb: plano.franquiaGb,
      valor: subtotalDaLinha(plano.valor, quantidade),
    }));
}
```

- [ ] **Step 13: Rodar tudo e conferir tipos**

Run: `npx vitest run lib/proposta/agrupar.test.ts && npx tsc --noEmit`
Expected: o teste passa. O `tsc` **vai apontar** erros em `app/(protected)/leads/[cnpj]/actions.ts`/`actions.test.ts` e `lib/ia/abordagem.test.ts` (itens sem `quantidade`/`franquiaGb`) — esses são corrigidos na Task 9; `proposta-builder.tsx` continua compilando. Se o `tsc` apontar qualquer outro arquivo, corrija-o aqui.

- [ ] **Step 14: Commit**

```bash
git add lib/propostas.ts lib/propostas.test.ts lib/proposta-rascunho.ts lib/proposta-rascunho.test.ts lib/proposta lib/formato.ts lib/formato.test.ts
git commit -m "feat(crm-fibra): proposal items with quantity, derived from invoice lines

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(O commit sai com o `tsc` ainda apontando os arquivos da Task 9; isso é esperado e a Task 9 fecha.)

---

### Task 9: Server Action de salvar e Abordagem por IA com quantidade

**Files:**
- Modify: `app/(protected)/leads/[cnpj]/actions.ts`, `app/(protected)/leads/[cnpj]/actions.test.ts`
- Modify: `lib/ia/abordagem.ts`, `lib/ia/abordagem.test.ts`

**Interfaces:**
- Consumes: `validarSituacaoAtual`, `SituacaoAtual` (Task 3); `NovoItemProposta`, `validarItensProposta`, `criarProposta` (Task 8).
- Produces: `salvarPropostaAction(cnpjDigits: string, itens: NovoItemProposta[], situacaoAtual?: SituacaoAtual | null): Promise<{ erro?: string }>`.

- [ ] **Step 1: Reescrever o bloco de testes de `salvarPropostaAction` (vai falhar)**

Em `app/(protected)/leads/[cnpj]/actions.test.ts`, substitua o bloco inteiro `describe("salvarPropostaAction", () => { … });` (vai de `describe("salvarPropostaAction"` até o `});` que antecede `describe("gerarAbordagemAction"`) por:

```ts
describe("salvarPropostaAction", () => {
  const itensValidos = [
    { catalogoPlanoId: "p12", descricao: "  Pós 12GB — por linha  ", valor: 279.93, quantidade: 7, franquiaGb: 12 },
    { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9, quantidade: 1, franquiaGb: null },
  ];
  const situacaoValida = {
    faturasAnalisadas: 1,
    linhas: [
      {
        rotulo: "(17) ••••• 0001",
        quantidade: 1,
        planoGb: 10,
        valorUnitario: 48.49,
        consumoMb: 1000,
        origem: "fatura" as const,
        proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
      },
    ],
  };

  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(salvarPropostaAction("00005087000190", itensValidos)).rejects.toThrow("REDIRECT:/login");
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa proposta sem nenhuma linha, sem gravar nada", async () => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", []);
    expect(resultado.erro).toMatch(/pelo menos uma linha/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it.each([
    ["descrição em branco", { catalogoPlanoId: null, descricao: "   ", valor: 10, quantidade: 1, franquiaGb: null }],
    ["valor zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 0, quantidade: 1, franquiaGb: null }],
    ["valor NaN", { catalogoPlanoId: null, descricao: "Oferta", valor: Number.NaN, quantidade: 1, franquiaGb: null }],
    ["valor que não é número", { catalogoPlanoId: null, descricao: "Oferta", valor: "abc" as unknown as number, quantidade: 1, franquiaGb: null }],
    ["quantidade zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 0, franquiaGb: null }],
    ["quantidade fracionada", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1.5, franquiaGb: null }],
    ["quantidade ausente", { catalogoPlanoId: null, descricao: "Oferta", valor: 10 } as unknown as (typeof itensValidos)[number]],
    ["franquia inválida", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: 0 }],
  ])("recusa linha inválida (%s) sem gravar nada", async (_nome, item) => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", [item]);
    expect(resultado.erro).toBeDefined();
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa CNPJ que não existe na base", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue(null);
    const resultado = await salvarPropostaAction("99999999999999", itensValidos);
    expect(resultado.erro).toMatch(/não encontrado/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("usa o consultor da sessão, normaliza os itens e permite salvar em lead de outro consultor", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: "outro-consultor" });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: [
        { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: 279.93, quantidade: 7, franquiaGb: 12 },
        { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9, quantidade: 1, franquiaGb: null },
      ],
      situacaoAtual: null,
    });
  });

  it("grava a situação atual validada junto da proposta", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos, situacaoValida);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({ situacaoAtual: situacaoValida }));
  });

  it("recusa situação atual inválida (telefone completo no nome da linha) sem gravar nada", async () => {
    sessaoValida();
    const forjada = { ...situacaoValida, linhas: [{ ...situacaoValida.linhas[0], rotulo: "(17) 90000-0001" }] };
    const resultado = await salvarPropostaAction("00005087000190", itensValidos, forjada);
    expect(resultado.erro).toMatch(/número completo/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa situação atual sem linhas e linha sem mensalidade", async () => {
    sessaoValida();
    const semLinhas = await salvarPropostaAction("00005087000190", itensValidos, { faturasAnalisadas: 0, linhas: [] });
    expect(semLinhas.erro).toMatch(/pelo menos uma linha/);

    const semValor = await salvarPropostaAction("00005087000190", itensValidos, {
      ...situacaoValida,
      linhas: [{ ...situacaoValida.linhas[0], valorUnitario: 0 }],
    });
    expect(semValor.erro).toMatch(/mensalidade/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("descarta campos extras da situação atual antes de gravar", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });
    const comExtra = { ...situacaoValida, linhas: [{ ...situacaoValida.linhas[0], telefoneCompleto: "17900000001" }] };

    await salvarPropostaAction("00005087000190", itensValidos, comExtra);

    const gravada = criarProposta.mock.calls[0][1].situacaoAtual;
    expect(JSON.stringify(gravada)).not.toContain("17900000001");
  });

  it("quando gravar falha, devolve mensagem amigável em vez de estourar (o rascunho do consultor não pode sumir)", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockRejectedValue(new Error("banco fora do ar"));
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    expect(erroNoLog).toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("o log de erro leva só mensagem e código: nunca a situação atual nem os detalhes do banco", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockRejectedValue({
      message: "violação de restrição",
      code: "23514",
      details: "Failing row contains ((17) ••••• 0001, Pós 12GB)",
    });
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos, situacaoValida);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    const logado = JSON.stringify(erroNoLog.mock.calls);
    expect(logado).toContain("23514");
    expect(logado).toContain("violação de restrição");
    expect(logado).not.toContain("Failing row");
    expect(logado).not.toContain("••••• 0001");
    erroNoLog.mockRestore();
  });

  it("também devolve mensagem amigável quando a consulta do lead falha", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockRejectedValue(new Error("banco fora do ar"));
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    expect(criarProposta).not.toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("trata um catalogoPlanoId que não é texto como oferta avulsa", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });

    await salvarPropostaAction("00005087000190", [
      { catalogoPlanoId: 123 as unknown as string, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null },
    ]);

    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({
      itens: [{ catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null }],
    }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts"`
Expected: FAIL (a action ainda não conhece `quantidade`, `franquiaGb` nem `situacaoAtual`).

- [ ] **Step 3: Alterar a action**

Em `app/(protected)/leads/[cnpj]/actions.ts`:

1. Acrescente ao topo, junto dos imports de `@/lib`:

```ts
import { validarSituacaoAtual, type SituacaoAtual } from "@/lib/fatura/tipos";
```

2. Acrescente (função **privada**, sem `export`: arquivo `"use server"` só exporta funções assíncronas), logo depois de `sessaoAtiva`:

```ts
// O erro do Supabase traz `details` com a linha que falhou (aí iria a situação
// atual do cliente): no log do servidor vão só a mensagem e o código.
function resumoDoErro(err: unknown): { message: string; code?: string } {
  const bruto = (err ?? {}) as { message?: unknown; code?: unknown };
  return {
    message: typeof bruto.message === "string" ? bruto.message : "erro desconhecido",
    ...(typeof bruto.code === "string" ? { code: bruto.code } : {}),
  };
}
```

3. Substitua a função `salvarPropostaAction` inteira por:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts"`
Expected: PASS (inclusive os testes de `atribuirLeadAction`, `registrarMensagemAction` e `gerarAbordagemAction`, que não mudaram).

- [ ] **Step 5: Teste da Abordagem por IA com quantidade (vai falhar)**

Em `lib/ia/abordagem.test.ts`:

(a) Troque a fixture `const proposta: Proposta = { … };` (linhas 24 a 34) por:

```ts
const proposta: Proposta = {
  id: "prop1",
  cnpjDigits: "11222333000181",
  consultorId: "c1",
  criadoEm: "2026-10-13T12:00:00Z",
  total: 154.89,
  situacaoAtual: null,
  itens: [
    { id: "i1", catalogoPlanoId: "p1", descricao: "Pós 100GB — por linha", valor: 89.99, quantidade: 1, franquiaGb: 100, ordem: 0 },
    { id: "i2", catalogoPlanoId: null, descricao: "Oferta avulsa combinada", valor: 64.9, quantidade: 1, franquiaGb: null, ordem: 1 },
  ],
};
```

(b) Dentro do `describe` que contém o teste da linha `expect(usuario).toContain("- Pós 100GB — por linha: R$ 89,99")`, acrescente logo depois desse teste:

```ts
  it("item com quantidade maior que 1 mostra a quantidade e deixa claro que o valor é o total das linhas", () => {
    const comQuantidade: Proposta = {
      ...proposta,
      itens: [
        { id: "i1", catalogoPlanoId: "p1", descricao: "Pós 100GB — por linha", valor: 899.9, quantidade: 10, franquiaGb: 100, ordem: 0 },
      ],
      total: 899.9,
    };
    const { usuario } = montarPedidoAbordagem({ lead, proposta: comQuantidade });
    expect(usuario).toContain("- 10× Pós 100GB — por linha: R$ 899,90 no total");
    expect(usuario).toContain("Total da proposta: R$ 899,90");
  });

  it("a situação atual da fatura nunca vai para a IA", () => {
    const comSituacao: Proposta = {
      ...proposta,
      situacaoAtual: {
        faturasAnalisadas: 1,
        linhas: [
          { rotulo: "(17) ••••• 0001", quantidade: 1, planoGb: 10, valorUnitario: 48.49, consumoMb: 1000, origem: "fatura", proposto: null },
        ],
      },
    };
    const { sistema, usuario } = montarPedidoAbordagem({ lead, proposta: comSituacao });
    const tudo = `${sistema}\n${usuario}`;
    expect(tudo).not.toContain("0001");
    expect(tudo).not.toContain("48,49");
  });
```

(Se o `describe` desse teste usar outro nome para o lead de exemplo que não `lead`, use o nome que o arquivo já usa na linha 137.)

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run lib/ia/abordagem.test.ts`
Expected: FAIL — o primeiro teste novo (a linha ainda sai sem "10×").

- [ ] **Step 7: Alterar o pedido da IA**

Em `lib/ia/abordagem.ts`, dentro de `montarUsuario`, troque o laço

```ts
    for (const item of proposta.itens) {
      linhas.push(`- ${item.descricao}: ${reais(item.valor)}`);
    }
```

por:

```ts
    for (const item of proposta.itens) {
      // Com mais de uma linha o valor do item é o subtotal: sem dizer isso, o
      // modelo leria R$ 899,90 como preço por linha.
      linhas.push(
        item.quantidade > 1
          ? `- ${item.quantidade}× ${item.descricao}: ${reais(item.valor)} no total`
          : `- ${item.descricao}: ${reais(item.valor)}`
      );
    }
```

- [ ] **Step 8: Rodar tudo e conferir tipos**

Run: `npx vitest run && npx tsc --noEmit`
Expected: suíte toda verde e `tsc` sem erro (agora os erros da Task 8 estão fechados).

- [ ] **Step 9: Commit**

```bash
git add "app/(protected)/leads/[cnpj]/actions.ts" "app/(protected)/leads/[cnpj]/actions.test.ts" lib/ia/abordagem.ts lib/ia/abordagem.test.ts
git commit -m "feat(crm-fibra): save the current situation with the proposal and show quantities to the AI

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Modelo do documento (dado puro)

**Files:**
- Create: `lib/proposta/modelo-documento.ts`, `lib/proposta/modelo-documento.test.ts`

**Interfaces:**
- Consumes: `SituacaoAtual`, `LinhaAtual` (Task 3); `NovoItemProposta`, `somarValores`, `subtotalDaLinha`, `valorUnitarioDoItem` (Task 8); `formatarCnpj` (Task 8); `limparRazaoSocial` (`lib/ia/abordagem.ts`).
- Produces (`lib/proposta/modelo-documento.ts`):
  - `interface LinhaTabela { descricao: string; quantidade: number; valorUnitario: number | null; subtotal: number }`
  - `interface LinhaComparada { rotulo: string; planoAtual: string; consumo: string; planoProposto: string; valorAtual: number; valorProposto: number | null; diferenca: number | null }`
  - `interface Badge { label: string; desc: string; cor: string }` (`cor` = hex sem `#`)
  - `type TipoResumo = "economia" | "aumento" | "igual"`
  - `interface ModeloDocumento { cliente: { razaoSocial: string; cnpj: string }; consultor: string; emitidoEm: string; validoAte: string; situacaoAtual: { itens: LinhaTabela[]; total: number; nota: string } | null; porLinha: LinhaComparada[] | null; novaProposta: { consolidado: boolean; itens: LinhaTabela[]; total: number }; beneficios: { movel: boolean; badges: Badge[] }; resumo: { atual: number | null; proposto: number; diferenca: number | null; tipo: TipoResumo | null } }`
  - `interface EntradaModelo { cliente: { razaoSocial: string; cnpjDigits: string }; consultor: string; situacaoAtual: SituacaoAtual | null; itens: NovoItemProposta[]; opcoes: { consolidar: boolean; vendedor: string | null }; agora: Date }`
  - `montarModeloDocumento(entrada: EntradaModelo): ModeloDocumento`

- [ ] **Step 1: Escrever os testes (vão falhar)**

Crie `lib/proposta/modelo-documento.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { somarValores, subtotalDaLinha, type NovoItemProposta } from "../propostas";
import { montarModeloDocumento, type EntradaModelo } from "./modelo-documento";

const agora = new Date("2026-10-19T15:00:00Z"); // 12h em Brasília
const cliente = { razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" };

function fatura(parcial: Partial<LinhaAtual> = {}): LinhaAtual {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 5120.5,
    origem: "fatura",
    proposto: null,
    ...parcial,
  };
}

function pos(descricao: string, gb: number, valorUnitario: number, quantidade: number): NovoItemProposta {
  return {
    catalogoPlanoId: `p${gb}`,
    descricao,
    valor: subtotalDaLinha(valorUnitario, quantidade),
    quantidade,
    franquiaGb: gb,
  };
}

const fibra: NovoItemProposta = {
  catalogoPlanoId: "f1",
  descricao: "800 Mega (todos os grupos)",
  valor: 109.9,
  quantidade: 1,
  franquiaGb: null,
};

const monitor = (quantidade = 1): NovoItemProposta => ({
  catalogoPlanoId: "m1",
  descricao: "Claro Monitor",
  valor: subtotalDaLinha(5, quantidade),
  quantidade,
  franquiaGb: null,
});

function entrada(parcial: Partial<EntradaModelo> = {}): EntradaModelo {
  return {
    cliente,
    consultor: "Ana Teste",
    situacaoAtual: null,
    itens: [pos("Pós 12GB — por linha", 12, 39.99, 2)],
    opcoes: { consolidar: false, vendedor: null },
    agora,
    ...parcial,
  };
}

const situacao: SituacaoAtual = {
  faturasAnalisadas: 1,
  linhas: [
    fatura({ rotulo: "(17) ••••• 0001" }),
    fatura({ rotulo: "(17) ••••• 0002" }),
    fatura({ rotulo: "(17) ••••• 0003", planoGb: 20, valorUnitario: 58.99 }),
  ],
};

describe("montarModeloDocumento — cabeçalho", () => {
  it("formata o CNPJ, as datas e usa o consultor informado", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.cliente).toEqual({ razaoSocial: "EMPRESA EXEMPLO LTDA", cnpj: "11.222.333/0001-81" });
    expect(m.consultor).toBe("Ana Teste");
    expect(m.emitidoEm).toBe("19/10/2026");
    expect(m.validoAte).toBe("20/10/2026");
  });

  it("usa a data de Brasília, não a de UTC (22h30 em Brasília ainda é o mesmo dia)", () => {
    const m = montarModeloDocumento(entrada({ agora: new Date("2026-10-20T01:30:00Z") }));
    expect(m.emitidoEm).toBe("19/10/2026");
    expect(m.validoAte).toBe("20/10/2026");
  });

  it("a validade é emissão + 1 dia, inclusive na virada do mês", () => {
    const m = montarModeloDocumento(entrada({ agora: new Date("2026-10-31T15:00:00Z") }));
    expect(m.validoAte).toBe("01/11/2026");
  });

  it("o vendedor editado vale no lugar do consultor logado; em branco volta ao logado", () => {
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } })).consultor).toBe(
      "Maria Vendedora"
    );
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: "   " } })).consultor).toBe("Ana Teste");
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: null } })).consultor).toBe("Ana Teste");
  });

  it("tira CPF/raiz de CNPJ do nome (MEI), mas mantém número curto que faz parte do nome", () => {
    const mei = montarModeloDocumento(entrada({ cliente: { razaoSocial: "FULANO DE TAL 123.456.789-00", cnpjDigits: "11222333000181" } }));
    expect(mei.cliente.razaoSocial).toBe("FULANO DE TAL");
    const curto = montarModeloDocumento(entrada({ cliente: { razaoSocial: "LOJA 24 HORAS LTDA", cnpjDigits: "11222333000181" } }));
    expect(curto.cliente.razaoSocial).toBe("LOJA 24 HORAS LTDA");
  });

  it("razão social longa passa inteira (quem desenha quebra a linha)", () => {
    const longa = "EMPRESA EXEMPLO DE COMERCIO E SERVICOS DE TELECOMUNICACOES E TECNOLOGIA DA INFORMACAO LTDA";
    expect(montarModeloDocumento(entrada({ cliente: { razaoSocial: longa, cnpjDigits: "11222333000181" } })).cliente.razaoSocial).toBe(longa);
  });
});

describe("montarModeloDocumento — situação atual", () => {
  it("sem situação atual: não há seção, nem comparativo por linha, nem resumo de diferença", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.situacaoAtual).toBeNull();
    expect(m.porLinha).toBeNull();
    expect(m.resumo).toMatchObject({ atual: null, diferenca: null, tipo: null });
  });

  it("agrupa por plano e valor, da maior franquia para a menor, com total", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.situacaoAtual?.itens).toEqual([
      { descricao: "Plano atual — 20GB", quantidade: 1, valorUnitario: 58.99, subtotal: 58.99 },
      { descricao: "Plano atual — 10GB", quantidade: 2, valorUnitario: 48.49, subtotal: 96.98 },
    ]);
    expect(m.situacaoAtual?.total).toBe(155.97);
    expect(m.resumo.atual).toBe(155.97);
  });

  it("linha digitada com quantidade N conta N, e a nota diz que o valor veio do consultor", () => {
    const digitada: SituacaoAtual = {
      faturasAnalisadas: 0,
      linhas: [{ rotulo: "Linhas do escritório", quantidade: 5, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null }],
    };
    const m = montarModeloDocumento(entrada({ situacaoAtual: digitada }));
    expect(m.situacaoAtual?.itens).toEqual([
      { descricao: "Plano atual — 10GB", quantidade: 5, valorUnitario: 50, subtotal: 250 },
    ]);
    expect(m.situacaoAtual?.nota).toBe("Valores informados pelo consultor.");
  });

  it("quando há linha de fatura, a nota fala em valor aproximado", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.situacaoAtual?.nota).toMatch(/aproximado/);
  });

  it("linha sem franquia conhecida vira 'Plano atual' sem GB", () => {
    const semGb: SituacaoAtual = { faturasAnalisadas: 1, linhas: [fatura({ planoGb: null })] };
    expect(montarModeloDocumento(entrada({ situacaoAtual: semGb })).situacaoAtual?.itens[0].descricao).toBe("Plano atual");
  });
});

describe("montarModeloDocumento — comparativo por linha", () => {
  it("só entram as linhas da fatura, com o plano proposto gravado em cada uma", () => {
    const comProposto: SituacaoAtual = {
      faturasAnalisadas: 1,
      linhas: [
        fatura({ consumoMb: 9728, proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 } }),
        fatura({ rotulo: "(17) ••••• 0002", proposto: null }),
        { rotulo: "Linhas extras", quantidade: 3, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null },
      ],
    };
    const m = montarModeloDocumento(entrada({ situacaoAtual: comProposto }));
    expect(m.porLinha).toEqual([
      {
        rotulo: "(17) ••••• 0001",
        planoAtual: "10GB",
        consumo: "9,5 GB",
        planoProposto: "Pós 12GB — por linha",
        valorAtual: 48.49,
        valorProposto: 39.99,
        diferenca: -8.5,
      },
      {
        rotulo: "(17) ••••• 0002",
        planoAtual: "10GB",
        consumo: "5,0 GB",
        planoProposto: "sem plano proposto",
        valorAtual: 48.49,
        valorProposto: null,
        diferenca: null,
      },
    ]);
  });

  it("sem nenhuma linha de fatura (só digitadas) não há comparativo por linha", () => {
    const digitada: SituacaoAtual = {
      faturasAnalisadas: 0,
      linhas: [{ rotulo: "Linhas", quantidade: 2, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null }],
    };
    expect(montarModeloDocumento(entrada({ situacaoAtual: digitada })).porLinha).toBeNull();
  });

  it("consumo desconhecido e plano desconhecido viram traço", () => {
    const desconhecido: SituacaoAtual = {
      faturasAnalisadas: 1,
      linhas: [fatura({ planoGb: null, consumoMb: null })],
    };
    const [linha] = montarModeloDocumento(entrada({ situacaoAtual: desconhecido })).porLinha ?? [];
    expect(linha).toMatchObject({ planoAtual: "-", consumo: "-" });
  });
});

describe("montarModeloDocumento — nova proposta", () => {
  it("itemizada: descrição, quantidade, valor unitário e subtotal de cada item", () => {
    const m = montarModeloDocumento(entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 7), fibra] }));
    expect(m.novaProposta.consolidado).toBe(false);
    expect(m.novaProposta.itens).toEqual([
      { descricao: "Pós 12GB — por linha", quantidade: 7, valorUnitario: 39.99, subtotal: 279.93 },
      { descricao: "800 Mega (todos os grupos)", quantidade: 1, valorUnitario: 109.9, subtotal: 109.9 },
    ]);
    expect(m.novaProposta.total).toBe(389.83);
  });

  it("consolidar junta só os Pós numa linha, com as franquias da maior para a menor", () => {
    const m = montarModeloDocumento(
      entrada({
        itens: [pos("Pós 12GB — por linha", 12, 39.99, 4), pos("Pós 40GB — por linha", 40, 54.99, 2), fibra],
        opcoes: { consolidar: true, vendedor: null },
      })
    );
    expect(m.novaProposta.consolidado).toBe(true);
    expect(m.novaProposta.itens).toEqual([
      { descricao: "6 linha(s) — 2× 40GB, 4× 12GB — valor total consolidado", quantidade: 6, valorUnitario: null, subtotal: 269.94 },
      { descricao: "800 Mega (todos os grupos)", quantidade: 1, valorUnitario: 109.9, subtotal: 109.9 },
    ]);
    expect(m.novaProposta.total).toBe(379.84);
  });

  it("consolidar soma itens de mesma franquia numa entrada só (3× 12GB + 4× 12GB = 7× 12GB)", () => {
    const m = montarModeloDocumento(
      entrada({
        itens: [pos("Pós 12GB — por linha", 12, 39.99, 3), pos("Pós 12GB — por linha", 12, 39.99, 4)],
        opcoes: { consolidar: true, vendedor: null },
      })
    );
    expect(m.novaProposta.itens).toHaveLength(1);
    expect(m.novaProposta.itens[0].descricao).toBe("7 linha(s) — 7× 12GB — valor total consolidado");
  });

  it("consolidar sem nenhum Pós não muda nada e não marca como consolidado", () => {
    const m = montarModeloDocumento(entrada({ itens: [fibra], opcoes: { consolidar: true, vendedor: null } }));
    expect(m.novaProposta.consolidado).toBe(false);
    expect(m.novaProposta.itens).toHaveLength(1);
  });
});

describe("montarModeloDocumento — Claro Monitor e totais", () => {
  const combinacoes = [
    { consolidar: false, comMonitor: false },
    { consolidar: false, comMonitor: true },
    { consolidar: true, comMonitor: false },
    { consolidar: true, comMonitor: true },
  ];

  it.each(combinacoes)(
    "invariante: itens visíveis + Monitor = total = soma dos itens salvos (consolidar=$consolidar, monitor=$comMonitor)",
    ({ consolidar, comMonitor }) => {
      const itens = [
        pos("Pós 12GB — por linha", 12, 39.99, 4),
        pos("Pós 40GB — por linha", 40, 54.99, 2),
        fibra,
        ...(comMonitor ? [monitor(6)] : []),
      ];
      const m = montarModeloDocumento(entrada({ itens, opcoes: { consolidar, vendedor: null } }));
      const visiveis = somarValores(m.novaProposta.itens.map((l) => l.subtotal));
      const valorMonitor = comMonitor ? 30 : 0;
      expect(somarValores([visiveis, valorMonitor])).toBe(m.novaProposta.total);
      expect(m.novaProposta.total).toBe(somarValores(itens.map((i) => i.valor)));
      expect(m.resumo.proposto).toBe(m.novaProposta.total);
    }
  );

  it("o Claro Monitor nunca vira linha da tabela (qualquer variação do nome)", () => {
    const m = montarModeloDocumento(
      entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 2), { ...monitor(2), descricao: "claro monitor lite" }] })
    );
    expect(m.novaProposta.itens.map((l) => l.descricao)).toEqual(["Pós 12GB — por linha"]);
    expect(m.novaProposta.total).toBe(89.98);
  });
});

describe("montarModeloDocumento — benefícios", () => {
  it("com linha móvel traz ligações, WhatsApp e Waze ilimitados", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.beneficios.movel).toBe(true);
    expect(m.beneficios.badges.map((b) => b.label)).toEqual(["Ligações ilimitadas", "WhatsApp ilimitado", "Waze ilimitado"]);
  });

  it("o Claro Monitor entra por último na lista de benefícios", () => {
    const m = montarModeloDocumento(entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 2), monitor(2)] }));
    expect(m.beneficios.badges.map((b) => b.label).at(-1)).toBe("Claro Monitor");
  });

  it("sem item de Pós não há os benefícios de linha móvel", () => {
    expect(montarModeloDocumento(entrada({ itens: [fibra] })).beneficios).toEqual({ movel: false, badges: [] });
  });

  it("só Claro Monitor (sem Pós) mostra apenas o benefício do Monitor", () => {
    const m = montarModeloDocumento(entrada({ itens: [monitor(1)] }));
    expect(m.beneficios.badges.map((b) => b.label)).toEqual(["Claro Monitor"]);
  });
});

describe("montarModeloDocumento — resumo", () => {
  const unica = (valorUnitario: number): SituacaoAtual => ({ faturasAnalisadas: 1, linhas: [fatura({ valorUnitario })] });

  it("economia: proposto menor que o atual", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.resumo).toEqual({ atual: 155.97, proposto: 79.98, diferenca: -75.99, tipo: "economia" });
  });

  it("aumento: proposto maior que o atual", () => {
    const m = montarModeloDocumento(
      entrada({ situacaoAtual: situacao, itens: [fibra, pos("Pós 12GB — por linha", 12, 39.99, 3)] })
    );
    expect(m.resumo).toEqual({ atual: 155.97, proposto: 229.87, diferenca: 73.9, tipo: "aumento" });
  });

  it("igual: mesma mensalidade", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: unica(79.98) }));
    expect(m.resumo).toEqual({ atual: 79.98, proposto: 79.98, diferenca: 0, tipo: "igual" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/proposta/modelo-documento.test.ts`
Expected: FAIL — `Cannot find module './modelo-documento'`.

- [ ] **Step 3: Implementar**

Crie `lib/proposta/modelo-documento.ts`:

```ts
// Camada de dado puro dos documentos (Word, PDF consultor, PDF cliente, PNG): tudo
// que vai no papel é calculado aqui, em Node, sem biblioteca gráfica. Os
// desenhistas só pintam o que este modelo já trouxe pronto, então um erro de
// total ou de arredondamento aparece num teste rápido, não num arquivo aberto à mão.
import { formatarCnpj } from "../formato";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { limparRazaoSocial } from "../ia/abordagem";
import { somarValores, subtotalDaLinha, valorUnitarioDoItem, type NovoItemProposta } from "../propostas";

export interface LinhaTabela {
  descricao: string;
  quantidade: number;
  valorUnitario: number | null; // nulo na linha consolidada
  subtotal: number;
}

export interface LinhaComparada {
  rotulo: string;
  planoAtual: string;
  consumo: string;
  planoProposto: string;
  valorAtual: number;
  valorProposto: number | null;
  diferenca: number | null;
}

export interface Badge {
  label: string;
  desc: string;
  cor: string; // hex sem "#"
}

export type TipoResumo = "economia" | "aumento" | "igual";

export interface ModeloDocumento {
  cliente: { razaoSocial: string; cnpj: string };
  consultor: string;
  emitidoEm: string;
  validoAte: string;
  situacaoAtual: { itens: LinhaTabela[]; total: number; nota: string } | null;
  porLinha: LinhaComparada[] | null;
  novaProposta: { consolidado: boolean; itens: LinhaTabela[]; total: number };
  beneficios: { movel: boolean; badges: Badge[] };
  resumo: { atual: number | null; proposto: number; diferenca: number | null; tipo: TipoResumo | null };
}

export interface EntradaModelo {
  cliente: { razaoSocial: string; cnpjDigits: string };
  consultor: string;
  situacaoAtual: SituacaoAtual | null;
  itens: NovoItemProposta[];
  opcoes: { consolidar: boolean; vendedor: string | null };
  agora: Date;
}

const BENEFICIOS_MOVEL: Badge[] = [
  { label: "Ligações ilimitadas", desc: "Fixo e celular, qualquer operadora do Brasil, usando o 21", cor: "0D0D0D" },
  { label: "WhatsApp ilimitado", desc: "Chamadas de voz, vídeo e mensagens, sem descontar da franquia", cor: "25D366" },
  { label: "Waze ilimitado", desc: "Sem descontar da franquia", cor: "05C3DD" },
];

const BENEFICIO_MONITOR: Badge = {
  label: "Claro Monitor",
  desc: "Localização, bloqueio remoto e proteção do aparelho incluídos",
  cor: "B3101F",
};

const NOTA_FATURA =
  "Valor aproximado, pode conter variações devido a utilização ou encargos financeiros do período";
const NOTA_DIGITADA = "Valores informados pelo consultor.";

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const FORMATO_GB = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const UM_DIA_MS = 24 * 60 * 60 * 1000;

const centavos = (valor: number) => Math.round(valor * 100) / 100;

// Claro Monitor não vira linha da tabela: o valor soma no total e ele aparece
// como benefício (regra do painel, REGRAS_NEGOCIO.md seção 31.3).
const ehMonitor = (item: NovoItemProposta) => /^claro monitor/i.test(item.descricao.trim());

function agruparSituacao(linhas: LinhaAtual[]): LinhaTabela[] {
  const grupos = new Map<string, { planoGb: number | null; valorUnitario: number; quantidade: number }>();
  for (const linha of linhas) {
    const chave = `${linha.planoGb ?? "sem"}|${Math.round(linha.valorUnitario * 100)}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.quantidade += linha.quantidade;
    else grupos.set(chave, { planoGb: linha.planoGb, valorUnitario: linha.valorUnitario, quantidade: linha.quantidade });
  }
  return [...grupos.values()]
    .sort((a, b) => (b.planoGb ?? 0) - (a.planoGb ?? 0) || b.valorUnitario - a.valorUnitario)
    .map((grupo) => ({
      descricao: grupo.planoGb ? `Plano atual — ${grupo.planoGb}GB` : "Plano atual",
      quantidade: grupo.quantidade,
      valorUnitario: grupo.valorUnitario,
      subtotal: subtotalDaLinha(grupo.valorUnitario, grupo.quantidade),
    }));
}

function consumoEmGb(consumoMb: number | null): string {
  return consumoMb === null ? "-" : `${FORMATO_GB.format(consumoMb / 1024)} GB`;
}

function compararPorLinha(linhas: LinhaAtual[]): LinhaComparada[] | null {
  const daFatura = linhas.filter((linha) => linha.origem === "fatura");
  if (daFatura.length === 0) return null;
  return daFatura.map((linha) => {
    const valorAtual = subtotalDaLinha(linha.valorUnitario, linha.quantidade);
    const valorProposto = linha.proposto ? subtotalDaLinha(linha.proposto.valorUnitario, linha.quantidade) : null;
    return {
      rotulo: linha.rotulo,
      planoAtual: linha.planoGb ? `${linha.planoGb}GB` : "-",
      consumo: consumoEmGb(linha.consumoMb),
      planoProposto: linha.proposto ? linha.proposto.descricao : "sem plano proposto",
      valorAtual,
      valorProposto,
      diferenca: valorProposto === null ? null : centavos(valorProposto - valorAtual),
    };
  });
}

function montarNovaProposta(itens: NovoItemProposta[], consolidar: boolean) {
  const monitores = itens.filter(ehMonitor);
  const demais = itens.filter((item) => !ehMonitor(item));
  const moveis = demais.filter((item) => item.franquiaGb !== null);
  const valorMonitor = somarValores(monitores.map((item) => item.valor));

  const paraLinha = (item: NovoItemProposta): LinhaTabela => ({
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorUnitario: valorUnitarioDoItem(item),
    subtotal: item.valor,
  });

  let linhas: LinhaTabela[];
  const consolidado = consolidar && moveis.length > 0;
  if (consolidado) {
    const porGb = new Map<number, number>();
    for (const item of moveis) {
      const gb = item.franquiaGb as number;
      porGb.set(gb, (porGb.get(gb) ?? 0) + item.quantidade);
    }
    const planos = [...porGb.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([gb, quantidade]) => `${quantidade}× ${gb}GB`)
      .join(", ");
    const quantidade = moveis.reduce((soma, item) => soma + item.quantidade, 0);
    linhas = [
      {
        descricao: `${quantidade} linha(s) — ${planos} — valor total consolidado`,
        quantidade,
        valorUnitario: null,
        subtotal: somarValores(moveis.map((item) => item.valor)),
      },
      ...demais.filter((item) => item.franquiaGb === null).map(paraLinha),
    ];
  } else {
    linhas = demais.map(paraLinha);
  }

  return {
    consolidado,
    itens: linhas,
    total: somarValores([...linhas.map((linha) => linha.subtotal), valorMonitor]),
    movel: moveis.length > 0,
    temMonitor: monitores.length > 0,
  };
}

export function montarModeloDocumento(entrada: EntradaModelo): ModeloDocumento {
  const nova = montarNovaProposta(entrada.itens, entrada.opcoes.consolidar);

  const linhasAtuais = entrada.situacaoAtual?.linhas ?? null;
  const itensAtuais = linhasAtuais ? agruparSituacao(linhasAtuais) : null;
  const totalAtual = itensAtuais ? somarValores(itensAtuais.map((linha) => linha.subtotal)) : null;

  const diferenca = totalAtual === null ? null : centavos(nova.total - totalAtual);
  const tipo: TipoResumo | null =
    diferenca === null ? null : diferenca < 0 ? "economia" : diferenca > 0 ? "aumento" : "igual";

  return {
    cliente: {
      razaoSocial: limparRazaoSocial(entrada.cliente.razaoSocial) || entrada.cliente.razaoSocial,
      cnpj: formatarCnpj(entrada.cliente.cnpjDigits),
    },
    consultor: (entrada.opcoes.vendedor ?? "").trim() || entrada.consultor,
    emitidoEm: FORMATO_DATA.format(entrada.agora),
    validoAte: FORMATO_DATA.format(new Date(entrada.agora.getTime() + UM_DIA_MS)),
    situacaoAtual:
      itensAtuais && totalAtual !== null && linhasAtuais
        ? {
            itens: itensAtuais,
            total: totalAtual,
            nota: linhasAtuais.some((linha) => linha.origem === "fatura") ? NOTA_FATURA : NOTA_DIGITADA,
          }
        : null,
    porLinha: linhasAtuais ? compararPorLinha(linhasAtuais) : null,
    novaProposta: { consolidado: nova.consolidado, itens: nova.itens, total: nova.total },
    beneficios: {
      movel: nova.movel,
      badges: [...(nova.movel ? BENEFICIOS_MOVEL : []), ...(nova.temMonitor ? [BENEFICIO_MONITOR] : [])],
    },
    resumo: { atual: totalAtual, proposto: nova.total, diferenca, tipo },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/proposta/modelo-documento.test.ts`
Expected: PASS. Pontos que costumam falhar: (a) a data de "22h30 em Brasília": `2026-10-20T01:30:00Z` é 22h30 de 19/10 em Brasília (UTC-3), então `emitidoEm` tem de ser `19/10/2026`; (b) `diferenca 73.9` vem de `centavos(229.87 − 155.97)`; (c) `limparRazaoSocial("FULANO DE TAL 123.456.789-00")` remove o CPF e devolve `FULANO DE TAL`.

- [ ] **Step 5: Commit**

```bash
git add lib/proposta/modelo-documento.ts lib/proposta/modelo-documento.test.ts
git commit -m "feat(crm-fibra): add the pure document model for proposal exports

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Word editável e utilitários de formatação dos documentos

**Files:**
- Create: `lib/documentos/formato.ts`, `lib/documentos/formato.test.ts`
- Create: `lib/documentos/fixtures.ts` (apoio dos testes dos desenhistas; não é teste)
- Create: `lib/documentos/docx.ts`, `lib/documentos/docx.test.ts`

**Interfaces:**
- Consumes: `ModeloDocumento`, `LinhaTabela` (Task 10); `Logos`, `LOGO_APEX`, `LOGO_CLARO` (Task 1).
- Produces (`lib/documentos/formato.ts`):
  - `RODAPE_EMPRESA` (`"Apex Smart Solutions — Agente Autorizado Claro Empresas · CNPJ 64.307.984/0001-30"`), `SUBTITULO_CONSULTOR` (`"Apex Smart Solutions — Parceiro autorizado Claro Empresas"`)
  - `moeda(valor: number): string` (sem espaço não separável)
  - `nomeDeArquivo(prefixo: string, razaoSocial: string, extensao: string): string`
  - `linhasDaTabela(itens: LinhaTabela[]): string[][]` (`[descrição, quantidade, valor unitário ou "-", subtotal]`)
  - `rotuloTotalProposta(modelo: ModeloDocumento): string`
  - `reducaoDe(modelo: ModeloDocumento): { valor: number; pct: number | null } | null`
  - `textoReducao(reducao: { valor: number; pct: number | null }): string`
  - `tituloDoCliente(modelo: ModeloDocumento): string`
  - `destaqueDoCliente(modelo: ModeloDocumento): { titulo: string; valor: string; cor: "verde" | "ambar" | "preto" }`
- Produces (`lib/documentos/docx.ts`): `gerarDocx(modelo: ModeloDocumento, logos: Logos): Promise<Uint8Array>`
- Produces (`lib/documentos/fixtures.ts`, só para testes): `AGORA_TESTE`, `logosDeTeste(): Logos`, `entradaDeTeste(parcial?): EntradaModelo`, `modeloDeTeste(parcial?): ModeloDocumento`, `textoDoPdf(bytes): Promise<string>`, `paginasDoPdf(bytes): Promise<number>`, `textoDoDocx(bytes): Promise<string>`

- [ ] **Step 1: Escrever os testes dos utilitários (vão falhar)**

Crie `lib/documentos/formato.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  destaqueDoCliente,
  linhasDaTabela,
  moeda,
  nomeDeArquivo,
  reducaoDe,
  rotuloTotalProposta,
  textoReducao,
  tituloDoCliente,
} from "./formato";
import type { ModeloDocumento } from "../proposta/modelo-documento";

// Só os campos que estes utilitários leem.
function modelo(parcial: Partial<ModeloDocumento> = {}): ModeloDocumento {
  return {
    cliente: { razaoSocial: "X", cnpj: "11.222.333/0001-81" },
    consultor: "Ana",
    emitidoEm: "19/10/2026",
    validoAte: "20/10/2026",
    situacaoAtual: null,
    porLinha: null,
    novaProposta: { consolidado: false, itens: [], total: 100 },
    beneficios: { movel: false, badges: [] },
    resumo: { atual: null, proposto: 100, diferenca: null, tipo: null },
    ...parcial,
  };
}

const comSituacao = (atual: number, proposto: number): Partial<ModeloDocumento> => {
  const diferenca = Math.round((proposto - atual) * 100) / 100;
  return {
    situacaoAtual: { itens: [], total: atual, nota: "" },
    novaProposta: { consolidado: false, itens: [], total: proposto },
    resumo: {
      atual,
      proposto,
      diferenca,
      tipo: diferenca < 0 ? "economia" : diferenca > 0 ? "aumento" : "igual",
    },
  };
};

describe("moeda", () => {
  it("formata em reais com espaço comum (nada de espaço não separável nos PDFs)", () => {
    expect(moeda(1234.56)).toBe("R$ 1.234,56");
    expect(moeda(0)).toBe("R$ 0,00");
    expect(moeda(1234.56)).not.toContain(" ");
  });
});

describe("nomeDeArquivo", () => {
  it("monta prefixo_razão_social.extensão sem acento nem símbolo", () => {
    expect(nomeDeArquivo("proposta", "AÇÃO & CIA LTDA", "pdf")).toBe("proposta_ACAO_CIA_LTDA.pdf");
  });

  it("cai em 'cliente' quando não sobra nada do nome", () => {
    expect(nomeDeArquivo("comparativo", "  ///  ", "png")).toBe("comparativo_cliente.png");
    expect(nomeDeArquivo("comparativo", "", "png")).toBe("comparativo_cliente.png");
  });

  it("limita o nome a 60 caracteres", () => {
    const nome = nomeDeArquivo("proposta", "A".repeat(200), "docx");
    expect(nome).toBe(`proposta_${"A".repeat(60)}.docx`);
  });
});

describe("linhasDaTabela", () => {
  it("vira linhas de texto, com traço quando não há valor unitário (linha consolidada)", () => {
    expect(
      linhasDaTabela([
        { descricao: "Pós 12GB — por linha", quantidade: 7, valorUnitario: 39.99, subtotal: 279.93 },
        { descricao: "7 linha(s) — 7× 12GB — valor total consolidado", quantidade: 7, valorUnitario: null, subtotal: 279.93 },
      ])
    ).toEqual([
      ["Pós 12GB — por linha", "7", "R$ 39,99", "R$ 279,93"],
      ["7 linha(s) — 7× 12GB — valor total consolidado", "7", "-", "R$ 279,93"],
    ]);
  });
});

describe("rotuloTotalProposta", () => {
  it("avisa que o total inclui o Claro Monitor quando ele está nos benefícios", () => {
    expect(rotuloTotalProposta(modelo())).toBe("TOTAL");
    const comMonitor = modelo({
      beneficios: { movel: true, badges: [{ label: "Claro Monitor", desc: "", cor: "B3101F" }] },
    });
    expect(rotuloTotalProposta(comMonitor)).toBe("TOTAL (inclui Claro Monitor)");
  });
});

describe("reducaoDe / textoReducao (regra do painel: só mostra redução real)", () => {
  it("só existe quando o proposto é menor que o atual, com a porcentagem", () => {
    const reducao = reducaoDe(modelo(comSituacao(155.97, 79.98)));
    expect(reducao?.valor).toBe(75.99);
    expect(reducao?.pct).toBeCloseTo(48.72, 1);
  });

  it("aumento, igualdade e ausência de situação atual não têm redução", () => {
    expect(reducaoDe(modelo(comSituacao(100, 150)))).toBeNull();
    expect(reducaoDe(modelo(comSituacao(100, 100)))).toBeNull();
    expect(reducaoDe(modelo())).toBeNull();
  });

  it("escreve o valor e a porcentagem com vírgula", () => {
    expect(textoReducao({ valor: 75.99, pct: 48.72 })).toBe("Redução na fatura: R$ 75,99 (48,7%)");
    expect(textoReducao({ valor: 10, pct: null })).toBe("Redução na fatura: R$ 10,00");
  });
});

describe("tituloDoCliente / destaqueDoCliente", () => {
  it("o título muda com a existência da situação atual", () => {
    expect(tituloDoCliente(modelo())).toBe("RESUMO DA PROPOSTA");
    expect(tituloDoCliente(modelo(comSituacao(100, 80)))).toBe("COMPARATIVO DA SUA FATURA");
  });

  it("economia em verde, aumento em âmbar, igual e sem fatura em preto", () => {
    expect(destaqueDoCliente(modelo(comSituacao(155.97, 79.98)))).toEqual({
      titulo: "ECONOMIA MENSAL",
      valor: "R$ 75,99",
      cor: "verde",
    });
    expect(destaqueDoCliente(modelo(comSituacao(100, 173.9)))).toEqual({
      titulo: "AUMENTO MENSAL",
      valor: "R$ 73,90",
      cor: "ambar",
    });
    expect(destaqueDoCliente(modelo(comSituacao(100, 100)))).toEqual({
      titulo: "MESMA MENSALIDADE",
      valor: "R$ 100,00",
      cor: "preto",
    });
    expect(destaqueDoCliente(modelo())).toEqual({
      titulo: "MENSALIDADE PROPOSTA",
      valor: "R$ 100,00",
      cor: "preto",
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/documentos/formato.test.ts`
Expected: FAIL — `Cannot find module './formato'`.

- [ ] **Step 3: Implementar `formato.ts`**

Crie `lib/documentos/formato.ts`:

```ts
import { formatarBRL } from "../formato";
import type { LinhaTabela, ModeloDocumento } from "../proposta/modelo-documento";

export const RODAPE_EMPRESA =
  "Apex Smart Solutions — Agente Autorizado Claro Empresas · CNPJ 64.307.984/0001-30";
export const SUBTITULO_CONSULTOR = "Apex Smart Solutions — Parceiro autorizado Claro Empresas";

// O Intl usa espaço não separável depois do "R$"; nos PDFs ele atrapalharia a
// busca e a quebra de linha.
export function moeda(valor: number): string {
  return formatarBRL(valor).replace(/ /g, " ");
}

// Sem acento nem símbolo: o navegador e o Windows tratam nome de arquivo com mais
// cuidado do que a razão social merece.
export function nomeDeArquivo(prefixo: string, razaoSocial: string, extensao: string): string {
  const nome = razaoSocial
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${prefixo}_${nome || "cliente"}.${extensao}`;
}

export function linhasDaTabela(itens: LinhaTabela[]): string[][] {
  return itens.map((item) => [
    item.descricao,
    String(item.quantidade),
    item.valorUnitario === null ? "-" : moeda(item.valorUnitario),
    moeda(item.subtotal),
  ]);
}

// O Claro Monitor soma no total sem aparecer como linha; o rótulo avisa, para o
// cliente não achar que a conta não fecha.
export function rotuloTotalProposta(modelo: ModeloDocumento): string {
  return modelo.beneficios.badges.some((b) => b.label === "Claro Monitor")
    ? "TOTAL (inclui Claro Monitor)"
    : "TOTAL";
}

// Regra do painel (seção 7): nos documentos do consultor a diferença só aparece
// quando há redução real.
export function reducaoDe(modelo: ModeloDocumento): { valor: number; pct: number | null } | null {
  const { atual, diferenca, tipo } = modelo.resumo;
  if (tipo !== "economia" || atual === null || diferenca === null) return null;
  const valor = Math.abs(diferenca);
  return { valor, pct: atual > 0 ? (valor / atual) * 100 : null };
}

export function textoReducao(reducao: { valor: number; pct: number | null }): string {
  const pct = reducao.pct === null ? "" : ` (${reducao.pct.toFixed(1).replace(".", ",")}%)`;
  return `Redução na fatura: ${moeda(reducao.valor)}${pct}`;
}

export function tituloDoCliente(modelo: ModeloDocumento): string {
  return modelo.situacaoAtual ? "COMPARATIVO DA SUA FATURA" : "RESUMO DA PROPOSTA";
}

// Material do cliente: mostra a economia (verde) ou o aumento (âmbar), com o valor.
export function destaqueDoCliente(modelo: ModeloDocumento): {
  titulo: string;
  valor: string;
  cor: "verde" | "ambar" | "preto";
} {
  const { diferenca, tipo, proposto } = modelo.resumo;
  if (tipo === "economia" && diferenca !== null) {
    return { titulo: "ECONOMIA MENSAL", valor: moeda(Math.abs(diferenca)), cor: "verde" };
  }
  if (tipo === "aumento" && diferenca !== null) {
    return { titulo: "AUMENTO MENSAL", valor: moeda(diferenca), cor: "ambar" };
  }
  if (tipo === "igual") return { titulo: "MESMA MENSALIDADE", valor: moeda(proposto), cor: "preto" };
  return { titulo: "MENSALIDADE PROPOSTA", valor: moeda(proposto), cor: "preto" };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/documentos/formato.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar o apoio de testes (`fixtures.ts`)**

Crie `lib/documentos/fixtures.ts`:

```ts
// Apoio dos testes dos desenhistas de arquivo (Word, PDF): dados SINTÉTICOS e
// leitores de volta (o que está dentro do arquivo gerado). Não é teste.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extrairTextoDePaginas, type PdfjsMinimo } from "../fatura/pdf-texto";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { subtotalDaLinha, type NovoItemProposta } from "../propostas";
import {
  montarModeloDocumento,
  type EntradaModelo,
  type ModeloDocumento,
} from "../proposta/modelo-documento";
import type { Logos } from "./marca";

export const AGORA_TESTE = new Date("2026-10-19T15:00:00Z"); // 12h em Brasília

function lerMarca(arquivo: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../public/marca/${arquivo}`, import.meta.url))));
}

export function logosDeTeste(): Logos {
  return { apex: lerMarca("apex-logo.png"), claro: lerMarca("claro-logo.jpg") };
}

function fatura(parcial: Partial<LinhaAtual>): LinhaAtual {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 9728,
    origem: "fatura",
    proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
    ...parcial,
  };
}

export const SITUACAO_TESTE: SituacaoAtual = {
  faturasAnalisadas: 2,
  linhas: [
    fatura({ rotulo: "(17) ••••• 0001" }),
    fatura({ rotulo: "(17) ••••• 0002" }),
    fatura({ rotulo: "(17) ••••• 0003", planoGb: 20, valorUnitario: 58.99, consumoMb: 2048 }),
  ],
};

// Padrão dos testes: situação atual de R$ 155,97 contra uma proposta de R$ 134,97
// (119,97 de Pós + 15,00 de Claro Monitor), ou seja, uma economia de R$ 21,00.
export const ITENS_TESTE: NovoItemProposta[] = [
  { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: subtotalDaLinha(39.99, 3), quantidade: 3, franquiaGb: 12 },
  { catalogoPlanoId: "m1", descricao: "Claro Monitor", valor: subtotalDaLinha(5, 3), quantidade: 3, franquiaGb: null },
];

export function entradaDeTeste(parcial: Partial<EntradaModelo> = {}): EntradaModelo {
  return {
    cliente: { razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" },
    consultor: "Ana Teste",
    situacaoAtual: SITUACAO_TESTE,
    itens: ITENS_TESTE,
    opcoes: { consolidar: false, vendedor: null },
    agora: AGORA_TESTE,
    ...parcial,
  };
}

export function modeloDeTeste(parcial: Partial<EntradaModelo> = {}): ModeloDocumento {
  return montarModeloDocumento(entradaDeTeste(parcial));
}

const require = createRequire(import.meta.url);
const OPCOES_PDFJS = {
  standardFontDataUrl: pathToFileURL(join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + sep).href,
};

export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  return extrairTextoDePaginas(pdfjs as unknown as PdfjsMinimo, bytes, "teste.pdf", OPCOES_PDFJS);
}

export async function paginasDoPdf(bytes: Uint8Array): Promise<number> {
  return (await textoDoPdf(bytes)).split("\n").length;
}

export async function textoDoDocx(bytes: Uint8Array): Promise<{ xml: string; imagens: number }> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await (zip.file("word/document.xml") as JSZip.JSZipObject).async("string");
  const imagens = Object.keys(zip.files).filter((nome) => nome.startsWith("word/media/")).length;
  return { xml, imagens };
}
```

- [ ] **Step 6: Escrever o teste do Word (vai falhar)**

Crie `lib/documentos/docx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gerarDocx } from "./docx";
import { entradaDeTeste, logosDeTeste, modeloDeTeste, textoDoDocx } from "./fixtures";

describe("gerarDocx", () => {
  it("gera um .docx de verdade (zip) com os dois logos no cabeçalho", async () => {
    const bytes = await gerarDocx(modeloDeTeste(), logosDeTeste());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const { imagens } = await textoDoDocx(bytes);
    expect(imagens).toBe(2);
  });

  it("traz título, cliente, CNPJ, consultor, datas e rodapé da empresa", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    for (const texto of [
      "PROPOSTA COMERCIAL",
      "EMPRESA EXEMPLO LTDA",
      "11.222.333/0001-81",
      "Ana Teste",
      "19/10/2026",
      "20/10/2026",
      "Agente Autorizado Claro Empresas",
    ]) {
      expect(xml).toContain(texto);
    }
  });

  it("mostra a situação atual agrupada, a nova proposta e os totais", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(xml).toContain("SITUAÇÃO ATUAL");
    expect(xml).toContain("Plano atual — 10GB");
    expect(xml).toContain("R$ 155,97"); // total atual (2×48,49 + 58,99)
    expect(xml).toContain("NOVA PROPOSTA");
    expect(xml).toContain("Pós 12GB — por linha");
    expect(xml).toContain("R$ 119,97"); // 3 × R$ 39,99
    expect(xml).toContain("TOTAL (inclui Claro Monitor)");
    expect(xml).toContain("R$ 134,97"); // 119,97 de Pós + 15,00 de Claro Monitor
  });

  it("o Claro Monitor aparece como benefício e não como linha da tabela", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(xml).toContain("BENEFÍCIOS INCLUSOS");
    expect(xml).toContain("Ligações ilimitadas");
    expect(xml).toContain("Claro Monitor");
    expect(xml).not.toContain("R$ 15,00"); // subtotal do Monitor (3 × R$ 5,00) não vira linha
  });

  it("mostra a redução na fatura só quando o proposto é menor que o atual", async () => {
    const economia = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(economia.xml).toContain("Redução na fatura");

    const aumento = modeloDeTeste({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento.resumo.tipo).toBe("aumento");
    const semReducao = await textoDoDocx(await gerarDocx(aumento, logosDeTeste()));
    expect(semReducao.xml).not.toContain("Redução na fatura");
  });

  it("sem situação atual não há a seção e o documento continua válido", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste({ situacaoAtual: null }), logosDeTeste()));
    expect(xml).not.toContain("SITUAÇÃO ATUAL");
    expect(xml).toContain("NOVA PROPOSTA");
  });

  it("escapa símbolos do nome do cliente (E comercial) sem corromper o XML", async () => {
    const modelo = modeloDeTeste({
      cliente: { razaoSocial: "PADARIA & CIA <LTDA>", cnpjDigits: "11222333000181" },
    });
    const { xml } = await textoDoDocx(await gerarDocx(modelo, logosDeTeste()));
    expect(xml).toContain("PADARIA &amp; CIA &lt;LTDA&gt;");
  });

  it("o vendedor editado aparece no lugar do consultor logado", async () => {
    const modelo = modeloDeTeste({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } });
    const { xml } = await textoDoDocx(await gerarDocx(modelo, logosDeTeste()));
    expect(xml).toContain("Maria Vendedora");
    expect(xml).not.toContain("Ana Teste");
  });

  it("um documento com 60 linhas de proposta é gerado sem erro", async () => {
    const itens = Array.from({ length: 60 }, (_, i) => ({
      catalogoPlanoId: null,
      descricao: `Oferta avulsa número ${i + 1} com uma descrição bem longa para forçar a quebra de linha`,
      valor: 10,
      quantidade: 1,
      franquiaGb: null,
    }));
    const bytes = await gerarDocx(modeloDeTeste({ itens }), logosDeTeste());
    expect(bytes.byteLength).toBeGreaterThan(5000);
    expect(entradaDeTeste({ itens }).itens).toHaveLength(60);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run lib/documentos/docx.test.ts`
Expected: FAIL — `Cannot find module './docx'`.

- [ ] **Step 8: Implementar o Word**

Crie `lib/documentos/docx.ts`:

```ts
// Word editável da proposta comercial (consultor). Só desenha o ModeloDocumento:
// nenhuma conta de negócio aqui.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { LinhaTabela, ModeloDocumento } from "../proposta/modelo-documento";
import {
  RODAPE_EMPRESA,
  SUBTITULO_CONSULTOR,
  linhasDaTabela,
  moeda,
  reducaoDe,
  rotuloTotalProposta,
  textoReducao,
} from "./formato";
import { LOGO_APEX, LOGO_CLARO, type Logos } from "./marca";

const PRETO = "0D0D0D";
const VERMELHO = "B3101F";
const CINZA_FUNDO = "F3F4F6";
const CINZA_TEXTO = "6B7280";
const BORDA = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
const SEM_BORDA = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const SEM_BORDAS = { top: SEM_BORDA, bottom: SEM_BORDA, left: SEM_BORDA, right: SEM_BORDA };

// Mantém a proporção do logo dentro de um quadrado de `lado` pixels.
function tamanhoDoLogo(logo: { largura: number; altura: number }, lado: number) {
  const escala = Math.min(lado / logo.largura, lado / logo.altura);
  return { width: Math.round(logo.largura * escala), height: Math.round(logo.altura * escala) };
}

function texto(conteudo: string, opcoes: { negrito?: boolean; cor?: string; tamanho?: number } = {}): TextRun {
  return new TextRun({ text: conteudo, bold: opcoes.negrito, color: opcoes.cor, size: (opcoes.tamanho ?? 10) * 2 });
}

function celula(
  conteudo: string,
  opcoes: { largura: number; fundo?: string; cor?: string; negrito?: boolean; direita?: boolean; tamanho?: number }
): TableCell {
  return new TableCell({
    width: { size: opcoes.largura, type: WidthType.PERCENTAGE },
    borders: BORDAS,
    shading: opcoes.fundo ? { type: ShadingType.CLEAR, color: "auto", fill: opcoes.fundo } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opcoes.direita ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [texto(conteudo, { negrito: opcoes.negrito, cor: opcoes.cor, tamanho: opcoes.tamanho })],
      }),
    ],
  });
}

const LARGURAS = [52, 10, 19, 19];

function tabelaDeItens(itens: LinhaTabela[], total: number, rotuloTotal: string): Table {
  const cabecalho = new TableRow({
    tableHeader: true,
    children: ["DESCRIÇÃO", "QTD", "VALOR UNIT.", "SUBTOTAL"].map((nome, i) =>
      celula(nome, { largura: LARGURAS[i], fundo: VERMELHO, cor: "FFFFFF", negrito: true, direita: i > 0, tamanho: 8.5 })
    ),
  });
  const corpo = linhasDaTabela(itens).map(
    (colunas, indice) =>
      new TableRow({
        children: colunas.map((valor, i) =>
          celula(valor, { largura: LARGURAS[i], fundo: indice % 2 ? CINZA_FUNDO : undefined, direita: i > 0 })
        ),
      })
  );
  const linhaTotal = new TableRow({
    children: [
      celula(rotuloTotal, { largura: LARGURAS[0] + LARGURAS[1] + LARGURAS[2], fundo: CINZA_FUNDO, negrito: true }),
      celula(moeda(total), { largura: LARGURAS[3], fundo: CINZA_FUNDO, negrito: true, direita: true }),
    ],
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [cabecalho, ...corpo, linhaTotal] });
}

function secao(titulo: string): Paragraph {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    children: [texto(titulo, { negrito: true, cor: VERMELHO, tamanho: 11 })],
  });
}

function cabecalhoComLogos(logos: Logos): Table {
  const apex = tamanhoDoLogo(LOGO_APEX, 48);
  const claro = tamanhoDoLogo(LOGO_CLARO, 48);
  const fundo = { type: ShadingType.CLEAR, color: "auto", fill: PRETO } as const;
  const centro = (linhas: Paragraph[]) =>
    new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: SEM_BORDAS, shading: fundo, verticalAlign: VerticalAlign.CENTER, children: linhas });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: fundo,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 100, bottom: 100, left: 150, right: 100 },
            children: [new Paragraph({ children: [new ImageRun({ type: "png", data: logos.apex, transformation: apex })] })],
          }),
          centro([
            new Paragraph({ alignment: AlignmentType.CENTER, children: [texto("PROPOSTA COMERCIAL", { negrito: true, cor: "FFFFFF", tamanho: 16 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [texto(SUBTITULO_CONSULTOR, { cor: "FFFFFF", tamanho: 8.5 })] }),
          ]),
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: fundo,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 100, bottom: 100, left: 100, right: 150 },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: "jpg", data: logos.claro, transformation: claro })] })],
          }),
        ],
      }),
    ],
  });
}

function dadosDoCliente(modelo: ModeloDocumento): Table {
  const rotulo = (nome: string, largura: number) =>
    celula(nome, { largura, fundo: CINZA_FUNDO, cor: CINZA_TEXTO, negrito: true, tamanho: 7.5 });
  const valor = (conteudo: string, largura: number) => celula(conteudo, { largura, negrito: true, tamanho: 10.5 });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [rotulo("CLIENTE", 40), rotulo("CNPJ", 20), rotulo("DATA DE EMISSÃO", 15), rotulo("CONSULTOR", 25)] }),
      new TableRow({
        children: [
          valor(modelo.cliente.razaoSocial, 40),
          valor(modelo.cliente.cnpj, 20),
          valor(modelo.emitidoEm, 15),
          valor(modelo.consultor, 25),
        ],
      }),
    ],
  });
}

function caixaDeDestaque(modelo: ModeloDocumento): Table {
  const reducao = reducaoDe(modelo);
  const linhas = [
    new Paragraph({ children: [texto("VALOR PROPOSTO (MENSAL)", { negrito: true, cor: "FFFFFF", tamanho: 8.5 })] }),
    new Paragraph({ children: [texto(moeda(modelo.resumo.proposto), { negrito: true, cor: "FFFFFF", tamanho: 20 })] }),
    ...(reducao
      ? [new Paragraph({ children: [texto(textoReducao(reducao), { cor: "FFFFFF", tamanho: 10 })] })]
      : []),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: VERMELHO },
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            children: linhas,
          }),
        ],
      }),
    ],
  });
}

export async function gerarDocx(modelo: ModeloDocumento, logos: Logos): Promise<Uint8Array> {
  const filhos: Array<Paragraph | Table> = [
    cabecalhoComLogos(logos),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    dadosDoCliente(modelo),
  ];

  if (modelo.situacaoAtual) {
    filhos.push(
      secao("SITUAÇÃO ATUAL"),
      tabelaDeItens(modelo.situacaoAtual.itens, modelo.situacaoAtual.total, "TOTAL ATUAL"),
      new Paragraph({ spacing: { before: 60 }, children: [texto(modelo.situacaoAtual.nota, { cor: CINZA_TEXTO, tamanho: 7.5 })] })
    );
  }

  filhos.push(
    secao("NOVA PROPOSTA"),
    tabelaDeItens(modelo.novaProposta.itens, modelo.novaProposta.total, rotuloTotalProposta(modelo))
  );

  if (modelo.beneficios.badges.length > 0) {
    filhos.push(secao("BENEFÍCIOS INCLUSOS"));
    for (const badge of modelo.beneficios.badges) {
      filhos.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [texto(`${badge.label}: `, { negrito: true, cor: badge.cor, tamanho: 9.5 }), texto(badge.desc, { tamanho: 9.5 })],
        })
      );
    }
  }

  filhos.push(new Paragraph({ spacing: { after: 160 }, children: [] }), caixaDeDestaque(modelo));
  filhos.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280 },
      children: [texto(RODAPE_EMPRESA, { cor: CINZA_TEXTO, tamanho: 8 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [texto(`Emitido em ${modelo.emitidoEm} · Válida até ${modelo.validoAte}`, { cor: CINZA_TEXTO, tamanho: 8 })],
    })
  );

  const documento = new Document({ sections: [{ children: filhos }] });
  return new Uint8Array(await Packer.toArrayBuffer(documento));
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run lib/documentos`
Expected: PASS (formato + docx + marca). Se o teste "não contém R$ 15,00" falhar, o Monitor foi indevidamente listado como linha: confira que `montarModeloDocumento` o tira de `novaProposta.itens`. Se falhar a contagem de 2 imagens, confira se `ImageRun` recebeu `type` (`"png"`/`"jpg"`), exigido pela docx 9.

- [ ] **Step 10: Conferir tipos e commit**

Run: `npx tsc --noEmit` — Expected: sem erro.

```bash
git add lib/documentos/formato.ts lib/documentos/formato.test.ts lib/documentos/fixtures.ts lib/documentos/docx.ts lib/documentos/docx.test.ts
git commit -m "feat(crm-fibra): generate the editable Word proposal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: PDF do consultor e PDF do cliente

**Files:**
- Create: `lib/documentos/pdf-base.ts`
- Create: `lib/documentos/pdf-consultor.ts`, `lib/documentos/pdf-consultor.test.ts`
- Create: `lib/documentos/pdf-cliente.ts`, `lib/documentos/pdf-cliente.test.ts`

**Interfaces:**
- Consumes: `ModeloDocumento` (Task 10); `moeda`, `linhasDaTabela`, `reducaoDe`, `textoReducao`, `rotuloTotalProposta`, `tituloDoCliente`, `destaqueDoCliente`, `RODAPE_EMPRESA`, `SUBTITULO_CONSULTOR` (Task 11); `Logos`, `LOGO_APEX`, `LOGO_CLARO` (Task 1); fixtures (Task 11).
- Produces: `gerarPdfConsultor(modelo: ModeloDocumento, logos: Logos): Uint8Array`; `gerarPdfCliente(modelo: ModeloDocumento, logos: Logos): Uint8Array`; e os auxiliares de `pdf-base.ts` (`COR`, `novoDocumento`, `desenharCabecalho`, `desenharRodape`, `desenharDadosDoCliente`, `tituloDeSecao`, `desenharTabela`, `garantirEspaco`, `caixaDeDestaque`, `desenharBeneficios`, `notaPequena`).

Regra de encoding: o jsPDF usa fontes padrão (WinAnsi). `•`, `—`, `×`, `·` e todos os acentos funcionam; **setas (`→`) e outros símbolos fora do Latin-1 não**. Nenhum texto dos PDFs usa seta.

- [ ] **Step 1: Escrever os testes do PDF do consultor (vão falhar)**

Crie `lib/documentos/pdf-consultor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gerarPdfConsultor } from "./pdf-consultor";
import { logosDeTeste, modeloDeTeste, paginasDoPdf, textoDoPdf } from "./fixtures";

const texto = async (parcial = {}) => textoDoPdf(gerarPdfConsultor(modeloDeTeste(parcial), logosDeTeste()));

describe("gerarPdfConsultor", () => {
  it("gera um PDF de verdade", () => {
    const bytes = gerarPdfConsultor(modeloDeTeste(), logosDeTeste());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("traz título, cliente, CNPJ, consultor, datas e rodapé", async () => {
    const t = await texto();
    for (const trecho of [
      "PROPOSTA COMERCIAL",
      "EMPRESA EXEMPLO LTDA",
      "11.222.333/0001-81",
      "Ana Teste",
      "19/10/2026",
      "Válida até 20/10/2026",
      "Agente Autorizado Claro Empresas",
    ]) {
      expect(t).toContain(trecho);
    }
  });

  it("mostra a situação atual agrupada e a nova proposta, com os totais", async () => {
    const t = await texto();
    expect(t).toContain("SITUAÇÃO ATUAL");
    expect(t).toContain("Plano atual — 10GB");
    expect(t).toContain("R$ 155,97");
    expect(t).toContain("NOVA PROPOSTA");
    expect(t).toContain("Pós 12GB — por linha");
    expect(t).toContain("TOTAL (inclui Claro Monitor)");
  });

  it("o Claro Monitor é benefício, não linha, e os benefícios aparecem", async () => {
    const t = await texto();
    expect(t).toContain("BENEFÍCIOS INCLUSOS");
    expect(t).toContain("Ligações ilimitadas");
    expect(t).toContain("Claro Monitor");
    expect(t).not.toContain("R$ 15,00");
  });

  it("a redução só aparece quando há redução real", async () => {
    expect(await texto()).toContain("Redução na fatura");
    const aumento = await texto({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento).not.toContain("Redução na fatura");
    expect(aumento).toContain("R$ 1.949,90");
  });

  it("sem situação atual não há a seção", async () => {
    const t = await texto({ situacaoAtual: null });
    expect(t).not.toContain("SITUAÇÃO ATUAL");
    expect(t).toContain("NOVA PROPOSTA");
  });

  it("proposta grande quebra em várias páginas e o rodapé aparece em todas", async () => {
    const itens = Array.from({ length: 60 }, (_, i) => ({
      catalogoPlanoId: null,
      descricao: `Oferta avulsa número ${i + 1} com uma descrição bem longa para forçar a quebra de linha`,
      valor: 10,
      quantidade: 1,
      franquiaGb: null,
    }));
    const bytes = gerarPdfConsultor(modeloDeTeste({ itens }), logosDeTeste());
    expect(await paginasDoPdf(bytes)).toBeGreaterThan(1);
    const t = await textoDoPdf(bytes);
    expect((t.match(/Válida até 20\/10\/2026/g) ?? []).length).toBe(await paginasDoPdf(bytes));
    expect(t).toContain("Oferta avulsa número 60");
  });

  it("razão social muito longa quebra a linha sem perder nenhuma palavra", async () => {
    const longa = "EMPRESA EXEMPLO DE COMERCIO E SERVICOS DE TELECOMUNICACOES E TECNOLOGIA DA INFORMACAO LTDA";
    const t = await texto({ cliente: { razaoSocial: longa, cnpjDigits: "11222333000181" } });
    for (const palavra of longa.split(" ")) expect(t).toContain(palavra);
  });

  it("o vendedor editado aparece no lugar do consultor logado", async () => {
    const t = await texto({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } });
    expect(t).toContain("Maria Vendedora");
    expect(t).not.toContain("Ana Teste");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/documentos/pdf-consultor.test.ts`
Expected: FAIL — `Cannot find module './pdf-consultor'`.

- [ ] **Step 3: Implementar os auxiliares (`pdf-base.ts`)**

Crie `lib/documentos/pdf-base.ts`:

```ts
// Peças comuns dos dois PDFs (consultor e cliente): faixa preta com os logos,
// tabelas com cabeçalho vermelho, caixa de destaque e rodapé em todas as páginas.
// jspdf-autotable cuida da quebra de linha e de página das tabelas.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Badge, ModeloDocumento } from "../proposta/modelo-documento";
import { RODAPE_EMPRESA } from "./formato";
import { LOGO_APEX, LOGO_CLARO, type Logos } from "./marca";

export type RGB = [number, number, number];

export const COR = {
  preto: [13, 13, 13] as RGB,
  vermelho: [179, 16, 31] as RGB,
  cinzaFundo: [243, 244, 246] as RGB,
  borda: [209, 213, 219] as RGB,
  cinzaTexto: [107, 114, 128] as RGB,
  branco: [255, 255, 255] as RGB,
  verde: [22, 163, 74] as RGB,
  ambar: [180, 83, 9] as RGB,
};

export const LARGURA_PAGINA = 210;
export const MARGEM = 14;
export const LARGURA_UTIL = LARGURA_PAGINA - 2 * MARGEM;
export const ALTURA_RODAPE = 14;

export function novoDocumento(): jsPDF {
  return new jsPDF({ unit: "mm", format: "a4" });
}

export function hexParaRgb(hex: string): RGB {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// Mantém a proporção do logo dentro de uma caixa.
function caber(logo: { largura: number; altura: number }, larguraMax: number, alturaMax: number) {
  const escala = Math.min(larguraMax / logo.largura, alturaMax / logo.altura);
  return { w: logo.largura * escala, h: logo.altura * escala };
}

export function desenharCabecalho(doc: jsPDF, titulo: string, subtitulo: string, logos: Logos): void {
  doc.setFillColor(...COR.preto);
  doc.rect(0, 0, LARGURA_PAGINA, 30, "F");

  doc.setFillColor(...COR.branco);
  doc.roundedRect(12, 6, 20, 18, 2, 2, "F");
  const apex = caber(LOGO_APEX, 16, 14);
  doc.addImage(logos.apex, LOGO_APEX.formato, 12 + (20 - apex.w) / 2, 6 + (18 - apex.h) / 2, apex.w, apex.h);

  doc.setFillColor(...COR.branco);
  doc.roundedRect(178, 6, 20, 18, 2, 2, "F");
  const claro = caber(LOGO_CLARO, 16, 14);
  doc.addImage(logos.claro, LOGO_CLARO.formato, 178 + (20 - claro.w) / 2, 6 + (18 - claro.h) / 2, claro.w, claro.h);

  doc.setTextColor(...COR.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(titulo, LARGURA_PAGINA / 2, 14, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(subtitulo, LARGURA_PAGINA / 2, 21, { align: "center", maxWidth: 130 });
}

export function desenharRodape(doc: jsPDF, emitidoEm: string, validoAte: string): void {
  const total = doc.getNumberOfPages();
  const altura = doc.internal.pageSize.getHeight();
  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina);
    doc.setFillColor(...COR.preto);
    doc.rect(0, altura - ALTURA_RODAPE, LARGURA_PAGINA, ALTURA_RODAPE, "F");
    doc.setTextColor(...COR.branco);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(RODAPE_EMPRESA, MARGEM, altura - 8);
    doc.setFont("helvetica", "normal");
    doc.text(`Emitido em ${emitidoEm} · Válida até ${validoAte}`, MARGEM, altura - 4);
    doc.text(`Página ${pagina} de ${total}`, LARGURA_PAGINA - MARGEM, altura - 4, { align: "right" });
  }
}

export function finalDaUltimaTabela(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

// Se não couber `altura` mm antes do rodapé, abre uma página nova.
export function garantirEspaco(doc: jsPDF, y: number, altura: number): number {
  const limite = doc.internal.pageSize.getHeight() - ALTURA_RODAPE - 4;
  if (y + altura > limite) {
    doc.addPage();
    return 16;
  }
  return y;
}

export function tituloDeSecao(doc: jsPDF, y: number, titulo: string): number {
  const posicao = garantirEspaco(doc, y, 20);
  doc.setTextColor(...COR.vermelho);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(titulo, MARGEM, posicao + 4);
  return posicao + 7;
}

export function notaPequena(doc: jsPDF, y: number, texto: string): number {
  const linhas = doc.splitTextToSize(texto, LARGURA_UTIL) as string[];
  const posicao = garantirEspaco(doc, y, linhas.length * 3.5 + 2);
  doc.setTextColor(...COR.cinzaTexto);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(linhas, MARGEM, posicao + 3);
  return posicao + linhas.length * 3.5 + 3;
}

interface OpcoesTabela {
  larguras?: Record<number, number>; // largura fixa (mm) por coluna
  direita?: number[]; // colunas alinhadas à direita
  centro?: number[];
  linhaTotal?: string[]; // última linha, em negrito
  corCabecalho?: RGB;
}

export function desenharTabela(
  doc: jsPDF,
  inicioY: number,
  cabecalho: string[],
  corpo: string[][],
  opcoes: OpcoesTabela = {}
): number {
  // O autotable indexa as colunas por texto ("0", "1"...).
  const colunas: Record<string, { halign?: "right" | "center"; cellWidth?: number }> = {};
  cabecalho.forEach((_, i) => {
    colunas[String(i)] = {
      ...(opcoes.direita?.includes(i) ? { halign: "right" as const } : {}),
      ...(opcoes.centro?.includes(i) ? { halign: "center" as const } : {}),
      ...(opcoes.larguras?.[i] ? { cellWidth: opcoes.larguras[i] } : {}),
    };
  });
  const indiceTotal = corpo.length;
  autoTable(doc, {
    startY: inicioY,
    head: [cabecalho],
    body: opcoes.linhaTotal ? [...corpo, opcoes.linhaTotal] : corpo,
    margin: { left: MARGEM, right: MARGEM, top: 16, bottom: ALTURA_RODAPE + 4 },
    theme: "grid",
    styles: { fontSize: 8.5, textColor: COR.preto, lineColor: COR.borda, lineWidth: 0.2, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: opcoes.corCabecalho ?? COR.vermelho, textColor: COR.branco, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COR.cinzaFundo },
    columnStyles: colunas,
    didParseCell: (dados) => {
      if (opcoes.linhaTotal && dados.section === "body" && dados.row.index === indiceTotal) {
        dados.cell.styles.fontStyle = "bold";
        dados.cell.styles.fillColor = COR.cinzaFundo;
      }
    },
  });
  return finalDaUltimaTabela(doc);
}

// Cliente, CNPJ, emissão e consultor numa tabela de uma linha: a altura acompanha
// a razão social, por mais longa que seja.
export function desenharDadosDoCliente(doc: jsPDF, inicioY: number, modelo: ModeloDocumento): number {
  autoTable(doc, {
    startY: inicioY,
    head: [["CLIENTE", "CNPJ", "DATA DE EMISSÃO", "CONSULTOR"]],
    body: [[modelo.cliente.razaoSocial, modelo.cliente.cnpj, modelo.emitidoEm, modelo.consultor]],
    margin: { left: MARGEM, right: MARGEM, top: 16, bottom: ALTURA_RODAPE + 4 },
    theme: "grid",
    styles: { fontSize: 9.5, textColor: COR.preto, lineColor: COR.borda, lineWidth: 0.2, cellPadding: 2.5, fontStyle: "bold", overflow: "linebreak" },
    headStyles: { fillColor: COR.cinzaFundo, textColor: COR.cinzaTexto, fontSize: 7, fontStyle: "bold" },
    columnStyles: { 1: { cellWidth: 38 }, 2: { cellWidth: 30 }, 3: { cellWidth: 38 } },
  });
  return finalDaUltimaTabela(doc);
}

export function caixaDeDestaque(
  doc: jsPDF,
  y: number,
  titulo: string,
  valor: string,
  cor: RGB,
  linhaExtra?: string
): number {
  const altura = linhaExtra ? 28 : 22;
  const posicao = garantirEspaco(doc, y, altura + 2);
  doc.setFillColor(...cor);
  doc.roundedRect(MARGEM, posicao, LARGURA_UTIL, altura, 2, 2, "F");
  doc.setTextColor(...COR.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(titulo, MARGEM + 6, posicao + 7);
  doc.setFontSize(18);
  doc.text(valor, MARGEM + 6, posicao + 17);
  if (linhaExtra) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(linhaExtra, MARGEM + 6, posicao + 24);
  }
  return posicao + altura + 6;
}

export function desenharBeneficios(doc: jsPDF, y: number, badges: Badge[]): number {
  let atual = y;
  for (const badge of badges) {
    atual = garantirEspaco(doc, atual, 8);
    doc.setFillColor(...hexParaRgb(badge.cor));
    doc.roundedRect(MARGEM, atual, 3.5, 3.5, 0.8, 0.8, "F");
    doc.setTextColor(...COR.preto);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(badge.label, MARGEM + 6, atual + 3);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COR.cinzaTexto);
    doc.setFontSize(8);
    doc.text(badge.desc, MARGEM + 6 + doc.getTextWidth(`${badge.label}  `) + 2, atual + 3, {
      maxWidth: LARGURA_UTIL - 8 - doc.getTextWidth(`${badge.label}  `),
    });
    atual += 6;
  }
  return atual + 2;
}
```

- [ ] **Step 4: Implementar o PDF do consultor**

Crie `lib/documentos/pdf-consultor.ts`:

```ts
// PDF da proposta comercial para o consultor (negociação): mesmo conteúdo do Word.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import { SUBTITULO_CONSULTOR, linhasDaTabela, moeda, reducaoDe, rotuloTotalProposta, textoReducao } from "./formato";
import type { Logos } from "./marca";
import {
  COR,
  caixaDeDestaque,
  desenharBeneficios,
  desenharCabecalho,
  desenharDadosDoCliente,
  desenharRodape,
  desenharTabela,
  notaPequena,
  novoDocumento,
  tituloDeSecao,
} from "./pdf-base";

const CABECALHO = ["DESCRIÇÃO", "QTD", "VALOR UNIT.", "SUBTOTAL"];
const ESTILO_TABELA = { larguras: { 1: 14, 2: 30, 3: 30 }, centro: [1], direita: [2, 3] };

export function gerarPdfConsultor(modelo: ModeloDocumento, logos: Logos): Uint8Array {
  const doc = novoDocumento();
  desenharCabecalho(doc, "PROPOSTA COMERCIAL", SUBTITULO_CONSULTOR, logos);

  let y = desenharDadosDoCliente(doc, 36, modelo) + 8;

  if (modelo.situacaoAtual) {
    y = tituloDeSecao(doc, y, "SITUAÇÃO ATUAL");
    y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.situacaoAtual.itens), {
      ...ESTILO_TABELA,
      linhaTotal: ["TOTAL ATUAL", "", "", moeda(modelo.situacaoAtual.total)],
    });
    y = notaPequena(doc, y + 1, modelo.situacaoAtual.nota) + 4;
  }

  y = tituloDeSecao(doc, y, "NOVA PROPOSTA");
  y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.novaProposta.itens), {
    ...ESTILO_TABELA,
    linhaTotal: [rotuloTotalProposta(modelo), "", "", moeda(modelo.novaProposta.total)],
  });
  y += 8;

  if (modelo.beneficios.badges.length > 0) {
    y = tituloDeSecao(doc, y, "BENEFÍCIOS INCLUSOS");
    y = desenharBeneficios(doc, y, modelo.beneficios.badges);
  }

  const reducao = reducaoDe(modelo);
  caixaDeDestaque(
    doc,
    y + 2,
    "VALOR PROPOSTO (MENSAL)",
    moeda(modelo.resumo.proposto),
    COR.vermelho,
    reducao ? textoReducao(reducao) : undefined
  );

  desenharRodape(doc, modelo.emitidoEm, modelo.validoAte);
  return new Uint8Array(doc.output("arraybuffer"));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/documentos/pdf-consultor.test.ts`
Expected: PASS. Pontos que costumam falhar: (a) o teste de várias páginas conta o rodapé por página: o texto "Válida até 20/10/2026" é um item de texto por página, então a contagem tem de bater com o número de páginas; (b) se `autoTable` não for função, troque `import autoTable from "jspdf-autotable"` por `import { autoTable } from "jspdf-autotable"` (as duas formas existem na v5); (c) avisos `Unable to load font data` do pdf.js são inofensivos.

- [ ] **Step 6: Escrever os testes do PDF do cliente (vão falhar)**

Crie `lib/documentos/pdf-cliente.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gerarPdfCliente } from "./pdf-cliente";
import { logosDeTeste, modeloDeTeste, paginasDoPdf, textoDoPdf } from "./fixtures";

const texto = async (parcial = {}) => textoDoPdf(gerarPdfCliente(modeloDeTeste(parcial), logosDeTeste()));

describe("gerarPdfCliente", () => {
  it("gera um PDF de verdade", () => {
    const bytes = gerarPdfCliente(modeloDeTeste(), logosDeTeste());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("com situação atual o título é 'COMPARATIVO DA SUA FATURA', com os três cartões", async () => {
    const t = await texto();
    expect(t).toContain("COMPARATIVO DA SUA FATURA");
    expect(t).toContain("MENSALIDADE ATUAL");
    expect(t).toContain("NOVA MENSALIDADE");
    expect(t).toContain("EMPRESA EXEMPLO LTDA");
    expect(t).toContain("Emitido em 19/10/2026");
  });

  it("economia aparece como economia, com o valor", async () => {
    const t = await texto();
    expect(t).toContain("ECONOMIA MENSAL");
    expect(t).not.toContain("AUMENTO MENSAL");
  });

  it("aumento aparece como aumento (nunca escondido atrás de 'economia')", async () => {
    const t = await texto({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(t).toContain("AUMENTO MENSAL");
    expect(t).not.toContain("ECONOMIA MENSAL");
  });

  it("traz o comparativo por linha com o rótulo mascarado e os planos", async () => {
    const t = await texto();
    expect(t).toContain("COMPARATIVO POR LINHA");
    expect(t).toContain("(17) ••••• 0001");
    expect(t).toContain("Pós 12GB — por linha");
    expect(t).toContain("9,5 GB");
  });

  it("sem situação atual o título é 'RESUMO DA PROPOSTA' e não há comparativo", async () => {
    const t = await texto({ situacaoAtual: null });
    expect(t).toContain("RESUMO DA PROPOSTA");
    expect(t).toContain("MENSALIDADE PROPOSTA");
    expect(t).not.toContain("COMPARATIVO POR LINHA");
    expect(t).not.toContain("MENSALIDADE ATUAL");
  });

  it("nunca imprime um telefone completo", async () => {
    const t = await texto();
    expect(t).not.toMatch(/\d{5}[-\s]?\d{4}/);
  });

  it("muitas linhas de fatura quebram em páginas sem perder linha", async () => {
    const linhas = Array.from({ length: 80 }, (_, i) => ({
      rotulo: `(17) ••••• ${String(i).padStart(4, "0")}`,
      quantidade: 1,
      planoGb: 10,
      valorUnitario: 48.49,
      consumoMb: 5120,
      origem: "fatura" as const,
      proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
    }));
    const bytes = gerarPdfCliente(modeloDeTeste({ situacaoAtual: { faturasAnalisadas: 1, linhas } }), logosDeTeste());
    expect(await paginasDoPdf(bytes)).toBeGreaterThan(1);
    const t = await textoDoPdf(bytes);
    expect(t).toContain("(17) ••••• 0079");
  });

  it("consolidar mostra uma linha só para os planos, sem preço por linha", async () => {
    const t = await texto({ opcoes: { consolidar: true, vendedor: null } });
    expect(t).toContain("valor total consolidado");
  });

  it("traz o rodapé com a validade", async () => {
    expect(await texto()).toContain("Válida até 20/10/2026");
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run lib/documentos/pdf-cliente.test.ts`
Expected: FAIL — `Cannot find module './pdf-cliente'`.

- [ ] **Step 8: Implementar o PDF do cliente**

Crie `lib/documentos/pdf-cliente.ts`:

```ts
// PDF para o cliente final (porta de generateFaturaAnalisePDF e de
// montarPdfPropostaCliente do painel): resumo de relance, com a economia em
// verde ou o aumento em âmbar, o comparativo por linha e as tabelas.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import {
  SUBTITULO_CONSULTOR,
  destaqueDoCliente,
  linhasDaTabela,
  moeda,
  rotuloTotalProposta,
  tituloDoCliente,
} from "./formato";
import type { Logos } from "./marca";
import {
  COR,
  LARGURA_UTIL,
  MARGEM,
  caixaDeDestaque,
  desenharBeneficios,
  desenharCabecalho,
  desenharRodape,
  desenharTabela,
  garantirEspaco,
  notaPequena,
  novoDocumento,
  tituloDeSecao,
  type RGB,
} from "./pdf-base";
import type { jsPDF } from "jspdf";

const CABECALHO = ["DESCRIÇÃO", "QTD", "VALOR", "SUBTOTAL"];
const ESTILO_TABELA = { larguras: { 1: 14, 2: 30, 3: 30 }, centro: [1], direita: [2, 3] };

function cartao(doc: jsPDF, x: number, y: number, largura: number, rotulo: string, valor: string, cor: RGB): void {
  doc.setFillColor(...COR.cinzaFundo);
  doc.setDrawColor(...COR.borda);
  doc.roundedRect(x, y, largura, 24, 2, 2, "FD");
  doc.setTextColor(...COR.cinzaTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(rotulo, x + 4, y + 8, { maxWidth: largura - 8 });
  doc.setTextColor(...cor);
  doc.setFontSize(13.5);
  doc.text(valor, x + 4, y + 18);
}

function corDoDestaque(cor: "verde" | "ambar" | "preto"): RGB {
  return cor === "verde" ? COR.verde : cor === "ambar" ? COR.ambar : COR.preto;
}

function desenharCartoes(doc: jsPDF, y: number, modelo: ModeloDocumento): number {
  const destaque = destaqueDoCliente(modelo);
  const cartoes: Array<[string, string, RGB]> =
    modelo.resumo.atual === null
      ? [["MENSALIDADE PROPOSTA", moeda(modelo.resumo.proposto), COR.preto]]
      : [
          ["MENSALIDADE ATUAL", moeda(modelo.resumo.atual), COR.cinzaTexto],
          ["NOVA MENSALIDADE", moeda(modelo.resumo.proposto), COR.preto],
          [destaque.titulo, destaque.valor, corDoDestaque(destaque.cor)],
        ];
  const folga = 4;
  const largura = (LARGURA_UTIL - folga * (cartoes.length - 1)) / cartoes.length;
  cartoes.forEach(([rotulo, valor, cor], i) => cartao(doc, MARGEM + i * (largura + folga), y, largura, rotulo, valor, cor));
  return y + 24 + 8;
}

export function gerarPdfCliente(modelo: ModeloDocumento, logos: Logos): Uint8Array {
  const doc = novoDocumento();
  desenharCabecalho(doc, tituloDoCliente(modelo), SUBTITULO_CONSULTOR, logos);

  doc.setTextColor(...COR.preto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const linhasNome = doc.splitTextToSize(modelo.cliente.razaoSocial || "Cliente", LARGURA_UTIL - 50) as string[];
  doc.text(linhasNome, MARGEM, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COR.cinzaTexto);
  doc.text(`Emitido em ${modelo.emitidoEm}`, MARGEM + LARGURA_UTIL, 38, { align: "right" });
  doc.text(`CNPJ ${modelo.cliente.cnpj} · Consultor: ${modelo.consultor}`, MARGEM, 38 + linhasNome.length * 5 + 1);

  let y = desenharCartoes(doc, 38 + linhasNome.length * 5 + 6, modelo);

  if (modelo.situacaoAtual && modelo.situacaoAtual.itens.length > 0) {
    if (modelo.porLinha && modelo.porLinha.length > 0) {
      y = tituloDeSecao(doc, y, "COMPARATIVO POR LINHA");
      y = desenharTabela(
        doc,
        y,
        ["LINHA", "PLANO ATUAL", "CONSUMO", "PLANO PROPOSTO", "VALOR ATUAL", "VALOR PROPOSTO"],
        modelo.porLinha.map((linha) => [
          linha.rotulo,
          linha.planoAtual,
          linha.consumo,
          linha.planoProposto,
          moeda(linha.valorAtual),
          linha.valorProposto === null ? "-" : moeda(linha.valorProposto),
        ]),
        { larguras: { 0: 30, 1: 20, 2: 18, 4: 25, 5: 27 }, direita: [4, 5], centro: [1, 2] }
      );
      y += 8;
    }

    y = tituloDeSecao(doc, y, "SUA SITUAÇÃO ATUAL");
    y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.situacaoAtual.itens), {
      ...ESTILO_TABELA,
      linhaTotal: ["TOTAL ATUAL", "", "", moeda(modelo.situacaoAtual.total)],
    });
    y = notaPequena(doc, y + 1, modelo.situacaoAtual.nota) + 4;
  }

  y = tituloDeSecao(doc, y, "NOSSA PROPOSTA");
  y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.novaProposta.itens), {
    ...ESTILO_TABELA,
    linhaTotal: [rotuloTotalProposta(modelo), "", "", moeda(modelo.novaProposta.total)],
  });
  y += 8;

  if (modelo.beneficios.badges.length > 0) {
    y = tituloDeSecao(doc, y, "BENEFÍCIOS INCLUSOS");
    y = desenharBeneficios(doc, y, modelo.beneficios.badges);
  }

  const destaque = destaqueDoCliente(modelo);
  y = garantirEspaco(doc, y + 2, 30);
  caixaDeDestaque(doc, y, destaque.titulo, destaque.valor, corDoDestaque(destaque.cor));

  desenharRodape(doc, modelo.emitidoEm, modelo.validoAte);
  return new Uint8Array(doc.output("arraybuffer"));
}
```

- [ ] **Step 9: Rodar e ver passar; conferir tipos**

Run: `npx vitest run lib/documentos && npx tsc --noEmit`
Expected: PASS e `tsc` sem erro. Se o teste "nunca imprime um telefone completo" falhar por causa de valores monetários como `R$ 1.949,90`, a regex `\d{5}[-\s]?\d{4}` pode casar números maiores: nesse caso troque a regex para `/\(\d{2}\)\s?\d{5}[-\s]?\d{4}/` (telefone com DDD entre parênteses), que é como a fatura escreve.

- [ ] **Step 10: Commit**

```bash
git add lib/documentos/pdf-base.ts lib/documentos/pdf-consultor.ts lib/documentos/pdf-consultor.test.ts lib/documentos/pdf-cliente.ts lib/documentos/pdf-cliente.test.ts
git commit -m "feat(crm-fibra): generate the consultant and client PDFs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: PNG do comparativo, cartão de prévia e entrega de arquivos

**Files:**
- Create: `components/documento/comparativo-cartao.tsx`, `components/documento/comparativo-cartao.test.ts`
- Create: `lib/documentos/png.ts`, `lib/documentos/baixar.ts`
- Throwaway (não commitar): estender `app/login/harness-tmp/page.tsx`

**Interfaces:**
- Consumes: `ModeloDocumento` (Task 10); `moeda`, `destaqueDoCliente`, `tituloDoCliente`, `rotuloTotalProposta`, `RODAPE_EMPRESA` (Task 11); `LOGO_APEX`, `LOGO_CLARO` (Task 1).
- Produces:
  - `ComparativoCartao({ modelo }: { modelo: ModeloDocumento }): JSX.Element` (1080 px de largura; usado na prévia da tela e na imagem)
  - `gerarPng(modelo: ModeloDocumento): Promise<Blob>` (só navegador; monta o cartão fora da tela e o converte)
  - `baixarArquivo(conteudo: Blob | Uint8Array, nome: string, tipo: string): void`, `copiarImagem(imagem: Promise<Blob>): Promise<boolean>`, `TIPO_DOCX`, `TIPO_PDF`, `TIPO_PNG`

- [ ] **Step 1: Escrever o teste do cartão (vai falhar)**

O Vitest roda em Node, mas `renderToStaticMarkup` não precisa de DOM: dá para conferir o texto do cartão. Crie `components/documento/comparativo-cartao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparativoCartao } from "./comparativo-cartao";
import { modeloDeTeste } from "@/lib/documentos/fixtures";

const html = (parcial = {}) => renderToStaticMarkup(createElement(ComparativoCartao, { modelo: modeloDeTeste(parcial) }));

describe("ComparativoCartao", () => {
  it("mostra título, cliente, CNPJ e os dois logos", () => {
    const h = html();
    expect(h).toContain("COMPARATIVO DA SUA FATURA");
    expect(h).toContain("EMPRESA EXEMPLO LTDA");
    expect(h).toContain("11.222.333/0001-81");
    expect(h).toContain("/marca/apex-logo.png");
    expect(h).toContain("/marca/claro-logo.jpg");
  });

  it("mostra situação atual agrupada, nova proposta e totais (agrupado por plano, não linha a linha)", () => {
    const h = html();
    expect(h).toContain("Plano atual — 10GB");
    expect(h).toContain("R$ 155,97");
    expect(h).toContain("Pós 12GB — por linha");
    expect(h).toContain("TOTAL (inclui Claro Monitor)");
    expect(h).not.toContain("(17) ••••• 0001"); // o cartão não lista linha a linha: fica curto para o WhatsApp
  });

  it("economia em verde com o valor; aumento em âmbar", () => {
    expect(html()).toContain("ECONOMIA MENSAL");
    const aumento = html({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento).toContain("AUMENTO MENSAL");
    expect(aumento).not.toContain("ECONOMIA MENSAL");
  });

  it("sem situação atual vira 'RESUMO DA PROPOSTA' com a mensalidade proposta", () => {
    const h = html({ situacaoAtual: null });
    expect(h).toContain("RESUMO DA PROPOSTA");
    expect(h).toContain("MENSALIDADE PROPOSTA");
    expect(h).not.toContain("MENSALIDADE ATUAL");
  });

  it("traz os benefícios e a validade", () => {
    const h = html();
    expect(h).toContain("Ligações ilimitadas");
    expect(h).toContain("Válida até 20/10/2026");
  });

  it("escapa o nome do cliente (nada de HTML solto vindo da razão social)", () => {
    const h = html({ cliente: { razaoSocial: "<b>X</b> & CIA", cnpjDigits: "11222333000181" } });
    expect(h).toContain("&lt;b&gt;X&lt;/b&gt; &amp; CIA");
    expect(h).not.toContain("<b>X</b>");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run components/documento/comparativo-cartao.test.ts`
Expected: FAIL — `Cannot find module './comparativo-cartao'`.

- [ ] **Step 3: Implementar o cartão**

Crie `components/documento/comparativo-cartao.tsx`:

```tsx
import { RODAPE_EMPRESA, destaqueDoCliente, moeda, rotuloTotalProposta, tituloDoCliente } from "@/lib/documentos/formato";
import { LOGO_APEX, LOGO_CLARO } from "@/lib/documentos/marca";
import type { LinhaTabela, ModeloDocumento } from "@/lib/proposta/modelo-documento";

// Estilos inline de propósito: o cartão vira imagem (html-to-image) e precisa
// sair igual em qualquer tela, sem depender do CSS da página.
const COR = {
  preto: "#0D0D0D",
  vermelho: "#B3101F",
  fundo: "#F3F4F6",
  borda: "#D1D5DB",
  cinza: "#6B7280",
  verde: "#16A34A",
  ambar: "#B45309",
};

const corDoDestaque = { verde: COR.verde, ambar: COR.ambar, preto: COR.preto } as const;

function Kpi({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div style={{ flex: 1, background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: "18px 22px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: COR.cinza, letterSpacing: 0.5 }}>{rotulo}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: cor, marginTop: 8 }}>{valor}</div>
    </div>
  );
}

function Tabela({ titulo, itens, total, rotuloTotal }: { titulo: string; itens: LinhaTabela[]; total: number; rotuloTotal: string }) {
  const celula = (direita: boolean) => ({ padding: "10px 14px", textAlign: direita ? ("right" as const) : ("left" as const), fontSize: 19 });
  return (
    <section style={{ marginTop: 30 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COR.vermelho, letterSpacing: 1 }}>{titulo}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, border: `1px solid ${COR.borda}` }}>
        <thead>
          <tr>
            {["DESCRIÇÃO", "QTD", "VALOR", "SUBTOTAL"].map((nome, i) => (
              <th key={nome} style={{ ...celula(i > 0), background: COR.vermelho, color: "#fff", fontSize: 15 }}>
                {nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => (
            <tr key={`${item.descricao}-${i}`} style={{ background: i % 2 ? COR.fundo : "#fff" }}>
              <td style={celula(false)}>{item.descricao}</td>
              <td style={celula(true)}>{item.quantidade}</td>
              <td style={celula(true)}>{item.valorUnitario === null ? "-" : moeda(item.valorUnitario)}</td>
              <td style={celula(true)}>{moeda(item.subtotal)}</td>
            </tr>
          ))}
          <tr style={{ background: COR.fundo, fontWeight: 800 }}>
            <td colSpan={3} style={celula(false)}>
              {rotuloTotal}
            </td>
            <td style={celula(true)}>{moeda(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// Prévia do que o consultor manda no WhatsApp: agrupada por plano (não lista linha
// a linha) para a imagem não ficar tão alta que o WhatsApp corte o centro dela.
export function ComparativoCartao({ modelo }: { modelo: ModeloDocumento }) {
  const destaque = destaqueDoCliente(modelo);
  const corDestaque = corDoDestaque[destaque.cor];

  return (
    <div
      data-comparativo-cartao
      style={{
        width: 1080,
        background: "#fff",
        color: COR.preto,
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <header style={{ background: COR.preto, color: "#fff", display: "flex", alignItems: "center", padding: "26px 40px", gap: 28 }}>
        <div style={{ background: "#fff", borderRadius: 14, width: 104, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_APEX.arquivo} alt="Apex" style={{ maxWidth: 84, maxHeight: 76 }} />
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 800 }}>{tituloDoCliente(modelo)}</div>
          <div style={{ fontSize: 18, marginTop: 8 }}>Apex Smart Solutions — Parceiro autorizado Claro Empresas</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, width: 104, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_CLARO.arquivo} alt="Claro empresas" style={{ maxWidth: 84, maxHeight: 76 }} />
        </div>
      </header>

      <div style={{ padding: "30px 40px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 800, overflowWrap: "anywhere" }}>{modelo.cliente.razaoSocial}</div>
          <div style={{ fontSize: 17, color: COR.cinza, whiteSpace: "nowrap" }}>Emitido em {modelo.emitidoEm}</div>
        </div>
        <div style={{ fontSize: 17, color: COR.cinza, marginTop: 6 }}>
          CNPJ {modelo.cliente.cnpj} · Consultor: {modelo.consultor}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 26 }}>
          {modelo.resumo.atual === null ? (
            <Kpi rotulo="MENSALIDADE PROPOSTA" valor={moeda(modelo.resumo.proposto)} cor={COR.preto} />
          ) : (
            <>
              <Kpi rotulo="MENSALIDADE ATUAL" valor={moeda(modelo.resumo.atual)} cor={COR.cinza} />
              <Kpi rotulo="NOVA MENSALIDADE" valor={moeda(modelo.resumo.proposto)} cor={COR.preto} />
              <Kpi rotulo={destaque.titulo} valor={destaque.valor} cor={corDestaque} />
            </>
          )}
        </div>

        {modelo.situacaoAtual && (
          <Tabela titulo="SUA SITUAÇÃO ATUAL" itens={modelo.situacaoAtual.itens} total={modelo.situacaoAtual.total} rotuloTotal="TOTAL ATUAL" />
        )}
        <Tabela
          titulo="NOSSA PROPOSTA"
          itens={modelo.novaProposta.itens}
          total={modelo.novaProposta.total}
          rotuloTotal={rotuloTotalProposta(modelo)}
        />

        {modelo.beneficios.badges.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COR.vermelho, letterSpacing: 1 }}>BENEFÍCIOS INCLUSOS</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              {modelo.beneficios.badges.map((badge) => (
                <div
                  key={badge.label}
                  style={{ border: `2px solid #${badge.cor}`, borderRadius: 999, padding: "8px 18px", fontSize: 18, fontWeight: 700 }}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          </section>
        )}

        <div style={{ background: corDestaque, color: "#fff", borderRadius: 16, padding: "24px 32px", marginTop: 32 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{destaque.titulo}</div>
          <div style={{ fontSize: 52, fontWeight: 800, marginTop: 6 }}>{destaque.valor}</div>
        </div>
      </div>

      <footer style={{ background: COR.preto, color: "#fff", padding: "16px 40px", fontSize: 15 }}>
        <div style={{ fontWeight: 700 }}>{RODAPE_EMPRESA}</div>
        <div style={{ marginTop: 4 }}>
          Emitido em {modelo.emitidoEm} · Válida até {modelo.validoAte}
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run components/documento/comparativo-cartao.test.ts`
Expected: PASS. Se o teste de escape falhar, não mexa no componente: o React já escapa texto; confira que a razão social foi mesmo passada por `children` e não por `dangerouslySetInnerHTML`.

- [ ] **Step 5: Implementar `baixar.ts` e `png.ts`**

Crie `lib/documentos/baixar.ts`:

```ts
export const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const TIPO_PDF = "application/pdf";
export const TIPO_PNG = "image/png";

// Só no navegador: baixa o arquivo por um link temporário.
export function baixarArquivo(conteudo: Blob | Uint8Array, nome: string, tipo: string): void {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([new Uint8Array(conteudo)], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Copia a imagem para a área de transferência (para colar na conversa do
// WhatsApp Web). Recebe uma PROMESSA da imagem: o Safari só aceita o gesto do
// clique se o ClipboardItem for criado de forma síncrona, antes de a imagem
// ficar pronta. Devolve false quando o navegador não permite.
export async function copiarImagem(imagem: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      await imagem.catch(() => undefined);
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ [TIPO_PNG]: imagem })]);
    return true;
  } catch {
    return false;
  }
}
```

Crie `lib/documentos/png.ts`:

```ts
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
    const blob = await toBlob(cartao, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
    if (!blob) throw new Error("Não foi possível gerar a imagem");
    return blob;
  } finally {
    raiz.unmount();
    area.remove();
  }
}
```

- [ ] **Step 6: Conferir tipos e rodar a suíte**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` sem erro; suíte verde.

- [ ] **Step 7: Verificar PNG, Word e PDF num navegador de verdade**

O Vitest não prova o PNG nem o `Packer`/jsPDF no navegador. Estenda a página descartável (não commitar). Substitua `app/login/harness-tmp/page.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { lerTextoDoArquivo } from "@/lib/fatura/pdf-texto";
import { montarModeloDocumento } from "@/lib/proposta/modelo-documento";
import { carregarLogos } from "@/lib/documentos/marca";

const linha = (rotulo: string, planoGb: number, valor: number, consumoMb: number) => ({
  rotulo, quantidade: 1, planoGb, valorUnitario: valor, consumoMb, origem: "fatura" as const,
  proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
});

const modelo = montarModeloDocumento({
  cliente: { razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" },
  consultor: "Ana Teste",
  situacaoAtual: { faturasAnalisadas: 1, linhas: [linha("(17) ••••• 0001", 10, 48.49, 9728), linha("(17) ••••• 0002", 10, 48.49, 2000), linha("(17) ••••• 0003", 20, 58.99, 2048)] },
  itens: [
    { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: 119.97, quantidade: 3, franquiaGb: 12 },
    { catalogoPlanoId: "m1", descricao: "Claro Monitor", valor: 15, quantidade: 3, franquiaGb: null },
  ],
  opcoes: { consolidar: false, vendedor: null },
  agora: new Date(),
});

export default function Harness() {
  const [saida, setSaida] = useState("aguardando…");
  const [png, setPng] = useState<string | null>(null);

  async function rodar(nome: string, fn: () => Promise<string>) {
    try {
      setSaida(`${nome}: ${await fn()}`);
    } catch (erro) {
      setSaida(`${nome} ERRO ${String(erro)}`);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <input type="file" accept="application/pdf" data-testid="pdf" onChange={(e) => {
        const arquivo = e.target.files?.[0];
        if (arquivo) rodar("PDF lido", async () => { const t = await lerTextoDoArquivo(arquivo); return `${t.length} caracteres: ${t.slice(0, 200)}`; });
      }} />
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button data-testid="png" onClick={() => rodar("PNG", async () => {
          const { gerarPng } = await import("@/lib/documentos/png");
          const blob = await gerarPng(modelo);
          const url = URL.createObjectURL(blob);
          setPng(url);
          const img = new Image(); img.src = url; await img.decode();
          return `${blob.size} bytes, ${img.naturalWidth}x${img.naturalHeight}`;
        })}>PNG</button>
        <button data-testid="pdfc" onClick={() => rodar("PDF cliente", async () => {
          const { gerarPdfCliente } = await import("@/lib/documentos/pdf-cliente");
          return `${gerarPdfCliente(modelo, await carregarLogos()).byteLength} bytes`;
        })}>PDF cliente</button>
        <button data-testid="pdfk" onClick={() => rodar("PDF consultor", async () => {
          const { gerarPdfConsultor } = await import("@/lib/documentos/pdf-consultor");
          return `${gerarPdfConsultor(modelo, await carregarLogos()).byteLength} bytes`;
        })}>PDF consultor</button>
        <button data-testid="docx" onClick={() => rodar("Word", async () => {
          const { gerarDocx } = await import("@/lib/documentos/docx");
          return `${(await gerarDocx(modelo, await carregarLogos())).byteLength} bytes`;
        })}>Word</button>
      </div>
      <pre data-testid="saida">{saida}</pre>
      {png && /* eslint-disable-next-line @next/next/no-img-element */ <img src={png} alt="png" style={{ maxWidth: 540, border: "1px solid #ccc" }} />}
    </main>
  );
}
```

Com o servidor de desenvolvimento ligado (Task 1, Step 10), abra `http://localhost:3000/login/harness-tmp`, clique em cada botão e leia `data-testid="saida"` com `read_page`/`get_page_text`; tire um `screenshot` para ver a imagem do PNG.
Expected: `PNG: … bytes, 2160xN` (largura 1080 × 2) com `N` entre 1800 e 3400; `PDF cliente`, `PDF consultor` e `Word` com `bytes` maiores que 5000; `read_console_messages` sem erro. Olhe o PNG: faixa preta com os dois logos nos quadros brancos, título "COMPARATIVO DA SUA FATURA", três cartões (atual, nova, economia em verde), tabelas com cabeçalho vermelho, benefícios e a caixa verde de economia. Se a imagem sair cortada, com logos quebrados ou com fontes estranhas, conserte `comparativo-cartao.tsx`/`png.ts` antes de seguir e registre no ledger. Se `Packer`/`jsPDF` lançarem erro só no navegador, o erro aparece em `saida`.

- [ ] **Step 8: Commit**

```bash
git add components/documento lib/documentos/png.ts lib/documentos/baixar.ts
git commit -m "feat(crm-fibra): render the comparison card as a PNG and deliver files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(A página `harness-tmp` não entra no commit.)

---

### Task 14: Estado puro da tela, leitura de várias faturas e mensagens de WhatsApp

**Files:**
- Create: `lib/fatura/processar.ts`, `lib/fatura/processar.test.ts`
- Create: `lib/proposta/estado.ts`, `lib/proposta/estado.test.ts`
- Create: `lib/documentos/mensagens-whatsapp.ts`, `lib/documentos/mensagens-whatsapp.test.ts`

**Interfaces:**
- Consumes: `interpretarLeitura`, `mensagemDeLeitura` (Task 4); `mesclarFaturas`, `paraLinhasAtuais`, `avisosDaLinha`, `LinhaMesclada` (Task 5); `planosPosNacional`, `sugerirPlano`, `Sugestao` (Task 7); `LinhaEditavel`, `linhasComProposto` (Task 8); `validarSituacaoAtual`, `SituacaoAtual`, `LIMITE_LINHAS` (Task 3); `FaturaIlegivelError`, `validarArquivos`, `ArquivoInfo` (Task 1); `limparRazaoSocial` (`lib/ia/abordagem.ts`).
- Produces:
  - `lib/fatura/processar.ts`: `type StatusArquivo = "ok" | "sem_texto" | "sem_linhas" | "ilegivel"`; `interface ResultadoArquivo { nome: string; status: StatusArquivo; linhas: number; mensagem: string | null }`; `interface ResultadoFaturas { arquivos: ResultadoArquivo[]; mescladas: LinhaMesclada[]; faturasLidas: number; erro: string | null }`; `processarFaturas<A extends ArquivoInfo>(arquivos: A[], lerTexto: (arquivo: A) => Promise<string>, aoIniciar?: (indice: number, total: number, nome: string) => void): Promise<ResultadoFaturas>`
  - `lib/proposta/estado.ts`: `linhaDigitada(chave: string): LinhaEditavel`; `adicionarLinhaDigitada(linhas, chave)`; `linhasDaFatura(mescladas, catalogo, novaChave: () => string): LinhaEditavel[]`; `substituirLinhasDaFatura(atuais, novas)`; `atualizarLinha(linhas, chave, mudanca: Partial<Omit<LinhaEditavel, "chave">>, catalogo)`; `removerLinhaEditavel(linhas, chave)`; `refazerSugestoes(linhas, catalogo)`; `sugestaoDaLinha(linha, catalogo): Sugestao`; `type SituacaoDaTela = { ok: true; situacao: SituacaoAtual | null } | { ok: false; erro: string }`; `validarSituacaoDaTela(linhas, faturasAnalisadas, catalogo): SituacaoDaTela`
  - `lib/documentos/mensagens-whatsapp.ts`: `interface ModeloMensagem { id: string; rotulo: string; texto: string }`; `MODELOS_MENSAGEM: ModeloMensagem[]`; `preencherModelo(texto: string, vars: { cliente: string; consultor: string }): string`

- [ ] **Step 1: Testes da leitura de várias faturas (vão falhar)**

Crie `lib/fatura/processar.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { FaturaIlegivelError, LIMITE_ARQUIVOS } from "./pdf-texto";
import { processarFaturas } from "./processar";

const pdf = (name: string, size = 1000) => ({ name, size, type: "application/pdf" });

// Fixture sintética no formato da fatura Claro, com o artefato do pdf.js nos acentos.
function bloco(numero: string, valor: string, gb: number, mb: string): string {
  return [
    "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR",
    `(17) 90000-${numero}`,
    "Mensalidades e Pacotes Promocionais",
    `Oferta Conjunta Claro MIX ${valor}`,
    `Claro P ó s ${gb}GB -`,
    "Liga çõ es Locais 0,00",
    `Internet (MB) Descri çã o Subtotal ${mb} 0,0000`,
    "TOTAL 99,99",
  ].join(" ");
}

describe("processarFaturas", () => {
  it("lê um arquivo por vez, na ordem em que foram anexados", async () => {
    const eventos: string[] = [];
    const lerTexto = async (arquivo: { name: string }) => {
      eventos.push(`inicio ${arquivo.name}`);
      await Promise.resolve();
      eventos.push(`fim ${arquivo.name}`);
      return bloco("0001", "48,49", 10, "1.000,00");
    };
    await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], lerTexto);
    expect(eventos).toEqual(["inicio a.pdf", "fim a.pdf", "inicio b.pdf", "fim b.pdf"]);
  });

  it("avisa o início de cada leitura (para o indicador de progresso)", async () => {
    const aoIniciar = vi.fn();
    await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], async () => bloco("0001", "48,49", 10, "1.000,00"), aoIniciar);
    expect(aoIniciar.mock.calls).toEqual([
      [1, 2, "a.pdf"],
      [2, 2, "b.pdf"],
    ]);
  });

  it("com duas faturas devolve a média da linha e conta as faturas lidas", async () => {
    const textos: Record<string, string> = {
      "a.pdf": bloco("0001", "48,50", 10, "1.000,00"),
      "b.pdf": bloco("0001", "50,50", 10, "3.001,00"),
    };
    const resultado = await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], async (a) => textos[a.name]);
    expect(resultado.erro).toBeNull();
    expect(resultado.faturasLidas).toBe(2);
    expect(resultado.arquivos.map((a) => [a.nome, a.status, a.linhas])).toEqual([
      ["a.pdf", "ok", 1],
      ["b.pdf", "ok", 1],
    ]);
    expect(resultado.mescladas).toHaveLength(1);
    expect(resultado.mescladas[0]).toMatchObject({ valorMensal: 49.5, consumoMb: 2000.5, faturasEncontradas: 2, totalFaturas: 2 });
  });

  it("um arquivo ilegível não derruba os outros, e a média só conta as faturas lidas", async () => {
    const lerTexto = async (a: { name: string }) => {
      if (a.name === "b.pdf") throw new FaturaIlegivelError("b.pdf");
      return bloco("0001", "48,49", 10, "1.000,00");
    };
    const resultado = await processarFaturas([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], lerTexto);
    expect(resultado.arquivos.map((a) => a.status)).toEqual(["ok", "ilegivel", "ok"]);
    expect(resultado.arquivos[1].mensagem).toContain("b.pdf");
    expect(resultado.faturasLidas).toBe(2);
    expect(resultado.mescladas[0].totalFaturas).toBe(2);
  });

  it("erro inesperado vira mensagem genérica com o nome do arquivo, sem vazar o detalhe", async () => {
    const lerTexto = async () => {
      throw new Error("falha interna com 17900000001");
    };
    const resultado = await processarFaturas([pdf("x.pdf")], lerTexto);
    expect(resultado.arquivos[0]).toMatchObject({ status: "ilegivel", mensagem: 'Não foi possível ler "x.pdf".' });
    expect(JSON.stringify(resultado.arquivos)).not.toContain("17900000001");
  });

  it("PDF sem texto e PDF sem linhas reconhecidas têm status e mensagem próprios", async () => {
    const textos: Record<string, string> = { "scan.pdf": "   ", "outra.pdf": "Fatura de outra operadora" };
    const resultado = await processarFaturas([pdf("scan.pdf"), pdf("outra.pdf")], async (a) => textos[a.name]);
    expect(resultado.arquivos.map((a) => a.status)).toEqual(["sem_texto", "sem_linhas"]);
    expect(resultado.arquivos[0].mensagem).toMatch(/escaneado/i);
    expect(resultado.arquivos[1].mensagem).toMatch(/digite/i);
    expect(resultado.mescladas).toEqual([]);
    expect(resultado.faturasLidas).toBe(0);
    expect(resultado.erro).toBeNull();
  });

  it("recusa a lista inteira (sem ler nada) quando passa do limite de arquivos", async () => {
    const lerTexto = vi.fn();
    const lista = Array.from({ length: LIMITE_ARQUIVOS + 1 }, (_, i) => pdf(`f${i}.pdf`));
    const resultado = await processarFaturas(lista, lerTexto);
    expect(resultado.erro).toMatch(new RegExp(String(LIMITE_ARQUIVOS)));
    expect(resultado.arquivos).toEqual([]);
    expect(lerTexto).not.toHaveBeenCalled();
  });

  it("recusa arquivo que não é PDF, grande demais ou vazio, sem ler nada", async () => {
    const lerTexto = vi.fn();
    expect((await processarFaturas([{ name: "foto.png", size: 10, type: "image/png" }], lerTexto)).erro).toMatch(/foto\.png/);
    expect((await processarFaturas([pdf("g.pdf", 11 * 1024 * 1024)], lerTexto)).erro).toMatch(/10 MB/);
    expect((await processarFaturas([pdf("v.pdf", 0)], lerTexto)).erro).toMatch(/vazio/);
    expect(lerTexto).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/fatura/processar.test.ts`
Expected: FAIL — `Cannot find module './processar'`.

- [ ] **Step 3: Implementar `processar.ts`**

Crie `lib/fatura/processar.ts`:

```ts
// Lê várias faturas, UMA POR VEZ (seis PDFs grandes lidos em paralelo travariam a
// aba) e devolve o resultado por arquivo, para a tela dizer qual deu certo e qual
// não. Uma fatura ilegível não derruba as outras. `lerTexto` é injetado: no
// navegador é lerTextoDoArquivo; nos testes, um texto pronto.
import { interpretarLeitura, mensagemDeLeitura, type LinhaLida } from "./extrair";
import { mesclarFaturas, type LinhaMesclada } from "./mesclar";
import { FaturaIlegivelError, validarArquivos, type ArquivoInfo } from "./pdf-texto";

export type StatusArquivo = "ok" | "sem_texto" | "sem_linhas" | "ilegivel";

export interface ResultadoArquivo {
  nome: string;
  status: StatusArquivo;
  linhas: number;
  mensagem: string | null;
}

export interface ResultadoFaturas {
  arquivos: ResultadoArquivo[];
  // O número completo das linhas só existe aqui dentro: quem recebe converte logo
  // com paraLinhasAtuais() e o descarta.
  mescladas: LinhaMesclada[];
  faturasLidas: number;
  erro: string | null;
}

export async function processarFaturas<A extends ArquivoInfo>(
  arquivos: A[],
  lerTexto: (arquivo: A) => Promise<string>,
  aoIniciar?: (indice: number, total: number, nome: string) => void
): Promise<ResultadoFaturas> {
  const erro = validarArquivos(arquivos);
  if (erro) return { arquivos: [], mescladas: [], faturasLidas: 0, erro };

  const resultados: ResultadoArquivo[] = [];
  const listas: LinhaLida[][] = [];

  for (const [indice, arquivo] of arquivos.entries()) {
    aoIniciar?.(indice + 1, arquivos.length, arquivo.name);
    try {
      const leitura = interpretarLeitura(await lerTexto(arquivo));
      if (leitura.tipo === "ok") {
        listas.push(leitura.linhas);
        resultados.push({ nome: arquivo.name, status: "ok", linhas: leitura.linhas.length, mensagem: null });
      } else {
        resultados.push({
          nome: arquivo.name,
          status: leitura.tipo,
          linhas: 0,
          mensagem: mensagemDeLeitura(arquivo.name, leitura),
        });
      }
    } catch (err) {
      resultados.push({
        nome: arquivo.name,
        status: "ilegivel",
        linhas: 0,
        // Só a mensagem do nosso próprio erro; qualquer outro detalhe pode ter dado do cliente.
        mensagem: err instanceof FaturaIlegivelError ? err.message : `Não foi possível ler "${arquivo.name}".`,
      });
    }
  }

  return { arquivos: resultados, mescladas: mesclarFaturas(listas), faturasLidas: listas.length, erro: null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/fatura/processar.test.ts`
Expected: PASS.

- [ ] **Step 5: Testes do estado da tela (vão falhar)**

Crie `lib/proposta/estado.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import type { LinhaMesclada } from "../fatura/mesclar";
import { LIMITE_LINHAS } from "../fatura/tipos";
import type { LinhaEditavel } from "./agrupar";
import {
  adicionarLinhaDigitada,
  atualizarLinha,
  linhaDigitada,
  linhasDaFatura,
  refazerSugestoes,
  removerLinhaEditavel,
  substituirLinhasDaFatura,
  sugestaoDaLinha,
  validarSituacaoDaTela,
} from "./estado";

function plano(id: string, categoria: PlanoCatalogo["categoria"], nome: string, valor: number, franquiaGb: number | null): PlanoCatalogo {
  return { id, categoria, nome, valor, observacao: "por linha", ativo: true, franquiaGb };
}

const catalogo: PlanoCatalogo[] = [
  plano("p12", "pos_nacional", "Pós 12GB", 39.99, 12),
  plano("p40", "pos_nacional", "Pós 40GB", 54.99, 40),
  plano("p70", "pos_nacional", "Pós 70GB", 74.99, 70),
  plano("reg30", "pos_regional", "Pós 30GB regional", 44.99, 30),
];

function mesclada(parcial: Partial<LinhaMesclada> = {}): LinhaMesclada {
  return {
    ddd: "17",
    numero: "900000001",
    planoGb: 10,
    planoGbDistintos: [10],
    valorMensal: 48.49,
    valorMensalMin: 48.49,
    valorMensalMax: 48.49,
    consumoMb: 1000,
    consumoMbMin: 1000,
    consumoMbMax: 1000,
    temMonitor: false,
    faturasEncontradas: 1,
    totalFaturas: 1,
    ...parcial,
  };
}

function geradorDeChaves() {
  let n = 0;
  return () => `k${++n}`;
}

function linha(parcial: Partial<LinhaEditavel> & { chave: string }): LinhaEditavel {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 1000,
    origem: "fatura",
    planoId: null,
    avisos: [],
    ...parcial,
  };
}

describe("linhasDaFatura", () => {
  const linhas = linhasDaFatura(
    [
      mesclada({ consumoMb: 9728 }), // 10GB a 95% da franquia: upgrade para o Pós 12GB
      mesclada({ numero: "900000002", planoGb: 20, consumoMb: 2048, valorMensal: 58.99 }), // 20GB a 10%: downgrade para o 12GB
      mesclada({ numero: "900000003", planoGb: 20, consumoMb: 12288, valorMensal: null }), // 20GB a 60%: mantém, no 40GB
    ],
    catalogo,
    geradorDeChaves()
  );

  it("gera uma linha editável por linha da fatura, com chave própria e o plano sugerido já escolhido", () => {
    expect(linhas.map((l) => l.chave)).toEqual(["k1", "k2", "k3"]);
    expect(linhas.map((l) => l.planoId)).toEqual(["p12", "p12", "p40"]);
  });

  it("o rótulo vem mascarado e a origem é fatura", () => {
    expect(linhas[0]).toMatchObject({ rotulo: "(17) ••••• 0001", origem: "fatura", quantidade: 1, valorUnitario: 48.49 });
    expect(JSON.stringify(linhas)).not.toContain("900000001");
  });

  it("mensalidade não encontrada vira 0 com aviso para o consultor preencher", () => {
    expect(linhas[2].valorUnitario).toBe(0);
    expect(linhas[2].avisos).toContain("Mensalidade não encontrada na fatura: preencha o valor.");
  });

  it("a sugestão só usa o Pós Nacional (o regional fica para escolha manual)", () => {
    const [l] = linhasDaFatura([mesclada({ planoGb: 25, consumoMb: 12000 })], catalogo, geradorDeChaves());
    expect(l.planoId).not.toBe("reg30");
  });
});

describe("linhaDigitada / adicionarLinhaDigitada", () => {
  it("nasce como uma linha digitada pendente de valor", () => {
    expect(linhaDigitada("k9")).toEqual({
      chave: "k9",
      rotulo: "Linhas",
      quantidade: 1,
      planoGb: null,
      valorUnitario: 0,
      consumoMb: null,
      origem: "digitada",
      planoId: null,
      avisos: [],
    });
  });

  it("acrescenta no fim, sem mexer na lista original", () => {
    const original = [linha({ chave: "a" })];
    const nova = adicionarLinhaDigitada(original, "b");
    expect(original).toHaveLength(1);
    expect(nova.map((l) => l.chave)).toEqual(["a", "b"]);
  });

  it("não passa do limite de linhas", () => {
    const cheia = Array.from({ length: LIMITE_LINHAS }, (_, i) => linha({ chave: `k${i}` }));
    expect(adicionarLinhaDigitada(cheia, "extra")).toBe(cheia);
  });
});

describe("substituirLinhasDaFatura", () => {
  it("troca as linhas lidas de fatura e mantém as digitadas, que ficam no fim", () => {
    const atuais = [linha({ chave: "velha" }), linha({ chave: "digitada", origem: "digitada" })];
    const novas = [linha({ chave: "n1" }), linha({ chave: "n2" })];
    expect(substituirLinhasDaFatura(atuais, novas).map((l) => l.chave)).toEqual(["n1", "n2", "digitada"]);
  });
});

describe("atualizarLinha", () => {
  it("muda só a linha da chave pedida", () => {
    const linhas = [linha({ chave: "a" }), linha({ chave: "b" })];
    const resultado = atualizarLinha(linhas, "b", { quantidade: 5 }, catalogo);
    expect(resultado.map((l) => l.quantidade)).toEqual([1, 5]);
  });

  it("linha sem plano proposto ganha a sugestão quando o plano atual ou o consumo mudam", () => {
    const linhas = [linha({ chave: "a", origem: "digitada", planoGb: null, consumoMb: null, planoId: null })];
    const resultado = atualizarLinha(linhas, "a", { planoGb: 10 }, catalogo);
    expect(resultado[0].planoId).toBe("p12");
  });

  it("não troca uma escolha que o consultor já fez", () => {
    const linhas = [linha({ chave: "a", planoGb: 10, planoId: "p70" })];
    expect(atualizarLinha(linhas, "a", { planoGb: 12 }, catalogo)[0].planoId).toBe("p70");
  });

  it("respeita o planoId explícito, mesmo junto da mudança de plano atual", () => {
    const linhas = [linha({ chave: "a", planoGb: null, planoId: null })];
    expect(atualizarLinha(linhas, "a", { planoGb: 10, planoId: null }, catalogo)[0].planoId).toBeNull();
  });

  it("trocar só a quantidade ou o valor não refaz a sugestão", () => {
    const linhas = [linha({ chave: "a", planoId: null })];
    expect(atualizarLinha(linhas, "a", { valorUnitario: 60 }, catalogo)[0].planoId).toBeNull();
  });
});

describe("removerLinhaEditavel / refazerSugestoes / sugestaoDaLinha", () => {
  it("remove só a linha da chave pedida", () => {
    expect(removerLinhaEditavel([linha({ chave: "a" }), linha({ chave: "b" })], "a").map((l) => l.chave)).toEqual(["b"]);
  });

  it("refazer sugestões sobrescreve as escolhas com o plano sugerido", () => {
    const linhas = [linha({ chave: "a", planoGb: 10, consumoMb: 9728, planoId: "p70" })];
    expect(refazerSugestoes(linhas, catalogo)[0].planoId).toBe("p12");
  });

  it("devolve a sugestão da linha (upgrade a partir de 90% da franquia)", () => {
    const s = sugestaoDaLinha(linha({ chave: "a", planoGb: 10, consumoMb: 9728 }), catalogo);
    expect(s).toMatchObject({ acao: "upgrade", plano: { id: "p12" } });
  });
});

describe("validarSituacaoDaTela", () => {
  it("sem nenhuma linha não há situação atual (proposta sem fatura)", () => {
    expect(validarSituacaoDaTela([], 0, catalogo)).toEqual({ ok: true, situacao: null });
  });

  it("linhas completas viram a situação atual com o plano proposto gravado", () => {
    const linhas = [linha({ chave: "a", planoId: "p12" })];
    const resultado = validarSituacaoDaTela(linhas, 2, catalogo);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.situacao?.faturasAnalisadas).toBe(2);
      expect(resultado.situacao?.linhas[0].proposto).toEqual({ descricao: "Pós 12GB — por linha", valorUnitario: 39.99 });
    }
  });

  it("linha sem mensalidade bloqueia, com a mesma mensagem que o servidor daria", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", valorUnitario: 0 })], 1, catalogo);
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/mensalidade/) });
  });

  it("só linhas digitadas contam como zero faturas analisadas, mesmo que o estado diga outra coisa", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", origem: "digitada" })], 3, catalogo);
    expect(resultado.ok && resultado.situacao?.faturasAnalisadas).toBe(0);
  });

  it("recusa mais linhas que o limite", () => {
    const linhas = Array.from({ length: LIMITE_LINHAS + 1 }, (_, i) => linha({ chave: `k${i}` }));
    expect(validarSituacaoDaTela(linhas, 1, catalogo)).toMatchObject({ ok: false, erro: expect.stringContaining(String(LIMITE_LINHAS)) });
  });

  it("recusa telefone completo digitado no nome da linha", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", rotulo: "(17) 90000-0001" })], 0, catalogo);
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/número completo/) });
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run lib/proposta/estado.test.ts`
Expected: FAIL — `Cannot find module './estado'`.

- [ ] **Step 7: Implementar `estado.ts`**

Crie `lib/proposta/estado.ts`:

```ts
// Operações puras sobre as linhas da situação atual como a tela as edita. A tela
// só chama estas funções (e guarda o resultado em useState): assim a regra fica
// testada em Node e o React não precisa ser testado.
import type { PlanoCatalogo } from "../catalogo";
import { avisosDaLinha, paraLinhasAtuais, type LinhaMesclada } from "../fatura/mesclar";
import { planosPosNacional, sugerirPlano, type Sugestao } from "../fatura/sugestao";
import { LIMITE_LINHAS, validarSituacaoAtual, type SituacaoAtual } from "../fatura/tipos";
import { linhasComProposto, type LinhaEditavel } from "./agrupar";

export function linhaDigitada(chave: string): LinhaEditavel {
  return {
    chave,
    rotulo: "Linhas",
    quantidade: 1,
    planoGb: null,
    valorUnitario: 0, // a mensalidade fica pendente até o consultor preencher
    consumoMb: null,
    origem: "digitada",
    planoId: null,
    avisos: [],
  };
}

export function adicionarLinhaDigitada(linhas: LinhaEditavel[], chave: string): LinhaEditavel[] {
  return linhas.length >= LIMITE_LINHAS ? linhas : [...linhas, linhaDigitada(chave)];
}

export function sugestaoDaLinha(
  linha: Pick<LinhaEditavel, "planoGb" | "consumoMb">,
  catalogo: PlanoCatalogo[]
): Sugestao {
  return sugerirPlano(linha, planosPosNacional(catalogo));
}

function planoSugerido(
  linha: Pick<LinhaEditavel, "planoGb" | "consumoMb">,
  catalogo: PlanoCatalogo[]
): string | null {
  return sugestaoDaLinha(linha, catalogo).plano?.id ?? null;
}

// Cada linha lida da fatura já nasce com o plano sugerido escolhido ("deixar o
// plano sugerido setado", como no painel).
export function linhasDaFatura(
  mescladas: LinhaMesclada[],
  catalogo: PlanoCatalogo[],
  novaChave: () => string
): LinhaEditavel[] {
  const atuais = paraLinhasAtuais(mescladas);
  return mescladas.map((mesclada, indice) => {
    const atual = atuais[indice];
    return {
      chave: novaChave(),
      rotulo: atual.rotulo,
      quantidade: atual.quantidade,
      planoGb: atual.planoGb,
      valorUnitario: atual.valorUnitario,
      consumoMb: atual.consumoMb,
      origem: atual.origem,
      planoId: planoSugerido(atual, catalogo),
      avisos: avisosDaLinha(mesclada),
    };
  });
}

// Ler uma fatura nova troca as linhas que vieram de fatura e preserva o que o
// consultor digitou à mão.
export function substituirLinhasDaFatura(atuais: LinhaEditavel[], novas: LinhaEditavel[]): LinhaEditavel[] {
  return [...novas, ...atuais.filter((linha) => linha.origem === "digitada")];
}

export function atualizarLinha(
  linhas: LinhaEditavel[],
  chave: string,
  mudanca: Partial<Omit<LinhaEditavel, "chave">>,
  catalogo: PlanoCatalogo[]
): LinhaEditavel[] {
  return linhas.map((linha) => {
    if (linha.chave !== chave) return linha;
    const nova: LinhaEditavel = { ...linha, ...mudanca };
    const mudouABase = mudanca.planoGb !== undefined || mudanca.consumoMb !== undefined;
    // Só sugere quando a linha ainda não tem plano e o consultor não escolheu um
    // na mesma mudança: uma escolha manual nunca é trocada por baixo dele.
    if (mudouABase && mudanca.planoId === undefined && linha.planoId === null) {
      nova.planoId = planoSugerido(nova, catalogo);
    }
    return nova;
  });
}

export function removerLinhaEditavel(linhas: LinhaEditavel[], chave: string): LinhaEditavel[] {
  return linhas.filter((linha) => linha.chave !== chave);
}

export function refazerSugestoes(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): LinhaEditavel[] {
  return linhas.map((linha) => ({ ...linha, planoId: planoSugerido(linha, catalogo) }));
}

export type SituacaoDaTela = { ok: true; situacao: SituacaoAtual | null } | { ok: false; erro: string };

// O que a tela aceita é exatamente o que o servidor aceita: usa o mesmo validador.
export function validarSituacaoDaTela(
  linhas: LinhaEditavel[],
  faturasAnalisadas: number,
  catalogo: PlanoCatalogo[]
): SituacaoDaTela {
  if (linhas.length === 0) return { ok: true, situacao: null };
  const faturas = linhas.some((linha) => linha.origem === "fatura") ? faturasAnalisadas : 0;
  const resultado = validarSituacaoAtual({ faturasAnalisadas: faturas, linhas: linhasComProposto(linhas, catalogo) });
  return resultado.ok ? { ok: true, situacao: resultado.valor } : { ok: false, erro: resultado.erro };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run lib/proposta/estado.test.ts`
Expected: PASS. Se "a sugestão só usa o Pós Nacional" falhar, confira que `planosPosNacional` ignora `pos_regional`.

- [ ] **Step 9: Testes das mensagens de WhatsApp (vão falhar)**

Crie `lib/documentos/mensagens-whatsapp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MODELOS_MENSAGEM, preencherModelo } from "./mensagens-whatsapp";

describe("MODELOS_MENSAGEM", () => {
  it("tem dois modelos com id único e os dois campos a preencher", () => {
    expect(MODELOS_MENSAGEM.map((m) => m.id)).toEqual(["formal", "direto"]);
    for (const modelo of MODELOS_MENSAGEM) {
      expect(modelo.texto).toContain("{cliente}");
      expect(modelo.texto).toContain("{consultor}");
    }
  });

  it("nunca falam em economia, desconto ou aumento (o comparativo pode ser um aumento)", () => {
    for (const modelo of MODELOS_MENSAGEM) {
      expect(modelo.texto).not.toMatch(/econom|desconto|reduç|redução|aumento|barato|menos/i);
    }
  });
});

describe("preencherModelo", () => {
  const modelo = MODELOS_MENSAGEM[0].texto;

  it("troca {cliente} e {consultor}, todas as ocorrências", () => {
    const texto = preencherModelo("{cliente} / {cliente} / {consultor}", { cliente: "EMPRESA EXEMPLO LTDA", consultor: "Ana" });
    expect(texto).toBe("EMPRESA EXEMPLO LTDA / EMPRESA EXEMPLO LTDA / Ana");
  });

  it("tira CPF e raiz de CNPJ do nome do cliente (MEI)", () => {
    expect(preencherModelo(modelo, { cliente: "FULANO DE TAL 123.456.789-00", consultor: "Ana" })).toContain("Olá, FULANO DE TAL!");
  });

  it("cai em palavras neutras quando falta o nome do cliente ou do consultor", () => {
    const texto = preencherModelo(modelo, { cliente: "  ", consultor: "" });
    expect(texto).toContain("cliente");
    expect(texto).toContain("seu consultor");
    expect(texto).not.toContain("{");
  });
});
```

- [ ] **Step 10: Rodar e ver falhar; implementar**

Run: `npx vitest run lib/documentos/mensagens-whatsapp.test.ts` — Expected: FAIL (módulo não existe).

Crie `lib/documentos/mensagens-whatsapp.ts`:

```ts
// Mensagens fixas (não são IA) que o consultor edita antes de enviar. Nenhuma
// fala em economia, desconto ou aumento: o comparativo pode ser um aumento, e a
// mensagem acompanha qualquer um dos casos.
import { limparRazaoSocial } from "../ia/abordagem";

export interface ModeloMensagem {
  id: string;
  rotulo: string;
  texto: string;
}

export const MODELOS_MENSAGEM: ModeloMensagem[] = [
  {
    id: "formal",
    rotulo: "Formal",
    texto:
      "Olá, {cliente}! Aqui é {consultor}, da Apex Smart Solutions, parceiro autorizado Claro Empresas. Preparei um comparativo da sua fatura com a nossa proposta e vou te enviar em seguida. Qualquer dúvida, fico à disposição.",
  },
  {
    id: "direto",
    rotulo: "Direto",
    texto:
      "Oi, {cliente}! {consultor}, da Apex, aqui. Fiz um comparativo da sua fatura com a nossa proposta e estou te enviando agora. Posso te explicar os detalhes?",
  },
];

export function preencherModelo(texto: string, vars: { cliente: string; consultor: string }): string {
  const cliente = limparRazaoSocial(vars.cliente) || "cliente";
  const consultor = vars.consultor.trim() || "seu consultor";
  return texto.replaceAll("{cliente}", cliente).replaceAll("{consultor}", consultor);
}
```

Run: `npx vitest run lib/documentos/mensagens-whatsapp.test.ts` — Expected: PASS. (`\"Olá, FULANO DE TAL!\"` vem do modelo "formal": "Olá, {cliente}!".)

- [ ] **Step 11: Rodar tudo e commit**

Run: `npx vitest run && npx tsc --noEmit` — Expected: suíte verde, `tsc` sem erro.

```bash
git add lib/fatura/processar.ts lib/fatura/processar.test.ts lib/proposta/estado.ts lib/proposta/estado.test.ts lib/documentos/mensagens-whatsapp.ts lib/documentos/mensagens-whatsapp.test.ts
git commit -m "feat(crm-fibra): pure screen state, multi-invoice reading and WhatsApp templates

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: As telas da aba Proposta

**Files:**
- Create: `lib/documentos/exportar.ts`
- Create (em `app/(protected)/leads/[cnpj]/`): `proposta-workspace.tsx`, `situacao-atual.tsx`, `nova-proposta.tsx`, `comparativo.tsx`, `exportar.tsx`, `enviar-whatsapp.tsx`, `exportar-salva.tsx`, `page.telefone.test.ts`
- Modify (mesma pasta): `aba-proposta.tsx`, `propostas-salvas.tsx`, `page.tsx`
- Delete: `proposta-builder.tsx`
- Throwaway (não commitar): `app/login/harness-tmp/page.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 14. `salvarPropostaAction(cnpjDigits, itens, situacaoAtual)` e `registrarMensagemAction(cnpjDigits, conteudo, canal)` (`./actions`); `chamarAcaoComSeguranca` (`@/lib/chamar-acao`); `montarLinkWhatsapp` (`@/lib/whatsapp`).
- Produces: `exportarDocumento(tipo: TipoExportacao, modelo: ModeloDocumento): Promise<string | null>` e `type TipoExportacao = "docx" | "pdf-consultor" | "pdf-cliente" | "png" | "copiar-imagem"`; `PropostaWorkspace` (props: `cnpjDigits`, `cliente`, `catalogo`, `nomeConsultor`, `telefone: string | null`, `souODono`); `AbaProposta` ganha `cliente`, `nomeConsultor`, `telefone`, `souODono`.

Estes componentes são de interface: a regra está toda nas funções puras das tarefas anteriores. A verificação é `tsc`, `next build`, o teste estático do telefone e a conferência no navegador (último passo).

- [ ] **Step 1: Escrever o teste estático do telefone (vai falhar)**

O telefone completo não pode ir para o navegador de quem não é dono (o componente é de cliente). Crie `app/(protected)/leads/[cnpj]/page.telefone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("page.tsx do lead — telefone na aba Proposta", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const inicio = fonte.indexOf("<AbaProposta");
  const uso = fonte.slice(inicio, fonte.indexOf("/>", inicio));

  it("só entrega o telefone à aba Proposta (componente de cliente) quando o usuário é o dono", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(uso).toContain("telefone={souODono ? telefone : null}");
    expect(uso).not.toMatch(/telefone=\{telefone\}/);
  });

  it("passa à aba o nome do consultor logado e se ele é o dono", () => {
    expect(uso).toContain("nomeConsultor=");
    expect(uso).toContain("souODono={souODono}");
  });
});
```

Run: `npx vitest run "app/(protected)/leads/[cnpj]/page.telefone.test.ts"` — Expected: FAIL (a página ainda não passa essas props).

- [ ] **Step 2: `exportar.ts` (gerar e entregar o documento)**

Crie `lib/documentos/exportar.ts`:

```ts
// Gera e entrega um documento. Só no navegador. As bibliotecas pesadas (docx,
// jspdf, html-to-image) entram por import() dinâmico: só pesam quando alguém
// clica. Usado pela proposta em andamento e pelas propostas salvas.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import { TIPO_DOCX, TIPO_PDF, TIPO_PNG, baixarArquivo, copiarImagem } from "./baixar";
import { nomeDeArquivo } from "./formato";
import { carregarLogos } from "./marca";

export type TipoExportacao = "docx" | "pdf-consultor" | "pdf-cliente" | "png" | "copiar-imagem";

// Devolve um aviso para mostrar ao consultor (ou null). Chame sem nenhum `await`
// antes: no caso "copiar-imagem" a imagem tem de ser pedida no mesmo instante do
// clique, senão o navegador recusa a cópia.
export async function exportarDocumento(tipo: TipoExportacao, modelo: ModeloDocumento): Promise<string | null> {
  const razao = modelo.cliente.razaoSocial;

  if (tipo === "copiar-imagem") {
    const imagem = import("./png").then(({ gerarPng }) => gerarPng(modelo));
    const copiou = await copiarImagem(imagem);
    return copiou
      ? "Imagem copiada. Cole na conversa do WhatsApp."
      : 'Este navegador não deixou copiar a imagem. Use "Baixar PNG" e anexe o arquivo.';
  }

  if (tipo === "png") {
    const { gerarPng } = await import("./png");
    baixarArquivo(await gerarPng(modelo), nomeDeArquivo("comparativo", razao, "png"), TIPO_PNG);
    return null;
  }

  const logos = await carregarLogos();
  if (tipo === "docx") {
    const { gerarDocx } = await import("./docx");
    baixarArquivo(await gerarDocx(modelo, logos), nomeDeArquivo("proposta", razao, "docx"), TIPO_DOCX);
  } else if (tipo === "pdf-consultor") {
    const { gerarPdfConsultor } = await import("./pdf-consultor");
    baixarArquivo(gerarPdfConsultor(modelo, logos), nomeDeArquivo("proposta", razao, "pdf"), TIPO_PDF);
  } else {
    const { gerarPdfCliente } = await import("./pdf-cliente");
    baixarArquivo(gerarPdfCliente(modelo, logos), nomeDeArquivo("proposta_cliente", razao, "pdf"), TIPO_PDF);
  }
  return null;
}
```

- [ ] **Step 3: Cartão "Situação atual"**

Crie `app/(protected)/leads/[cnpj]/situacao-atual.tsx`:

```tsx
"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PlanoCatalogo } from "@/lib/catalogo";
import { LIMITE_ARQUIVOS, lerTextoDoArquivo } from "@/lib/fatura/pdf-texto";
import { processarFaturas, type ResultadoArquivo } from "@/lib/fatura/processar";
import { LIMITE_FRANQUIA_GB, LIMITE_LINHAS, LIMITE_ROTULO } from "@/lib/fatura/tipos";
import { parseValorBRL } from "@/lib/formato";
import { lerQuantidade } from "@/lib/proposta-rascunho";
import type { LinhaEditavel } from "@/lib/proposta/agrupar";
import {
  adicionarLinhaDigitada,
  atualizarLinha,
  linhasDaFatura,
  removerLinhaEditavel,
  substituirLinhasDaFatura,
} from "@/lib/proposta/estado";

// Campo que só confirma ao sair (blur/Enter): o consultor pode digitar "48,49"
// sem a tela reescrever o texto a cada tecla. `aoConfirmar` devolve false para
// recusar o texto, e o campo volta ao valor anterior.
function Campo({
  rotulo,
  valorInicial,
  aoConfirmar,
  className,
  inputMode,
  maxLength,
  desabilitado,
}: {
  rotulo: string;
  valorInicial: string;
  aoConfirmar: (texto: string) => boolean;
  className?: string;
  inputMode?: "numeric" | "decimal";
  maxLength?: number;
  desabilitado?: boolean;
}) {
  return (
    <Input
      aria-label={rotulo}
      defaultValue={valorInicial}
      inputMode={inputMode}
      maxLength={maxLength}
      disabled={desabilitado}
      className={className}
      onBlur={(e) => {
        if (!aoConfirmar(e.target.value)) e.target.value = valorInicial;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

const formatarValor = (valor: number) => (valor > 0 ? valor.toFixed(2).replace(".", ",") : "");
const formatarConsumo = (mb: number | null) => (mb === null ? "-" : `${(mb / 1024).toFixed(1).replace(".", ",")} GB`);

export function SituacaoAtualCard({
  linhas,
  catalogo,
  setLinhas,
  aoLerFaturas,
}: {
  linhas: LinhaEditavel[];
  catalogo: PlanoCatalogo[];
  setLinhas: Dispatch<SetStateAction<LinhaEditavel[]>>;
  aoLerFaturas: (quantidade: number) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoArquivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const lendo = progresso !== null;

  async function lerFaturas(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setErro(null);
    setResultados([]);
    setProgresso(`Lendo fatura 1 de ${arquivos.length}…`);
    try {
      const resultado = await processarFaturas(arquivos, lerTextoDoArquivo, (indice, total, nome) =>
        setProgresso(`Lendo fatura ${indice} de ${total}: ${nome}`)
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setResultados(resultado.arquivos);
      if (resultado.mescladas.length > 0) {
        const novas = linhasDaFatura(resultado.mescladas, catalogo, () => crypto.randomUUID());
        // Atualização funcional: o que o consultor digitou enquanto a leitura rodava não se perde.
        setLinhas((atuais) => substituirLinhasDaFatura(atuais, novas));
        aoLerFaturas(resultado.faturasLidas);
      }
    } catch {
      setErro("Não foi possível ler as faturas agora. Digite as linhas na tabela abaixo.");
    } finally {
      setProgresso(null);
    }
  }

  const mudar = (chave: string, mudanca: Partial<Omit<LinhaEditavel, "chave">>) =>
    setLinhas((atuais) => atualizarLinha(atuais, chave, mudanca, catalogo));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. Situação atual do cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Anexe a fatura Claro em PDF (até {LIMITE_ARQUIVOS}; com mais de uma vale a média do período) ou digite as
          linhas. A fatura é lida no seu navegador: ela não é enviada a ninguém e o telefone completo nunca é salvo.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            data-testid="fatura-arquivos"
            onChange={(e) => {
              const arquivos = Array.from(e.target.files ?? []);
              e.target.value = "";
              void lerFaturas(arquivos);
            }}
          />
          <Button type="button" onClick={() => entrada.current?.click()} disabled={lendo}>
            <Upload />
            Anexar fatura(s) em PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={lendo || linhas.length >= LIMITE_LINHAS}
            onClick={() => setLinhas((atuais) => adicionarLinhaDigitada(atuais, crypto.randomUUID()))}
          >
            <Plus />
            Adicionar linha
          </Button>
          {progresso && (
            <span className="text-sm text-muted-foreground" role="status">
              {progresso}
            </span>
          )}
        </div>

        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}
        {resultados.length > 0 && (
          <ul className="space-y-1 text-sm" aria-label="Resultado da leitura">
            {resultados.map((r) => (
              <li key={r.nome} className={r.status === "ok" ? "text-green-700" : "text-amber-700"}>
                {r.status === "ok" ? `${r.nome}: ${r.linhas} linha(s) lida(s)` : r.mensagem}
              </li>
            ))}
          </ul>
        )}

        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma linha ainda. Sem situação atual, a proposta sai sem comparativo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead className="w-20">Qtd</TableHead>
                <TableHead className="w-24">Plano (GB)</TableHead>
                <TableHead className="w-32">Mensalidade (R$)</TableHead>
                <TableHead className="w-24">Consumo</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => (
                <TableRow key={linha.chave}>
                  <TableCell className="whitespace-normal">
                    <Campo
                      rotulo={`Nome da linha ${linha.rotulo}`}
                      valorInicial={linha.rotulo}
                      maxLength={LIMITE_ROTULO}
                      desabilitado={linha.origem === "fatura"}
                      aoConfirmar={(texto) => {
                        if (!texto.trim()) return false;
                        mudar(linha.chave, { rotulo: texto.trim() });
                        return true;
                      }}
                    />
                    {linha.avisos.map((aviso) => (
                      <p key={aviso} className="mt-1 text-xs text-amber-700">
                        {aviso}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Quantidade de ${linha.rotulo}`}
                      valorInicial={String(linha.quantidade)}
                      inputMode="numeric"
                      aoConfirmar={(texto) => {
                        const quantidade = lerQuantidade(texto);
                        if (quantidade === null) return false;
                        mudar(linha.chave, { quantidade });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Franquia em GB de ${linha.rotulo}`}
                      valorInicial={linha.planoGb === null ? "" : String(linha.planoGb)}
                      inputMode="numeric"
                      aoConfirmar={(texto) => {
                        const limpo = texto.trim();
                        if (!limpo) {
                          mudar(linha.chave, { planoGb: null });
                          return true;
                        }
                        const gb = /^\d{1,4}$/.test(limpo) ? Number(limpo) : 0;
                        if (gb < 1 || gb > LIMITE_FRANQUIA_GB) return false;
                        mudar(linha.chave, { planoGb: gb });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Mensalidade de ${linha.rotulo}`}
                      valorInicial={formatarValor(linha.valorUnitario)}
                      inputMode="decimal"
                      className={linha.valorUnitario > 0 ? undefined : "border-amber-400"}
                      aoConfirmar={(texto) => {
                        if (!texto.trim()) {
                          mudar(linha.chave, { valorUnitario: 0 });
                          return true;
                        }
                        const valor = parseValorBRL(texto);
                        if (valor === null) return false;
                        mudar(linha.chave, { valorUnitario: valor });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatarConsumo(linha.consumoMb)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${linha.rotulo}`}
                      onClick={() => setLinhas((atuais) => removerLinhaEditavel(atuais, linha.chave))}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Cartão "Nova proposta"**

Crie `app/(protected)/leads/[cnpj]/nova-proposta.tsx`:

```tsx
"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agruparPorCategoria, categoriaTemFranquia, type PlanoCatalogo } from "@/lib/catalogo";
import { formatarBRL } from "@/lib/formato";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  lerQuantidade,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "@/lib/proposta-rascunho";
import { somarValores, type NovoItemProposta } from "@/lib/propostas";
import type { LinhaEditavel } from "@/lib/proposta/agrupar";
import { atualizarLinha, refazerSugestoes, sugestaoDaLinha } from "@/lib/proposta/estado";

const OFERTA_AVULSA = "__avulsa__";
const CLASSE_SELECT =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SeloDaSugestao({ linha, catalogo }: { linha: LinhaEditavel; catalogo: PlanoCatalogo[] }) {
  const sugestao = sugestaoDaLinha(linha, catalogo);
  if (sugestao.acao === "indefinido") return <Badge variant="outline">sem sugestão</Badge>;
  const pct = sugestao.pctFranquia === null ? "" : ` (${Math.round(sugestao.pctFranquia)}% da franquia)`;
  if (sugestao.acao === "upgrade") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
        Upgrade sugerido{pct}
      </Badge>
    );
  }
  if (sugestao.acao === "downgrade") {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-100 text-green-800">
        Downgrade sugerido{pct}
      </Badge>
    );
  }
  return <Badge variant="outline">Manter faixa{pct}</Badge>;
}

export function NovaPropostaCard({
  linhas,
  catalogo,
  itensDasLinhas,
  manuais,
  setLinhas,
  setManuais,
}: {
  linhas: LinhaEditavel[];
  catalogo: PlanoCatalogo[];
  itensDasLinhas: NovoItemProposta[];
  manuais: Rascunho;
  setLinhas: Dispatch<SetStateAction<LinhaEditavel[]>>;
  setManuais: Dispatch<SetStateAction<Rascunho>>;
}) {
  const [selecao, setSelecao] = useState("");
  const [quantidadeTexto, setQuantidadeTexto] = useState("1");
  const [descricaoAvulsa, setDescricaoAvulsa] = useState("");
  const [valorAvulso, setValorAvulso] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const grupos = agruparPorCategoria(catalogo).filter((g) => g.planos.length > 0);
  const gruposDePos = grupos.filter((g) => categoriaTemFranquia(g.categoria));
  const total = somarValores([...itensDasLinhas.map((i) => i.valor), totalRascunho(manuais)]);

  function adicionar() {
    const quantidade = lerQuantidade(quantidadeTexto);
    if (quantidade === null) {
      setErro("Informe uma quantidade de 1 a 1000");
      return;
    }
    if (selecao === OFERTA_AVULSA) {
      const resultado = adicionarLinhaAvulsa(manuais, { descricao: descricaoAvulsa, valorTexto: valorAvulso, quantidadeTexto }, crypto.randomUUID());
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setManuais(resultado.rascunho);
      setDescricaoAvulsa("");
      setValorAvulso("");
    } else {
      const plano = catalogo.find((p) => p.id === selecao);
      if (!plano) {
        setErro('Escolha um plano do catálogo ou "Oferta avulsa"');
        return;
      }
      setManuais(adicionarLinhaCatalogo(manuais, plano, crypto.randomUUID(), quantidade));
    }
    setSelecao("");
    setQuantidadeTexto("1");
    setErro(null);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">2. Nova proposta</CardTitle>
        {linhas.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setLinhas((atuais) => refazerSugestoes(atuais, catalogo))}>
            <RefreshCw />
            Refazer sugestões
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {linhas.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Plano proposto para cada linha</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Hoje</TableHead>
                  <TableHead>Sugestão</TableHead>
                  <TableHead className="w-64">Plano proposto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha) => (
                  <TableRow key={linha.chave}>
                    <TableCell className="whitespace-normal">
                      {linha.rotulo}
                      {linha.quantidade > 1 ? ` (${linha.quantidade} linhas)` : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {linha.planoGb ? `${linha.planoGb}GB` : "-"}
                    </TableCell>
                    <TableCell>
                      <SeloDaSugestao linha={linha} catalogo={catalogo} />
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Plano proposto para ${linha.rotulo}`}
                        className={CLASSE_SELECT}
                        value={linha.planoId ?? ""}
                        onChange={(e) =>
                          setLinhas((atuais) => atualizarLinha(atuais, linha.chave, { planoId: e.target.value || null }, catalogo))
                        }
                      >
                        <option value="">Sem plano proposto</option>
                        {gruposDePos.map((grupo) => (
                          <optgroup key={grupo.categoria} label={grupo.rotulo}>
                            {grupo.planos.map((plano) => (
                              <option key={plano.id} value={plano.id}>
                                {plano.nome} — {formatarBRL(plano.valor)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {itensDasLinhas.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Itens calculados a partir das linhas</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20 text-right">Qtd</TableHead>
                  <TableHead className="w-32 text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itensDasLinhas.map((item) => (
                  <TableRow key={item.catalogoPlanoId ?? item.descricao}>
                    <TableCell className="whitespace-normal">{item.descricao}</TableCell>
                    <TableCell className="text-right">{item.quantidade}</TableCell>
                    <TableCell className="text-right">{formatarBRL(item.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Outros itens (fibra, Claro Monitor, linhas novas, oferta avulsa)</h4>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Item do catálogo"
              value={selecao}
              onChange={(e) => setSelecao(e.target.value)}
              className={CLASSE_SELECT}
            >
              <option value="">Escolha um item do catálogo…</option>
              {grupos.map((grupo) => (
                <optgroup key={grupo.categoria} label={grupo.rotulo}>
                  {grupo.planos.map((plano) => (
                    <option key={plano.id} value={plano.id}>
                      {plano.nome} — {formatarBRL(plano.valor)}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={OFERTA_AVULSA}>Oferta avulsa (digitar)</option>
            </select>
            <Input
              aria-label="Quantidade do item"
              inputMode="numeric"
              value={quantidadeTexto}
              onChange={(e) => setQuantidadeTexto(e.target.value)}
              className="w-24"
            />
            <Button type="button" onClick={adicionar} disabled={!selecao}>
              <Plus />
              Adicionar
            </Button>
          </div>
          {selecao === OFERTA_AVULSA && (
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
              <Input
                placeholder="Descrição da oferta"
                aria-label="Descrição da oferta avulsa"
                value={descricaoAvulsa}
                onChange={(e) => setDescricaoAvulsa(e.target.value)}
              />
              <Input
                placeholder="Valor unitário (ex.: 149,90)"
                aria-label="Valor unitário da oferta avulsa"
                inputMode="decimal"
                value={valorAvulso}
                onChange={(e) => setValorAvulso(e.target.value)}
              />
            </div>
          )}
          {manuais.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20 text-right">Qtd</TableHead>
                  <TableHead className="w-32 text-right">Subtotal</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {manuais.map((linha) => (
                  <TableRow key={linha.chave}>
                    <TableCell className="whitespace-normal">{linha.descricao}</TableCell>
                    <TableCell className="text-right">{linha.quantidade}</TableCell>
                    <TableCell className="text-right">{formatarBRL(linha.valor)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${linha.descricao}`}
                        onClick={() => setManuais((atuais) => removerLinha(atuais, linha.chave))}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>

        <p className="text-right text-sm font-semibold">Total da proposta: {formatarBRL(total)}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Cartão "Comparativo"**

Crie `app/(protected)/leads/[cnpj]/comparativo.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ComparativoCartao } from "@/components/documento/comparativo-cartao";
import { destaqueDoCliente, moeda } from "@/lib/documentos/formato";
import type { ModeloDocumento } from "@/lib/proposta/modelo-documento";

function Indicador({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold ${classe ?? ""}`}>{valor}</div>
    </div>
  );
}

const CLASSE_DA_COR = { verde: "text-green-700", ambar: "text-amber-700", preto: "" } as const;

export function ComparativoCard({
  modelo,
  pendencia,
  consolidar,
  vendedor,
  aoMudarConsolidar,
  aoMudarVendedor,
}: {
  modelo: ModeloDocumento | null;
  pendencia: string | null;
  consolidar: boolean;
  vendedor: string;
  aoMudarConsolidar: (valor: boolean) => void;
  aoMudarVendedor: (valor: string) => void;
}) {
  const destaque = modelo ? destaqueDoCliente(modelo) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. Comparativo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!modelo || !destaque ? (
          <p className="text-sm text-muted-foreground">
            {pendencia ?? "Monte a situação atual e a nova proposta para ver o comparativo."}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {modelo.resumo.atual === null ? (
                <Indicador rotulo="Mensalidade proposta" valor={moeda(modelo.resumo.proposto)} />
              ) : (
                <>
                  <Indicador rotulo="Mensalidade atual" valor={moeda(modelo.resumo.atual)} classe="text-muted-foreground" />
                  <Indicador rotulo="Nova mensalidade" valor={moeda(modelo.resumo.proposto)} />
                  <Indicador rotulo={destaque.titulo} valor={destaque.valor} classe={CLASSE_DA_COR[destaque.cor]} />
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={consolidar}
                  onChange={(e) => aoMudarConsolidar(e.target.checked)}
                />
                Consolidar valores (uma linha só para os planos, sem preço por linha)
              </label>
              <div className="space-y-1">
                <label htmlFor="proposta-vendedor" className="text-xs text-muted-foreground">
                  Vendedor que aparece nos documentos
                </label>
                <Input id="proposta-vendedor" value={vendedor} onChange={(e) => aoMudarVendedor(e.target.value)} />
              </div>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Ver prévia da imagem (PNG)</summary>
              <div className="mt-3 overflow-auto">
                {/* `zoom` reduz só a prévia na tela; a imagem baixada sai em 1080 px (2×). */}
                <div style={{ zoom: 0.5 }}>
                  <ComparativoCartao modelo={modelo} />
                </div>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: WhatsApp**

Crie `app/(protected)/leads/[cnpj]/enviar-whatsapp.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chamarAcaoComSeguranca } from "@/lib/chamar-acao";
import { MODELOS_MENSAGEM, preencherModelo } from "@/lib/documentos/mensagens-whatsapp";
import { montarLinkWhatsapp } from "@/lib/whatsapp";
import { registrarMensagemAction } from "./actions";

export function EnviarWhatsapp({
  cnpjDigits,
  telefone,
  souODono,
  razaoSocial,
  consultor,
}: {
  cnpjDigits: string;
  telefone: string | null;
  souODono: boolean;
  razaoSocial: string;
  consultor: string;
}) {
  const [modeloId, setModeloId] = useState(MODELOS_MENSAGEM[0].id);
  const [texto, setTexto] = useState(() =>
    preencherModelo(MODELOS_MENSAGEM[0].texto, { cliente: razaoSocial, consultor })
  );
  const [erro, setErro] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Só o dono vê o telefone e registra contato (a mesma regra da aba Cliente).
  if (!souODono) {
    return (
      <p className="text-sm text-muted-foreground">
        O envio pelo WhatsApp é do dono do lead. Baixe os arquivos acima e envie por outro meio.
      </p>
    );
  }
  if (!telefone) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum telefone válido encontrado — o contato precisa ser manual.
      </p>
    );
  }

  function trocarModelo(id: string) {
    const modelo = MODELOS_MENSAGEM.find((m) => m.id === id) ?? MODELOS_MENSAGEM[0];
    setModeloId(modelo.id);
    setTexto(preencherModelo(modelo.texto, { cliente: razaoSocial, consultor }));
  }

  function enviar() {
    if (!telefone) return;
    if (!texto.trim()) {
      setErro("Escreva uma mensagem antes de enviar");
      return;
    }
    // Abre o WhatsApp de forma síncrona no clique: esperar a gravação antes faria
    // o navegador tratar como pop-up e bloquear.
    window.open(montarLinkWhatsapp(telefone, texto), "_blank");
    setErro(null);
    startTransition(async () => {
      const resultado = await chamarAcaoComSeguranca(
        () => registrarMensagemAction(cnpjDigits, texto, "whatsapp"),
        unstable_rethrow
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setRegistrada(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h4 className="text-sm font-medium">Enviar pelo WhatsApp</h4>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Clique em &quot;Copiar imagem&quot; (ou baixe o PNG) acima.</li>
        <li>Clique em &quot;Enviar pelo WhatsApp&quot;: a conversa abre com a mensagem pronta.</li>
        <li>Cole a imagem na conversa (Ctrl+V) ou anexe o arquivo e envie.</li>
      </ol>
      <div className="flex items-center gap-2">
        <label htmlFor="whatsapp-modelo" className="text-xs text-muted-foreground">
          Modelo
        </label>
        <select
          id="whatsapp-modelo"
          value={modeloId}
          onChange={(e) => trocarModelo(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
        >
          {MODELOS_MENSAGEM.map((modelo) => (
            <option key={modelo.id} value={modelo.id}>
              {modelo.rotulo}
            </option>
          ))}
        </select>
      </div>
      <textarea
        aria-label="Mensagem de WhatsApp"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        className="w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="button" onClick={enviar} disabled={pending}>
        <MessageCircle />
        Enviar pelo WhatsApp
      </Button>
      {registrada && (
        <p className="text-sm text-green-700" role="status">
          Mensagem registrada no histórico do cliente.
        </p>
      )}
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Cartão "Exportar e enviar" (inclui salvar)**

Crie `app/(protected)/leads/[cnpj]/exportar.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Copy, Download, Save } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chamarAcaoComSeguranca } from "@/lib/chamar-acao";
import { exportarDocumento, type TipoExportacao } from "@/lib/documentos/exportar";
import type { SituacaoAtual } from "@/lib/fatura/tipos";
import { validarItensProposta, type NovoItemProposta } from "@/lib/propostas";
import type { ModeloDocumento } from "@/lib/proposta/modelo-documento";
import { EnviarWhatsapp } from "./enviar-whatsapp";
import { salvarPropostaAction } from "./actions";

const BOTOES: Array<{ tipo: TipoExportacao; rotulo: string; Icone: LucideIcon }> = [
  { tipo: "docx", rotulo: "Word (editável)", Icone: Download },
  { tipo: "pdf-consultor", rotulo: "PDF consultor", Icone: Download },
  { tipo: "pdf-cliente", rotulo: "PDF cliente", Icone: Download },
  { tipo: "png", rotulo: "Baixar PNG", Icone: Download },
  { tipo: "copiar-imagem", rotulo: "Copiar imagem", Icone: Copy },
];

export function Exportar({
  cnpjDigits,
  obterModelo,
  itens,
  situacao,
  pendencia,
  telefone,
  souODono,
  razaoSocial,
  consultor,
}: {
  cnpjDigits: string;
  obterModelo: () => ModeloDocumento | null;
  itens: NovoItemProposta[];
  situacao: SituacaoAtual | null;
  pendencia: string | null;
  telefone: string | null;
  souODono: boolean;
  razaoSocial: string;
  consultor: string;
}) {
  const [ocupado, setOcupado] = useState<TipoExportacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [assinaturaSalva, setAssinaturaSalva] = useState<string | null>(null);
  const [salvando, startSalvando] = useTransition();
  const router = useRouter();

  // Impede salvar duas vezes a mesma proposta: o botão só volta quando algo muda.
  const assinatura = useMemo(() => JSON.stringify({ itens, situacao }), [itens, situacao]);
  const jaSalva = assinaturaSalva === assinatura;
  const bloqueado = pendencia !== null;

  async function gerar(tipo: TipoExportacao) {
    // O modelo é refeito no clique: a data de emissão é a de agora.
    const modelo = obterModelo();
    if (!modelo) return;
    setErro(null);
    setAviso(null);
    setOcupado(tipo);
    try {
      const mensagem = await exportarDocumento(tipo, modelo);
      if (mensagem) setAviso(mensagem);
    } catch {
      setErro("Não foi possível gerar o arquivo agora. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  function salvar() {
    const erroItens = validarItensProposta(itens);
    if (erroItens) {
      setErro(erroItens);
      return;
    }
    setErro(null);
    startSalvando(async () => {
      const resultado = await chamarAcaoComSeguranca(
        () => salvarPropostaAction(cnpjDigits, itens, situacao),
        unstable_rethrow
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAssinaturaSalva(assinatura);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">4. Exportar e enviar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bloqueado && <p className="text-sm text-muted-foreground">{pendencia}</p>}

        <div className="flex flex-wrap gap-2">
          {BOTOES.map(({ tipo, rotulo, Icone }) => (
            <Button
              key={tipo}
              type="button"
              variant="outline"
              disabled={bloqueado || ocupado !== null}
              onClick={() => void gerar(tipo)}
            >
              <Icone />
              {ocupado === tipo ? "Gerando…" : rotulo}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={salvar} disabled={bloqueado || salvando || jaSalva}>
            <Save />
            {salvando ? "Salvando..." : "Salvar proposta"}
          </Button>
          {jaSalva && (
            <span className="text-sm text-green-700" role="status">
              Proposta salva.
            </span>
          )}
        </div>

        {aviso && (
          <p className="text-sm text-green-700" role="status">
            {aviso}
          </p>
        )}
        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}

        <EnviarWhatsapp
          cnpjDigits={cnpjDigits}
          telefone={telefone}
          souODono={souODono}
          razaoSocial={razaoSocial}
          consultor={consultor}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: O espaço de trabalho (junta tudo)**

Crie `app/(protected)/leads/[cnpj]/proposta-workspace.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import type { PlanoCatalogo } from "@/lib/catalogo";
import { itensParaSalvar, type Rascunho } from "@/lib/proposta-rascunho";
import { validarItensProposta, type NovoItemProposta } from "@/lib/propostas";
import { itensDasLinhas, type LinhaEditavel } from "@/lib/proposta/agrupar";
import { validarSituacaoDaTela } from "@/lib/proposta/estado";
import { montarModeloDocumento, type ModeloDocumento } from "@/lib/proposta/modelo-documento";
import { ComparativoCard } from "./comparativo";
import { Exportar } from "./exportar";
import { NovaPropostaCard } from "./nova-proposta";
import { SituacaoAtualCard } from "./situacao-atual";

export function PropostaWorkspace({
  cnpjDigits,
  cliente,
  catalogo,
  nomeConsultor,
  telefone,
  souODono,
}: {
  cnpjDigits: string;
  cliente: { razaoSocial: string; cnpjDigits: string };
  catalogo: PlanoCatalogo[];
  nomeConsultor: string;
  telefone: string | null; // só o dono recebe o telefone (ver page.tsx)
  souODono: boolean;
}) {
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [faturasAnalisadas, setFaturasAnalisadas] = useState(0);
  const [manuais, setManuais] = useState<Rascunho>([]);
  const [consolidar, setConsolidar] = useState(false);
  const [vendedor, setVendedor] = useState(nomeConsultor);

  // Itens derivados das escolhas por linha + itens manuais: nunca se misturam, e
  // por isso a tabela por linha e o total não divergem.
  const derivados = useMemo(() => itensDasLinhas(linhas, catalogo), [linhas, catalogo]);
  const itens = useMemo<NovoItemProposta[]>(() => [...derivados, ...itensParaSalvar(manuais)], [derivados, manuais]);
  const situacao = useMemo(
    () => validarSituacaoDaTela(linhas, faturasAnalisadas, catalogo),
    [linhas, faturasAnalisadas, catalogo]
  );

  const pendencia = !situacao.ok
    ? situacao.erro
    : itens.length === 0
      ? "Adicione pelo menos uma linha à proposta"
      : validarItensProposta(itens);

  const obterModelo = useCallback((): ModeloDocumento | null => {
    if (!situacao.ok || itens.length === 0 || validarItensProposta(itens) !== null) return null;
    return montarModeloDocumento({
      cliente,
      consultor: nomeConsultor,
      situacaoAtual: situacao.situacao,
      itens,
      opcoes: { consolidar, vendedor },
      agora: new Date(),
    });
  }, [situacao, itens, cliente, nomeConsultor, consolidar, vendedor]);

  const modelo = useMemo(() => obterModelo(), [obterModelo]);

  return (
    <div className="space-y-6">
      <SituacaoAtualCard
        linhas={linhas}
        catalogo={catalogo}
        setLinhas={setLinhas}
        aoLerFaturas={setFaturasAnalisadas}
      />
      <NovaPropostaCard
        linhas={linhas}
        catalogo={catalogo}
        itensDasLinhas={derivados}
        manuais={manuais}
        setLinhas={setLinhas}
        setManuais={setManuais}
      />
      <ComparativoCard
        modelo={modelo}
        pendencia={pendencia}
        consolidar={consolidar}
        vendedor={vendedor}
        aoMudarConsolidar={setConsolidar}
        aoMudarVendedor={setVendedor}
      />
      <Exportar
        cnpjDigits={cnpjDigits}
        obterModelo={obterModelo}
        itens={itens}
        situacao={situacao.ok ? situacao.situacao : null}
        pendencia={pendencia}
        telefone={telefone}
        souODono={souODono}
        razaoSocial={cliente.razaoSocial}
        consultor={vendedor.trim() || nomeConsultor}
      />
    </div>
  );
}
```

- [ ] **Step 9: Exportar uma proposta salva**

Crie `app/(protected)/leads/[cnpj]/exportar-salva.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportarDocumento, type TipoExportacao } from "@/lib/documentos/exportar";
import type { Proposta } from "@/lib/propostas";
import { montarModeloDocumento } from "@/lib/proposta/modelo-documento";

const BOTOES: Array<{ tipo: TipoExportacao; rotulo: string }> = [
  { tipo: "docx", rotulo: "Word" },
  { tipo: "pdf-consultor", rotulo: "PDF consultor" },
  { tipo: "pdf-cliente", rotulo: "PDF cliente" },
  { tipo: "png", rotulo: "PNG" },
];

// Remonta os documentos a partir do retrato salvo; a data de emissão é a de hoje.
export function ExportarSalva({
  proposta,
  nomeConsultor,
  cliente,
}: {
  proposta: Proposta;
  nomeConsultor: string;
  cliente: { razaoSocial: string; cnpjDigits: string };
}) {
  const [consolidar, setConsolidar] = useState(false);
  const [ocupado, setOcupado] = useState<TipoExportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar(tipo: TipoExportacao) {
    setErro(null);
    setOcupado(tipo);
    try {
      const modelo = montarModeloDocumento({
        cliente,
        consultor: nomeConsultor,
        situacaoAtual: proposta.situacaoAtual,
        itens: proposta.itens,
        opcoes: { consolidar, vendedor: null },
        agora: new Date(),
      });
      await exportarDocumento(tipo, modelo);
    } catch {
      setErro("Não foi possível gerar o arquivo agora. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {BOTOES.map(({ tipo, rotulo }) => (
          <Button key={tipo} type="button" variant="outline" size="sm" disabled={ocupado !== null} onClick={() => void gerar(tipo)}>
            <Download />
            {ocupado === tipo ? "Gerando…" : rotulo}
          </Button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="size-4" checked={consolidar} onChange={(e) => setConsolidar(e.target.checked)} />
          Consolidar valores
        </label>
      </div>
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Ligar a aba, a lista de salvas e a página; remover o construtor antigo**

Substitua o conteúdo de `app/(protected)/leads/[cnpj]/aba-proposta.tsx` por:

```tsx
import type { PlanoCatalogo } from "@/lib/catalogo";
import type { Proposta } from "@/lib/propostas";
import { PropostaWorkspace } from "./proposta-workspace";
import { PropostasSalvas } from "./propostas-salvas";

export function AbaProposta({
  cnpjDigits,
  cliente,
  catalogo,
  propostas,
  nomesConsultores,
  nomeConsultor,
  telefone,
  souODono,
}: {
  cnpjDigits: string;
  cliente: { razaoSocial: string; cnpjDigits: string };
  catalogo: PlanoCatalogo[];
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
  nomeConsultor: string;
  telefone: string | null;
  souODono: boolean;
}) {
  return (
    <div className="space-y-6">
      <PropostaWorkspace
        cnpjDigits={cnpjDigits}
        cliente={cliente}
        catalogo={catalogo}
        nomeConsultor={nomeConsultor}
        telefone={telefone}
        souODono={souODono}
      />
      <PropostasSalvas propostas={propostas} nomesConsultores={nomesConsultores} cliente={cliente} />
    </div>
  );
}
```

Em `app/(protected)/leads/[cnpj]/propostas-salvas.tsx`:

1. Acrescente o import `import { ExportarSalva } from "./exportar-salva";`.
2. Troque a assinatura do componente por:

```tsx
export function PropostasSalvas({
  propostas,
  nomesConsultores,
  cliente,
}: {
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
  cliente: { razaoSocial: string; cnpjDigits: string };
}) {
```

3. Troque a `<Table>…</Table>` (cabeçalho e corpo) dentro do `CardContent` por:

```tsx
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20 text-right">Qtd</TableHead>
                  <TableHead className="w-32 text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposta.itens.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal">{item.descricao}</TableCell>
                    <TableCell className="text-right">{item.quantidade}</TableCell>
                    <TableCell className="text-right">{formatarBRL(item.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
```

4. Logo depois do parágrafo `Total: …`, antes de fechar o `CardContent`, acrescente:

```tsx
            <ExportarSalva
              proposta={proposta}
              nomeConsultor={nomesConsultores[proposta.consultorId] ?? "Consultor"}
              cliente={cliente}
            />
```

Em `app/(protected)/leads/[cnpj]/page.tsx`, troque o uso de `<AbaProposta … />` por:

```tsx
          <AbaProposta
            cnpjDigits={lead.cnpjDigits}
            cliente={{ razaoSocial: lead.razaoSocial || lead.cnpjDigits, cnpjDigits: lead.cnpjDigits }}
            catalogo={catalogo}
            propostas={propostas}
            nomesConsultores={nomesConsultores}
            nomeConsultor={session ? (nomesConsultores[session.consultorId] ?? "") : ""}
            telefone={souODono ? telefone : null}
            souODono={souODono}
          />
```

Apague o construtor antigo:

```bash
git rm "app/(protected)/leads/[cnpj]/proposta-builder.tsx"
```

- [ ] **Step 11: Rodar testes, tipos e build**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: suíte verde (inclusive `page.telefone.test.ts`), `tsc` sem erro e `next build` concluído sem erro. Se o build reclamar de `"use server"` exportando algo que não é função assíncrona, algum auxiliar foi exportado de `actions.ts`: deixe-o privado. Se reclamar de `document`/`window` num componente de servidor, o componente que usa o navegador esqueceu o `"use client"`.

- [ ] **Step 12: Conferir o fluxo no navegador de verdade**

Os componentes são de cliente e a leitura do PDF só roda no navegador: confira a tela inteira com a página descartável. Substitua `app/login/harness-tmp/page.tsx` por:

```tsx
"use client";

import { PropostaWorkspace } from "@/app/(protected)/leads/[cnpj]/proposta-workspace";
import type { PlanoCatalogo } from "@/lib/catalogo";

const p = (id: string, categoria: PlanoCatalogo["categoria"], nome: string, valor: number, observacao: string | null, franquiaGb: number | null): PlanoCatalogo => ({
  id, categoria, nome, valor, observacao, ativo: true, franquiaGb,
});
const catalogo: PlanoCatalogo[] = [
  p("p12", "pos_nacional", "Pós 12GB", 39.99, "por linha", 12),
  p("p40", "pos_nacional", "Pós 40GB", 54.99, "por linha", 40),
  p("p70", "pos_nacional", "Pós 70GB", 74.99, "por linha", 70),
  p("f800", "banda_larga", "800 Mega (todos os grupos)", 109.9, null, null),
  p("mon", "adicional", "Claro Monitor", 5, null, null),
];

const BLOCOS = [
  ["17", "90000-0001", "48,49", 10, "9.728,00"],
  ["17", "90000-0002", "58,99", 20, "2.048,00"],
  ["11", "3000-0003", "58,99", 20, "12.288,00"],
] as const;

async function criarFaturaExemplo(): Promise<File> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.setFontSize(9);
  BLOCOS.forEach(([ddd, numero, valor, gb, mb], i) => {
    if (i > 0) doc.addPage();
    [
      "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR",
      `(${ddd}) ${numero}`,
      "Mensalidades e Pacotes Promocionais",
      `Oferta Conjunta Claro MIX ${valor}`,
      `Claro Pós ${gb}GB -`,
      "Ligações Locais 0,00",
      `Internet (MB) Descrição Subtotal ${mb} 0,0000`,
      "TOTAL 99,99",
    ].forEach((linha, n) => doc.text(linha, 10, 20 + n * 8));
  });
  return new File([doc.output("arraybuffer")], "fatura-exemplo.pdf", { type: "application/pdf" });
}

export default function Harness() {
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <button
        data-testid="preparar"
        onClick={async () => {
          const arquivo = await criarFaturaExemplo();
          const dt = new DataTransfer();
          dt.items.add(arquivo);
          const entrada = document.querySelector<HTMLInputElement>('[data-testid="fatura-arquivos"]');
          if (entrada) {
            entrada.files = dt.files;
            entrada.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }}
      >
        Anexar fatura de exemplo
      </button>
      <PropostaWorkspace
        cnpjDigits="11222333000181"
        cliente={{ razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" }}
        catalogo={catalogo}
        nomeConsultor="Ana Teste"
        telefone={null}
        souODono={false}
      />
    </main>
  );
}
```

Com o servidor de desenvolvimento ligado, abra `http://localhost:3000/login/harness-tmp`, clique em "Anexar fatura de exemplo" e confira com `get_page_text`/`read_page`:
Expected: (1) três linhas na tabela com os rótulos `(17) ••••• 0001`, `(17) ••••• 0002` e `(11) ••••• 0003`, sem nenhum número completo na página (`get_page_text` não contém `90000`); (2) no cartão 2, os planos já escolhidos `Pós 12GB`, `Pós 12GB`, `Pós 40GB` e os selos "Upgrade sugerido (95% da franquia)", "Downgrade sugerido (10% da franquia)", "Manter faixa (60% da franquia)"; (3) itens calculados "Pós 12GB — por linha" com Qtd 2 e R$ 79,98, e "Pós 40GB — por linha" com Qtd 1 e R$ 54,99; (4) no Comparativo, "Mensalidade atual R$ 166,47", "Nova mensalidade R$ 134,97" e "ECONOMIA MENSAL R$ 31,50".
Depois troque o plano da primeira linha para "Pós 70GB" (`form_input` no select com `aria-label="Plano proposto para (17) ••••• 0001"`): o total vira R$ 169,97 e o indicador passa para "AUMENTO MENSAL R$ 3,50" em âmbar. Marque "Consolidar valores" e abra "Ver prévia da imagem": a prévia mostra uma linha "3 linha(s) — …". Clique em "Word (editável)", "PDF cliente", "Baixar PNG" e "Copiar imagem": nenhum erro vermelho na tela e `read_console_messages` sem erro (o download é só do navegador; a cópia pode avisar que o navegador não permitiu). Tire um `screenshot` da página inteira. O botão "Salvar proposta" não funciona nesta página (precisa de sessão): não clique. Se algo da tela estiver quebrado ou feio, conserte o componente e registre no ledger.

- [ ] **Step 13: Commit**

```bash
git add lib/documentos/exportar.ts "app/(protected)/leads/[cnpj]/proposta-workspace.tsx" "app/(protected)/leads/[cnpj]/situacao-atual.tsx" "app/(protected)/leads/[cnpj]/nova-proposta.tsx" "app/(protected)/leads/[cnpj]/comparativo.tsx" "app/(protected)/leads/[cnpj]/exportar.tsx" "app/(protected)/leads/[cnpj]/enviar-whatsapp.tsx" "app/(protected)/leads/[cnpj]/exportar-salva.tsx" "app/(protected)/leads/[cnpj]/page.telefone.test.ts" "app/(protected)/leads/[cnpj]/aba-proposta.tsx" "app/(protected)/leads/[cnpj]/propostas-salvas.tsx" "app/(protected)/leads/[cnpj]/page.tsx"
git commit -m "feat(crm-fibra): proposal tab with invoice reading, comparison and exports

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(O `git rm` do construtor antigo já entra neste commit; a página `harness-tmp` não.)

---

### Task 16: README, limpeza e verificação final

**Files:**
- Modify: `README.md`
- Remove: `app/login/harness-tmp/` (descartável), `.claude/launch.json` do worktree, a linha de `info/exclude`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Documentar no README**

Acrescente ao **fim** de `README.md` (depois do checklist do Plano 4):

```markdown

## Proposta com fatura, comparativo e exportação (Plano 5)

A aba **Proposta** da ficha `/leads/[cnpj]` virou o gerador de proposta do painel (aba *Gerar
Proposta* + *Analisar Fatura*), com a fatura como porta de entrada: o consultor anexa a fatura
Claro em PDF (ou digita as linhas), vê o plano sugerido para cada linha pelo consumo, compara o que
o cliente paga com a nova proposta e exporta **Word, PDF do consultor, PDF do cliente e PNG**, com
envio por WhatsApp.

**Migração (a aplicar em produção antes de publicar o código):** `db/schema.sql` (idempotente)
acrescentou `catalogo_planos.franquia_gb`, `proposta_itens.quantidade`, `proposta_itens.franquia_gb`
e `propostas.situacao_atual`. `db/rollback-proposta-fatura.sql` desfaz (e apaga o que essas colunas
guardam). **Ordem:** aplicar a migração ANTES de publicar o código; para desfazer, republique antes o
código anterior (a ficha lê essas colunas e quebraria sem elas).

**Privacidade:** a fatura é lida **no navegador** (pdf.js) e nunca é enviada ao servidor nem a
terceiros (nada de IA). O telefone de cada linha vira `(DD) ••••• NNNN` assim que sai do leitor; só
isso aparece na tela, no banco e nos documentos. Um nome de linha com 8 ou mais dígitos é recusado.

**Leitura da fatura:** só PDF com texto, no formato da fatura Claro Empresas com detalhamento por
linha (o mesmo leitor do painel, validado com dois modelos). PDF escaneado ou de outro layout não é
lido: a tela avisa e o consultor digita as linhas. Com 2 a 6 faturas vale a média de consumo e de valor
por linha. Sugestão por consumo: a partir de 90% da franquia sugere upgrade; até 40% sugere downgrade
(o plano novo precisa cobrir o consumo com 20% de folga); no meio, mantém. Só o Pós Nacional entra na
sugestão automática; o regional é escolha manual.

**Catálogo:** o formulário de `/catalogo` ganhou "Franquia (GB)", obrigatória nos planos Pós (sem ela, o
plano não entra na sugestão por consumo).

**WhatsApp:** só para o dono do lead. A mensagem é um modelo fixo e editável, que nunca fala em
economia. O WhatsApp não aceita anexo por link: clique em *Copiar imagem* (ou baixe o PNG), depois em
*Enviar pelo WhatsApp* e cole a imagem na conversa.

### Checklist de verificação manual (Plano 5)

Use uma **fatura Claro real** (o PDF não vai para o repositório).

1. Abra um lead → aba Proposta: os cartões "Situação atual", "Nova proposta", "Comparativo" e
   "Exportar e enviar".
2. Anexe a fatura em PDF → uma linha por celular, com telefone mascarado, plano (GB), mensalidade e
   consumo; nenhum telefone completo na tela.
3. Anexe 2 ou 3 faturas do mesmo cliente → consumo e valor viram média, com aviso quando uma linha
   falta em alguma fatura ou o plano mudou.
4. Anexe um PDF escaneado (sem texto) → mensagem "não tem texto" e a tabela continua para digitar.
5. Clique em "Adicionar linha" e digite "5 linhas × 10GB × R$ 50" → entra na situação atual.
6. No cartão 2, cada linha já vem com o plano sugerido e o selo (upgrade/downgrade/manter); troque o
   plano de uma linha → itens e total mudam na hora.
7. Marque "Consolidar valores" → os documentos trazem uma linha só para os planos.
8. Baixe Word, PDF consultor, PDF cliente e PNG: abrem certos, com os dois logos, valores, validade de
   1 dia e o Claro Monitor (se houver) como benefício, não como linha.
9. "Copiar imagem" e "Enviar pelo WhatsApp" → a conversa abre no telefone do lead com a mensagem; cole
   a imagem. A mensagem fica no histórico do cliente (aba Cliente).
10. "Salvar proposta" → aparece em "Propostas salvas" com quantidade e subtotal; os botões de exportar
    dela geram os mesmos arquivos.
11. Gere a abordagem depois → o texto cita os planos com a quantidade ("10× Pós 12GB") e o total.
12. Entre como outro consultor que não é dono do lead → sem telefone e sem botão de WhatsApp (só o aviso).
```

- [ ] **Step 2: Remover o que era descartável**

```bash
rm -rf "app/login/harness-tmp" .claude/launch.json
git rev-parse --git-path info/exclude | xargs sed -i '/crm-fibra\/app\/login\/harness-tmp\//d'
git status --short
```

Expected: o `git status` mostra só `README.md` modificado; nada de `harness-tmp`, nem `.claude/`. Se o servidor de desenvolvimento ainda estiver ligado, pare-o com `preview_stop` antes de apagar a pasta.

- [ ] **Step 3: Verificação final completa**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: todos os testes verdes (os 303 anteriores + os novos desta entrega), `tsc` sem erro e `next build` concluído. Confira também `git log --oneline oficial/main..HEAD` (16 commits de tarefa + os da spec e do plano) e `git status` limpo depois do commit.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(crm-fibra): document the proposal with invoice flow and its manual checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Conferir que nada de dado real entrou**

Run: `git diff oficial/main..HEAD --stat | tail -5` e `git grep -n -E "\(1[1-9]\) ?9[0-9]{4}-?[0-9]{4}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}" -- "*.ts" "*.tsx" "*.md" ":!docs/superpowers"`
Expected: o `git grep` não encontra telefone completo nem CNPJ formatado nos arquivos novos (os testes só usam `(17) 90000-0001` em fixtures de **entrada recusada** e `11.222.333/0001-81`, o CNPJ sintético). Se aparecer qualquer número que pareça real, troque por um sintético antes de entregar.

---

## Desvios deliberados da spec

Decididos ao escrever o plano, com a spec e o código reais na mão. O executor os trata como parte do plano (não precisa de `Ruling:` novo, só de seguir).

1. **Rótulo com 8 ou mais dígitos *no total*** (ignorando separadores), não só "seguidos": a spec foi corrigida junto (ver o commit da spec), porque `(17) 99219-9652` tem no máximo 5 dígitos seguidos e passaria por uma checagem de 8 seguidos.
2. **Cartões 1 e 3 não "recolhem" sem situação atual.** O cartão 1 é a porta de entrada (anexar a fatura) e precisa estar sempre visível; o cartão 3 mostra a mensalidade proposta sem comparação. Sem situação atual, o comparativo e a diferença simplesmente não existem.
3. **`LinhaTabela` tem quatro colunas** (descrição, quantidade, valor unitário e subtotal) em vez das três do painel (item, descrição, subtotal): o item da proposta já guarda a quantidade, então a tabela a mostra.
4. **A razão social sai sem CPF e sem raiz de CNPJ nos documentos** (`limparRazaoSocial`, a mesma regra da Abordagem por IA): o documento vai para o cliente e circula por WhatsApp, e cerca de 9% da base tem esses números no nome. A spec era omissa.
5. **Prévia e imagem usam o mesmo componente**, montado fora da tela sob demanda (`gerarPng`): a imagem sai igual para a proposta em andamento e para uma proposta salva, sem depender de um nó visível.
6. **`copiarImagem` recebe uma promessa da imagem**, não a imagem pronta: o Safari só aceita o gesto do clique se o `ClipboardItem` for criado de forma síncrona.
7. **Worker do pdf.js:** o plano usa `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`. Se o servidor de desenvolvimento ou o `next build` não servirem o worker, a Task 1 manda copiá-lo para `public/` (e registrar o `Ruling:`).
8. **Tarefa 8 deixa o `tsc` com erros por uma tarefa** (os arquivos da Task 9 ainda usam itens sem `quantidade`/`franquiaGb`); os testes do Vitest ficam verdes e a Task 9 fecha os tipos.

## Depois das tarefas (exige OK do usuário, não faz parte da execução)

Nada abaixo acontece sem a confirmação do usuário, passo a passo:

1. **Revisão final e finalização do branch** (skill `executing-plans` e `finishing-a-development-branch`): relatório com os rulings e os menores adiados, menu de integração, `git fetch oficial` antes de qualquer merge.
2. **Aplicar o DDL em produção** (Supabase `mdgfboijyqfkggcrhptn`, via `execute_sql`): o bloco "Proposta com fatura (sub-projeto 5)" de `db/schema.sql`; conferir as quatro colunas e o preenchimento de `catalogo_planos.franquia_gb` (12, 40, 70, 100 e 150 nos Pós Nacional; 30 no regional). A tabela de propostas está vazia em produção: não há dado a migrar. **Antes do deploy.**
3. **Merge em `oficial/main` e push.**
4. **Deploy no Vercel** (mesma receita do sub-projeto 2, `vercel deploy --prod` de um worktree limpo; sem variável nova) e teste sem login.
5. **O usuário roda o checklist do README ("Plano 5") com uma fatura Claro real.** O consultor logado e o PDF real só ele testa; eu não digito senha nem trago a fatura para o repositório.
