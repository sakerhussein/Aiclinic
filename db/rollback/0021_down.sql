-- Undo 0021_insurance.sql. Roll the code back first (Records and Booking read these columns).
-- The patient's typed insurance text stays in patient_details.insurance; the company chosen from the list is lost, so its name is
-- copied into that text first.
update patient_details d set insurance = coalesce(d.insurance, c.name_en)
  from insurance_companies c where c.id = d.insurance_company_id;

drop policy if exists booking_app_read on record_settings;
drop policy if exists booking_app_read on patient_details;
revoke select (clinic_id, insurance_in_booking) on record_settings from booking_app;
revoke select (patient_id, clinic_id, insurance_status, insurance_company_id, insurance) on patient_details from booking_app;

alter table record_settings drop column if exists insurance_in_booking, drop column if exists insurance_required;
alter table patient_details drop constraint if exists patient_details_insurance_answer;
alter table patient_details drop constraint if exists patient_details_insurance_company;
alter table patient_details drop column if exists insurance_company_id, drop column if exists insurance_status;

drop table if exists insurance_companies;
drop function if exists public.insurance_companies_version();
