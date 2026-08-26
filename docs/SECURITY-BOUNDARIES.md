# Segurança e limites

- Fontes oficiais, versões verificáveis, WhatIf e verificação separada.
- Dependências de projetos isoladas; nenhum token, login ou segredo gerenciado.
- Revisão explícita antes de futura sincronização.
- Skills geradas pelo Hermes não são confiáveis até promoção humana.

O projeto não oferece sandbox total nem audita toda dependência upstream. Scripts que pedem elevação,
alteram perfis, criam serviços ou escrevem fora do projeto exigem parada e revisão. Repositórios não
confiáveis devem usar ambiente descartável.

O CLI escreve somente em destinos allowlisted pelos adapters, oferece dry-run, preserva drift e cria
backup local em `%LOCALAPPDATA%\ai-workstation\backups` antes de anexar perfil a arquivo existente.
A fonte canônica nunca é junction de diretório de
agente; Hermes recebe cópia unidirecional, portanto não pode modificar o catálogo compartilhado.
