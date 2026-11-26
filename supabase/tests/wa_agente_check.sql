-- §167: conferência da migration 20261124120000 (agente do WhatsApp). Rodar no execute_sql depois da migration.
-- Termina com exceção de propósito: tudo é desfeito. DADOS FICTÍCIOS (DDD 00). Resultado na mensagem.
do $$
declare v jsonb; c uuid; c2 uuid; n int; t text; ok text[] := '{}'; v_exp boolean := public.leads_dist_no_expediente(now());
  v_cons uuid; v_outro uuid; v_admin uuid; v_aba text;
begin
  -- 1. chave do telefone (igual a telefone.ts)
  if public.wa_chave_tel('5511987654321') is distinct from '1187654321' or public.wa_chave_tel('551187654321') is distinct from '1187654321'
     or public.wa_chave_tel('5555991234567') is distinct from '5591234567' or public.wa_chave_tel('55991234567') is distinct from '5591234567'
     or public.wa_chave_tel('123') is not null then raise exception 'FALHOU 1'; end if;
  ok := ok || '1';
  -- 2. leads_entrada2 aceita 'whatsapp' (sem meta_visto_em); outra origem continua recusada
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'wa:zzcheck1', 'criado_em_lead', now(), 'full_name', 'Zz Check', 'phone_number', '5500900000001')), false, 'whatsapp');
  if (v ->> 'inseridos')::int <> 1 or not exists (select 1 from public.leads where id = 'wa:zzcheck1' and origem_entrada = 'whatsapp' and meta_visto_em is null)
    then raise exception 'FALHOU 2: %', v; end if;
  begin perform public.leads_entrada2('[]'::jsonb, false, 'outra'); raise exception 'FALHOU 2b';
  exception when sqlstate '22023' then null; end;
  ok := ok || '2';
  -- 3. wa_receber: cria a conversa, liga ao lead pelo telefone sem o nono dígito, não duplica o wamid
  v := public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'cliente', 'wamid', 'zzw1', 'telefone', '550000000001', 'nome_perfil', 'Zz', 'em', now(), 'formato', 'texto', 'texto', 'Oi')));
  select id into c from public.wa_conversas where telefone = '550000000001';
  if c is null or not exists (select 1 from public.wa_conversas where id = c and lead_id = 'wa:zzcheck1') then raise exception 'FALHOU 3: conversa/lead'; end if;
  if jsonb_array_length(v) <> (case when v_exp then 0 else 1 end) then raise exception 'FALHOU 3b: %', v; end if;
  v := public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'cliente', 'wamid', 'zzw1', 'telefone', '550000000001', 'formato', 'texto', 'texto', 'Oi')));
  select count(*) into n from public.wa_mensagens where wamid = 'zzw1';
  if n <> 1 or jsonb_array_length(v) <> 0 then raise exception 'FALHOU 3c: % %', n, v; end if;
  ok := ok || '3';
  -- 4. eco do consultor: grava como consultor; à noite silencia até o próximo expediente
  perform public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'eco', 'wamid', 'zzw2', 'telefone', '550000000001', 'formato', 'texto', 'texto', 'Já te chamo')));
  if not exists (select 1 from public.wa_mensagens where wamid = 'zzw2' and autor = 'consultor') then raise exception 'FALHOU 4'; end if;
  if not v_exp and not exists (select 1 from public.wa_conversas where id = c and silencio_ate > now()) then raise exception 'FALHOU 4a: sem silêncio'; end if;
  -- 4b. eco de uma mensagem que o agente já registrou não vira consultor
  update public.wa_conversas set silencio_ate = null where id = c;
  perform public.wa_registrar_envio(c, 'zzw3', 'Olá!', 'texto');
  perform public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'eco', 'wamid', 'zzw3', 'telefone', '550000000001', 'formato', 'texto', 'texto', 'Olá!'))); 
  if exists (select 1 from public.wa_conversas where id = c and silencio_ate is not null) or not exists (select 1 from public.wa_mensagens where wamid = 'zzw3' and autor = 'agente')
    then raise exception 'FALHOU 4b'; end if;
  if (select respostas_noite from public.wa_conversas where id = c) <> 1 then raise exception 'FALHOU 4c: contador'; end if;
  ok := ok || '4';
  -- 5. wa_salvar: só nome não cria lead; nome + serviço cria (telefone novo) com origem whatsapp e id wa:<1º wamid>
  perform public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'cliente', 'wamid', 'zzw10', 'telefone', '550000000077', 'formato', 'texto', 'texto', 'Oi')));
  select id into c2 from public.wa_conversas where telefone = '550000000077';
  perform public.wa_salvar(c2, '{"nome":"Zz Novo"}'::jsonb, '[]'::jsonb, null, null);
  if exists (select 1 from public.leads where id = 'wa:zzw10') then raise exception 'FALHOU 5: lead cedo demais'; end if;
  v := public.wa_salvar(c2, '{"nome":"Zz Novo","servicos":["fibra"]}'::jsonb, '[]'::jsonb, null, null);
  if v ->> 'lead_id' <> 'wa:zzw10' or not exists (select 1 from public.leads where id = 'wa:zzw10' and origem_entrada = 'whatsapp' and full_name = 'Zz Novo')
    then raise exception 'FALHOU 5b: %', v; end if;
  ok := ok || '5';
  -- 6. precisa_humano silencia até o próximo expediente; texto do próximo atendimento
  perform public.wa_salvar(c2, null, null, 'precisa_humano', 'quer cancelar');
  if not exists (select 1 from public.wa_conversas where id = c2 and estado = 'precisa_humano' and motivo_humano = 'quer cancelar' and silencio_ate > now())
    then raise exception 'FALHOU 6'; end if;
  if not public.leads_dist_no_expediente(public.wa_proximo_expediente(now())) then raise exception 'FALHOU 6b: próximo expediente'; end if;
  t := public.wa_quando_texto('2026-11-30 17:00:00+00'::timestamptz, '2026-11-28 23:00:00+00'::timestamptz);   -- seg 14h, visto num sábado 20h (SP)
  if t <> 'segunda-feira a partir das 14h' then raise exception 'FALHOU 6c: %', t; end if;
  t := public.wa_quando_texto('2026-11-25 17:30:00+00'::timestamptz, '2026-11-25 01:00:00+00'::timestamptz);   -- qua 14h30, visto ter 22h
  if t <> 'amanhã a partir das 14h30' then raise exception 'FALHOU 6d: %', t; end if;
  ok := ok || '6';
  -- 7. trava exclusiva; contexto no formato do agente
  if not public.wa_travar(c) or public.wa_travar(c) then raise exception 'FALHOU 7: trava'; end if;
  perform public.wa_liberar(c);
  v := public.wa_contexto(c);
  if v -> 'conversa' ->> 'id' <> c::text or jsonb_typeof(v -> 'mensagens') <> 'array' or v ->> 'proximo_expediente' is null
     or v ->> 'modo' is null or (v -> 'mensagens' -> 0 ->> 'id') <> 'zzw1' then raise exception 'FALHOU 7b: %', v; end if;
  if public.wa_ultima_do_cliente(c) <> 'zzw1' then raise exception 'FALHOU 7c'; end if;
  ok := ok || '7';
  -- 8. permissões da ficha e do documento: dono e gestor sim, outro consultor não
  select e.profile_id into v_cons from public.leads_equipe e join public.profiles p on p.id = e.profile_id where p.role not in ('admin', 'supervisor') order by e.id limit 1;
  select e.profile_id into v_outro from public.leads_equipe e join public.profiles p on p.id = e.profile_id where p.role not in ('admin', 'supervisor') and e.profile_id <> v_cons order by e.id limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select aba into v_aba from public.leads where id = 'wa:zzcheck1';
  update public.leads set dono_id = v_cons where id = 'wa:zzcheck1';
  insert into public.wa_mensagens (wamid, conversa_id, autor, formato, caminho, mime, em) values ('zzw20', c, 'cliente', 'imagem', 'm/zzw20.jpg', 'image/jpeg', now());
  perform public.wa_salvar(c, '{"nome":"Zz Check","documentos":[{"mensagem_id":"zzw20","tipo":"fatura"}]}'::jsonb, '["Zz alerta"]'::jsonb, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  v := public.wa_ficha(v_aba, 'wa:zzcheck1');
  if v -> 'documentos' -> 0 ->> 'caminho' <> 'm/zzw20.jpg' or v -> 'ficha' ? 'documentos' or v -> 'alertas' ->> 0 <> 'Zz alerta' then raise exception 'FALHOU 8: %', v; end if;
  if not public.wa_pode_ver_documento('m/zzw20.jpg') then raise exception 'FALHOU 8b'; end if;
  if not exists (select 1 from jsonb_array_elements(public.wa_selos()) s where s ->> 'lead_id' = 'wa:zzcheck1') then raise exception 'FALHOU 8c: selo'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  begin perform public.wa_ficha(v_aba, 'wa:zzcheck1'); raise exception 'FALHOU 8d: outro consultor viu';
  exception when sqlstate '42501' then null; end;
  if public.wa_pode_ver_documento('m/zzw20.jpg') then raise exception 'FALHOU 8e'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if public.wa_ficha(v_aba, 'wa:zzcheck1') is null or not public.wa_pode_ver_documento('m/zzw20.jpg') then raise exception 'FALHOU 8f: gestor'; end if;
  ok := ok || '8';
  -- 10. revisão I2: eco do agente chega ANTES do registro: volta a ser agente e não fica silenciado
  update public.wa_conversas set silencio_ate = null where id = c;
  perform public.wa_receber(jsonb_build_array(jsonb_build_object('tipo', 'eco', 'wamid', 'zzw4', 'telefone', '550000000001', 'formato', 'texto', 'texto', 'Oi de novo')));
  perform public.wa_registrar_envio(c, 'zzw4', 'Oi de novo', 'texto');
  if exists (select 1 from public.wa_conversas where id = c and silencio_ate > now()) or not exists (select 1 from public.wa_mensagens where wamid = 'zzw4' and autor = 'agente')
    then raise exception 'FALHOU 10'; end if;
  ok := ok || '10';
  -- 11. revisão I4: 3 falhas seguidas viram precisa_humano com silêncio; resposta normal zera
  update public.wa_conversas set falhas = 0, silencio_ate = null, estado = 'em_andamento' where id = c2;
  perform public.wa_adiar(c2); perform public.wa_adiar(c2);
  if exists (select 1 from public.wa_conversas where id = c2 and estado = 'precisa_humano') then raise exception 'FALHOU 11: cedo demais'; end if;
  perform public.wa_adiar(c2);
  if not exists (select 1 from public.wa_conversas where id = c2 and estado = 'precisa_humano' and falhas = 3 and silencio_ate > now()) then raise exception 'FALHOU 11b'; end if;
  ok := ok || '11';
  -- 12. revisão I6: extra de sábado (data fictícia 2030) — sex 22h aponta sáb 9h; sáb 17h aponta segunda no início da semana
  update public.config set valor = (valor::jsonb || jsonb_build_object('extras', coalesce(valor::jsonb -> 'extras', '{}'::jsonb) || '{"2030-01-05":{"inicio":"09:00","fim":"16:00"}}'::jsonb))::text where chave = 'leads_distribuicao';
  if public.wa_proximo_expediente('2030-01-04 22:00-03'::timestamptz) <> '2030-01-05 09:00-03'::timestamptz then raise exception 'FALHOU 12: %', public.wa_proximo_expediente('2030-01-04 22:00-03'::timestamptz); end if;
  if public.wa_proximo_expediente('2030-01-05 17:00-03'::timestamptz) <> ('2030-01-07 ' || (public.leads_dist_cfg() -> 'expediente' ->> 'inicio') || '-03')::timestamptz
    then raise exception 'FALHOU 12b: %', public.wa_proximo_expediente('2030-01-05 17:00-03'::timestamptz); end if;
  ok := ok || '12';
  -- 13. revisão C1: à noite, cliente que escreveu no expediente não entra no tick
  if not v_exp then
    update public.wa_conversas set silencio_ate = null, falhas = 0, falhou_em = null, trava_ate = null,
           ultimo_cliente_em = public.wa_proximo_expediente(now() - interval '1 day') + interval '1 minute' where id = c2;
    if public.leads_dist_no_expediente((select ultimo_cliente_em from public.wa_conversas where id = c2))
       and (public.wa_tick() -> 'pendentes') ? c2::text then raise exception 'FALHOU 13'; end if;
    ok := ok || '13';
  end if;
  -- 9. tick e limpeza rodam sem erro
  v := public.wa_tick();
  if v ? 'pendentes' is false then raise exception 'FALHOU 9: %', v; end if;
  perform public.wa_limpar_lista();
  ok := ok || '9';
  raise exception 'OK: % (expediente agora: %) — tudo desfeito', array_to_string(ok, ','), v_exp;
end $$;
