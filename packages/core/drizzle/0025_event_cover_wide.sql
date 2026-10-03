-- Event covers may carry an optional banner-format image: {"wide":{"version":<uuid>}} beside the main cover.
CREATE OR REPLACE FUNCTION event_cover_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x ? 'privacy' AND NOT coalesce(json_object_keys_ok(x->'privacy',ARRAY['guestList'],ARRAY['guestList']) AND x->'privacy'->>'guestList' IN ('hidden','count','names'),false) THEN RETURN false; END IF;
 IF x ? 'wide' AND NOT coalesce(json_object_keys_ok(x->'wide',ARRAY['version'],ARRAY['version']) AND json_uuid_ok(x->'wide'->'version'),false) THEN RETURN false; END IF;
 x:=x-'privacy'-'wide';
 RETURN coalesce((json_object_keys_ok(x,ARRAY['kind','theme'],ARRAY['kind','theme']) AND x->>'kind'='theme' AND x->>'theme' IN ('aqua','sky')) OR (json_object_keys_ok(x,ARRAY['kind','version','alt'],ARRAY['kind','version','alt']) AND x->>'kind'='asset' AND json_uuid_ok(x->'version') AND json_line_ok(x->'alt',1,200)),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
