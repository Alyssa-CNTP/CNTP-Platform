-- Customer COA specs: the product_description duplicated the variant
-- (Conventional / Organic / RA / Fairtrade), which already lives in its own
-- `variant` column. Strip those qualifiers so product_description is just the
-- product name. Idempotent — re-running changes nothing once cleaned.

UPDATE qms.coa_specs
SET product_description = btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(product_description, '\y(Organic|Conventional|Fair ?Trade|Fairtrade)\y', '', 'gi'),
          '\yRA\y', '', 'g'),
        '\s{2,}', ' ', 'g')
    , ' -')
WHERE product_description IS NOT NULL
  AND (product_description ~* '\y(Organic|Conventional|Fair ?Trade|Fairtrade)\y'
       OR product_description ~ '\yRA\y');
