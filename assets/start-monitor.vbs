' =====================================================================
'  Minecraft 服务器桌面监控 · 启动器（无黑窗口）
'  1) 先启动后台采集器  2) 再启动监控窗口
' =====================================================================
Option Explicit
Dim fso, shell, dir, monPs, pollPs
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
monPs = dir & "\McServerMonitor.ps1"
pollPs = dir & "\mcmon-poll.ps1"

If Not fso.FileExists(monPs) Then
    MsgBox "找不到 McServerMonitor.ps1", 16, "启动失败"
    WScript.Quit 1
End If

' 采集器（内部有单例锁，重复启动会自己退出）
If fso.FileExists(pollPs) Then
    On Error Resume Next
    shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & pollPs & """", 0, False
    On Error GoTo 0
End If

' 监控窗口
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & monPs & """", 0, False
