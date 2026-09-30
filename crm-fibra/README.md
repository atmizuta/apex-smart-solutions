# CRM Fibra

App separado do painel de clientes existente, para consultores selecionados
trabalharem os segmentos de fibra e renovação. Ver
`docs/superpowers/specs/2026-09-25-crm-leads-fibra-renovacao-design.md` para
o desenho completo.

## Setup

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: do projeto Supabase
     "apex" (`mdgfboijyqfkggcrhptn`) — a **service role key**, não a anon key.
   - `CRM_FIBRA_SESSION_SECRET`: uma string aleatória de pelo menos 32
     caracteres.
3. Rode a migração (`db/schema.sql`) contra o projeto Supabase — ver Task 4
   do plano de implementação.
4. Crie o primeiro admin: adicione `SEED_ADMIN_NOME`, `SEED_ADMIN_USERNAME` e
   `SEED_ADMIN_SENHA` ao mesmo `.env.local` (o arquivo que já tem
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) e rode `npm run seed:admin`.

   Nota: se você não tiver a SUPABASE_SERVICE_ROLE_KEY à mão localmente, um admin também pode ser criado por uma inserção SQL direta na tabela `crm_fibra.consultores`, com a senha hasheada via bcrypt (12 rounds) antes de inserir — foi assim que o primeiro admin desta instância foi criado.

5. `npm run dev` e abra `http://localhost:3000/login`

## Testes

`npm test` roda todos os testes automatizados (Vitest).

## Checklist de verificação manual

Depois de rodar as migrações e o seed:

1. Abra `/dashboard` sem estar logado → deve redirecionar para `/login`.
2. Faça login com usuário/senha errados → mensagem de erro genérica, sem
   dizer se o usuário existe ou não.
3. Faça login com as credenciais do admin criado pelo seed → deve entrar em
   `/dashboard` e ver a topbar com seu nome e papel `admin`.
4. Vá em `/consultores`, crie um novo consultor (papel `consultor`).
5. Em outra aba/navegador anônimo, faça login com o novo consultor → deve
   entrar normalmente.
6. Volte pro admin, desative esse consultor em `/consultores`.
7. Na aba onde o consultor estava logado, recarregue qualquer página
   protegida (ex: `/dashboard`) **sem fazer logout manual** → deve
   redirecionar para `/login`, mesmo que o cookie de sessão dele ainda não
   tenha expirado. Isso confirma a checagem viva de `ativo` no banco
   (Task 10), não só a validade do token.
8. Tente acessar `/consultores` logado como um consultor comum (não admin)
   → deve redirecionar para `/dashboard`.
9. Clique em "Sair" → deve voltar para `/login` e qualquer página protegida
   volta a redirecionar.

## Leads & Carteira (Plano 2)

A segmentação (`crm_fibra.leads_segmentados`) lê `public.clientes` ao vivo —
não há cópia de dado. Se a base de clientes parecer errada (poucos
resultados, números estranhos), confirme com o time se `public.clientes`
está na sua versão correta antes de desconfiar do CRM Fibra.

### Checklist de verificação manual (além do checklist do Plano 1)

1. Logado como consultor, abra `/dashboard` → os 6 cartões devem mostrar
   números plausíveis (não zero, a menos que a base realmente esteja vazia).
2. Clique em qualquer cartão → deve ir para `/leads` já filtrado pela
   camada certa.
3. Em `/leads`, digite um texto de busca com vírgula e parênteses, por
   exemplo `Acme, (Ltda)` → a lista não deve quebrar nem retornar todos os
   resultados sem filtro.
4. Clique em um lead sem dono → deve aparecer o botão "Atribuir a mim".
   Clique nele → deve sumir o botão e aparecer o formulário de mensagem.
5. **Teste a disputa de atribuição:** com dois logins de consultor
   diferentes (duas abas anônimas), abram o mesmo lead sem dono e cliquem
   em "Atribuir a mim" quase ao mesmo tempo nas duas — um deve conseguir,
   o outro deve ver uma mensagem de erro clara (não travar, não duplicar
   o dono).
6. Escreva uma mensagem em branco (só espaços) e tente enviar pelo
   WhatsApp ou registrar ligação → deve aparecer erro, nada deve ser
   salvo.
7. Escreva uma mensagem de verdade e clique "Enviar pelo WhatsApp" → deve
   abrir uma aba nova do WhatsApp com o número e o texto certos, e a
   mensagem deve aparecer no histórico da página ao voltar.
8. Abra um lead cujo cliente não tenha telefone válido na base → deve
   aparecer o aviso de contato manual, não um botão de WhatsApp quebrado.
