// _ig-api.mjs — base compartilhada dos scripts do setor Instagram.
// Não roda sozinho. Cuida de: .env, escolha da conta, HTTP na Graph API e tradução de erro.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const VERSAO = 'v23.0';
const BASE = `https://graph.instagram.com/${VERSAO}`;

// ---------- .env ----------
function lerEnvArquivo(caminho) {
  const env = {};
  if (!fs.existsSync(caminho)) return env;
  for (const linha of fs.readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

/** Carrega o .env.local daqui. `--env <caminho>` soma outro por cima (chave vazia não apaga). */
export function carregarEnv(argv = process.argv) {
  let env = lerEnvArquivo(path.join(AQUI, '.env.local'));
  const i = argv.indexOf('--env');
  if (i !== -1 && argv[i + 1]) {
    for (const [k, v] of Object.entries(lerEnvArquivo(path.resolve(argv[i + 1])))) {
      if (v) env[k] = v;
    }
  }
  return env;
}

/** Grava/atualiza chaves no .env.local sem perder comentário nem ordem. */
export function gravarEnv(pares) {
  const caminho = path.join(AQUI, '.env.local');
  let texto = fs.readFileSync(caminho, 'utf8');
  for (const [chave, valor] of Object.entries(pares)) {
    const re = new RegExp(`^${chave}=.*$`, 'm');
    texto = re.test(texto) ? texto.replace(re, `${chave}=${valor}`) : `${texto.trimEnd()}\n${chave}=${valor}\n`;
  }
  fs.writeFileSync(caminho, texto);
}

// ---------- conta ----------
/** Resolve a conta: 1º argumento livre, senão --conta, senão a conta padrão. Devolve {rotulo, token, userId}. */
export function conta(env, argv = process.argv.slice(2)) {
  const iC = argv.indexOf('--conta');
  // rótulo = MAIÚSCULAS começando por letra (TESTE, PRINCIPAL) e que não seja valor de uma flag
  const explicito = iC !== -1 ? argv[iC + 1]
    : argv.find((a, i) => !a.startsWith('-') && !(argv[i - 1] || '').startsWith('--') && /^[A-Z][A-Z0-9_]*$/.test(a));
  const rotulo = (explicito || env.IG_CONTA_PADRAO || 'TESTE').toUpperCase();
  const token = env[`IG_${rotulo}_TOKEN`];
  if (!token) {
    const disponiveis = Object.keys(env).filter(k => /^IG_.*_TOKEN$/.test(k) && env[k]).map(k => k.slice(3, -6));
    throw new Error(`Conta "${rotulo}" sem token no .env.local. Com token hoje: ${disponiveis.join(', ') || '(nenhuma)'}`);
  }
  return { rotulo, token, userId: env[`IG_${rotulo}_USER_ID`] || 'me', expira: env[`IG_${rotulo}_TOKEN_EXPIRA`] };
}

// ---------- HTTP ----------
const DICIONARIO = {
  190: 'Token inválido ou expirado → gere um novo em developers.facebook.com (Instagram > API setup > Generate token) e rode `node renovar-token.mjs`.',
  100: 'Parâmetro inválido. Em publicação, quase sempre é a URL da mídia: precisa ser HTTPS público, sem login e com Content-Type certo.',
  10: 'Permissão faltando no token. Publicar exige o escopo instagram_business_content_publish.',
  9007: 'Limite de publicação atingido (100 posts em 24h). Veja `node perfil.mjs --limite`.',
  2207026: 'Formato de vídeo recusado pelo Instagram. Confira codec (H.264), áudio (AAC) e proporção.',
  4: 'Limite de chamadas da aplicação (rate limit). Espere e tente de novo.',
  33: 'Objeto inexistente para este token — quase sempre um id que veio de outro setup de API (o IGSID do Instagram Login não vale no graph.facebook.com, e vice-versa).',
};

export async function chamar(caminho, { metodo = 'GET', token, params = {}, corpo } = {}) {
  const url = new URL(caminho.startsWith('http') ? caminho : `${BASE}/${caminho.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  if (token) url.searchParams.set('access_token', token);

  const init = { method: metodo };
  if (corpo) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, init);
  const dados = await resp.json().catch(() => ({}));
  if (dados.error) {
    const e = dados.error;
    const dica = DICIONARIO[e.code] || DICIONARIO[e.error_subcode];
    const erro = new Error(`[${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}] ${e.message}${dica ? `\n   → ${dica}` : ''}`);
    erro.meta = e;
    throw erro;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

export const dorme = ms => new Promise(r => setTimeout(r, ms));

export function diasAte(dataISO) {
  if (!dataISO) return null;
  return Math.round((new Date(dataISO) - new Date()) / 86400000);
}

/** Encerra o processo com mensagem limpa (sem stack trace gigante na cara do <SEU NOME>). */
export function morre(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
