-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — waste_logs.stock_applied. Run ONCE in the Supabase SQL editor.
--
-- Recording waste DEDUCTS on-hand; deleting the waste log now CREDITS it back. But some rows
-- never deducted anything — logs created before that feature existed, and logs whose deduct
-- failed (the user was warned to fix stock by hand). Crediting those on delete would MINT stock.
--
-- This flag makes the deduct explicit instead of assumed: save() sets it only after the deduct
-- actually lands, and delete only credits rows carrying it. Existing rows default to false, which
-- is the correct reading for them (they are not credited back).
-- ══════════════════════════════════════════════════════════════════════════

alter table public.waste_logs add column if not exists stock_applied boolean not null default false;

-- Optional: if you are confident that every EXISTING waste log did deduct stock, you can flip the
-- historical rows with the statement below. Leave it commented out unless you are sure — the safe
-- default (false) simply means deleting an old waste log won't auto-restore stock; you adjust it
-- on the stock-count screen instead.
-- update public.waste_logs set stock_applied = true where item_type <> 'menu' and created_at < now();
