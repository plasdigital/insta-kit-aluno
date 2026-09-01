// perfil.mjs — read-only: quem é a conta, como está o token e quanto sobra da cota de publicação.
// Uso:  node perfil.mjs [CONTA] [--midias] [--limite]
import { carregarEnv, conta, chamar, diasAte, morre } from './_ig-api.mjs';

const env = carregarEnv();
const argv = process.argv.slice(2);

let c;
try { c = conta(env, argv); } catch (e) { morre(e.message); }

const p = await chamar('me', {
  token: c.token,
  params: { fields: 'id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website' },
}).catch(e => morre(e.message));

console.log(`\n📷  @${p.username}  —  ${p.name || ''}`);
console.log(`    conta ${c.rotulo} · tipo ${p.account_type} · ${p.followers_count} seguidores · ${p.media_count} publicações`);
console.log(`    IG user id ${p.user_id}   (app-scoped ${p.id})`);
if (p.biography) console.log(`    bio: ${p.biography.replace(/\n/g, ' / ')}`);

const dias = diasAte(c.expira);
if (dias !== null) {
  const sinal = dias <= 0 ? '🔴 VENCIDO' : dias <= 7 ? '🔴' : dias <= 20 ? '🟡' : '🟢';
  console.log(`\n🔑  token ${sinal} vence em ${c.expira} (${dias} dias)`);
  if (dias <= 20) console.log('    → renove agora: node renovar-token.mjs ' + c.rotulo);
} else {
  console.log('\n🔑  token sem data de validade registrada no .env.local — rode `node renovar-token.mjs ' + c.rotulo + '`');
}

if (argv.includes('--limite') || argv.includes('--midias') === false) {
  const lim = await chamar(`${p.user_id}/content_publishing_limit`, {
    token: c.token, params: { fields: 'config,quota_usage' },
  }).catch(() => null);
  if (lim?.data?.[0]) {
    const d = lim.data[0];
    console.log(`\n📊  cota 24h: ${d.quota_usage} de ${d.config?.quota_total ?? 100} publicações usadas`);
  }
}

if (argv.includes('--midias')) {
  const m = await chamar('me/media', {
    token: c.token, params: { fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count', limit: 8 },
  }).catch(e => morre(e.message));
  console.log('\n🗂️  últimas publicações:');
  for (const x of m.data) {
    const quando = new Date(x.timestamp).toLocaleDateString('pt-BR');
    const legenda = (x.caption || '').replace(/\n/g, ' ').slice(0, 58);
    console.log(`    ${quando}  ${String(x.media_type).padEnd(13)} ♥${String(x.like_count ?? '-').padStart(4)}  ${legenda}`);
    console.log(`               ${x.permalink}`);
  }
}
console.log();
