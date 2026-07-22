-- ============================================================
-- Sieving Tower — Digital Capture: training course + assessment
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260702_001_competency_matrix.sql (production.sops seed incl.
--             PROD-WI-004 "Sieving Tower (Rooibos)") and
--             20260710_001_hr_training.sql (hr.* training tables +
--             production.sops.requires_practical_signoff).
--
-- This course is built around how operators ACTUALLY capture on the tablet
-- (components/production/capture/SievingCapture.tsx) — not the legacy paper
-- form. Passing the assessment maps to the Sieving Tower SOP competency; the
-- SOP is flagged requires_practical_signoff, so a pass sets 'assessed' and a
-- supervisor confirms hands-on competence to reach 'competent' (which is what
-- role_required_sops needs to be "equipped to capture at the sieving tower").
--
-- Idempotent: re-running is a no-op for content once the course exists, so it
-- never clobbers assignments/attempts already recorded against it. Only the
-- one-line practical-signoff flag is (harmlessly) re-applied every run.
-- ============================================================

-- ── 1. Sieving Tower SOP requires a hands-on practical sign-off ──────────────
UPDATE production.sops
   SET requires_practical_signoff = true
 WHERE doc_no = 'PROD-WI-004';

-- ── 2. Course content (guarded so a re-run never destroys live data) ─────────
DO $$
DECLARE
  v_course uuid;
  v_sop    uuid;
  q        uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM hr.training_courses WHERE lower(slug) = 'sieving-tower-capture') THEN
    RAISE NOTICE 'Course sieving-tower-capture already exists — skipping content seed.';
    RETURN;
  END IF;

  SELECT id INTO v_sop FROM production.sops WHERE doc_no = 'PROD-WI-004';
  IF v_sop IS NULL THEN
    RAISE EXCEPTION 'SOP PROD-WI-004 (Sieving Tower) not found — run 20260702_001_competency_matrix.sql first.';
  END IF;

  INSERT INTO hr.training_courses (slug, title, description, area, status, pass_threshold, sort_order)
  VALUES (
    'sieving-tower-capture',
    'Sieving Tower — Digital Capture',
    'How to capture a Sieving Tower shift on the tablet: debagging material in, bagging product out, the bucket elevator, spillage and mass balance. Watch the walkthrough, then take the assessment.',
    'production', 'active', 0.75, 40
  ) RETURNING id INTO v_course;

  -- Map the course to the Sieving Tower SOP competency.
  INSERT INTO hr.course_sops (course_id, sop_id) VALUES (v_course, v_sop);

  -- ── Lesson: the screen-recorded walkthrough ───────────────────────────────
  INSERT INTO hr.training_lessons (course_id, title, youtube_id, body, sort_order, required)
  VALUES (
    v_course,
    'Sieving Tower capture — full walkthrough',
    'mqxjTn5-iTA',
    'Watch the full capture process end to end: signing in, debagging material in, the bucket elevator and spillage, then bagging product out and printing labels. Take your time — you can rewatch before the assessment.',
    0, true
  );

  -- ── Assessment ─────────────────────────────────────────────────────────────
  -- Helper pattern per question: insert the question (RETURNING id INTO q),
  -- then insert its options referencing q.

  -- A. Your responsibilities on the line
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 1, 'Who signs in with their PIN and is responsible for capturing the shift''s production on the tablet?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'The Supervisor', false, 0),
    (q, 'The Line Operator', true, 1),
    (q, 'Quality', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 2, 'Who is responsible for reporting any issues or faults on the line? (Select all that apply.)', 'multi_choice', 2) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'The Line Operator', true, 0),
    (q, 'Quality', true, 1),
    (q, 'Maintenance', true, 2),
    (q, 'The cleaning staff', false, 3);

  -- B. Debagging — material IN
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 3, 'On the capture screen, what does the Debagging tab record?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'The material going INTO the machine — each bulk bag weighed in', true, 0),
    (q, 'The finished product bags coming out', false, 1),
    (q, 'Only the spillage for the day', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 4, 'For each bulk bag on the Debagging tab, which fields must you complete before it will lock? (Select all that apply.)', 'multi_choice', 2) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Bag no.', true, 0),
    (q, 'Lot / serial', true, 1),
    (q, 'Nett weight (kg)', true, 2),
    (q, 'Bulk density', false, 3);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 5, 'What format must the Lot / serial you enter be in?', 'single_choice', 1, 'The app rejects a lot without a dash so a dropped digit or missing dash is caught before it becomes a batch number that matches nothing real.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'At least one dash separating letters/numbers, e.g. GS-0299 or GS26-MIX-A', true, 0),
    (q, 'A single word with no dashes or spaces', false, 1),
    (q, 'Exactly six digits, numbers only', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, image_url)
  VALUES (v_course, 6, 'Reading this incoming raw-material label, what Lot number do you enter for the bulk bag on the Debagging tab?', 'short_text', 1, '/training/sieving/raw-material-label.png') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'VS24-046', true, 0),
    (q, 'VS24 046', true, 1),
    (q, 'VS24046', true, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 7, 'When you have filled in every field for a bulk bag, what happens on the tablet?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'The bag locks and secures itself with a timestamp — you can still tap Edit to reopen it', true, 0),
    (q, 'Nothing is saved until the end of the shift', false, 1),
    (q, 'It immediately prints a barcode label', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 8, 'How do you enter a weight of one thousand two hundred point five kilograms on the tablet?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Type it with a comma: 1200,5', true, 0),
    (q, 'Round it down to 1200', false, 1),
    (q, 'Type 1200 space 5', false, 2);

  -- C. Bucket elevator & spillage — direction is the key idea
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 9, 'On the MORNING shift, the bucket elevator carry-over counts as…', 'single_choice', 1, 'The morning shift consumes what yesterday left in the elevator, so it is an input captured on the Debagging tab.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'An INPUT — material from yesterday, consumed this morning', true, 0),
    (q, 'An output — product leaving the line', false, 1),
    (q, 'It is not recorded', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 10, 'On the AFTERNOON shift, the bucket elevator counts as…', 'single_choice', 1, 'The afternoon shift leaves material in the elevator for the next day, so it is an output captured on the Bagging tab.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'An OUTPUT — material left in the tower for tomorrow', true, 0),
    (q, 'An input — material consumed today', false, 1),
    (q, 'Machine spillage', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 11, 'Machine spillage always counts as…', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'An input loss', true, 0),
    (q, 'An output', false, 1),
    (q, 'Something you do not need to capture', false, 2);

  -- D. Bagging — material OUT
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 12, 'When you add an output bag on the Bagging tab, where does the serial number come from?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'The system generates it automatically', true, 0),
    (q, 'You make one up and write it down', false, 1),
    (q, 'It is the raw-material lot number', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 13, 'After an output bag is added, how is it labelled?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Print a Code128 barcode label, or write on the tag', true, 0),
    (q, 'It never needs a label', false, 1),
    (q, 'Only Quality can label it later', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 14, 'The batch / lot you choose for an output bag must be…', 'single_choice', 1, 'Output batches must trace back to a lot actually fed in this run, so a typo cannot introduce a batch that was never debagged.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'A lot that was actually debagged in this run', true, 0),
    (q, 'Any number you like', false, 1),
    (q, 'Your operator PIN', false, 2);

  -- E. Standard weights, grade & safety knowledge
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 15, 'What is the standard bag weight for coarse leaf, fine leaf, block and dust?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, '300 kg', true, 0),
    (q, '216 kg', false, 1),
    (q, '252 kg', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 16, 'What is the standard bag weight for heavy stick?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, '216 kg', true, 0),
    (q, '300 kg', false, 1),
    (q, '252 kg', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 17, 'What is the standard bag weight for indent stick?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, '252 kg', true, 0),
    (q, '300 kg', false, 1),
    (q, '216 kg', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 18, 'Can you mix A grade material with B grade material?', 'true_false', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'No', true, 0),
    (q, 'Yes', false, 1);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 19, 'What must happen if the machine breaks down during a run?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Stop the line immediately, then inform the supervisor', true, 0),
    (q, 'Keep the line running and call maintenance', false, 1),
    (q, 'Wait until the end of the shift to report it', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 20, 'On the indent-stick output from the Top Indent (Cimbria), what must you check for?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Any leaf or block product', true, 0),
    (q, 'Only fine dust', false, 1),
    (q, 'The colour of the sticks', false, 2);

  -- F. Mass balance
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 21, 'At the bottom of each tab the screen shows Total raw material in and Total bagged out. These figures should…', 'single_choice', 1, 'What went in should account for what came out plus spillage and bucket-elevator carry — that is the run''s mass balance.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Reconcile — what went in accounts for what came out, plus spillage and bucket-elevator carry', true, 0),
    (q, 'Always be exactly zero', false, 1),
    (q, 'Never be compared to each other', false, 2);

  RAISE NOTICE 'Seeded course sieving-tower-capture (%) mapped to SOP % with 21 questions.', v_course, v_sop;
END $$;
