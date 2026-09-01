create schema if not exists instagram;

create table if not exists instagram.contato_dm (
  sender_id        text primary key,
  username         text,
  conta            text not null default '@seu_usuario',
  primeira_msg_em  timestamptz not null default now(),
  ultima_msg_em    timestamptz not null default now(),
  origem           text not null default 'dm',
  bot_ativo        boolean not null default true,
  menu_enviado_em  timestamptz,
  ultima_escolha   text,
  avisado_em       timestamptz,
  resumido_em      timestamptz,
  qtd_mensagens    integer not null default 1,
  notas            text
);

comment on table instagram.contato_dm is
  'Quem ja falou na DM. Bot so entra em sender_id inexistente (conversa nova). Alimenta o aviso por e-mail.';
comment on column instagram.contato_dm.origem is 'dm = chegou pelo webhook | pre-carga = conversa que ja existia no arranque';
comment on column instagram.contato_dm.bot_ativo is 'false = conversa assumida por humano, o bot nao responde mais';

create index if not exists idx_contato_dm_pendente_resumo
  on instagram.contato_dm (primeira_msg_em) where resumido_em is null;
create index if not exists idx_contato_dm_conta on instagram.contato_dm (conta);

alter table instagram.contato_dm enable row level security;

grant usage on schema instagram to service_role;
grant all on all tables in schema instagram to service_role;
alter default privileges in schema instagram grant all on tables to service_role;

-- ponte para o node Supabase do n8n (PostgREST so enxerga public)
create or replace view public.ig_contato_dm with (security_invoker = on) as
  select * from instagram.contato_dm;

comment on view public.ig_contato_dm is
  'Espelho de instagram.contato_dm. Existe porque o node Supabase do n8n nao seleciona schema. View simples = atualizavel (insert/update/delete passam para a tabela base).';

grant usage on schema instagram to anon, authenticated;
grant select, insert, update, delete on instagram.contato_dm to service_role;
grant select, insert, update, delete on public.ig_contato_dm to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 25/ago/2026 — o agente virou irmao do agente de WhatsApp.
-- Colunas de controle copiadas de benedetti.leads (Benedetti — Atendimento IA).
-- Aditivo: nenhuma linha das 198 existentes precisou ser migrada.
-- ═══════════════════════════════════════════════════════════════════════

alter table instagram.contato_dm
  add column if not exists bloqueado         boolean     not null default false,
  add column if not exists pausado_ate       timestamptz,
  add column if not exists classificacao     text,
  add column if not exists quente            boolean     not null default false,
  add column if not exists primeira_mensagem text,
  add column if not exists atualizado_em     timestamptz not null default now();

comment on column instagram.contato_dm.bloqueado is
  'true = o bot NUNCA atende. Familia, amigo, quem pediu pra nao receber. Independente de bot_ativo.';
comment on column instagram.contato_dm.pausado_ate is
  'Prazo da pausa. null com bot_ativo=false = pausa eterna (pre-carga / pediu humano). Data = volta sozinho depois dela.';
comment on column instagram.contato_dm.classificacao is
  'O que a pessoa e: lead | aluno | pessoal | parceiro | curioso | outro. Vem do botao clicado.';
comment on column instagram.contato_dm.quente is
  'true = pediu orcamento ou preco. Prioridade de resposta do <SEU NOME>.';
comment on column instagram.contato_dm.primeira_mensagem is
  'O que a pessoa escreveu antes de clicar em qualquer botao. Nunca se perde o texto original.';

-- A view precisa ser DERRUBADA e recriada: create-or-replace nao muda a lista de colunas.
-- pausa_ativa vem calculada daqui para o no IF do n8n nao ter logica na expressao
-- (e o mesmo truque do "Busca Lead" do Benedetti).
drop view if exists public.ig_contato_dm;
create view public.ig_contato_dm with (security_invoker = on) as
  select *,
         ((not bot_ativo) and (pausado_ate is null or pausado_ate > now())) as pausa_ativa
    from instagram.contato_dm;

comment on view public.ig_contato_dm is
  'Espelho de instagram.contato_dm + pausa_ativa calculada. Existe porque o node Supabase do n8n nao seleciona schema.';

grant select, insert, update, delete on public.ig_contato_dm to service_role;

-- ─── Os tres estados que importam ─────────────────────────────────────
--   bot_ativo=true                    -> o bot atende
--   bot_ativo=false, pausado_ate=null -> pausa eterna (os 197 da pre-carga)
--   bot_ativo=false, pausado_ate=data -> o <SEU NOME> respondeu; volta sozinho depois
--   bloqueado=true                    -> silencio absoluto, seja qual for o resto
--
-- Marcar alguem que o bot nunca deve atender:
--   update instagram.contato_dm set bloqueado = true where username = 'fulano';
