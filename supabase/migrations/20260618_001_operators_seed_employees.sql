-- ============================================================
-- CNTP Production Capture — Seed operators from the employee list
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- Imports the full CNTP employee roster (77 names) into
-- production.operators so the supervisor's assign screen can roster
-- anyone via the searchable name dropdown.
--
-- PINs are assigned LATER in the operators admin screen, so `pin` is
-- made nullable and these rows are seeded with pin = NULL. An operator
-- can be rostered immediately, but cannot sign on the tablet until a
-- supervisor sets their 4-digit PIN.
--
-- Re-runnable: each name is only inserted if it doesn't already exist
-- (case-insensitive), so existing operators (e.g. Alyssa/Cyril/Gustav)
-- and prior runs are never duplicated.
-- ============================================================

-- PINs are now optional (assigned later in the operators admin).
ALTER TABLE production.operators ALTER COLUMN pin DROP NOT NULL;

INSERT INTO production.operators (name, role, section_ids, active)
SELECT v.name,
       'floor_operator',
       ARRAY['sieving','refining1','refining2','granule','blender','pasteuriser'],
       true
FROM (VALUES
  ('Abongile Kweyama'),
  ('Akhona Mququ'),
  ('Alikho Ngwenduna'),
  ('Amoretta Louw'),
  ('Anda Mafombela'),
  ('Aphiwe Ntloko'),
  ('Arnold Ndibongo'),
  ('Ayena Mququ'),
  ('Bongikaya Ndikinda'),
  ('Bongikhaya Jele'),
  ('Bonginkosi Vikilahle'),
  ('Buhle Nkohla'),
  ('Christopher Daniels'),
  ('Chuma Bongoza'),
  ('Dineo Ngomani'),
  ('Exavior Jansen'),
  ('Ganette Mpiyonke'),
  ('Grant Alexander'),
  ('Henry Dido'),
  ('Hlalanathi Lusawana'),
  ('Inga Ndikinda'),
  ('John Magson'),
  ('Johny Lameyer'),
  ('Khotso Stuurman'),
  ('Kurt Braaf'),
  ('Lamla Ndincede'),
  ('Le Marc Louw'),
  ('Louis Plaatjies'),
  ('Lubabalo Qutu'),
  ('Lukhanyiso Ketshana'),
  ('Lusindiso Maqutyana'),
  ('Luvo Bobi'),
  ('Luvo Tengile'),
  ('Lwandile Sikade'),
  ('Mawande Ntshofu'),
  ('Mbongeni Mtolo'),
  ('Mequin Lukas'),
  ('Michaela Albertus'),
  ('Michelle Brown'),
  ('Mihlali Ngqwala'),
  ('Mohapi Ramosala'),
  ('Monique Gordon'),
  ('Musa Buqwana'),
  ('Nkanyiso Magidigidi'),
  ('Nkosiphendule Vutza'),
  ('Peter Claasen'),
  ('Philasande Mkhwambi'),
  ('Portia Jongilanga'),
  ('Robert Makendlana'),
  ('Rose Tsatsi'),
  ('Ryan Alexander'),
  ('Sello Mokotane'),
  ('Shane Scott'),
  ('Shannon Bent'),
  ('Sibabalo Lindi'),
  ('Sibulele Ntongana'),
  ('Sibusiso Magqujana'),
  ('Simphiwe Mphefu'),
  ('Siphelele Qhobosha'),
  ('Siphenathi Simanga'),
  ('Siphuxolo Tibisono'),
  ('Sisonke Hobose'),
  ('Sithandile Maxazi'),
  ('Siyabonga Xolilizwe'),
  ('Siyabonga Makhulaza'),
  ('Siyabulela Nkhola'),
  ('Siyasanga Madasa'),
  ('Siyavuya Jezile'),
  ('Steven Paris'),
  ('Tamlyn de Vos'),
  ('Thembekile Madikane'),
  ('Vulabeza Mvinjelwa'),
  ('Wanda Mpetsheni'),
  ('Yamkela Mpenge'),
  ('Zama Mamba'),
  ('Ziyanda Nabi'),
  ('Zukisani Boyce')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM production.operators o WHERE lower(o.name) = lower(v.name)
);
