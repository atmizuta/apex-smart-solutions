# Verificar CNPJ na Receita (Meus leads) — design

Data: 29/10/2026 · Pedido: Rafael · Seção do REGRAS: **§127**

## 1. Objetivo

O consultor saber, antes de gastar ligação, se a empresa do lead está ativa ou baixada na Receita Federal. A verificação é **só quando alguém clica** no botão; nada roda sozinho.

Critério de sucesso: na ficha de um lead em aberto, um clique em "Verificar na Receita" mostra em 1–2 s a situação cadastral (com a data), e quem abrir o mesmo lead depois já vê o resultado salvo.

Fora do escopo: verificação automática na chegada, verificação em massa, selo nos cartões do Quadro/Lista, histórico de consultas, reconsulta periódica.

## 2. O que o consultor vê (ficha do lead)

Lugar: na linha do CNPJ da ficha (`.kbFichaOutros`, montada em `kbFichaHtml`), ao lado do "Copiar".

**Quando o botão aparece:** lead com CNPJ visível e coluna `novos`, `semlig`, `andamento` ou `semresp` (de `kbColunaDoLead`). Não aparece em `convertido`, `perdido` nem `livres` (no Livre o CNPJ só aparece depois de pegar o lead).

**Estados:**

| Estado | O que aparece |
|---|---|
| Nunca verificado | botão destacado **Verificar na Receita** |
| Consultando | botão vira "Consultando…" (desabilitado) |
| ATIVA | selo verde "Ativa na Receita · consultado DD/MM HH:MM" + link "Verificar de novo" |
| SUSPENSA | selo amarelo, mesmo formato |
| BAIXADA, INAPTA, NULA | selo vermelho + aviso (abaixo) |
| Não encontrado | selo vermelho "CNPJ não existe na Receita — confira com o cliente" |
| CNPJ sem 14 dígitos | "CNPJ inválido (N dígitos)", sem botão |
| Fora do ar / erro | "Não foi possível consultar agora. Tente de novo em alguns minutos." e o botão volta |

**Aviso (BAIXADA/INAPTA/NULA)**, no estilo `.kbFichaAviso` que a ficha já usa:

> ⚠ **Empresa BAIXADA na Receita desde 12/03/2024** (motivo: extinção por encerramento). Confirme com o cliente se ele tem outro CNPJ ativo antes de seguir. [Classificar como CNPJ INAPTO]

O atalho só **preenche** o status "CNPJ INAPTO" no Classificar da ficha; quem salva é o consultor. O lead **continua na fila** normalmente.

**Leitura ao abrir a ficha:** o painel busca em `cnpj_consultas` a linha do CNPJ do lead (uma consulta por ficha aberta) e mostra o selo se existir. O resultado vale para o CNPJ: o mesmo CNPJ em outro lead já aparece verificado.

Visual: só variáveis e classes do sistema Sinal de Ápice (cantos 8px; sem hex novo). Verde/amarelo/vermelho a partir das variáveis de estado já existentes.

## 3. Banco: tabela `cnpj_consultas`

Migration `supabase/migrations/20261029120000_cnpj_consultas.sql` — só `create table` / `create policy`, **sem DROP**, não mexe em tabela existente.

| coluna | tipo | nota |
|---|---|---|
| `cnpj` | text PK | só os 14 dígitos |
| `situacao` | text not null | `ATIVA`, `BAIXADA`, `INAPTA`, `SUSPENSA`, `NULA` ou `NAO_ENCONTRADO` |
| `situacao_desde` | date | data da situação cadastral |
| `motivo` | text | ex.: "Extinção por encerramento" |
| `razao_social` | text | |
| `fonte` | text not null | `brasilapi` ou `cnpjws` |
| `consultado_em` | timestamptz not null default now() | |
| `consultado_por` | uuid | `auth.users.id` de quem clicou |

Guarda só a última consulta (upsert pelo `cnpj`). RLS ligado: `select` para `authenticated`; nenhuma policy de escrita (só a Edge Function, com service role, grava). CNPJ e situação cadastral são dados públicos da Receita.

## 4. Edge Function `verificar-cnpj`

`supabase/functions/verificar-cnpj/`, publicada com `verify_jwt = true`. Lógica separada em módulo puro (`verificar.ts`, com dependências injetadas) e `index.ts` fino, no padrão da `sync-producao`/`mailing-api`.

Entrada: `{ lead_id }`. **Nunca recebe o CNPJ do painel.**

1. Valida o token no Auth (`auth.getUser`), como a `mailing-api`. Sem usuário → 401.
2. Lê o lead (service role) e o perfil de quem clicou. Pode verificar: o dono do lead (`dono_id`), supervisor ou admin. Senão → 403. Lead apagado ou inexistente → 404.
3. Normaliza o CNPJ do lead (só dígitos). Diferente de 14 dígitos → 422 `cnpj_invalido` (o painel já não mostra o botão, isto é defesa).
4. Se `cnpj_consultas` tem a linha com `consultado_em` há **menos de 10 minutos**, devolve ela sem consultar fora.
5. Consulta a **BrasilAPI** (`https://brasilapi.com.br/api/cnpj/v1/{cnpj}`, limite 8 s). Mapeia `descricao_situacao_cadastral`, `data_situacao_cadastral`, `descricao_motivo_situacao_cadastral`, `razao_social`. HTTP 404 → `NAO_ENCONTRADO`.
6. Se a BrasilAPI falhar (erro de rede, tempo, 5xx, 429), tenta a **publica.cnpj.ws** (`https://publica.cnpj.ws/cnpj/{cnpj}`, 8 s): `estabelecimento.situacao_cadastral`, `estabelecimento.data_situacao_cadastral`, `estabelecimento.motivo_situacao_cadastral.descricao`, `razao_social`. 404 → `NAO_ENCONTRADO`.
7. Resultado válido → upsert em `cnpj_consultas` e devolve `{ ok: true, consulta }`.
8. As duas falharam → **não grava nada**, devolve 503 `fora_do_ar`.

Situação é normalizada para maiúsculas sem acento (`Ativa` → `ATIVA`). Valor fora da lista → tratado como erro de resposta (não grava).

Log: só status, fonte e tempo — **nunca o CNPJ, a razão social ou o lead_id**. O repo é público: o código não leva nenhum CNPJ (os testes usam números fictícios gerados com dígito verificador).

## 5. Painel (`_template.html`)

- Funções puras novas (testáveis em `test_verificar_cnpj.js`): mostrar ou não o botão pela coluna; validar CNPJ; selo (classe + texto) por situação; texto do aviso com data em pt-BR e motivo; estado de erro.
- `kbFichaHtml` ganha o lugar do selo/botão na linha do CNPJ e o aviso.
- Ao abrir a ficha: busca `cnpj_consultas` pelo CNPJ (via `ppSeguro`) e preenche o selo.
- Clique: `sb.functions.invoke('verificar-cnpj', { body: { lead_id } })`; atualiza a ficha aberta com o resultado. Trocar de lead no meio da consulta não pinta o resultado no lead errado (confere o `lead_id` na volta).
- Atalho "Classificar como CNPJ INAPTO": seleciona a opção de status "CNPJ INAPTO" no Classificar da ficha (se existir em `kbEstado.opcoes`; senão o atalho não aparece) e marca a ficha como alterada, sem salvar.

## 6. Testes

- `test_verificar_cnpj.js` (node, padrão dos `test_*.js`): funções puras da seção 5.
- `supabase/functions/verificar-cnpj/verificar.test.ts` (Deno): 401/403/404/422; dono, supervisor e admin podem; cache < 10 min; BrasilAPI ok; BrasilAPI falha → cnpj.ws; 404 → NAO_ENCONTRADO; as duas falham → 503 sem gravar; situação desconhecida não grava; log sem CNPJ.
- Prévia com dados falsos mostrando todos os estados antes de publicar.

## 7. Ida ao ar (cada passo com ok do Rafael)

1. Aplicar a migration `cnpj_consultas` (execute_sql com begin/commit; policy por do-block "if not exists").
2. Publicar a Edge Function `verificar-cnpj` e testar com um lead real.
3. Publicar o painel (comparar com o ar, backup, MD5 no mesmo comando, vigia).
4. Registrar §127 no REGRAS_NEGOCIO.md e push no oficial (fetch antes, sem force).

Se a função ou a tabela faltarem, o painel mostra o estado de erro e a ficha segue funcionando; nada existente depende da tabela nova.
