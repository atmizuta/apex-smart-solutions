import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarBRL, formatarDataHora } from "@/lib/formato";
import type { Proposta } from "@/lib/propostas";

export function PropostasSalvas({
  propostas,
  nomesConsultores,
}: {
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
}) {
  if (propostas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma proposta salva para este cliente ainda.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h3>Propostas salvas</h3>
      {propostas.map((proposta, indice) => (
        <Card key={proposta.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {nomesConsultores[proposta.consultorId] ?? "Consultor desconhecido"} ·{" "}
              {formatarDataHora(proposta.criadoEm)}
            </CardTitle>
            {indice === 0 && <Badge>Mais recente</Badge>}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-32 text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposta.itens.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal">{item.descricao}</TableCell>
                    <TableCell className="text-right">{formatarBRL(item.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-right text-sm font-semibold">
              Total: {formatarBRL(proposta.total)}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
