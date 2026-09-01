# 01 — A arquitetura, e por que ela é assim

Leia isto antes de mexer em qualquer coisa. Não é documentação de referência: é a explicação das
decisões que dão forma ao projeto. Algumas você vai querer desfazer — e vai poder, se souber o que
elas estavam resolvendo.

---

## O desenho

```
     arquivo local                                  comentário / DM chegando
          │                                                   │
          ▼                                                   ▼
   publicar/hospedar.mjs                              webhook do app da Meta
   (sobe pro bucket, vira URL)                                │
          │                                                   ▼
          ▼                                          fluxos/1-porteiro  ── separa pelo campo `field`
   publicar/publicar.mjs                                 │            │
   (monta container → publica)                    comentário         DM
          │                                             │             │
          ▼                                             ▼             ▼
   publicacoes/*.json  ◄──────────────┐      2-agente-comentarios   4-agente-dm
   (um arquivo por post: media_id)    │              │                     │
          │                           │         resposta privada      menu + IA + e-mail
          ▼                           │              (vira DM)              │
   metricas/metricas.mjs              │                                     ▼
   metricas/boletim.mjs ──────────────┘                        tabela ig_contato_dm
```

Duas metades que quase não se falam: **o que sai** (comando no terminal) e **o que entra**
(webhook no n8n). O único fio entre elas é a tabela que diz qual palavra-chave vale em qual post.

---

## Por que Node puro, sem framework e sem dependência

Nenhum `package.json`, nenhum build, nenhuma dependência — exceto `pg`, usado uma única vez pelo
`precarga.mjs`. Tudo é `fetch` nativo e `fs`.

Isso não é minimalismo por estética. É que **este projeto é lido mais do que executado**: eu abro
esses arquivos meses depois para lembrar como uma coisa funciona, e um script de 200 linhas que
roda com `node arquivo.mjs` continua legível para sempre. Um projeto com build e 40 dependências
não sobrevive a seis meses de abandono — quando você volta, metade não instala mais.

O preço é real: sem tipos, sem testes automatizados, sem lint. A verificação aqui é rodar o
`diagnostico.mjs` (que não escreve nada) e montar a prévia do `publicar.mjs` sem `--confirmar`.
Para um kit deste tamanho, esse preço vale.

## Por que existe um `_ig-api.mjs`

Todo script importa dele: leitura do `.env`, escolha da conta pelo rótulo, a chamada HTTP e — a
parte que mais economiza tempo — **o dicionário de erros**.

A Graph API devolve mensagens que não ajudam. `code 190` é "token inválido"; `code 10` é
"faltou uma permissão no token"; `code 4` é rate limit e não é culpa sua. O dicionário traduz cada
um numa frase que diz **o que fazer**. Sem isso, cada erro vira uma busca de dez minutos.

Se você for estender o kit, estenda esse dicionário junto. Erro que você já decifrou uma vez não
deveria custar de novo.

## Por que a conta é um rótulo, e não um arquivo de config

`node perfil.mjs TESTE` — `TESTE` é só um prefixo de variável de ambiente
(`IG_TESTE_TOKEN`, `IG_TESTE_USER_ID`). Conta nova são três linhas no `.env.local`, e nada mais.

O ganho não é a economia de código: é que **a conta fica visível na linha de comando**. Config em
arquivo é config que você esquece qual está ativa — e no dia em que esquecer, o post sai no perfil
errado, em público, sem desfazer.

Por isso mesmo: **passe o rótulo sempre.** Existe uma conta padrão no `.env.local`, mas ela é rede
de segurança, não conveniência. Aponte-a para a conta de teste.

## Por que o registro de publicação é um arquivo por post

Toda publicação grava `publicacoes/AAAA-MM-DD-HHMM-slug.json` com conta, tipo, `media_id`,
permalink e as mídias enviadas. Três decisões dentro disso:

**Quem executa é quem registra.** Antes, o script imprimia `✅ publicado! id 17…` e o id morria no
console. Esse id é a única chave que abre permalink e métrica depois. Registro escrito à mão
desatualiza; o que o script grava é verdadeiro por construção.

**Um arquivo por post, nunca um `HISTORICO.md`.** Arquivo compartilhado que cresce por append
quebra no dia em que duas máquinas publicam ao mesmo tempo — e conflito de merge em log de
execução é a pior forma de perder informação.

**Métrica não se grava.** O JSON guarda o `media_id`, nunca o alcance. Número envelhece; id não. Um
arquivo de métricas de markdown vira mentira em uma semana. Desempenho sai do `metricas.mjs`, que
pergunta à API na hora.

## Por que os fluxos de resposta vivem no n8n, e não aqui

Publicar é **você pedindo**: um comando, uma resposta, acabou. Responder é **o mundo chegando**: um
webhook a qualquer hora, que precisa de fila, retentativa, estado e log de execução.

Escrever isso em Node significaria um servidor de pé 24h, com healthcheck, log e deploy — e no fim
seria um n8n pior. O n8n já dá canvas, log por execução e retry de graça.

A divisão que eu recomendo copiar para qualquer automação sua:

| Peça | Onde | Por quê |
|---|---|---|
| Número, coleta, formato | script determinístico | é o que a IA erra |
| Julgamento ("essa crítica merece resposta?") | IA | é o que script não faz |
| Envio (e-mail, mensagem) | n8n | a credencial já está lá e não precisa ser copiada |

## O que o n8n não guarda, e por isso mora aqui

Um workflow exportado não conta por que aquele nó existe. `docs/` guarda três coisas que sumiriam
se a instância evaporasse: **o schema do banco** (`agente-dm/schema.sql`), **os comandos de
operação**, e **as cicatrizes** — cada armadilha que custou horas está escrita no documento da
automação correspondente.

Leia as cicatrizes. Elas são a parte do kit que você não conseguiria reconstruir sozinho sem gastar
os mesmos dias que eu gastei.

---

## O que é decisão minha e você pode desfazer

- **Supabase** para bucket e tabela — qualquer storage com URL pública e qualquer Postgres servem.
  Ele está aqui porque já estava de pé.
- **Gemini** como modelo dos agentes — troque pelo que você preferir; é um nó no n8n.
- **Telegram** para aprovar resposta a comentário — pode ser WhatsApp, e-mail ou nada.
- **Publicar primeiro numa conta de teste** — é processo, não código. Mas eu não desfaria.

## O que eu não desfaria

- **`--confirmar` obrigatório.** Ver a prévia antes é o que impede o erro que não tem volta.
- **Um arquivo por publicação.**
- **Nada de segredo fora do `.env.local`.**
