-- 0020_departments.sql
--
-- Turn the doctor department list from a fixed enum baked into app code
-- (lib/doctors/schema.ts) into a DB-backed master list, so the hospital can add
-- or remove one itself - no code change/deploy for a name that used to mean a
-- truck roll.
--
-- No `active` toggle and no soft-delete here, unlike services/doctors: a
-- department has no FK pointing at it - doctors.department is (and stays) plain
-- denormalized TEXT (migration 0016), so removing a department row can never
-- orphan anything or change what an existing doctor's row reads back. A plain
-- DELETE is enough (logged via audit_log, never silent), and it keeps "remove
-- then re-add the same name" free of a leftover-row unique conflict.
--
-- Seeded with the same 49 names the enum used to hardcode, per existing
-- location, so every current doctor's department is already in the list.
-- Forward-only.

CREATE TABLE departments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT      NOT NULL REFERENCES locations(id),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, name)
);

INSERT INTO departments (location_id, name)
SELECT l.id, d.name
  FROM locations l
 CROSS JOIN (VALUES
    ('General Physician'), ('General Surgeon'), ('Cardiologist'),
    ('Cardiothoracic Surgeon (CTVS)'), ('Orthopedician'), ('Pediatrician'),
    ('Neonatologist'), ('Gynecologist'), ('Obstetrician'), ('ENT Specialist'),
    ('Dermatologist (Skin Specialist)'), ('Cosmetologist'), ('Neurologist'),
    ('Neurosurgeon'), ('Psychiatrist'), ('Psychologist'),
    ('Ophthalmologist (Eye Specialist)'), ('Dentist'),
    ('Oral & Maxillofacial Surgeon'), ('Urologist'), ('Nephrologist'),
    ('Radiologist'), ('Anesthetist'), ('Gastroenterologist'),
    ('Endocrinologist'), ('Pulmonologist'), ('Rheumatologist'),
    ('Oncologist'), ('Hematologist'), ('Plastic Surgeon'),
    ('Vascular Surgeon'), ('Emergency Medicine Specialist'),
    ('Intensivist (Critical Care)'), ('Physiotherapist'),
    ('Dietitian / Nutritionist'), ('Pathologist'), ('Microbiologist'),
    ('Family Physician'), ('Geriatrician'), ('Sports Medicine Specialist'),
    ('Pain Management Specialist'), ('Diabetologist'), ('Andrologist'),
    ('Infectious Disease Specialist'), ('Allergist / Immunologist'),
    ('Homeopath'), ('Ayurvedic Doctor'), ('Physiatrist (Rehabilitation)'),
    ('Other')
 ) AS d(name);
