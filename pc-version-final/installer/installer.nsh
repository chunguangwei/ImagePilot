!macro _KillProcess PROCESS_NAME
  DetailPrint "尝试结束进程: ${PROCESS_NAME}"
  nsExec::ExecToLog 'taskkill /F /IM "${PROCESS_NAME}" /T'
!macroend

!macro customInit
  !insertmacro _KillProcess "ImagePilot.exe"
  !insertmacro _KillProcess "ImagePilot Helper.exe"
  !insertmacro _KillProcess "ImagePilot Helper (Renderer).exe"
  !insertmacro _KillProcess "ImagePilot Helper (GPU).exe"
  !insertmacro _KillProcess "ImagePilot Helper (Plugin).exe"
  !insertmacro _KillProcess "ImagePilot Updater.exe"
!macroend

