#!/data/data/com.termux/files/usr/bin/sh
# ════════════════════════════════════════════════════════════════════════
#  FOODCOST — ตัวเรียกใช้งานตัวพิมพ์ผ่านคลาวด์ (Bootstrap Launcher)
#
#  ติดตั้งครั้งเดียว — แล้วไม่ต้องแตะ Termux อีกเลยตลอดไป
#  ทุกครั้งที่มีอัปเดตระบบ ตัว agent จะดาวน์โหลดเวอร์ชันใหม่ + รันใหม่เอง
#
#  วิธีใช้:   sh agent-run.sh <branchId>
#  ตัวอย่าง:  sh agent-run.sh 6
# ════════════════════════════════════════════════════════════════════════
termux-wake-lock 2>/dev/null
BR="${1:-6}"
URL="https://foodcost-eta.vercel.app/print-agent.js"
cd "$HOME" || exit 1

echo "════════════════════════════════════════"
echo " FOODCOST — ตัวเรียกใช้งานตัวพิมพ์ (อัปเดตเอง)"
echo " สาขา (branch): $BR"
echo " หยุดถาวร: กด Ctrl+C สองครั้งเร็วๆ"
echo "════════════════════════════════════════"

while true; do
  # ดาวน์โหลดเวอร์ชันล่าสุดเสมอก่อนรัน (กันโหลดพลาดด้วยไฟล์เก่า)
  if curl -fsS -o print-agent.new.js "$URL" 2>/dev/null && [ -s print-agent.new.js ]; then
    mv -f print-agent.new.js print-agent.js
    echo "✅ โหลดเวอร์ชันล่าสุดแล้ว"
  else
    echo "⚠️  โหลดไม่ได้ (เช็คเน็ต) — ใช้ไฟล์เดิมที่มีอยู่"
    rm -f print-agent.new.js 2>/dev/null
  fi

  if [ -f print-agent.js ]; then
    node print-agent.js "$BR"
  else
    echo "❌ ยังไม่มีไฟล์ print-agent.js และโหลดไม่ได้ — รอเน็ต..."
  fi

  echo ""
  echo "↻ agent หยุด/อัปเดต — กำลังเริ่มใหม่ใน 5 วินาที (กด Ctrl+C ค้างเพื่อหยุดถาวร)"
  sleep 5
done
