-- Carried-by phone for self-carry hub moves (ROK / AP / TS).
-- The create-consignment popup asks for the carrying employee's name + phone
-- (name already lands in transporter_name as "BRANCH EMPLOYEE - <name>").
-- The API writes this column in its own fire-and-forget update, so creation
-- keeps working before this runs — the phone just isn't stored until then.
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS carrier_phone TEXT;
