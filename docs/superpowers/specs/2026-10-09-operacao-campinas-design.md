# Operação Campinas — separação por operação no mesmo painel (fase 1: na tela)

Data: 09/10/2026 · Pedido do Rafael · REGRAS_NEGOCIO.md seção 78

## Objetivo
A Apex abriu uma segunda operação em Campinas (outro prédio, outro supervisor e outros consultores). O painel é o mesmo,
no mesmo link. O supervisor de Campinas e os consultores de lá veem só Campinas: o Dashboard de Produção inteiro (ranking,
Cadastro Diário, Visão Diária, Pedidos em Alerta, Vendas Perdidas). Quem é da Apex continua vendo só a Apex. Todos os admins
veem as duas operações, com um seletor "Operação Apex | Operação Campinas".

## Decisões
- **Fase 1 = separação só na tela** (hoje). O banco continua entregando a produção inteira para qualquer login, como antes.
  **Fase 2** leva a regra para o RLS e para as funções do banco.
- **Operação do login:** `profiles.operacao` (`apex` padrão | `campinas`). Só admin muda (trigger). Admin vê tudo.
- **Operação da venda:** a do vendedor, pelo vínculo `consultor_neo` (ID do NeoCRM -> login). O NeoCRM não separa operação
  (`nomeEquipe` vazio, `estruturaNome` = "apex" para todos). A função `vendedores_operacao()` devolve nome do NeoCRM -> operação.
  Vendedor sem vínculo = Apex.
- **Seletor** só para admin, no topo do Dashboard e do Fechamento (os dois andam juntos). Abre sempre na Apex.
- **Boletim da Manhã:** sempre da Apex (`bmFora`). Se o admin estava em Campinas quando o boletim precisa da conta da Visão
  Diária, o Dashboard volta para a Apex antes.
- **Funil:** supervisor vê só as propostas de consultores da própria operação; admin vê tudo.
- **Abas escondidas para Campinas** (dados ou gestão só da Apex, por enquanto): Mesa do Supervisor, Boletim, Digital
  (leads e Monitoramento) e Usuários. Ficam: Dashboard, Busca, Proposta, Funil, Biometria, Agenda, Anotações, Pedidos Parados.
- Ranniele, Vitória Priscila, Juan e Beatriz saem de `PRODUCAO_USUARIOS_EXCLUIDOS`: entraram lá em 06 e 08/10 porque
  achávamos que não eram da Apex; são de Campinas.

## Banco (migration `20261009200000_operacao_campinas.sql`, rollback em `supabase/rollback/`)
1. `profiles.operacao` + check + trigger `profiles_trava_operacao` (só admin muda).
2. `vendedores_operacao()` (security definer, só nome + operação).
3. Dados: Jaime admin -> supervisor; Jaime e os 4 consultores em `campinas`; vínculo dos 4 com o NeoCRM
   (103626 Vitória Priscila, 103627 Beatriz, 103628 Ranniele, 103629 Juan).

## Fora do escopo (próximas fases)
- RLS por operação (fase 2).
- Ligações (robô ProContact): os logins de Campinas já vêm no relatório de Chamadas Manuais (`Apex.beatrizS`, `apex.Juan`,
  `Apex.ranniele`, `Apex.vitoriaS`); falta separar por operação na Mesa, no Monitoramento e no Boletim.
- Boletim da Manhã de Campinas para o Jaime.


## Trava de cargo (aprovada pelo Rafael em 09/10)
Furo antigo: o usuário consegue mudar o próprio `role` em `profiles` (policy `profiles_update` + grant de coluna).
Migration `20261009210000_profiles_trava_role.sql`: trigger igual ao da operação — só admin muda cargo.

## Testes
`test_operacao_campinas.js` (filtros, seletor, abas, funil, boletim, falha do mapa) e `test_producao_filtro_pessoas.js`
atualizado. Bateria completa com `bash run_tests.sh`.
