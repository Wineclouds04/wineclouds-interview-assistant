Option Explicit

' Double-click launcher for the local desktop app.
' WScript starts Python with a hidden console; the Electron window remains visible.
Dim shell, fso, root, pythonExe, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
pythonExe = "C:\Python314\python.exe"
If Not fso.FileExists(pythonExe) Then pythonExe = "python.exe"
scriptPath = fso.BuildPath(root, "quick-start.py")
command = Chr(34) & pythonExe & Chr(34) & " " & Chr(34) & scriptPath & Chr(34) & " --skip-install"

shell.CurrentDirectory = root
shell.Run command, 0, False
