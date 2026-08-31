"""Activate the bounded AFD Windows compatibility surface for agentacct."""

from __future__ import annotations

import os
import sys
import types


if sys.platform == "win32":
    _original_os_open = os.open
    _store_dir = os.environ.get("AGENTACCT_STORE_DIR")
    _store_root = os.path.normcase(os.path.abspath(_store_dir)) if _store_dir else None

    def _afd_os_open(path, flags, mode=0o777, *, dir_fd=None):
        """Map managed-store directory fsync handles to the AFD ownership marker.

        Windows cannot open a directory with ``os.open(..., O_RDONLY)``. agentacct
        uses that POSIX pattern only to fsync directory metadata after an atomic
        replace. AFD redirects that bounded managed-store operation to its existing
        marker file; ordinary files and paths outside the managed store are unchanged.
        """

        candidate = os.fspath(path)
        if (
            _store_root
            and dir_fd is None
            and isinstance(candidate, str)
            and flags & (os.O_WRONLY | os.O_RDWR) == 0
            and os.path.isdir(candidate)
        ):
            resolved = os.path.normcase(os.path.abspath(candidate))
            try:
                inside_store = os.path.commonpath([_store_root, resolved]) == _store_root
            except ValueError:
                inside_store = False
            if inside_store:
                marker = os.path.join(_store_root, ".afd-root")
                return _original_os_open(
                    marker,
                    os.O_RDWR | getattr(os, "O_BINARY", 0),
                    mode,
                )
        return _original_os_open(path, flags, mode, dir_fd=dir_fd)

    os.open = _afd_os_open

    platform_support = types.ModuleType("agentacct.platform_support")

    def exit_if_unsupported_platform(_platform: str) -> None:
        """AFD owns native process control and file locking on Windows."""

    platform_support.exit_if_unsupported_platform = exit_if_unsupported_platform
    sys.modules["agentacct.platform_support"] = platform_support

    from afd_agentacct_windows import install as install_windows_importer_compat

    install_windows_importer_compat()
