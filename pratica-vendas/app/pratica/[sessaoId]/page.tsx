'use client';
import { use, useEffect, useState } from 'react';
import { Nav } from '@/app/components/Nav';

type Mensagem = { remetente: 'consultor' | 'ia'; texto: string };
type CenarioInfo = { titulo: string; nomeCliente: string; empresaCliente: string };

// Next 16: params de página também chega como Promise — mesma ruling do Task 10.
export default function PraticaPage({ params }: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = use(params);
  const [carregando, setCarregando] = useState(true);
  const [cenario, setCenario] = useState<CenarioInfo | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [resultado, setResultado] = useState<{ nota: number; feedback: string } | null>(null);
  const [erro, setErro] = useState('');

  // Carrega o estado salvo ao abrir/recarregar a página — sem isso, um F5 no
  // meio da conversa mostrava um chat vazio, mesmo com mensagens já salvas
  // no banco (Review Focus).
  useEffect(() => {
    fetch(`/api/pratica/${sessaoId}`)
      .then((r) => r.json())
      .then((dados) => {
        setCenario(dados.cenario);
        setMensagens(dados.mensagens || []);
        if (dados.finalizado) setResultado({ nota: dados.nota, feedback: dados.feedback });
      })
      .catch(() => setErro('Não foi possível carregar a conversa. Recarregue a página.'))
      .finally(() => setCarregando(false));
  }, [sessaoId]);

  async function enviar() {
    if (!texto.trim() || enviando) return;
    setErro('');
    setEnviando(true);
    const textoEnviado = texto;
    setMensagens((m) => [...m, { remetente: 'consultor', texto: textoEnviado }]);
    setTexto('');

    try {
      const resposta = await fetch(`/api/pratica/${sessaoId}/mensagem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoEnviado }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.erro || 'Não foi possível enviar. Tente de novo.');
        return;
      }
      setMensagens((m) => [...m, { remetente: 'ia', texto: dados.resposta }]);
    } catch {
      setErro('Falha de conexão ao enviar a mensagem. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  async function encerrar() {
    if (encerrando) return;
    setErro('');
    setEncerrando(true);
    try {
      const resposta = await fetch(`/api/pratica/${sessaoId}/encerrar`, { method: 'POST' });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.erro || 'Não foi possível encerrar agora. Tente de novo em instantes.');
        return;
      }
      setResultado(dados);
    } catch {
      setErro('Falha de conexão ao encerrar. Tente de novo.');
    } finally {
      setEncerrando(false);
    }
  }

  if (carregando) {
    return <div style={{ maxWidth: 600, margin: '40px auto', padding: 16 }}>Carregando...</div>;
  }

  return (
    <div>
      <Nav />
      <div style={{ maxWidth: 600, margin: '20px auto', padding: 16 }}>
      {cenario && (
        <div style={{ background: '#1a0302', color: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>{cenario.titulo}</div>
          <div style={{ fontSize: 12.5, color: '#e8b9b9' }}>{cenario.nomeCliente} — {cenario.empresaCliente}</div>
        </div>
      )}
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
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar()}
            disabled={enviando || encerrando}
            style={{ flex: 1, padding: 10 }}
            placeholder="Digite sua mensagem..."
          />
          <button onClick={enviar} disabled={enviando || encerrando} style={{ padding: '10px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, opacity: enviando || encerrando ? 0.6 : 1 }}>
            {enviando ? 'Enviando...' : 'Enviar'}
          </button>
          <button onClick={encerrar} disabled={enviando || encerrando} style={{ padding: '10px 16px', background: '#181818', color: '#fff', border: 'none', borderRadius: 8, opacity: enviando || encerrando ? 0.6 : 1 }}>
            {encerrando ? 'Avaliando...' : 'Encerrar'}
          </button>
        </div>
      ) : (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2>Nota: {resultado.nota}/100</h2>
          <p>{resultado.feedback}</p>
          <a href="/cenarios" style={{ color: '#d0112e', fontWeight: 600 }}>Praticar outro cenário</a>
        </div>
      )}
      </div>
    </div>
  );
}
