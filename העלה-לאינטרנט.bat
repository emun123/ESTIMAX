@echo off
chcp 65001 >nul
title ESTIMAX - העלאה לאינטרנט
cd /d "%~dp0"

echo.
echo ══════════════════════════════════════════════
echo    ESTIMAX - העלאה לאינטרנט
echo ══════════════════════════════════════════════
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [!] git לא מותקן במחשב.
  echo     הורד מ: https://git-scm.com/download/win
  echo     או השתמש ב-GitHub Desktop שכבר מותקן אצלך.
  echo.
  pause
  exit /b 1
)

echo [1/3] מוסיף את כל הקבצים החדשים...
git add -A
if errorlevel 1 goto fail

echo [2/3] יוצר גרסה...
git commit -m "PWA + Supabase sync: schema, API layer, cloud bridge, offline support" 2>nul
if errorlevel 1 echo      (אין שינויים חדשים - ממשיך)

echo [3/3] מעלה ל-GitHub...
git push
if errorlevel 1 goto fail

echo.
echo ══════════════════════════════════════════════
echo    הועלה בהצלחה
echo ══════════════════════════════════════════════
echo.
echo נותרו שני דברים ב-GitHub (פעם אחת בלבד):
echo.
echo   1. Settings ^> Pages
echo      Source: Deploy from a branch
echo      Branch: main   Folder: /docs
echo      Save
echo.
echo   2. תוך כדקה האתר יהיה זמין בכתובת:
echo      https://emun123.github.io/ESTIMAX/
echo.
echo פותח את עמוד ההגדרות...
start https://github.com/emun123/ESTIMAX/settings/pages
echo.
pause
exit /b 0

:fail
echo.
echo [!] משהו נכשל. אם ההעלאה ביקשה סיסמה - השתמש ב-GitHub Desktop במקום:
echo     File ^> Add Local Repository ^> בחר את התיקייה הזו ^> Commit ^> Push
echo.
pause
exit /b 1
