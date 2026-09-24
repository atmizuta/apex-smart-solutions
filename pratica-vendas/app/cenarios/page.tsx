'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Cenario = { id: string; titulo: string; descricao: string };

export default function CenariosPage() {
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [erro, setErro] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/cenarios')
      .then((r) => r.json())
      .then(setCenarios);
  }, []);

  async function iniciar(cenarioId: string) {
    setErro('');
    const resposta = await fetch('/api/pratica/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cenarioId }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    router.push(`/pratica/${dados.sessaoId}`);
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Escolha um cenário pra praticar</h1>
      {erro && <p style={{ color: '#b3101f' }}>{erro}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {cenarios.map((c) => (
          <button
            key={c.id}
            onClick={() => iniciar(c.id)}
            style={{ textAlign: 'left', padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer' }}
          >
            <strong>{c.titulo}</strong>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{c.descricao}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
