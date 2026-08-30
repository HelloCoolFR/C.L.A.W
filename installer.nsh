!macro customInstall
  DetailPrint "Cleaning up older installation files..."
  RMDir /r "$INSTDIR\resources\app.asar"
  RMDir /r "$INSTDIR\resources\app.asar.unpacked"
!macroend
