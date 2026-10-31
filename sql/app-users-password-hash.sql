-- ════════════════════════════════════════════════════════════════════════
-- ซ่อนรหัสผ่านผู้ใช้ + เก็บเป็น bcrypt (31 ต.ค. 69)
--
-- ปัญหา: ตาราง app_users อ่านได้ด้วยคีย์สาธารณะที่ฝังอยู่ในไฟล์เว็บ (ระบบนี้ปิด RLS ทั้งฐานโดยตั้งใจ)
--   และรหัสผ่านเก็บเป็นตัวหนังสือล้วน · แอปเดิมดึงทั้งตารางตอนเปิดทุกเครื่อง ⟹ ทุกเครื่อง/ทุกคนที่เปิดเว็บได้
--   รหัสผ่านของทุกคน (รวมแอดมิน) ไปด้วย · ไฟล์สำรองใน Google Drive ก็มีรหัสผ่านทุกคน
--
-- ⚠️⚠️ อ่านก่อนรัน — ส่วนรหัสผ่านของไฟล์นี้ย้อนไม่ได้ (bcrypt ทางเดียว):
--   • ห้ามรันก่อนแอปเวอร์ชันใหม่ขึ้นจริง — ทำข้อ ② ให้ผ่านก่อนทุกครั้ง ("กด deploy แล้ว" ยังไม่พอ)
--   • หลังรันไฟล์นี้ ห้าม Instant Rollback / Promote / redeploy Vercel ไปเวอร์ชันก่อน 31 ต.ค. 69 และห้าม git revert ย้อนผ่านจุดนี้
--     แอปรุ่นเก่าเทียบรหัสตัวหนังสือตรงๆ ⟹ หลังบ้านทุกคนเข้าระบบไม่ได้ (ขึ้น "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้") และไฟล์ถอยกลับก็แก้ไม่ได้
--     ทางแก้ทางเดียว = ขึ้นโค้ดที่มี rpc/app_login (31 ต.ค. 69 ขึ้นไป) · จอขาย POS (PIN) และหน้าลูกค้าไม่โดน
--   • จอที่ยังเป็นโค้ดเก่าขึ้น "grant all on table public.app_users …" = ห้ามรันเด็ดขาด (เปิดรหัสทุกคนอีก) แค่รีเฟรชจอนั้น
--
-- ไฟล์นี้ทำ:
--   0) password ว่างได้ — ธุรกรรมสั้นแยกต่างหาก: ALTER ล็อกทั้งตาราง (อ่านก็ต้องรอ) ห้ามถือไว้จนจบไฟล์
--      ไม่งั้นเข้าระบบ/โหลดผู้ใช้/สัญญาณชีพค้างทั้งร้านระหว่างเข้ารหัส · ข้อนี้ไม่มีผลกับแอปรุ่นไหนเลย (รุ่นเก่าก็ใช้ได้)
--   ธุรกรรมหลัก — พังหรือตรวจไม่ผ่านตรงไหน ย้อนกลับทั้งหมด ฐานเหมือนไม่เคยรัน (แอปยังเข้าระบบได้ทางเดิม):
--   1) pgcrypto (Supabase ติดตั้งไว้ใน schema extensions อยู่แล้ว)
--   2) ตรวจก่อนแตะรหัส: trigger ทำงานปกติ · ไม่มี trigger อื่นที่จะคัดลอกรหัสเดิมไปเก็บ · ไม่มี view (สิทธิ์เจ้าของ) อ้าง app_users
--      · คอลัมน์ password ยาวพอเก็บ bcrypt (60 ตัว)
--   3) ตัวกัน (trigger) เข้ารหัส bcrypt ให้ทุกครั้งที่มีการเขียนรหัสที่ยังไม่ใช่ bcrypt
--      ⟹ หน้า ตั้งค่า → ผู้ใช้ ส่งรหัสใหม่เป็นตัวหนังสือผ่าน HTTPS ได้เหมือนเดิม ฐานเข้ารหัสก่อนเก็บ
--   4) เข้ารหัสรหัสผ่านเดิมทุกแถวทีเดียว (ผ่านตัวกันข้อ 3) — ทุกคนใช้รหัสเดิมเข้าระบบได้ตามปกติ
--   5) ฟังก์ชัน app_login(ชื่อ, รหัส) — เทียบ bcrypt ในฐาน คืนเฉพาะ 8 คอลัมน์ที่ไม่ใช่รหัสผ่าน
--   6) ถอดสิทธิ์อ่านทั้งตารางจาก anon/authenticated แล้วให้อ่านได้เฉพาะ 8 คอลัมน์ (ไม่มี password)
--      รายชื่อคอลัมน์ต้องตรงกับ APP_USER_COLS ในแอป/ตัวสำรอง/ตัวกู้คืน (มีด่านใน tools/check-code.mjs)
--   7) บอก PostgREST ให้โหลดโครงสร้างใหม่ทันที
--   8) ตรวจผล: แถวที่ยังไม่เข้ารหัสต้องเป็น 0 · anon ต้องอ่าน password ไม่ได้ · anon ต้องอ่าน 8 คอลัมน์และเรียก app_login ได้
--   9) ทดลองเข้าระบบจริงด้วยผู้ใช้ทดลอง (เพิ่ม → เข้าได้ → รหัสผิดเข้าไม่ได้ → แก้รหัส → ปิดใช้ → ล้างรหัส) แล้วโยนทิ้ง
--      เดิมตรวจแค่ "ชื่อที่ไม่มีอยู่ต้องไม่ได้แถว" — ถ้าเข้ารหัสแล้วเทียบไม่ตรงจริง ไฟล์ก็ผ่าน ทุกคนเข้าระบบไม่ได้ถาวร
--   (ไม่ผ่านข้อไหน = ย้อนกลับทั้งหมด) · ไม่พิมพ์ค่ารหัสผ่านใดๆ ออกมา มีแต่จำนวน/จริง-เท็จ
--
-- ลำดับที่ต้องทำ (สำคัญ):
--   ① ขึ้นระบบแอปเวอร์ชันใหม่ก่อน (deploy) — แอปใหม่เข้าระบบได้ทั้งก่อนและหลังรันไฟล์นี้
--      (ถาม app_login ก่อน · ฐานยังไม่มีฟังก์ชัน = เทียบรหัสแบบเดิมแต่ไม่ขอคอลัมน์ password กลับมา)
--   ② เช็กว่าเว็บจริงเป็นโค้ดใหม่แล้ว (บังคับ): ไฟล์ assets/index-*.js ของ https://foodcost-eta.vercel.app ต้องมีคำว่า rpc/app_login
--      และต้องไม่มี app_users?username=eq. · แล้วรอให้ทุกเครื่องโหลดแอปใหม่ (หลังบ้าน/จอขายขึ้นแถบ "มีระบบเวอร์ชันใหม่แล้ว"
--      ภายใน ~2 นาที → แตะแถบ · หน้าเข้าสู่ระบบไม่มีแถบนี้ เครื่องที่เปิดค้างไว้ต้องรีเฟรช/ปิดเปิดแอปเอง)
--      ดู Supabase → Logs → API กรอง /rest/v1/app_users: ยังมีคำขอ app_users?order=id.asc / app_users?username=eq. /
--      select=id,active,role,perms,name,username,allowed_branches = ยังมีเครื่องโค้ดเก่า ห้ามรันต่อ
--   ③ ตอนร้านว่าง: Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run (รันซ้ำได้ ไม่เข้ารหัสซ้ำ)
--      ขึ้นหน้าต่างเตือน destructive operation (เพราะมี drop function / drop not null) = กด Run ต่อได้
--      ขึ้น error = ไม่มีอะไรถูกแก้ (ยกเว้นข้อ 0 ซึ่งไม่มีผลกับแอป) · ถ้ารอบต่อไปขึ้น current transaction is aborted ให้รัน rollback; ก่อน
--      (หน้า SQL Editor โชว์แค่ตารางผลท้ายสุดกับ error — ข้อความ notice ระหว่างทางไม่โชว์ ของสำคัญอยู่ในตารางผลแล้ว)
--   ④ ดูตารางผลท้ายสุด: not_bcrypt = 0 · anon_reads_password = false · anon_reads_id = true · login_fn = true
--      active_no_password = คนที่ใช้งานอยู่แต่ไม่มีรหัส (เข้าระบบไม่ได้ ต้องตั้งรหัสใหม่) · check_manually ว่าง (NULL) = ไม่มีอะไรต้องดูเพิ่ม
--   ⑤ ภายใน 1 นาที: เรียก rpc/app_login ด้วยชื่อปลอมต้องได้ 200 [] (ได้ 404 PGRST202 = รัน notify pgrst, 'reload schema'; อีกครั้ง)
--      แล้วลองเข้าระบบด้วยบัญชีจริง 1 บัญชี
--      (ไม่บังคับ) เปิดแท็บ SQL ใหม่ รัน vacuum public.app_users; คำสั่งเดียว — ล้างแถวรหัสตัวหนังสือเก่าที่ค้างในดิสก์
--      (วางรวมในไฟล์นี้ไม่ได้: VACUUM รันในธุรกรรมไม่ได้) · ทางแก้จริงยังเป็น "เปลี่ยนรหัสทุกคน" ด้านล่าง
-- ถอยกลับ (ฉุกเฉินเท่านั้น): sql/app-users-password-hash-rollback.sql — คืนสิทธิ์อ่านทั้งตาราง (เปิด bcrypt ให้ทุกเครื่องอีก)
--   แอปรุ่นเก่ายังเข้าระบบไม่ได้แม้ถอยแล้ว
--
-- ความเสี่ยงที่ยังเหลือ (ไม่ได้แก้ในไฟล์นี้):
--   • คีย์สาธารณะยังเพิ่ม/แก้/ลบแถว app_users ได้ (RLS ปิด) รวม role/perms/password — คนที่มีคีย์ตั้งตัวเองเป็นแอดมิน
--     หรือเปลี่ยนรหัสคนอื่นได้ (หน้า ตั้งค่า → ผู้ใช้ ยังเขียนผ่านคีย์นี้) — แก้จริงต้องย้ายงานเขียนผู้ใช้ไปฟังก์ชันที่ตรวจตัวตน
--   • restore_table (security definer) ยังเรียกได้ด้วยคีย์สาธารณะ โหมด replace ล้างแล้วเขียน app_users ใหม่ได้ทั้งตาราง
--   • app_login เรียกได้ไม่จำกัดครั้ง (เดารหัสได้ แต่ bcrypt ทำให้ช้าลงครั้งละหลายสิบมิลลิวินาที และกินแรงฐาน)
--   • ไฟล์สำรองเก่าใน Drive (ก่อน 31 ต.ค. 69) ยังมีรหัสผ่านตัวหนังสือ (ตั้งแต่แอป 31 ต.ค. 69 โหลดได้เฉพาะคนถือ BACKUP_ADMIN_KEY
--     — เดิม /api/drive-view ส่งให้ใครก็ได้) · รหัสทุกคนเคยไปถึงทุกเครื่องมาแล้ว
--     · Supabase API logs เก็บ URL เข้าระบบแบบเดิม (password=eq.<รหัส>) ไว้ตามอายุ log
--     ⟹ หลังรันไฟล์นี้ ต้องเปลี่ยนรหัสทุกคน แอดมินก่อน (ตั้งค่า → ผู้ใช้ → ✏️ → พิมพ์รหัสใหม่)
--   • คอลัมน์ใหม่ที่เพิ่มใน app_users ภายหลัง anon อ่านไม่ได้จนกว่าจะ grant select (ชื่อคอลัมน์) — ห้าม grant select ทั้งตาราง
--     (api/backup.js เช็กทุกคืนว่า password ยังอ่านไม่ได้ — หลุดเมื่อไหร่ แจ้งแอดมิน + หน้าสำรองข้อมูลขึ้นเตือน · tools/check-data.mjs ข้อ 22 เช็กแบบเดียวกัน)
-- ════════════════════════════════════════════════════════════════════════

-- 0) password ว่างได้ — ไฟล์สำรองตั้งแต่ 31 ต.ค. 69 ไม่มีรหัสผ่าน กู้คืนแล้วต้องเขียนแถวได้
--    (ว่าง = คนนั้นเข้าระบบไม่ได้จนกว่าจะตั้งรหัสใหม่) · ว่างได้อยู่แล้ว = คำสั่งนี้ไม่มีผล
--    ธุรกรรมแยก + รอล็อกไม่เกิน 5 วิ: มีคำสั่งค้างถือตารางอยู่ = หยุดทั้งไฟล์ตรงนี้ (ยังไม่มีอะไรถูกแก้) ค่อยรันใหม่
begin;
set local lock_timeout = '5s';
alter table public.app_users alter column password drop not null;
commit;

begin;
-- รอล็อกไม่เกิน 5 วิ — ชนคำสั่งที่ค้างอยู่ = ย้อนทั้งหมดแล้วรันใหม่ทีหลัง ดีกว่าให้เข้าระบบค้างทั้งร้านระหว่างรอ
set local lock_timeout = '5s';

-- 1) pgcrypto — มีแล้วใน schema extensions = ข้าม · อยู่ schema อื่น = หยุดพร้อมบอกเหตุ (ยังไม่มีอะไรถูกแก้)
create extension if not exists pgcrypto with schema extensions;
do $chk$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'extensions' and p.proname = 'crypt') then
    raise exception 'ไม่พบ extensions.crypt — pgcrypto ติดตั้งไว้ใน schema อื่น (ดู: select extnamespace::regnamespace from pg_extension where extname = ''pgcrypto'') · ยังไม่มีอะไรถูกแก้';
  end if;
end
$chk$;

-- 2) ตรวจก่อนแตะรหัสผ่าน (ไม่ผ่าน = หยุด ยังไม่มีอะไรถูกแก้)
--    • session_replication_role ไม่ใช่ origin = trigger ไม่ทำงาน รหัสจะไม่ถูกเข้ารหัส
--    • trigger อื่นบน app_users (audit/webhook) จะเห็นรหัสตัวหนังสือเดิมทุกแถวตอนข้อ 4 แล้วอาจคัดลอกไปเก็บที่อื่น
--    • view (และ materialized view) ที่อ้าง app_users ใช้สิทธิ์ของเจ้าของ view ⟹ เปิดรหัสให้ anon ได้แม้ถอดสิทธิ์ตารางแล้ว
--      หยุดทุกตัวที่อ้างตารางนี้ ไม่ใช่แค่ตัวที่ระบุคอลัมน์ password — to_jsonb(u) / row_to_json(u) / select u (ทั้งแถว)
--      ไม่ทิ้งร่องรอยระดับคอลัมน์ใน pg_depend เลย (ทดลองจริง 31 ต.ค. 69: ไฟล์ผ่าน แล้ว anon อ่าน hash ได้ผ่าน view)
--      ยกเว้น view แบบ security_invoker (ใช้สิทธิ์ของคนเรียก = anon อ่าน password ไม่ได้อยู่ดี)
--    • ชนิดคอลัมน์ต้องเก็บ 60 ตัวอักษรได้ (varchar สั้นกว่านี้ = เข้ารหัสแล้วบันทึกไม่ลง)
--    • ที่แค่ "ควรดู" (ไม่หยุด): publication (Realtime เคารพสิทธิ์รายคอลัมน์อยู่แล้ว)
--      · ฟังก์ชัน security definer ที่ anon เรียกได้และอ้าง app_users (อาจคืนแถวพร้อมรหัส)
--      (หน้า SQL Editor ไม่โชว์ notice — สองข้อนี้ไปโผล่ในช่อง check_manually ของตารางผลท้ายไฟล์ด้วย)
do $pre$
declare
  v text; pw_att int2;
begin
  if current_setting('session_replication_role') <> 'origin' then
    raise exception 'session_replication_role = % — trigger ไม่ทำงาน รหัสจะไม่ถูกเข้ารหัส · เปิดแท็บ SQL ใหม่แล้วรันใหม่ · ยังไม่มีอะไรถูกแก้', current_setting('session_replication_role');
  end if;
  select string_agg(t.tgname::text, ', ') into v
    from pg_trigger t
   where t.tgrelid = 'public.app_users'::regclass and not t.tgisinternal and t.tgname <> 'app_users_hash_password';
  if v is not null then
    raise exception 'app_users มี trigger อื่นอยู่ (%) — ตอนเข้ารหัสแถวเดิม trigger นั้นเห็นรหัสตัวหนังสือทุกแถว อาจคัดลอกไปเก็บที่อื่น · ตรวจก่อน: select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = ''public.app_users''::regclass and not tgisinternal; · ยังไม่มีอะไรถูกแก้', v;
  end if;
  select a.attnum, format_type(a.atttypid, a.atttypmod) into pw_att, v
    from pg_attribute a
   where a.attrelid = 'public.app_users'::regclass and a.attname = 'password' and not a.attisdropped;
  if pw_att is null then
    raise exception 'ไม่พบคอลัมน์ password ใน public.app_users · ยังไม่มีอะไรถูกแก้';
  end if;
  if not (v in ('text', 'character varying') or (v ~ '^character varying[(][0-9]+[)]$' and substring(v from '[0-9]+')::int >= 60)) then
    raise exception 'คอลัมน์ password เป็นชนิด % — เก็บ bcrypt (60 ตัวอักษร) ไม่ได้ · รันก่อน: alter table public.app_users alter column password type text; · ยังไม่มีอะไรถูกแก้', v;
  end if;
  select string_agg(distinct r.ev_class::regclass::text, ', ') into v
    from pg_depend d join pg_rewrite r on r.oid = d.objid
   where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
     and d.refobjid = 'public.app_users'::regclass and r.ev_class <> 'public.app_users'::regclass
     and not exists (select 1 from pg_class c, unnest(c.reloptions) o
                      where c.oid = r.ev_class and o ~* '^security_invoker=(true|on|yes|1)$');
  if v is not null then
    raise exception 'มี view อ้าง app_users (%) — view ใช้สิทธิ์เจ้าของ อาจเปิด password ให้คีย์สาธารณะ (เช่น to_jsonb(u) / row_to_json(u)) แม้ถอดสิทธิ์ตารางแล้ว · ลบ view หรือสร้างใหม่แบบ with (security_invoker = true) ก่อน · ยังไม่มีอะไรถูกแก้', v;
  end if;
  select string_agg(p.pubname::text, ', ') into v
    from pg_publication_tables p where p.schemaname = 'public' and p.tablename = 'app_users';
  if v is not null then
    raise notice 'ควรดู: app_users อยู่ใน publication %', v;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%app_users%'
     and p.proname not in ('app_login', 'app_users_hash_password', 'restore_table', 'backup_manifest')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v is not null then
    raise notice 'ควรดู: ฟังก์ชัน security definer ที่คีย์สาธารณะเรียกได้และอ้าง app_users (อาจคืนรหัส): %', v;
  end if;
end
$pre$;

-- 3) ตัวกัน: เขียนรหัสที่ยังไม่ใช่ bcrypt เมื่อไหร่ เข้ารหัสให้ก่อนเก็บ (เพิ่มผู้ใช้ · แก้รหัส · กู้คืนจากไฟล์เก่าที่มีรหัสตัวหนังสือ)
--    "เป็น bcrypt แล้ว" = รูปแบบที่ gen_salt('bf', 10) สร้างเป๊ะ: $2a$10$ + 53 ตัว — นอกนั้นถือเป็นรหัสตัวหนังสือ เข้ารหัสใหม่
--      · $2b$/$2y$ (จาก Node/PHP/เว็บสร้าง hash) pgcrypto เทียบไม่เป็น เก็บดิบไว้ = คนนั้นเข้าระบบไม่ได้เงียบๆ
--      · รูปแบบเพี้ยน/สั้น = crypt พัง → app_login error ทั้งชื่อนั้น
--      · cost อื่นนอกจาก 10 (เช่น $2a$31$…) = เข้าระบบครั้งเดียวกินแรงฐานเป็นวันๆ (ใครมีคีย์สาธารณะก็ตั้งให้คนอื่นได้)
--    ⟹ รันซ้ำ / แก้แถวโดยไม่เปลี่ยนรหัส ไม่เข้ารหัสซ้ำ · '' = ไม่มีรหัส (null) · ใช้ [$] แทน \$ — ไม่ขึ้นกับ standard_conforming_strings
--    security definer: ไม่ต้องพึ่งสิทธิ์ของ anon บน schema extensions · search_path ว่าง: ทุกชื่อระบุ schema เอง (ไม่มีใครแทรกของปลอมได้)
create or replace function public.app_users_hash_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.password = '' then
    new.password := null;
  elsif new.password is not null and new.password !~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$' then
    new.password := extensions.crypt(new.password, extensions.gen_salt('bf', 10));
  end if;
  return new;
end
$fn$;

-- สร้าง trigger เฉพาะตอนยังไม่มี — ไม่ drop ก่อน เพราะ drop trigger ล็อกทั้งตาราง (อ่านก็ต้องรอ) จนจบไฟล์
-- (create trigger ล็อกแค่งานเขียน · มีอยู่แล้ว = ใช้ตัวเดิม ตัวฟังก์ชันข้างบนถูกแทนที่แล้ว · ข้อ 9 ทดลองจริงว่าทำงาน)
do $trg$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.app_users'::regclass and tgname = 'app_users_hash_password' and not tgisinternal) then
    create trigger app_users_hash_password
      before insert or update of password on public.app_users
      for each row execute function public.app_users_hash_password();
  end if;
end
$trg$;

-- 4) เข้ารหัสรหัสผ่านเดิมทุกแถวทีเดียว ผ่านตัวกันข้อ 3 ("update of password" = ตัวกันทำงานแม้ค่าเท่าเดิม)
--    bcrypt แล้ว / ว่าง = ไม่แตะ (รันซ้ำไม่เข้ารหัสซ้ำ) · ทุกคนยังใช้รหัสเดิมเข้าได้ (app_login เทียบ bcrypt)
--    ล็อกเฉพาะแถว (อ่านไม่ต้องรอ) · 15 คน ≈ 1–2 วิ
update public.app_users
   set password = password
 where password is not null
   and password !~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$';

-- 5) เข้าระบบ: เทียบ bcrypt ในฐาน คืนเฉพาะ 8 คอลัมน์ (ไม่มี password) · ชื่อตรงตัว + ใช้งานอยู่ + รหัสตรง เท่านั้น
--    รหัสผิด / ไม่มีผู้ใช้ / ไม่มีรหัส (null) / ปิดใช้งาน = ไม่คืนแถว (แอปขึ้น "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
--    ดึงแถวตามชื่อก่อน (materialized) แล้วค่อย crypt — crypt ช้าโดยตั้งใจ ห้ามให้ฐานคิดทุกแถว
--    ส่ง crypt เฉพาะค่าที่เป็นรูปแบบ $2a$10$ เป๊ะ (ดูข้อ 3) — ค่าแปลกในฐานไม่มีทางทำให้ app_login error หรือกินแรงฐาน
--    ชนิดคอลัมน์ผลลัพธ์อ่านจากตารางจริง (%type) · drop ก่อน = รันซ้ำได้แม้ชนิดคอลัมน์เปลี่ยน (ไม่ล็อกตาราง)
drop function if exists public.app_login(text, text);
create function public.app_login(p_username text, p_password text)
returns table (
  id               public.app_users.id%type,
  username         public.app_users.username%type,
  name             public.app_users.name%type,
  role             public.app_users.role%type,
  active           public.app_users.active%type,
  perms            public.app_users.perms%type,
  created_at       public.app_users.created_at%type,
  allowed_branches public.app_users.allowed_branches%type
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with cand as materialized (
    select u.id, u.username, u.name, u.role, u.active, u.perms, u.created_at, u.allowed_branches, u.password
      from public.app_users u
     where u.username = p_username
       and u.active = true
       and u.password ~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$'
  )
  select c.id, c.username, c.name, c.role, c.active, c.perms, c.created_at, c.allowed_branches
    from cand c
   where coalesce(p_password, '') <> ''
     and c.password = extensions.crypt(p_password, c.password)
   order by c.id
   limit 1;
$fn$;
revoke all on function public.app_login(text, text) from public;
grant execute on function public.app_login(text, text) to anon, authenticated;

-- 6) สิทธิ์อ่าน: ถอดทั้งตาราง (ถอด table-level แล้ว column-level เดิมหายไปด้วย) แล้วให้อ่านได้เฉพาะ 8 คอลัมน์
--    เพิ่ม/แก้/ลบ คงเดิม — หน้า ตั้งค่า → ผู้ใช้ ยังต้องเขียนได้ (ดูความเสี่ยงที่ยังเหลือด้านบน)
--    แอปต้องไม่ขอ password/select=* อีก: getUsers/heartbeat/ตัวสำรอง/ตัวกู้คืน ระบุคอลัมน์ · เพิ่ม/แก้ใช้ return=minimal
revoke select on table public.app_users from public, anon, authenticated;
grant select (id, username, name, role, active, perms, created_at, allowed_branches) on table public.app_users to anon, authenticated;

-- 7) PostgREST โหลดโครงสร้างใหม่ (ส่งตอน commit) — ไม่งั้นแอปยังเห็นว่าไม่มี app_login อีกพักหนึ่ง
notify pgrst, 'reload schema';

-- 8) ตรวจผลก่อน commit — ไม่ผ่าน = raise exception = ย้อนกลับทั้งไฟล์ (ฐานเหมือนไม่เคยรัน แอปยังเข้าระบบได้ทางเดิม)
do $chk$
declare
  n_total bigint; n_plain bigint; n_nopw bigint; n_active_nopw bigint;
  anon_pw boolean; auth_pw boolean; anon_cols int; fn_ok boolean; trg_ok boolean;
begin
  select count(*),
         count(*) filter (where password is not null and password !~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$'),
         count(*) filter (where password is null),
         count(*) filter (where password is null and active)
    into n_total, n_plain, n_nopw, n_active_nopw
    from public.app_users;
  anon_pw := has_column_privilege('anon', 'public.app_users', 'password', 'SELECT');
  auth_pw := has_column_privilege('authenticated', 'public.app_users', 'password', 'SELECT');
  select count(*) into anon_cols
    from unnest(array['id','username','name','role','active','perms','created_at','allowed_branches']) as c(col)
   where has_column_privilege('anon', 'public.app_users', c.col, 'SELECT');
  fn_ok := has_function_privilege('anon', 'public.app_login(text, text)', 'EXECUTE');
  select exists (select 1 from pg_trigger
                  where tgrelid = 'public.app_users'::regclass and tgname = 'app_users_hash_password'
                    and tgenabled in ('O', 'A') and tgfoid = 'public.app_users_hash_password()'::regprocedure)
    into trg_ok;
  raise notice 'app_users: ทั้งหมด % แถว · ยังไม่เข้ารหัส % (ต้องเป็น 0) · ไม่มีรหัสผ่าน % (ใช้งานอยู่ % คน = เข้าระบบไม่ได้จนกว่าจะตั้งรหัส)', n_total, n_plain, n_nopw, n_active_nopw;
  raise notice 'สิทธิ์: anon อ่าน password = % (ต้อง false) · authenticated อ่าน password = % (ต้อง false) · anon อ่านได้ % จาก 8 คอลัมน์ · anon เรียก app_login = % (ต้อง true) · ตัวกันเปิดอยู่ = % (ต้อง true)', anon_pw, auth_pw, anon_cols, fn_ok, trg_ok;
  if n_plain <> 0 then
    raise exception 'ยังมี % แถวที่รหัสผ่านไม่ใช่ bcrypt — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้', n_plain;
  end if;
  if anon_pw or auth_pw then
    raise exception 'anon/authenticated ยังอ่าน password ได้ (มีสิทธิ์จากที่อื่น เช่น role ที่สังกัด) — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้';
  end if;
  if anon_cols <> 8 or not fn_ok then
    raise exception 'สิทธิ์อ่าน 8 คอลัมน์ / เรียก app_login ไม่ครบ (แอปจะเข้าระบบไม่ได้) — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้';
  end if;
  if not trg_ok then
    raise exception 'ตัวกัน app_users_hash_password ไม่ได้เปิดอยู่/ชี้ผิดฟังก์ชัน (รหัสใหม่จะถูกเก็บเป็นตัวหนังสือ) — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้';
  end if;
  if exists (select 1 from public.app_login('__no_such_user__' || md5(random()::text), 'x')) then
    raise exception 'app_login คืนแถวให้ผู้ใช้ที่ไม่มีอยู่ — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้';
  end if;
end
$chk$;

-- 9) ทดลองเข้าระบบจริงด้วยผู้ใช้ทดลอง — ในธุรกรรมย่อยที่ "โยน probe_ok ทิ้งเสมอ" ⟹ แถวทดลองไม่เคยถูกบันทึก (ใช้เลข id ไป 1 เลข ไม่เป็นไร)
--    เพิ่มผู้ใช้ผ่านตัวกันจริง (คัดคอลัมน์อื่นจากแถวแรก ไม่ชนข้อบังคับของตาราง) → เทียบ app_login จริงทุกกรณีที่แอปใช้
--    ไม่ผ่านข้อไหน = ย้อนกลับทั้งไฟล์ · ชื่อ/รหัสทดลองสุ่มใหม่ทุกครั้ง ไม่พิมพ์ออกมา
do $probe$
declare
  u text := 'zz' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  pw text := 'P' || substr(md5(random()::text), 1, 15);
  pw2 text := 'Q' || substr(md5(random()::text), 1, 15);
  odd text := '$2b$10$' || repeat('a', 53);
  pid bigint; got bigint; n bigint; h text; h2 text;
begin
  if not exists (select 1 from public.app_users) then
    raise notice 'ทดลองเข้าระบบ: ข้าม (ตาราง app_users ว่าง)';
    return;
  end if;
  begin
    insert into public.app_users (username, password, name, role, active, perms, created_at, allowed_branches)
    select u, pw, 'zz-probe', x.role, true, x.perms, x.created_at, x.allowed_branches
      from public.app_users x order by x.id limit 1
    returning id into pid;
    -- (ก) เพิ่มผู้ใช้ = เก็บเป็น bcrypt รูปแบบ $2a$10$ ไม่ใช่ตัวหนังสือ
    select password into h from public.app_users where id = pid;
    if h is null or h = pw or h !~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$' then raise exception 'ก) เพิ่มผู้ใช้แล้วรหัสไม่ถูกเข้ารหัส'; end if;
    -- (ข) รหัสถูก = ได้แถวนั้นแถวเดียว
    select count(*), min(l.id) into n, got from public.app_login(u, pw) l;
    if n <> 1 or got is distinct from pid then raise exception 'ข) app_login ไม่คืนผู้ใช้ทดลองด้วยรหัสที่ถูก'; end if;
    -- (ค) รหัสผิด / ว่าง / null / ชื่อตัวพิมพ์ต่าง / ส่ง hash ที่เก็บไว้เป็นรหัส = ไม่ได้อะไร
    if exists (select 1 from public.app_login(u, pw || 'x')) or exists (select 1 from public.app_login(u, ''))
       or exists (select 1 from public.app_login(u, null)) or exists (select 1 from public.app_login(upper(u), pw))
       or exists (select 1 from public.app_login(u, h)) then
      raise exception 'ค) app_login คืนแถวทั้งที่รหัส/ชื่อไม่ถูก';
    end if;
    -- (ง) แก้รหัส (หน้า ตั้งค่า → ผู้ใช้) = รหัสใหม่เข้าได้ รหัสเก่าเข้าไม่ได้
    update public.app_users set password = pw2 where id = pid;
    if not exists (select 1 from public.app_login(u, pw2)) or exists (select 1 from public.app_login(u, pw)) then
      raise exception 'ง) แก้รหัสแล้วเข้าระบบด้วยรหัสใหม่ไม่ได้ หรือรหัสเก่ายังเข้าได้';
    end if;
    -- (จ) แก้คอลัมน์อื่นโดยไม่ส่ง password + รันข้อ 4 ซ้ำ (set password = password) = รหัสเดิมยังเข้าได้ (ไม่เข้ารหัสซ้ำ)
    select password into h2 from public.app_users where id = pid;
    update public.app_users set name = 'zz-probe2' where id = pid;
    update public.app_users set password = password where id = pid;
    if (select password from public.app_users where id = pid) is distinct from h2 or not exists (select 1 from public.app_login(u, pw2)) then
      raise exception 'จ) แก้ผู้ใช้โดยไม่เปลี่ยนรหัส/รันซ้ำ แล้วรหัสถูกเข้ารหัสซ้ำ';
    end if;
    -- (ฉ) ค่าที่แค่หน้าตาคล้าย bcrypt ($2b$…) = ถือเป็นรหัสตัวหนังสือ เข้ารหัสใหม่ และใช้ค่านั้นเข้าระบบได้
    update public.app_users set password = odd where id = pid;
    if (select password from public.app_users where id = pid) = odd or not exists (select 1 from public.app_login(u, odd)) then
      raise exception 'ฉ) ค่าที่หน้าตาคล้าย bcrypt ถูกเก็บดิบ';
    end if;
    -- (ช) ปิดใช้งาน = เข้าไม่ได้
    update public.app_users set active = false where id = pid;
    if exists (select 1 from public.app_login(u, odd)) then raise exception 'ช) ผู้ใช้ที่ปิดใช้งานยังเข้าระบบได้'; end if;
    -- (ซ) ล้างรหัสเป็นค่าว่าง = เก็บเป็น null และเข้าไม่ได้
    update public.app_users set active = true, password = '' where id = pid;
    if (select password from public.app_users where id = pid) is not null or exists (select 1 from public.app_login(u, '')) then
      raise exception 'ซ) ล้างรหัสแล้วไม่เป็น null';
    end if;
    raise exception 'probe_ok';
  exception when others then
    if sqlerrm <> 'probe_ok' then
      raise exception 'ทดลองเข้าระบบด้วยผู้ใช้ทดลองไม่ผ่าน — ย้อนกลับทั้งหมด ไม่มีอะไรถูกแก้ (สาเหตุ: %)', sqlerrm;
    end if;
  end;
  raise notice 'ทดลองเข้าระบบ: ผ่านทุกข้อ (ผู้ใช้ทดลองถูกย้อนทิ้งแล้ว ไม่มีในตาราง)';
end
$probe$;

commit;

-- ล้างรหัสตัวหนังสือที่ค้างในสถิติของตาราง (pg_statistic) — ANALYZE ครั้งก่อนๆ เก็บค่าตัวอย่างของคอลัมน์ password ไว้
-- แก้ 15 แถวไม่ถึงเกณฑ์ที่ฐานจะ analyze เอง ⟹ ค่าเก่าค้างอยู่ตลอด (anon อ่านไม่ได้ แต่ postgres/ไฟล์สำรองของ Supabase เห็น)
-- หลัง commit แล้ว — ไม่ล็อกการอ่าน/เขียน · ไม่มีสิทธิ์ = แค่เตือน ไม่ error
analyze public.app_users;

-- ผลให้ดูในหน้า SQL Editor (มีแต่จำนวน/จริง-เท็จ/ชื่อสิ่งที่ควรดู ไม่มีค่ารหัสผ่าน):
select count(*) as total_users,
       count(*) filter (where password is not null and password !~ '^[$]2a[$]10[$][./A-Za-z0-9]{53}$') as not_bcrypt,      -- ต้องเป็น 0
       count(*) filter (where password is null) as no_password,                                                       -- คนที่ต้องตั้งรหัสใหม่
       count(*) filter (where password is null and active) as active_no_password,                                     -- ใช้งานอยู่แต่เข้าระบบไม่ได้
       has_column_privilege('anon', 'public.app_users', 'password', 'SELECT') as anon_reads_password,                 -- ต้อง false
       has_column_privilege('anon', 'public.app_users', 'id', 'SELECT') as anon_reads_id,                             -- ต้อง true
       has_function_privilege('anon', 'public.app_login(text, text)', 'EXECUTE') as login_fn,                         -- ต้อง true
       nullif(concat_ws(' · ',                                                                                        -- ว่าง = ไม่มีอะไรต้องดู
         (select 'publication: ' || string_agg(p.pubname::text, ', ')
            from pg_publication_tables p where p.schemaname = 'public' and p.tablename = 'app_users'),
         (select 'security definer ที่คีย์สาธารณะเรียกได้และอ้าง app_users (อาจคืนรหัส): ' || string_agg(p.oid::regprocedure::text, ', ')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%app_users%'
             and p.proname not in ('app_login', 'app_users_hash_password', 'restore_table', 'backup_manifest')
             and has_function_privilege('anon', p.oid, 'EXECUTE'))), '') as check_manually
  from public.app_users;
