// boletim.mjs — o retrato da semana no Instagram, puxado da API na hora.
//
//   node metricas/boletim.mjs                 # últimos 7 dias da conta padrão, em markdown
//   node metricas/boletim.mjs PRINCIPAL --dias 7  # conta e janela explícitas
//   node metricas/boletim.mjs --json          # saída crua, para o n8n ou outro script consumir
//   node metricas/boletim.mjs --md saida.md   # grava o markdown num arquivo além de imprimir
//
// Modo VPS (não bate na API de novo — renderiza o que já foi coletado):
//   node metricas/boletim.mjs --de dados.json                        # remonta o markdown do JSON
//   node metricas/boletim.mjs --de dados.json --leitura texto.txt \
//                    --html corpo.html                      # com a leitura da IA, em HTML pro e-mail
//
// READ-ONLY: só GET. Não publica, não responde, não apaga — dá para rodar sem medo.
//
// Duas pegadinhas da API que este script já resolve (ver CAPACIDADES.md):
//   1. métrica de conta sem `metric_type=total_value` devolve {"data":[]} com status 200 —
//      silêncio que parece "não tenho o dado" e é só sintaxe;
//   2. cada tipo de mídia aceita um conjunto diferente de métricas: pedir skip rate num
//      carrossel derruba a chamada inteira, por isso reels são consultados à parte.
import fs from 'node:fs';
import { carregarEnv, conta, chamar, morre } from '../_ig-api.mjs';

const argv = process.argv.slice(2);
const valor = flag => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
const comoJson = argv.includes('--json');
const DIAS = Number(valor('--dias')) || 7;
const ARQUIVO_MD = valor('--md');
const ARQUIVO_HTML = valor('--html');
const DE_JSON = valor('--de');            // renderiza sem tocar na API
const ARQUIVO_LEITURA = valor('--leitura'); // o parágrafo que o Claude escreveu na VPS

// Token só é necessário para coletar. Com --de, o script vira só renderizador — e por isso roda
// em qualquer lugar, inclusive sem .env.local.
let c = null, T = null;
if (!DE_JSON) {
  try { c = conta(carregarEnv(argv), argv); } catch (e) { morre(e.message); }
  T = c.token;
}

const DIA = 86400_000;
const agora = new Date();
const inicio = new Date(agora - DIAS * DIA);
const inicioAnterior = new Date(agora - 2 * DIAS * DIA);
const seg = d => Math.floor(d.getTime() / 1000);
const dataBR = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// ---------- conta ----------
const METRICAS_CONTA = 'reach,views,accounts_engaged,profile_views,profile_links_taps,total_interactions,follows_and_unfollows,website_clicks';

/** Métricas da conta num intervalo. Devolve {nome: valor}. Uma métrica que falhe não derruba o resto. */
async function placar(desde, ate) {
  const params = { period: 'day', metric_type: 'total_value', since: seg(desde), until: seg(ate) };
  try {
    const r = await chamar('me/insights', { token: T, params: { ...params, metric: METRICAS_CONTA } });
    return Object.fromEntries(r.data.map(d => [d.name, d.total_value?.value ?? 0]));
  } catch {
    const saida = {};
    for (const m of METRICAS_CONTA.split(',')) {
      try {
        const r = await chamar('me/insights', { token: T, params: { ...params, metric: m } });
        saida[m] = r.data?.[0]?.total_value?.value ?? 0;
      } catch { /* métrica indisponível nesta conta — segue sem ela */ }
    }
    return saida;
  }
}

/** Quanto do alcance veio de quem não segue. É o número que diz se o conteúdo saiu da bolha. */
async function foraDaBolha(desde, ate) {
  try {
    const r = await chamar('me/insights', {
      token: T,
      params: { metric: 'views', period: 'day', metric_type: 'total_value', breakdown: 'follow_type', since: seg(desde), until: seg(ate) },
    });
    const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    const acha = v => res.find(x => x.dimension_values[0] === v)?.value ?? 0;
    const seguidor = acha('FOLLOWER'), naoSeguidor = acha('NON_FOLLOWER');
    const total = seguidor + naoSeguidor;
    return total ? { seguidor, naoSeguidor, pct: (naoSeguidor / total) * 100 } : null;
  } catch { return null; }
}

/** A hora do dia com mais seguidores online (0–23, no fuso que a API devolve). */
async function picoDeAudiencia() {
  try {
    const r = await chamar('me/insights', { token: T, params: { metric: 'online_followers', period: 'lifetime' } });
    const mapa = r.data?.[0]?.values?.slice(-1)[0]?.value;
    if (!mapa) return null;
    const pares = Object.entries(mapa).map(([h, v]) => [Number(h), v]).sort((a, b) => b[1] - a[1]);
    return { hora: pares[0][0], gente: pares[0][1], top3: pares.slice(0, 3).map(p => p[0]) };
  } catch { return null; }
}

// ---------- posts ----------
const CAMPOS_MIDIA = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,insights.metric(reach,views,total_interactions,saved,shares)';

async function postsDoPeriodo(desde) {
  const r = await chamar('me/media', { token: T, params: { fields: CAMPOS_MIDIA, limit: 25 } });
  const dentro = (r.data || []).filter(m => new Date(m.timestamp) >= desde);
  return Promise.all(dentro.map(async m => {
    const ins = Object.fromEntries((m.insights?.data || []).map(d => [d.name, d.values?.[0]?.value ?? 0]));
    const post = {
      id: m.id,
      tipo: m.media_product_type === 'REELS' ? 'reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'carrossel' : 'foto',
      quando: m.timestamp,
      permalink: m.permalink,
      titulo: (m.caption || '(sem legenda)').split('\n')[0].slice(0, 58),
      curtidas: m.like_count ?? 0,
      comentarios: m.comments_count ?? 0,
      ...ins,
    };
    // reels têm duas métricas que só existem neles — e que dizem se o gancho segurou
    if (post.tipo === 'reels') {
      try {
        const extra = await chamar(`${m.id}/insights`, { token: T, params: { metric: 'reels_skip_rate,ig_reels_avg_watch_time' } });
        for (const d of extra.data) post[d.name] = d.values?.[0]?.value ?? 0;
      } catch { /* reel muito novo ainda não tem */ }
    }
    return post;
  }));
}

// ---------- o que está esperando resposta ----------
async function pendencias(desde) {
  const eu = (await chamar('me', { token: T, params: { fields: 'username' } })).username;
  const semResposta = [];
  try {
    const r = await chamar('me/media', {
      token: T,
      params: { fields: 'id,permalink,timestamp,comments{id,text,timestamp,username,from{username},replies{username,from{username}}}', limit: 12 },
    });
    // Só comentário recente entra na fila: cobrança de "responde isso" em post de três meses
    // atrás não é pendência, é arqueologia — e enche o boletim de coisa que ninguém vai fazer.
    const limiteComentario = new Date(agora - 2 * DIAS * DIA);
    for (const m of r.data || []) {
      for (const com of m.comments?.data || []) {
        if (new Date(com.timestamp) < limiteComentario) continue;
        const autor = com.from?.username || com.username;
        if (autor === eu) continue;                                  // comentário meu não espera resposta
        const respostas = com.replies?.data || [];
        if (respostas.some(rp => (rp.from?.username || rp.username) === eu)) continue;
        semResposta.push({ post: m.permalink, autor: autor || '(desconhecido)', texto: com.text, quando: com.timestamp });
      }
    }
  } catch { /* sem permissão de comentário: segue sem esta seção */ }

  let mencoes = [];
  try {
    const r = await chamar('me/tags', { token: T, params: { fields: 'id,username,permalink,media_type,timestamp', limit: 20 } });
    mencoes = (r.data || []).filter(m => new Date(m.timestamp) >= desde);
  } catch { /* idem */ }

  return { semResposta, mencoes };
}

// ---------- montagem ----------
async function coletar() {
  const perfil = await chamar('me', { token: T, params: { fields: 'username,followers_count,media_count' } });
  const [agoraP, antesP, bolha, pico, posts, pend] = await Promise.all([
    placar(inicio, agora),
    placar(inicioAnterior, inicio),
    foraDaBolha(inicio, agora),
    picoDeAudiencia(),
    postsDoPeriodo(inicio),
    pendencias(inicio),
  ]);

  posts.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  const reelsColetados = posts.filter(p => p.tipo === 'reels' && p.reels_skip_rate !== undefined);
  return {
    conta: c.rotulo, username: perfil.username, seguidores: perfil.followers_count,
    periodo: { de: inicio.toISOString(), ate: agora.toISOString(), dias: DIAS },
    placar: agoraP, placar_anterior: antesP, fora_da_bolha: bolha, pico_de_audiencia: pico,
    posts,
    destaques: {
      maiorAlcance: posts[0] || null,
      maisSalvo: [...posts].sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0))[0] || null,
      piorGancho: reelsColetados.length ? [...reelsColetados].sort((a, b) => b.reels_skip_rate - a.reels_skip_rate)[0] : null,
    },
    pendencias: pend,
  };
}

const dados = DE_JSON ? JSON.parse(fs.readFileSync(DE_JSON, 'utf8')) : await coletar();
const { placar: agoraP, placar_anterior: antesP, fora_da_bolha: bolha, pico_de_audiencia: pico, posts, destaques, pendencias: pend } = dados;
const reels = posts.filter(p => p.tipo === 'reels' && p.reels_skip_rate !== undefined);
const perfil = { username: dados.username, followers_count: dados.seguidores };
const leitura = ARQUIVO_LEITURA && fs.existsSync(ARQUIVO_LEITURA) ? fs.readFileSync(ARQUIVO_LEITURA, 'utf8').trim() : null;
const periodoIni = new Date(dados.periodo.de), periodoFim = new Date(dados.periodo.ate);

if (comoJson) { console.log(JSON.stringify(dados, null, 2)); process.exit(0); }

// ---------- markdown ----------
// Porcentagem sobre base minúscula é ruído: sair de 3 para 162 vira "+5300%", número que não
// ensina nada. Abaixo de 10 no período anterior, mostramos os dois valores e pronto.
const variacao = chave => {
  const a = agoraP[chave], b = antesP[chave];
  if (a === undefined) return '—';
  if (b === undefined || b === 0) return `**${a}**`;
  if (b < 10) return `**${a}** (era ${b})`;
  const pct = Math.round(((a - b) / b) * 100);
  const seta = pct > 0 ? '🔼' : pct < 0 ? '🔽' : '▪️';
  return `**${a}** ${seta} ${pct > 0 ? '+' : ''}${pct}%`;
};
const L = [];
L.push(`# Boletim @${perfil.username} — ${dataBR(periodoIni)} a ${dataBR(periodoFim)}`);
L.push('');
L.push(`${perfil.followers_count} seguidores · ${posts.length} publicação(ões) no período · comparado com os ${dados.periodo.dias} dias anteriores`);
L.push('');
if (leitura) {
  L.push('## A leitura da semana');
  L.push('');
  L.push(...leitura.split('\n'));   // linha a linha: no HTML cada uma vira seu próprio parágrafo
  L.push('');
}
L.push('## O placar');
L.push('');
L.push('| | |');
L.push('|---|---|');
L.push(`| Contas alcançadas | ${variacao('reach')} |`);
L.push(`| Visualizações | ${variacao('views')} |`);
L.push(`| Contas que interagiram | ${variacao('accounts_engaged')} |`);
L.push(`| Visitas ao perfil | ${variacao('profile_views')} |`);
L.push(`| Cliques no link da bio | ${variacao('website_clicks')} |`);
L.push(`| Saldo de seguidores | ${variacao('follows_and_unfollows')} |`);
L.push('');
if (bolha) {
  L.push(`**Fora da bolha:** ${bolha.pct.toFixed(1)}% das visualizações vieram de quem **não** te segue (${bolha.naoSeguidor} de ${bolha.seguidor + bolha.naoSeguidor}).`);
  L.push('');
}
if (pico) {
  L.push(`**Pico de audiência:** ${String(pico.hora).padStart(2, '0')}h — as 3 melhores horas são ${pico.top3.map(h => String(h).padStart(2, '0') + 'h').join(', ')}.`);
  L.push('');
}

L.push('## O que foi publicado');
L.push('');
if (!posts.length) {
  L.push('_Nada publicado no período._');
} else {
  L.push('| Post | Tipo | Alcance | Views | Interações | Salvos | Compart. |');
  L.push('|---|---|---|---|---|---|---|');
  for (const p of posts) {
    L.push(`| [${p.titulo}](${p.permalink}) | ${p.tipo} | ${p.reach ?? '—'} | ${p.views ?? '—'} | ${p.total_interactions ?? '—'} | ${p.saved ?? '—'} | ${p.shares ?? '—'} |`);
  }
  L.push('');
  if (reels.length) {
    L.push('| Reels | Pularam | Tempo médio assistido |');
    L.push('|---|---|---|');
    for (const p of reels) {
      L.push(`| [${p.titulo}](${p.permalink}) | ${p.reels_skip_rate.toFixed(1)}% | ${(p.ig_reels_avg_watch_time / 1000).toFixed(1)}s |`);
    }
    L.push('');
  }
}

L.push('## Destaques');
L.push('');
if (destaques.maiorAlcance) L.push(`- **Maior alcance:** [${destaques.maiorAlcance.titulo}](${destaques.maiorAlcance.permalink}) — ${destaques.maiorAlcance.reach} contas.`);
if (destaques.maisSalvo?.saved) L.push(`- **Mais salvo** (o que as pessoas querem rever): [${destaques.maisSalvo.titulo}](${destaques.maisSalvo.permalink}) — ${destaques.maisSalvo.saved} salvamentos.`);
if (destaques.piorGancho) L.push(`- **Gancho mais fraco:** [${destaques.piorGancho.titulo}](${destaques.piorGancho.permalink}) — ${destaques.piorGancho.reels_skip_rate.toFixed(1)}% pularam.`);
if (!destaques.maiorAlcance) L.push('_Sem publicação no período._');
L.push('');

L.push('## Esperando você');
L.push('');
if (pend.semResposta.length) {
  L.push(`**${pend.semResposta.length} comentário(s) sem resposta:**`);
  L.push('');
  for (const s of pend.semResposta.slice(0, 10)) L.push(`- @${s.autor}: "${(s.texto || '').slice(0, 70)}" — [ir ao post](${s.post})`);
} else {
  L.push('- Nenhum comentário sem resposta. 👏');
}
L.push('');
if (pend.mencoes.length) {
  L.push(`**${pend.mencoes.length} menção(ões) nova(s):**`);
  L.push('');
  for (const m of pend.mencoes) L.push(`- @${m.username} te marcou — [ver](${m.permalink})`);
}
L.push('');
L.push('---');
L.push(`_Gerado por \`boletim.mjs\` em ${agora.toLocaleString('pt-BR')}. Métrica não se guarda, se consulta._`);

const md = L.join('\n');
console.log(md);
if (ARQUIVO_MD) { fs.writeFileSync(ARQUIVO_MD, md); console.error(`\n📝 gravado em ${ARQUIVO_MD}`); }

// ---------- HTML do e-mail ----------
// Conversor mínimo, e de propósito: ele só precisa dar conta do markdown que ESTE arquivo gera
// (título, tabela, lista, link, negrito, itálico, régua). Não é um parser de markdown geral —
// tentar fazê-lo virar um seria trocar 30 linhas previsíveis por uma dependência e um bug novo.
function paraHtml(linhas) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0a66c2;text-decoration:none">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');

  const out = [];
  let emTabela = false, emLista = false, primeiraLinhaTabela = false;
  const fechaTabela = () => { if (emTabela) { out.push('</tbody></table>'); emTabela = false; } };
  const fechaLista = () => { if (emLista) { out.push('</ul>'); emLista = false; } };

  for (const linha of linhas) {
    const t = linha.trim();
    // O separador precisa ter pelo menos um traço. Sem essa exigência, `| | |` — o cabeçalho vazio
    // da tabela do placar — casava como separador, e a primeira métrica virava cabeçalho.
    if (/^\|[\s:|-]*-[\s:|-]*\|$/.test(t)) { primeiraLinhaTabela = false; continue; }
    if (t.startsWith('|')) {
      const celulas = t.split('|').slice(1, -1).map(x => x.trim());
      if (!emTabela) {
        fechaLista();
        out.push('<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">');
        // cabeçalho todo vazio (tabela de duas colunas do placar) não vira thead: renderizaria
        // uma faixa em branco no e-mail
        if (celulas.some(x => x)) {
          out.push('<thead>' + celulas.map(x => `<th align="left" style="border-bottom:2px solid #ddd">${inline(x)}</th>`).join('') + '</thead>');
        }
        out.push('<tbody>');
        emTabela = true; primeiraLinhaTabela = true;
        continue;
      }
      out.push('<tr>' + celulas.map(x => `<td style="border-bottom:1px solid #eee">${inline(x)}</td>`).join('') + '</tr>');
      continue;
    }
    fechaTabela();
    if (t.startsWith('- ')) {
      if (!emLista) { out.push('<ul style="padding-left:20px;line-height:1.7">'); emLista = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      continue;
    }
    fechaLista();
    if (t.startsWith('# ')) out.push(`<h1 style="font-size:20px;margin:0 0 4px">${inline(t.slice(2))}</h1>`);
    else if (t.startsWith('## ')) out.push(`<h2 style="font-size:16px;margin:22px 0 6px;color:#333">${inline(t.slice(3))}</h2>`);
    else if (t === '---') out.push('<hr style="border:none;border-top:1px solid #eee;margin:20px 0">');
    else if (t) out.push(`<p style="margin:8px 0;line-height:1.6">${inline(t)}</p>`);
  }
  fechaTabela(); fechaLista();
  void primeiraLinhaTabela;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:680px;margin:0 auto">${out.join('\n')}</div>`;
}

if (ARQUIVO_HTML) {
  fs.writeFileSync(ARQUIVO_HTML, paraHtml(L));
  console.error(`📧 HTML do e-mail em ${ARQUIVO_HTML}`);
}
