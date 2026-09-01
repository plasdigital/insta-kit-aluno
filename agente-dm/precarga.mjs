import fs from 'node:fs';
import pg from 'pg';

const le = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_0-9]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim()])
);

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ig  = le(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local'));
const hub = ig;   // no kit as duas credenciais moram no mesmo arquivo

// O rótulo vem da linha de comando, senão da conta padrão do .env.local.
const ROTULO = (process.argv[2] || ig.IG_CONTA_PADRAO || 'TESTE').toUpperCase();
const MEU = ig[`IG_${ROTULO}_USER_ID`];
if (!MEU || !ig[`IG_${ROTULO}_TOKEN`]) {
  console.error(`\n❌ Conta "${ROTULO}" sem IG_${ROTULO}_USER_ID / IG_${ROTULO}_TOKEN no .env.local.\n`);
  process.exit(1);
}
let url = `https://graph.instagram.com/v23.0/me/conversations?fields=participants,updated_time&limit=50&access_token=${ig[`IG_${ROTULO}_TOKEN`]}`;
const contatos = [];
let pag = 0;

const espera = (ms) => new Promise(r => setTimeout(r, ms));
let falhas = 0;

while (url && pag < 60) {
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) {
    falhas++;
    console.error(`pagina ${pag + 1}: ${j.error.message} (tentativa ${falhas})`);
    if (falhas >= 4) { console.error('desisti da paginacao aqui'); break; }
    await espera(3000 * falhas);
    continue;
  }
  falhas = 0;
  await espera(700);
  for (const c of (j.data || [])) {
    const p = (c.participants?.data || []).find(x => x.id !== MEU);
    if (p) contatos.push({ id: p.id, username: p.username || null, quando: c.updated_time || null });
  }
  url = j.paging?.next || null;
  pag++;
}

console.log(`conversas lidas: ${contatos.length} em ${pag} pagina(s)`);

const c = new pg.Client({ connectionString: hub.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let n = 0;
for (const x of contatos) {
  const q = await c.query(
    `insert into instagram.contato_dm (sender_id, username, conta, origem, bot_ativo, primeira_msg_em, ultima_msg_em, notas)
     values ($1,$2,'@seu_usuario','pre-carga',false, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now()),
             'conversa que ja existia antes do bot')
     on conflict (sender_id) do nothing returning sender_id`,
    [x.id, x.username, x.quando]
  );
  n += q.rowCount;
}
const t = await c.query('select count(*) tot, count(*) filter (where username is not null) com_user from instagram.contato_dm');
console.log(`inseridos: ${n} | total na tabela: ${t.rows[0].tot} (com username: ${t.rows[0].com_user})`);
const am = await c.query('select username from instagram.contato_dm where username is not null order by ultima_msg_em desc limit 8');
console.log('mais recentes: ' + am.rows.map(r => '@' + r.username).join(', '));
await c.end();
