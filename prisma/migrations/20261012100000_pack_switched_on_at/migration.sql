-- Application packs keep the moment they were switched on (#380): another
-- source's copy of a posting gets no pack of its own when its original was
-- stored before that moment. An install that already has packs on never
-- recorded it, so it gets the moment of this upgrade: nothing stored before
-- it is known to have arrived after the switch, and what arrives from now on
-- is. No column changes; one key is added to the settings value.
UPDATE "app_settings"
SET "pack" = "pack" || jsonb_build_object('enabledAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE jsonb_typeof("pack") = 'object'
  AND "pack"->>'enabled' = 'true'
  AND ("pack"->>'enabledAt') IS NULL;
