# O que dá para fazer no Instagram por comando

> Levantado em **25/ago/2026**, sondando a API ao vivo na conta `PRINCIPAL` — não é leitura de doc.
> Estamos na **Instagram API with Instagram Login** (`graph.instagram.com/v23.0`), com as 5 permissões
> do token: `instagram_business_basic`, `..._content_publish`, `..._manage_comments`,
> `..._manage_messages`, `..._manage_insights`.
>
> **O limite quase nunca é permissão — é a própria API.** O que ela não expõe está no fim do arquivo.
> Como conectar a conta e o token: [COMECE-AQUI.md](../COMECE-AQUI.md) · o comando de cada automação: [CLAUDE.md](../CLAUDE.md) · o porquê de cada uma: [01-arquitetura.md](01-arquitetura.md).

**Legenda:** ✅ pronto, é só rodar · 🔧 a API responde, falta eu escrever o comando · ⚠️ existe mas tem pegadinha · ❌ a API não permite.

---

## 1. Publicar

| Ação | | Como |
|---|---|---|
| Foto, carrossel (2–10), reels, story | ✅ | `node publicar/publicar.mjs <tipo> <arquivo ou pasta> TESTE --legenda x.md --confirmar` |
| Preparar sem publicar (container 24h) | ✅ | `--agendar` → depois `--publicar-container <id> --confirmar` |
| Hospedar a mídia (a API só aceita URL) | ✅ | `node publicar/hospedar.mjs` (bucket `instagram` no Supabase) |
| Ver a cota (100 posts/24h) | ✅ | `node perfil.mjs` |
| **Alt text** (descrição da imagem) | 🔧 | parâmetro `alt_text` no container — **só imagem**. Acessibilidade + o Instagram usa isso pra entender o post |
| **Marcar `is_ai_generated`** | 🔧 | sinaliza conteúdo feito por IA (relevante pro canal-dark) |
| **Trial reels** | 🔧 | `trial_params` — o reel vai **só para não-seguidores**. Testar gancho sem queimar a base |
| **Parceria paga / patrocinador** | 🔧 | `is_paid_partnership` + `branded_content_sponsor_ids` (até 2) |
| **Marcar pessoas** (`user_tags`) | 🔧 | a doc cita; nunca testamos aqui |
| **Upload direto do arquivo** (vídeo) | 🔧 | `upload_type=resumable` manda o binário pra `rupload.facebook.com`, **sem URL pública**. Resolve reels grande que estoura o limite do Supabase (`413`) |
| Agendamento nativo ("posta terça 9h") | ❌ | não existe. O container vale 24h; agendar de verdade é o n8n chamando `--publicar-container` |
| Editar legenda de post publicado / apagar post | ❌ | — |
| Story com enquete, link, sticker ou música | ❌ | só imagem/vídeo puro |
| Marcar produto (shopping), filtro, Close Friends | ❌ | — |

---

## 2. Métricas — é aqui que está o material não usado

Duas armadilhas confirmadas no teste:

- ⚠️ **quase toda métrica de conta exige `metric_type=total_value`.** Sem isso a API devolve
  `{"data":[]}` — **200, sem erro nenhum**. Parece "não tenho esse dado" e é só sintaxe.
- ⚠️ **cada tipo de mídia aceita um conjunto diferente.** Pedir métrica de reels num carrossel dá erro.

### Da conta

| Métrica | | O que é |
|---|---|---|
| `reach` · `views` · `profile_views` | ✅ | alcance, visualizações, visitas ao perfil (aceita série com `since`/`until`) |
| `follower_count` · `follows_and_unfollows` | 🔧 | ganho de seguidores por dia e o **saldo** (quem seguiu menos quem deixou de seguir) |
| `accounts_engaged` · `total_interactions` · `likes` · `comments` · `shares` · `saves` · `replies` | 🔧 | engajamento consolidado do dia |
| `website_clicks` · `profile_links_taps` | 🔧 | cliques no link da bio — **é a métrica de conversão do perfil** |
| **`online_followers`** | 🔧 | **os seguidores online hora a hora (0–23).** É a resposta direta de "que horas eu posto" — e ninguém olha isso |
| **`follower_demographics`** | 🔧 | quem são os seguidores por `age`, `gender`, `city`, `country`. **Funcionou na conta PRINCIPAL** |
| `reach` / `views` com `breakdown=follow_type` | 🔧 | quanto do alcance veio de **quem não te segue** — o número que diz se o conteúdo está saindo da bolha |
| `reach` com `breakdown=media_product_type` | 🔧 | reels × post × story: onde o alcance realmente acontece |
| `engaged_audience_demographics` · `reached_audience_demographics` | ⚠️ | existem, mas devolvem `Not enough users` — **falta volume**. Voltar a testar quando crescer |
| `impressions` e as métricas de botão (e-mail, telefone, rota) | ❌ | foram removidas da API |

### Do post

| Métrica | Vale para | |
|---|---|---|
| `reach` · `views` · `likes` · `comments` · `shares` · `saved` · `total_interactions` | todos | ✅ já no `metricas/metricas.mjs` |
| `profile_visits` · `profile_activity` · `follows` | **só feed** (foto/carrossel) | 🔧 quantas pessoas o post levou ao perfil e **quantas seguiram por causa dele** |
| `ig_reels_avg_watch_time` · `ig_reels_video_view_total_time` | **só reels** | 🔧 tempo médio assistido (ms) e tempo total acumulado |
| **`reels_skip_rate`** | **só reels** | 🔧 **% de quem pulou.** No último reel deu **64,1%** — é a nota do gancho, e o app não mostra assim |
| `navigation` · `replies` | **só story** | 🔧 avanços/voltas/saídas e respostas |
| `breakdown=follow_type` no post | — | ❌ só funciona no nível da conta |

### Truque que muda o custo do relatório

Dá para pedir **as métricas junto com a lista de posts, numa chamada só** — em vez de uma por post:

```
GET me/media?fields=id,timestamp,permalink,insights.metric(reach,views,total_interactions)
```

O mesmo vale para comentários: `fields=comments_count,comments{text,username,timestamp,hidden}`.

---

## 3. Comentários

| Ação | | Situação |
|---|---|---|
| Ler comentários e respostas (com `hidden`, `like_count`, autor) | ✅ | testado; sai junto da lista de posts |
| Palavra-chave no comentário → link na DM | ✅ | fluxo `Comentarios Instagram` no n8n |
| **Responder em público** | 🔧 | `POST /{comment_id}/replies` |
| **Ocultar / reexibir** | 🔧 | `POST /{comment_id}?hide=true` — moderação sem apagar |
| **Apagar** | 🔧 | `DELETE /{comment_id}` |
| **Ligar/desligar comentários num post** | 🔧 | `POST /{media_id}?comment_enabled=false` |
| Resposta privada a partir do comentário | ✅ | janela de **7 dias** (a DM comum tem 24h) |
| Comentar em post de terceiro | ❌ | `code 100/33` — testado em 24/ago |
| Fixar comentário | ❌ | — |

---

## 4. DM

| Ação | | Situação |
|---|---|---|
| Menu de botões pra quem chama | ✅ | `Agente DM Instagram` no n8n (23/ago) |
| Ler conversas e o histórico de mensagens | ✅ | `me/conversations?fields=participants,messages{...}` |
| Texto (1000 bytes), imagem (8 MB), áudio/vídeo/PDF (25 MB), sticker, reação | ✅/🔧 | o fluxo manda texto e botões; o resto a API aceita |
| **Ice breakers** | 🔧 | **as 4 perguntas que aparecem ANTES da pessoa escrever.** `POST /me/messenger_profile` com `platform=instagram`. Hoje está **vazio** nas duas contas — o clique chega no webhook como `messaging_postback`, que o fluxo já sabe tratar |
| **Menu persistente** | 🔧 | mesmo endpoint, menu fixo dentro da conversa |
| "Digitando…" e "visto" | 🔧 | `sender_action` — faz o bot parecer gente |
| Passar a conversa pra caixa do <SEU NOME> | 🔧 | handover protocol (hoje resolvemos com `bot_ativo=false`) |
| Iniciar DM com quem nunca falou | ❌ | só resposta, dentro de 24h. Fora disso, só com human agent tag |
| DM em grupo | ❌ | conversa é sempre 1:1 |

---

## 5. Menções e vitrine

| Ação | | Situação |
|---|---|---|
| Posts/reels em que **marcaram a conta** (`me/tags`) | 🔧 | responde — **3 esperando hoje**, ninguém olhou |
| Stories ativos agora (`me/stories`) | 🔧 | responde (aresta existe) |
| Live em andamento (`me/live_media`) | 🔧 | responde |
| Comentário onde te @mencionaram | ❌ | `mentioned_comment` não existe neste setup (é do Facebook Login) |

---

## 6. O que a API **não** faz — confirmado por teste, não por leitura

Testado em 25/ago/2026; todos devolveram *nonexisting field* ou erro:

| | |
|---|---|
| **Buscar por hashtag** (`ig_hashtag_search`) | ❌ só existe com Facebook Login |
| **Espiar concorrente** (`business_discovery`) | ❌ idem — não dá pra puxar seguidores/posts de outro perfil |
| **Listar seus seguidores / quem você segue** | ❌ a lista não é exposta. Nenhum "unfollow quem não me segue" |
| Destaques (highlights), Notas, Canal de transmissão | ❌ |
| Catálogo de produtos, permissões de branded content | ❌ |
| Agendamento nativo, anúncio (é o setor `ads/`) | ❌ |
| Métricas de Threads | ⚠️ a lista de métricas cita `threads_*`, mas a chamada devolve `unknown error` — Threads pede o token dele |

---

## 7. As automações que dá pra montar com isso

Ordenadas por *valor ÷ trabalho*, não por dificuldade.

| # | Automação | Do que vive | Por que vale |
|---|---|---|---|
| 1 | **Ice breakers** | `POST /me/messenger_profile` | 4 perguntas prontas na porta da DM, caindo no agente que **já existe**. É o único item aqui que aumenta conversa recebida sem publicar nada |
| 2 | ✅ **Boletim semanal por e-mail** | `me/media` + insights inline + `follows_and_unfollows` | o script já vem pronto (`metricas/boletim.mjs`); falta só agendar — cron num servidor ou um fluxo no n8n. Ver [05-metricas.md](05-metricas.md) |
| 3 | **Nota do gancho por reel** | `reels_skip_rate` + `ig_reels_avg_watch_time` | a API devolve o % de gente que pulou. Medir isso reel a reel vira decisão de edição, não achismo |
| 4 | **Hora certa de publicar** | `online_followers` | a curva por hora sai da API; o n8n dispara `--publicar-container` no pico |
| 5 | **Fila de comentário sem resposta** | `comments{}` inline + `POST /{id}/replies` | o fluxo de comentários só reage a palavra-chave; todo o resto fica sem resposta |
| 6 | **Radar de menções** | `me/tags` | avisa quando marcam a sua conta → agradecer ou repostar. É a aba que ninguém abre |
| 7 | **Ficha da audiência** | `follower_demographics` | idade/cidade/país alimentam seus anúncios e a sua pauta — e não muda toda semana, roda 1×/mês |
| 8 | **Promover post da conta de teste para a principal** | o que já existe + registro | republicar na conta grande o que deu certo na pequena, em um passo |
| 9 | **Trial reels no laboratório** | `trial_params` | testa gancho só com não-seguidor. Combina com usar uma conta pequena como laboratório |
| 10 | **Upload resumable pra reels grande** | `rupload.facebook.com` | tira o Supabase do caminho quando o vídeo estoura o limite do bucket |

**Uma correção que se repete por aí:** dizem que a API da Meta não aceita upload de arquivo. Vale para
**imagem** — ela só aceita URL pública. Para **vídeo/reels** existe o upload resumable.
