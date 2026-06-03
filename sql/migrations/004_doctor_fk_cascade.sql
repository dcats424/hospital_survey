ALTER TABLE visit_doctors DROP CONSTRAINT IF EXISTS visit_doctors_doctor_id_fkey,
  ADD CONSTRAINT visit_doctors_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE;

ALTER TABLE encounter_doctors DROP CONSTRAINT IF EXISTS encounter_doctors_doctor_id_fkey,
  ADD CONSTRAINT encounter_doctors_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE;

ALTER TABLE token_doctors DROP CONSTRAINT IF EXISTS token_doctors_doctor_id_fkey,
  ADD CONSTRAINT token_doctors_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE;

ALTER TABLE feedback_ratings DROP CONSTRAINT IF EXISTS feedback_ratings_doctor_id_fkey,
  ADD CONSTRAINT feedback_ratings_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE;
