'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Usuario = { nome: string; papel: 'consultor' | 'admin' };

// Sem isso não havia como sair do app nem navegar entre telas — num
// escritório com máquina compartilhada, a sessão de 7 dias de um consultor
// ficava aberta pro próximo que sentasse (Review Focus / achado da revisão final).
export function Nav() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsuario)
      .catch(() => setUsuario(null));
  }, []);

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <nav style={{ background: '#1a0302', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <a href="/cenarios" style={{ color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>Praticar</a>
      <a href="/historico" style={{ color: '#e8b9b9', textDecoration: 'none', fontSize: 14 }}>Meu histórico</a>
      {usuario?.papel === 'admin' && (
        <a href="/admin" style={{ color: '#e8b9b9', textDecoration: 'none', fontSize: 14 }}>Admin</a>
      )}
      <div style={{ flex: 1 }} />
      {usuario && <span style={{ color: '#e8b9b9', fontSize: 13 }}>{usuario.nome}</span>}
      <button onClick={sair} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.3)', color: '#fff', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
        Sair
      </button>
    </nav>
  );
}
