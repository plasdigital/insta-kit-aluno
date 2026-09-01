# AGENTS.md

As instruções deste projeto moram em **[CLAUDE.md](CLAUDE.md)** — leia ele antes de agir.

Vale para qualquer agente: Codex, Antigravity, Cursor, Gemini CLI, Claude Code.

**O essencial, se você só ler isto:**

- **Nunca publique sem confirmação.** Rode o comando **sem** `--confirmar`, mostre a prévia ao dono,
  espere o "pode" — só então rode com `--confirmar`.
- **O rótulo da conta vai na linha de comando** (`node perfil.mjs TESTE`). Na dúvida, use a de teste.
- **Comece por `node diagnostico.mjs <ROTULO>`** — ele diz o que está configurado e o que falta.
- **Segredo só no `.env.local`.** Nunca em resposta, log ou arquivo versionado.
