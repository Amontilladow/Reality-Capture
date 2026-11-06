"""Entry point of the packaged desktop program (PyInstaller). Double-clicking it starts the screen in the browser."""
import sys

from m4adm.cli import main

if __name__ == "__main__":
    sys.exit(main())
