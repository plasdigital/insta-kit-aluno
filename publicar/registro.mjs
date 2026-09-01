// registro.mjs — grava o que FOI publicado. Um arquivo por execução, nunca um histórico compartilhado.
//
// Regra do setor (00-cerebro): status não se documenta, se consulta. O que se guarda aqui é só o
// que a API não devolve depois — o id, a origem e o que foi enviado. Métrica NUNCA entra: com o
// media_id salvo, engajamento se puxa da API na hora da pergunta.
//
// Por que um arquivo por publicação, e não um HISTORICO.md:
//   - dois agentes (este PC e o Claude da VPS) escrevem sem conflito, porque nunca no mesmo arquivo;
//   - JSON vira linha de tabela quando o estado for para o banco (fase 2), sem reescrever nada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const PUBLICACOES = path.resolve(AQUI, '..', 'publicacoes');

/**
 * Descobre de que projeto saiu a mídia subindo a árvore a partir do primeiro arquivo local.
 * Duas esteiras alimentam o Instagram e as duas nomeiam a pasta AAAA-MM-DD-slug:
 *   cortes-video/projetos/<slug>/   → tem roteiro.json (traz o YouTube de origem)
 *   instagram-carrossel/conteudos/<slug>/ → não tem; a pasta é a única referência
 */
export function detectarProjeto(arquivoLocal) {
  if (!arquivoLocal) return null;
  let dir = path.resolve(path.dirname(arquivoLocal));
  for (let i = 0; i < 5; i++) {
    const roteiro = path.join(dir, 'roteiro.json');
    if (fs.existsSync(roteiro)) return { pasta: dir, roteiro };
    if (/^\d{4}-\d{2}-\d{2}-/.test(path.basename(dir))) return { pasta: dir, roteiro: null };
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return null;
}

const carimbo = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
  `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

const relativo = p => {
  const raiz = path.resolve(AQUI, '..', '..', '..', '..'); // .../Projetos
  const r = path.relative(raiz, p);
  return r.startsWith('..') ? p : r.split(path.sep).join('/');
};

/**
 * Grava o registro e devolve o caminho. Nunca lança: publicação que deu certo não pode
 * virar erro por causa do registro — se falhar, avisa e segue.
 */
export function registrar({ canal = 'instagram', conta, tipo, mediaId, permalink, legenda = '', midias = [], projeto = null, extra = {} }) {
  try {
    const agora = new Date();
    const nomeProjeto = projeto ? path.basename(projeto.pasta) : null;
    const slug = (nomeProjeto?.replace(/^\d{4}-\d{2}-\d{2}-/, '') ||
      (midias[0] ? path.basename(midias[0], path.extname(midias[0])) : tipo)).slice(0, 60);

    let origem = null;
    if (projeto) {
      origem = { projeto: relativo(projeto.pasta) };
      if (projeto.roteiro) {
        try {
          const r = JSON.parse(fs.readFileSync(projeto.roteiro, 'utf8'));
          if (r.origem?.youtube) origem.youtube = r.origem.youtube;
          if (r.origem?.titulo) origem.titulo = r.origem.titulo;
        } catch { /* roteiro ilegível não impede o registro */ }
      }
    }

    const registro = {
      canal, conta, tipo,
      publicado_em: agora.toISOString(),
      media_id: mediaId,
      permalink: permalink || null,
      legenda_chars: legenda.length,
      hashtags: (legenda.match(/#\w+/g) || []).length,
      midias: midias.map(m => (/^https?:\/\//.test(m) ? m : relativo(path.resolve(m)))),
      origem,
      ...extra,
    };

    fs.mkdirSync(PUBLICACOES, { recursive: true });
    let arquivo = path.join(PUBLICACOES, `${carimbo(agora)}-${slug}.json`);
    for (let n = 2; fs.existsSync(arquivo); n++) {
      arquivo = path.join(PUBLICACOES, `${carimbo(agora)}-${slug}-${n}.json`);
    }
    fs.writeFileSync(arquivo, JSON.stringify(registro, null, 2) + '\n');

    // o roteiro do projeto passa a responder sozinho "já foi ao ar?"
    if (projeto?.roteiro) {
      try {
        const r = JSON.parse(fs.readFileSync(projeto.roteiro, 'utf8'));
        r.publicado = [...(r.publicado || []), {
          canal, conta, tipo, media_id: mediaId, permalink: permalink || null, em: agora.toISOString(),
        }];
        fs.writeFileSync(projeto.roteiro, JSON.stringify(r, null, 2) + '\n');
      } catch { /* idem */ }
    }

    return arquivo;
  } catch (e) {
    console.log(`⚠️  publicado, mas não consegui gravar o registro: ${e.message}`);
    return null;
  }
}
