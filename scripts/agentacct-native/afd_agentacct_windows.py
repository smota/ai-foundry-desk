"""Pinned Windows source-traversal compatibility for agentacct 0.10.1.

agentacct's local importers deliberately use POSIX descriptor-relative walks
(``dir_fd`` plus ``O_NOFOLLOW``). Windows does not implement those primitives.
This module preserves the trust boundary with component-by-component ``lstat``
checks, symlink/junction rejection, absolute read-only opens, and before/after
fingerprint validation. It patches only the three importer helpers that require
the unavailable POSIX surface.
"""

from __future__ import annotations

import importlib.metadata
import os
from pathlib import Path
import stat


EXPECTED_AGENTACCT_VERSION = "0.10.1"


def _is_link_or_junction(path: Path, observed: os.stat_result) -> bool:
    if stat.S_ISLNK(observed.st_mode):
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def _absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path.expanduser())))


def _assert_directory_chain(path: Path) -> os.stat_result:
    if not path.is_absolute():
        raise OSError("source directory is not absolute")
    current = Path(path.anchor)
    observed = current.lstat()
    if _is_link_or_junction(current, observed) or not stat.S_ISDIR(observed.st_mode):
        raise OSError("source directory root is unsafe")
    for component in path.parts[1:]:
        current = current / component
        observed = current.lstat()
        if _is_link_or_junction(current, observed) or not stat.S_ISDIR(observed.st_mode):
            raise OSError("source directory component is unsafe")
    return observed


def install() -> None:
    actual = importlib.metadata.version("agentacct")
    if actual != EXPECTED_AGENTACCT_VERSION:
        raise RuntimeError(
            f"AFD Windows importer compatibility requires agentacct {EXPECTED_AGENTACCT_VERSION}; got {actual}"
        )

    import agentacct.client_usage as usage

    def windows_claude_file_fingerprint(observed: os.stat_result):
        # Windows reports a different st_ctime_ns for the same file through
        # lstat() and fstat(). Preserve tuple shape while basing the final lane
        # on stable modification time; device, inode, size, and mtime still
        # detect replacement or content churn.
        modified = int(observed.st_mtime_ns)
        return (
            int(observed.st_dev),
            int(observed.st_ino),
            int(observed.st_size),
            modified,
            modified,
        )

    usage._claude_file_fingerprint = windows_claude_file_fingerprint

    def open_directory_root_fd_no_follow(root: Path) -> tuple[int, os.stat_result]:
        root_path = _absolute(root)
        root_stat = _assert_directory_chain(root_path)
        token_fd = os.open(os.devnull, os.O_RDONLY | getattr(os, "O_BINARY", 0))
        return token_fd, root_stat

    def open_regular_source_file_fd(
        path: Path,
        *,
        root: Path,
    ) -> tuple[int, Path, Path, os.stat_result]:
        root_path = _absolute(root)
        file_path = _absolute(path)
        _assert_directory_chain(root_path)
        try:
            relative = file_path.relative_to(root_path)
        except ValueError as exc:
            raise OSError("local source escaped configured root") from exc
        parts = relative.parts
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise OSError("local source path is invalid")
        current = root_path
        for component in parts[:-1]:
            current = current / component
            observed = current.lstat()
            if _is_link_or_junction(current, observed) or not stat.S_ISDIR(observed.st_mode):
                raise OSError("local source directory component is unsafe")
        first = file_path.lstat()
        if _is_link_or_junction(file_path, first) or not stat.S_ISREG(first.st_mode):
            raise OSError("local source is not a regular file")
        file_fd = os.open(file_path, os.O_RDONLY | getattr(os, "O_BINARY", 0))
        try:
            opened = os.fstat(file_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or int(opened.st_dev) != int(first.st_dev)
                or int(opened.st_ino) != int(first.st_ino)
                or stat.S_IFMT(opened.st_mode) != stat.S_IFMT(first.st_mode)
            ):
                raise OSError("local source changed during open")
            return file_fd, root_path, file_path, opened
        except BaseException:
            os.close(file_fd)
            raise

    def discover_source_tree_files_no_follow(
        root: Path,
        *,
        root_fd: int,
        include_file,
        unsafe_code: str,
        traversal_code: str,
        changed_code: str,
        skipped_dir_symlinks: list[Path] | None = None,
    ):
        del root_fd
        root_path = _absolute(root)
        _assert_directory_chain(root_path)
        candidates = []

        def changed():
            return usage._ClientUsageDiscoveryReadError(changed_code)

        def walk(directory: Path, relative: Path) -> None:
            before_stat = directory.lstat()
            if _is_link_or_junction(directory, before_stat):
                raise usage._ClientUsageDiscoveryReadError(unsafe_code)
            before = usage._directory_tree_fingerprint(before_stat)
            try:
                entries = sorted(list(os.scandir(directory)), key=lambda entry: entry.name)
            except OSError as exc:
                raise usage._ClientUsageDiscoveryReadError(traversal_code) from exc
            for entry in entries:
                name = entry.name
                if not name or name in {".", ".."} or "/" in name or "\\" in name:
                    raise usage._ClientUsageDiscoveryReadError(unsafe_code)
                included = include_file(name)
                child_relative = relative / name
                child = root_path / child_relative
                try:
                    first = child.lstat()
                except OSError as exc:
                    raise usage._ClientUsageDiscoveryReadError(traversal_code) from exc
                if _is_link_or_junction(child, first):
                    if included:
                        candidates.append(usage._NoFollowTreeFile(path=child, fingerprint=None))
                        continue
                    try:
                        target_is_dir = child.is_dir()
                    except OSError:
                        continue
                    if target_is_dir:
                        if skipped_dir_symlinks is not None:
                            skipped_dir_symlinks.append(child)
                            continue
                        raise usage._ClientUsageDiscoveryReadError(unsafe_code)
                    continue
                if stat.S_ISDIR(first.st_mode):
                    walk(child, child_relative)
                elif stat.S_ISREG(first.st_mode) and included:
                    file_fd = os.open(child, os.O_RDONLY | getattr(os, "O_BINARY", 0))
                    try:
                        opened = os.fstat(file_fd)
                        if (
                            not stat.S_ISREG(opened.st_mode)
                            or usage._claude_file_fingerprint(opened)
                            != usage._claude_file_fingerprint(first)
                        ):
                            raise changed()
                    finally:
                        os.close(file_fd)
                elif included:
                    candidates.append(usage._NoFollowTreeFile(path=child, fingerprint=None))
                else:
                    continue
                try:
                    final = child.lstat()
                except OSError as exc:
                    raise changed() from exc
                if usage._directory_tree_fingerprint(final) != usage._directory_tree_fingerprint(first):
                    raise changed()
                if stat.S_ISREG(final.st_mode) and included:
                    candidates.append(
                        usage._NoFollowTreeFile(
                            path=child,
                            fingerprint=usage._claude_file_fingerprint(final),
                        )
                    )
            after_stat = directory.lstat()
            if (
                _is_link_or_junction(directory, after_stat)
                or usage._directory_tree_fingerprint(after_stat) != before
            ):
                raise changed()

        walk(root_path, Path())
        return candidates

    def open_claude_transcript_fd(
        path: Path,
        *,
        projects_root: Path,
        projects_root_fd: int | None = None,
    ) -> tuple[int, os.stat_result]:
        del projects_root_fd
        try:
            file_fd, _root_path, _file_path, file_stat = open_regular_source_file_fd(
                path,
                root=projects_root,
            )
            return file_fd, file_stat
        except OSError as exc:
            raise usage._ClaudeTranscriptUnsafePathError(
                "claude transcript failed the Windows no-link source boundary"
            ) from exc

    usage._open_directory_root_fd_no_follow = open_directory_root_fd_no_follow
    usage._open_regular_source_file_fd = open_regular_source_file_fd
    usage._discover_source_tree_files_no_follow = discover_source_tree_files_no_follow
    usage._open_claude_transcript_fd = open_claude_transcript_fd
