# Agent Manager

Módulo Node/TypeScript do AI Foundry Desk. É o control plane portátil para catálogo,
manifesto, inventário, adoção, sincronização, verificação e revisão de skills/perfis.

`afd status`, `review`, `sync`, `verify` e `adopt/import` operam sobre `~/.ai-workstation`.
Esse caminho legado é preservado para compatibilidade e pode ser migrado em versão futura explícita.
`sync --dry-run` não escreve. Mudanças divergentes são preservadas; adoção entra em `catalog/pending`
e nunca promove skills Hermes automaticamente. TUI permanece backlog.
