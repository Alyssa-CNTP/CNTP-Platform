-- =============================================================================
-- Workspace + Axis Schema Migration
-- Generated: 2026-06-10
-- Source: Production Supabase (sxzjjcyuzyfneesnsjna)
-- Target: Staging Supabase — workspace + axis schemas
-- =============================================================================

-- ---------------------------------------------------------------------------
-- WORKSPACE SCHEMA
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS workspace;

CREATE TABLE IF NOT EXISTS workspace.items (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       uuid,
    zone          text,
    title         text,
    project_label text,
    contact_name  text,
    notes         text,
    priority      text DEFAULT 'medium',
    completed     boolean DEFAULT false,
    sort_order    integer DEFAULT 0,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace.pulse_notes (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       uuid,
    project_label text,
    content       text,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- AXIS SCHEMA
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS axis;

CREATE TABLE IF NOT EXISTS axis.project_requests (
    id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    title                text,
    description          text,
    business_justification text,
    urgency              text,
    requesting_dept      text,
    submitted_by         uuid,
    status               text DEFAULT 'pending',
    rejection_reason     text,
    reviewed_by          uuid,
    reviewed_at          timestamptz,
    created_at           timestamptz DEFAULT now(),
    updated_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.projects (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    request_id      uuid,
    name            text,
    description     text,
    priority        text,
    term            text,
    effort_size     text,
    target_start    text,
    target_end      text,
    hard_deadline   boolean DEFAULT false,
    deadline_reason text,
    lead_dev_id     uuid,
    status          text DEFAULT 'active',
    approved_by     uuid,
    approved_at     timestamptz,
    completed_at    timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.project_tracks (
    id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id        uuid,
    track_type        text,
    custom_label      text,
    progress_pct      integer DEFAULT 0,
    current_milestone text,
    updated_by        uuid,
    updated_at        timestamptz DEFAULT now(),
    created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.project_assignees (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid,
    user_id    uuid,
    role       text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.track_events (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    track_id      uuid,
    title         text,
    description   text,
    event_type    text,
    created_by    uuid,
    created_at    timestamptz DEFAULT now(),
    edit_deadline timestamptz,
    is_locked     boolean DEFAULT false,
    locked_at     timestamptz
);

CREATE TABLE IF NOT EXISTS axis.tickets (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_number   text,
    title           text,
    description     text,
    status          text DEFAULT 'open',
    priority        text,
    category        text,
    submitted_by    uuid,
    assigned_to     uuid,
    department      text,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS axis.ticket_comments (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id  uuid,
    author_id  uuid,
    body       text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.notifications (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    recipient_id    uuid,
    type            text,
    title           text,
    body            text,
    reference_id    uuid,
    reference_table text,
    is_read         boolean DEFAULT false,
    created_at      timestamptz DEFAULT now(),
    read_at         timestamptz
);

CREATE TABLE IF NOT EXISTS axis.change_logs (
    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id       uuid,
    sector           text,
    change_type      text,
    description      text,
    reason           text,
    risk_level       text,
    author_id        uuid,
    reviewer_id      uuid,
    review_status    text DEFAULT 'not_required',
    reviewed_at      timestamptz,
    source           text,
    metadata         jsonb DEFAULT '{}',
    created_at       timestamptz DEFAULT now(),
    edit_deadline    timestamptz,
    is_locked        boolean DEFAULT false,
    locked_at        timestamptz,
    environment      text,
    affected_systems text,
    sub_folder       text
);

CREATE TABLE IF NOT EXISTS axis.change_log_updates (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    log_id     uuid,
    note       text,
    author_id  uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.change_log_edits (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    log_id     uuid,
    author_id  uuid,
    before     jsonb,
    after      jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.comments (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reference_id uuid,
    table_name   text,
    author_id    uuid,
    body         text,
    created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.github_events (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type text,
    payload    jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.system_documents (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    title      text,
    body       text,
    category   text,
    author_id  uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axis.audit_log (
    id           serial PRIMARY KEY,
    actor_id     uuid,
    action       text,
    schema_name  text,
    table_name   text,
    record_id    uuid,
    before_state jsonb,
    after_state  jsonb,
    ip_address   text,
    user_agent   text,
    created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA workspace TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workspace TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA workspace TO anon;

GRANT USAGE ON SCHEMA axis TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA axis TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA axis TO anon;
