# Layer 1 reproducibility pilot

This project pins the four Layer 1 runtimes through mise and intentionally contains no dependency
tree. Run `scripts/01-verify-layer1-pilot.ps1`; it resolves every runtime through `mise which` and
executes the full check twice. The second pass must make no changes.
Shared download caches are allowed; project dependency directories must remain project-local.

Microsoft C++ Build Tools are optional. Install them only when a reviewed dependency requires native
Windows compilation and no compatible prebuilt artifact exists; AFD does not install or elevate for
them automatically.
