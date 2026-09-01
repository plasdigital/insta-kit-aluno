#!/usr/bin/env node
/**
 * diagnostico.mjs — checa, uma a uma, as 5 famílias da API do Instagram numa conta.
 *
 *   node diagnostico.mjs TESTE
 *   node diagnostico.mjs PRINCIPAL --container   (também monta um container de teste, sem publicar)
 *
 * READ-ONLY por padrão. Nada é publicado, apagado ou respondido.
 * Use depois de conectar uma conta nova ou quando algo parar de funcionar:
 * ele diz qual permissão caiu, em vez de deixar o erro aparecer no meio de uma publicação.
 */
import { carregarEnv, conta, chamar } from './_ig-api.mjs';

const env = carregarEnv();
const c = conta(env, process.argv.slice(2));
const comContainer = process.argv.includes('--container');

console.log(`\n📷 conta ${c.rotulo} · IG user id ${c.userId}\n`);

let midiaId = null;
const testes = [];
const t = (fam, nome, fn) => testes.push({ fam, nome, fn });

t('basic', 'perfil', async () => {
  const r = await chamar('me', { token: c.token, params: { fields: 'id,username,account_type,followers_count,media_count' } });
  return `@${r.username} · ${r.account_type} · ${r.followers_count} seguidores · ${r.media_count} publicações`;
});

t('basic', 'mídias próprias', async () => {
  const r = await chamar('me/media', { token: c.token, params: { fields: 'id,media_type,like_count,comments_count,timestamp', limit: 3 } });
  if (!r.data?.length) return '(endpoint OK, conta ainda sem posts)';
  midiaId = r.data[0].id;
  return r.data.map(m => `${m.timestamp.slice(0, 10)} ${m.media_type} ♥${m.like_count} 💬${m.comments_count}`).join('\n     ');
});

t('publish', 'cota de publicação', async () => {
  const d = (await chamar(`${c.userId}/content_publishing_limit`, { token: c.token, params: { fields: 'quota_usage,config' } })).data[0];
  return `${d.quota_usage} de ${d.config?.quota_total ?? 100} publicações nas últimas 24h`;
});

t('comments', 'ler comentários do último post', async () => {
  if (!midiaId) return '(pulado — conta sem posts)';
  const r = await chamar(`${midiaId}/comments`, { token: c.token, params: { fields: 'id,text,timestamp,like_count,from{username}', limit: 3 } });
  if (!r.data?.length) return '(endpoint OK, post sem comentários)';
  return r.data.map(x => `@${x.from?.username ?? '?'}: ${x.text.slice(0, 60)}`).join('\n     ');
});

t('insights', 'métricas do último post', async () => {
  if (!midiaId) return '(pulado — conta sem posts)';
  const r = await chamar(`${midiaId}/insights`, { token: c.token, params: { metric: 'reach,likes,comments,saved,shares,views' } });
  return r.data.map(m => `${m.name}=${m.values?.[0]?.value ?? m.total_value?.value}`).join(' · ');
});

t('insights', 'métricas da conta (⚠️ exige 100+ seguidores)', async () => {
  const r = await chamar(`${c.userId}/insights`, { token: c.token, params: { metric: 'reach,profile_views,accounts_engaged', period: 'day', metric_type: 'total_value' } });
  return r.data.map(m => `${m.name}=${m.total_value?.value ?? m.values?.[0]?.value}`).join(' · ');
});

t('messages', 'caixa de DM', async () => {
  const r = await chamar(`${c.userId}/conversations`, { token: c.token, params: { platform: 'instagram', fields: 'id,updated_time', limit: 3 } });
  return r.data?.length ? `${r.data.length} conversa(s) · última em ${r.data[0].updated_time.slice(0, 10)}` : '(endpoint OK, caixa vazia)';
});

t('mentions', 'posts em que marcaram a conta', async () => {
  const r = await chamar(`${c.userId}/tags`, { token: c.token, params: { fields: 'id,username,permalink', limit: 3 } });
  return `${r.data?.length ?? 0} post(s)`;
});

if (comContainer) {
  t('publish', 'montar container (NÃO publica)', async () => {
    const m = await chamar('me/media', { token: c.token, params: { fields: 'id,media_type,media_url', limit: 5 } });
    const img = m.data?.find(x => x.media_type === 'IMAGE' || x.media_type === 'CAROUSEL_ALBUM');
    if (!img) return '(pulado — conta sem imagem para reaproveitar como URL de teste)';
    const alvo = img.media_type === 'CAROUSEL_ALBUM'
      ? (await chamar(`${img.id}/children`, { token: c.token, params: { fields: 'media_url,media_type' } })).data[0]
      : img;
    const cont = await chamar(`${c.userId}/media`, {
      metodo: 'POST', token: c.token,
      params: { image_url: alvo.media_url, caption: 'teste de container — não publicar' },
    });
    const st = await chamar(cont.id, { token: c.token, params: { fields: 'status_code' } });
    return `container ${cont.id} · status ${st.status_code} · ⛔ não publicado, expira sozinho em 24h`;
  });
}

let ok = 0, falhou = 0;
for (const { fam, nome, fn } of testes) {
  try {
    console.log(`✅ [${fam}] ${nome}\n     ${await fn()}\n`);
    ok++;
  } catch (e) {
    console.log(`❌ [${fam}] ${nome}\n     ${String(e.message).split('\n').join('\n     ')}\n`);
    falhou++;
  }
}
console.log(`${falhou ? '⚠️ ' : '🎉 '}${ok} teste(s) OK, ${falhou} falha(s).`);
