# Arquitetura

## Um produto, três módulos internos

```text
AI Foundry Desk — Multi-Agent Workbench
├── Foundation / Layer 1        PowerShell + mise + uv + pnpm
├── Agent bootstrap / Layer 2   PowerShell + WinGet + canais oficiais
├── Common Agent Toolbox        rg + fd + jq + yq + bat + delta
└── Agent Manager               Node.js + TypeScript + adapters nativos
```

`afd` é a entrada única do usuário. O núcleo Node faz inspeção e governança portáveis; `afd layer1`
e `afd layer2` atravessam uma ponte explícita para uma allowlist de scripts PowerShell no Windows.
Nenhuma layer é aplicada por padrão ou por `afd init`.

## Modelo do Agent Manager

- **Catalog:** fontes canônicas aprovadas.
- **Manifest:** seleção declarativa versionada por target.
- **Inventory:** observação de estado gerenciado, adotado ou direto.
- **Adapters:** integração com mecanismos nativos de cada agente.
- **Review:** diferenças e decisões antes de mudanças.
- **Sync/adopt:** espelho unidirecional explícito; conteúdo adotado entra em pending para revisão.

Contratos: `agent-manager/src/contracts.ts`. Formato: `agent-manager/schema/agents-manifest.schema.json`.

A base do usuário está em `~/.ai-workstation`: `catalog/`, `profile/`, `manifest.json` e `state/`.
Backups operacionais de todas as layers ficam fora do repositório, na raiz derivada
`%LOCALAPPDATA%\ai-workstation\backups`. Codex, Pi e Grok leem a skill por `~/.agents/skills`;
Claude e Hermes recebem espelhos.
Perfis pequenos usam blocos gerenciados em Claude, Codex e Pi. Antigravity e perfis Hermes/Grok são
deferred quando não há contrato seguro confirmado.

O Agent Manager usa Node 24+ e evita APIs específicas de Windows. Foundation e bootstrap atuais são
Windows x64. macOS, Linux, WSL e Windows ARM64 são backlog, com implementações por plataforma atrás
de contratos comuns. Tokens, OAuth, memória, sessões e plugins proprietários não são compartilhados.
