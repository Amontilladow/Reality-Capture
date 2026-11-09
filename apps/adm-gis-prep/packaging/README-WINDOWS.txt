M4 GIS Preparation - desktop program (Windows)
PROVISIONAL: NOT ADM-VALIDATED. Internal preliminary tool. It never approves a submission:
only the official ADM / DRM QC tool and review do that.

START
  1. Unzip this folder anywhere (for example C:\M4-GIS-Prep).
  2. Double-click m4adm.exe. The program opens in its own window on the conversion page. (A black messages window
     also opens and minimizes itself; leave it alone. If Windows has no built-in web view the page opens in your
     browser instead.)
     The first start takes up to a minute while Windows unpacks the program. If Windows SmartScreen
     warns about an unknown publisher, choose More info > Run anyway (the program is not code-signed).
  2b. If double-clicking m4adm.exe shows "Windows cannot access the specified device, path, or file", double-click
     Start-M4.bat instead. It clears Windows' "downloaded from the internet" mark on these files and starts the program.
  3. Leave the black window open while you work. Close it to stop the program.

CONVERT A FLOOR PLAN
  - Choose the drawing (DXF, or DWG when dwg2dxf.exe is in this folder), fill the fields, press
    "Convert to GIS draft".
  - Capitals are applied for you. Pick usage category, usage type and drawing type from the lists.
  - The result page shows what is still missing, the preliminary check in the official QC's terms, and
    the draft .dxf to download. Whatever the drawing cannot show stays empty: nothing is guessed.
  - Save the draft as DWG (AutoCAD SAVEAS, 2010 format) if the official QC needs a DWG.

WHERE YOUR WORK IS KEPT
  C:\Users\<you>\M4-GIS-Prep\uploads   your original drawings (never modified)
  C:\Users\<you>\M4-GIS-Prep\jobs      one folder per conversion: draft, report, audit trail

DWG FILES
  If dwg2dxf.exe (and the .dll files beside it) are next to m4adm.exe, DWG drawings open directly. Without them, save the drawing as DXF
  in AutoCAD first (SAVEAS, AutoCAD 2010 DXF).

SIZE
  No size limit on your own computer. A very large drawing can take several minutes and needs free memory
  (about 100 MB plus 9 MB per MB of DXF).

COMMAND LINE (optional)
  m4adm.exe convert "FIRST FLOOR.dxf" --zone "KHALIFA CITY" --sector SE45_01 --plot C8 --building 1 --floor F1
  m4adm.exe --help
