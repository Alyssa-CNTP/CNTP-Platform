-- ============================================================
-- Training lessons — general embed URL (Scribe, not just YouTube)
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260710_001_hr_training.sql (hr.training_lessons)
--
-- The lesson video is switching from YouTube to Scribe (scribehow.com) —
-- Scribe's embed is a full iframe URL, not a bare video ID, so the column
-- generalizes to hold any embeddable URL. youtube_id is kept for any old
-- rows/back-compat; embed_url takes precedence when both are present.
-- ============================================================

ALTER TABLE hr.training_lessons
  ADD COLUMN IF NOT EXISTS embed_url text;

-- Point the already-seeded Sieving Tower lesson at the new Scribe walkthrough.
UPDATE hr.training_lessons
   SET embed_url = 'https://scribehow.com/embed/How_To_Capture_And_Submit_Production_Data_At_CNTP__PG0oRuzuSO-8-dRj5ByOJg?as=video'
 WHERE course_id = (SELECT id FROM hr.training_courses WHERE slug = 'sieving-tower-capture')
   AND title = 'Sieving Tower capture — full walkthrough';
