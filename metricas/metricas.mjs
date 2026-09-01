// metricas.mjs — o desempenho do que já foi publicado, puxado da API na hora da pergunta.
//
//   node metricas/metricas.mjs                 # tudo que está em publicacoes/
//   node metricas/metricas.mjs <trecho>        # só os registros cujo nome bate com o trecho
//   node metricas/metricas.mjs --json          # saída crua, para outro script consumir
//
// Nada de número salvo em arquivo: métrica muda todo dia, e dado que envelhece em markdown
// vira mentira. O que está gravado é só o media_id — a chave que abre isto aqui.
import fs from 'node:fs';
import path from 'node:path';
import { carregarEnv, conta, chamar, morre } from '../_ig-api.mjs';
import { PUBLICACOES } from '../publicar/registro.mjs';

const argv = process.argv.slice(2);
const filtro = argv.find(a => !a.startsWith('--')) || '';
const comoJson = argv.includes('--json');

if (!fs.existsSync(PUBLICACOES)) morre(`Nada publicado ainda — ${PUBLICACOES} não existe.`);
const arquivos = fs.readdirSync(PUBLICACOES)
  .filter(f => f.endsWith('.json') && f.toLowerCase().includes(filtro.toLowerCase()))
  .sort();
if (!arquivos.length) morre(filtro ? `Nenhum registro com "${filtro}".` : 'Nenhum registro em publicacoes/.');

let c;
try { c = conta(carregarEnv(), argv); } catch (e) { morre(e.message); }

// insights variam por tipo: carrossel/foto não têm plays, reels não tem saved da mesma forma.
// Pede o conjunto amplo e mostra o que voltar — a API ignora o que não se aplica, mas às vezes
// devolve erro; nesse caso cai para o mínimo que todo tipo aceita.
const AMPLO = 'reach,likes,comments,shares,saved,views';
const MINIMO = 'reach';

const linhas = [];
for (const f of arquivos) {
  const reg = JSON.parse(fs.readFileSync(path.join(PUBLICACOES, f), 'utf8'));
  if (!reg.media_id) continue;
  let ins = await chamar(`${reg.media_id}/insights`, { token: c.token, params: { metric: AMPLO } })
    .catch(() => chamar(`${reg.media_id}/insights`, { token: c.token, params: { metric: MINIMO } }).catch(() => null));
  const m = Object.fromEntries((ins?.data || []).map(d => [d.name, d.values?.[0]?.value ?? 0]));
  linhas.push({ arquivo: f, tipo: reg.tipo, publicado_em: reg.publicado_em, permalink: reg.permalink, origem: reg.origem?.youtube || null, ...m });
}

if (comoJson) { console.log(JSON.stringify(linhas, null, 2)); process.exit(0); }

console.log(`\n📊  ${linhas.length} publicação(ões) em @${c.rotulo.toLowerCase()}\n`);
for (const l of linhas) {
  const num = k => (l[k] === undefined ? '—' : String(l[k]));
  console.log(`  ${l.publicado_em.slice(0, 10)}  ${(l.tipo || '').padEnd(10)} ${l.arquivo.replace(/\.json$/, '')}`);
  console.log(`     alcance ${num('reach')} · curtidas ${num('likes')} · comentários ${num('comments')} · salvos ${num('saved')} · views ${num('views')}`);
  if (l.permalink) console.log(`     ${l.permalink}`);
  if (l.origem) console.log(`     origem: ${l.origem}`);
  console.log();
}
