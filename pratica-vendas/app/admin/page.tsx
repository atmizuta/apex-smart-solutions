import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { listarTodasSessoes } from '@/db/sessoesPratica';
import { Nav } from '@/app/components/Nav';

// Sem isso, o Next tenta pré-renderizar esta página no build (dado ao vivo do
// banco, sem cookies() pra sinalizar "dinâmica" sozinho) e falha, pois não há
// banco disponível em build time — achado rodando `next build` de verdade.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  // checagem de papel própria: a documentação do Next recomenda não confiar
  // só no middleware/proxy pra autorização (Minor da revisão final).
  const cookieStore = await cookies();
  const dados = await verificarTokenSessao(cookieStore.get('sessao')?.value ?? '');
  if (!dados || dados.papel !== 'admin') {
    redirect('/cenarios');
  }

  const sessoes = await listarTodasSessoes();

  return (
    <div className="tela-app">
      <Nav />
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '48px 24px' }}>
        <p className="rotulo">Visão gerencial</p>
        <h1 style={{ color: 'var(--cor-branco)', fontSize: 30, marginTop: 8, marginBottom: 24 }}>
          Todas as sessões de prática
        </h1>

        <div className="cartao" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--cor-linha)' }}>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cor-tinta-suave)', fontWeight: 600 }}>Consultor</th>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cor-tinta-suave)', fontWeight: 600 }}>Data</th>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cor-tinta-suave)', fontWeight: 600 }}>Nota</th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--cor-linha)' }}>
                  <td style={{ padding: '12px 20px', fontSize: 14, color: 'var(--cor-tinta)' }}>{s.nomeUsuario}</td>
                  <td style={{ padding: '12px 20px', fontSize: 14, color: 'var(--cor-tinta-suave)' }}>
                    {new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}
                  </td>
                  <td style={{ padding: '12px 20px', fontSize: 14 }}>
                    {s.nota != null ? (
                      <span
                        style={{
                          fontFamily: 'var(--fonte-display)',
                          fontWeight: 600,
                          fontSize: 13,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: s.nota >= 70 ? 'rgba(31,122,77,0.12)' : 'rgba(227,6,19,0.1)',
                          color: s.nota >= 70 ? 'var(--cor-sucesso)' : 'var(--cor-vermelho-600)',
                        }}
                      >
                        {s.nota}/100
                      </span>
                    ) : (
                      <span style={{ color: 'var(--cor-tinta-suave)', fontStyle: 'italic', fontSize: 12.5 }}>Em andamento</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
