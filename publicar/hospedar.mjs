// hospedar.mjs — sobe arquivo local para uma URL pública (Supabase Storage) e devolve o link.
// A API do Instagram NÃO aceita upload de arquivo: só image_url / video_url público em HTTPS.
// Uso:  node publicar/hospedar.mjs <arquivo|pasta> [...]      → imprime uma URL por linha
//       node publicar/hospedar.mjs --listar
//       node publicar/hospedar.mjs --limpar [dias]            → apaga o que passou de N dias (padrão 7)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { carregarEnv, AQUI, morre } from '../_ig-api.mjs';

const BUCKET = 'instagram';
const TIPOS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

// Dois modos de entrar no Storage, e a diferença importa:
//
//   admin       → service_role. É o do seu PC: abre o projeto inteiro, e por isso não sai daqui.
//   publicador  → usuário de serviço (`publicador-ig@`) que o RLS só deixa escrever no bucket
//                 `instagram`. É o do servidor, que fica exposto 24 h e não pode carregar uma
//                 chave que alcança o resto do seu banco. Crie junto com as policies
//                 `ig_publicador_*` em `storage.objects` (o COMECE-AQUI.md tem o passo a passo).
//
// Quem manda é o .env.local: tendo IG_STORAGE_EMAIL/SENHA, entra como publicador.
function credenciais() {
  const local = carregarEnv();
  if (local.IG_STORAGE_EMAIL && local.IG_STORAGE_SENHA && local.SUPABASE_URL && local.SUPABASE_ANON_KEY) {
    return {
      modo: 'publicador', url: local.SUPABASE_URL.replace(/\/$/, ''),
      anon: local.SUPABASE_ANON_KEY, email: local.IG_STORAGE_EMAIL, senha: local.IG_STORAGE_SENHA,
    };
  }
  let url = local.SUPABASE_URL, chave = local.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    // No kit a credencial vem do .env.local daqui — não há projeto vizinho para herdar.
    const dash = path.resolve(AQUI, '..', '.env.local');
    if (!fs.existsSync(dash)) morre(`Sem credencial do Supabase. Esperava ${dash}, ou SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, ou IG_STORAGE_EMAIL/IG_STORAGE_SENHA no .env.local daqui.`);
    const e = carregarEnv(['--env', dash]);
    url ||= e.NEXT_PUBLIC_SUPABASE_URL;
    chave ||= e.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!url || !chave) morre('SUPABASE_URL / SERVICE_ROLE não encontrados.');
  return { modo: 'admin', url: url.replace(/\/$/, ''), chave };
}

// preguiçoso de propósito: publicar só com URL remota não precisa tocar no Supabase
let SUPA, cab, MODO;
async function conectar() {
  if (cab) return;
  const c = credenciais();
  SUPA = c.url; MODO = c.modo;
  if (c.modo === 'publicador') {
    const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: c.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: c.senha }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) morre(`Login do publicador falhou: ${j.error_description || j.msg || r.status}`);
    // o token vale 1 h — de sobra para uma publicação, e é justamente o ponto de não guardar chave eterna
    cab = { Authorization: `Bearer ${j.access_token}`, apikey: c.anon };
  } else {
    cab = { Authorization: `Bearer ${c.chave}`, apikey: c.chave };
  }
}

async function garantirBucket() {
  await conectar();
  // o publicador não enxerga a API de bucket (e nem deve): o bucket existe desde 19/ago
  if (MODO === 'publicador') return;
  const r = await fetch(`${SUPA}/storage/v1/bucket/${BUCKET}`, { headers: cab });
  if (r.ok) return;
  const criar = await fetch(`${SUPA}/storage/v1/bucket`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
    // sem file_size_limit: herda o teto do projeto (pedir 1 GB devolve 413 no plano atual)
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!criar.ok) morre(`Não consegui criar o bucket "${BUCKET}": ${await criar.text()}`);
  console.error(`ℹ️  bucket público "${BUCKET}" criado no Supabase principal.`);
}

export function expandir(alvos) {
  const arquivos = [];
  for (const alvo of alvos) {
    if (!fs.existsSync(alvo)) morre(`Não existe: ${alvo}`);
    if (fs.statSync(alvo).isDirectory()) {
      arquivos.push(...fs.readdirSync(alvo).filter(f => TIPOS[path.extname(f).toLowerCase()]).sort()
        .map(f => path.join(alvo, f)));
    } else arquivos.push(alvo);
  }
  return arquivos;
}

export async function subir(arquivo) {
  const ext = path.extname(arquivo).toLowerCase();
  const tipo = TIPOS[ext];
  if (!tipo) morre(`Extensão não suportada: ${ext} (use jpg, png, mp4 ou mov)`);
  const dia = new Date().toISOString().slice(0, 10);
  const nome = path.basename(arquivo).replace(/[^\w.-]/g, '-');
  const destino = `${dia}/${Date.now().toString(36)}-${nome}`;
  const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${destino}`, {
    method: 'POST', headers: { ...cab, 'Content-Type': tipo }, body: fs.readFileSync(arquivo),
  });
  if (!r.ok) morre(`Falhou o upload de ${arquivo}: ${await r.text()}`);
  return `${SUPA}/storage/v1/object/public/${BUCKET}/${destino}`;
}

async function listar(prefixo = '') {
  await conectar();
  const r = await fetch(`${SUPA}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: prefixo, limit: 200, sortBy: { column: 'name', order: 'desc' } }),
  });
  return r.ok ? r.json() : [];
}

/** Sobe uma lista de arquivos locais e devolve as URLs públicas, na ordem. */
export async function hospedarLocais(arquivos) {
  await garantirBucket();
  const urls = [];
  for (const a of arquivos) urls.push(await subir(a));
  return urls;
}

// ---------- CLI (só quando chamado direto) ----------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
const argv = process.argv.slice(2);
await garantirBucket();

if (argv[0] === '--listar') {
  for (const pasta of await listar('')) {
    for (const f of await listar(`${pasta.name}/`)) {
      console.log(`${pasta.name}/${f.name}  ${((f.metadata?.size || 0) / 1048576).toFixed(1)} MB`);
    }
  }
} else if (argv[0] === '--limpar') {
  const dias = Number(argv[1] || 7);
  const corte = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const apagar = [];
  for (const pasta of await listar('')) {
    if (pasta.name >= corte) continue;
    for (const f of await listar(`${pasta.name}/`)) apagar.push(`${pasta.name}/${f.name}`);
  }
  if (!apagar.length) {
    console.log(`nada anterior a ${corte} para apagar.`);
  } else {
    const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: { ...cab, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: apagar }),
    });
    console.log(r.ok ? `🧹 ${apagar.length} arquivo(s) anteriores a ${corte} apagados.` : `falhou: ${await r.text()}`);
  }
} else {
  const arquivos = expandir(argv.filter(a => !a.startsWith('--')));
  if (!arquivos.length) morre('Uso: node publicar/hospedar.mjs <arquivo|pasta> [...]');
  for (const a of arquivos) console.log(await subir(a));
}
}
