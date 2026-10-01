import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCard({
  rotulo,
  valor,
  href,
  Icone,
}: {
  rotulo: string;
  valor: number;
  href: string;
  Icone: LucideIcon;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icone className="h-5 w-5" />
          </div>
          <div>
            <div className="font-head text-2xl font-semibold text-foreground">
              {valor.toLocaleString("pt-BR")}
            </div>
            <div className="text-xs text-muted-foreground">{rotulo}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
