-- Roster seed: July 2026 (four weekly periods)
-- Source: "07. July 2026 - Shift Layout.xlsx"
-- Shifts rotate A/B weekly: Week 1&3 = Arnold day / Sibusiso night; Week 2&4 = reversed

DO $$
DECLARE
  p1 uuid := gen_random_uuid(); -- 29 Jun – 3 Jul
  p2 uuid := gen_random_uuid(); -- 6  – 10 Jul
  p3 uuid := gen_random_uuid(); -- 13 – 17 Jul
  p4 uuid := gen_random_uuid(); -- 20 – 24 Jul
BEGIN

INSERT INTO production.roster_periods (id, name, start_date, end_date, day_label, night_label) VALUES
  (p1, '29 Jun – 3 Jul', '2026-06-29', '2026-07-03', '07h00 till 16h00', '16h00 till 01h00'),
  (p2, '6 – 10 Jul',     '2026-07-06', '2026-07-10', '07h00 till 16h00', '16h00 till 01h00'),
  (p3, '13 – 17 Jul',    '2026-07-13', '2026-07-17', '07h00 till 16h00', '16h00 till 01h00'),
  (p4, '20 – 24 Jul',    '2026-07-20', '2026-07-24', '07h00 till 16h00', '16h00 till 01h00');

-- ─────────────────────────────────────────────────────────────────────────────
-- PERIOD 1: 29 Jun – 3 Jul  (Arnold day / Sibusiso night)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production.roster_entries (period_id, role_key, shift, person_name, tags, sort_order) VALUES
  -- Production – Day
  (p1,'rooibos_supervisor','day','Arnold Ndibongo',         ARRAY['FL','ER'],1),
  (p1,'pasteuriser_op',    'day','Lusindiso Maqhutyana',    ARRAY['FL'],1),
  (p1,'bagging_vacuum',    'day','Mawande Ntshofu',         ARRAY['FL'],1),
  (p1,'bagging_vacuum',    'day','Sisonke Hobose',          ARRAY[]::text[],2),
  (p1,'bagging_vacuum',    'day','Luvo Tengile',            ARRAY[]::text[],3),
  (p1,'scanning_boxes',    'day','Zukisani Boyce',          ARRAY['FF'],1),
  (p1,'scanning_boxes',    'day','Philasande Mkhwambi',     ARRAY[]::text[],2),
  (p1,'scanning_boxes',    'day','Ayena Mququ',             ARRAY['C'],3),
  (p1,'granule_operator',  'day','Lamla Ndincede',          ARRAY['FL'],1),
  (p1,'granule',           'day','Lukhanyiso Ketshana',     ARRAY[]::text[],1),
  (p1,'refining_1',        'day','Buhle Nkohla',            ARRAY[]::text[],1),
  (p1,'sieving_tower',     'day','Grant Alexandra',         ARRAY['FL'],1),
  (p1,'sieving_tower',     'day','Siyabulela Nkohla',       ARRAY['FL'],2),
  (p1,'blender',           'day','Sithandile Maxazi',       ARRAY['FL'],1),
  (p1,'blender',           'day','Inga Ndikinda',           ARRAY[]::text[],2),
  (p1,'refining_2',        'day','Anda Mafombela',          ARRAY[]::text[],1),
  (p1,'refining_2',        'day','Siphoxolo Tibisondo',     ARRAY['C'],2),
  (p1,'rosehip',           'day','Louis Platjies',          ARRAY['FL'],1),
  (p1,'rosehip',           'day','Henry Dido',              ARRAY[]::text[],2),
  -- Store – Day
  (p1,'store_supervisor',  'day','Bongikhaya Ndikinda',     ARRAY['FL','ER','II','SS'],1),
  (p1,'store_operator',    'day','Mbongeni Mtholo',         ARRAY['FL'],1),
  (p1,'store_operator',    'day','Siphelele Qobosha',       ARRAY['FL'],2),
  (p1,'store_operator',    'day','Peter Claasen',           ARRAY['FL'],3),
  (p1,'store_operator',    'day','Sibabalo Lindi',          ARRAY['FL'],4),
  (p1,'store_operator',    'day','Nkosipendulo Vutuza',     ARRAY['FL'],5),
  (p1,'store_operator',    'day','Garnet Mpiyonke',         ARRAY[]::text[],6),
  -- QC – Day
  (p1,'qc_supervisor',     'day','Siyasanga Madasa',        ARRAY[]::text[],1),
  (p1,'qc',                'day','Michaela Albertus',       ARRAY[]::text[],1),
  (p1,'qc',                'day','Nkanyiso Magidigidi',     ARRAY[]::text[],2),
  (p1,'qc',                'day','Christopher Daniels',     ARRAY[]::text[],3),
  (p1,'qc',                'day','Portia Jongilanga',       ARRAY[]::text[],4),
  (p1,'lab_analyst',       'day','Dineo Ngomani',           ARRAY[]::text[],1),
  -- Cleaning – Day
  (p1,'cleaner',           'day','Akhona Mququ',            ARRAY['SHER'],1),
  (p1,'cleaner_operator',  'day','Dumisani Makhendlana',    ARRAY['FL','ER'],1),
  (p1,'cleaner',           'day','Siyabonga Makhaluza',     ARRAY['FA'],2),
  (p1,'cleaner',           'day','Mequin Lukas',            ARRAY[]::text[],3),
  (p1,'cleaner',           'day','Simphiwe Mphefu',         ARRAY[]::text[],4),
  (p1,'cleaner',           'day','Le Mark Louw',            ARRAY['FM'],5),
  (p1,'cleaner',           'day','Ryan Alexander',          ARRAY[]::text[],6),
  -- Maintenance – Day
  (p1,'maintenance_tech',  'day','John Magson',             ARRAY['FL'],1),
  (p1,'maintenance_asst',  'day','Mohapi Ramosala',         ARRAY[]::text[],1),
  -- H&S – Day
  (p1,'hs_assistant',      'day','Ezetu Siminga',           ARRAY['FA'],1),

  -- Production – Night
  (p1,'rooibos_supervisor','night','Sibusiso Magqujana',    ARRAY['FL','ER','II','FM'],1),
  (p1,'pasteuriser_op',    'night','Hlalanathi Lusawana',   ARRAY['FL'],1),
  (p1,'bagging_vacuum',    'night','Exavior Jansen',        ARRAY[]::text[],1),
  (p1,'bagging_vacuum',    'night','Siyavuya Jezile',       ARRAY[]::text[],2),
  (p1,'bagging_vacuum',    'night','Chuma Bongozo',         ARRAY[]::text[],3),
  (p1,'scanning_boxes',    'night','Siyabonga Malusi',      ARRAY[]::text[],1),
  (p1,'scanning_boxes',    'night','Abongile Kweyama',      ARRAY['C'],2),
  (p1,'scanning_boxes',    'night','Wanda Mpetsheni',       ARRAY['C'],3),
  (p1,'granule_operator',  'night','Bongikhaya Jele',       ARRAY['FL'],1),
  (p1,'granule',           'night','Sello Mokatane',        ARRAY[]::text[],1),
  (p1,'refining_1',        'night','Alikho Ngwenduna',      ARRAY[]::text[],1),
  (p1,'sieving_tower',     'night','Lubabalo Qutu',         ARRAY['FL'],1),
  (p1,'sieving_tower',     'night','Kurt Braaf',            ARRAY['C'],2),
  (p1,'blender',           'night','Thembekile Madikane',   ARRAY['FL'],1),
  (p1,'blender',           'night','Zama Mamba',            ARRAY[]::text[],2),
  -- Store – Night
  (p1,'store_supervisor',  'night','Steven Paris',          ARRAY['FL','SS'],1),
  (p1,'store_operator',    'night','Johny Lameyer',         ARRAY['FL','FF'],1),
  (p1,'store_operator',    'night','Aphiwe Ntloko',         ARRAY['FL','FA','FF'],2),
  (p1,'store_operator',    'night','Sibulele Ntongana',     ARRAY['FL'],3),
  (p1,'store_operator',    'night','Lwandile Sikade',       ARRAY[]::text[],4),
  -- QC – Night
  (p1,'qc_supervisor',     'night','Ziyanda Nabi',          ARRAY[]::text[],1),
  (p1,'qc',                'night','Rose Tsatsi',           ARRAY['H&S'],1),
  (p1,'qc',                'night','Khotso Stuurman',       ARRAY['FA'],2),
  (p1,'qc',                'night','Luvo Bobi',             ARRAY[]::text[],3),
  (p1,'qc',                'night','Musa Buqwana',          ARRAY[]::text[],4),
  -- Cleaning – Night
  (p1,'cleaner_operator',  'night','Vulabeza Mvinjelwa',    ARRAY['FL'],1),
  (p1,'cleaner',           'night','Bonginkosi Vikilane',   ARRAY['SHER'],1),
  -- Maintenance – Night
  (p1,'maintenance_tech',  'night','Shane Scott',           ARRAY['H&S'],1),
  (p1,'maintenance_asst',  'night','Yamkela Mpenge',        ARRAY[]::text[],1);

-- ─────────────────────────────────────────────────────────────────────────────
-- PERIOD 2: 6 – 10 Jul  (Sibusiso day / Arnold night – swapped)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production.roster_entries (period_id, role_key, shift, person_name, tags, sort_order) VALUES
  -- Production – Day
  (p2,'rooibos_supervisor','day','Sibusiso Magqujana',       ARRAY['FL','ER','II','FM'],1),
  (p2,'pasteuriser_op',    'day','Lusindiso Maqhutyana',     ARRAY['FL'],1),
  (p2,'bagging_vacuum',    'day','Exavior Jansen',           ARRAY[]::text[],1),
  (p2,'bagging_vacuum',    'day','Siyavuya Jezile',          ARRAY[]::text[],2),
  (p2,'bagging_vacuum',    'day','Chuma Bongozo',            ARRAY[]::text[],3),
  (p2,'scanning_boxes',    'day','Siyabonga Malusi',         ARRAY[]::text[],1),
  (p2,'scanning_boxes',    'day','Philasande Mkhwambi',      ARRAY[]::text[],2),
  (p2,'scanning_boxes',    'day','Wanda Mpetsheni',          ARRAY['C'],3),
  (p2,'granule_operator',  'day','Bongikhaya Jele',          ARRAY['FL'],1),
  (p2,'granule',           'day','Sello Mokatane',           ARRAY[]::text[],1),
  (p2,'refining_1',        'day','Alikho Ngwenduna',         ARRAY[]::text[],1),
  (p2,'sieving_tower',     'day','Lubabalo Qutu',            ARRAY['FL'],1),
  (p2,'sieving_tower',     'day','Kurt Braaf',               ARRAY['C'],2),
  (p2,'blender',           'day','Thembekile Madikane',      ARRAY['FL'],1),
  (p2,'blender',           'day','Zama Mamba',               ARRAY[]::text[],2),
  (p2,'refining_2',        'day','Anda Mafobhela',           ARRAY[]::text[],1),
  (p2,'refining_2',        'day','Siphoxolo Tibisondo',      ARRAY['C'],2),
  (p2,'rosehip',           'day','Louis Platjies',           ARRAY['FL'],1),
  (p2,'rosehip',           'day','Henry Dido',               ARRAY[]::text[],2),
  -- Store – Day
  (p2,'store_supervisor',  'day','Bongikhaya Ndikinda',      ARRAY['FL','ER','II','SS'],1),
  (p2,'store_operator',    'day','Johny Lameyer',            ARRAY['FL','FF'],1),
  (p2,'store_operator',    'day','Aphiwe Ntloko',            ARRAY['FL','FA','FF'],2),
  (p2,'store_operator',    'day','Sibulelela Ntonga',        ARRAY['FL'],3),
  (p2,'store_operator',    'day','Sibabalo Lindi',           ARRAY['FL'],4),
  (p2,'store_operator',    'day','Nkosipendulo Vutuza',      ARRAY['FL'],5),
  (p2,'store_operator',    'day','Lwandile Sikade',          ARRAY[]::text[],6),
  -- QC – Day
  (p2,'qc_supervisor',     'day','Ziyanda Nabi',             ARRAY[]::text[],1),
  (p2,'qc',                'day','Rose Tsatsi',              ARRAY['H&S'],1),
  (p2,'qc',                'day','Portia Jongilanga',        ARRAY[]::text[],2),
  (p2,'qc',                'day','Musa Buqwana',             ARRAY[]::text[],3),
  (p2,'qc',                'day','Khotso Stuurman',          ARRAY['FA'],4),
  (p2,'lab_analyst',       'day','Dineo Ngomani',            ARRAY[]::text[],1),
  (p2,'incoming_goods_qc', 'day','Siyasanga Madasa',         ARRAY[]::text[],1),
  -- Cleaning – Day
  (p2,'cleaner',           'day','Akhona Mququ',             ARRAY[]::text[],1),
  (p2,'cleaner_operator',  'day','Vulabeza Mvinjelwa',       ARRAY['FL'],1),
  (p2,'cleaner',           'day','Simphiwe Mphefu',          ARRAY[]::text[],2),
  (p2,'cleaner',           'day','Siyabonga Makhaluza',      ARRAY['FA'],3),
  (p2,'cleaner',           'day','Bonginkosi Vikilane',      ARRAY[]::text[],4),
  (p2,'cleaner',           'day','Ryan Alexander',           ARRAY['FM'],5),
  (p2,'cleaner',           'day','Le Mark Louw',             ARRAY[]::text[],6),
  -- Maintenance – Day
  (p2,'maintenance_tech',  'day','Shane Scott',              ARRAY['H&S'],1),
  (p2,'maintenance_asst',  'day','Yamkela Mpenge',           ARRAY[]::text[],1),
  -- H&S – Day
  (p2,'hs_assistant',      'day','Ezetu Siminga',            ARRAY['FA','H&S'],1),

  -- Production – Night
  (p2,'rooibos_supervisor','night','Arnold Ndibongo',        ARRAY['FL','ER'],1),
  (p2,'pasteuriser_op',    'night','Hlalanathi Lusawana',    ARRAY['FL'],1),
  (p2,'bagging_vacuum',    'night','Mawande Ntshofu',        ARRAY['FL'],1),
  (p2,'bagging_vacuum',    'night','Sisonke Hobose',         ARRAY[]::text[],2),
  (p2,'bagging_vacuum',    'night','Luvo Tengile',           ARRAY[]::text[],3),
  (p2,'scanning_boxes',    'night','Zukisani Boyce',         ARRAY['FF'],1),
  (p2,'scanning_boxes',    'night','Abongile Kweyama',       ARRAY['C'],2),
  (p2,'scanning_boxes',    'night','Ayena Mququ',            ARRAY['C'],3),
  (p2,'granule_operator',  'night','Lamla Ndincede',         ARRAY['FL'],1),
  (p2,'granule',           'night','Lukhanyiso Ketshana',    ARRAY[]::text[],1),
  (p2,'refining_1',        'night','Buhle Nkohla',           ARRAY[]::text[],1),
  (p2,'sieving_tower',     'night','Grant Alexandra',        ARRAY['FL'],1),
  (p2,'sieving_tower',     'night','Siyabulela Nkohla',      ARRAY['FL'],2),
  (p2,'blender',           'night','Sithandile Maxazi',      ARRAY['FL'],1),
  (p2,'blender',           'night','Inga Ndikinda',          ARRAY[]::text[],2),
  -- Store – Night
  (p2,'store_supervisor',  'night','Steven Paris',           ARRAY['FL','SS'],1),
  (p2,'store_operator',    'night','Mbongeni Mtholo',        ARRAY['FL'],1),
  (p2,'store_operator',    'night','Siphelele Qobosha',      ARRAY['FL'],2),
  (p2,'store_operator',    'night','Peter Claasen',          ARRAY['FL'],3),
  (p2,'store_operator',    'night','Garnet Mpiyonke',        ARRAY[]::text[],4),
  -- QC – Night
  (p2,'qc_supervisor',     'night','Portia Jongilanga',      ARRAY[]::text[],1),
  (p2,'qc',                'night','Luvo Bobi',              ARRAY['FF'],1),
  (p2,'qc',                'night','Michaela Albertus',      ARRAY['FA'],2),
  (p2,'qc',                'night','Nkanyiso Magidigidi',    ARRAY[]::text[],3),
  (p2,'qc',                'night','Christopher Daniels',    ARRAY[]::text[],4),
  -- Cleaning – Night
  (p2,'cleaner_operator',  'night','Dumisani Makhendlana',   ARRAY['FL','ER'],1),
  (p2,'cleaner',           'night','Mequin Lukas',           ARRAY[]::text[],1),
  -- Maintenance – Night
  (p2,'maintenance_tech',  'night','John Magson',            ARRAY['FL'],1),
  (p2,'maintenance_asst',  'night','Mohapi Ramosala',        ARRAY[]::text[],1);

-- ─────────────────────────────────────────────────────────────────────────────
-- PERIOD 3: 13 – 17 Jul  (Arnold day / Sibusiso night – same as Week 1)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production.roster_entries (period_id, role_key, shift, person_name, tags, sort_order) VALUES
  -- Production – Day
  (p3,'rooibos_supervisor','day','Arnold Ndibongo',          ARRAY['FL','ER'],1),
  (p3,'pasteuriser_op',    'day','Lusindiso Maqhutyana',     ARRAY['FL'],1),
  (p3,'bagging_vacuum',    'day','Mawande Ntshofu',          ARRAY['FL'],1),
  (p3,'bagging_vacuum',    'day','Sisonke Hobose',           ARRAY[]::text[],2),
  (p3,'bagging_vacuum',    'day','Luvo Tengile',             ARRAY[]::text[],3),
  (p3,'scanning_boxes',    'day','Zukisani Boyce',           ARRAY['FF'],1),
  (p3,'scanning_boxes',    'day','Abongile Kweyama',         ARRAY['C'],2),
  (p3,'scanning_boxes',    'day','Philasande Mkhwambi',      ARRAY[]::text[],3),
  (p3,'granule_operator',  'day','Lamla Ndincede',           ARRAY['FL'],1),
  (p3,'granule',           'day','Lukhanyiso Ketshana',      ARRAY[]::text[],1),
  (p3,'refining_1',        'day','Buhle Nkohla',             ARRAY[]::text[],1),
  (p3,'sieving_tower',     'day','Grant Alexandra',          ARRAY['FL'],1),
  (p3,'sieving_tower',     'day','Kurt Braaf',               ARRAY['C'],2),
  (p3,'blender',           'day','Sithandile Maxazi',        ARRAY['FL'],1),
  (p3,'blender',           'day','Inga Ndikinda',            ARRAY[]::text[],2),
  (p3,'refining_2',        'day','Anda Mafombela',           ARRAY[]::text[],1),
  (p3,'refining_2',        'day','Siphoxolo Tibisondo',      ARRAY['C'],2),
  (p3,'rosehip',           'day','Louis Platjies',           ARRAY['FL'],1),
  (p3,'rosehip',           'day','Henry Dido',               ARRAY[]::text[],2),
  -- Store – Day
  (p3,'store_supervisor',  'day','Bongikhaya Ndikinda',      ARRAY['FL','ER','II','SS'],1),
  (p3,'store_operator',    'day','Mbongeni Mtholo',          ARRAY['FL'],1),
  (p3,'store_operator',    'day','Siphelele Qobosha',        ARRAY['FL'],2),
  (p3,'store_operator',    'day','Peter Claasen',            ARRAY['FL'],3),
  (p3,'store_operator',    'day','Sibabalo Lindi',           ARRAY['FL'],4),
  (p3,'store_operator',    'day','Nkosipendulo Vutuza',      ARRAY['FL'],5),
  (p3,'store_operator',    'day','Garnet Mpiyonke',          ARRAY[]::text[],6),
  -- QC – Day
  (p3,'qc_supervisor',     'day','Portia Jongilanga',        ARRAY[]::text[],1),
  (p3,'qc',                'day','Michaela Albertus',        ARRAY[]::text[],1),
  (p3,'qc',                'day','Nkanyiso Magidigidi',      ARRAY[]::text[],2),
  (p3,'qc',                'day','Christopher Daniels',      ARRAY[]::text[],3),
  (p3,'lab_analyst',       'day','Dineo Ngomani',            ARRAY[]::text[],1),
  (p3,'incoming_goods_qc', 'day','Siyasanga Madasa',         ARRAY[]::text[],1),
  -- Cleaning – Day
  (p3,'cleaner',           'day','Akhona Mququ',             ARRAY['SHER'],1),
  (p3,'hs_assistant',      'day','Ezetu Siminga',            ARRAY['FA'],1),
  (p3,'cleaner_operator',  'day','Dumisani Makhendlana',     ARRAY['FL','ER'],1),
  (p3,'cleaner',           'day','Ryan Alexander',           ARRAY[]::text[],2),
  (p3,'cleaner',           'day','Mequin Lukas',             ARRAY[]::text[],3),
  (p3,'cleaner',           'day','Simphiwe Mphefu',          ARRAY[]::text[],4),
  (p3,'cleaner',           'day','Le Mark Louw',             ARRAY['FM'],5),
  (p3,'cleaner',           'day','Bonginkosi Vikilane',      ARRAY['SHER'],6),
  -- Maintenance – Day
  (p3,'maintenance_tech',  'day','John Magson',              ARRAY['FL'],1),
  (p3,'maintenance_asst',  'day','Mohapi Ramosala',          ARRAY[]::text[],1),

  -- Production – Night
  (p3,'rooibos_supervisor','night','Sibusiso Magqujana',     ARRAY['FL','ER','II','FM'],1),
  (p3,'pasteuriser_op',    'night','Hlalanathi Lusawana',    ARRAY['FL'],1),
  (p3,'bagging_vacuum',    'night','Exavior Jansen',         ARRAY[]::text[],1),
  (p3,'bagging_vacuum',    'night','Siyavuya Jezile',        ARRAY['FL'],2),
  (p3,'bagging_vacuum',    'night','Chuma Bongozo',          ARRAY[]::text[],3),
  (p3,'scanning_boxes',    'night','Siyabonga Malusi',       ARRAY[]::text[],1),
  (p3,'scanning_boxes',    'night','Ayena Mququ',            ARRAY['C'],2),
  (p3,'scanning_boxes',    'night','Wanda Mpetsheni',        ARRAY['C'],3),
  (p3,'granule_operator',  'night','Bongikhaya Jele',        ARRAY['FL'],1),
  (p3,'granule',           'night','Sello Mokatane',         ARRAY['FL'],1),
  (p3,'refining_1',        'night','Alikho Ngwenduna',       ARRAY[]::text[],1),
  (p3,'sieving_tower',     'night','Lubabalo Qutu',          ARRAY['FL'],1),
  (p3,'sieving_tower',     'night','Siyabulela Nkohla',      ARRAY['FL'],2),
  (p3,'blender',           'night','Thembekile Madikane',    ARRAY['FL'],1),
  (p3,'blender',           'night','Zama Mamba',             ARRAY[]::text[],2),
  -- Store – Night
  (p3,'store_supervisor',  'night','Steven Paris',           ARRAY['FL','SS'],1),
  (p3,'store_operator',    'night','Johny Lameyer',          ARRAY['FL','FF'],1),
  (p3,'store_operator',    'night','Aphiwe Ntloko',          ARRAY['FL','FA','FF'],2),
  (p3,'store_operator',    'night','Sibulele Ntongana',      ARRAY['FL'],3),
  (p3,'store_operator',    'night','Lwandile Sikade',        ARRAY[]::text[],4),
  -- QC – Night
  (p3,'qc_supervisor',     'night','Ziyanda Nabi',           ARRAY[]::text[],1),
  (p3,'qc',                'night','Rose Tsatsi',            ARRAY['H&S'],1),
  (p3,'qc',                'night','Khotso Stuurman',        ARRAY['FA'],2),
  (p3,'qc',                'night','Luvo Bobi',              ARRAY[]::text[],3),
  (p3,'qc',                'night','Musa Buqwana',           ARRAY[]::text[],4),
  -- Cleaning – Night
  (p3,'cleaner_operator',  'night','Vulabeza Mvinjelwa',     ARRAY['FL'],1),
  (p3,'cleaner',           'night','Siyabonga Makhaluza',    ARRAY['FA'],1),
  -- Maintenance – Night
  (p3,'maintenance_tech',  'night','Shane Scott',            ARRAY['H&S'],1),
  (p3,'maintenance_asst',  'night','Yamkela Mpenge',         ARRAY[]::text[],1);

-- ─────────────────────────────────────────────────────────────────────────────
-- PERIOD 4: 20 – 24 Jul  (Sibusiso day / Arnold night – same as Week 2)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production.roster_entries (period_id, role_key, shift, person_name, tags, sort_order) VALUES
  -- Production – Day
  (p4,'rooibos_supervisor','day','Sibusiso Magqujana',       ARRAY['FL','ER','II','FM'],1),
  (p4,'pasteuriser_op',    'day','Lusindiso Maqhutyana',     ARRAY['FL'],1),
  (p4,'bagging_vacuum',    'day','Siyavuya Jezile',          ARRAY[]::text[],1),
  (p4,'bagging_vacuum',    'day','Sisonke Hobose',           ARRAY[]::text[],2),
  (p4,'bagging_vacuum',    'day','Chuma Bongozo',            ARRAY[]::text[],3),
  (p4,'scanning_boxes',    'day','Siyabonga Malusi',         ARRAY[]::text[],1),
  (p4,'scanning_boxes',    'day','Philasande Mkhwambi',      ARRAY[]::text[],2),
  (p4,'scanning_boxes',    'day','Wanda Mpetsheni',          ARRAY['C'],3),
  (p4,'granule_operator',  'day','Bongikhaya Jele',          ARRAY['FL'],1),
  (p4,'granule',           'day','Sello Mokatane',           ARRAY[]::text[],1),
  (p4,'refining_1',        'day','Alikho Ngwenduna',         ARRAY[]::text[],1),
  (p4,'sieving_tower',     'day','Lubabalo Qutu',            ARRAY['FL'],1),
  (p4,'sieving_tower',     'day','Kurt Braaf',               ARRAY['C'],2),
  (p4,'blender',           'day','Thembekile Madikane',      ARRAY['FL'],1),
  (p4,'blender',           'day','Zama Mamba',               ARRAY[]::text[],2),
  (p4,'refining_2',        'day','Anda Mafobhela',           ARRAY[]::text[],1),
  (p4,'refining_2',        'day','Siphoxolo Tibisondo',      ARRAY['C'],2),
  (p4,'rosehip',           'day','Louis Platjies',           ARRAY['FL'],1),
  (p4,'rosehip',           'day','Henry Dido',               ARRAY[]::text[],2),
  -- Store – Day
  (p4,'store_supervisor',  'day','Bongikhaya Ndikinda',      ARRAY['FL','ER','II','SS'],1),
  (p4,'store_operator',    'day','Johny Lameyer',            ARRAY['FL','FF'],1),
  (p4,'store_operator',    'day','Aphiwe Ntloko',            ARRAY['FL','FA','FF'],2),
  (p4,'store_operator',    'day','Mbongeni Mtholo',          ARRAY['FL'],3),
  (p4,'store_operator',    'day','Sibabalo Lindi',           ARRAY['FL'],4),
  (p4,'store_operator',    'day','Nkosipendulo Vutuza',      ARRAY['FL'],5),
  (p4,'store_operator',    'day','Lwandile Sikade',          ARRAY[]::text[],6),
  -- QC – Day
  (p4,'qc_supervisor',     'day','Ziyanda Nabi',             ARRAY[]::text[],1),
  (p4,'qc',                'day','Rose Tsatsi',              ARRAY['H&S'],1),
  (p4,'qc',                'day','Portia Jongilanga',        ARRAY[]::text[],2),
  (p4,'qc',                'day','Musa Buqwana',             ARRAY[]::text[],3),
  (p4,'lab_analyst',       'day','Dineo Ngomani',            ARRAY[]::text[],1),
  (p4,'incoming_goods_qc', 'day','Siyasanga Madasa',         ARRAY[]::text[],1),
  -- Cleaning – Day
  (p4,'cleaner',           'day','Akhona Mququ',             ARRAY[]::text[],1),
  (p4,'cleaner_operator',  'day','Vulabeza Mvinjelwa',       ARRAY['FL'],1),
  (p4,'cleaner',           'day','Simphiwe Mphefu',          ARRAY[]::text[],2),
  (p4,'cleaner',           'day','Siyabonga Makhaluza',      ARRAY['FA'],3),
  (p4,'cleaner',           'day','Bonginkosi Vikilane',      ARRAY[]::text[],4),
  (p4,'cleaner',           'day','Mequin Lukas',             ARRAY[]::text[],5),
  (p4,'cleaner',           'day','Le Mark Louw',             ARRAY[]::text[],6),
  -- Maintenance – Day
  (p4,'maintenance_tech',  'day','Shane Scott',              ARRAY['H&S'],1),
  (p4,'maintenance_asst',  'day','Yamkela Mpenge',           ARRAY[]::text[],1),
  -- H&S – Day
  (p4,'hs_assistant',      'day','Ezetu Siminga',            ARRAY['FA','H&S'],1),

  -- Production – Night
  (p4,'rooibos_supervisor','night','Arnold Ndibongo',        ARRAY['FL','ER'],1),
  (p4,'pasteuriser_op',    'night','Hlalanathi Lusawana',    ARRAY['FL'],1),
  (p4,'bagging_vacuum',    'night','Mawande Ntshofu',        ARRAY['FL'],1),
  (p4,'bagging_vacuum',    'night','Luvo Tengile',           ARRAY[]::text[],2),
  (p4,'bagging_vacuum',    'night','Exavior Jansen',         ARRAY[]::text[],3),
  (p4,'scanning_boxes',    'night','Zukisani Boyce',         ARRAY['FF'],1),
  (p4,'scanning_boxes',    'night','Abongile Kweyama',       ARRAY['C'],2),
  (p4,'scanning_boxes',    'night','Ayena Mququ',            ARRAY['C'],3),
  (p4,'granule_operator',  'night','Lamla Ndincede',         ARRAY['FL'],1),
  (p4,'granule',           'night','Lukhanyiso Ketshana',    ARRAY[]::text[],1),
  (p4,'refining_1',        'night','Buhle Nkohla',           ARRAY[]::text[],1),
  (p4,'sieving_tower',     'night','Grant Alexandra',        ARRAY['FL'],1),
  (p4,'sieving_tower',     'night','Siyabulela Nkohla',      ARRAY['FL'],2),
  (p4,'blender',           'night','Sithandile Maxazi',      ARRAY['FL'],1),
  (p4,'blender',           'night','Inga Ndikinda',          ARRAY[]::text[],2),
  -- Store – Night
  (p4,'store_supervisor',  'night','Steven Paris',           ARRAY['FL','SS'],1),
  (p4,'store_operator',    'night','Sibulelela Ntonga',      ARRAY['FL'],1),
  (p4,'store_operator',    'night','Siphelele Qobosha',      ARRAY['FL'],2),
  (p4,'store_operator',    'night','Peter Claasen',          ARRAY['FL'],3),
  (p4,'store_operator',    'night','Garnet Mpiyonke',        ARRAY[]::text[],4),
  -- QC – Night
  (p4,'qc_supervisor',     'night','Siyasanga Madasa',       ARRAY[]::text[],1),
  (p4,'qc',                'night','Luvo Bobi',              ARRAY['FF'],1),
  (p4,'qc',                'night','Michaela Albertus',      ARRAY['FA'],2),
  (p4,'qc',                'night','Nkanyiso Magidigidi',    ARRAY[]::text[],3),
  (p4,'qc',                'night','Christopher Daniels',    ARRAY[]::text[],4),
  (p4,'qc',                'night','Khotso Stuurman',        ARRAY['FA'],5),
  -- Cleaning – Night
  (p4,'cleaner_operator',  'night','Dumisani Makhendlana',   ARRAY['FL','ER'],1),
  (p4,'cleaner',           'night','Ryan Alexander',         ARRAY['FM'],1),
  -- Maintenance – Night
  (p4,'maintenance_tech',  'night','John Magson',            ARRAY['FL'],1),
  (p4,'maintenance_asst',  'night','Mohapi Ramosala',        ARRAY[]::text[],1);

END $$;
