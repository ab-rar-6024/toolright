"""Python launcher for the Toolright CLI.

Toolright is a Node.js tool (https://www.npmjs.com/package/toolright). This package
exists so that ``pip install toolright`` gives you a ``toolright`` command. It does not
reimplement anything: it runs the npm package of the SAME version through ``npx``.

Requirements: Node.js 20+ (which provides ``npx``) on your PATH.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import List, Optional, Sequence

__version__ = "0.0.3"

NPM_PACKAGE = "toolright"
_GUARD = "TOOLRIGHT_PY_LAUNCHER"


def build_command(npx: str, args: Sequence[str]) -> List[str]:
    """The exact command we run. The npm version is pinned to this package's version."""
    return [npx, "--yes", f"{NPM_PACKAGE}@{__version__}", *args]


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    if os.environ.get(_GUARD):
        sys.stderr.write("toolright: launcher recursion detected; refusing to continue.\n")
        return 1

    npx = shutil.which("npx")
    if shutil.which("node") is None or npx is None:
        sys.stderr.write(
            "toolright needs Node.js 20+ (it provides `npx`), and it was not found on your PATH.\n"
            "Install Node.js from https://nodejs.org, then run this command again.\n"
        )
        return 127

    env = dict(os.environ)
    env[_GUARD] = "1"
    try:
        # A list, never a shell string: arguments are passed through untouched.
        return subprocess.call(build_command(npx, args), env=env)
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        sys.stderr.write(f"toolright: could not start npx: {exc}\n")
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
