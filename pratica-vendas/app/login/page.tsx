'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const router = useRouter();

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
    <div style={{ maxWidth: 360, margin: '80px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
      <h1 style={{ fontSize: 20 }}>Prática de Vendas — Apex</h1>
      <form onSubmit={enviar}>
        <input placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)} style={{ width: '100%', padding: 10, marginBottom: 8 }} />
        <input placeholder="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} style={{ width: '100%', padding: 10, marginBottom: 8 }} />
        {erro && <p style={{ color: '#b3101f', fontSize: 13 }}>{erro}</p>}
        <button type="submit" style={{ width: '100%', padding: 10, background: '#d0112e', color: '#fff', border: 'none', borderRadius: 8 }}>Entrar</button>
      </form>
    </div>
  );
}
