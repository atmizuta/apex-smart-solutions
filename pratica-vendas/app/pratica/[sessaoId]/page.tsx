'use client';
import { use, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Nav } from '@/app/components/Nav';

type Mensagem = { remetente: 'consultor' | 'ia'; texto: string; dica?: string | null };
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
  const [resultado, setResultado] = useState<{ nota: number; feedback: string; dicas?: string[] } | null>(null);
  const [erro, setErro] = useState('');
  const fimDoChat = useRef<HTMLDivElement>(null);
  const mensagensRef = useRef<HTMLDivElement>(null);
  const resultadoRef = useRef<HTMLDivElement>(null);
  const notaRef = useRef<HTMLHeadingElement>(null);
  const qtdAnimadaRef = useRef(0);

  // Carrega o estado salvo ao abrir/recarregar a página — sem isso, um F5 no
  // meio da conversa mostrava um chat vazio, mesmo com mensagens já salvas
  // no banco (Review Focus).
  useEffect(() => {
    fetch(`/api/pratica/${sessaoId}`)
      .then((r) => r.json())
      .then((dados) => {
        setCenario(dados.cenario);
        setMensagens(dados.mensagens || []);
        if (dados.finalizado) setResultado({ nota: dados.nota, feedback: dados.feedback, dicas: dados.dicas });
      })
      .catch(() => setErro('Não foi possível carregar a conversa. Recarregue a página.'))
      .finally(() => setCarregando(false));
  }, [sessaoId]);

  useEffect(() => {
    fimDoChat.current?.scrollIntoView({ behavior: 'smooth' });
    // Anima só as bolhas novas (não redispara nas antigas a cada mensagem) —
    // dá vida ao chat sem re-animar o histórico inteiro a cada envio.
    if (!mensagensRef.current) return;
    const bolhas = mensagensRef.current.querySelectorAll('.bolha-mensagem');
    const novas = Array.from(bolhas).slice(qtdAnimadaRef.current);
    if (novas.length > 0) {
      gsap.fromTo(
        novas,
        { opacity: 0, y: 10, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'power2.out', stagger: 0.05 }
      );
    }
    qtdAnimadaRef.current = bolhas.length;
  }, [mensagens]);

  // Revelação do resultado: transcrição, card e nota entram em sequência, com
  // a nota contando de 0 até o valor final e as dicas surgindo em cascata —
  // é o momento mais importante da prática, merece um respiro visual.
  useEffect(() => {
    if (!resultado || !resultadoRef.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.fromTo('.transcricao-final', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' })
        .fromTo(
          '.card-resultado',
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
          '-=0.15'
        )
        .fromTo(
          '.dica-item',
          { opacity: 0, x: -8 },
          { opacity: 1, x: 0, duration: 0.3, stagger: 0.08, ease: 'power2.out' },
          '-=0.1'
        );
      if (notaRef.current) {
        const alvo = { valor: 0 };
        tl.to(
          alvo,
          {
            valor: resultado.nota,
            duration: 0.8,
            ease: 'power1.out',
            onUpdate: () => {
              if (notaRef.current) notaRef.current.textContent = `${Math.round(alvo.valor)}/100`;
            },
          },
          '-=0.3'
        );
      }
    }, resultadoRef);
    return () => ctx.revert();
  }, [resultado]);

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
      setMensagens((m) => [...m, { remetente: 'ia', texto: dados.resposta, dica: dados.dica }]);
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
    return (
      <div className="tela-app">
        <Nav />
        <div style={{ maxWidth: 640, margin: '0 auto', padding: 48, color: 'var(--cor-rosa-label)', fontSize: 14 }}>
          Carregando...
        </div>
      </div>
    );
  }

  return (
    <div className="tela-app" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Nav />
      <div
        style={{
          maxWidth: 640,
          width: '100%',
          margin: '0 auto',
          padding: '16px 20px',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {cenario && (
          <div className="cartao" style={{ background: 'var(--cor-vinho-900)', color: '#fff', padding: '12px 18px', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--fonte-display)', textTransform: 'uppercase', letterSpacing: '0.02em', fontSize: 15, fontWeight: 600 }}>
              {cenario.titulo}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--cor-rosa-label)', marginTop: 2 }}>
              {cenario.nomeCliente} — {cenario.empresaCliente}
            </div>
          </div>
        )}

        {resultado ? (
          // Conversa encerrada: nada mais rola independente aqui — a página
          // toda rola junto (transcrição + resultado), sem a caixa de chat
          // espremida competindo por altura com o card de resultado.
          <div ref={resultadoRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div className="cartao transcricao-final" style={{ padding: 18, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mensagens.map((m, i) => {
                const doConsultor = m.remetente === 'consultor';
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: doConsultor ? 'flex-end' : 'flex-start' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        maxWidth: '78%',
                        padding: '10px 14px',
                        borderRadius: 12,
                        fontSize: 14.5,
                        lineHeight: 1.45,
                        background: doConsultor ? 'var(--cor-tinta)' : 'var(--cor-papel-fosco)',
                        color: doConsultor ? '#fff' : 'var(--cor-tinta)',
                        border: doConsultor ? 'none' : '1px solid var(--cor-linha)',
                        borderBottomRightRadius: doConsultor ? 3 : 12,
                        borderBottomLeftRadius: doConsultor ? 12 : 3,
                      }}
                    >
                      {m.texto}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="cartao card-resultado" style={{ padding: 22 }}>
              <p className="rotulo" style={{ color: 'var(--cor-vermelho-600)', marginBottom: 4 }}>Resultado</p>
              <h2 ref={notaRef} style={{ fontSize: 26, color: 'var(--cor-tinta)' }}>0/100</h2>
              <p style={{ fontSize: 14.5, color: 'var(--cor-tinta-suave)', lineHeight: 1.6, marginTop: 10 }}>{resultado.feedback}</p>
              {resultado.dicas && resultado.dicas.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p className="rotulo" style={{ color: 'var(--cor-tinta-suave)', marginBottom: 8 }}>Pra melhorar</p>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {resultado.dicas.map((d, i) => (
                      <li key={i} className="dica-item" style={{ fontSize: 14, color: 'var(--cor-tinta)', lineHeight: 1.5 }}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              <a href="/cenarios" className="btn btn-primario" style={{ marginTop: 18, textDecoration: 'none' }}>
                Praticar outro cenário
              </a>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={mensagensRef}
              className="cartao"
              style={{
                padding: 18,
                marginBottom: 12,
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {mensagens.length === 0 && (
                <p style={{ color: 'var(--cor-tinta-suave)', fontSize: 13.5, margin: 'auto', textAlign: 'center' }}>
                  Comece a conversa — o cliente simulado responde a partir da sua primeira mensagem.
                </p>
              )}
              {mensagens.map((m, i) => {
                const doConsultor = m.remetente === 'consultor';
                return (
                  <div key={i}>
                    <div className="bolha-mensagem" style={{ display: 'flex', justifyContent: doConsultor ? 'flex-end' : 'flex-start' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          maxWidth: '78%',
                          padding: '10px 14px',
                          borderRadius: 12,
                          fontSize: 14.5,
                          lineHeight: 1.45,
                          background: doConsultor ? 'var(--cor-tinta)' : 'var(--cor-papel-fosco)',
                          color: doConsultor ? '#fff' : 'var(--cor-tinta)',
                          border: doConsultor ? 'none' : '1px solid var(--cor-linha)',
                          borderBottomRightRadius: doConsultor ? 3 : 12,
                          borderBottomLeftRadius: doConsultor ? 12 : 3,
                        }}
                      >
                        {m.texto}
                      </span>
                    </div>
                    {m.dica && (
                      <div className="bolha-mensagem" style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            maxWidth: '88%',
                            padding: '9px 14px',
                            borderRadius: 10,
                            fontSize: 13,
                            lineHeight: 1.45,
                            background: '#fdf6e3',
                            color: '#7a5b00',
                            border: '1px dashed #d9b23c',
                          }}
                        >
                          <span aria-hidden>💡</span>
                          <span>{m.dica}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={fimDoChat} />
            </div>

            {erro && (
              <p style={{ color: '#ffd7d7', background: 'rgba(227,6,19,0.18)', border: '1px solid rgba(227,6,19,0.4)', padding: '9px 14px', borderRadius: 8, fontSize: 13.5, marginBottom: 12, flexShrink: 0 }}>
                {erro}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && enviar()}
                disabled={enviando || encerrando}
                className="campo"
                style={{ flex: 1, background: 'var(--cor-papel)' }}
                placeholder="Digite sua mensagem..."
              />
              <button onClick={enviar} disabled={enviando || encerrando} className="btn btn-primario">
                {enviando ? 'Enviando...' : 'Enviar'}
              </button>
              <button onClick={encerrar} disabled={enviando || encerrando} className="btn btn-secundario">
                {encerrando ? 'Avaliando...' : 'Encerrar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
