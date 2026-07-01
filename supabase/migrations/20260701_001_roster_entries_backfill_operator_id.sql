-- Back-fill operator_id on roster_entries rows that were saved before the
-- fix that started carrying operator_id through the roster page.
-- Joins via employee_id → employees.operator_id.

UPDATE production.roster_entries re
SET    operator_id = e.operator_id
FROM   production.employees e
WHERE  re.employee_id = e.id
  AND  re.operator_id IS NULL
  AND  e.operator_id  IS NOT NULL;
