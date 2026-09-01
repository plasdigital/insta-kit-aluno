// renovar-token.mjs — estende o token por mais 60 dias e grava no .env.local.
// Uso:  node renovar-token.mjs [CONTA]
// Só funciona com token LONG-LIVED e com pelo menos 24h de vida. Não precisa de App Secret.
import { carregarEnv, conta, chamar, gravarEnv, diasAte, morre } from './_ig-api.mjs';

const env = carregarEnv();
let c;
try { c = conta(env, process.argv.slice(2)); } catch (e) { morre(e.message); }

console.log(`\n🔄  renovando o token da conta ${c.rotulo} (vencia em ${c.expira || '?'})...`);

const r = await chamar('https://graph.instagram.com/refresh_access_token', {
  token: c.token, params: { grant_type: 'ig_refresh_token' },
}).catch(e => morre(
  e.message + '\n   Se o token já venceu, não há renovação: gere um novo em developers.facebook.com\n' +
  '   → app Webhookig → Instagram → API setup with Instagram login → 2. Generate token → cole no .env.local.'
));

const validade = new Date(Date.now() + r.expires_in * 1000).toISOString().slice(0, 10);
gravarEnv({ [`IG_${c.rotulo}_TOKEN`]: r.access_token, [`IG_${c.rotulo}_TOKEN_EXPIRA`]: validade });

console.log(`✅  token novo gravado no .env.local — vence em ${validade} (${diasAte(validade)} dias)`);
console.log(`    permissões: ${r.permissions}\n`);
