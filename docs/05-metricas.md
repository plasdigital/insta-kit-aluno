# 05 — Métricas: como foi o post, e o boletim de segunda

```bash
node metricas/metricas.mjs                 # todas as publicações registradas
node metricas/metricas.mjs supabase        # só as que casam com o trecho
node metricas/boletim.mjs PRINCIPAL --md   # o retrato da semana no terminal
```

Os dois são **read-only**. Não gravam nada, não publicam nada.

---

## A regra: métrica não se guarda, se consulta

Nada aqui grava desempenho em arquivo. O registro do post mora em `publicacoes/` e guarda o
`media_id`; **o número é buscado na API no momento da pergunta**.

Um `HISTORICO.md` com alcance e curtidas seria mentira em uma semana. Número envelhece; id não.

Foi essa decisão que fez o `metricas.mjs` ser um script de 50 linhas em vez de um banco de séries
temporais. Ele lê os JSONs de `publicacoes/`, pega os `media_id`, pergunta à API e imprime.

> ⚠️ **Dado de conta dura 90 dias na API.** O que passou disso não se recupera. Se um número
> importa para você depois, ele tem que sair do boletim daquela semana.

> ⚠️ **Conta com menos de 100 seguidores não devolve métrica de conta.** É piso da API. A conta
> publica normalmente, mas `follower_count`, alcance de conta e demografia vêm vazios. **Não é bug**
> — e pega sua conta de teste em cheio.

---

## O boletim semanal, e o padrão que vale copiar

Toda segunda às 8h chega um e-mail com o desempenho da semana. Ninguém abre o app nem roda nada:

```
cron  0 8 * * 1  →  boletim-semanal.sh
   1. node metricas/boletim.mjs PRINCIPAL --json    → os números (só GET na API)
   2. um comando de IA lê esse JSON                 → a leitura da semana, 4 linhas
   3. node metricas/boletim.mjs --de <json> --html  → o HTML do e-mail (NÃO bate na API de novo)
   4. POST no webhook do n8n                        → o n8n manda o e-mail
```

**A divisão de trabalho é a parte que vale copiar para qualquer automação sua:**

| Peça | Quem faz | Por quê |
|---|---|---|
| Os números | o script, determinístico | número é o que a IA erra. Aqui ela não chega perto |
| A leitura | a IA | é a parte que exige julgamento — e é o que justifica ter IA no meio |
| O e-mail | o n8n | a credencial já está lá e não precisa ser copiada para o servidor |

Três decisões dentro disso que custaram pensamento:

- **`--de <json>` existe para não bater na API duas vezes.** O passo 3 precisa dos mesmos números do
  passo 1, e a tentação é recoletar. Separar **coleta** de **renderização** também deixa o script
  testável sem token — foi o que permitiu depurar o HTML do e-mail sem gastar uma única chamada.
- **Falha de IA não derruba o boletim.** Se a leitura não vier em 5 minutos, o e-mail sai só com os
  números e um aviso no log. Boletim sem leitura ainda é um boletim; boletim que não chega não é
  nada.
- **O webhook tem autenticação por header.** Um webhook aberto que dispara e-mail é um disparador de
  spam com o seu nome. A chave mora no `.env` do servidor, com permissão restrita, **nunca dentro do
  fluxo**.

> ⚠️ **Porcentagem sobre base pequena é ruído.** Sair de 3 para 162 vira "+5300%", que não ensina
> nada. Abaixo de 10 no período anterior, o boletim mostra "162 (era 3)" e pronto.

> 🔴 **Quando o token vencer, isso para em silêncio.** Um boletim que não chega não levanta erro em
> lugar nenhum — você só percebe na terça, se lembrar. Se for rodar num servidor, ponha um cron
> semanal chamando `renovar-token.mjs` junto. E lembre que **o token do seu PC e o do servidor são
> dois tokens diferentes**: renovar um não renova o outro.

---

## O que existe de métrica e quase ninguém usa

Estas estão disponíveis na API, custam uma chamada, e respondem perguntas que a maioria das pessoas
responde no achismo:

| | Por que vale |
|---|---|
| `online_followers` | seus seguidores online **hora a hora** — é a resposta de *"que horas eu posto"*, com dado |
| `follower_demographics` | idade, cidade, país. Alimenta anúncio e pauta. Roda 1×/mês; não muda toda semana |
| `reach` com `breakdown=follow_type` | quanto do alcance veio de **quem não te segue** — o número que diz se o conteúdo saiu da bolha |
| `reels_skip_rate` + `ig_reels_avg_watch_time` | a nota do gancho, reel a reel. Vira decisão de edição em vez de opinião |
| `website_clicks` · `profile_links_taps` | a métrica de conversão do perfil |

O levantamento completo, métrica por métrica — incluindo as duas que devolvem `200` com
`{"data":[]}` e parecem bug — está em [06-o-que-a-api-permite.md](06-o-que-a-api-permite.md).

## Três automações que dá para montar com o que já está aqui

Eu não montei nenhuma delas ainda. Todas são uma chamada de API que já funciona mais um cron:

1. **Nota do gancho por reel** — mede o skip rate reel a reel e te diz quais aberturas seguram.
2. **Hora certa de publicar** — lê `online_followers` e dispara `--publicar-container` no pico.
   Junta com o `--agendar` do [02-publicar.md](02-publicar.md) e vira agendamento de verdade.
3. **Ficha da audiência** — `follower_demographics` uma vez por mês, arquivado por mês.
