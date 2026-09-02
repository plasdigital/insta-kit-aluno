// publicar.mjs — publica no Instagram (feed, carrossel, reels, story) pela Content Publishing API.
//
//   node publicar/publicar.mjs foto      <img>                 --legenda "texto|arquivo.md"
//   node publicar/publicar.mjs carrossel <pasta|a.png b.mp4..> --legenda "texto|arquivo.md"
//   node publicar/publicar.mjs reels     <video.mp4>           --legenda "..." [--capa <img>]
//   node publicar/publicar.mjs story     <img|video.mp4>
//
//   [CONTA]        rótulo do .env.local (padrão PRINCIPAL)
//   --confirmar    SEM ela nada é publicado: monta, mostra a prévia e para (regra do CLAUDE.md)
//   --agendar      só prepara o container e imprime o id (vale 24h)
//
//   --gatilho PALAVRA --dm "texto|arquivo.md" [--resposta "..."]
//                  liga a promessa do post na mesma hora: quem comentar PALAVRA recebe a DM.
//                  Sem isso o post nasce mudo — e post sem linha na tabela não dispara nada e
//                  não reclama (foi assim que o comentário de 25/ago/2026 se perdeu).
//
// Arquivo local é hospedado automaticamente (hospedar.mjs) — a Meta só aceita URL HTTPS pública.
import fs from 'node:fs';
import path from 'node:path';
import { carregarEnv, conta, chamar, dorme, morre } from '../_ig-api.mjs';
import { expandir, hospedarLocais } from './hospedar.mjs';
import { registrar, detectarProjeto } from './registro.mjs';
import { salvarGatilho } from '../comentarios/gatilhos.mjs';

const IMAGEM = ['.jpg', '.jpeg', '.png'];
const VIDEO = ['.mp4', '.mov'];
const argv = process.argv.slice(2);

function opcao(nome) {
  const i = argv.indexOf(`--${nome}`);
  return i === -1 ? null : argv[i + 1];
}
const tem = nome => argv.includes(`--${nome}`);

const env0 = carregarEnv();

// atalho: publicar um container já montado (`--agendar` devolve o id; vale 24h)
if (opcao('publicar-container')) {
  let cc; try { cc = conta(env0, argv); } catch (e) { morre(e.message); }
  const id = opcao('publicar-container');
  if (!tem('confirmar')) morre(`Isso publica o container ${id} em @${cc.rotulo.toLowerCase()} AGORA. Repita com --confirmar.`);
  // o container pode ter ido para ERROR depois de criado — sem isso o publish devolve só "Fatal"
  const st = await chamar(id, { token: cc.token, params: { fields: 'status_code,status' } })
    .catch(e => { console.log(`⚠️  não consegui conferir o estado do container (${e.message.split('\n')[0]}) — seguindo assim mesmo.`); return null; });
  if (st && st.status_code !== 'FINISHED') {
    morre(`O container ${id} está em ${st.status_code}, não dá para publicar.` +
      (st.status_code === 'ERROR'
        ? '\n   → carrossel: passou de 10 filhos, ou algum filho já tinha entrado em outro container. Monte de novo (as URLs hospedadas dá para reaproveitar).'
        : st.status_code === 'EXPIRED' ? '\n   → container vale 24h. Monte de novo.' : ''));
  }
  const r = await chamar(`${cc.userId}/media_publish`, { metodo: 'POST', token: cc.token, params: { creation_id: id } })
    .catch(e => morre(`Publicação recusada: ${e.message}`));
  const i = await chamar(r.id, { token: cc.token, params: { fields: 'permalink,media_type' } }).catch(() => null);
  console.log(`\n✅  publicado! id ${r.id}`);
  if (i?.permalink) console.log(`    ${i.permalink}`);
  // container montado em outra execução: registra o que dá para saber daqui (id, conta, permalink)
  const reg = registrar({
    conta: `@${cc.rotulo.toLowerCase()}`,
    tipo: (i?.media_type || 'container').toLowerCase(),
    mediaId: r.id, permalink: i?.permalink,
    extra: { container: id },
  });
  if (reg) console.log(`    📝 registro: ${path.relative(process.cwd(), reg)}`);
  console.log();
  process.exit(0);
}

const tipo = (argv[0] || '').toLowerCase();
if (!['foto', 'carrossel', 'reels', 'story'].includes(tipo)) {
  morre('Uso: node publicar/publicar.mjs <foto|carrossel|reels|story> <arquivo(s)|url(s)> [--legenda ...] [--confirmar]');
}

const env = env0;
let c;
try { c = conta(env, argv.slice(1)); } catch (e) { morre(e.message); }

// ---------- legenda ----------
/**
 * Arquivo de legenda dos outros setores costuma vir com contexto em volta (cabeçalho com formato e
 * origem, checklist de conferência). Só a seção "## Legenda" vai para o Instagram; sem ela, o arquivo
 * inteiro é a legenda. Nunca sobe heading markdown.
 */
function extrairLegenda(texto) {
  // `$(?![\s\S])` = fim do arquivo. NÃO usar `\Z`: em JavaScript isso não é âncora, é a letra
  // "Z" literal — e com a flag /i ele casava o primeiro "z" minúsculo do texto e cortava a
  // legenda ali (23/ago/2026: "eu parei de fa|zer..." virou uma legenda de 14 caracteres).
  const m = texto.match(/^##+\s*legenda\s*$([\s\S]*?)(?=^---\s*$|^##+\s|$(?![\s\S]))/im);
  const bruto = m ? m[1] : texto;
  return bruto
    .split('\n').filter(l => !/^#{1,6}\s/.test(l)).join('\n')
    // O Instagram NÃO renderiza markdown: `**assim**` sobe literal, com os asteriscos à mostra.
    // A legenda é escrita em .md por conveniência nossa — o que vai pro feed é texto puro.
    // (23/ago/2026, achado no dry-run dos três carrosséis que tinham negrito no meio.)
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)([\s\S]+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

let legenda = opcao('legenda') || '';
if (legenda && fs.existsSync(legenda)) {
  legenda = extrairLegenda(fs.readFileSync(legenda, 'utf8'));
}

// ---------- gatilho de comentário ----------
// Conferido AQUI, antes de hospedar e publicar: descobrir que faltou o `--dm` depois do post no ar
// significa uma promessa na legenda que ninguém cumpre.
const gatilho = opcao('gatilho');
let gatilhoDm = opcao('dm') || '';
if (gatilhoDm && fs.existsSync(gatilhoDm)) gatilhoDm = extrairLegenda(fs.readFileSync(gatilhoDm, 'utf8'));
if (gatilho && !gatilhoDm) morre('--gatilho sem --dm: a palavra dispara e não há o que enviar. Passe --dm "texto" ou um arquivo.');
if (gatilhoDm && !gatilho) morre('--dm sem --gatilho: não há palavra que dispare essa mensagem.');
if (gatilho && gatilhoDm.length > 1000) {
  morre(`A DM tem ${gatilhoDm.length} caracteres — o limite da API do Instagram é 1000 bytes.`);
}
if (legenda.length > 2200) morre(`Legenda com ${legenda.length} caracteres — o Instagram corta em 2200.`);
const hashtags = (legenda.match(/#\w+/g) || []).length;
if (hashtags > 30) morre(`${hashtags} hashtags — o limite do Instagram é 30.`);

// ---------- mídias ----------
const OPCOES_COM_VALOR = ['legenda', 'capa', 'conta', 'env', 'publicar-container', 'gatilho', 'dm', 'resposta'];
const entradas = argv.slice(1).filter((a, i, arr) => {
  if (a.startsWith('--')) return false;
  const anterior = arr[i - 1] || '';
  if (OPCOES_COM_VALOR.includes(anterior.replace(/^--/, ''))) return false;
  return !/^[A-Z][A-Z0-9_]*$/.test(a) || /[./\\]/.test(a);
});
if (!entradas.length) morre('Nenhuma mídia informada.');

const urls = [];
const locais = entradas.filter(e => !/^https?:\/\//.test(e));
const jaUrl = entradas.map(e => (/^https?:\/\//.test(e) ? e : null));
const arquivos = locais.length ? expandir(locais) : [];

// conferir a quantidade ANTES de hospedar — não faz sentido subir 12 arquivos para descobrir que cabem 10
const quantas = arquivos.length + jaUrl.filter(Boolean).length;
if (tipo === 'carrossel' && (quantas < 2 || quantas > 10)) {
  morre(`Carrossel aceita de 2 a 10 itens — recebi ${quantas}.` +
    (quantas > 10 ? `\n   → escolha 10 (ex.: slides/slide_0*.mp4) ou divida em ${Math.ceil(quantas / 10)} posts.` : ''));
}
if (tipo !== 'carrossel' && quantas > 1) morre(`"${tipo}" aceita uma mídia só — recebi ${quantas}.`);

let hospedadas = [];
if (arquivos.length) {
  console.log(`\n⬆️  hospedando ${arquivos.length} arquivo(s) para gerar URL pública...`);
  hospedadas = await hospedarLocais(arquivos);
  hospedadas.forEach((u, i) => console.log(`    ${path.basename(arquivos[i])} → ${u}`));
}
let iH = 0;
for (const u of jaUrl) urls.push(u ?? hospedadas[iH++]);
while (iH < hospedadas.length) urls.push(hospedadas[iH++]);

const ehVideo = u => VIDEO.some(x => u.toLowerCase().includes(x));
if (tipo === 'reels' && !ehVideo(urls[0])) morre('Reels precisa de vídeo (.mp4/.mov).');
if (tipo === 'foto' && ehVideo(urls[0])) morre('Use "reels" para vídeo no feed.');

// ---------- prévia ----------
console.log(`\n📤  ${tipo.toUpperCase()} em @${c.rotulo.toLowerCase()} (${urls.length} mídia${urls.length > 1 ? 's' : ''})`);
urls.forEach((u, i) => console.log(`    ${String(i + 1).padStart(2)}. ${ehVideo(u) ? '🎬' : '🖼️ '} ${u}`));
if (legenda) {
  console.log('\n────── legenda ──────');
  console.log(legenda);
  console.log(`────── ${legenda.length}/2200 caracteres · ${hashtags} hashtags ──────`);
}
if (gatilho) {
  console.log('\n────── gatilho de comentário ──────');
  console.log(`  comentou "${gatilho}"  →  recebe no direct:`);
  console.log(`  ${gatilhoDm.replace(/\n/g, '\n  ')}`);
  console.log(`  resposta pública: ${opcao('resposta') || '— (só DM)'}`);
  console.log('───────────────────────────────────');
} else if (/coment(a|e)\b|comenta[r]?\s|manda\s+["“]?[A-Z]{3,}/i.test(legenda)) {
  // a legenda promete e o post ia nascer mudo — a cicatriz de 25/ago em forma de aviso
  console.log('\n⚠️  a legenda parece pedir um comentário, mas você não passou --gatilho.');
  console.log('    Post sem linha na tabela não dispara nada, e não reclama.');
}
if (!tem('confirmar')) {
  console.log('\n⏸️  NADA foi publicado. Confira acima e repita o comando com --confirmar.\n');
  process.exit(0);
}

// ---------- containers ----------
const alvo = c.userId;

// ERROR de filho NAO e sempre terminal (20/ago): um container deu ERROR aqui e minutos
// depois estava FINISHED -- o post foi perdido a toa. So desiste depois de tres leituras
// seguidas de ERROR. EXPIRED continua terminal: esse nao volta.
const RECONFIRMAR = 3;

async function esperarPronto(id, rotulo) {
  let erros = 0;
  for (let i = 0; i < 60; i++) {
    const s = await chamar(id, { token: c.token, params: { fields: 'status_code,status' } });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'EXPIRED') morre(`${rotulo}: o container expirou (vale 24h). Monte de novo.`);
    if (s.status_code === 'ERROR') {
      if (++erros >= RECONFIRMAR) morre(`${rotulo}: o Instagram recusou a mídia (ERROR ${erros}x seguidas). ${s.status || ''}`);
      process.stdout.write(`
    ⚠️  ${rotulo}: ERROR — reconferindo ${erros}/${RECONFIRMAR}   `);
    } else {
      erros = 0;
      process.stdout.write(`
    ⏳ ${rotulo}: ${s.status_code}... (${i * 5}s)   `);
    }
    await dorme(5000);
  }
  morre(`${rotulo}: passou de 5 min processando — abortei antes de publicar.`);
}

async function container(params, rotulo) {
  const r = await chamar(`${alvo}/media`, { metodo: 'POST', token: c.token, params })
    .catch(e => morre(`${rotulo}: ${e.message}`));
  // CAROUSEL entra aqui de propósito: o pai também processa e também vai para ERROR
  // (ex.: mais de 10 filhos, ou filho já usado em outro carrossel) sem que o POST reclame.
  if (params.media_type === 'REELS' || params.media_type === 'VIDEO' || params.media_type === 'CAROUSEL' || params.video_url) {
    console.log(`\n    container ${rotulo} criado (${r.id}) — aguardando o Instagram processar o vídeo`);
    await esperarPronto(r.id, rotulo);
    process.stdout.write('\r                                             \r');
  }
  return r.id;
}

console.log('\n🛠️  criando container(s)...');
let idFinal;

if (tipo === 'carrossel') {
  const filhos = [];
  for (const [i, u] of urls.entries()) {
    const params = ehVideo(u)
      ? { media_type: 'VIDEO', video_url: u, is_carousel_item: true }
      : { image_url: u, is_carousel_item: true };
    filhos.push(await container(params, `item ${i + 1}/${urls.length}`));
  }
  idFinal = await container({ media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda }, 'carrossel');
} else if (tipo === 'reels') {
  idFinal = await container({
    media_type: 'REELS', video_url: urls[0], caption: legenda,
    ...(opcao('capa') ? { cover_url: opcao('capa') } : {}),
  }, 'reels');
} else if (tipo === 'story') {
  idFinal = await container(ehVideo(urls[0])
    ? { media_type: 'STORIES', video_url: urls[0] }
    : { media_type: 'STORIES', image_url: urls[0] }, 'story');
} else {
  idFinal = await container({ image_url: urls[0], caption: legenda }, 'foto');
}

if (tem('agendar')) {
  console.log(`\n📦  container pronto: ${idFinal}\n    publique em até 24h:  node publicar/publicar.mjs --publicar-container ${idFinal} --confirmar\n`);
  process.exit(0);
}

// ---------- publica ----------
const pub = await chamar(`${alvo}/media_publish`, { metodo: 'POST', token: c.token, params: { creation_id: idFinal } })
  .catch(e => morre(`Publicação recusada: ${e.message}`));

const info = await chamar(pub.id, { token: c.token, params: { fields: 'permalink,media_type,timestamp' } }).catch(() => null);
console.log(`\n✅  publicado! id ${pub.id}`);
if (info?.permalink) console.log(`    ${info.permalink}`);

// quem executa é quem registra: o id só existe aqui, e é ele que abre métrica e permalink depois
const projeto = detectarProjeto(arquivos[0]);
const reg = registrar({
  conta: `@${c.rotulo.toLowerCase()}`, tipo,
  mediaId: pub.id, permalink: info?.permalink, legenda,
  midias: arquivos.length ? arquivos : urls,
  projeto,
});
if (reg) console.log(`    📝 registro: ${path.relative(process.cwd(), reg)}`);
if (projeto?.roteiro) console.log(`    📝 roteiro.json de ${path.basename(projeto.pasta)}: campo "publicado" atualizado`);

// A linha do gatilho nasce AQUI, com o post. Depois de publicado: se a gravação falhar, o post já
// está no ar e ninguém desfaz isso — o erro é avisado alto e o comando de conserto vem junto.
if (gatilho) {
  try {
    await salvarGatilho({
      post_id: pub.id,
      conta: (await chamar('me', { token: c.token, params: { fields: 'username' } }).catch(() => null))?.username
        || c.rotulo.toLowerCase(),
      key_word: gatilho,
      direct_message: gatilhoDm,
      comment_reply: opcao('resposta') || null,
      permalink: info?.permalink || null,
      media_type: info?.media_type || null,
      caption: legenda || null,
      publicado_em: info?.timestamp || new Date().toISOString(),
    });
    console.log(`    🎯 gatilho "${gatilho}" no ar — quem comentar recebe a DM`);
  } catch (e) {
    console.log(`\n⚠️  O POST FOI PUBLICADO, mas o gatilho NÃO foi gravado: ${e.message}`);
    console.log(`    A legenda promete e ninguém cumpre. Grave agora:`);
    console.log(`    node comentarios/gatilhos.mjs set ${pub.id} --palavra ${gatilho} --dm "..." --confirmar\n`);
  }
}
console.log();
