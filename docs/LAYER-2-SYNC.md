# Layer 2 — sincronização de skills e perfis

O Agent Manager mantém uma base canônica por usuário em `~/.ai-workstation` e sincroniza somente no
sentido catálogo → agentes. Não usa rede, não executa `npx skills`, não toca em login, tokens,
histórico, memória ou plugins.

## Comandos

```powershell
afd status
afd review
afd sync --dry-run
afd sync
afd verify
afd adopt claude-code minha-skill --dry-run
```

`adopt`/`import` copia uma skill direta para `catalog/pending/<agent>/`; pending nunca é promovido ou
sincronizado automaticamente. Drift em conteúdo gerenciado bloqueia sobrescrita. Perfis existentes
recebem somente um bloco pequeno, com backup datado antes da primeira alteração.

A skill canônica versiona a política da Common Agent Toolbox: preferência contextual por `rg`,
`fd`, `jq`, `yq`, `bat` e `delta`, com alternativas nativas quando necessárias e sem autorizar
comandos mutantes. Revisões reconhecidas aparecem como `UPDATE` no dry-run e só substituem a revisão
gerenciada anterior; qualquer outro conteúdo permanece como drift.

## Capacidades atuais

| Agente | Skills | Perfil-base | Estratégia |
|---|---|---|---|
| Claude Code | suportado | suportado | espelho em `~/.claude/skills`; bloco em `~/.claude/CLAUDE.md` |
| Codex | suportado | suportado | `~/.agents/skills`; bloco em `~/.codex/AGENTS.md` |
| Pi | suportado | suportado | `~/.agents/skills`; bloco em `~/.pi/agent/AGENTS.md` |
| Grok | suportado | deferred | leitura nativa de `~/.agents/skills`; configuração preservada |
| Hermes | suportado | deferred | espelho em `skills/`; catálogo não é linkável nem gravável pelo agente |
| Antigravity | deferred | deferred | nenhum caminho global é assumido sem contrato oficial estável |

Codex, Pi e Grok consomem a mesma skill nativa em `~/.agents/skills`. Claude e Hermes recebem
espelhos; no Hermes o perfil continua intocado. Perfis de Grok e Hermes e todo o adapter de
Antigravity permanecem deferred.

As skills internas existentes do Hermes permanecem privadas e aparecem como importáveis; nunca são copiadas,
apagadas ou promovidas automaticamente.

Referências oficiais usadas no desenho: documentação de skills do Claude Code, documentação de
skills do Codex, `pi-mono/packages/coding-agent/docs/skills.md` e documentação Grok Build
“Skills, Plugins & Marketplaces”.
