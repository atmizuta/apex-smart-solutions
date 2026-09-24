'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from '@/app/components/Nav';

type Cenario = { id: string; titulo: string; descricao: string };

export default function CenariosPage() {
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [erro, setErro] = useState('');
  const [iniciando, setIniciando] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/cenarios')
      .then((r) => r.json())
      .then(setCenarios)
      .catch(() => setErro('Não foi possível carregar os cenários. Recarregue a página.'));
  }, []);

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
    <div>
      <Nav />
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
        <h1>Escolha um cenário pra praticar</h1>
        {erro && <p style={{ color: '#b3101f' }}>{erro}</p>}
        <div style={{ display: 'grid', gap: 12 }}>
          {cenarios.map((c) => (
            <button
              key={c.id}
              onClick={() => iniciar(c.id)}
              disabled={iniciando !== null}
              style={{ textAlign: 'left', padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, cursor: iniciando ? 'default' : 'pointer', opacity: iniciando && iniciando !== c.id ? 0.5 : 1 }}
            >
              <strong>{c.titulo}</strong>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{c.descricao}</p>
              {iniciando === c.id && <p style={{ fontSize: 12, color: '#d0112e', margin: '4px 0 0' }}>Iniciando...</p>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
