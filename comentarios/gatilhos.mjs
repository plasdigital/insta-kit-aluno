#!/usr/bin/env node
// gatilhos.mjs — a promessa por post: comentou a palavra, recebe a DM.
//
//   node comentarios/gatilhos.mjs listar      [CONTA]
//   node comentarios/gatilhos.mjs ver         <post_id|url>
//   node comentarios/gatilhos.mjs set         <post_id|url> --palavra TEMPLATE --dm "..." [--resposta "..."] --confirmar
//   node comentarios/gatilhos.mjs tirar       <post_id|url> --confirmar
//   node comentarios/gatilhos.mjs sincronizar [CONTA] --confirmar
//
// Isto já foi um fluxo do n8n que importava os posts com a miniatura, para alguém olhar a grade.
// Vale a lição: se ninguém abre a tabela, a miniatura não paga uma ferramenta a mais. Com a IA
// operando o banco, importar posts é um comando — e é um fluxo a menos para dar manutenção.
//
// O caminho normal NÃO é este script: é o `publicar.mjs --gatilho`, que cria a linha na hora de
// publicar. Aqui é o backfill do que já estava no ar e o conserto de quem errou a palavra.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv, conta, chamar, morre } from '../_ig-api.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// A credencial do Supabase interno mora no hub-n8n-plas — mesma fonte do agente-dm/contatos.mjs.
// Não se duplica chave: um lugar só para revogar.
const ENV_SUPABASE = path.resolve(AQUI, '../.env.local');

function supabase() {
  if (!fs.existsSync(ENV_SUPABASE)) morre(`Sem credencial do Supabase (esperava ${ENV_SUPABASE}).`);
  const env = {};
  for (const l of fs.readFileSync(ENV_SUPABASE, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const url = env.SUPABASE_URL, chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) morre('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env.local.');
  // ig_gatilho_post é a VIEW em public: o PostgREST não enxerga o schema `instagram`.
  return { base: `${url.replace(/\/$/, '')}/rest/v1/ig_gatilho_post`, chave };
}

async function rest(caminho, opcoes = {}) {
  const { base, chave } = supabase();
  const r = await fetch(base + caminho, {
    ...opcoes,
    headers: {
      apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  const txt = await r.text();
  // LANÇA, não `morre`: o publicar.mjs importa daqui e chama isto DEPOIS de o post estar no ar.
  // Um process.exit() ali engoliria o aviso de que a promessa da legenda ficou sem gatilho.
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

/**
 * Aceita o id cru ou qualquer URL do Instagram. O shortcode do permalink NÃO é o media_id
 * (são numerações diferentes), então URL só resolve pelo que já está na tabela — e é por isso
 * que `sincronizar` vem antes de `set` no fluxo de trabalho.
 */
async function resolverPostId(entrada) {
  if (/^\d+$/.test(entrada)) return entrada;
  const m = entrada.match(/instagram\.com\/(?:p|reel|tv)\/([\w-]+)/);
  if (!m) morre(`"${entrada}" não é um post_id nem um link de post do Instagram.`);
  const achados = await rest(`?select=post_id,permalink&permalink=ilike.*${m[1]}*`);
  if (!achados.length) {
    morre(`Não achei o post ${m[1]} na tabela.\n   → rode antes: node comentarios/gatilhos.mjs sincronizar --confirmar`);
  }
  return achados[0].post_id;
}

/**
 * Escreve uma linha. Exportada: é o que o publicar.mjs chama com --gatilho.
 *
 * ⚠️ Não é upsert. O `Prefer: resolution=merge-duplicates` do PostgREST parece um merge, mas é um
 * INSERT que substitui a linha inteira: coluna que você não mandou volta para o DEFAULT. Cadastrar
 * um gatilho num post já sincronizado apagaria o `permalink`, o `caption` e o `media_type` dele.
 * Por isso: existe → PATCH (toca só no que veio); não existe → INSERT.
 */
export async function salvarGatilho(linha) {
  const [existente] = await rest(`?post_id=eq.${linha.post_id}&select=post_id`);
  if (existente) {
    const { post_id, ...campos } = linha;
    // Os dados do post (o que o `sincronizar` descobre) só entram se vieram preenchidos — null aqui
    // significa "não sei", não "apague". Já os três campos da PROMESSA passam mesmo nulos: é assim
    // que `set` sem `--resposta` desliga uma resposta pública que existia antes.
    const DESCOBERTOS = ['conta', 'permalink', 'media_type', 'caption', 'publicado_em'];
    for (const k of DESCOBERTOS) if (campos[k] == null) delete campos[k];
    const [atualizada] = await rest(`?post_id=eq.${post_id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(campos),
    });
    return atualizada;
  }
  const [criada] = await rest('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([linha]),
  });
  return criada;
}

// ---------------------------------------------------------------------------
// Daqui para baixo é a linha de comando. Importar este arquivo não dispara nada.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = (argv[0] || '').toLowerCase();
const opcao = n => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const tem = n => argv.includes(`--${n}`);
const corta = (s, n) => {
  if (!s) return '—';
  const t = String(s).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const ehModuloPrincipal = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ehModuloPrincipal) {
  // o corpo abaixo é top-level await: erro lançado pelo `rest` chega aqui como rejeição não tratada.
  // Traduz para a mensagem de uma linha do setor, em vez de despejar stack trace.
  process.on('unhandledRejection', e => morre(e?.message || String(e)));

  if (!cmd) {
    console.log('\nUso: listar · ver · set · tirar · sincronizar');
    console.log('  node comentarios/gatilhos.mjs listar');
    console.log('  node comentarios/gatilhos.mjs set <post_id|url> --palavra TEMPLATE --dm "texto" --confirmar');
    console.log('  node comentarios/gatilhos.mjs sincronizar PRINCIPAL --confirmar\n');
    process.exit(0);
  }

  if (cmd === 'listar') {
    const linhas = await rest('?select=*&order=criado_em.desc');
    const comGatilho = linhas.filter(l => l.key_word);
    console.log(`\n📋 ${linhas.length} posts na tabela · ${comGatilho.length} com gatilho ligado\n`);
    for (const l of comGatilho) {
      console.log(`   ${l.post_id}  ${(l.key_word || '').padEnd(12)}${corta(l.direct_message, 46)}`);
      console.log(`   ${' '.repeat(18)}  ${l.comment_reply ? 'público: ' + corta(l.comment_reply, 34) : 'só DM'}` +
        `  ·  ${l.permalink || "⚠️  sem link — rode: sincronizar"}`);
    }
    const sem = linhas.length - comGatilho.length;
    if (sem) console.log(`\n   + ${sem} post(s) cadastrado(s) sem palavra-chave — não disparam nada.`);
    console.log();
    process.exit(0);
  }

  if (cmd === 'ver') {
    if (!argv[1]) morre('Falta o post_id ou o link.');
    const id = await resolverPostId(argv[1]);
    const [l] = await rest(`?post_id=eq.${id}`);
    if (!l) morre(`Post ${id} não está na tabela — não dispara nada.`);
    console.log(`\n${l.permalink || l.post_id}`);
    console.log(`   palavra          ${l.key_word || '— (não dispara)'}`);
    console.log(`   resposta pública ${l.comment_reply || '— (só DM)'}`);
    console.log(`   DM               ${(l.direct_message || '—').replace(/\n/g, '\n                    ')}`);
    console.log(`   tipo             ${l.media_type || '—'} · cadastrado em ${(l.criado_em || '').slice(0, 10)}\n`);
    process.exit(0);
  }

  if (cmd === 'set') {
    if (!argv[1]) morre('Falta o post_id ou o link.');
    const palavra = opcao('palavra'), dm = opcao('dm'), resposta = opcao('resposta');
    if (!palavra) morre('Falta --palavra (a que a pessoa comenta).');
    if (!dm) morre('Falta --dm (o que ela recebe no direct).');
    const id = await resolverPostId(argv[1]);
    const [antes] = await rest(`?post_id=eq.${id}`);
    console.log(`\n📝 post ${id}${antes?.permalink ? `\n   ${antes.permalink}` : ''}`);
    if (antes?.key_word) console.log(`   ⚠️  já tinha o gatilho "${antes.key_word}" — vai ser substituído`);
    console.log(`   palavra          ${palavra}`);
    console.log(`   resposta pública ${resposta || '— (só DM)'}`);
    console.log(`   DM               ${dm.replace(/\n/g, '\n                    ')}`);
    if (!tem('confirmar')) { console.log('\n⏸️  NADA foi gravado. Repita com --confirmar.\n'); process.exit(0); }
    await salvarGatilho({ post_id: id, key_word: palavra, direct_message: dm, comment_reply: resposta || null });
    console.log('\n✅ gatilho no ar. Teste comentando de OUTRA conta — comentário próprio cai no filtro de eco.\n');
    process.exit(0);
  }

  if (cmd === 'tirar') {
    if (!argv[1]) morre('Falta o post_id ou o link.');
    const id = await resolverPostId(argv[1]);
    const [l] = await rest(`?post_id=eq.${id}`);
    if (!l?.key_word) morre(`Post ${id} não tem gatilho ligado.`);
    console.log(`\n🔌 desligar "${l.key_word}" do post ${id}${l.permalink ? `\n   ${l.permalink}` : ''}`);
    if (!tem('confirmar')) { console.log('\n⏸️  NADA foi mudado. Repita com --confirmar.\n'); process.exit(0); }
    // a linha FICA (o post continua cadastrado); só a promessa sai
    await rest(`?post_id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ key_word: null, direct_message: null, comment_reply: null }),
    });
    console.log('\n✅ desligado. O post continua na tabela, sem promessa.\n');
    process.exit(0);
  }

  if (cmd === 'sincronizar') {
    const env = carregarEnv();
    let c; try { c = conta(env, argv.slice(1)); } catch (e) { morre(e.message); }

    // ⚠️ Dois defeitos herdados do fluxo do n8n, consertados aqui:
    //   · `limit=1` — ele paginava UM post por chamada;
    //   · `comments_coun` — nome de campo cortado. A Graph API responde 200 e OMITE o campo em
    //     silêncio, sem erro nenhum (testado em 02/set/2026). Campo errado não reclama: some.
    // o @ de verdade, não o rótulo do .env: a coluna `conta` é para ler, e rótulo só existe aqui
    const eu = await chamar('me', { token: c.token, params: { fields: 'username' } }).catch(() => null);
    const username = eu?.username || c.rotulo.toLowerCase();

    const posts = [];
    let alvo = 'me/media';
    let params = { fields: 'id,caption,media_type,permalink,timestamp', limit: 100 };
    for (let pagina = 0; pagina < 20; pagina++) {
      const r = await chamar(alvo, { token: c.token, params });
      posts.push(...(r.data || []));
      if (!r.paging?.next) break;
      alvo = r.paging.next; params = null;   // o cursor já vem com tudo dentro
    }

    // A tabela inteira, não só os ids: assim dá para ver quem está desatualizado e quem virou órfã.
    const linhas = await rest('?select=*');
    const naTabela = new Map(linhas.map(l => [l.post_id, l]));
    const novos = posts.filter(p => !naTabela.has(p.id));

    // ⚠️ A primeira versão disto só cadastrava post NOVO, e linha antiga nunca era revisitada:
    // um post cadastrado à mão, incompleto, ficava incompleto para sempre — inclusive um COM
    // GATILHO LIGADO e sem `permalink`, que o `listar` não tinha como mostrar. Sincronizar não é
    // importar o que falta, é fazer os dois lados baterem. A PROMESSA
    // (key_word/direct_message/comment_reply) nunca é tocada aqui: ela é do dono, não da API.
    const descobertos = p => ({
      conta: username, media_type: p.media_type, permalink: p.permalink || null,
      caption: p.caption || null, publicado_em: p.timestamp || null,
    });
    const desatualizados = [];
    for (const p of posts) {
      const l = naTabela.get(p.id);
      if (!l) continue;
      // null da API é "não sei", nunca "apague" — mesma regra do salvarGatilho.
      // `publicado_em` compara como DATA: a Graph API devolve `+0000` e o Postgres normaliza para
      // `+00:00`, então comparar as duas strings marcaria TODO post como sujo, para sempre.
      const mudou = Object.entries(descobertos(p)).filter(([k, v]) => {
        if (v == null) return false;
        if (k === 'publicado_em') return !l[k] || new Date(l[k]).getTime() !== new Date(v).getTime();
        return String(l[k] ?? '') !== String(v);
      });
      if (mudou.length) desatualizados.push({ id: p.id, campos: Object.fromEntries(mudou) });
    }

    // Órfã: está na tabela e não está mais na conta (post apagado ou arquivado). NÃO se apaga
    // sozinha — com gatilho é promessa morta e a decisão é do dono; sem gatilho é lixo inofensivo.
    const naConta = new Set(posts.map(p => p.id));
    const orfas = linhas.filter(l => !naConta.has(l.post_id));

    console.log(`\n🔄 @${username}: ${posts.length} posts na conta · ${linhas.length} linhas na tabela`);
    console.log(`   ${novos.length} a cadastrar · ${desatualizados.length} a atualizar · ${orfas.length} órfã(s)`);
    for (const p of novos.slice(0, 10)) console.log(`   + ${p.id}  ${p.media_type.padEnd(16)}${p.permalink || ''}`);
    if (novos.length > 10) console.log(`   … e mais ${novos.length - 10}`);
    for (const d of desatualizados.slice(0, 10)) console.log(`   ~ ${d.id}  ${Object.keys(d.campos).join(', ')}`);
    if (desatualizados.length > 10) console.log(`   … e mais ${desatualizados.length - 10}`);
    for (const o of orfas) console.log(`   ! ${o.post_id}  não está mais na conta` +
      (o.key_word ? `  ⚠️  gatilho "${o.key_word}" apontando para o nada` : ''));
    if (!novos.length && !desatualizados.length) { console.log('\n✅ nada a fazer — a tabela já está em dia.\n'); process.exit(0); }
    if (!tem('confirmar')) { console.log('\n⏸️  NADA foi gravado. Repita com --confirmar.\n'); process.exit(0); }

    if (novos.length) {
      // upsert com merge: post que já existe NÃO perde a key_word que alguém cadastrou
      await rest('?on_conflict=post_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(novos.map(p => ({ post_id: p.id, ...descobertos(p) }))),
      });
    }
    // PATCH um a um, só nos campos que mudaram: merge-duplicates aqui apagaria a promessa
    for (const d of desatualizados) {
      await rest(`?post_id=eq.${d.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(d.campos),
      });
    }
    console.log(`\n✅ ${novos.length} cadastrado(s) · ${desatualizados.length} atualizado(s). Nenhum gatilho foi tocado.`);
    console.log('   Ligue um: node comentarios/gatilhos.mjs set <post_id> --palavra X --dm "..." --confirmar\n');
    process.exit(0);
  }

  morre(`Comando "${cmd}" não existe. Use: listar · ver · set · tirar · sincronizar`);
}
