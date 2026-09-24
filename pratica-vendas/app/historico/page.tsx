import { cookies } from 'next/headers';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { listarSessoesPorUsuario } from '@/db/sessoesPratica';

// cookies() já força renderização dinâmica sozinho, mas deixamos explícito
// pelo mesmo motivo do /admin: esta página nunca deve ser cacheada/estática.
export const dynamic = 'force-dynamic';

export default async function HistoricoPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('sessao')?.value ?? '';
  const dados = await verificarTokenSessao(token);
  if (!dados) return null;

  const sessoes = await listarSessoesPorUsuario(dados.usuarioId);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Seu histórico</h1>
      <table style={{ width: '100%', background: '#fff', borderRadius: 10, borderCollapse: 'collapse' }}>
        <tbody>
          {sessoes.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 10 }}>{new Date(s.iniciadoEm).toLocaleDateString('pt-BR')}</td>
              <td style={{ padding: 10 }}>{s.nota != null ? `${s.nota}/100` : 'Em andamento'}</td>
              <td style={{ padding: 10, fontSize: 13, color: '#6b7280' }}>{s.feedback ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
