# Kit Instagram — publicar, responder e medir pela API

Este é o projeto de Instagram que eu rodo de verdade, empacotado para você rodar no seu perfil.
Não é uma demonstração: são os mesmos scripts e os mesmos fluxos de n8n que estão no ar, com os
meus segredos trocados por placeholders e os caminhos da minha máquina apagados.

**O que ele faz, em uma frase cada:**

| | |
|---|---|
| 📤 **Publica** | foto, carrossel (2 a 10), reels e story saem de um comando no terminal — sem abrir o celular |
| 💬 **Responde comentário** | quem comenta a palavra-chave combinada recebe o link na DM, sozinho |
| 🤖 **Atende a DM** | menu de botões na primeira mensagem, IA nas seguintes, e-mail pra você quando é orçamento |
| 📊 **Mede** | o desempenho de tudo que você publicou, na hora — e um boletim semanal por e-mail |

**O que você precisa ter:** Node 18+, uma conta de Instagram profissional (Criador ou Empresa),
uma conta de desenvolvedor na Meta e — só para as duas automações de resposta — uma instância de
n8n e um projeto no Supabase.

---

## Comece por aqui

👉 **[COMECE-AQUI.md](COMECE-AQUI.md)** — do zero até o primeiro post publicado por comando.
É o único documento que você precisa seguir na ordem. Uns 40 minutos, quase tudo na tela da Meta.

Depois disso, leia o que você for usar:

| Documento | Quando ler |
|---|---|
| [docs/01-arquitetura.md](docs/01-arquitetura.md) | **Leia antes de tudo.** Por que o projeto tem essa forma, e o que é decisão minha que você pode desfazer |
| [docs/02-publicar.md](docs/02-publicar.md) | Quando for publicar — e antes de brigar com um carrossel que não sobe |
| [docs/03-comentarios.md](docs/03-comentarios.md) | Quando for montar o "comenta X que eu te mando" |
| [docs/04-agente-dm.md](docs/04-agente-dm.md) | Quando for ligar o agente que atende a DM |
| [docs/05-metricas.md](docs/05-metricas.md) | Quando quiser saber como foi o post — e montar o boletim semanal |
| [docs/06-o-que-a-api-permite.md](docs/06-o-que-a-api-permite.md) | O mapa completo da API, sondado ao vivo: o que dá, o que não dá, e as automações que ainda cabem |

---

## O mapa do repositório

```
.
├── COMECE-AQUI.md          o passo a passo da instalação
├── .env.exemplo            copie para .env.local e preencha
│
├── _ig-api.mjs             a base: lê o .env, escolhe a conta, fala com a Graph API
├── perfil.mjs              quem é a conta, validade do token, cota de publicação
├── diagnostico.mjs         bate nas 5 famílias da API e diz qual permissão falta
├── renovar-token.mjs       estende o token por mais 60 dias
│
├── publicar/               foto · carrossel · reels · story  (+ hospedagem e registro)
├── metricas/               desempenho na hora  +  boletim semanal
├── agente-dm/              o schema do banco e os comandos de quem o bot atende
│
├── fluxos/                 os 5 workflows do n8n, prontos para importar
├── docs/                   a explicação de cada peça
└── publicacoes/            um JSON por post publicado (criado sozinho)
```

**Não há `package.json` e isso é de propósito.** Os scripts são Node puro, sem uma única
dependência — a exceção é `agente-dm/precarga.mjs`, que pede `pg` e você só roda uma vez. Menos
dependência é menos coisa para quebrar daqui a seis meses.

---

## Três coisas para saber antes de começar

**1. Publicar sempre exige `--confirmar`.** Sem a flag, o script monta tudo, imprime a prévia e
para. Isso não é excesso de zelo: post é público, e não existe "desfazer" sem rastro. Mantenha
assim mesmo quando estiver com pressa — foi essa prévia que me salvou de publicar uma legenda
cortada no meio.

**2. Tenha duas contas: uma de teste e a sua.** Eu publico primeiro numa conta pequena, olho no ar,
e só então mando para o perfil que tem audiência. Formato novo, endpoint novo, carrossel novo:
tudo nasce na conta que ninguém vê. Uma conta com 12 seguidores é barata de errar.

**3. `.env.local` nunca vai para o Git.** O `.gitignore` já barra, mas a responsabilidade é sua.
Token de Instagram vale 60 dias e dá acesso de publicação à sua conta — tratar como senha é o
mínimo.

---

## Se der errado

Antes de qualquer coisa, rode o diagnóstico. Ele é read-only, não publica nada, e diz exatamente
qual das cinco famílias da API está fechada para você:

```bash
node perfil.mjs TESTE          # a conta está viva? o token vence quando?
node diagnostico.mjs TESTE     # as 5 famílias da API, uma a uma
```

A maior parte dos erros que você vai encontrar é uma de três coisas: token vencido, permissão que
não foi concedida, ou a conta não ser profissional. As três aparecem nessa saída.
