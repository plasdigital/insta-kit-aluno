# Comece aqui — do zero ao primeiro post por comando

Siga na ordem. Quase tudo é tela da Meta; de código, você só copia um arquivo e preenche.
No fim desta página você publica uma foto pelo terminal.

As partes 5 e 6 (comentários e DM) só fazem sentido depois que o básico estiver de pé — pule-as
na primeira leitura.

---

## 1. A conta precisa ser profissional

A API não fala com conta pessoal. No app do Instagram: **Configurações → Tipo de conta →
Mudar para conta profissional**, e escolha **Criador** ou **Empresa**. Os dois servem.

> 💡 **Crie também uma segunda conta, só para teste.** Você vai errar formato de carrossel, tamanho
> de vídeo e legenda cortada — e é muito melhor errar num perfil que ninguém olha. Todo este kit é
> feito para trabalhar com duas contas ao mesmo tempo.

## 2. O app na Meta

1. Vá em **developers.facebook.com** → *Meus Apps* → **Criar app**.
2. Caso de uso: **Outro** → tipo **Empresa**.
3. Dentro do app, adicione o produto **Instagram** e escolha
   **API setup with Instagram login** (é o caminho que **não exige Página do Facebook** — se
   você escolher o outro, vai precisar de Página, Conta Comercial e mais três telas).
4. Em *1. Generate access tokens*, clique em **Add account** e conecte sua conta de Instagram.
   Repita para a conta de teste — **as duas ficam no mesmo app**.

Anote da tela do app: o **Instagram app ID** e o **Instagram app secret**.

> ⚠️ **São dois secrets diferentes.** O app tem um "App secret" (do Facebook) e um "Instagram app
> secret", em telas diferentes. Eles não são intercambiáveis: usar o do Facebook em
> `graph.instagram.com` devolve `Error validating client secret` (código 100). Você quer o do
> Instagram.

## 3. O token

Ainda em *2. Generate access tokens*, clique em **Generate token** na linha da sua conta e copie o
valor. Ele vale **60 dias**.

> 🔴 **Token pertence ao app que o emitiu.** Se você apagar ou recriar o app, todos os tokens dele
> morrem em silêncio — a API passa a responder `API access deactivated`, uma mensagem que não diz
> nada sobre app apagado e parece "a conta caiu". Eu perdi dois dias com exatamente isso. Antes de
> apagar qualquer app, saiba quais tokens saíram dele.

## 4. O `.env.local`

Copie o arquivo de exemplo e preencha:

```bash
cp .env.exemplo .env.local
```

O mínimo para publicar são **três linhas por conta**:

```
IG_TESTE_USER_ID=...
IG_TESTE_TOKEN=...
IG_TESTE_TOKEN_EXPIRA=2026-12-31
```

`TESTE` aí é um **rótulo que você inventa**. Ele é o que os scripts recebem na linha de comando:
`node perfil.mjs TESTE`. Conta nova = três linhas novas com outro rótulo. Não há limite.

O `USER_ID` aparece na própria tela do app, ao lado da conta conectada.

Agora confira:

```bash
node perfil.mjs TESTE
```

Deve sair o @, o número de seguidores, a validade do token com semáforo (🟢 mais de 20 dias ·
🟡 20 ou menos · 🔴 7 ou menos) e a cota de publicação. Se saiu, está tudo certo.

```bash
node diagnostico.mjs TESTE
```

Bate nas cinco famílias da API uma a uma e diz qual permissão faltou. **É read-only** — não
publica nada.

## 5. O primeiro post

```bash
node publicar/publicar.mjs foto minha-imagem.jpg TESTE --legenda "primeiro post pela API"
```

Repare que **nada foi publicado**. O script montou tudo, imprimiu a prévia — conta, mídia, legenda,
contagem de caracteres e de hashtags — e parou. Para publicar de verdade:

```bash
node publicar/publicar.mjs foto minha-imagem.jpg TESTE --legenda "..." --confirmar
```

> ⚠️ **O rótulo da conta vai sempre na linha de comando.** Se você omitir, o script cai na conta
> padrão do `.env.local` — e um dia isso vai publicar na conta errada. Passar o rótulo é a única
> proteção real.

**Se o arquivo é local, ele precisa estar no ar antes.** A API da Meta não aceita upload de
arquivo: ela só recebe uma URL HTTPS pública que os servidores dela vão baixar. Quem resolve isso é
o `publicar/hospedar.mjs`, que sobe a mídia para um bucket público do Supabase — e para isso você
precisa das duas linhas de Supabase no `.env.local` (parte 7). Se a mídia já estiver numa URL sua,
passe a URL em vez do caminho e pule essa parte.

## 6. Renovar o token, antes que ele vença

```bash
node renovar-token.mjs TESTE
```

Estende por mais 60 dias e regrava a validade no `.env.local` sozinho. Não precisa de secret.

> 🔴 **Token vencido não renova.** Passou dos 60 dias, o caminho é voltar na tela do app e gerar na
> mão. Por isso o semáforo do `perfil.mjs` existe — e por isso, se você rodar isso num servidor,
> vale um cron semanal chamando este comando.

---

## 7. Supabase (opcional, mas necessário para publicar arquivo local)

Três coisas usam Supabase aqui: a **hospedagem da mídia** (bucket público), a **tabela de contatos
da DM** e a **tabela de gatilhos** (a promessa de cada post). Se você só vai publicar de URL e não
vai ligar nem comentário nem DM, pule.

1. Crie um projeto em supabase.com.
2. Crie um bucket **público** chamado `instagram`.
3. Preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`.
4. Rode os dois SQL no editor do Supabase (os dois são idempotentes, pode rodar de novo sem medo):
   - `comentarios/schema.sql` — a tabela de gatilhos, se for usar "comenta X que eu te mando"
   - `agente-dm/schema.sql` — a tabela de contatos, se for ligar o agente de DM

> Os dois criam uma **view em `public`** espelhando a tabela. Isso existe porque o nó Supabase do
> n8n não deixa escolher schema — ele só enxerga `public`. Descobri isso depois de o fluxo insistir
> que a tabela não existia.

> 🔒 **Se você for rodar isso num servidor, não use a `service_role` lá.** Ela abre o projeto
> inteiro. O `hospedar.mjs` tem um segundo modo: crie um usuário comum (só e-mail e senha, sem
> nenhum perfil), dê a ele policies apenas no bucket `instagram`, e preencha `IG_STORAGE_EMAIL` +
> `IG_STORAGE_SENHA` + `SUPABASE_ANON_KEY`. Tendo essas três, o script entra como esse usuário e a
> chave poderosa nunca sai da sua máquina. **Ele cai no modo `service_role` sozinho se as variáveis
> sumirem, e sem avisar** — então confira.
>
> E dê uma policy `RESTRICTIVE` prendendo esse usuário ao bucket `instagram`. Sem ela, ele herda
> qualquer policy solta que você tenha em outros buckets. No meu projeto, ele conseguia escrever
> num bucket que não era dele — descobri por teste, não por leitura.

## 8. n8n (opcional — comentários e DM)

Os arquivos de `fluxos/` são workflows prontos para importar (**Workflows → Import from File**).
Depois de importar, você precisa, em cada um:

1. **Recriar as credenciais.** Todo id de credencial foi trocado por
   `TROQUE-PELA-SUA-CREDENCIAL` — o *nome* ficou, para você saber qual criar.
2. **Reconectar os sub-fluxos.** Onde havia `<ID_DO_SEU_FLUXO_...>`, cole o id do fluxo
   correspondente que você acabou de importar.
3. **Publicar o sub-fluxo ANTES do fluxo que o chama.** O n8n recusa publicar um workflow que
   referencia sub-workflow não publicado (`references workflow ... which is not published`).

Depois, aponte o webhook do app da Meta para o seu n8n e **inscreva a conta**:

```bash
curl -X POST "https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages&access_token=SEU_TOKEN"
```

> 🔴 **Assinar o topic na tela do app não basta.** Cada conta precisa entrar nessa chamada
> separadamente. Sem ela o app aparece "assinado", o webhook está configurado, e nada chega nunca.
> Não há mensagem de erro — só silêncio.

A ordem de leitura daqui em diante é [docs/03-comentarios.md](docs/03-comentarios.md) e
[docs/04-agente-dm.md](docs/04-agente-dm.md).
