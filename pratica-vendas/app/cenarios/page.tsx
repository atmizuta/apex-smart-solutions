'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { Nav } from '@/app/components/Nav';

type Cenario = { id: string; titulo: string; descricao: string; icone?: string };

export default function CenariosPage() {
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [erro, setErro] = useState('');
  const [iniciando, setIniciando] = useState<string | null>(null);
  const router = useRouter();
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/cenarios')
      .then((r) => r.json())
      .then(setCenarios)
      .catch(() => setErro('Não foi possível carregar os cenários. Recarregue a página.'));
  }, []);

  // Entrada em cascata dos cards — só roda quando a lista chega, não a cada
  // re-render (senão reanimaria a cada clique em "Iniciando...").
  useEffect(() => {
    if (cenarios.length === 0 || !listaRef.current) return;
    const cards = listaRef.current.querySelectorAll('.cenario-card');
    gsap.fromTo(
      cards,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power2.out' }
    );
  }, [cenarios]);

  async function iniciar(cenarioId: string) {
    if (iniciando) return;
    setErro('');
    setIniciando(cenarioId);
    try {
      const resposta = await fetch('/api/pratica/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cenarioId }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.erro);
        setIniciando(null);
        return;
      }
      router.push(`/pratica/${dados.sessaoId}`);
    } catch {
      setErro('Falha de conexão. Tente de novo.');
      setIniciando(null);
    }
  }

  return (
    <div className="tela-app">
      <Nav />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
        <p className="rotulo">Treinamento comercial</p>
        <h1 style={{ color: 'var(--cor-branco)', fontSize: 30, marginTop: 8, marginBottom: 28 }}>
          Escolha um cenário pra praticar
        </h1>
        {erro && (
          <p style={{ color: '#ffd7d7', background: 'rgba(227,6,19,0.18)', border: '1px solid rgba(227,6,19,0.4)', padding: '10px 14px', borderRadius: 8, fontSize: 14 }}>
            {erro}
          </p>
        )}
        <div ref={listaRef} style={{ display: 'grid', gap: 12 }}>
          {cenarios.map((c) => {
            const ativo = iniciando === c.id;
            return (
              <button
                key={c.id}
                onClick={() => iniciar(c.id)}
                disabled={iniciando !== null}
                className="cartao cenario-card"
                style={{
                  textAlign: 'left',
                  padding: '18px 20px',
                  border: 'none',
                  borderLeft: '3px solid transparent',
                  cursor: iniciando ? 'default' : 'pointer',
                  opacity: iniciando && !ativo ? 0.45 : 1,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  transition: 'opacity 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={(e) => !iniciando && (e.currentTarget.style.borderLeftColor = 'var(--cor-vermelho)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderLeftColor = 'transparent')}
              >
                {c.icone && (
                  <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 2 }} aria-hidden>
                    {c.icone}
                  </span>
                )}
                <span>
                  <strong style={{ fontSize: 15, color: 'var(--cor-tinta)' }}>{c.titulo}</strong>
                  <p style={{ fontSize: 13.5, color: 'var(--cor-tinta-suave)', margin: '5px 0 0', lineHeight: 1.5 }}>{c.descricao}</p>
                  {ativo && (
                    <p style={{ fontSize: 12, color: 'var(--cor-vermelho-600)', margin: '8px 0 0', fontWeight: 600 }}>
                      Iniciando...
                    </p>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
