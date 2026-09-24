import { listarTodasSessoes } from '@/db/sessoesPratica';

// Sem isso, o Next tenta pré-renderizar esta página no build (dado ao vivo do
// banco, sem cookies() pra sinalizar "dinâmica" sozinho) e falha, pois não há
// banco disponível em build time — achado rodando `next build` de verdade.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const sessoes = await listarTodasSessoes();

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      <h1>Todas as sessões de prática</h1>
      <table style={{ width: '100%', background: '#fff', borderRadius: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 10 }}>Consultor</th>
            <th style={{ textAlign: 'left', padding: 10 }}>Data</th>
            <th style={{ textAlign: 'left', padding: 10 }}>Nota</th>
          </tr>
        </thead>
        <tbody>
          {sessoes.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 10 }}>{s.nomeUsuario}</td>
              <td style={{ padding: 10 }}>{new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}</td>
              <td style={{ padding: 10 }}>{s.nota != null ? `${s.nota}/100` : 'Em andamento'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
