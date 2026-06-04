@echo off
chcp 65001 >nul
REM ════════════════════════════════════════════════════════════════
REM  FOODCOST — LAN SERVER (เปิดแอปเป็น http:// บนวง LAN)
REM  ดับเบิลคลิกไฟล์นี้บน "เครื่องเซิร์ฟเวอร์" ที่อยู่วง WiFi เดียวกับ
REM  iPad และเครื่องพิมพ์ C300H — แล้วเปิด URL ที่ขึ้นบน iPad
REM  iPad จะสั่งพิมพ์เข้าเครื่องพิมพ์ LAN ได้ตรง (http -> http ไม่ติด
REM  mixed content เหมือนตอนเปิดผ่าน Vercel ที่เป็น https)
REM ════════════════════════════════════════════════════════════════
cd /d "%~dp0"
echo.
echo ===== FOODCOST LAN SERVER =====
echo.
echo [1/3] ดึงโค้ดล่าสุดจาก GitHub...
git pull
echo.
echo [2/3] ติดตั้ง/อัปเดต dependencies...
call npm install
echo.
echo [3/3] build + เปิดเซิร์ฟเวอร์ที่พอร์ต 8080 ...
echo      เปิด URL ที่ขึ้นว่า "Network:" บน iPad (เช่น http://192.168.1.x:8080)
echo.
call npm run lan
echo.
echo เซิร์ฟเวอร์หยุดทำงานแล้ว — กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
pause >nul
