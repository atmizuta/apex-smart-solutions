# Ferramenta de Prática de Vendas com IA — Apex

**Data:** 2026-09-24
**Responsável:** Rafael (desenvolvimento e planejamento)
**Escopo:** capacitação de consultores via simulação de atendimento com IA, no canal WhatsApp. Fora de escopo: campanhas de renovação/upsell pra base de clientes existente, treinamento de ligação/URA.

## 1. Contexto

Sub-projeto da frente "capacitação de vendas" da Apex Smart Solutions (revenda
autorizada Claro B2B). Motivado pela variação real de conversão entre
consultores encontrada na análise da frente de captação de leads (11% a 40%
entre consultores com volume de lead parecido — ver
`docs/superpowers/specs/2026-09-23-captacao-leads-claro-design.md`), que
aponta falta de padrão no atendimento como a causa mais provável.

Esta ferramenta usa como rubrica de avaliação o guia de atendimento já escrito
(`docs/guides/2026-09-23-guia-atendimento-lead-claro.md`), que define a régua
de preço (ancoragem em 100GB/70GB) e o framework de resposta a objeções.

## 2. Objetivo e critérios de sucesso

- Consultor novo treina antes de atender lead real.
- Consultor já ativo pratica cenários difíceis sob demanda, sem precisar de
  sessão agendada com o Rafael.
- Rafael acompanha a evolução de cada consultor ao longo do tempo.
- Reduzir a variação de qualidade de atendimento entre consultores — mesmo
  objetivo da spec de captação de leads, atacado pelo lado do treinamento em
  vez da automação de triagem.

## 3. Abordagem escolhida

App web próprio (Next.js, hospedado na Vercel), **independente** do CRM que o
chefe do Rafael mantém — sem compartilhar banco de dados nem código com
aquele projeto. Banco de dados Postgres próprio. Toda chamada à API de IA
(Claude) acontece no servidor (rotas de API/server actions), nunca no
navegador, para a chave nunca ficar exposta ao consultor nem aparecer no
código publicado.

**Alternativas consideradas e não escolhidas:** uma página HTML única sem
login/histórico (mais rápida de construir, mas não atende o requisito de
acompanhar evolução por consultor); uma plataforma de roleplay de vendas
pronta (SaaS genérico, não incorpora as objeções e a régua de preço reais já
validadas com os dados da Apex, exigiria assinatura recorrente).

## 4. Componentes

1. **Login** — usuário/senha, sem depender de e-mail real (mesmo padrão já
   usado no CRM do chefe do Rafael, mas em banco separado).
2. **Seletor de cenário** — lista de situações pra praticar.
3. **Chat de simulação** — interface parecida com WhatsApp; a IA faz o papel
   do cliente, com uma "personalidade" (tom, resistência) por cenário.
4. **Motor de avaliação** — ao encerrar a conversa, uma chamada separada à IA
   lê a transcrição inteira e avalia contra a rubrica da seção 8, gerando
   nota e comentário específico.
5. **Painel do consultor** — histórico das próprias sessões e notas.
6. **Painel do admin (Rafael)** — visão agregada de todos os consultores e
   evolução ao longo do tempo.

## 5. Modelo de dados

| Tabela | Campos principais |
|---|---|
| `usuarios` | id, nome, usuario, senha_hash, papel (`consultor`/`admin`) |
| `cenarios` | id, titulo, descricao, prompt_ia_cliente, categoria |
| `sessoes_pratica` | id, usuario_id, cenario_id, iniciado_em, finalizado_em, nota, feedback |
| `mensagens` | id, sessao_id, remetente (`consultor`/`ia`), texto, criado_em |

## 6. Fluxo

```
Login
  -> Consultor escolhe um cenário
  -> Chat: IA responde no papel do cliente, seguindo a "personalidade" do cenário
  -> Consultor encerra a sessão
  -> Motor de avaliação lê a transcrição inteira e aplica a rubrica (seção 8)
  -> Nota + feedback salvos e mostrados na hora
  -> Sessão aparece no histórico do consultor e no painel do admin
```

## 7. Cenários iniciais

Baseados nas objeções e situações reais observadas na planilha de leads da
Apex (ver spec de captação de leads, seção 2):

- Cliente questionou o preço.
- Cliente sumiu no meio da negociação.
- CNPJ inválido descoberto durante a conversa.
- Sem viabilidade técnica no endereço (Fibra).
- Lead frio que só respondeu uma vez.

## 8. Rubrica de avaliação

Espelha o guia de atendimento (`docs/guides/2026-09-23-guia-atendimento-lead-claro.md`):

- Personalizou a abertura com nome, empresa e necessidade mencionados no cenário?
- Abriu pelo plano de 100GB ou 70GB, não pelo plano de entrada?
- Só desceu de plano porque o "cliente" (IA) questionou o valor, não de
  primeira?
- Evitou oferecer o plano regional de R$44,99/15GB?
- Fez uma pergunta de fechamento, não uma pergunta aberta?
- Tratou a objeção seguindo a lógica do guia (ex.: sem viabilidade não é
  "não", redirecionar pra linha móvel em vez de encerrar a conversa)?

## 9. Segurança e custo

- A chave de API fica só em variável de ambiente no servidor (`.env`, nunca
  commitada no git).
- **Nota de segurança:** durante o brainstorming, uma chave de API foi colada
  em texto puro no chat. Recomendado gerar uma chave nova e revogar a
  anterior antes de qualquer uso em produção.
- Limite de sessões de prática por consultor por dia (ex.: 10), para
  controlar custo de API e uso indevido.

## 10. Fora de escopo (por enquanto)

- Integração com o CRM do chefe do Rafael (avaliar depois, se fizer sentido).
- Treinamento de ligação/URA — esta v1 cobre só o canal WhatsApp (texto).
- Campanhas de renovação/upsell pra base de clientes existente.
