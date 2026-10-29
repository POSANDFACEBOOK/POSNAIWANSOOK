-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ลายเซ็นของบรอดแคสต์ LINE ที่ตั้งเวลาส่ง (28 ต.ค. 69)
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้ — IF NOT EXISTS)
--
-- ทำไม: /api/broadcast-cron เคยส่งทุกแถว crm_broadcasts ที่ status='scheduled'
-- ตารางนี้เขียนได้ด้วย anon key (ระบบปิด RLS ทุกตารางโดยเจตนา) ⟹ ใครก็เพิ่มแถวเองแล้วให้ระบบยิงข้อความ
-- ถึงเพื่อนไลน์ทุกคนของสาขาได้ โดยไม่ต้องรู้ BROADCAST_KEY
-- ตอนนี้ /api/line-broadcast ลงลายเซ็น (HMAC ด้วย BROADCAST_KEY) ในคอลัมน์ sig ตอนตั้งเวลา
-- และ /api/broadcast-cron ส่งเฉพาะแถวที่ลายเซ็นตรง แถวที่ไม่ตรงถูกปิดเป็น status='rejected' (ไม่ส่ง)
--
-- ก่อนรัน: "ส่งทันที" ใช้ได้ตามปกติ · "ตั้งเวลาส่ง" จะขึ้นข้อความว่าตั้งไม่สำเร็จ (ไม่มีอะไรถูกส่งผิด)
-- ตารางเดิม → สำรองข้อมูลรายวันครอบคลุมเอง (สำรองทั้งแถว)
-- ══════════════════════════════════════════════════════════════════════════

alter table public.crm_broadcasts add column if not exists sig text;

-- ระบบนี้ออกแบบให้ปิด RLS ทุกตาราง + ให้สิทธิ์ Data API ชัดๆ (กับดัก RLS/GRANT ดู memory rls_trap)
alter table public.crm_broadcasts disable row level security;
grant select, insert, update, delete on table public.crm_broadcasts to anon, authenticated, service_role;

-- 29 ต.ค. 69: ถ้าคอลัมน์ status มี CHECK แบบ "status in (...)" ที่ยังไม่รับ 'rejected' → สร้างใหม่ชื่อเดิม ค่าเดิมครบ + 'rejected'
-- ไม่งั้นแถวลายเซ็นไม่ตรงปิดเป็น rejected ไม่ได้ ค้าง scheduled ให้ cron หยิบซ้ำทุกรอบ
-- แตะเฉพาะ CHECK ที่อ้างคอลัมน์ status คอลัมน์เดียว และเป็นรายการค่าล้วน (status in (...) / status = .. or status = ..)
-- แบบอื่นไม่แตะ ขึ้น NOTICE ให้ดูเอง · รันซ้ำได้: CHECK ที่มี 'rejected' แล้วข้าม · ไม่มี CHECK = ไม่ทำอะไร
-- ⚠️ tools/check-code.mjs ดึงนิพจน์ regex 3 ตัวในบล็อกนี้ไปลองกับ CHECK ทุกรูปแบบ — แก้ต้องรันด่านตรวจ
do $$
declare c record; vals text;
begin
  for c in
    select con.conname, con.convalidated, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    where con.conrelid = 'public.crm_broadcasts'::regclass and con.contype = 'c'
      and con.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.crm_broadcasts'::regclass and a.attname = 'status' and not a.attisdropped)]
  loop
    if c.def ~ '''rejected''' then continue; end if;
    -- '' = ค่ามีเครื่องหมายคำพูด · { = ค่าเป็นก้อนอาร์เรย์ '{a,b}'::text[] (ตัดค่าในเครื่องหมายคำพูดแล้วผ่านรายการคำ แต่ดึงค่าได้เป็น "{a,b}" ก้อนเดียว = ค่าเดิมหาย) → ไม่แตะ (ตรวจทาน 29 ต.ค. 69)
    if c.def ~ '''''|\{' or regexp_replace(c.def, '''[^'']*''', '', 'g') !~ '^(CHECK|status|ANY|ARRAY|OR|text|character|varying|\[|\]|\s|=|:|\(|\)|,)*$' then
      raise notice 'crm_broadcasts: CHECK % ไม่ใช่แบบรายการค่า status — ไม่แตะ (ถ้าไม่รับ ''rejected'' ต้องแก้เอง): %', c.conname, c.def;
      continue;
    end if;
    select string_agg(quote_literal(x), ', ') into vals from (select (regexp_matches(c.def, '''([^'']*)''', 'g'))[1] as x) s;
    if vals is null then raise notice 'crm_broadcasts: CHECK % ไม่มีรายการค่า — ไม่แตะ: %', c.conname, c.def; continue; end if;
    execute format('alter table public.crm_broadcasts drop constraint %I', c.conname);
    execute format('alter table public.crm_broadcasts add constraint %I check (status in (%s, %L))%s', c.conname, vals, 'rejected', case when c.convalidated then '' else ' not valid' end);
    raise notice 'crm_broadcasts: CHECK % รับ ''rejected'' แล้ว', c.conname;
  end loop;
end $$;

-- ให้ API (PostgREST) เห็นคอลัมน์ใหม่ทันที ไม่ต้องรอ
notify pgrst, 'reload schema';

-- ตรวจผล (อ่านอย่างเดียว):
--   GET https://niplvsfxynrufiyvbwme.supabase.co/rest/v1/crm_broadcasts?select=id,status,sig&limit=1
--   ต้องได้ [] หรือแถวกลับมา ไม่ใช่ error "column ... does not exist"
-- ดู CHECK ที่เหลือบนตาราง (ควรไม่มี หรือมี 'rejected' อยู่ในรายการแล้ว · ถ้าขึ้น NOTICE "ไม่แตะ" ให้ดูตรงนี้):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.crm_broadcasts'::regclass and contype = 'c';
