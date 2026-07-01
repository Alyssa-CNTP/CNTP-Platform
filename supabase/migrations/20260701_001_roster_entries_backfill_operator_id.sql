-- Back-fill operator_id on roster_entries.
-- First try the clean path: employee_id → employees.operator_id.
-- Then fall back to name matching against operators where that link is missing.

-- Pass 1: employee link
UPDATE production.roster_entries re
SET    operator_id = e.operator_id
FROM   production.employees e
WHERE  re.employee_id = e.id
  AND  re.operator_id IS NULL
  AND  e.operator_id  IS NOT NULL;

-- Pass 2: name match (handles entries whose employees.operator_id is null)
UPDATE production.roster_entries re
SET    operator_id = o.id
FROM   production.operators o
WHERE  LOWER(TRIM(re.person_name)) = LOWER(TRIM(o.name))
  AND  re.operator_id IS NULL
  AND  o.active = true;
