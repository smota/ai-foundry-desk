# Retomada da próxima sessão

Este é o ponto de entrada para continuar o produto sem depender do histórico de conversa.

## Estado atual

- **Layer 1 / Foundation (Windows x64):** mise, uv, pnpm, Python 3.14, Node 24 LTS, Go 1.26 e Rust 1.98; PATH/shims, políticas uv/pnpm, guardrails apenas interativos e verificador.
- **Layer 2 / bootstrap Windows:** preserva instalações funcionais; cobre desktops Claude/Codex e CLIs Claude Code, Codex, Antigravity, Pi, Hermes e Grok. Login é manual.
- **Agent Manager:** catálogo, manifesto, profile-base, status/review/sync/verify/import-adopt, dry-run, drift e pending. Skills: Claude, Codex, Pi, Grok e Hermes; Antigravity deferred. Perfis: Claude, Codex e Pi; Grok/Hermes deferred.
- **Toolbox:** `rg`, `fd`, `jq`, `yq`, `bat` e `delta`. RTK e opcionais semelhantes estão fora.
- **Backups:** `%LOCALAPPDATA%\ai-workstation\backups`; três snapshots recentes protegidos e poda apenas de excedentes com mais de 30 dias.

## Começar com segurança

Execute primeiro somente leitura, em PowerShell novo:

```powershell
git status --short
.\scripts\01-verify-layer1.ps1
.\scripts\07-verify-layer2-agent-clis.ps1
.\scripts\07-verify-layer2-toolbox.ps1
.\scripts\10-verify-backups.ps1
afd status
afd review
afd verify
pnpm check
```

Antes de aplicar qualquer reconciliação, use `afd layer1 --dry-run`, `afd layer2 --dry-run`,
`afd sync --dry-run` e `scripts\10-backup-maintenance.ps1 -WhatIf`.

## Invariantes

- Não gerenciar tokens, login, histórico, memória ou plugins proprietários.
- Não sobrescrever drift nem promover pending/skills Hermes automaticamente.
- Catálogo → agentes é unidirecional; Hermes recebe somente espelho.
- Não usar `pnpm setup`, instalações globais por padrão ou atualização implícita de runtimes.
- Não expor o `hermes.exe` trampoline; a rota pública é o launcher canônico `hermes.cmd`.
- Não executar `hermes update`: falta fluxo revisado, verificável e reversível.
- Não versionar backups, logs, state/local, `.env`, caches ou instalações.

## Próximas decisões

Consulte [ROADMAP.md](ROADMAP.md). Comece por uma tarefa isolada, com inventário e dry-run.
Organização, registry, canal de segurança e SLA dependem do mantenedor. Nome e licença MIT já estão
decididos.

## Nota da validação de migração

O tarball 0.1.0 e `afd` foram validados em PowerShell 5.1/7 e cmd. No host de migração, `afd verify`
detectou que o pacote uv estava instalado, mas seu diretório físico não constava no PATH persistente.
O instalador foi corrigido para reconciliar esse caminho em futura execução; a máquina não foi
alterada nesta migração. Revise `afd layer1 --dry-run` antes de optar por `--apply`.
