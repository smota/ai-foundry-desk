# Distribuição e release

Nome e licença MIT estão definidos. Publicação ainda depende de registry/organização, automação e assinatura.

Uma release única do AI Foundry Desk deverá conter scripts/docs Windows e o build/schema do
Agent Manager. Nunca incluir `backups/`, `setup-logs/`, estado local, `.env`, caches, `node_modules/`,
perfis capturados ou instalações.

Backups são estado operacional local em `%LOCALAPPDATA%\ai-workstation\backups`, nunca conteúdo do
pacote. A retenção preserva os três snapshots mais recentes por alvo e remove apenas excedentes com
mais de 30 dias. Instalações e artefatos integralmente reproduzíveis não recebem backup.

Pipeline planejado: validar PowerShell Windows x64; executar `pnpm install --frozen-lockfile` e
`pnpm check`; executar `scripts/release-audit.ps1`; gerar SBOM/checksums;
assinar e publicar uma GitHub Release. Publicação npm e automação de release são backlog.

O campo `files` do package raiz e `scripts/release-audit.ps1` formam a allowlist executável inicial.
Ainda não existe pipeline de release; não publique o diretório de trabalho inteiro. Proveniência, assinatura, SLA/canal de segurança
e organização responsável dependem de decisão explícita do mantenedor.
