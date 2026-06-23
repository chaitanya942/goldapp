' Launches the New-CRM sync with NO visible console window.
' Wscript.Shell.Run intWindowStyle=0 => hidden; bWaitOnReturn=False => fire-and-forget.
CreateObject("Wscript.Shell").Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\chaithanya\goldapp\scripts\sync-new-crm.mjs""", 0, False
