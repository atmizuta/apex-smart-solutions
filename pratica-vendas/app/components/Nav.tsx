'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { LogoApex } from './LogoApex';

type Usuario = { nome: string; papel: 'consultor' | 'admin' };

// Sem isso não havia como sair do app nem navegar entre telas — num
// escritório com máquina compartilhada, a sessão de 7 dias de um consultor
// ficava aberta pro próximo que sentasse (Review Focus / achado da revisão final).
export function Nav() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const router = useRouter();
  const pathname = usePathname();

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

  const links = [
    { href: '/cenarios', label: 'Praticar' },
    { href: '/historico', label: 'Meu histórico' },
    ...(usuario?.papel === 'admin' ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  // Dentro de uma sessão de prática o consultor está concentrado na
  // conversa — a barra completa (Praticar/histórico/admin/sair) só
  // distraía. Aqui a única ação que faz sentido é voltar pra lista.
  const dentroDaPratica = pathname?.startsWith('/pratica/');

  if (dentroDaPratica) {
    return (
      <nav className="nav-app">
        <a
          href="/cenarios"
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--cor-branco)', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}
        >
          <span aria-hidden>←</span> Voltar para cenários
        </a>
      </nav>
    );
  }

  return (
    <nav className="nav-app">
      <a href="/cenarios" className="marca-apex" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <LogoApex tamanho={22} />
        <span>
          <span className="nome">Apex</span>
          <span className="subnome">Prática de vendas</span>
        </span>
      </a>
      <div className="nav-divisor" />
      <div className="nav-links">
        {links.map((l) => {
          const ativo = pathname === l.href;
          return (
            <a
              key={l.href}
              href={l.href}
              style={{
                color: ativo ? 'var(--cor-branco)' : 'var(--cor-rosa-label)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: ativo ? 600 : 500,
                padding: '6px 2px',
                borderBottom: ativo ? '2px solid var(--cor-vermelho)' : '2px solid transparent',
              }}
            >
              {l.label}
            </a>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      {usuario && (
        <span className="nav-usuario" style={{ color: 'var(--cor-rosa-label)', fontSize: 13 }}>
          {usuario.nome}
        </span>
      )}
      <button onClick={sair} className="btn btn-fantasma" style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}>
        Sair
      </button>
    </nav>
  );
}
