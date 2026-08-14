Option Explicit

Dim shell, shortcut
Set shell = CreateObject("WScript.Shell")
Set shortcut = shell.CreateShortcut(WScript.Arguments(0))
shortcut.TargetPath = WScript.Arguments(1)
shortcut.WorkingDirectory = WScript.Arguments(2)
shortcut.IconLocation = WScript.Arguments(1) & ",0"
shortcut.Description = "DeepSeek Harness 桌面启动器"
shortcut.Save
