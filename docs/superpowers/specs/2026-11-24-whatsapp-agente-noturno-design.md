# §167 Agente de IA no WhatsApp corporativo fora do expediente — design

Data: 24/11/2026 · Pedido do Rafael · Fase 1 (sem preço). Fase 2 (preços) = §167.1, depois de 1–2 semanas de conversas reais.

## 1. Objetivo

O WhatsApp corporativo é atendido por 4 consultores (Lúria, Caio, Mariana, Bianca) só no expediente. Quem escreve
depois das 21:12 ou no fim de semana espera até as 14h. O agente responde fora do expediente, coleta a ficha completa
do pedido e deixa tudo pronto no Meus leads. **Sucesso:** o consultor chega e o único trabalho é subir a venda no NEO.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Fase 1 | Coleta a ficha e tira dúvidas gerais. **Não fala preço, valor nem desconto.** |
| Conexão | WhatsApp Business no celular + **coexistência** com a Cloud API da Meta. Os 4 consultores continuam no WhatsApp Web (navegador). Limite da Meta: 4 aparelhos vinculados — exatamente os 4 de hoje; WhatsApp para Windows não funciona. |
| Horário | Responde **fora** do expediente do §146 (`config.leads_distribuicao.expediente` + `extras`). O expediente passa a ser seg–sex **14:00–21:12** (o motor do §146 também passa a começar às 14h). |
| Destino da ficha | Pelo telefone: lead existente → ficha no lead (dono mantido); telefone novo → lead novo `origem_entrada = 'whatsapp'`, distribuído pelo §146. |
| Arquitetura | Edge Function no Supabase + Claude API (abordagem 1). Não usar Managed Agents nem plataforma pronta. |
| Modelo | `claude-opus-5-5`, com o reserva do servidor para recusa (`fallbacks`). Troca de modelo só depois de comparar com conversas reais. |
| Áudio | Não transcreve. Pede para escrever; o áudio fica guardado para o consultor. |

## 3. Arquitetura e caminho da mensagem

```
Cliente → Meta (Cloud API, coexistência) → Edge Function whatsapp-webhook
   1. confere X-Hub-Signature-256 (chave do app da Meta)
   2. grava em wa_mensagens (wamid único) e baixa a mídia na hora para o bucket → responde 200
   3. fora do expediente: espera ~8 s; se chegou mensagem mais nova da mesma conversa, para (a mais nova responde)
   4. chama o agente (trava por conversa)
Agente (agente.ts, módulo puro): lê conversa + ficha → Claude com ferramentas → confere expediente de novo → envia pela Graph API
Cron wa-agente-tick (1 em 1 min): conversas fora do expediente com mensagem do cliente sem resposta → responde (rede de segurança)
```

Peças (no padrão do `leads-meta`: módulos puros testados + `index.ts` que liga ao Supabase):

- `supabase/functions/whatsapp-webhook/` — `index.ts` (GET de verificação `hub.challenge`; POST), `recebimento.ts`
  (assinatura, leitura do payload: texto, imagem, documento, áudio, outros, eco do consultor `smb_message_echoes`, status),
  `agente.ts` (laço do Claude + ferramentas por `deps`), `ficha.ts` (validação e regra de ficha completa), `telefone.ts`
  (casamento DDD + últimos 8 dígitos).
- `config.wa_agente`: `{"modo": "desligado" | "ensaio" | "ligado", "numeros_ensaio": [...], "max_respostas_noite": 40}`.
  Em `ensaio` só responde aos números da lista; o resto só é gravado. `desligado` para tudo sem redeploy.
- Mensagens do consultor (eco do WhatsApp Web) são gravadas como autor `consultor`: o agente usa como contexto e, se
  chegarem à noite, fica quieto naquela conversa até o próximo expediente.
- `leads_entrada2` passa a aceitar `p_origem = 'whatsapp'` (só a lista de origens muda; resto igual).
- Secrets novos da Edge Function (criados só com ok do Rafael): token da Cloud API, chave do app da Meta (assinatura),
  token de verificação do webhook, `ANTHROPIC_API_KEY`.

## 4. Comportamento do agente

**Apresentação:** sempre diz que é o assistente virtual da Apex (parceira Claro Empresas), que os consultores voltam às
14h e que já deixa o pedido pronto. Retoma a conversa se já houve contato; se o lead tem dono, cita o nome.

**Ficha** (1–2 perguntas por vez, frases curtas):

| Bloco | Campos | Regra |
|---|---|---|
| Sempre | nome completo, CNPJ, CPF, tipo de serviço | DV de CNPJ e CPF; CNPJ consultado (`verificar-cnpj`); baixada/inapta → alerta, não bloqueia |
| Linhas móveis | quantidade total (1–100) e, por parte, a modalidade | pode misturar modalidades |
| ↳ portabilidade | número de cada linha + fatura | obrigatórios |
| ↳ migração | número + fatura ou comprovante de recarga | sem documento → segue com alerta "sem comprovante" |
| ↳ linha nova | CEP + número do endereço | entrega do chip |
| Internet fixa | velocidade (`600`, `800`, `1000`, `mais`), CEP + número, CNH (foto ou digital) | CNH obrigatória; disponibilidade fica para o consultor |
| Outro interesse | descrição livre | consultor resolve |

**Documentos:** foto ou PDF até 10 MB. A visão do modelo só confere se é o documento certo e se está legível; **nenhum
dado do documento é extraído para texto**.

**Fim:** resumo da ficha para o cliente confirmar → estado `pronto` → "Às 14h o consultor te chama para confirmar os
valores e finalizar."

**Nunca:** preço/valor/desconto; prazo de instalação ou disponibilidade; senha, código de verificação, cartão ou banco;
dizer que é pessoa; responder dentro do expediente.

**`pedir_humano`:** reclamação, cancelamento, problema técnico de quem já é cliente, irritação, pedido de pessoa,
assunto fora do escopo, ou 40 respostas na noite. Avisa uma vez ("anotei, o consultor fala com você às 14h"), fica em
silêncio na conversa até o expediente e marca o lead.

**Áudio / figurinha / localização / contato / vídeo:** pede texto, foto ou PDF; o arquivo fica guardado.

**Ferramentas do modelo** (todas validadas no servidor, só na conversa atual; nenhuma de preço):
`salvar_ficha(campos)`, `verificar_cnpj(cnpj)`, `guardar_documento(mensagem_id, tipo)`, `pedir_humano(motivo)`,
`ficha_completa()` (recusa se faltar campo obrigatório).

## 5. Dados, painel e LGPD

- `wa_conversas`: telefone, `lead_aba`/`lead_id`, estado (`em_andamento` | `pronto` | `precisa_humano` | `encerrada`),
  `ficha` jsonb, `alertas` jsonb, respostas na noite, último horário do cliente / agente / consultor, silêncio até.
  Uma conversa nova quando a anterior está `pronto`/`encerrada` há mais de 24 h.
- `wa_mensagens`: `wamid` único, conversa, autor (`cliente` | `agente` | `consultor`), tipo, texto, caminho da mídia,
  recebida em, processada em.
- Bucket privado `wa-documentos`; leitura por link temporário via RPC que confere dono do lead ou gestor.
- RLS sem acesso direto; painel lê por RPC `security definer` (padrão das tabelas de leads).
- **Quando nasce o lead:** ficha com nome + CNPJ, ou nome + serviço. "Oi" solto não vira lead (protege a nota do §146).
- **Casamento:** DDD + últimos 8 dígitos do `phone_number` (wa_id de celular antigo pode vir sem o nono dígito);
  lead não apagado, o mais recente. Sem casamento → `leads_entrada2` com `id = 'wa:' || wamid da 1ª mensagem`.
- **Painel (Meus leads):** selo no card (📱 Pronto para subir / Em andamento / Precisa de humano); bloco "Ficha do
  WhatsApp" na ficha flutuante com campos na ordem do NEO, botões dos documentos e alertas. Só classes e variáveis do
  design atual (Sinal de Ápice), sem estilo novo.
- **Guarda:** documentos e mensagens apagados após 90 dias (cron). Logs da função sem nome, CPF, CNPJ ou telefone, só ids.

## 6. Erros e casos difíceis

| Caso | Tratamento |
|---|---|
| Claude falha/demora | 1 nova tentativa; depois mensagem fixa (1 vez por noite) + aviso; o tick tenta de novo |
| Recusa (`stop_reason = refusal`) | `fallbacks` do servidor; sem resposta → mensagem fixa + `precisa_humano` |
| Envio da Meta falha | aviso na faixa da Equipe (como `leads_dist_aviso`) |
| Reentrega da Meta | `wamid` único ignora |
| Dois disparos simultâneos | trava por conversa |
| Link da mídia expira (~5 min) | download no próprio webhook |
| Coexistência caiu (app sem abrir ~14 dias) | tick: nenhuma mensagem recebida há 48 h → aviso "abrir o WhatsApp Business no celular" |
| Resposta pronta depois que o expediente abriu | confere expediente antes de enviar; não envia |
| Consultor responde à noite | agente fica quieto na conversa |
| Manipulação ("ignore as regras…") | sem ferramenta de preço; validação no servidor; escopo só da conversa |

## 7. Testes

- Deno: assinatura; payloads (texto, imagem, documento, áudio, eco, status); junção de mensagens; DV de CPF/CNPJ;
  ficha completa por serviço; telefone com/sem nono dígito; silêncio após `pedir_humano` e após consultor; limite de 40.
- Agente com Claude falso (roteiros de ferramentas fixos).
- SQL `supabase/tests/wa_*_check.sql` (tudo desfeito): origem `whatsapp`, casamento com lead existente, permissão do
  documento (dono e gestor sim, outro consultor não).
- Painel `test_wa_ficha.js` (selo + bloco; conferir outra aba — divs balanceadas).
- ~20 roteiros com o Claude real (custa alguns reais; rodar só com ok): portabilidade de 2 linhas, fibra sem CNH,
  pedido de preço, cliente irritado, manipulação, áudio, serviços misturados. Critério: ficha final certa e nenhuma regra
  da seção 4 quebrada.

## 8. Implantação (cada etapa com ok do Rafael na hora)

0. Descobrir se a coexistência ativa direto pela Meta ou exige provedor (ex.: 360dialog); criar o app da Apex na Meta
   (no §137 quem envia é a agência — a Apex não tem app próprio); usar o número de teste gratuito da Meta.
1. Construir e testar no número de teste (número corporativo intocado).
2. Ativar a coexistência no número real num domingo/noite; religar os 4 navegadores; modo `ensaio` (só o celular do
   Rafael); conferir eco e sincronização.
3. Modo `ligado`; na 1ª semana Rafael e Lúria leem fichas e conversas toda manhã.
4. §167.1 (preços) a partir das conversas reais.

## 9. Fora do escopo (fase 1)

Preço e negociação; transcrição de áudio; consulta automática de disponibilidade de fibra; envio ativo (mensagem que
o cliente não pediu); atendimento dentro do expediente.

## 10. Pontos a confirmar na etapa 0

- Brasil liberado para coexistência e caminho de ativação (Meta direto × provedor).
- Mensagens enviadas pela API aparecem no WhatsApp Web dos consultores.
- Mensagens dos consultores chegam ao webhook como eco.
