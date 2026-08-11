-- ============================================================
-- Supervisor Hub — Managing Shifts & Reports: training course + assessment
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260710_001_hr_training.sql (hr.* training tables) and
--             20260722_004_lesson_embed_url.sql (hr.training_lessons.embed_url)
--
-- Standalone course — no SOP mapping (this is software/process competency,
-- not a floor-machine SOP like Sieving Tower, so there's nothing sensible to
-- attach it to in the SOP catalogue). Pass the assessment -> straight to
-- 'competent' on this course; no practical sign-off step.
--
-- Built from a live read of the current Supervisor Hub (6 tabs: Dashboard,
-- Roster, Sign-off, Shift Report, Team, Messages) — see components/supervisor/
-- HubTabs.tsx and each tab's page.tsx.
--
-- Idempotent: skips the content seed if the course already exists.
-- ============================================================

DO $$
DECLARE
  v_course uuid;
  q        uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM hr.training_courses WHERE lower(slug) = 'supervisor-hub-operations') THEN
    RAISE NOTICE 'Course supervisor-hub-operations already exists — skipping content seed.';
    RETURN;
  END IF;

  INSERT INTO hr.training_courses (slug, title, description, area, status, pass_threshold, sort_order)
  VALUES (
    'supervisor-hub-operations',
    'Supervisor Hub — Managing Shifts & Reports',
    'How to use the Supervisor Hub: reading the Dashboard, assigning sections and staffing on Roster, clearing the Sign-off queue, the generated Shift Report, Team ratings and timesheets, and line Messages. Watch the walkthrough, then take the assessment.',
    'production', 'active', 0.75, 50
  ) RETURNING id INTO v_course;

  -- ── Lesson: the screen-recorded walkthrough (Scribe) ──────────────────────
  INSERT INTO hr.training_lessons (course_id, title, embed_url, body, sort_order, required)
  VALUES (
    v_course,
    'Supervisor Hub — full walkthrough',
    'https://scribehow.com/embed/Managing_Supervisor_Hub_Tasks_and_Shift_Reports__OpDp6thPQpSVuj9Y_LqJCw?as=video',
    'Watch the full walkthrough of the Supervisor Hub: the Dashboard, assigning sections and editing staffing on Roster, working the Sign-off queue, the Shift Report, Team ratings/timesheets, and Messages. Take your time — you can rewatch before the assessment.',
    0, true
  );

  -- ── Assessment ─────────────────────────────────────────────────────────────

  -- A. The hub itself
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 1, 'What are the six tabs in the Supervisor Hub, in order?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Dashboard, Roster, Sign-off, Shift Report, Team, Messages', true, 0),
    (q, 'Dashboard, Roster, Timesheets, Productions, Analytics, Calendar', false, 1),
    (q, 'Overview, Roster, Sign-off, Report, Ratings, Chat', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 2, 'What can you do directly on the Dashboard tab itself?', 'single_choice', 1, 'The Dashboard is a pure summary — every tile and list is a link out to the tab that actually owns that action (Roster, Sign-off, Team, etc.).') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Nothing — it only summarises and links out to the tab that owns each action', true, 0),
    (q, 'Edit the roster', false, 1),
    (q, 'Sign off a capture record', false, 2);

  -- B. Roster
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 3, 'Which Roster sub-view do you use to assign operators, variant, lot number and production order to a section for today''s shift?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Today''s sections', true, 0),
    (q, 'Staffing', false, 1),
    (q, 'Team', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 4, 'When you assign a section on "Today''s sections", when does it take effect?', 'single_choice', 1, 'It saves live the moment you set it — this is what unlocks capture for that section, so there is no separate submit step.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Immediately — it saves live, there is no separate submit step', true, 0),
    (q, 'Only after you click "Confirm roster"', false, 1),
    (q, 'Only after the Production Manager approves it', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 5, 'On the Staffing sub-view, what happens if you edit a roster that has already been confirmed/submitted?', 'single_choice', 1, 'It does NOT reset to draft — that would erase the sign-off. It moves to "changes_pending" and every add/remove/move is logged in the change history.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'It moves to "changes_pending" and logs the change — it does not reset to draft', true, 0),
    (q, 'It resets straight back to draft', false, 1),
    (q, 'The edit is blocked until someone un-confirms it first', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 6, 'After you Save changes on Staffing, who confirms the roster to the Production Manager?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'A supervisor with roster sign-off rights — if you don''t have that permission, saving already sends it through for the Production Manager to confirm', true, 0),
    (q, 'Every supervisor must individually confirm it', false, 1),
    (q, 'It confirms itself automatically at midnight', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 7, 'If no roster period covers today when you open Staffing, what happens?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'It auto pre-fills from the most recent period with day/night swapped, flagged with a banner — you adjust and Save to confirm', true, 0),
    (q, 'The grid is blank and you must add everyone from scratch', false, 1),
    (q, 'Capture is locked for every section until someone creates a period', false, 2);

  -- C. Sign-off
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 8, 'What shows up in the Sign-off queue? (Select all that apply.)', 'multi_choice', 2) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Capture records submitted and waiting for your signature', true, 0),
    (q, 'Draft records still open from a shift that has already ended', true, 1),
    (q, 'Shift reports awaiting send or sign (if that''s your permission)', true, 2),
    (q, 'Line messages you haven''t replied to', false, 3);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 9, 'What does Sign-off show once everything has been actioned?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, '"All caught up — Nothing is waiting for your signature."', true, 0),
    (q, 'A blank, empty page with no message', false, 1),
    (q, 'It hides the tab entirely', false, 2);

  -- D. Shift Report
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 10, 'On the Shift Report, what is the ONLY field a supervisor types by hand?', 'short_text', 1, 'Everything else — attendance, lines run, outputs, throughput, machine settings, breakdowns, checks, waste — is generated from capture, mass balance, bagging, timesheets, checks and maintenance data.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Supervisor notes', true, 0),
    (q, 'supervisor notes', true, 1);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 11, 'What is the Shift Report''s status lifecycle, in order?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Draft → Submitted → Approved', true, 0),
    (q, 'Submitted → Draft → Approved', false, 1),
    (q, 'Draft → Approved → Submitted', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 12, 'Can an approved Shift Report ever be corrected?', 'true_false', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Yes — an approver can "Reopen for corrections"', true, 0),
    (q, 'No — once approved it is permanently locked', false, 1);

  -- E. Team
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 13, 'The Team tab has two sub-views — what are they?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Ratings and Timesheets', true, 0),
    (q, 'Roster and Messages', false, 1),
    (q, 'Sign-off and Shift Report', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points, explanation)
  VALUES (v_course, 14, 'On Team → Ratings, why are Performance and Accuracy kept as two separate 1–5 scores instead of one averaged score?', 'single_choice', 1, 'They fail independently — averaging would hide which half is actually the problem. A read-only system-computed accuracy figure sits alongside the human score, never overriding it.') RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'So they can fail independently — averaging would hide which one is the problem', true, 0),
    (q, 'Because the system requires exactly two numbers', false, 1),
    (q, 'It is just a display preference with no real reason', false, 2);

  -- F. Messages
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 15, 'How are the Messages channels organised?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, '"All lines", plus one channel per production section', true, 0),
    (q, 'One channel per individual operator', false, 1),
    (q, 'A single company-wide channel', false, 2);

  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 16, 'Does sending a message on the Messages tab need manager approval before the team sees it?', 'true_false', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'No — it is purely operational chat, there is no approval workflow', true, 0),
    (q, 'Yes — a manager must approve every message first', false, 1);

  -- G. Practical judgement
  INSERT INTO hr.training_questions (course_id, sort_order, prompt, kind, points)
  VALUES (v_course, 17, 'A capture record is still sitting in Draft from a shift that ended hours ago. Where would this be flagged for you to action?', 'single_choice', 1) RETURNING id INTO q;
  INSERT INTO hr.training_question_options (question_id, label, is_correct, sort_order) VALUES
    (q, 'Sign-off — under "Records still open from a finished shift"', true, 0),
    (q, 'It only shows on the Dashboard, nowhere else', false, 1),
    (q, 'Nowhere — the system does not track this', false, 2);

  RAISE NOTICE 'Seeded course supervisor-hub-operations (%) with 17 questions, no SOP mapping.', v_course;
END $$;
