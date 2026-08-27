# Platform support

## Windows x64

Windows x64 is the fully validated product platform. The PowerShell bootstrap, Layer 1, Layer 2,
doctor/fix, Agent Manager, backups, and verification are Windows-specific where documented.

## Linux on WSL2

Ubuntu 26.04.1 LTS under WSL2 x86_64 is the validated Linux fixture. Layer 1 installs checksum-pinned
mise and uv in user scope, pins Python/Node/Go/Rust/pnpm, manages isolated Linux profile blocks,
tests hardlinks, and installs Docker Engine from Docker's signed Ubuntu repository through a separate
privileged step. Layer 2 installs the common toolbox through mise's GitHub backend and integrity-pinned
Node agent CLIs. Layer 3 uses the same portable recipe engine and resolves state under Linux `$HOME`.

Docker is an independent Layer 1 host tool. Layers 1–3 are never run in containers. AFD does not add
the user to the `docker` group; daemon access remains privileged until separately reviewed. Native
Linux outside WSL is expected to use the same adapter, but current real validation evidence is WSL2.

## macOS

macOS is experimental and unvalidated. The POSIX bootstrap detects Darwin and stops with an honest
status message. No macOS validation badge or support claim is made.
