# §147 Alterar o CNPJ do lead na ficha — design (10/11/2026)

Pedido do Rafael: "preciso que todos os consultores tenham uma opção de alterar o cnpj na ficha [...] na aba conferir
neo, alguns clientes sobem o cnpj errado ou acabam preferindo subir em outro cnpj".

## Problema

O lead se liga ao NEO pelo `leads.cnpj` (Conferir com NEO, venda no NEO na ficha, Kanban, Mesa de biometria,
comparativo do mailing, discador na linha do tempo). Quando o cliente digita o CNPJ errado no formulário ou fecha o
pedido em outro CNPJ, o lead fica preso como divergente ("Venda no painel sem pedido no NEO") e só dá para marcar
"Está certo", sem corrigir. Em 10/11: 147 de 2.139 leads com dono estão com CNPJ vazio ou com tamanho errado.

## Decisões (Rafael, 10/11)

- **Quem pode:** o dono do lead e os gestores (admin/supervisor). Lead livre, lead apagado e a agência: não.
- **CNPJ antigo:** é substituído em tudo. O antigo fica em `leads_cnpj_trocas` (antes, depois, motivo, quem, quando)
  e aparece no Histórico da ficha.
- **Validação:** só CNPJ de 14 dígitos com dígito verificador válido (no navegador e de novo no banco). Recusa igual ao
  atual e sequência repetida (000…, 111…).

## Tela (ficha do lead)

- Linha do CNPJ em "Outros": `CNPJ  12.345.678/0001-90  [Copiar] [Alterar]`. Sem CNPJ: `CNPJ — [Adicionar]`.
  O botão só aparece para quem pode alterar.
- "Alterar" abre um bloco logo abaixo: campo do CNPJ novo (aceita com ou sem pontuação, máscara ao digitar), motivo
  (Cliente digitou errado · Cliente fechou em outro CNPJ · Outro → texto de 3+ letras), Salvar e Cancelar. Erro na
  própria linha (CNPJ inválido, igual ao atual, sem motivo).
- Depois de salvar: aviso "CNPJ alterado", a linha mostra o novo, o selo da Receita (§128) recarrega para o novo, o
  Histórico ganha "Trocou o CNPJ" (de → para · motivo) e, se a Lista estiver na visão Conferir com NEO, ela recarrega.
  A ficha não é reaberta (o que a pessoa digitou na OBS fica).

## Banco (migration sem DROP)

- `leads_cnpj_valido(text) → boolean` (imutável): só dígitos, 14, não repetido, dois DVs do CNPJ.
- Tabela `leads_cnpj_trocas` (id, lead_aba, lead_id, antes, depois, motivo ≥ 3 letras, por, em). RLS ligado sem policy;
  só pelas funções.
- `leads_alterar_cnpj(p_aba, p_id, p_cnpj, p_motivo) → text` (secdef): valida motivo e CNPJ, acha o lead não apagado,
  confere permissão (lead sem dono → recusa para todos; com dono → gestor ou o próprio dono),
  recusa igual ao atual, grava 14 dígitos em `leads.cnpj`, registra a troca e chama `leads_espelho_enfileirar` (a
  planilha-espelho recebe o CNPJ novo). Devolve o CNPJ gravado. Execute só para `authenticated`/`service_role`.
- `leads_ficha_detalhes`: mais um `union all` com as trocas (tipo `cnpj`, título "Trocou o CNPJ", detalhe
  "antes → depois · motivo"). O resto da função fica igual ao que está no ar.
- Não muda: `leads_entrada2` já usa `on conflict do nothing` (a Meta e a planilha não desfazem a troca);
  `leads_historico` não é usado (a trava `acao` exigiria DROP do CHECK).

## Fora do escopo

- CNPJ alfanumérico (Receita, a partir de 07/2026): todo o cruzamento com o NEO usa só dígitos; fica para outra seção.
- Alterar CNPJ pela linha da Conferir com NEO (o clique na linha já abre a ficha).

## Testes

- `test_alterar_cnpj.js` (jsdom): validação/máscara, quem vê o botão, bloco abre/fecha, erros, chamada da RPC com
  dígitos, atualização da linha e recarga da Conferir com NEO.
- `supabase/tests/leads_alterar_cnpj_check.sql`: roda dentro de begin/rollback com usuários de teste (dono, outro
  consultor, gestor), confere permissões, validação, gravação, histórico e fila do espelho.
