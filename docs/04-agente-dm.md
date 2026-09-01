# 04 — O agente que atende a DM

Toda DM que chega é atendida por um agente: **menu de botões na primeira mensagem, IA nas
seguintes**, e e-mail para você quando o assunto é orçamento ou "quero falar com humano".

**O arquivo:** `fluxos/4-agente-dm.json` — 93 nós. É o maior do kit, e o mais interessante.

| | |
|---|---|
| **Quem chama** | o porteiro (`fluxos/1-porteiro-webhook.json`), pelo mesmo webhook dos comentários |
| **O estado** | uma tabela no Postgres — DDL em [`../agente-dm/schema.sql`](../agente-dm/schema.sql) |
| **O texto que o bot fala** | está **dentro de um nó do fluxo**, num bloco marcado "EDITE AQUI" |

---

## O que fazer primeiro

```bash
node agente-dm/precarga.mjs      # roda UMA vez, antes de ligar o bot
node agente-dm/contatos.mjs      # o placar: quem o bot atende e quem ele ignora
```

**A pré-carga é a peça que evita o desastre óbvio.** Ela carrega todas as conversas que já existem
com `bot_ativo = false` — assim **o bot nunca aborda quem já falou com você**. Sem isso, no dia em
que você liga o agente, todo mundo que já te mandou DM recebe um menu de robô.

```bash
node agente-dm/contatos.mjs listar fulano      # procura pelo @
node agente-dm/contatos.mjs bloquear @fulano   # o bot ignora essa pessoa para sempre
node agente-dm/contatos.mjs liberar @fulano
node agente-dm/contatos.mjs quem @fulano       # a ficha inteira
```

> ⚠️ **A pré-carga só enxerga ~200 conversas.** A página 5 de `/me/conversations` falha sempre, com
> qualquer retry ou intervalo. É teto da API, não erro transitório. Se você tem mais que isso, as
> conversas antigas ficam de fora — e vão receber o menu.

---

## Por que a tabela precisa de uma view

🔴 **O nó Supabase do n8n não tem campo de schema.** Ele expõe só `tableId` e fala com o PostgREST,
que enxerga apenas `public` — tabela em schema próprio é invisível para ele.

A ponte é uma **view `security_invoker` em `public`** por cima da tabela real. Ela é atualizável,
então `insert`/`update`/`delete` funcionam por ela (testado: 201/200/204). De bônus, dispensa expor
o schema inteiro na Data API.

Está tudo no `schema.sql`, que é idempotente — pode rodar quantas vezes quiser.

---

## A decisão que dá forma ao fluxo: ele é um clone

Este agente **não é inspirado** num agente de WhatsApp. Ele **é** o agente de WhatsApp: eu peguei o
JSON do fluxo que já rodava em produção e troquei só a camada de canal. 59 dos 60 nós têm o mesmo
nome nos dois. Abertos lado a lado, é o mesmo desenho, os mesmos sticky notes, as mesmas posições.

**Por que isso importa para você:** cada nó estranho ali é uma cicatriz de produção de outro canal.
`Humano Respondeu?`, `Pausa Atendimento`, `Buffer: 1ª/2ª Leitura`, `Parou de Digitar?`,
`Limite de Mensagens`, `Comando #reset?` — nada disso foi projetado no papel. Cada um apareceu
porque algo deu errado com uma pessoa real. Partir de um fluxo que já sofreu é mais rápido, mais
fiel e herda de graça toda a jurisprudência que aqueles nós carregam.

**A lição de processo:** quando for replicar algo que funciona, **clone e troque o canal**. Não
reescreva "equivalente". Eu tentei as duas coisas; a releitura do zero era pior e demorou mais.

### O que trocou de canal, e só isso

| No WhatsApp | No Instagram |
|---|---|
| `Webhook` da API de WhatsApp | `Start` — o porteiro chama por Execute Workflow |
| mapeia o payload do WhatsApp | mapeia o payload da Meta |
| `Ignora Envio da API` testa um campo `sent_api` | **não existe no IG** → consulta uma chave no Redis |
| `Filtro de Remetente` barra grupo | barra a própria conta (não há grupo na DM) |
| pede a URL da mídia à API | **no IG a URL já vem no webhook** — vira um `Set` |
| envia pela API do WhatsApp | envia para `graph.instagram.com/v23.0/me/messages` |
| `sessionKey = {telefone}chat` | `ig_{contato}chat` |

> 🔴 **Aquele prefixo no `sessionKey` não é enfeite.** Sem ele, dois agentes diferentes compartilham
> a mesma memória de conversa e **a persona de um vaza para o outro**. Se você clonar este fluxo
> para um terceiro canal, troque o prefixo.

### Os 10 nós que o Instagram exige e o WhatsApp não tem

`Foi o Bot?` · `Já Processada?` · `Repetida?` · `Ignora Repetida` · `Marca Processada` ·
`Bloqueado?` · `Marca Mid do Bot` · `Primeira Vez?` · `Envia Menu` · `Marca Menu Enviado`

Os cinco primeiros existem porque **a Meta reentrega o webhook** e porque **o eco não distingue bot
de humano** — o WhatsApp resolve isso com um campo que o Instagram não tem. Os três últimos são os
botões: a única coisa que o Instagram faz e o WhatsApp não.

---

## Os botões

Cinco quick replies na primeira mensagem: `Dúvida do conteúdo` · `Orçamento` · `Quero um curso` ·
`Já sou aluno` · `Falar com humano`.

Clicar em **Falar com humano** grava `bot_ativo = false` e **o bot se cala naquela conversa para
sempre** — só volta editando a linha na mão. É o comportamento certo: quem pediu uma pessoa não
quer o robô de volta em três mensagens.

Clicar num botão **pula a IA** e usa o payload direto, o que economiza uma chamada de modelo.

Limites da API: **13 botões, título de 20 caracteres, texto de 1000 bytes.**

---

## As cicatrizes

### Silêncio se parece com fluxo quebrado

Mandei um "Oi" da conta de teste e **não recebi resposta nenhuma**. Não era bug: aquela conta tinha
entrado na pré-carga com `bot_ativo = false`, e o nó que decide é `novo || bot_ativo`. Ela existe e
está desligada → o bot cala **de propósito**.

**Isso vai acontecer com você**, com qualquer um dos contatos da pré-carga. Antes de concluir que o
agente caiu, **olhe o `bot_ativo` do remetente**.

### Como testar sem depender de um estranho

A API **não deixa você iniciar uma DM** — só responder, e dentro de 24h. Então:

1. **A conta principal manda a primeira DM para a conta de teste** — isso abre a janela de 24h do
   lado da conta de teste.
2. **Libere a linha** da conta de teste na tabela (`bot_ativo = true`, `menu_enviado_em = null`).
3. **A conta de teste responde.** É essa mensagem que dispara o agente.
4. Ao terminar, devolva `bot_ativo = false`.

> Os ids que você usa em `recipient.id` **não são** os `IG_*_USER_ID`. São ids *app-scoped*, e saem
> de `GET /me/conversations?fields=participants`. Confundir os dois devolve `code 100/33`.

Para testar sem incomodar ninguém, também dá para dar `POST` no webhook com um `sender.id` falso
(`999999999999999`). A cadeia inteira roda — modelo, texto, banco, e-mail — e só a chamada final ao
Instagram falha. Depois apague a linha de teste da tabela.

### A janela de 24h é real e bilateral

Uma tentativa de mensagem numa conversa parada há quatro dias devolveu `code 10 / subcode 2534022` —
*"enviada fora do período permitido"*. Só passou depois que o outro lado falou.

### Falha de envio não pode matar o registro

O nó de envio tem `onError: continueRegularOutput` e 2 tentativas. Se o Instagram recusar (janela
vencida, por exemplo), **o contato é gravado do mesmo jeito** e o e-mail sai com o aviso de que a
resposta não foi entregue. Perder o registro do lead porque o envio falhou é o pior dos dois mundos.

### 🔴 O modelo precisa de rédea

Sem instrução no system prompt, o modelo respondeu uma dúvida sobre servidor recomendando **AWS e
DigitalOcean** — concorrentes diretos do que eu ensino e vendo. Numa DM, no meu perfil, com o meu
nome.

O prompt agora **proíbe citar ferramenta concorrente por nome** e manda ficar no stack que eu uso.
Se você clonar isso, essa é a primeira linha que você tem que reescrever: a lista de ferramentas do
prompt é a minha, não a sua.

### ⚠️ O bot fala preço

A resposta do botão `Quero um curso` anuncia um valor e um link. Isso está escrito **dentro de um
nó do fluxo**, não numa config. **Se a sua oferta mudar e ninguém editar o nó, o bot vende o preço
velho** — por tempo indeterminado, para todo mundo, sem avisar.

Coloque isso na sua lista de "o que revisar quando o preço mudar".

### Duas armadilhas de n8n que valem para qualquer fluxo

- 🔴 **Quebra de linha dentro de `{{ }}` derruba a expressão.** Uma quebra literal no meio de uma
  expressão dá `invalid syntax (item 0)` e o e-mail simplesmente não sai. As quebras vão **fora** da
  expressão.
- ⚠️ **`Execute Workflow` roda o sub-fluxo mesmo se ele estiver desativado.** Não existe estado
  "meio ligado" — se você desativou o sub achando que parou tudo, ele continua rodando pelo pai.
