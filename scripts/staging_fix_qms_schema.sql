-- =============================================================================
-- Drop and recreate qms tables cleanly + fix all grants
-- Run in: Staging Supabase SQL Editor
-- =============================================================================

-- Drop all qms tables so we can recreate with correct column types
DROP TABLE IF EXISTS qms.quality_records CASCADE;
DROP TABLE IF EXISTS qms.sd_runs CASCADE;
DROP TABLE IF EXISTS qms.sieving_spec_overrides CASCADE;
DROP TABLE IF EXISTS qms.granule_runs CASCADE;
DROP TABLE IF EXISTS qms.granule_samples CASCADE;
DROP TABLE IF EXISTS qms.granule_tastings CASCADE;
DROP TABLE IF EXISTS qms.granule_specs CASCADE;
DROP TABLE IF EXISTS qms.granule_corrections CASCADE;
DROP TABLE IF EXISTS qms.lab_results CASCADE;
DROP TABLE IF EXISTS qms.customer_specs CASCADE;
DROP TABLE IF EXISTS qms.sd_specs CASCADE;
DROP TABLE IF EXISTS qms.raw_material__pa_ta_alkaloids CASCADE;
DROP TABLE IF EXISTS qms.raw_material__residue_pesticides CASCADE;
DROP TABLE IF EXISTS qms.raw_material__glyphosate CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__pyrrolizidine_alkaloids CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__residue_pesticides CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__microbiology CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__heavy_metals CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__glyphosate CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__mosh_moah CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__aflatoxins CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser__ethylene_oxide CASCADE;
DROP TABLE IF EXISTS qms.pasteuriser_records CASCADE;
DROP TABLE IF EXISTS qms.management_announcements CASCADE;
DROP TABLE IF EXISTS qms.announcement_comments CASCADE;
DROP TABLE IF EXISTS qms.announcement_reads CASCADE;
DROP TABLE IF EXISTS qms.users CASCADE;
DROP TABLE IF EXISTS qms.notes CASCADE;
DROP TABLE IF EXISTS qms.eu_mrls CASCADE;
DROP TABLE IF EXISTS qms.timesheet_events CASCADE;
DROP TABLE IF EXISTS qms.sieving_sessions CASCADE;
DROP TABLE IF EXISTS qms.sieving_samples CASCADE;
DROP TABLE IF EXISTS qms.sieving_corrections CASCADE;
DROP TABLE IF EXISTS qms.past_sensorial_sessions CASCADE;
DROP TABLE IF EXISTS qms.past_sensorial_samples CASCADE;
DROP TABLE IF EXISTS qms.leaf_shade_predictions CASCADE;

-- Recreate all tables with correct types

CREATE TABLE qms.quality_records (
    id            serial PRIMARY KEY,
    workcenter    text, workflow text, batch_number text,
    data_json     text, file_name text, file_path text,
    comment       text, uploaded_by text,
    created_at    timestamptz DEFAULT now()
);

CREATE TABLE qms.sd_runs (
    id             serial PRIMARY KEY,
    product text, date text, lot_number text, serial_number text,
    grade text, variant text, run_type text, qc_name text,
    time_of_run text, needle_count text, leaf_shade text,
    bulk_density text, comment text, pa_level text, pass_status text,
    violations     jsonb DEFAULT '[]',
    gram_values    jsonb DEFAULT '{}',
    sieve_results  jsonb DEFAULT '{}',
    run_timestamp  timestamptz,
    edit_history   jsonb DEFAULT '[]',
    created_by text,
    created_at     timestamptz DEFAULT now()
);

CREATE TABLE qms.sieving_spec_overrides (
    id serial PRIMARY KEY,
    product_type text, variant text, market text, sieve_key text,
    min_val numeric, max_val numeric, updated_by text,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.granule_runs (
    id serial PRIMARY KEY,
    batch_number text, qc_name text, production_date text,
    type_grade text, is_cntp boolean,
    spec_json jsonb DEFAULT '{}',
    overall_status text, created_by text, customer text,
    final_status text, reference_used text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.granule_samples (
    id serial PRIMARY KEY,
    session_id integer, run_id integer,
    time_taken text, sample_time text,
    dryer_no text, dryer_number text,
    bag_serial text, bulk_bag_serial text, bag_type text,
    cut_length numeric,
    sieve_gt6_g numeric, sieve_gt6_pct numeric,
    sieve_gt10_g numeric, sieve_gt10_pct numeric,
    sieve_gt12_g numeric, sieve_gt12_pct numeric,
    sieve_gt16_g numeric, sieve_gt16_pct numeric,
    sieve_gt20_g numeric, sieve_gt20_pct numeric,
    sieve_gt40_g numeric, sieve_gt40_pct numeric,
    dust_g numeric, dust_pct numeric,
    moisture numeric, untapped numeric, tapped numeric, bulk_density numeric,
    final_product_wt text, compares_to_ref text, dryer_temp numeric,
    spec_violations jsonb DEFAULT '[]',
    violations jsonb DEFAULT '[]',
    sieve_g jsonb DEFAULT '{}',
    sieve_pct jsonb DEFAULT '{}',
    aroma integer, flavour_profile integer, briskness integer,
    strength integer, cup_colour integer,
    pass_reject text, sensorial_note text, qc_comment text,
    sieving_done boolean, final_weight_ok boolean,
    recheck_done boolean, recheck_moisture numeric,
    recheck_dryer_temp numeric, recheck_time text, recheck_pass boolean,
    sample_date text,
    weight_1 numeric, weight_2 numeric, weight_3 numeric,
    dryer2_running boolean, dryer2_moisture numeric,
    dryer2_bulk_density numeric, dryer2_dryer_temp numeric,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.granule_tastings (
    id serial PRIMARY KEY,
    run_id integer, sample_id integer,
    assessed_by text, tasting_time text,
    aroma integer, taste integer, texture integer,
    sweetness integer, colour integer, overall integer,
    granule_aroma integer, flavour_profile integer,
    briskness integer, strength integer, cup_colour integer,
    notes text, pass_reject text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.granule_specs (
    id serial PRIMARY KEY,
    type_grade text, customer text,
    moisture_max numeric, bd_min numeric, bd_max numeric,
    sieve_specs jsonb DEFAULT '{}',
    notes text, created_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.granule_corrections (
    id serial PRIMARY KEY,
    field text, wrong_value text, correct_value text,
    context_hint text, created_by text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.lab_results (
    id serial PRIMARY KEY,
    batch_no text, test_type text, lab_name text,
    order_no text, date_issued text, date_received text,
    results jsonb DEFAULT '{}',
    overall_status text, regulation text, pdf_path text,
    comment text, created_by text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.customer_specs (
    id serial PRIMARY KEY,
    product_family text, grade text, variant text, sieve_type text, customer text,
    gt6_min numeric, gt6_max numeric,
    gt8_min numeric, gt8_max numeric,
    gt10_min numeric, gt10_max numeric,
    gt12_min numeric, gt12_max numeric,
    gt16_min numeric, gt16_max numeric,
    gt18_min numeric, gt18_max numeric,
    gt20_min numeric, gt20_max numeric,
    gt40_min numeric, gt40_max numeric,
    gt60_min numeric, gt60_max numeric,
    dust_min numeric, dust_max numeric,
    moisture_max numeric,
    bulk_density_min numeric, bulk_density_max numeric, bd_target numeric,
    micro_tma text, micro_ecoli text, micro_salmonella text,
    micro_listeria text, micro_yeast_mould text,
    pesticide_reg text, notes text,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.sd_specs (
    id serial PRIMARY KEY,
    specs jsonb DEFAULT '{}',
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.raw_material__pa_ta_alkaloids (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_name text, sample_date text,
    total_pa_ug_kg text, total_pa_mg_kg text,
    pa_status text, p_level text,
    total_ta_ug_kg text, ta_status text,
    overall_status text, comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.raw_material__residue_pesticides (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, sample_date text,
    overall_status text, overall_r_grade text,
    total_detections text, total_exceedances text,
    compounds_detected jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.raw_material__glyphosate (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, sample_date text, issue_date text,
    overall_status text,
    compounds_detected jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__pyrrolizidine_alkaloids (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, date_issued text, date_received text,
    total_pa_eu_ug_kg text, total_pa_bfr28_ug_kg text,
    scopolamine_total_ug_kg text, total_ta_ug_kg text,
    overall_status text, comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__residue_pesticides (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, sample_date text,
    overall_status text, total_detections text, total_exceedances text,
    compounds_detected jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__microbiology (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, lab_no text, order_no text,
    date_received text, date_issued text,
    tpc_cfu_g text, ecoli_cfu_g text, mould_cfu_g text,
    yeast_cfu_g text, staph_aureus_cfu_g text,
    salmonella_25g text, listeria text,
    overall_status text, comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__heavy_metals (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, date_issued text,
    overall_status text,
    analytes jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__glyphosate (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, sample_date text, date_issued text,
    overall_status text,
    compounds_detected jsonb DEFAULT '[]',
    analytes jsonb,
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__mosh_moah (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, date_issued text,
    overall_status text,
    analytes jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__aflatoxins (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, date_issued text,
    overall_status text,
    analytes jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser__ethylene_oxide (
    id serial PRIMARY KEY,
    batch_no text, file_name text, uploaded_by text,
    lab text, report_reference text, date_issued text,
    overall_status text,
    analytes jsonb DEFAULT '[]',
    comment text,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE qms.pasteuriser_records (
    id serial PRIMARY KEY,
    batch_no text, production_date text, customer text,
    final_product text, variant text, packaging_type text,
    qc_name text, time text, recheck boolean,
    compares_to_ref text, moisture_pct numeric,
    bd_lower numeric, bd_upper numeric, bd_target numeric,
    bd_result numeric, customer_bulk_density numeric,
    hourly_temp jsonb DEFAULT '[]',
    mass_flow_rate numeric, angle_of_repose numeric,
    sieve jsonb DEFAULT '{}',
    aroma integer, flavour_profile integer,
    briskness_of_taste integer, strength_of_taste integer,
    cup_colour integer, cup_clarity integer,
    pass_fail text,
    hourly_samples jsonb DEFAULT '[]',
    pdf_path text, created_by text,
    batch_specs jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.management_announcements (
    id serial PRIMARY KEY,
    title text, body text,
    from_user_id integer, from_name text,
    target_departments jsonb DEFAULT '[]',
    pinned boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.announcement_comments (
    id serial PRIMARY KEY,
    announcement_id integer, user_id integer,
    user_name text, department text, body text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.announcement_reads (
    id serial PRIMARY KEY,
    announcement_id integer, user_id integer,
    read_at timestamptz DEFAULT now()
);

CREATE TABLE qms.users (
    id serial PRIMARY KEY,
    username text, password text, role text, email text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.notes (
    id serial PRIMARY KEY,
    user_id integer, title text, body text,
    pinned boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE qms.eu_mrls (
    id serial PRIMARY KEY,
    product_code text, product_name text, commodity text,
    pesticide_name text, mrl_mg_kg numeric,
    is_default boolean, is_lod boolean,
    annex text, regulation text, notes text,
    synced_at timestamptz
);

CREATE TABLE qms.timesheet_events (
    id serial PRIMARY KEY,
    user_id integer, section_id text,
    date text, shift text, type text,
    time text, iso text, note text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.sieving_sessions (
    id serial PRIMARY KEY,
    lot_number text, serial_number text,
    product_type text, material_type text, date text,
    quality_controller text, customer text,
    export_local text, pass_fail text, comments text,
    created_by text, spec_variant text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.sieving_samples (
    id serial PRIMARY KEY,
    session_id integer, time_taken text, bag_bin_number text,
    cut_length numeric,
    sieve_gt6_g numeric, sieve_gt6_pct numeric,
    sieve_gt10_g numeric, sieve_gt10_pct numeric,
    sieve_gt12_g numeric, sieve_gt12_pct numeric,
    sieve_gt16_g numeric, sieve_gt16_pct numeric,
    sieve_gt18_g numeric, sieve_gt18_pct numeric,
    sieve_gt20_g numeric, sieve_gt20_pct numeric,
    sieve_gt40_g numeric, sieve_gt40_pct numeric,
    sieve_gt60_g numeric, sieve_gt60_pct numeric,
    dust_g numeric, dust_pct numeric,
    fine_leaf_g numeric, fine_leaf_pct numeric,
    needle_count integer, moisture numeric,
    untapped_cc_per_100g numeric, customer_bulk_density numeric,
    final_product_weight text, compares_to_ref text,
    hourly_temp jsonb DEFAULT '[]',
    spec_violations jsonb DEFAULT '[]',
    rooibos_aroma integer, flavour_profile integer,
    briskness integer, strength integer,
    cup_colour integer, cup_clarity integer,
    pass_reject text, leaf_shade integer,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.sieving_corrections (
    id serial PRIMARY KEY,
    product_type text, field text,
    wrong_value text, correct_value text,
    context_hint text, created_by text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.past_sensorial_sessions (
    id serial PRIMARY KEY,
    batch_number text, type_grade text, date text,
    assessed_by text, created_by text, customer text,
    production_date text, qc_name text, packaging_type text,
    bd_spec_lower numeric, bd_spec_upper numeric, bd_spec_target numeric,
    bd_result numeric, customer_bd numeric,
    mass_flow_rate numeric, angle_of_repose numeric,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.past_sensorial_samples (
    id serial PRIMARY KEY,
    session_id integer, sample_id text,
    moisture_pct numeric, volumetrics_cc numeric,
    rooibos_aroma integer, flavour_profile integer,
    briskness integer, strength integer,
    cup_colour integer, cup_clarity integer,
    comments text, pass_reject text,
    hourly_temp jsonb DEFAULT '[]',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE qms.leaf_shade_predictions (
    id serial PRIMARY KEY,
    "timestamp" timestamptz, location text,
    lot_number text, filename text, file_hash text,
    leaf_shade integer, confidence_pct numeric,
    top5_predictions jsonb, actual_leaf_shade integer,
    camera_compliant boolean, compliance_issues jsonb,
    actual_focallength text, actual_iso text,
    actual_exposuretime text, actual_whitebalance text,
    actual_picturestyle text,
    "Rn255" numeric, "Gn255" numeric, "Bn255" numeric,
    "R_mean" numeric, "G_mean" numeric, "B_mean" numeric,
    "R_std" numeric, "G_std" numeric, "B_std" numeric,
    "HSV_H_mean" numeric, "HSV_S_mean" numeric, "HSV_V_mean" numeric,
    "Lab_L_mean" numeric, "Lab_a_mean" numeric, "Lab_b_mean" numeric,
    "Lab_a_std" numeric, "Lab_b_std" numeric, "Lab_Chroma_mean" numeric,
    "R_p10" numeric, "R_p50" numeric, "R_p90" numeric,
    "G_p10" numeric, "G_p50" numeric, "G_p90" numeric,
    "B_p10" numeric, "B_p50" numeric, "B_p90" numeric,
    "Colorfulness" numeric, "Contrast" numeric, "Color_Temp" numeric
);

-- Grant all permissions including sequences
GRANT USAGE ON SCHEMA qms TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qms TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA qms TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA qms TO authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA axis TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA workspace TO authenticated, service_role;
