import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Strip console.log/info/debug + debugger from production bundle (keeps console.error/warn)
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // แยก React ออกจากก้อนแอป — React ไม่เปลี่ยนตอน deploy งานประจำวัน
        // ชื่อไฟล์จึงคงเดิม เบราว์เซอร์ที่เคยโหลดแล้วไม่ต้องโหลดซ้ำ (ตั้ง immutable ไว้ 1 ปี)
        // ผลที่ได้จริงราว 45 KB ต่อ deploy ต่อเครื่อง ไม่ใช่ตัวใหญ่ แต่ฟรีและไม่เสี่ยง
        //
        // ⚠️ ห้ามเหมา node_modules ทั้งหมดเข้า vendor เด็ดขาด
        // three / xlsx / heic2any ถูก import แบบ dynamic ไว้ (รวมกัน ~2.4 MB)
        // ถ้าจับยัดเข้าก้อน vendor ที่ index import แบบ static มันจะกลายเป็นโหลดทันที
        // ทุกครั้งที่เปิดเว็บ = แย่กว่าเดิมหลายเท่า จึงระบุเฉพาะ react เท่านั้น
        // อย่างอื่น return undefined ให้ Rollup แบ่งตามเดิม
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          return;
        },
      },
    },
  },
  // Serve over plain http on the LAN so iPad/Safari can print to the http LAN
  // printer (https→http "mixed content" is blocked on iOS; http→http is allowed).
  // `host: true` binds 0.0.0.0 so the machine's LAN IP is reachable from the iPads.
  preview: {
    host: true,
    port: 8080,
  },
  server: {
    host: true,
    port: 8080,
  },
})
