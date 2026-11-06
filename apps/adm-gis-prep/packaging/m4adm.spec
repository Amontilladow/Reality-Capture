# PyInstaller recipe for the desktop program: one file, console window kept open so messages stay visible.
#   pip install -r requirements.txt . pyinstaller==6.16.0
#   pyinstaller packaging/m4adm.spec        ->  dist/m4adm (m4adm.exe on Windows)
import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = os.path.abspath(os.path.join(SPECPATH, ".."))        # apps/adm-gis-prep
datas = [
    (os.path.join(root, "rules"), "rules"),                                          # the rule manifests and code lists
    (os.path.join(root, "src", "m4adm", "ui", "templates"), os.path.join("m4adm", "ui", "templates")),
    (os.path.join(root, "src", "m4adm", "report", "*.html"), os.path.join("m4adm", "report")),
]
datas += collect_data_files("pyproj")                                                # PROJ coordinate databases
hiddenimports = (collect_submodules("uvicorn") + collect_submodules("m4adm") + ["multipart", "python_multipart"])

a = Analysis(
    [os.path.join(SPECPATH, "m4adm_entry.py")],
    pathex=[os.path.join(root, "src")],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "matplotlib", "IPython"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="m4adm", console=True, upx=False)
