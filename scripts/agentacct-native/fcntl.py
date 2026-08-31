"""Minimal Windows ``fcntl.flock`` compatibility for AFD-managed agentacct.

Windows does not provide Python's POSIX-only :mod:`fcntl` module.  agentacct
uses only ``flock`` and the four lock-operation constants, so AFD supplies the
smallest compatible surface and deliberately maps shared locks to exclusive
byte-range locks.  The stronger lock preserves correctness at the cost of
some concurrency.
"""

from __future__ import annotations

import msvcrt
import os


LOCK_SH = 1
LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8


def flock(file_descriptor: int, operation: int) -> None:
    """Lock the first byte of a file using the Windows CRT lock primitive."""

    position = os.lseek(file_descriptor, 0, os.SEEK_CUR)
    try:
        os.lseek(file_descriptor, 0, os.SEEK_SET)
        if operation & LOCK_UN:
            mode = msvcrt.LK_UNLCK
        elif operation & LOCK_NB:
            mode = msvcrt.LK_NBLCK
        else:
            mode = msvcrt.LK_LOCK
        msvcrt.locking(file_descriptor, mode, 1)
    finally:
        os.lseek(file_descriptor, position, os.SEEK_SET)
