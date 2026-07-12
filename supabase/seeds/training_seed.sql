-- ============================================================
-- Training seed — digitizes the 3 existing paper assessments
-- Run in: Supabase SQL Editor, AFTER 20260710_001_hr_training.sql
-- (staging first, then production once promoted)
-- ============================================================
--
-- Source documents:
--   Refining 1 Assessment MEMO 10052024.docx      (24 marks)
--   Sieving Tower Assessment - MEMO 10052024.docx  (29 marks stated; line items sum to 30 —
--                                                    a pre-existing 1-mark inconsistency in the
--                                                    original paper memo, kept faithful here)
--   Pasteuriser Assessment MEMO 13062024.docx      (43 marks — reconciles once the 2-mark
--                                                    "Bonus Question" is included in the total)
--
-- NOTE on correct answers: the original memos mark the correct option by hand
-- (circling on a printed copy) — that signal does not survive in the .docx
-- text/formatting. Four repeated "who is responsible" questions were
-- confirmed directly with the training owner on 2026-07-10 (see explanation
-- field on those questions). Everything else is unambiguous from the memo
-- text (numeric answers, fill-ins, or self-evident from the mark structure).
--
-- Lessons are seeded with a placeholder youtube_id — replace via
-- /training/manage once the real work-instruction videos are ready.
--
-- Idempotent: courses upsert by slug; each course's lessons/questions/
-- SOP-mappings are wiped and re-inserted so this file can be re-run safely.
-- Once the in-app authoring UI is used, re-running this file will discard
-- those edits — treat it as a one-time bootstrap, not a source of truth.
-- ============================================================

DO $$
DECLARE
  v_course_id uuid;
  v_lesson_id uuid;
  v_q_id      uuid;
  v_sop_id    uuid;
BEGIN

-- ================================================================
-- COURSE 1 — Refining 1
-- ================================================================

INSERT INTO hr.training_courses (slug, title, description, area, status, pass_threshold, sort_order)
VALUES (
  'refining-1', 'Refining 1 — Operator Training',
  'Machine operation, responsibilities, standard weights and safety for the Refining 1 line (Sivtek sieve + Hippo hammer mill). Digitized from the paper Refining 1 Assessment.',
  'production', 'active', 0.80, 10
)
ON CONFLICT (lower(slug)) DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now()
RETURNING id INTO v_course_id;

DELETE FROM hr.training_questions WHERE course_id = v_course_id; -- cascades to options
DELETE FROM hr.training_lessons   WHERE course_id = v_course_id;
DELETE FROM hr.course_sops        WHERE course_id = v_course_id;

INSERT INTO hr.training_lessons (course_id, title, youtube_id, body, sort_order, required)
VALUES (v_course_id, 'Refining 1 — Work Instruction Walkthrough', 'REPLACE_WITH_YOUTUBE_ID',
  'Startup/setup, achieving targets, sieving on the Sivtek, milling on the Hippo hammer mill, dust extraction, and shift-end cleaning. Covers PROD-WI-002.',
  1, true);

-- Q1 — pre-start check
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 1, 'Who is responsible for any pre-start check?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Supervisor', false, 1), (v_q_id, 'Line Operator', true, 2);

-- Q2 — line neat and in order
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 2, 'Who is responsible to make sure the line is neat and in order?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Line Operator', false, 2), (v_q_id, 'Hygiene', true, 3);

-- Q3 — reporting issues/faults (multi-select, all 3 correct)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 3, 'Who is responsible for reporting any issues/faults on the line? (more than one can be selected)', 'multi_choice', 3)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Line Operator', true, 1), (v_q_id, 'Quality', true, 2), (v_q_id, 'Maintenance', true, 3);

-- Q4 — dust extraction
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 4, 'Who should ensure that the dust extraction system is functioning and that we do not have excessive dust coming from the line?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Maintenance', false, 1), (v_q_id, 'Quality', false, 2), (v_q_id, 'Line Operator', true, 3);

-- Q5 — completing forms during shift
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 5, 'Who is responsible to complete all the forms during the shift?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10 — matches the live tablet-capture system.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Supervisor', false, 2), (v_q_id, 'Line Operator', true, 3);

-- Q6 — standard weights (0.5 each = 1.5 marks)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 6, 'What is the standard weight of an Indent Dust bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 7, 'What is the standard weight of a White Dust bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 8, 'What is the standard weight of a Brown Dust bag (kg)?', 'numeric', 0.5, 300, 0);

-- Q7 — abbreviations (0.5 each = 1.5 marks), auto-graded short_text
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 9, 'What is the correct abbreviation for Indent Dust?', 'short_text', 0.5)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES (v_q_id, 'IS', true, 1);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 10, 'What is the correct abbreviation for White Dust?', 'short_text', 0.5)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES (v_q_id, 'WD', true, 1);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 11, 'What is the correct abbreviation for Brown Dust?', 'short_text', 0.5)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES (v_q_id, 'BD', true, 1);

-- Q8 — breakdown procedure
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 12, 'What needs to happen in the case of a breakdown on the machine?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Stop the line immediately, then inform the supervisor', true, 1),
  (v_q_id, 'Inform the supervisor', false, 2),
  (v_q_id, 'Call maintenance', false, 3);

-- Q9 — mix white dust with brown dust
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 13, 'Can you mix white dust with brown dust material?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', false, 1), (v_q_id, 'No', true, 2);

-- Q10 — mesh size in the Sivtek
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 14, 'What size of mesh do you use to make dust in the Sivtek?', 'short_text', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '40#', true, 1), (v_q_id, '40', true, 2), (v_q_id, '40 mesh', true, 3);

-- Q11 — machine used to sieve
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 15, 'What machine do you use to sieve your material at Refining 1?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Sivtek', true, 1), (v_q_id, 'Hippo – Hammer Mill', false, 2), (v_q_id, 'Rotex', false, 3);

-- Q12 — machine used to mill
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 16, 'What machine do you use to mill your material (turn the material into dust)?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Hippo – Hammer Mill', true, 1), (v_q_id, 'Sivtek', false, 2), (v_q_id, 'Rotex', false, 3);

-- Q13 — operator responsibilities (open, marker's discretion)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 17, 'Can you please explain the responsibility of the operator? (list at least 3)', 'short_text', 3, true,
  'Any 3 of: startup/setup of the line; achieving targets and ensuring quality; keeping the line neat and running smoothly and reporting issues.')
RETURNING id INTO v_q_id;

-- Q15 — daily production targets (0.5 each = 2 marks total across the 2 sub-Qs; tolerance covers the memo''s accepted range)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance, explanation)
VALUES (v_course_id, 18, 'How much Indent Dust must you produce per day (kg)? (target range 1600–1800kg)', 'numeric', 1, 1700, 100,
  'Any answer in the 1600–1800kg range is acceptable.');
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance, explanation)
VALUES (v_course_id, 19, 'How much White Dust must you produce per day (kg)? (target range 1300–1500kg)', 'numeric', 1, 1400, 100,
  'Any answer in the 1300–1500kg range is acceptable.');

-- Q16 — dust extraction cleaning frequency
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 20, 'How many times do you clean the dust extraction per 9-hour shift?', 'short_text', 1,
  '"1" or "when there is an issue on the dust system" are both accepted.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '1', true, 1), (v_q_id, 'once', true, 2), (v_q_id, 'when there is an issue', true, 3);

-- Q17 — dust bag/filter strapping check
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 21, 'What must you check for when putting the dust bags and filter on, when strapping them?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'That there is a proper seal behind the ratchet strap, so that no material can come out', true, 1),
  (v_q_id, 'That the bag is the correct colour', false, 2),
  (v_q_id, 'That the bag number matches the batch sheet', false, 3);

-- Q18 — magnets on machines
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 22, 'Do you have magnets on your machines?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', true, 1), (v_q_id, 'No', false, 2);

-- Q19 — who cleans magnets
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 23, 'Who''s responsible for cleaning your magnets?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Hygiene', true, 1), (v_q_id, 'Line Operator', false, 2), (v_q_id, 'Maintenance', false, 3);

-- Map to SOP + require practical sign-off (hands-on machine operation)
SELECT id INTO v_sop_id FROM production.sops WHERE lower(doc_no) = lower('PROD-WI-002');
IF v_sop_id IS NOT NULL THEN
  INSERT INTO hr.course_sops (course_id, sop_id) VALUES (v_course_id, v_sop_id) ON CONFLICT DO NOTHING;
  UPDATE production.sops SET requires_practical_signoff = true WHERE id = v_sop_id;
END IF;


-- ================================================================
-- COURSE 2 — Sieving Tower
-- ================================================================

INSERT INTO hr.training_courses (slug, title, description, area, status, pass_threshold, sort_order)
VALUES (
  'sieving-tower', 'Sieving Tower — Operator Training',
  'Grades, sieving configuration, bag labelling and machine controls for the Sieving Tower. Digitized from the paper Sieving Tower Assessment.',
  'production', 'active', 0.80, 20
)
ON CONFLICT (lower(slug)) DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now()
RETURNING id INTO v_course_id;

DELETE FROM hr.training_questions WHERE course_id = v_course_id;
DELETE FROM hr.training_lessons   WHERE course_id = v_course_id;
DELETE FROM hr.course_sops        WHERE course_id = v_course_id;

INSERT INTO hr.training_lessons (course_id, title, youtube_id, body, sort_order, required)
VALUES (v_course_id, 'Sieving Tower — Work Instruction Walkthrough', 'REPLACE_WITH_YOUTUBE_ID',
  'Debagging on the Cimbria, grade sieving configuration, bag labelling, and machine controls. Covers PROD-WI-004.',
  1, true);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 1, 'Who is responsible for any pre-start check?', 'single_choice', 1, 'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Supervisor', false, 1), (v_q_id, 'Line Operator', true, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 2, 'Who is responsible for making sure the line is neat and in order?', 'single_choice', 1, 'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Line Operator', false, 2), (v_q_id, 'Hygiene', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 3, 'Who is responsible for reporting any issues/faults on the line? (more than one can be selected)', 'multi_choice', 3)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Line Operator', true, 1), (v_q_id, 'Quality', true, 2), (v_q_id, 'Maintenance', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 4, 'Who should ensure that the dust extraction system is functioning and that we do not have excessive dust coming from the line?', 'single_choice', 1, 'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Maintenance', false, 1), (v_q_id, 'Quality', false, 2), (v_q_id, 'Line Operator', true, 3);

-- Indent stick output check on the Top Indent (Cimbria)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 5, 'What should the operator check for on the Indent stick output coming from the Top indent (Cimbria)?', 'short_text', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'leaf', true, 1), (v_q_id, 'block', true, 2), (v_q_id, 'any leaf or block product', true, 3), (v_q_id, 'leaf or block', true, 4);

-- Sieving configuration matching (4 marks — one sub-question per grade)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 6, 'What is the correct 3-stage sieving configuration for Grade A?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '12# → 18# → 40#', true, 1), (v_q_id, '12# → 20# → 40#', false, 2), (v_q_id, '10# → 18# → 40#', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 7, 'What is the correct 3-stage sieving configuration for Grade B?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '12# → 18# → 40#', true, 1), (v_q_id, '12# → 20# → 40#', false, 2), (v_q_id, '10# → 18# → 40#', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 8, 'What is the correct 3-stage sieving configuration for Grade C?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '12# → 20# → 40#', true, 1), (v_q_id, '12# → 18# → 40#', false, 2), (v_q_id, '10# → 18# → 40#', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 9, 'What is the correct 3-stage sieving configuration for Organic?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '10# → 18# → 40#', true, 1), (v_q_id, '12# → 18# → 40#', false, 2), (v_q_id, '12# → 20# → 40#', false, 3);

-- Bag label completion (9 marks) — inherently hands-on, routed to the training officer
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 10,
  'Describe how you would complete an output bag label if you started sieving out today: variant code, date (DD-MM), bag number, net weight, and your name.',
  'short_text', 9, true,
  'Practical labelling task — best verified alongside the practical sign-off. Expected: today''s DD-MM, sequential bag number, 300kg, operator name on the VS24-046-style label.')
RETURNING id INTO v_q_id;

-- Screen info
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 11, 'What information does the machine screen tell the operator (the value shown during running)?', 'short_text', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'speed', true, 1), (v_q_id, 'the speed of the line', true, 2), (v_q_id, 'line speed', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 12, 'Who is responsible for completing all the forms during the shift?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10 — matches the live tablet-capture system.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Supervisor', false, 2), (v_q_id, 'Line Operator', true, 3);

-- Standard weights (0.5 each = 3 marks)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 13, 'What is the standard weight of a Heavy Stick bag (kg)?', 'numeric', 0.5, 216, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 14, 'What is the standard weight of a Block bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 15, 'What is the standard weight of a Coarse Leaf bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 16, 'What is the standard weight of a Fine Leaf bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 17, 'What is the standard weight of a Dust bag (kg)?', 'numeric', 0.5, 300, 0);
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 18, 'What is the standard weight of an Indent Stick bag (kg)?', 'numeric', 0.5, 252, 0);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 19, 'What needs to happen in the case of a breakdown on the machine?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Stop the line immediately, then inform the supervisor', true, 1),
  (v_q_id, 'Inform the supervisor', false, 2),
  (v_q_id, 'Call maintenance', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 20, 'Can you mix A grade with B grade material?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', false, 1), (v_q_id, 'No', true, 2);

-- E-stop / speed screen (2 marks) — needs the annotated machine photo attached by the training officer
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 21, 'Point out the emergency stop button and the screen showing the line speed on the machine.', 'short_text', 2, true,
  'Attach the annotated machine photo via the course editor once available, then grade against it directly.')
RETURNING id INTO v_q_id;

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 22, 'What is the correct indent screen setting (per the machine reference picture)?', 'numeric', 1, -2.5, 0.1);

-- Map to SOP + require practical sign-off
SELECT id INTO v_sop_id FROM production.sops WHERE lower(doc_no) = lower('PROD-WI-004');
IF v_sop_id IS NOT NULL THEN
  INSERT INTO hr.course_sops (course_id, sop_id) VALUES (v_course_id, v_sop_id) ON CONFLICT DO NOTHING;
  UPDATE production.sops SET requires_practical_signoff = true WHERE id = v_sop_id;
END IF;


-- ================================================================
-- COURSE 3 — Pasteuriser
-- ================================================================

INSERT INTO hr.training_courses (slug, title, description, area, status, pass_threshold, sort_order)
VALUES (
  'pasteuriser', 'Pasteuriser — Operator Training',
  'Sieving configuration, temperature/moisture control, changeover procedure and machine controls for the Pasteuriser line. Digitized from the paper Pasteuriser Assessment.',
  'production', 'active', 0.80, 30
)
ON CONFLICT (lower(slug)) DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now()
RETURNING id INTO v_course_id;

DELETE FROM hr.training_questions WHERE course_id = v_course_id;
DELETE FROM hr.training_lessons   WHERE course_id = v_course_id;
DELETE FROM hr.course_sops        WHERE course_id = v_course_id;

INSERT INTO hr.training_lessons (course_id, title, youtube_id, body, sort_order, required)
VALUES (v_course_id, 'Pasteuriser — Work Instruction Walkthrough', 'REPLACE_WITH_YOUTUBE_ID',
  'Sieving/dryer configuration, jets, changeover between Conventional and Organic, and moisture/temperature response actions. Covers PROD-WI-003.',
  1, true);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 1, 'Who is responsible for any pre-start check?', 'single_choice', 1, 'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Supervisor', false, 1), (v_q_id, 'Line Operator', true, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 2, 'Who is responsible for making sure the line is neat and in order?', 'single_choice', 1, 'Confirmed with training owner 2026-07-10.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Line Operator', false, 2), (v_q_id, 'Hygiene', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 3, 'Who is responsible for reporting any issues/faults on the line? (more than one can be selected)', 'multi_choice', 3)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Line Operator', true, 1), (v_q_id, 'Quality', true, 2), (v_q_id, 'Maintenance', true, 3);

-- Sieving configuration for the pasteuriser line (3 marks)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 4, 'What is the correct sieving configuration for the pasteuriser line?', 'single_choice', 3)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, '3mm perforated plate / 40# dryer / 40# dust sieve', true, 1),
  (v_q_id, '4mm perforated plate / 20# dryer / 20# dust sieve', false, 2),
  (v_q_id, '3mm perforated plate / 20# dryer / 40# dust sieve', false, 3),
  (v_q_id, '5mm perforated plate / 18# dryer / 20# dust sieve', false, 4);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 5, 'When does the dryer need to be cleaned?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'End of shift', true, 1), (v_q_id, 'Start of shift', false, 2), (v_q_id, 'Once a week', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 6, 'Who is responsible for completing all the forms during the shift?', 'single_choice', 1,
  'Confirmed with training owner 2026-07-10 — matches the live tablet-capture system.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Quality', false, 1), (v_q_id, 'Supervisor', false, 2), (v_q_id, 'Line Operator', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 7, 'How do you increase the speed of the pasteuriser?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'By increasing (opening) the rotary valve', true, 1),
  (v_q_id, 'By increasing the fan speed', false, 2),
  (v_q_id, 'By increasing the dryer temperature', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 8, 'What needs to happen in the case of a breakdown on the machine?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Stop the line immediately, then inform the supervisor', true, 1),
  (v_q_id, 'Inform the supervisor', false, 2),
  (v_q_id, 'Call maintenance', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 9, 'Can you mix Organic with Conventional material?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', false, 1), (v_q_id, 'No', true, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 10, 'What needs to happen when changing over from Conventional to Organic?', 'single_choice', 2)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Run the line empty, deep clean, then purge the line with LOW PA material', true, 1),
  (v_q_id, 'Just run the Organic material through', false, 2),
  (v_q_id, 'Deep clean only, no purge needed', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 11, 'What material do you use to clean the line when you change over from Conventional to Organic?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'LOW PA', true, 1), (v_q_id, 'High PA', false, 2), (v_q_id, 'Water only', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 12, 'What is the correct temperature at the dryer?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'More than 100°C', false, 1), (v_q_id, '50–115°C', true, 2), (v_q_id, '200–220°C', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, numeric_answer, numeric_tolerance)
VALUES (v_course_id, 13, 'How many jets must be open at the pasteuriser?', 'numeric', 1, 6, 0);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 14, 'When do you check the jets at the pasteuriser?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Start of morning shift', true, 1), (v_q_id, 'End of shift', false, 2), (v_q_id, 'Once a week', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 15, 'How do you check the jets at the pasteuriser?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Open the top of the pasteuriser lid and check for steam coming from the nozzle', true, 1),
  (v_q_id, 'Listen for a hissing sound', false, 2),
  (v_q_id, 'Check the pressure gauge only', false, 3);

-- Moisture-response scenarios (running Super Grade for National Brands, spec 9.2%)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
VALUES (v_course_id, 16,
  'You are the pasteuriser operator running Super Grade for National Brands, moisture spec 9.2%. Quality tells you the moisture result is 7% while running with a debagging setting of 6. What must you do?',
  'single_choice', 3, 'Moisture reads low → speed up debagging (and granules if necessary) to bring moisture back toward spec.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Speed up the line, by increasing debagging speed (and granules if necessary)', true, 1),
  (v_q_id, 'Slow down the line', false, 2),
  (v_q_id, 'Reduce the fan speed', false, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 17, 'Quality lets you know you have a moisture result of 9% while running with a debagging setting of 8. Can you speed up?', 'single_choice', 2)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', true, 1), (v_q_id, 'No', false, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 18, 'Quality lets you know you have a moisture result of 11% while running with a debagging setting of 8.5. What do you need to do to get the moisture back in spec?', 'single_choice', 2)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Increase debagging speed', false, 1), (v_q_id, 'Reduce debagging speed', true, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 19, 'What should the pasteuriser (middle probe) temperature be?', 'single_choice', 2)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Less than 85°C', false, 1), (v_q_id, 'More than 85°C', false, 2), (v_q_id, 'Between 70°C and 85°C', true, 3);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 20, 'Can you continue running final product if the pasteuriser (middle probe) drops below 85°C?', 'single_choice', 1)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Yes', false, 1), (v_q_id, 'No', true, 2);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
VALUES (v_course_id, 21, 'What needs to happen if Quality informs you, the pasteuriser operator, that the moisture is out of spec (too high)?', 'single_choice', 3)
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'Stop packing final product, put a ''high moisture'' bulk bag at bagging, reduce pasteuriser speed, and wait until Quality confirms moisture is back in spec before packing again', true, 1),
  (v_q_id, 'Slow the line slightly and keep packing while you wait for the next result', false, 2),
  (v_q_id, 'Increase the dryer temperature and continue packing as normal', false, 3);

-- Operator responsibilities (open, marker's discretion)
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review)
VALUES (v_course_id, 22, 'List three responsibilities of the pasteuriser operator.', 'short_text', 3, true)
RETURNING id INTO v_q_id;

-- Matching: machine diagram letters → description (5 marks). Needs the annotated
-- photo attached before this is a true image-hotspot; letters kept as text for now.
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 23, 'On the machine diagram, which lettered point is the Pasteuriser temperature (middle probe)?', 'single_choice', 1, true,
  'Attach the annotated machine photo via the course editor, then this can auto-grade. Correct letter: C.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'A', false, 1), (v_q_id, 'B', false, 2), (v_q_id, 'C', true, 3), (v_q_id, 'D', false, 4), (v_q_id, 'E', false, 5);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 24, 'On the machine diagram, which lettered point is the Dryer temperature?', 'single_choice', 1, true,
  'Attach the annotated machine photo via the course editor, then this can auto-grade. Correct letter: A.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'A', true, 1), (v_q_id, 'B', false, 2), (v_q_id, 'C', false, 3), (v_q_id, 'D', false, 4), (v_q_id, 'E', false, 5);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 25, 'On the machine diagram, which lettered point is the current Fan speed for the Dryer?', 'single_choice', 1, true,
  'Attach the annotated machine photo via the course editor, then this can auto-grade. Correct letter: B.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'A', false, 1), (v_q_id, 'B', true, 2), (v_q_id, 'C', false, 3), (v_q_id, 'D', false, 4), (v_q_id, 'E', false, 5);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 26, 'On the machine diagram, which lettered point is where you set the fan speed?', 'single_choice', 1, true,
  'Attach the annotated machine photo via the course editor, then this can auto-grade. Correct letter: E.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'A', false, 1), (v_q_id, 'B', false, 2), (v_q_id, 'C', false, 3), (v_q_id, 'D', false, 4), (v_q_id, 'E', true, 5);

INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 27, 'On the machine diagram, which lettered point is the emergency stop button?', 'single_choice', 1, true,
  'Attach the annotated machine photo via the course editor, then this can auto-grade. Correct letter: D.')
RETURNING id INTO v_q_id;
INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
  (v_q_id, 'A', false, 1), (v_q_id, 'B', false, 2), (v_q_id, 'C', false, 3), (v_q_id, 'D', true, 4), (v_q_id, 'E', false, 5);

-- Bonus question — counted in the memo's "Out of 43" total; marker's discretion
INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, manual_review, explanation)
VALUES (v_course_id, 28, 'Bonus: how do you achieve the best production efficiency on the pasteuriser?', 'short_text', 2, true, 'Marker''s discretion.')
RETURNING id INTO v_q_id;

-- Map to SOP + require practical sign-off
SELECT id INTO v_sop_id FROM production.sops WHERE lower(doc_no) = lower('PROD-WI-003');
IF v_sop_id IS NOT NULL THEN
  INSERT INTO hr.course_sops (course_id, sop_id) VALUES (v_course_id, v_sop_id) ON CONFLICT DO NOTHING;
  UPDATE production.sops SET requires_practical_signoff = true WHERE id = v_sop_id;
END IF;

END $$;
