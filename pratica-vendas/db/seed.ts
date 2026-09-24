import { sql } from './client';
import { CENARIOS_INICIAIS } from '../lib/cenarios/dados';
import { gerarHashSenha } from '../lib/auth/senha';

async function seed() {
  // Falha alto e claro se a senha não for definida — o valor default antigo
  // ("troque-esta-senha") ficava visível no repositório e o app não tem
  // troca de senha, então a promessa "troque no primeiro login" nunca se
  // cumpria (achado na revisão final).
  const senhaAdmin = process.env.SEED_SENHA_ADMIN;
  if (!senhaAdmin) {
    throw new Error(
      'SEED_SENHA_ADMIN não configurada. Defina uma senha de admin antes de rodar o seed — ' +
        'não existe senha padrão por segurança (o app ainda não tem tela de troca de senha).'
    );
  }

  for (const cenario of CENARIOS_INICIAIS) {
    await sql`
      insert into cenarios (titulo, descricao, prompt_ia_cliente, categoria, nome_cliente, empresa_cliente)
      values (${cenario.titulo}, ${cenario.descricao}, ${cenario.promptIaCliente}, ${cenario.categoria}, ${cenario.nomeCliente}, ${cenario.empresaCliente})
      on conflict (titulo) do nothing
    `;
  }

  const senhaAdminHash = await gerarHashSenha(senhaAdmin);
  await sql`
    insert into usuarios (nome, usuario, senha_hash, papel)
    values ('Rafael', 'rafael', ${senhaAdminHash}, 'admin')
    on conflict (usuario) do nothing
  `;

  console.log('Seed concluído: cenários inseridos (idempotente), usuário admin "rafael" criado.');
  await sql.end();
}

seed().catch((e) => {
  console.error('Erro no seed:', e);
  process.exit(1);
});
