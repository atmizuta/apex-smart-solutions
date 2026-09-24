import { sql } from './client';
import { CENARIOS_INICIAIS } from '../lib/cenarios/dados';
import { gerarHashSenha } from '../lib/auth/senha';

async function seed() {
  for (const cenario of CENARIOS_INICIAIS) {
    await sql`
      insert into cenarios (titulo, descricao, prompt_ia_cliente, categoria)
      values (${cenario.titulo}, ${cenario.descricao}, ${cenario.promptIaCliente}, ${cenario.categoria})
      on conflict do nothing
    `;
  }

  const senhaAdminHash = await gerarHashSenha(process.env.SEED_SENHA_ADMIN || 'troque-esta-senha');
  await sql`
    insert into usuarios (nome, usuario, senha_hash, papel)
    values ('Rafael', 'rafael', ${senhaAdminHash}, 'admin')
    on conflict (usuario) do nothing
  `;

  console.log('Seed concluído: cenários inseridos, usuário admin "rafael" criado (troque a senha no primeiro login).');
  await sql.end();
}

seed().catch((e) => {
  console.error('Erro no seed:', e);
  process.exit(1);
});
