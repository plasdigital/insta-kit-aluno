# 02 — Publicar: foto, carrossel, reels e story

```bash
node publicar/publicar.mjs foto      capa.jpg              TESTE --legenda legenda.md
node publicar/publicar.mjs carrossel pasta-com-os-slides/  TESTE --legenda legenda.md
node publicar/publicar.mjs reels     corte.mp4 --capa thumb.jpg  TESTE --legenda "..."
node publicar/publicar.mjs story     aviso.png             TESTE

node publicar/hospedar.mjs --listar        # o que está hospedado
node publicar/hospedar.mjs --limpar 7      # apaga o que foi publicado há mais de uma semana
```

Rode **da raiz do kit** — é onde está o `.env.local`.

Sem `--confirmar` nada sai: o script monta tudo, imprime a prévia e encerra.

---

## As opções que importam

- **Pasta em vez de arquivos.** Aponte uma pasta e ele pega toda a mídia dentro, **em ordem
  alfabética**. É o que faz `slide_01.mp4 … slide_08.mp4` entrar na ordem certa. Não entra em
  subpasta.
- **`--legenda` aceita texto ou caminho de arquivo** (`.md`/`.txt`). Legenda longa se escreve em
  arquivo, não na linha de comando. Se o arquivo tiver uma seção `## Legenda`, **só ela sobe** — o
  resto (ficha técnica, checklist) fica de fora.
- **`--agendar`** para no container e devolve o id; depois
  `node publicar/publicar.mjs --publicar-container <id> --confirmar`. **O container vale 24h.**
- **Vídeo demora.** O script espera o Instagram processar (`status_code` até `FINISHED`), com teto
  de 5 minutos.

> ⚠️ **A API não agenda post.** Não existe agendamento nativo. O `--agendar` só deixa o container
> pronto; agendar de verdade é um cron ou um n8n chamando `--publicar-container` na hora.

---

## Por que existe o `hospedar.mjs`

**A API da Meta não aceita upload de arquivo.** Ela recebe `image_url`/`video_url` — uma URL HTTPS
pública que os servidores dela vão baixar. Então todo arquivo local precisa estar no ar antes.

O `publicar.mjs` faz isso sozinho; o `hospedar.mjs` foi separado só para você conseguir conferir o
link antes de gastar chamada.

> 💡 **Para vídeo existe uma exceção que eu ainda não implementei:** `upload_type=resumable` manda o
> binário direto para `rupload.facebook.com`, sem URL nenhuma. É a saída quando um reels estoura o
> limite de tamanho do seu bucket.

O bucket herda o teto de tamanho do projeto Supabase — pedir 1 GB devolve `413 EntityTooLarge`.

**Higiene:** `node publicar/hospedar.mjs --limpar 7`. O Instagram só precisa da URL no momento da
publicação; depois disso o arquivo hospedado é lixo ocupando espaço.

---

## As três cicatrizes de publicação

Estas custaram dias. Ler aqui é mais barato.

### 1. Resposta `200` não quer dizer que a API aceitou

O `POST /media` de um carrossel **responde `200` com um id mesmo quando a montagem é inválida**. A
validação é assíncrona: segundos depois o container vai para `ERROR`. Quem lê só o código HTTP
conclui que deu certo — e conclui errado. Foi assim que eu "descobri" que cabiam 25 mídias num
carrossel. Não cabem.

**Confira o container pai antes de publicar:**

```bash
curl "https://graph.instagram.com/v23.0/<container>?fields=status_code&access_token=<token>"
```

Duas coisas que só aparecem aí:

- **O limite de 10 no carrossel é real.** Testado: 10 → `FINISHED` e publicou; 12 → `ERROR`. O app
  aceita 20; a API, 10.
- **Container de item é de uso único.** Depois que um filho entrou num carrossel, ele não serve para
  outro — o novo pai vai para `ERROR`, inclusive se o pai anterior nunca tiver sido publicado.
  Montou errado? Crie os filhos de novo. As URLs hospedadas dá para reaproveitar; o container não.

Isso vale ouro para testar formato: **dá para descobrir se uma montagem é válida sem publicar
nada** — monta o pai, lê o `status_code`, e o feed nunca fica sabendo.

### 2. `ERROR` num filho pode ser mentira

Publicando um carrossel, o script abortou duas vezes seguidas dizendo que o Instagram tinha
recusado a mídia: primeiro o item 6, depois — com os mesmos arquivos — o item 10. Slides diferentes
a cada rodada, o que já não cheirava a problema de arquivo. O `ffprobe` confirmou: os dois eram
idênticos aos vizinhos que passaram, e os mesmos MP4 tinham sido aceitos horas antes na outra conta.

**Consultando os 10 containers depois, os 10 estavam `FINISHED`** — inclusive o que tinha
"falhado". O container continuou processando sozinho e completou. Quem desistiu foi o script.

**`ERROR` de filho não é estado terminal.** É um estado que a leitura pega no meio do caminho e que
volta para `FINISHED`. Por isso o `esperarPronto()` só desiste depois de **três leituras seguidas**
de `ERROR`. `EXPIRED` continua terminal na primeira — esse não volta.

Abortou mesmo assim? **Não re-hospede nem re-encode nada antes de conferir os containers.** Se
estiverem `FINISHED`, monte o pai com os ids que você já tem e publique com `--publicar-container`.
O reflexo errado aqui é ir mexer no encode do slide que "falhou" — você desalinha um vídeo do
carrossel para resolver um problema que não existe.

### 3. O Instagram não renderiza markdown

A legenda mora num `.md` porque é conveniente para você. Mas **o que sobe é texto puro**: um
`**negrito**` vai para o feed com os asteriscos à mostra. Nenhum erro, nenhum aviso — só um post
feio.

O `extrairLegenda()` tira headings, `**bold**` e `*itálico*` antes de subir. Ênfase no feed se faz
com CAIXA ALTA, quebra de linha ou emoji.

> 🔴 **E leia a contagem de caracteres do dry-run.** Um bug de regex fez a legenda de um carrossel
> sair com **14 caracteres** — cortada no meio de uma palavra. A API aceitou e publicaria sem
> reclamar. A única linha que denunciou foi a contagem na prévia. Ela existe exatamente para isso.

---

## Os limites, numa tabela

| | Regra |
|---|---|
| **Legenda** | 2.200 caracteres · máximo 30 hashtags (o script recusa antes de gastar chamada) |
| **Carrossel** | 2 a 10 itens · imagem e vídeo podem se misturar. **O app aceita 20; a API, 10** |
| **Imagem** | **JPEG é o único formato que a doc garante.** PNG passou no teste, mas na dúvida converta. Máx. 8 MB · proporção entre 4:5 e 1.91:1 |
| **Reels** | MP4/MOV · H.264 + AAC · até 15 min · 9:16 · até 1 GB |
| **Story** | imagem ou vídeo de até 60s. Sem sticker, enquete, link ou música pela API |
| **Cota** | 100 publicações por 24h — carrossel conta como 1 (`node perfil.mjs` mostra o consumo) |
| **Container** | expira em 24h · estados `IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR`, `EXPIRED` |

## O que a API não faz (não insista)

- **Agendar post** — não existe agendamento nativo.
- **Editar legenda de post publicado**, nem apagar post.
- **Anúncio e tag de produto** — é outro app, outro token, outro escopo.
- **Story rico** — sem sticker, enquete, link ou música.
- **Filtros**, **Close Friends**, **marcar pessoas em Reels**.
