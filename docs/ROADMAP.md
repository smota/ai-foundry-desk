# Roadmap priorizado

## Pronto

- produto único com Layer 1, bootstrap Layer 2, toolbox e Agent Manager;
- Windows x64 validado; verificadores e WhatIf independentes;
- catálogo/profile-base, sync unidirecional, drift, pending e import/adopt;
- skills Claude/Codex/Pi/Grok/Hermes; perfis Claude/Codex/Pi; Antigravity deferred;
- backups locais centralizados com retenção e auditoria.

## Próximo ciclo

1. atualização segura do Hermes, sem `hermes update` direto, com origem/hash, backup, rollback e validação do launcher;
2. revisão e promoção explícitas de `catalog/pending`, incluindo skills privadas do Hermes;
3. integração assistida com `npx skills`, usando o mecanismo nativo sem duplicá-lo nem acessar rede implicitamente;
4. adapter Antigravity quando houver contrato oficial global estável; perfis Grok/Hermes somente com contrato seguro;
5. observabilidade Tokscale opcional, local e privada por padrão, sem login/submissão automáticos.

## Dependências e decisões do mantenedor

- organização/registry e governança;
- canal de segurança, responsáveis e SLA;
- compatibilidade e versionamento do manifesto;
- CI/release por allowlist, SBOM, proveniência, checksums e assinatura;
- publicação npm do comando `afd`.

## Evolução posterior

- TUI OpenTUI sobre os contratos existentes;
- Layer 1 para macOS, Linux e WSL;
- Windows ARM64 e matrizes de CI nativas;
- adapters adicionais orientados por documentação oficial.

## Deliberadamente fora de escopo

- tokens, login, memória, sessões e plugins proprietários compartilhados;
- promoção automática de skills, sandbox total ou execução automática de repositórios não confiáveis;
- Paperclip/hub legado, RTK, loopersai, ai-memory, ponytail, agentacct e stack observável pesada;
- aliases globais para `cat`/`git` e reimplementação dos mecanismos nativos dos agentes.
