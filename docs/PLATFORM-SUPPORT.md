# Platform support

## Windows x64

Windows x64 is the fully validated product platform. Layer 1 installs or verifies Docker Desktop
through the machine-scoped WinGet package, which may request elevation, and installs the
integrity-pinned `@lavamoat/allow-scripts` CLI in the managed pnpm global directory. AFD does not
start Docker Desktop or change its terms, backend, or group membership. The PowerShell bootstrap,
Layer 1, Layer 2, doctor/fix, Agent Manager, backups, and verification are Windows-specific where
documented.

## Linux on WSL2

Ubuntu 26.04.1 LTS under WSL2 x86_64 is the validated Linux fixture. Layer 1 installs checksum-pinned
mise and uv in user scope, pins Python/Node/Go/Rust/pnpm and `@lavamoat/allow-scripts`, manages isolated Linux profile blocks,
tests hardlinks, and installs Docker Engine from Docker's signed Ubuntu repository through a separate
privileged step. Layer 2 installs the common toolbox through mise's GitHub backend and integrity-pinned
Node agent CLIs. Layer 3 uses the same portable recipe engine and resolves state under Linux `$HOME`.
The `herdr-workbench` recipe invokes the mise installed inside WSL2, never a Windows mise binary or
Windows Herdr installation. Native Linux shares this adapter but keeps an independent validation
claim and state root.

Docker is an independent Layer 1 host tool. Layers 1–3 are never run in containers. AFD does not add
the user to the `docker` group; daemon access remains privileged until separately reviewed. Native
Linux outside WSL is expected to use the same adapter, but current real validation evidence is WSL2.

## macOS

Layer 1 is implemented for macOS 14 or newer on Apple Silicon and Intel but remains unvalidated on
real hardware. The native adapter installs checksum-pinned mise and uv binaries for the detected
architecture, configures the shared runtime baseline, installs integrity-pinned
`@lavamoat/allow-scripts`, and manages bounded zsh profile blocks. The POSIX bootstrap supports
macOS using native `shasum` verification.

The Docker adapter downloads the architecture-specific Docker Desktop 4.89.0 DMG from Docker,
verifies its published SHA-256, verifies the mounted app signature, and requests macOS administrator
authorization only for Docker's installer. It does not pass license-acceptance or privileged-user
configuration flags and does not launch Docker Desktop. The user reviews the license and first-run
settings interactively.

Doctor/fix and Layer 1 verification are wired. Layer 2 automation is not implemented on macOS and
fails closed. These are implementation claims backed by static checks, shared unit tests, release
auditing, and package smoke tests—not a real-hardware compatibility claim.

Recipe v3 and `herdr-workbench` include macOS as an explicit target. The adapter uses macOS's own
Layer 1 mise state and enforces plugin platform declarations. This is an implementation boundary,
not evidence that Herdr or any declared plugin has passed real-hardware acceptance on macOS.
