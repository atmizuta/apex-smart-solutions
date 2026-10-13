// SONDA TEMPORÁRIA (Tarefa 1 do plano 2026-10-13-relatorio-pedidos-parados-email): prova que a ExcelJS gera e relê
// um .xlsx colorido no Edge Runtime e que a denomailer importa. Será substituída pelo index.ts definitivo.
import ExcelJS from "npm:exceljs@4.4.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

Deno.serve(async (req: Request) => {
  if ((req.headers.get("x-cron-secret") ?? "") !== (Deno.env.get("SYNC_CRON_SECRET") ?? "x")) {
    return new Response("Não autorizado", { status: 401 });
  }
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sonda", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.getCell("A1").value = "ok";
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC1050F" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const relido = new ExcelJS.Workbook();
    await relido.xlsx.load(bytes);
    const fill = relido.getWorksheet("Sonda")!.getCell("A1").fill as { fgColor?: { argb?: string } };
    return Response.json({ bytes: bytes.length, zip: bytes[0] === 0x50 && bytes[1] === 0x4b, cor: fill?.fgColor?.argb ?? null, smtp: typeof SMTPClient });
  } catch (e) {
    return Response.json({ erro: (e as Error).message, pilha: (e as Error).stack }, { status: 500 });
  }
});
