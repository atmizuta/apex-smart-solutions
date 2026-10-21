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
