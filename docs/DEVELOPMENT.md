# Desenvolvimento

Requisitos: Windows x64 para Foundation/bootstrap; Node 24 e pnpm 11 para o Agent Manager; PowerShell
5.1 e 7 para mudanças de perfis/guardrails.

```powershell
pnpm install
pnpm check
```

`pnpm check` executa lint, typecheck, testes e build. Em PowerShell, faça parse dos scripts e execute
primeiro com `-WhatIf`. Preserve comandos existentes, derive caminhos do sistema e nunca versione
`backups/`, `setup-logs/`, estado local, `.env` ou instalações.

Comece uma nova sessão por [`NEXT-SESSION.md`](NEXT-SESSION.md). Mudanças documentais devem manter
links relativos válidos e não transformar evidência de uma máquina em requisito do produto.
