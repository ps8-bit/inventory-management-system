-- ============================================================
--  คลังพร้อมส่ง — Inventory Management System
--  Supabase / PostgreSQL schema
--
--  วิธีใช้:
--   1. สร้างโปรเจกต์ใหม่ที่ https://supabase.com  (ฟรี ไม่ต้องใช้บัตร)
--   2. เปิดเมนู  SQL Editor  ->  New query
--   3. วางไฟล์นี้ทั้งหมดแล้วกด  Run
--   4. ข้อมูลตัวอย่าง 12 SKU จะถูกใส่ให้อัตโนมัติ
-- ============================================================

-- ---------- 1. สินค้า (Products) ----------
create table if not exists products (
  sku        text primary key,
  name       text        not null,
  cat        text        default 'ทั่วไป',
  cost       numeric      default 0,
  price      numeric      default 0,
  qty        integer      default 0,
  reserved   integer      default 0,
  reorder    integer      default 30,
  loc        text         default '-',
  supplier   text         default 'ไม่ระบุ',
  created_at timestamptz  default now(),
  updated_at timestamptz  default now()
);

-- ---------- 2. ชุดสินค้า (Bundles) ----------
create table if not exists bundles (
  id         text primary key,             -- เช่น BND-001
  name       text        not null,
  descr      text        default '',
  price      numeric      default 0,
  created_at timestamptz  default now()
);

-- รายการสินค้าในแต่ละชุด (ตารางเชื่อม)
create table if not exists bundle_items (
  bundle_id  text    references bundles(id) on delete cascade,
  sku        text    references products(sku) on delete cascade,
  qty        integer default 1,
  primary key (bundle_id, sku)
);

-- ---------- 3. ออร์เดอร์ขาออก (Orders) ----------
create table if not exists orders (
  id            text primary key,          -- เช่น SO-12345678
  channel       text,
  customer      text,
  phone         text,
  status        text   default 'picking',  -- picking | packed | shipped | delivered
  carrier       text,
  tracking      text,
  item_count    integer default 0,         -- จำนวน SKU ในออร์เดอร์
  date_iso      text    default '',        -- วันที่ YYYY-MM-DD
  is_bundle     boolean default false,
  shipping_addr text,
  cod_amount    numeric default 0,
  note          text,
  created_at    timestamptz default now()
);

-- รายการสินค้าในแต่ละออร์เดอร์
create table if not exists order_items (
  id        bigint generated always as identity primary key,
  order_id  text references orders(id) on delete cascade,
  sku       text,
  bundle_id text,
  qty       integer default 1
);

-- ---------- 4. การปรับสต็อก (Stock adjustments) ----------
-- เก็บประวัติการเปลี่ยนแปลงสต็อกแบบ delta (บวก/ลบ)
create table if not exists stock_adjustments (
  id         bigint generated always as identity primary key,
  sku        text references products(sku) on delete cascade,
  delta      integer not null,             -- + รับเข้า / - ตัดออก
  reason     text,
  created_at timestamptz default now(),
  created_by text
);

-- ---------- 4b. ตำแหน่งจัดเก็บหลายที่ต่อ 1 SKU (Product locations) ----------
-- จำนวนต่อตำแหน่ง 1 แถว = 1 SKU ต่อ 1 ตำแหน่ง (สินค้าที่เก็บทั้งโซน A และ
-- กล่องสำรองชั้นบน). products.loc ยังใช้เป็น "ตำแหน่งหลัก" ต่อไป
-- INVARIANT: sum(qty) ต่อ sku = products.qty — ดู supabase/product-locations.sql
create table if not exists product_locations (
  sku        text    not null references products(sku) on delete cascade,
  loc        text    not null,
  qty        integer not null default 0 check (qty >= 0),
  note       text,
  updated_at timestamptz default now(),
  primary key (sku, loc)
);

-- ---------- 5. ประวัติการแก้ไข (Audit log) ----------
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  entity     text,                         -- product | bundle | order
  entity_id  text,
  action     text,                         -- create | update | delete | import ...
  summary    text,
  note       text,
  user_name  text,
  created_at timestamptz default now()
);

-- ---------- 6. ฉลากพัสดุ (Shipping labels) ----------
create table if not exists labels (
  id         text primary key,             -- เช่น L1, L2, ...
  so_id      text default '',              -- อ้างอิง order id
  data       jsonb not null,               -- object ฉลากทั้งหมด (sender/recipient/items/...)
  created_at timestamptz default now()
);

-- ---------- 7. ตั้งค่าร้านค้า (Store settings) ----------
create table if not exists store_settings (
  key   text primary key,
  value jsonb
);

-- ============================================================
--  ROW LEVEL SECURITY
--  เริ่มต้นแบบเปิดให้ใช้งานได้ทันที (เหมาะกับช่วงทดลอง)
--  เมื่อพร้อมใช้งานจริง ควรแก้ policy ให้ผูกกับ auth.uid()
-- ============================================================
alter table products          enable row level security;
alter table bundles           enable row level security;
alter table bundle_items      enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table stock_adjustments enable row level security;
alter table product_locations enable row level security;
alter table audit_log         enable row level security;
alter table labels            enable row level security;
alter table store_settings    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products','bundles','bundle_items','orders',
                           'order_items','stock_adjustments','product_locations',
                           'audit_log','labels','store_settings']
  loop
    execute format(
      'create policy "เปิดให้ใช้งานช่วงทดลอง" on %I for all using (true) with check (true);', t);
  end loop;
end $$;

-- ============================================================
--  ข้อมูลตัวอย่าง — 12 SKU (ตรงกับ data.jsx)
-- ============================================================
insert into products (sku, name, cat, cost, price, qty, reserved, reorder, loc, supplier) values
  ('TH-APP-001','เสื้อยืดคอกลม Cotton 100% สีขาว','เสื้อผ้า',165,290,248,18,50,'A-02-03','บางกอกแฟชั่น'),
  ('TH-APP-002','เสื้อยืดคอกลม Cotton 100% สีดำ','เสื้อผ้า',165,290,12,4,50,'A-02-04','บางกอกแฟชั่น'),
  ('TH-ELE-118','หูฟังบลูทูธ ANC รุ่น Air Pro 2','อิเล็กทรอนิกส์',990,1890,86,8,30,'B-01-12','Tech Wave Co.'),
  ('TH-ELE-119','สายชาร์จ USB-C 65W 1.2 เมตร','อิเล็กทรอนิกส์',220,390,0,0,100,'B-01-08','Tech Wave Co.'),
  ('TH-HOM-220','หมอนรองคอ Memory Foam สีเทา','ของใช้ในบ้าน',320,590,145,22,40,'C-03-02','Comfort Living'),
  ('TH-HOM-221','ผ้าห่มขนแกะ Microfiber 180x220','ของใช้ในบ้าน',480,890,67,5,25,'C-03-05','Comfort Living'),
  ('TH-BTY-310','เซรั่ม Vitamin C 30ml','ความงาม',340,690,32,12,40,'D-01-01','Glow Lab'),
  ('TH-BTY-311','ครีมกันแดด SPF50 PA++++ 50ml','ความงาม',290,590,198,14,50,'D-01-04','Glow Lab'),
  ('TH-FOD-405','กาแฟดริปอาราบิก้า 250g (ห่อ)','อาหารและเครื่องดื่ม',160,290,412,32,80,'E-02-07','Doi Coffee'),
  ('TH-FOD-406','ชาเขียวมัทฉะออร์แกนิก 100g','อาหารและเครื่องดื่ม',250,450,21,6,30,'E-02-09','Doi Coffee'),
  ('TH-ACC-512','กระเป๋าสะพายข้าง Canvas สีกากี','เครื่องประดับ',440,790,54,9,20,'A-04-01','Urban Goods'),
  ('TH-ACC-513','หมวกแก๊ปแฟชั่น Unisex สีเบจ','เครื่องประดับ',210,390,128,12,40,'A-04-06','Urban Goods')
on conflict (sku) do nothing;

-- ชุดสินค้าตัวอย่าง
insert into bundles (id, name, descr, price) values
  ('BND-001','ชุดสกินแคร์ยอดนิยม','เซรั่มวิตามินซี + ครีมกันแดด',1180),
  ('BND-002','ชุดเสื้อสีขาว+สีดำ','เสื้อยืดคอกลม Cotton 100% ครบสองสี',520)
on conflict (id) do nothing;

insert into bundle_items (bundle_id, sku, qty) values
  ('BND-001','TH-BTY-310',1),
  ('BND-001','TH-BTY-311',1),
  ('BND-002','TH-APP-001',1),
  ('BND-002','TH-APP-002',1)
on conflict do nothing;

-- ============================================================
--  เสร็จสิ้น — ไปที่เมนู Table Editor เพื่อดูข้อมูล
--  คีย์ที่ต้องใช้ในแอป (เมนู Project Settings -> API):
--    - Project URL      เช่น  https://xxxx.supabase.co
--    - anon public key
-- ============================================================
