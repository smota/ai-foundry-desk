# Platform support

## Windows x64

Windows x64 is the fully validated product platform. The PowerShell bootstrap, Layer 1, Layer 2,
doctor/fix, Agent Manager, backups, and verification are Windows-specific where documented.

## Linux on WSL2

The POSIX bootstrap and portable CLI cycle were validated on Ubuntu 26.04.1 LTS under WSL2 x86_64.
Validation covered official Node.js 24.19.0 checksum verification, bootstrap dry-run, tarball checksum
verification, isolated-prefix installation, a no-profile shell, `afd --help`, `--version`,
`init --dry-run`, `status`, and the portable doctor response. Windows Layer 1 and Layer 2 adapters
remain fail-closed and were not applied in WSL. Native Linux workstation foundation and agent
bootstrap adapters remain future work.

## macOS

macOS is experimental and unvalidated. The POSIX bootstrap detects Darwin and stops with an honest
status message. No macOS validation badge or support claim is made.
