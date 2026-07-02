-- Remove Shuaib Sentso from the maintenance PIN system.
-- He is the maintenance manager and logs in via Microsoft SSO, not PIN.

UPDATE maintenance.tech_auth
   SET active = false
 WHERE person_name = 'Shuaib Sentso';

UPDATE shared.app_roles
   SET is_active = false
 WHERE full_name = 'Shuaib Sentso'
   AND role = 'maintenance_technician';
