-- Replaces the single `pan_number` column with two parallel CSV columns that
-- can hold multiple ID proofs per customer (a customer may have aadhar + PAN
-- + DL etc. — pulled from old-CRM cust_addr_tbl, deduped on (type, number)).
--
--   id_proof_types    — comma-separated list of proof types  ("aadhar, pan card")
--   id_proof_numbers  — comma-separated list of the matching numbers, same order
--
-- We leave the legacy `pan_number` column in place (it never got populated
-- after the design changed). Drop it later via a follow-up migration once the
-- UI and exports are off it.
--
-- Run once. Safe to re-run.

alter table purchases add column if not exists id_proof_types   text;
alter table purchases add column if not exists id_proof_numbers text;
