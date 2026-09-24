'use client';
import { use, useState } from 'react';

// Next 16: params de página também chega como Promise — mesma ruling do Task 10.
export default function PraticaPage({ params }: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = use(params);
  const [mensagens, setMensagens] = useState<{ remetente: 'consultor' | 'ia'; texto: string }[]>([]);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<{ nota: number; feedback: string } | null>(null);
  const [erro, setErro] = useState('');

  async function enviar() {
    if (!texto.trim()) return;
    setErro('');
    const textoEnviado = texto;
    setMensagens((m) => [...m, { remetente: 'consultor', texto: textoEnviado }]);
    setTexto('');

    const resposta = await fetch(`/api/pratica/${sessaoId}/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: textoEnviado }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    setMensagens((m) => [...m, { remetente: 'ia', texto: dados.resposta }]);
  }

  async function encerrar() {
    setErro('');
    const resposta = await fetch(`/api/pratica/${sessaoId}/encerrar`, { method: 'POST' });
    const dados = await resposta.json();
    if (!resposta.ok) {
      setErro(dados.erro);
      return;
    }
    setResultado(dados);
  }

  return (
    <div style={{ maxWidth: 600, margin: '20px auto', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, minHeight: 400, marginBottom: 12 }}>
        {mensagens.map((m, i) => (
          <div key={i} style={{ textAlign: m.remetente === 'consultor' ? 'right' : 'left', margin: '8px 0' }}>
            <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 10, background: m.remetente === 'consultor' ? '#d0112e' : '#e5e7eb', color: m.remetente === 'consultor' ? '#fff' : '#181818' }}>
              {m.texto}
            </span>
          </div>
        ))}
      </div>
      {erro && <p style={{ color: '#b3101f' }}>{erro}</p>}
      {!resultado ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} style={{ flex: 1, padding: 10 }} placeholder="Digite sua mensagem..." />
          <button onClick={enviar} style={{ padding: '10px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8 }}>Enviar</button>
          <button onClick={encerrar} style={{ padding: '10px 16px', background: '#181818', color: '#fff', border: 'none', borderRadius: 8 }}>Encerrar</button>
        </div>
      ) : (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2>Nota: {resultado.nota}/100</h2>
          <p>{resultado.feedback}</p>
        </div>
      )}
    </div>
  );
}
