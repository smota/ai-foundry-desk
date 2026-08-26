# Layer 1 — Base de runtimes previsível

## Propósito

A Layer 1 fornece uma base nativa e reproduzível para projetos de Python, Node.js, Go e Rust no
Windows. Ela padroniza versões e caches sem transformar a máquina em um ambiente permissivo ou
misturar dependências entre projetos.

## Princípios

- **Configuração mínima necessária:** instalar apenas o que resolve uma necessidade atual.
- **Base nativa:** ferramentas do dia a dia rodam diretamente no Windows; ambientes isolados
  ficam reservados para código experimental ou não confiável.
- **Versões verificáveis:** versões globais formam uma base conhecida; cada projeto pode fixar
  sua própria versão em configuração versionada.
- **Caches compartilhados, dependências separadas:** artefatos podem ser deduplicados por cache,
  mas `.venv`, `node_modules` e arquivos de lock continuam pertencendo a cada projeto.
- **Compatibilidade sem permissividade:** suportar ecossistemas existentes não significa aceitar
  instalações globais, scripts remotos ou mudanças de sistema sem revisão.

## Ferramentas e responsabilidades

- **mise:** governa as versões de Python, Node.js, Go e Rust. A base adotada é Python 3.14,
  Node 24 LTS, Go 1.26 e Rust 1.98.0 fixo, com versões locais por projeto quando necessário.
- **uv:** gerencia Python, ambientes virtuais, resolução de dependências e cache compartilhado.
  O projeto mantém sua própria `.venv` e seu lockfile.
- **pnpm:** gerencia dependências Node.js com armazenamento endereçado por conteúdo. Cada projeto
  conserva seu `node_modules` e `pnpm-lock.yaml`, mesmo quando os pacotes físicos são reutilizados.

O cache reduz downloads e duplicação; ele não cria uma árvore global de dependências.

## Governança de runtimes

O `mise` é a fonte de verdade para versões de runtime. A configuração global oferece um padrão
conhecido, enquanto arquivos como `.mise.toml` registram exceções no próprio repositório. Toda
mudança deve ser confirmada com comandos de versão e com os arquivos de lock do projeto.

Guardrails planejados:

- `pip` deve operar dentro de um ambiente virtual; evitar `pip install` global.
- `npm install -g` deve ser exceção documentada; preferir ferramentas geridas ou dependências do
  projeto.
- `npx` pode baixar e executar código implicitamente; confirmar pacote e versão antes do uso e
  preferir executáveis já fixados no projeto.
- `fnm` não deve disputar a gestão do Node.js com o `mise`. Se for mantido por compatibilidade,
  sua precedência e seu escopo precisam ser explícitos; caso contrário, deve ser retirado do
  fluxo ativo.
- Não desabilitar políticas de execução, validações TLS, assinaturas ou controles de acesso como
  solução permanente para incompatibilidades.

## Isolamento por projeto

Cada repositório mantém suas versões declaradas, lockfiles, `.venv`, `node_modules`, variáveis em
arquivos ignorados pelo Git e diretórios de trabalho próprios. Credenciais não pertencem à
configuração global. Uma atualização em um projeto não deve alterar silenciosamente outro.

## Scripts open source

Scripts remotos não devem ser encaminhados diretamente do download para o shell. Antes de usar:

1. confirmar repositório, mantenedor, licença, release e documentação oficial;
2. fixar uma versão ou artefato verificável, preferencialmente com checksum ou assinatura;
3. ler o script e identificar downloads adicionais, elevação, persistência, telemetria e mudanças
   em `PATH`, perfil ou registro;
4. avaliar manutenção recente, issues relevantes e possibilidade de remoção ou rollback;
5. executar com o menor privilégio e o menor escopo necessários.

Repositórios ou instaladores não confiáveis devem ser avaliados em ambiente descartável, como
Windows Sandbox ou VM, sem credenciais pessoais, pastas sincronizadas ou acesso desnecessário à
rede. Esse ambiente é uma fronteira de avaliação, não a base diária da Layer 1.

## Plano em fases

1. **Inventário:** registrar Windows, shell, `PATH`, ferramentas existentes e conflitos como
   gerenciadores de Node concorrentes.
2. **Base:** instalar e validar `mise`, `uv` e `pnpm` por fontes oficiais.
3. **Runtimes:** configurar a baseline e confirmar Python, Node.js, Go, Rust e Cargo.
4. **Armazenamento:** confirmar NTFS e testar hardlinks para os caches CAS.
5. **Guardrails:** ajustar o perfil do shell e impedir instalações globais acidentais sem quebrar
   fluxos legítimos.
6. **Projeto piloto:** validar versões locais, lockfiles, ambientes isolados e reprodução em um
   repositório pequeno.
7. **Documentação:** registrar versões, decisões, exceções e procedimento de atualização.

## Configuração efetiva

- Baseline inicialmente validada em 26/08/2026 (os scripts/verificadores são a fonte atual): mise 2026.8.14, uv 0.12.6, pnpm 11.23.0,
  Python 3.14.7, Node.js 24.19.0 LTS, Go 1.26.7 e Rust/Cargo 1.98.0.
- O `mise` é instalado pelo WinGet e seus shims ficam em `%LOCALAPPDATA%\mise\shims`.
- O PATH persistente do usuário inclui os links do WinGet e os shims, permitindo uso também em
  processos não interativos que não carregam o perfil do PowerShell.
- O perfil ativa o `mise` em sessões PowerShell e contém orientações para `pip`, `npm`, `npx` e
  `fnm` apenas quando a chamada foi digitada interativamente. Scripts `.ps1`, CI e ferramentas de
  terceiros são encaminhados aos executáveis reais sem reescrita.
- `not_found_auto_install` fica desabilitado: um runtime ausente gera uma falha verificável, em
  vez de ser baixado implicitamente.
- `UV_NO_MANAGED_PYTHON=1` e `UV_PYTHON_DOWNLOADS=0` ficam persistidos no ambiente do usuário.
  Assim, o uv resolve o Python exposto pelo mise e falha claramente se ele não estiver
  disponível, sem baixar ou manter uma segunda instalação. `UV_SYSTEM_PYTHON` e `UV_PYTHON` não
  são definidos pela automação.
- `PNPM_HOME` aponta para `%LOCALAPPDATA%\pnpm`; o diretório é criado quando necessário e
  `%PNPM_HOME%\bin` entra no PATH persistente. A automação não executa `pnpm setup`, não permite
  que o pnpm edite perfis e não instala ferramentas globais adicionais.
- Antes de alterar um perfil existente, o instalador cria um snapshot em
  `%LOCALAPPDATA%\ai-workstation\backups\layer1-powershell-profile`. O bloco gerido fica entre
  marcadores claros e pode ser removido;
  o PATH pode ser revertido pelas configurações de variáveis de ambiente do usuário.

Os guardrails são orientação de terminal, não uma fronteira de segurança. Comandos explícitos
como `npm.cmd` continuam disponíveis para compatibilidade, e processos que não usam PowerShell
não passam por essas funções.

Para conferir apenas esta camada, abra um novo PowerShell e execute
`scripts\01-verify-layer1.ps1`. O verificador é somente leitura e exige as famílias de versão
acima; Rust permanece fixo exatamente em 1.98.0. Ele também confirma as duas políticas do uv,
o caminho do Python resolvido sob o diretório do mise, `PNPM_HOME`, seu diretório e seu `bin` no
PATH persistente.

No Windows PowerShell 5.1, o perfil usa somente shims porque a ativação dinâmica completa do
`mise` requer PowerShell 7 para todos os recursos. No PowerShell 7, a ativação completa é usada.
Compilar crates que dependem de código nativo ainda pode exigir o Microsoft C++ Build Tools;
isso não é instalado automaticamente pela Layer 1.

## Limites

A Layer 1 não cria contas, não manipula credenciais, não altera BIOS, não aprova scripts de
terceiros automaticamente e não promete isolamento de segurança para código hostil. Mudanças de
sistema exigem elevação explícita. Sandboxes, containers e VMs são adotados somente quando o
risco ou o experimento justificar. Atualizações futuras dependem de necessidade observada e de
nova revisão, não apenas da existência de uma versão mais recente.
