# Aba "Consultar sócios" para o time de consultores (§157)

**Data:** 17/11/2026 · **Pedido:** Rafael ("agora quero fazer para o time inteiro de consultores") — fase 2 da §156.
**Seção do REGRAS:** §157 (próxima livre conferida no `oficial/main` e3792cb; conferir de novo com `git fetch` antes de escrever).
**Base:** §156 no ar (painel 46e2d380, oficial e3792cb, robô main fa64579). Spec da fase 1:
`docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md` — tudo que não for dito aqui segue a §156.
Repositórios públicos: nenhum CPF, CNPJ, nome, telefone, usuário ou senha real em código, teste, log ou commit.

## 1. Por que

A §156 deu a consulta de sócios (CPF e telefones) só na ficha da Renovação. O resto do time (aquisição, leads,
mailing, indicação) precisa do mesmo dado para qualquer empresa que esteja atendendo, não só para a carteira.

## 2. Decisões do Rafael (brainstorming de 17/11)

| Tema | Decisão |
|---|---|
| Formato | **Campo livre**: o consultor digita qualquer CNPJ e consulta |
| Quem | **Consultores da operação Apex** + admin/supervisor. O **time da Renovação não vê a aba** (continua só com a Renovação, §143.2; já tem a consulta na ficha) |
| Limite | **20 por pessoa por dia, somando com a Renovação** (uma contagem só, todas as origens) |
| Onde | **Aba nova "Consultar sócios"** no grupo **Vendas** do menu |
| Resultado guardado | Resultado da Nova Vida do mesmo CNPJ com **menos de 30 dias**, de qualquer consultor, aparece na hora sem gastar a Nova Vida |
| Limite e guardado | **Cada "Consultar" conta 1 das 20**, mesmo quando vem do guardado |
| Quem vê o quê | O consultor vê **só as consultas que ele mesmo fez**; cada consulta grava uma linha com quem pediu (registro LGPD) |
| Mesmo CNPJ ao mesmo tempo | O robô consulta **uma vez** e o resultado vale para todos os pedidos pendentes desse CNPJ |

## 3. Tela

- Campo **CNPJ** (aceita com ou sem pontuação; confere os 14 dígitos e o dígito verificador antes de chamar o banco) e
  botão **Consultar**. Enter também consulta.
- Depois de consultar, o bloco de resultado mostra:
  - cabeçalho com a **razão social** (da `mailing.empresa`, quando houver) e o CNPJ formatado;
  - os **mesmos estados e cartões da aba Sócios da Renovação** (§156: base da Receita, em andamento com relógio,
    Tentar de novo após 3 min pendente / 10 min consultando, pronto com cartões e telefones, sem sócios, erro), com o
    mesmo HTML (`rnSocioCartaoHtml`, `rnSociosBaseListaHtml`) e as mesmas classes (`rnSoc*`);
  - quando o resultado veio guardado: rodapé **"Consultado na Nova Vida em dd/mm hh:mm"** (data da consulta original) e
    botão **Atualizar** (consulta de novo na Nova Vida, ignorando o guardado; conta no limite).
- **"Minhas últimas consultas"**: as 20 mais recentes do consultor (razão social ou CNPJ, data, situação: pronto · N
  sócios / sem sócios / em andamento / erro). Clicar reabre o resultado **sem contar no limite**.
- Mensagens: CNPJ inválido ("Confira o CNPJ: os dígitos não batem."), limite ("Você já fez 20 consultas hoje. Amanhã
  libera de novo."), sem permissão ("A consulta de sócios é só para a operação Apex.").
- Releitura a cada 5 s só enquanto o pedido aberto estiver pendente/consultando e a aba estiver visível; para ao trocar
  de aba ou de usuário.

## 4. Banco

### 4.1 `socios_consultas` (já existe, §156) — acréscimos

- `origem`: novo valor `'avulsa'` (os existentes: `'renovacao'`, `'teste'`).
- Coluna nova `razao_social text null` (preenchida no insert a partir de `mailing.empresa`, quando houver).
- Coluna nova `copiado_de bigint null` → `socios_consultas(id)`: pedido cujo resultado foi reaproveitado (guardado).
- Policy nova (permissiva, soma com a da §156): **`select` se `pedido_por = auth.uid()`**.

### 4.2 RPC `socios_pedir_cnpj(p_cnpj text, p_atualizar boolean default false) returns jsonb` (`security definer`)

1. `auth.uid()` nulo, ou perfil fora de (`operacao = 'apex'` ou `role in ('admin','supervisor')`) → `{ok:false, motivo:'sem_permissao'}`.
2. Só dígitos; 14 dígitos e dígito verificador válido (função interna `socios_cnpj_valido(text)`) → senão `{ok:false, motivo:'cnpj_invalido'}`.
3. `pg_advisory_xact_lock(hashtext('socios:'||cnpj))` (o mesmo da §156).
4. Limite: pedidos de `auth.uid()` no dia de São Paulo (todas as origens) ≥ 20 → `{ok:false, motivo:'limite'}`.
5. `consultando` do CNPJ há mais de 10 min → `erro` ("A consulta não terminou.") — mesma regra da §156.
6. Se **não** `p_atualizar` e existe pedido do CNPJ `pronto`/`sem_socios` com `concluido_em` nos últimos 30 dias:
   insere linha do consultor (`origem 'avulsa'`, mesmo `status`/`resultado`, `concluido_em` = o original,
   `copiado_de` = id original) e devolve `{ok, id, status, guardado:true}`. Não dispara o robô.
7. Se existe pedido `pendente`/`consultando` do CNPJ (de qualquer pessoa): insere linha do consultor `pendente`
   (`disparado_em` = o do existente); se o existente está `pendente` com disparo há mais de 3 min, redispara.
   Devolve `{ok, id, status:'pendente'}`.
8. Senão: insere `pendente`, `disparado_em = now()`, chama `socios_disparar_robo()` (§156) e devolve `{ok, id, status:'pendente'}`.
9. Toda resposta `ok` leva também `base: {receita_mes, socios:[{nome,cpf,principal,obito}]}` (mesmo formato da
   `socios_da_base`, §156) e `razao_social`.

### 4.3 RPC `socios_base_do_pedido(p_id bigint) returns jsonb` (`security definer`, `stable`)

Para reabrir uma consulta da lista sem gastar limite: só se o pedido `p_id` for de `auth.uid()` (ou admin/supervisor) →
`{ok, razao_social, base:{…}}`; senão `{ok:false, motivo:'sem_permissao'}`.

### 4.4 Mesmo CNPJ ao mesmo tempo

- `socios_robo_pegar(p_max)` (§156) passa a pegar **um pedido por CNPJ** (o mais antigo) e marca **todos** os
  pendentes desse CNPJ como `consultando` (assim nenhum é pego de novo). Continua devolvendo só `{id, cnpj}` (um por CNPJ).
- Gatilho `after update` em `socios_consultas`: quando um pedido passa de `consultando` para `pronto`/`sem_socios`/`erro`,
  copia `status`, `resultado`, `erro` e `concluido_em` para os outros pedidos **do mesmo CNPJ** que estão
  `pendente`/`consultando` (com guarda de profundidade para não repetir).
- A Edge Function `ingest-socios` e o robô **não mudam**.

## 5. Painel

- Botão no `nav#tabsNav`, grupo **Vendas** (depois de "Funil"): `data-tab="socios"`, ícone de pessoas, rótulo
  "Consultar sócios", `data-sub="CPF e telefones dos sócios de qualquer CNPJ"`. Visível se `veAbasDaApex()` e **não**
  `rnSoRenovacao()`; escondido para operação Campinas.
- Painel `#panel-socios` com `.card`; funções com prefixo `sc*`; estado `scEstado = { pedido, base, razao, aviso, lista, timer }`.
- Reaproveita da §156: `rnSocioCartaoHtml`, `rnSociosBaseListaHtml`, `rnCpfFmt`, `rnFoneFmt`, os cliques de Copiar e
  WhatsApp/Ligar (delegados no novo painel), e o desenho dos estados (a lógica de estados é extraída para uma função
  comum usada pela ficha da Renovação e pela aba nova, sem mudar o que a Renovação mostra).
- Sem cor nova; layout com as classes `rnSoc*` e tokens existentes (`--radius-lg`, `--space-*`, `--c-linha`).

## 6. O que não muda

Aba Sócios da Renovação (§156) e a regra dela; robô, workflow e Edge Function; segredos; Base de Mailing (só leitura
de `mailing.empresa`/`mailing.socio` pelas RPCs).

## 7. Testes

- **Banco** (`supabase/tests/socios_avulsa_verificar.sql`, transação com rollback): Campinas barrado; CNPJ com DV
  errado barrado; limite somando Renovação + avulsa (20 → 21º barrado); guardado de 29 dias reaproveitado (sem disparo,
  `copiado_de` preenchido) e de 31 dias não; `p_atualizar` ignora o guardado; dois consultores no mesmo CNPJ pendente →
  `socios_robo_pegar` devolve 1 e marca os 2; resultado de um copia para o outro (gatilho); RLS: consultor vê só as
  próprias linhas avulsas; `socios_base_do_pedido` de pedido alheio barrado.
- **Painel** (`test_socios_aba.js`, jsdom, dados fictícios): visibilidade (Apex sim; Campinas não; time da Renovação
  não); DV inválido não chama o banco; resultado guardado aparece direto com "Consultado na Nova Vida em"; em andamento
  → pronto pela releitura; limite; lista "Minhas últimas consultas" e reabrir sem chamar `socios_pedir_cnpj`; trocar de
  aba para a releitura; a aba Sócios da Renovação continua passando (`test_renovacao_socios.js`).
- Suíte inteira antes de publicar, sem falha nova (CLAUDE.md).

## 8. Riscos

- **Volume maior na Nova Vida e no Actions**: um robô por vez (~15 s por CNPJ + ~35 s de partida). Com 20 por pessoa e o
  time todo, picos podem enfileirar alguns minutos. Mitigação: resultado guardado de 30 dias; rodada atende a fila inteira.
- **Varredura de CPFs**: limite de 20/dia por pessoa (todas as origens) + registro de cada consulta com quem pediu.
- Os da §156 (reCAPTCHA, termos de uso, mudança de visual do site, uso humano do usuário do robô).

## 9. Fora do escopo

Consulta em lote; relatório de quem consultou o quê para gestores (o dado fica no banco); consulta automática de leads
novos; Meus leads (botão na ficha); operação Campinas.
