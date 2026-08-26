# Layer 2 — agentes CLI iniciais

## Objetivo

Esta primeira etapa disponibiliza Claude Desktop, Codex Desktop e seis agentes CLI para uso
imediato: Claude Code, Codex CLI, Antigravity CLI, Pi, Hermes Agent e Grok Build. Aplicativo desktop e CLI são
componentes separados. O bootstrap não realiza login, grava chaves ou configura provedores; a
distribuição de skills pertence ao Agent Manager descrito em `LAYER-2-SYNC.md`.

## Instalar

Em PowerShell:

```powershell
afd layer2 --dry-run
afd layer2 --apply
```

Ou execute diretamente `scripts\07-layer2-agent-clis.ps1`. O processo é idempotente: uma CLI
funcional não é reinstalada nem atualizada.

Métodos adotados:

- Claude Desktop: pacote oficial WinGet `Anthropic.Claude`; uma instalação funcional é preservada
  sem atualização.
- Codex Desktop: detectado objetivamente pelo pacote MSIX `OpenAI.Codex`. Não há pacote oficial
  apropriado no catálogo WinGet; se faltar, a automação orienta instalação pelo canal oficial ou
  Microsoft Store em vez de instalar um pacote de terceiros com nome semelhante.
- Claude Code: pacote oficial WinGet `Anthropic.ClaudeCode`.
- Codex CLI: pacote oficial WinGet `OpenAI.Codex`. Se o alias WinGet não for materializado pelo
  Windows, a automação cria `codex.cmd` em `%PNPM_HOME%\bin`, apontando para o binário do pacote.
- Antigravity CLI: pacote WinGet `Google.AntigravityCLI`; uma instalação oficial já funcional é
  preservada mesmo quando não está registrada no WinGet.
- Pi: pacote oficial do registro npm `@earendil-works/pi-coding-agent`, instalado via pnpm global
  com scripts desabilitados. Não existe pacote WinGet adequado.
- Hermes: instalador PowerShell oficial fixado na tag `v2026.8.19`, com hash conhecido,
  `-SkipSetup` e `-SkipComputerUse`. Python 3.11 é instalado adicionalmente pelo mise, sem mudar
  o Python 3.14 global e sem permitir que uv baixe outro Python. O caminho desse interpretador é
  passado ao instalador apenas pela variável de processo `UV_PYTHON`, removida/restaurada ao fim;
  nenhum valor `UV_PYTHON` é persistido no usuário. Como o instalador reconstrói o PATH ao
  provisionar seu uv isolado, o diretório do Python 3.11 do mise também entra temporariamente no
  PATH do usuário e o valor anterior é restaurado em bloco `finally`.
  O diretório `hermes-agent\bin` não permanece no PATH público, pois exporia o trampoline quebrado. Durante
  o instalador, `MISE_LAYER1_NONINTERACTIVE=1` evita que os guardrails interativos interceptem
  comandos de dependência; o valor existe somente no processo e é restaurado ao final.
  Para processos que herdaram um PATH antigo de Explorer, Windows Terminal ou Codex Desktop, a
  automação também publica `hermes.cmd` em `%LOCALAPPDATA%\Microsoft\WinGet\Links`, diretório já
  estável no PATH do usuário. O shim apenas encaminha argumentos ao executável oficial e evita
  depender do diretório interno do instalador. A automação também envia ao Windows a notificação
  de mudança de ambiente e mantém um bloco mínimo nos perfis AllHosts do PowerShell 7 e do Windows
  PowerShell. Assim, uma nova aba recompõe os caminhos mesmo quando o processo principal do
  Windows Terminal ainda carrega um PATH antigo. Sessões que já estavam abertas antes da correção
  precisam ser fechadas e abertas novamente; `-NoProfile` exige reiniciar por completo o Windows
  Terminal para que ele herde o PATH persistente atualizado.
  Quando a instalação roda dentro do Codex Desktop empacotado, o Windows pode virtualizar
  `%LOCALAPPDATA%` para `Packages\OpenAI.Codex_*\LocalCache\Local`. A automação detecta esse caso,
  publica diretamente o diretório físico do executável oficial no PATH persistente e aponta o
  shim para ele. A simples existência de `hermes.cmd` não é considerada prova de funcionamento.
  O `hermes.exe` gerado pelo uv é um trampoline e conserva um caminho lógico que falha ao cruzar
  a virtualização MSIX (`uv trampoline failed to canonicalize script path`). Por isso, nesse caso
  o launcher gerenciado chama o entrypoint oficial diretamente pela venv existente:
  `venv\Scripts\python.exe -m hermes_cli.main`. Nenhuma dependência ou credencial é duplicada.
  Para evitar que PowerShell ou cmd escolham novamente um `hermes.exe` trampoline por precedência,
  a automação remove do PATH do usuário todas as entradas `hermes\bin` e
  `hermes\hermes-agent\bin`, inclusive sob `LocalCache`. A única rota pública suportada é
  `%LOCALAPPDATA%\Microsoft\WinGet\Links\hermes.cmd`.
  Nos perfis interativos, uma função gerenciada encaminha normalmente `hermes --version`, chat e
  demais subcomandos ao launcher canônico, mas bloqueia `hermes update` com aviso em português.
  O bloqueio não atua em scripts, CI ou quando `MISE_LAYER1_NONINTERACTIVE=1`; uma futura automação
  revisada também pode chamar diretamente `hermes.cmd` ou o entrypoint Python oficial.
- Grok Build: pacote oficial do registro npm `@xai-official/grok`, instalado via pnpm global.
  O pacote possui uma etapa `postinstall` necessária para materializar o executável, por isso ela
  é preservada. A automação não usa o instalador remoto alternativo, não executa login, não cria
  chaves e não escreve deliberadamente em `~/.grok/config.toml`. Assim como no Hermes, publica
  um `grok.cmd` em `%LOCALAPPDATA%\Microsoft\WinGet\Links`, encaminhando para o comando oficial
  em `%PNPM_HOME%\bin`; isso cobre processos que ainda herdaram um PATH anterior à Layer 1.

## Verificar

Abra um PowerShell novo e execute:

```powershell
.\scripts\07-verify-layer2-agent-clis.ps1
```

O verificador é somente leitura. Ele apresenta aplicativos desktop e CLIs em blocos separados,
mostra PATH, origem, método e versão quando disponíveis e marca o login como manual e não
verificado. Depois, autentique cada componente diretamente conforme sua documentação oficial.
Tokens e chaves não pertencem a esta automação.

## Common Agent Toolbox

O script `scripts\07-layer2-common-toolbox.ps1` instala somente ausências via WinGet e preserva
ferramentas funcionais sem atualizar. O verificador independente é
`scripts\07-verify-layer2-toolbox.ps1`.

- `rg`: busca rápida de texto; `fd`: busca rápida de arquivos;
- `jq`: JSON; `yq`: YAML;
- `bat`: visualização de arquivos; `delta`: visualização de diffs.

São comandos compartilhados por todos os agentes, sem configuração por projeto. A automação não
cria aliases para `cat` ou `git`. **RTK foi deliberadamente excluído.**

## Limites

Esta etapa não instala Paperclip, loopersai, ai-memory, RTK, ponytail, agentacct ou tokscale. O
bootstrap não cria links ou junções de skills. A sincronização já entregue é responsabilidade do
Agent Manager, preserva drift e nunca promove automaticamente skills geradas pelo Hermes.
