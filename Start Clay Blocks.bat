@echo off
cd /d "%~dp0"
where py >nul 2>&1 && py -3 serve.py && goto :eof
where python >nul 2>&1 && python serve.py && goto :eof
echo Python 3 was not found.
echo Install Python 3 from https://www.python.org/ then double-click this file again.
pause
