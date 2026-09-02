-- comentarios/schema.sql — a tabela de gatilhos do Instagram.
--
-- Uma linha por post: a palavra que dispara e a mensagem que vai na DM.
-- POST SEM LINHA NAO DISPARA NADA, e nao reclama (cicatriz de 25/ago/2026).
--
-- Isto ja morou numa ferramenta de tabela com grade e miniatura do post. Quando quem opera a
-- tabela passou a ser a IA, a miniatura deixou de pagar uma ferramenta a mais — e a tabela veio
-- para o mesmo banco do resto. Aqui a linha nasce no publicar.mjs, junto com o post.
--
-- Idempotente: roda quantas vezes quiser.

create schema if not exists instagram;

create table if not exists instagram.gatilho_post (
  post_id        text primary key,
  conta          text not null default '@seu_usuario',
  key_word       text,
  direct_message text,
  comment_reply  text,
  permalink      text,
  media_type     text,
  caption        text,
  publicado_em   timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table instagram.gatilho_post is
  'A promessa por post: comentou key_word, recebe direct_message na DM. Consultada pelo fluxo Agente Comentarios Instagram (n8n). Linha sem key_word e so cadastro do post — nao dispara nada.';
comment on column instagram.gatilho_post.key_word is
  'A palavra que dispara. Vazia = o post existe na tabela mas nao tem promessa ligada.';
comment on column instagram.gatilho_post.comment_reply is
  'Preenchido liga TAMBEM a resposta publica ("da uma olhada no direct"); vazio, sai so a DM.';
comment on column instagram.gatilho_post.permalink is
  'O unico endereco de midia que nao expira. media_url e thumbnail_url da Graph API morrem em horas — por isso nao sao guardados.';

create index if not exists idx_gatilho_post_com_palavra
  on instagram.gatilho_post (conta) where key_word is not null;

alter table instagram.gatilho_post enable row level security;

grant usage on schema instagram to service_role;
grant select, insert, update, delete on instagram.gatilho_post to service_role;

-- ponte para o node Supabase do n8n (PostgREST so enxerga public) — mesmo truque do ig_contato_dm
create or replace view public.ig_gatilho_post with (security_invoker = on) as
  select * from instagram.gatilho_post;

comment on view public.ig_gatilho_post is
  'Espelho de instagram.gatilho_post. Existe porque o node Supabase do n8n nao seleciona schema. View simples = atualizavel.';

grant select, insert, update, delete on public.ig_gatilho_post to service_role;

-- atualizado_em sozinho: quem escreve aqui e script e n8n, nenhum dos dois vai lembrar
create or replace function instagram.toca_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists tg_gatilho_post_atualizado on instagram.gatilho_post;
create trigger tg_gatilho_post_atualizado before update on instagram.gatilho_post
  for each row execute function instagram.toca_atualizado_em();
