ALTER TABLE "events" DROP CONSTRAINT "events_threshold";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_threshold" CHECK ("events"."match_threshold" between 50 and 99);--> statement-breakpoint
-- The door JSON check follows the same 50–99 range.
CREATE OR REPLACE FUNCTION event_door_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x='{"kiosk":false}'::jsonb THEN RETURN true; END IF;
 RETURN coalesce(json_object_keys_ok(x,ARRAY['kiosk','mode','match_threshold'],ARRAY['kiosk','mode','match_threshold']) AND x->'kiosk'='true'::jsonb AND x->>'mode' IN ('supervised','strict') AND json_int_between(x->'match_threshold',50,99),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
