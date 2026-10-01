"use client";

import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { FatiaRenovacao } from "@/lib/camadas";

const CORES = ["#16a34a", "#f59e0b", "#fb923c", "#9ca3af"];

const chartConfig = {
  valor: { label: "Leads" },
} satisfies ChartConfig;

export function RenovacaoDonut({ dados }: { dados: FatiaRenovacao[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Composição de renovação</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[280px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="nome" />} />
            <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={60} outerRadius={100}>
              {dados.map((_, index) => (
                <Cell key={index} fill={CORES[index % CORES.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
          {dados.map((fatia, index) => (
            <li key={fatia.nome} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: CORES[index % CORES.length] }}
              />
              {fatia.nome} ({fatia.valor})
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
