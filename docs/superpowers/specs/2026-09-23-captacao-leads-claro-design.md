# Captação e Geração de Leads — Claro/Apex (B2B)

**Data:** 2026-09-23
**Responsável:** Rafael (desenvolvimento e planejamento)
**Escopo:** somente a frente Claro/Apex (Fibra + Móvel B2B). TIM/Eagle Sales fica fora, para um sub-projeto futuro.

## 1. Contexto

A Apex Smart Solutions é terceirizada autorizada pela Claro, vendendo planos,
portabilidade, internet fixa e produtos de internet para empresas (CNPJ). A
mesma operação também atua como filial da Eagle Sales (TIM) — leads que não
fecham com a TIM são reciclados para a Claro — mas essa frente está fora do
escopo deste documento.

Canais ativos hoje:
- Meta Ads (Instagram/Facebook), ~R$1.000/dia (~R$30k/mês)
- URA própria, ativada pontualmente (não roda contínua)

Funil atual: anúncio → formulário nativo do Meta Lead Ads (nome, CNPJ
sim/não, tipo de empresa, número do CNPJ, endereço+CEP em campo de texto
livre para os leads de Fibra) → lead cai automaticamente numa planilha e é
enviado por WhatsApp para um consultor.

Equipe: 5-6 consultores (Caio, Gabriel, Giovanna, Manuela, Rafael, Victoria)
recebendo os leads.

## 2. Diagnóstico

Baseado na planilha real de leads de setembro/2026 ("Leads CLARO B2B APEX"):

**Funil Móvel B2B** (não depende de viabilidade de endereço):

| Consultor | Leads | Convertidos | Taxa |
|---|---|---|---|
| Caio | 30 | 12 | 40% |
| Gabriel | 46 | 14 | 30% |
| Rafael | 34 | 11 | 32% |
| Giovanna | 36 | 4 | 11% |
| Manuela | 4 | 1 | 25% |
| Victoria | 4 | 0 | 0% |

Total: 154 leads, 42 convertidos (~27%). A variação de 11% a 40% entre
consultores com volume de lead parecido indica um problema de consistência
no atendimento, não (só) de qualidade do lead.

Maiores causas de perda no funil móvel: "cliente não responde" + "lead
parou de responder" somam ~26% dos leads; "cliente sem interesse no plano"
soma ~14%. Uma fração pequena mas real se perde por dado inválido: CNPJ
inapto, CNPJ reprovado, suspeita de fraude, lead fora do perfil (pessoa
física preenchendo como empresa).

**Funil Fibra** (depende de viabilidade técnica no endereço):

Em uma amostra de 24 leads, quase metade teve status "SEM VIABILIDADE" —
o endereço não é atendido pela infraestrutura da Claro. Isso só é
descoberto depois do clique no anúncio, preenchimento do formulário e
checagem manual do CEP pelo consultor (o campo de endereço é texto livre,
sem padronização).

**Causas-raiz identificadas:**

1. Parte do investimento em tráfego pago paga por leads que nunca
   poderiam fechar (endereço sem viabilidade, CNPJ inválido/inexistente) —
   isso só é descoberto depois que o lead já consumiu tempo de consultor.
2. Não existe script ou processo padrão de qualificação/resposta — cada
   consultor aborda do seu jeito, o que explica a variação de 11% a 40%
   na taxa de conversão.
3. Uma fatia grande de leads "esfria" ou some, mas não são
   necessariamente perdidos para sempre — hoje não existe um fluxo
   estruturado de retomada desses contatos.

## 3. Objetivo e critérios de sucesso

- Reduzir a fração de investimento em tráfego pago gasta em leads sem
  viabilidade técnica ou com CNPJ inválido.
- Reduzir a variação de taxa de conversão entre consultores (elevar o
  piso, não só a média) através de um processo padrão de qualificação e
  resposta.
- Recuperar parte dos leads "esfriados" com um fluxo de retomada
  estruturado, em vez de deixá-los morrer na planilha.
- Ganhar visibilidade real de quais campanhas/anúncios geram cliente de
  verdade (vs. apenas volume de lead).

## 4. Abordagem escolhida

**Camada de triagem automática pós-captura, mantendo o formulário nativo
do Meta Lead Ads, combinada com padronização do atendimento humano.**

Mantemos o formulário nativo (ele converte mais barato que uma landing
page própria) e adicionamos uma automação que dispara no instante em que
o lead é criado, antes de ele chegar a qualquer consultor:

1. Valida o CNPJ de verdade via API gratuita da Receita Federal —
   descarta/sinaliza automaticamente CNPJ inválido, inexistente ou
   "pessoa física" disfarçada de empresa.
2. Para leads de Fibra, consulta o portal de viabilidade que a Apex já
   usa hoje manualmente — classificando o lead como viável ou sem
   viabilidade antes de qualquer contato humano.
3. Classifica o lead automaticamente: **QUALIFICADO**, **SEM
   VIABILIDADE**, **CNPJ INVÁLIDO** ou **SUSPEITA DE FRAUDE**.
4. Roteia: leads qualificados vão para o WhatsApp do consultor com uma
   mensagem inicial pré-montada (personalizada com nome, empresa e
   necessidade informados no formulário, seguindo o script padrão —
   ver seção 5). Leads não qualificados vão para um fluxo separado de
   nutrição/descarte, sem consumir tempo de consultor.

Uma landing page própria (mais controle sobre os dados, mas custo por
lead mais alto e mais trabalho de implementação) fica registrada como
evolução futura, não como ponto de partida.

**Alternativa considerada e não escolhida agora:** padronizar apenas o
atendimento humano (script + SLA), sem automação. Mais rápido de
implementar (zero trabalho técnico) e ataca a maior variável isolada
(consultor), mas não resolve o desperdício de verba em lead sem
viabilidade ou CNPJ inválido — continua pagando pelo problema, só que
atendendo melhor.

## 5. Componentes

1. **Automação de triagem** (webhook disparado pela criação do lead no
   Meta Lead Ads — via Make/Zapier ou função própria).
2. **Validador de CNPJ** — API da Receita Federal (gratuita, já
   disponível).
3. **Checagem de viabilidade** — portal de viabilidade que a Apex já usa
   (confirmado disponível); avaliar se ele expõe alguma forma de consulta
   automatizável ou se a automação apenas dispara uma checagem rápida
   assistida.
4. **Motor de roteamento** — decide para qual consultor vai o lead
   qualificado (regra simples: round-robin ou fila).
5. **Script padrão de qualificação e resposta** — construído a partir do
   que o Caio (melhor taxa de conversão) já faz na prática, documentado e
   usado por todo o time.
6. **SLA de tempo de resposta** — meta definida (ex.: primeira mensagem
   em até 5 minutos) e comunicada ao time.
7. **Fluxo de retomada (repique)** — leads classificados como "não
   respondeu" ou "sem interesse no plano agora" entram numa fila de
   recontato depois de um tempo, em vez de serem esquecidos na planilha.
8. **Registro do status do lead** — continua na planilha atual por
   enquanto (a evolução para um CRM próprio é um sub-projeto separado,
   fora do escopo deste documento).

## 6. Fluxo

```
Anúncio (Meta Ads)
   -> Formulário nativo (Meta Lead Ads)
   -> Automação de triagem (dispara na criação do lead)
        -> Valida CNPJ (API Receita Federal)
        -> Se Fibra: consulta viabilidade (portal Claro)
        -> Classifica: QUALIFICADO / SEM VIABILIDADE / CNPJ INVÁLIDO / SUSPEITA DE FRAUDE
   -> QUALIFICADO: WhatsApp do consultor, mensagem inicial pré-montada, script padrão, SLA de resposta
   -> NÃO QUALIFICADO: fluxo de nutrição/descarte, não consome tempo de consultor
   -> Leads "esfriados" (não respondeu / sem interesse agora): fila de repique, recontato posterior
```

## 7. Tratamento de exceções

- API da Receita Federal fora do ar: lead segue para o consultor marcado
  como "CNPJ não verificado automaticamente", com checagem manual
  rápida como fallback.
- Portal de viabilidade não responde ou está fora do ar: mesmo fallback —
  lead marcado como "viabilidade pendente", checagem manual.
- Lead duplicado (mesmo CNPJ/telefone em curto intervalo): não gera novo
  disparo de mensagem, é anexado ao atendimento em andamento.

## 8. Como validar que está funcionando

- Percentual de leads "sem viabilidade" ou "CNPJ inválido" que hoje
  consomem tempo de consultor deve cair para perto de zero (filtrados
  antes do WhatsApp).
- Redução do gap de conversão entre consultores (hoje 11% a 40%).
- Percentual de leads recuperados via fluxo de repique.
- Custo por lead qualificado (não apenas custo por lead bruto) por
  campanha/anúncio — para saber quais campanhas realmente valem o
  investimento.

## 9. Fora de escopo (por enquanto)

- TIM / Eagle Sales (sub-projeto futuro).
- CRM completo e dashboards internos (sub-projeto futuro, "ferramental
  interno").
- Landing page própria substituindo o formulário nativo (evolução
  futura, não ponto de partida).

## 10. Guia de implementação (alto nível)

1. Confirmar os dois acessos-chave: API da Receita Federal (gratuita) e o
   portal de viabilidade da Claro — **já confirmados disponíveis**.
2. Construir o script padrão de qualificação e resposta com o Caio como
   referência (melhor taxa de conversão hoje), documentar e alinhar com
   o time.
3. Montar a automação ligando Meta Lead Ads → validação de CNPJ →
   checagem de viabilidade → classificação → roteamento para WhatsApp.
4. Definir e comunicar o SLA de tempo de resposta ao time.
5. Criar o fluxo de repique para leads não qualificados/esfriados.
6. Rodar um piloto em uma campanha antes de aplicar a todas.
7. Medir contra os critérios da seção 8 e ajustar.
