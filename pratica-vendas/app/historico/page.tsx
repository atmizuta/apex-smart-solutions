import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { listarSessoesPorUsuario } from '@/db/sessoesPratica';
import { Nav } from '@/app/components/Nav';

// cookies() já força renderização dinâmica sozinho, mas deixamos explícito
// pelo mesmo motivo do /admin: esta página nunca deve ser cacheada/estática.
export const dynamic = 'force-dynamic';

export default async function HistoricoPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('sessao')?.value ?? '';
  const dados = await verificarTokenSessao(token);
  if (!dados) redirect('/login');

  const sessoes = await listarSessoesPorUsuario(dados.usuarioId);

  return (
    <div className="tela-app">
      <Nav />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
        <p className="rotulo">Seu progresso</p>
        <h1 style={{ color: 'var(--cor-branco)', fontSize: 30, marginTop: 8, marginBottom: 24 }}>Seu histórico</h1>

        {sessoes.length === 0 ? (
          <div className="cartao" style={{ padding: 24, textAlign: 'center', color: 'var(--cor-tinta-suave)', fontSize: 14 }}>
            Você ainda não praticou nenhum cenário.
          </div>
        ) : (
          <div className="cartao" style={{ overflow: 'hidden' }}>
            {sessoes.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '14px 20px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--cor-linha)',
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--cor-tinta-suave)', width: 90, flexShrink: 0 }}>
                  {new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}
                </div>
                <div style={{ width: 84, flexShrink: 0 }}>
                  {s.nota != null ? (
                    <span
                      style={{
                        display: 'inline-block',
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
                    <span style={{ fontSize: 12.5, color: 'var(--cor-tinta-suave)', fontStyle: 'italic' }}>Em andamento</span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--cor-tinta-suave)', lineHeight: 1.5 }}>{s.feedback ?? ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
