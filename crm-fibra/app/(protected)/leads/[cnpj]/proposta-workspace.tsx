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
