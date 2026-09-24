// Diferente de `npm run dev`/`next build` (que carregam .env.local sozinhos),
// um script solto como db/seed.ts não lê o arquivo automaticamente — sem
// isso, rodar `npx tsx db/seed.ts` falhava com "DATABASE_URL não
// configurada" mesmo com o .env.local preenchido certo (achado testando com
// o Rafael). Precisa ser importado ANTES de qualquer módulo que leia
// process.env no top-level (ex.: db/client.ts) — import statements são
// hoistados pelo compilador, então a ORDEM entre eles (não código solto no
// meio do arquivo) é o que garante isso rodar primeiro.
try {
  process.loadEnvFile('.env.local');
} catch {
  // sem .env.local (ex.: produção, onde as variáveis já vêm da plataforma) — segue normal.
}
