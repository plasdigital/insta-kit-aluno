# CLAUDE.md — instruções para o agente de IA

> Você é o agente de IA de quem baixou esta pasta. **Leia este arquivo antes de agir.**
> Ele diz o que dá pra fazer aqui, com que comando, e o que você nunca faz sem confirmar.
> O dono desta pasta não precisa decorar comando nenhum — ele conversa com você, e você executa.

**O que esta pasta faz:** publica no Instagram, responde comentário, atende DM e mede o
desempenho — tudo pela API oficial, sem abrir o aplicativo.

Node 18+, sem dependências. Não há `npm install`, build nem teste. **A verificação é rodar os
comandos read-only** (`perfil.mjs`, `diagnostico.mjs`) e montar a prévia sem `--confirmar`.

---

## 1. As possibilidades

⚠️ **O rótulo da conta (`TESTE`, `PRINCIPAL`) vai na linha de comando, sempre.** Omitir cai na
`IG_CONTA_PADRAO` do `.env.local`.

### Ver e diagnosticar (read-only, pode rodar sem perguntar)

| O que o dono pede | Comando |
|---|---|
| "que conta é essa?" · "meu token vence quando?" · "quanto já postei hoje?" | `node perfil.mjs TESTE` |
| "quais foram meus últimos posts?" | `node perfil.mjs TESTE --midias` |
| "está tudo funcionando?" · "por que deu erro?" | `node diagnostico.mjs TESTE` |
| "como foi o post?" · "quantas curtidas?" | `node metricas/metricas.mjs` |
| "como foi minha semana?" | `node metricas/boletim.mjs TESTE --dias 7` |
| "quem já falou comigo na DM?" | `node agente-dm/contatos.mjs` |

### Publicar (🔴 exige confirmação — ver seção 3)

| O que o dono pede | Comando |
|---|---|
| publicar uma foto | `node publicar/publicar.mjs foto <img> TESTE --legenda "texto"` |
| publicar carrossel (2 a 10) | `node publicar/publicar.mjs carrossel <pasta\|a.jpg b.mp4 ...> TESTE --legenda "texto"` |
| publicar reels | `node publicar/publicar.mjs reels <video.mp4> TESTE --legenda "..." [--capa <img>]` |
| publicar story | `node publicar/publicar.mjs story <img\|video.mp4> TESTE` |
| deixar pronto pra publicar depois (vale 24h) | acrescente `--agendar`; depois `--publicar-container <id> --confirmar` |

**Sem `--confirmar` o script monta tudo, mostra a prévia e para.** É assim que se mostra ao dono o
que vai ao ar. **Rode sempre sem `--confirmar` primeiro.**

### Manutenção

| O que o dono pede | Comando |
|---|---|
| "renova meu token" | `node renovar-token.mjs TESTE` (+60 dias; **exige token ainda vivo**) |
| "sobe esse arquivo pra internet" | `node publicar/hospedar.mjs <arquivo\|pasta>` |
| "o que está hospedado?" | `node publicar/hospedar.mjs --listar` |
| "limpa o que já publiquei" | `node publicar/hospedar.mjs --limpar [dias]` (padrão 7) |
| "bloqueia o fulano no bot" | `node agente-dm/contatos.mjs bloquear @fulano` |
| "carrega quem já me mandou DM" | `node agente-dm/precarga.mjs TESTE` |

### O que roda no n8n, não aqui

A automação de **comentários** e o **agente de DM** são fluxos, não scripts: importe os JSONs de
`fluxos/` no n8n. Esta pasta só guarda os arquivos e a documentação deles.

---

## 2. O que precisa estar configurado

Antes de qualquer coisa, **rode `node diagnostico.mjs <ROTULO>`**. Ele bate nas 5 famílias da API e
diz exatamente qual está faltando — não adivinhe pelo erro.

| Para | Precisa de | Se faltar |
|---|---|---|
| ver métricas, ler mídias | só o token no `.env.local` | `perfil.mjs` acusa |
| publicar **URL** já pública | só o token | — |
| publicar **arquivo local** | Supabase (`SUPABASE_URL` + chave) | `hospedar.mjs` falha |
| comentários | n8n com os fluxos 1 e 2 importados | nada acontece, sem erro |
| agente de DM | n8n (fluxo 4) + Supabase (tabela `contatos`) | idem |

**Sem `.env.local` nada funciona.** Se ele não existir: `cp .env.exemplo .env.local` e peça ao dono
os valores — **nunca invente token nem id**. O passo a passo de onde tirar cada um está em
`COMECE-AQUI.md`.

---

## 3. As travas — o que você NUNCA faz sozinho

1. 🔴 **Nunca use `--confirmar` sem o dono ter visto a prévia e dito sim.** Post é público e não se
   desfaz sem rastro. A ordem é: rodar sem `--confirmar` → mostrar a prévia → esperar o OK → rodar
   com `--confirmar`.
2. 🔴 **Nunca publique na conta principal sem ele pedir aquela conta.** Na dúvida, use a de teste.
3. 🔴 **Nunca escreva token, id de conta ou chave em arquivo versionado, em resposta ou em log.**
   Segredo vive só no `.env.local`, que o `.gitignore` já barra.
4. 🔴 **Nunca apague post, comentário ou mídia hospedada sem confirmar** — inclusive `--limpar`.
5. 🟡 **Não responda DM em nome do dono sem ele pedir.** Ler é livre; escrever não.

---

## 4. As armadilhas (o erro mente)

| O que aparece | O que é de verdade |
|---|---|
| resposta **`200`** ao publicar | **não quer dizer aceito.** A validação da Meta é assíncrona — o container pode virar `ERROR` depois. O script já espera o `FINISHED`; não conclua sucesso antes dele |
| `ERROR` num item do carrossel | pode ser **mentira transitória**. O script relê 3 vezes antes de desistir. `EXPIRED`, não — esse é terminal de primeira |
| `API access deactivated` | o **app que emitiu o token** foi apagado ou desativado. Não é a conta. Token pertence ao app, não ao perfil |
| `Error validating client secret` | usou o *App secret* do Facebook onde vai o **Instagram app secret**. São dois segredos diferentes, na mesma tela |
| métrica de conta vazia | conta com **menos de 100 seguidores** não recebe métrica de conta. Não é bug |
| carrossel com 11+ itens falha | o limite da API é **10** (o aplicativo aceita 20) |
| legenda com asterisco saiu com asterisco | **o Instagram não renderiza markdown.** Escreva texto puro |
| o comentário não virou DM | o fluxo **ignora comentário da própria conta** (senão entraria em laço). Teste com outro perfil |
| a DM não foi entregue | só dá pra responder **quem falou primeiro**, e dentro de **24h** |

---

## 5. Os limites da API (não tente contornar)

| | |
|---|---|
| Legenda | 2.200 caracteres · até 30 hashtags |
| Carrossel | 2 a 10 itens · imagem e vídeo podem se misturar |
| Imagem | JPEG · até 8 MB · proporção entre 4:5 e 1.91:1 |
| Reels | MP4/MOV · H.264 + AAC · até 15 min · 9:16 · até 1 GB |
| Cota | **100 publicações por 24h** (carrossel conta como 1) |
| Token | **60 dias.** Vencido **não** renova por comando — só na tela da Meta |

**A API não faz, e não adianta tentar:** agendar post nativamente · editar legenda publicada ·
apagar post · story com sticker, enquete, link ou música · anúncio ou tag de produto · iniciar DM
com alguém que não falou antes · marcar pessoas em reels.

---

## 6. Onde está escrito o porquê

Este arquivo diz **o que fazer**. Quando o dono perguntar *por quê*, a resposta está em:

| Documento | Assunto |
|---|---|
| `COMECE-AQUI.md` | a configuração inicial, na ordem — conta, app na Meta, token, `.env.local` |
| `docs/01-arquitetura.md` | por que o projeto tem esta forma, e o que dá pra desfazer |
| `docs/02-publicar.md` | publicação, hospedagem e as cicatrizes de cada formato |
| `docs/03-comentarios.md` | a automação de comentário, e por que são dois fluxos |
| `docs/04-agente-dm.md` | o agente de DM, a pré-carga e a janela de 24h |
| `docs/05-metricas.md` | métricas e o boletim semanal |
| `docs/06-o-que-a-api-permite.md` | o mapa completo da API, sondado ao vivo |
