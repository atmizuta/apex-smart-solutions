'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { LogoApex } from '@/app/components/LogoApex';

export default function LoginPage() {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const router = useRouter();
  const marcaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const marcaAguaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = gsap.timeline();
    tl.fromTo(marcaAguaRef.current, { opacity: 0 }, { opacity: 0.05, duration: 1.2, ease: 'power1.out' }, 0)
      .fromTo(marcaRef.current, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.1)
      .fromTo(formRef.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.2);
  }, []);

  // Mostra o motivo quando o handoff de SSO (bolinha "Apex Mind" do painel)
  // falha e redireciona de volta pra cá. Lido direto de window.location em
  // vez de useSearchParams — esse hook exige um <Suspense> em volta pra não
  // quebrar `next build`, e essa é a única tela do app que precisaria dele.
  useEffect(() => {
    const erroSso = new URLSearchParams(window.location.search).get('erro');
    if (erroSso === 'sso_invalido') setErro('Não foi possível confirmar seu acesso automático. Faça login normalmente.');
    if (erroSso === 'sso_expirado') setErro('Esse link de acesso automático já foi usado ou expirou. Faça login normalmente.');
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const resposta = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json();
      setErro(dados.erro || 'Erro ao entrar.');
      return;
    }
    router.push('/cenarios');
  }

  return (
    <div
      className="tela-app"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div ref={marcaAguaRef} style={{ position: 'absolute', right: '6%', top: '50%', transform: 'translateY(-50%) scale(6)', opacity: 0, pointerEvents: 'none' }}>
        <LogoApex tamanho={160} />
      </div>

      <div style={{ width: '100%', maxWidth: 380, position: 'relative' }}>
        <div ref={marcaRef} style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex' }}>
            <LogoApex tamanho={40} />
          </div>
          <h1 style={{ color: 'var(--cor-branco)', fontSize: 22, marginTop: 14 }}>Apex Smart Solutions</h1>
          <p className="rotulo" style={{ marginTop: 4 }}>Prática de vendas</p>
        </div>

        <form ref={formRef} onSubmit={enviar} className="cartao" style={{ padding: 28 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--cor-tinta-suave)', marginBottom: 6 }}>Usuário</label>
          <input
            placeholder="seu.usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="campo"
            style={{ marginBottom: 16 }}
          />
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--cor-tinta-suave)', marginBottom: 6 }}>Senha</label>
          <input
            placeholder="••••••••"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="campo"
            style={{ marginBottom: erro ? 12 : 20 }}
          />
          {erro && (
            <p style={{ color: 'var(--cor-vermelho-600)', fontSize: 13, margin: '0 0 16px', fontWeight: 500 }}>{erro}</p>
          )}
          <button type="submit" className="btn btn-primario" style={{ width: '100%' }}>
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
