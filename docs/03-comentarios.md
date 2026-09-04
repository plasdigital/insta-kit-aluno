# 03 — "Comenta TEMPLATE que eu te mando": o comentário vira DM

Quando a legenda promete *"comenta TEMPLATE que eu te mando o vídeo"*, quem cumpre a promessa é um
fluxo do n8n. Não há script neste kit para isso, **de propósito**: é uma cadeia que reage a webhook
e precisa de estado, log e retentativa.

**Os arquivos:** `fluxos/1-porteiro-webhook.json` e `fluxos/2-agente-comentarios.json`.
A tabela que sustenta os dois é `comentarios/schema.sql`, e quem escreve nela é
`comentarios/gatilhos.mjs` — comando, não fluxo.

---

## A cadeia

```
comentário no post
   → webhook  POST /webhook/instagram-webhook        (topic `instagram` no app da Meta)
   → [PORTEIRO] Switch pelo campo `field`  →  comments
   → descarta eco (comentário da própria conta)
   → [AGENTE] busca o post na tabela de gatilhos
   → compara o texto com a coluna `key_word`  (exato + erro de digitação + IA)
   → resposta privada usando o `comment_id`  →  DM com a mensagem daquela linha
```

## Por que existem dois fluxos, e não um

**A Meta entrega comentário e DM no mesmo webhook.** Não dá para ter dois endpoints — a entrada é
uma só, e quem separa é um `Switch` pelo campo `field`.

Isso começou como um workflow de 51 nós que fazia tudo. Separar em porteiro + sub-fluxos deu a cada
um canvas, log e execução próprios — e de quebra **tirou a DM pessoal do log de quem abre o fluxo de
comentário**. Se mais de uma pessoa vai mexer nisso, esse último ponto sozinho já justifica.

> ⚠️ **Publique o sub-fluxo antes do porteiro.** O n8n recusa publicar um workflow que referencia
> sub-workflow não publicado.

## A palavra-chave é por post, não do fluxo

Cada post ganha uma linha numa tabela com quatro colunas que importam:

| coluna | o quê |
|---|---|
| `post_id` | o id da mídia |
| `key_word` | a palavra que dispara |
| `direct_message` | o que vai na DM |
| `comment_reply` | liga **também** a resposta pública ("dá uma olhada no direct 😉"); vazia, sai só a DM |

**Post sem linha não dispara nada.** É isso que permite mudar a promessa a cada publicação sem
tocar no n8n.

A tabela mora no Supabase (`comentarios/schema.sql` cria tudo, e é idempotente). Repare na **view
`public.ig_gatilho_post`** que vem junto: ela não é preciosismo. O nó Supabase do n8n só enxerga o
schema `public`, então a tabela vive em `instagram.gatilho_post` e a view a espelha. É o mesmo
truque do `ig_contato_dm`, no agente de DM.

### Como se cadastra um gatilho

O caminho normal é **na hora de publicar** — a linha nasce junto com o post:

```bash
node publicar/publicar.mjs carrossel slides/   --legenda "comenta TEMPLATE que eu te mando o vídeo"   --gatilho TEMPLATE --dm "Segue o link: https://..." --resposta "dá uma olhada no direct 😉"   --confirmar
```

Para o resto existe `comentarios/gatilhos.mjs`:

```bash
node comentarios/gatilhos.mjs listar                     o que está no ar
node comentarios/gatilhos.mjs ver <post_id|url>          uma linha
node comentarios/gatilhos.mjs set <post_id|url> --palavra TEMPLATE --dm "..." --confirmar
node comentarios/gatilhos.mjs tirar <post_id> --confirmar
node comentarios/gatilhos.mjs sincronizar                confere a tabela contra a conta (não grava)
node comentarios/gatilhos.mjs sincronizar --confirmar    grava
```

> **Isto já foi um fluxo do n8n** que importava os posts com a miniatura, para alguém olhar a grade
> numa ferramenta de tabela. Quando ninguém abre a tabela — porque quem opera o banco é a IA — a
> miniatura deixa de pagar uma ferramenta e um fluxo a mais. Vale a pergunta no seu caso: **essa
> tabela vai ser lida por gente?** Se sim, uma ferramenta com grade e miniatura é ótima. Se não,
> ela é peso.

### O sincronizar faz três coisas, e uma ele não faz

| | |
|---|---|
| **cadastra** | post que está na conta e não está na tabela |
| **atualiza** | linha que existe com campo desatualizado (link, tipo, legenda, data) — campo a campo |
| **denuncia** | linha órfã: está na tabela e **não está mais na conta** (post apagado ou arquivado). Com gatilho ligado, é promessa apontando para o nada |
| ❌ **não toca** | `key_word`, `direct_message` e `comment_reply`. A promessa é do dono; a API não tem opinião sobre ela. E **não apaga órfã sozinho** — mostra e deixa a decisão com quem manda |

⚠️ **A armadilha que este comando já teve, e que vale para qualquer sincronização:** a primeira
versão só procurava post **novo**. Linha que já existia nunca era revisitada — então um post
cadastrado à mão, incompleto, ficava incompleto para sempre, e rodar de novo respondia *"a tabela já
tem todos"*. **Sincronizar não é importar o que falta: é fazer os dois lados baterem.**

Duas regras que saíram daí e que você vai reencontrar em qualquer integração com API:

- **`null` da API é "não sei", nunca "apague".** Campo que volta vazio não sobrescreve o que está
  gravado. Sem isso, uma resposta incompleta da API limpa a sua tabela.
- **Data se compara como data, não como texto.** A Graph API devolve `...+0000` e o Postgres
  normaliza para `...+00:00`. As duas strings são diferentes e o instante é o mesmo — comparando
  texto, todo post fica "sujo" para sempre e o script nunca diz que está em dia.

## As três camadas do filtro

1. **Exato normalizado** — tira acento, ignora maiúscula, transforma emoji e pontuação em espaço.
   `QUERO!!!`, `Quéro` e `quero 🔥` todos casam com `quero`.
2. **Erro de digitação** — distância de edição, com tolerância pelo tamanho da chave: até 3 letras
   exige exato · 4 a 7 tolera 1 erro · 8+ tolera 2. Na prática `TEMPLAT`, `TENPLATE` e `templattes`
   passam; `quanto tempo leva` não. Compara por janela, então chave de mais de uma palavra funciona
   igual.
3. **A IA entendendo a intenção** — quem escreve "manda o material aí" não casa com regex nenhuma.
   O classificador recebe a `key_word` daquele post no prompt e decide. **Exige confiança ≥ 0.8**
   para valer como gatilho.

## O que acontece com quem NÃO acertou a palavra

O comentário vai para um classificador (agente com saída em JSON estruturado):

| tipo | O que acontece |
|---|---|
| `gatilho` | a camada 3 acima — volta para o caminho da DM |
| `elogio` | responde em público na hora e te avisa (só aviso, sem botão) |
| `pergunta` | **congela** e pergunta a você: comentário + link do post + resposta sugerida, com botões *Responder assim* / *Deixa comigo* |
| `critica` | igual à pergunta, marcada 🔴 e com resposta que reconhece em vez de se defender |
| `spam` | nada — saída ligada em lugar nenhum, de propósito |

O caminho do *Deixa comigo* abre uma caixa de texto **já preenchida com a sugestão da IA**: você
corrige e envia. Texto vazio é como se expressa "não quero responder nada" — o ramo morre ali.

Os dois esperam 48h por uma resposta sua.

---

## As cicatrizes

### `success` no n8n não quer dizer que alguém foi atendido

Um comentário real chegou, a cadeia rodou até o nó que busca o post, e ele devolveu `[]`: aquele
post não tinha linha na tabela. Morreu ali, e **a execução ficou marcada como `success`**.

Duas lições: **post sem linha não dispara nada e não reclama**; e para saber se alguém foi atendido
é preciso olhar por quais nós a execução passou, não a cor dela.

> Por isso o nó que busca o post precisa de **Always Output Data**. Sem isso ele devolve zero itens
> e mata o ramo — o comentário nunca chega no classificador.

### Não dá para testar comentando com a própria conta

Comentei duas vezes no meu próprio post e **nada aconteceu**. Os dois chegaram, o webhook foi
entregue, a assinatura estava certa. Morreram no filtro de eco.

O payload traz `entry.id` (o dono do post) e `value.from.id` (quem comentou) — e quando você
comenta no próprio post os dois são o mesmo id. O filtro lê isso como eco do próprio bot e descarta.

**E ele está certo.** Sem esse corte existe loop: o agente responde em público → a resposta é um
comentário da conta → o webhook dispara de novo → o agente responde a si mesmo, para sempre.

**Como testar de verdade:** comente **de outra conta**. É a única forma — a resposta privada precisa
de um destinatário que não seja você.

### A parte visível funcionar não prova que a invisível funcionou

O gatilho pegou, a resposta pública saiu (*"dá uma olhada no seu direct 😉"*), eu vi funcionando.
**A DM não chegou.**

O envio falhou com `The value in the "JSON Body" field is not valid JSON` e caiu no ramo de erro —
que faz a coisa certa (solta a marca, para a pessoa poder tentar de novo) e **em silêncio**. O
motivo: a mensagem da tabela tem quebra de linha, e o corpo era montado interpolando texto cru
dentro de aspas:

```
"message": { "text": "{{ $('Get Post').item.json.direct_message }}" }
```

Quebra de linha literal dentro de string JSON é JSON inválido. Aspas duplas e barras invertidas
também seriam. **O conserto vale para todo corpo JSON com texto de gente dentro** — monte o objeto e
deixe o `JSON.stringify` escapar:

```
={{ JSON.stringify({ recipient: { comment_id: $('Set Comments').item.json.comment_id },
                     message:   { text: $('Get Post').item.json.direct_message } }) }}
```

### Marcar antes de enviar perde lead

A trava anti-DM-repetida grava "essa pessoa já foi atendida neste post". Se o envio falhar **depois**
dessa marca, a pessoa fica marcada como atendida sem ter recebido nada. O nó de envio tem saída de
erro ligada num nó que **solta a marca** para a próxima tentativa.

> ⚠️ Essa trava mora no `staticData` do workflow. Mover o nó para outro fluxo **zera a memória de
> quem já foi atendido**. Aconteceu comigo: as pessoas daquele post receberiam a DM de novo.

### Detalhes que custaram tempo

- **Um nó Code que devolve `[]` mata o ramo em silêncio.** Se o nó é para *marcar* e não para
  *filtrar*, faça-o devolver sempre 1 item com `bateu: true/false` e deixe um `If` decidir depois.
- **O limite de espera do `sendAndWait` é uma `fixedCollection`, não campos soltos.** Isto o n8n
  aceita, salva e **ignora** — a execução espera até o ano 3000:
  ```json
  "options": { "limitWaitTime": true, "limitType": "afterTimeInterval", "resumeAmount": 48, "resumeUnit": "hours" }
  ```
  O que funciona:
  ```json
  "options": { "limitWaitTime": { "values": { "limitType": "afterTimeInterval", "resumeAmount": 48, "resumeUnit": "hours" } } }
  ```
  Não há aviso. O único jeito de saber é olhar o `waitTill` da execução.
- **Os rótulos dos botões são `approveLabel` / `disapproveLabel`.** Escrever
  `buttonApprovalLabel` não dá erro — o n8n ignora e mostra "✅ Approve" em inglês.
- **A resposta privada tem janela de 7 dias** contados do comentário (a DM comum tem 24h; esta, não).
- **Republicar o workflow derruba o webhook por alguns segundos** (`502`). Se for testar logo depois
  de publicar, tente de novo.
- **Não dá para simular comentário pela API.** `POST /{media}/comments` só funciona no próprio
  conteúdo, e comentário próprio cai no filtro de eco. Para testar a lógica sem esperar alguém real,
  dispare um `POST` direto no webhook com o payload da Meta — o `comment_id` pode ser falso: a
  cadeia roda inteira e só o envio final falha.
- **Comentar em post de terceiro não existe na API** (`code 100/33`). O caminho comentário →
  resposta privada só serve para comentário que uma pessoa real deixou **no seu** post.
