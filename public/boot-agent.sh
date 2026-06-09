#!/data/data/com.termux/files/usr/bin/sh
# ════════════════════════════════════════════════════════════════════════
#  FOODCOST — สคริปต์เปิดตัวพิมพ์อัตโนมัติตอนมือถือบูต (Termux:Boot)
#  วางไว้ที่ ~/.termux/boot/  → ทุกครั้งที่มือถือเปิด ตัวพิมพ์จะรันเองทันที
# ════════════════════════════════════════════════════════════════════════
termux-wake-lock 2>/dev/null
cd "$HOME" || exit 1
# โหลดตัวเรียกใช้งานล่าสุด (เผื่อยังไม่มี/มีอัปเดต) แล้วรัน — agent-run.sh จะวนโหลด print-agent.js ล่าสุดให้เอง
curl -fsS -o agent-run.sh "https://foodcost-eta.vercel.app/agent-run.sh" 2>/dev/null
sh agent-run.sh 6
