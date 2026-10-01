# Plano 0 — Fundação: vínculo consultor × NeoCRM e privacidade por consultor

Spec: `docs/superpowers/specs/2026-09-30-painel-do-consultor-design.md` (seções 3.1, 3.2, 3.5, 4.1).
Pré-requisito dos planos 1, 2 e 3. **Nada aqui é aplicado em produção sem OK explícito do usuário.**

**Meta:** cada linha de `producao_pedidos_neo` sabe a quem pertence (`usuario_id`), cada perfil do painel aponta para um ID do NeoCRM, e o banco só entrega ao consultor os pedidos dele.

**Arquivos**
- Criar `supabase/migrations/20260930200000_consultor_neo.sql` (+ `supabase/rollback/20260930200000_consultor_neo_rollback.sql`)
- Criar `supabase/migrations/20260930210000_producao_rls_consultor.sql` (+ rollback)
- Modificar `supabase/functions/sync-producao/` (mapear `estruturaUsuarioId` → `usuario_id`)
- Modificar `_template.html` (editor de vínculos; troca do dashboard de equipe para a RPC) e `dashboard_tpl.py` se o iframe precisar de ajuste
- Criar `test_consultor_neo.js`; registrar em `run_tests.sh`
- Atualizar `REGRAS_NEGOCIO.md` (seção nova 53)

## Tarefa 1 — `usuario_id` nas linhas de produção (aditivo, sem risco)
- [ ] Migration: `alter table producao_pedidos_neo add column usuario_id bigint;` + índice `(usuario_id)`.
- [ ] Backfill a partir do bruto (sem chamar a API): `update producao_pedidos_neo n set usuario_id = (r.raw->>'estruturaUsuarioId')::bigint from producao_neo_raw r where r.item_id = n.item_id and n.usuario_id is null;`
- [ ] Conferir: `select count(*) from producao_pedidos_neo where usuario_id is null` = 0 e 19 IDs distintos (os 19 nomes de hoje).
- [ ] `sync-producao`: incluir `usuario_id` no mapeamento linha→tabela (mesmo ponto onde `nomeUsuario`→`usuario`). Teste de unidade da função de mapeamento com uma linha real anonimizada.
- [ ] Deploy da função (precisa OK) e conferir que a próxima sincronização horária grava `usuario_id` nas linhas novas/atualizadas.
- [ ] A VIEW `producao_pedidos` **não** expõe `usuario_id` ainda (mantém as colunas atuais); as RPCs usam a tabela.

## Tarefa 2 — tabela de vínculo + editor do admin
- [ ] Migration: `consultor_neo(profile_id uuid primary key references profiles(id) on delete cascade, neo_usuario_id bigint not null unique, atualizado_em timestamptz default now())`. RLS: select do próprio vínculo + admin/supervisor tudo; escrita só admin (reusar `get_my_role()`).
- [ ] RPC `neo_usuarios_detectados()` (admin): `usuario_id`, nome mais recente (`usuario`), nº de pedidos, último pedido, e se já está vinculado.
- [ ] Editor no painel (Configurações, só admin): tabela de perfis × seletor de ID do NeoCRM (mostra nome + nº de pedidos para conferir), com **sugestão automática por nome** (normalizar acento/caixa, comparar por prefixo e por primeiro+último nome) que o admin confirma com "Salvar vínculos". Reusar `.card`, `table.tbl`, `.field`, `.btn`, `mostrarAviso`.
- [ ] Teste jsdom: sugestão acerta Caio/Victoria/Mariana/Lucas/Bianca; **não** sugere automaticamente Gabriel (2 candidatos) nem Yasmin (sobrenome diferente); salvar duplicado (2 perfis no mesmo ID) mostra erro.
- [ ] Com o usuário na tela, conferir e salvar os vínculos reais (D6).

## Tarefa 3 — RPCs com filtro por dono
- [ ] Função auxiliar `meu_neo_usuario_id()` (SECURITY DEFINER, `set search_path = public`): `select neo_usuario_id from consultor_neo where profile_id = auth.uid()`.
- [ ] `producao_equipe()` (SECURITY DEFINER): linhas de **todos** com as colunas atuais do consultor, **sem `cliente`/`cnpj`**.
- [ ] `producao_meus_pedidos(p_consultor uuid default null)`: devolve as linhas **com cliente/CNPJ**; sem parâmetro → dono = `auth.uid()`; com parâmetro só se `get_my_role() in ('admin','supervisor')`, senão erro.
- [ ] `revoke all … from public; grant execute … to authenticated;` em todas.
- [ ] Testes SQL (script em `supabase/tests/` ou bloco comentado na migration), simulando papéis: consultor A chama `producao_meus_pedidos()` → só linhas do ID de A; consultor A chama com `p_consultor` de B → erro; consultor sem vínculo → zero linhas; admin com `p_consultor` → linhas de B; `producao_equipe()` nunca traz `cliente`/`cnpj`.

## Tarefa 4 — Fechar a leitura direta (D1; a parte de risco)
- [ ] **Antes:** backup do SQL das políticas atuais; rollback escrito e testado em branch do Supabase (`create_branch`) ou, no mínimo, com dry-run lendo as políticas.
- [ ] Migration: trocar `producao_neo_select` por `using (get_my_role() in ('admin','supervisor') or usuario_id = meu_neo_usuario_id())`.
- [ ] No mesmo release do painel: o carregamento do dashboard de equipe (`loadProducaoDashboard`, e o ponto da linha ~7055 da Visão Diária/Digital) passa a usar `producao_equipe()` quando `!producaoAdminMode()`; admin/supervisor continuam lendo a VIEW.
- [ ] Verificar cada tela do consultor: Visão Geral, Cadastro Diário, Visão Diária, ranking, Conversão. Nenhuma pode ficar vazia nem mudar de número.
- [ ] Ordem de publicação: (1) publicar o painel novo (já usa a RPC, funciona com a política antiga) → (2) aplicar a migration da política. Nunca o contrário.
- [ ] Teste de regressão `test_consultor_neo.js`: com `role='consultor'` o dashboard pede `producao_equipe` e não pede `cnpj`/`cliente`.

## Tarefa 5 — Documentação e entrega
- [ ] `REGRAS_NEGOCIO.md` seção 53 (vínculo por ID, quem vê o quê, como vincular um consultor novo, RPCs, rollback).
- [ ] `bash run_tests.sh` todo verde (pulados só os de planilha real).
- [ ] Publicação conforme CLAUDE.md: pedir autorização, comparar site × repo, backup, MD5; depois `git push origin main` (com autorização).
- [ ] Atualizar a memória do projeto (`reference_neosales_api_producao`: motivo de perda vem em `tagPedido`; `estruturaUsuarioId` é a chave do consultor).

**Critério de pronto:** o Caio, logado, não consegue — nem pela tela nem pela API do Supabase — ler cliente/CNPJ de pedido da Giovanna; o admin continua vendo tudo; nenhum número do dashboard mudou.
