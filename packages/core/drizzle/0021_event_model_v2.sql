-- Generated delta from 0020_api_tokens; ordered with v2 validators, populated-data backfills and triggers.
-- Coordinated cutover: 0018 calendar and 0019 account sessions are prerequisites.
DO $$ BEGIN
  IF to_regclass('calendar_profiles') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='csrf_token') OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='rotated_at') OR (SELECT count(*) FROM information_schema.columns WHERE table_name='events' AND column_name IN ('place_id','lat','lng','maps_url'))<>4 THEN RAISE EXCEPTION 'event_model_v2_missing_prerequisites'; END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "event_assets" (
	"event_id" uuid NOT NULL,
	"kind" text DEFAULT 'cover' NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_assets_event_id_version_pk" PRIMARY KEY("event_id","version"),
	CONSTRAINT "event_assets_kind" CHECK ("event_assets"."kind"='cover'),
	CONSTRAINT "event_assets_type" CHECK ("event_assets"."content_type" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "event_assets_size" CHECK (octet_length("event_assets"."bytes") between 1 and 2097152),
	CONSTRAINT "event_assets_dimensions" CHECK ("event_assets"."width" between 1 and 4096 and "event_assets"."height" between 1 and 4096 and "event_assets"."width"::bigint*"event_assets"."height"::bigint<=12000000),
	CONSTRAINT "event_assets_hash" CHECK ("event_assets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "edit_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "event_assets" ADD CONSTRAINT "event_assets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION event_assets_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event_assets_immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER event_assets_immutable BEFORE UPDATE ON event_assets FOR EACH ROW EXECUTE FUNCTION event_assets_immutable();
--> statement-breakpoint
CREATE FUNCTION json_object_keys_ok(x jsonb, allowed text[], required text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'object' THEN RETURN false; END IF;
 RETURN x-allowed='{}'::jsonb AND x ?& required;
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_int_between(x jsonb, lo numeric, hi numeric) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'number' THEN RETURN false; END IF;
 RETURN (x::text)::numeric BETWEEN lo AND hi AND mod((x::text)::numeric,1)=0;
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_line_ok(x jsonb, lo integer, hi integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE s text; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'string' THEN RETURN false; END IF; s:=x#>>'{}';
 RETURN char_length(s) BETWEEN lo AND hi AND s=btrim(s) AND s !~ '[\x01-\x1f\x7f]';
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_prose_ok(x jsonb, hi integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 RETURN coalesce(jsonb_typeof(x)='string' AND char_length(x#>>'{}')<=hi AND (x#>>'{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]',false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_https_url_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE s text; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'string' THEN RETURN false; END IF; s:=x#>>'{}';
 RETURN char_length(s)<=2048 AND s ~ '^https://[^/@[:space:]?#]+' AND s !~ '^https://[^/?#]*@' AND s !~ '[[:space:]\x01-\x1f\x7f\\]';
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_uuid_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 RETURN coalesce(jsonb_typeof(x)='string' AND (x#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_instant_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE d timestamptz; s text; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'string' THEN RETURN false; END IF; s:=x#>>'{}';
 IF s !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RETURN false; END IF; d:=s::timestamptz; RETURN isfinite(d);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_date_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE d date; s text; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'string' THEN RETURN false; END IF; s:=x#>>'{}';
 IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF; d:=s::date; RETURN to_char(d,'YYYY-MM-DD')=s;
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION json_string_set_ok(x jsonb, allowed text[], max_count integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE v jsonb; seen text[]:='{}'; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'array' OR jsonb_array_length(x)>max_count THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(x) LOOP
  IF jsonb_typeof(v)<>'string' OR NOT ((v#>>'{}')=ANY(allowed)) OR (v#>>'{}')=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,v#>>'{}');
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION proof_checks_v2_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE ordered jsonb; BEGIN
 IF NOT json_string_set_ok(x,ARRAY['face','phone','id_document','name_from_id','age'],5) THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY array_position(ARRAY['face','phone','id_document','name_from_id','age'],v#>>'{}')),'[]') INTO ordered FROM jsonb_array_elements(x) v;
 RETURN x=ordered; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION event_checks_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE k text; v jsonb; ordered jsonb; BEGIN
 IF NOT json_object_keys_ok(x,ARRAY['version','required','max_age','age_min'],ARRAY['version','required','max_age']) OR x->'version'<>'1'::jsonb OR NOT json_string_set_ok(x->'required',ARRAY['phone','id_document','name_from_id'],3) OR NOT json_object_keys_ok(x->'max_age',ARRAY['phone','document','name_from_id','age'],'{}') THEN RETURN false; END IF;
 IF x ? 'age_min' AND NOT json_int_between(x->'age_min',1,100) THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(e ORDER BY array_position(ARRAY['phone','id_document','name_from_id'],e#>>'{}')),'[]') INTO ordered FROM jsonb_array_elements(x->'required') e;
 IF x->'required'<>ordered THEN RETURN false; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(x->'max_age') LOOP
  IF NOT json_int_between(v,1,31536000) OR (k='phone' AND NOT (x->'required' ? 'phone')) OR (k='document' AND NOT (x->'required' ?| ARRAY['id_document','name_from_id'])) OR (k='name_from_id' AND NOT (x->'required' ? 'name_from_id')) OR (k='age' AND NOT (x ? 'age_min')) THEN RETURN false; END IF;
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION event_door_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x='{"kiosk":false}'::jsonb THEN RETURN true; END IF;
 RETURN coalesce(json_object_keys_ok(x,ARRAY['kiosk','mode','match_threshold'],ARRAY['kiosk','mode','match_threshold']) AND x->'kiosk'='true'::jsonb AND x->>'mode' IN ('supervised','strict') AND json_int_between(x->'match_threshold',60,99),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION profile_links_v2_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE v jsonb; seen text[]:='{}'; host text; BEGIN
 IF x IS NULL OR jsonb_typeof(x)<>'array' OR jsonb_array_length(x)>8 THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(x) LOOP
  IF NOT json_object_keys_ok(v,ARRAY['kind','label','href'],ARRAY['kind','label','href']) OR coalesce(v->>'kind','') NOT IN ('linkedin','website','other') OR NOT json_line_ok(v->'label',1,40) OR NOT json_https_url_ok(v->'href') OR (v->>'href')=ANY(seen) THEN RETURN false; END IF;
  host:=lower(split_part(split_part(substring(v->>'href' from 9),'/',1),':',1));
  IF v->>'kind'='linkedin' AND host<>'linkedin.com' AND host NOT LIKE '%.linkedin.com' THEN RETURN false; END IF;
  seen:=array_append(seen,v->>'href');
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION profile_complete_v2_ok(full_name text,headline text,company text,job_role text,bio text,links jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 RETURN coalesce(json_line_ok(to_jsonb(full_name),1,240) AND json_line_ok(to_jsonb(headline),1,80) AND json_line_ok(to_jsonb(company),1,120) AND json_line_ok(to_jsonb(coalesce(job_role,'')),0,120) AND json_prose_ok(to_jsonb(bio),160) AND char_length(btrim(bio))>0 AND profile_links_v2_ok(links) AND EXISTS(SELECT 1 FROM jsonb_array_elements(links) l WHERE l->>'kind' IN ('linkedin','website')),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION event_form_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE q jsonb; o jsonb; ids text[]:='{}'; option_ids text[]; labels text[]; BEGIN
 IF NOT json_object_keys_ok(x,ARRAY['version','mode','closes_at','waitlist','fields','questions','consent_text'],ARRAY['version','mode','closes_at','waitlist','fields','questions','consent_text']) OR x->'version'<>'1'::jsonb OR coalesce(x->>'mode','') NOT IN ('request','open','invite_only') OR jsonb_typeof(x->'waitlist')<>'boolean' OR NOT json_object_keys_ok(x->'fields',ARRAY['phone_number'],ARRAY['phone_number']) OR coalesce(x->'fields'->>'phone_number','') NOT IN ('off','optional','required') OR jsonb_typeof(x->'questions')<>'array' OR jsonb_array_length(x->'questions')>20 THEN RETURN false; END IF;
 IF x->'closes_at'<>'null'::jsonb AND NOT json_instant_ok(x->'closes_at') THEN RETURN false; END IF;
 IF x->'consent_text'<>'null'::jsonb AND NOT json_prose_ok(x->'consent_text',2000) THEN RETURN false; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(x->'questions') LOOP
  IF NOT json_uuid_ok(q->'id') OR q->>'id'=ANY(ids) OR NOT json_line_ok(q->'label',1,200) OR jsonb_typeof(q->'required')<>'boolean' OR coalesce(q->>'kind','') NOT IN ('short','long','url','yes_no','single','multi') THEN RETURN false; END IF;
  ids:=array_append(ids,q->>'id');
  IF q->>'kind' IN ('single','multi') THEN
   IF NOT json_object_keys_ok(q,ARRAY['id','label','required','kind','options'],ARRAY['id','label','required','kind','options']) OR jsonb_typeof(q->'options')<>'array' OR jsonb_array_length(q->'options') NOT BETWEEN 2 AND 20 THEN RETURN false; END IF;
   option_ids:='{}'; labels:='{}';
   FOR o IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
    IF NOT json_object_keys_ok(o,ARRAY['id','label'],ARRAY['id','label']) OR NOT json_uuid_ok(o->'id') OR NOT json_line_ok(o->'label',1,100) OR o->>'id'=ANY(option_ids) OR lower(o->>'label')=ANY(labels) THEN RETURN false; END IF;
    option_ids:=array_append(option_ids,o->>'id'); labels:=array_append(labels,lower(o->>'label'));
   END LOOP;
  ELSIF NOT json_object_keys_ok(q,ARRAY['id','label','required','kind'],ARRAY['id','label','required','kind']) THEN RETURN false;
  END IF;
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION application_v2_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE k text; v jsonb; a jsonb; seen text[]; BEGIN
 IF NOT json_object_keys_ok(x,ARRAY['fields','answers'],ARRAY['fields','answers']) OR NOT json_object_keys_ok(x->'fields',ARRAY['phone_number'],'{}') OR jsonb_typeof(x->'answers')<>'object' OR octet_length(x::text)>32768 THEN RETURN false; END IF;
 IF x->'fields' ? 'phone_number' AND NOT (jsonb_typeof(x->'fields'->'phone_number')='string' AND x->'fields'->>'phone_number' ~ '^\+[1-9][0-9]{6,14}$') THEN RETURN false; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(x->'answers') LOOP
  IF NOT json_uuid_ok(to_jsonb(k)) THEN RETURN false; END IF;
  IF jsonb_typeof(v)='string' THEN IF NOT json_prose_ok(v,2000) THEN RETURN false; END IF;
  ELSIF jsonb_typeof(v)='array' THEN
   IF jsonb_array_length(v)>20 THEN RETURN false; END IF; seen:='{}';
   FOR a IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF NOT json_uuid_ok(a) OR a#>>'{}'=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,a#>>'{}');
   END LOOP;
  ELSIF jsonb_typeof(v)<>'boolean' THEN RETURN false; END IF;
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION application_form_v2_ok(form jsonb, application jsonb, partial boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE q jsonb; v jsonb; k text; opts text[]; BEGIN
 IF NOT event_form_v1_ok(form) OR NOT application_v2_ok(application) THEN RETURN false; END IF;
 IF form->'fields'->>'phone_number'='off' AND application->'fields' ? 'phone_number' THEN RETURN false; END IF;
 IF NOT partial AND form->'fields'->>'phone_number'='required' AND NOT (application->'fields' ? 'phone_number') THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_object_keys(application->'answers') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(form->'questions') d WHERE d->>'id'=k) THEN RETURN false; END IF;
 END LOOP;
 FOR q IN SELECT value FROM jsonb_array_elements(form->'questions') LOOP
  v:=application->'answers'->(q->>'id');
  IF v IS NULL THEN IF NOT partial AND q->'required'='true' THEN RETURN false; END IF; CONTINUE; END IF;
  IF q->>'kind'='short' AND NOT json_line_ok(v,1,300) THEN RETURN false;
  ELSIF q->>'kind'='long' AND NOT (json_prose_ok(v,2000) AND char_length(btrim(v#>>'{}'))>0) THEN RETURN false;
  ELSIF q->>'kind'='url' AND NOT json_https_url_ok(v) THEN RETURN false;
  ELSIF q->>'kind'='yes_no' AND jsonb_typeof(v)<>'boolean' THEN RETURN false;
  ELSIF q->>'kind' IN ('single','multi') THEN
   SELECT array_agg(o->>'id') INTO opts FROM jsonb_array_elements(q->'options') o;
   IF q->>'kind'='single' AND NOT (jsonb_typeof(v)='string' AND v#>>'{}'=ANY(opts)) THEN RETURN false; END IF;
   IF q->>'kind'='multi' AND NOT (json_string_set_ok(v,opts,20) AND jsonb_array_length(v)>0) THEN RETURN false; END IF;
  END IF;
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION consent_receipt_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 RETURN coalesce(json_object_keys_ok(x,ARRAY['disclosureVersion','shareProfileWithHosts','eventConsentAccepted','acceptedChecks','acceptedAt'],ARRAY['disclosureVersion','shareProfileWithHosts','eventConsentAccepted','acceptedChecks','acceptedAt']) AND x->>'disclosureVersion'='events-profile-v2' AND x->'shareProfileWithHosts'='true'::jsonb AND jsonb_typeof(x->'eventConsentAccepted')='boolean' AND json_string_set_ok(x->'acceptedChecks',ARRAY['face','phone','id_document','name_from_id','age'],5) AND json_instant_ok(x->'acceptedAt'),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION editorial_v2_ok(x jsonb, subject boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE s text; BEGIN
 IF NOT json_prose_ok(x,CASE WHEN subject THEN 200 ELSE 10000 END) OR (subject AND NOT json_line_ok(x,1,200)) THEN RETURN false; END IF;
 s:=regexp_replace(x#>>'{}','\{\{(first_name|event_name|date|venue|maps_url)\}\}','','g');
 RETURN s !~ '[{}]' AND s !~* '\]\([[:space:]]*(javascript|data|file|http):' AND s !~* '<[[:space:]]*(script|style|iframe)';
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION event_emails_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE k text; v jsonb; BEGIN
 IF NOT json_object_keys_ok(x,ARRAY['version','templates'],ARRAY['version','templates']) OR x->'version'<>'1'::jsonb OR NOT json_object_keys_ok(x->'templates',ARRAY['M-02','M-03','M-05','M-06','M-07','M-08','M-09','M-10','M-11','M-12','M-13','M-14','M-15','M-16','M-19','M-20','M-21','M-23','M-24'],'{}') THEN RETURN false; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(x->'templates') LOOP
  IF NOT json_object_keys_ok(v,ARRAY['enabled','subject','body_md'],ARRAY['enabled']) OR jsonb_typeof(v->'enabled')<>'boolean' OR (k IN ('M-03','M-06','M-16','M-20','M-21') AND v->'enabled'='false') OR (v ? 'subject' AND NOT editorial_v2_ok(v->'subject',true)) OR (v ? 'body_md' AND NOT editorial_v2_ok(v->'body_md')) THEN RETURN false; END IF;
 END LOOP; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION event_cover_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF x ? 'privacy' AND NOT coalesce(json_object_keys_ok(x->'privacy',ARRAY['guestList'],ARRAY['guestList']) AND x->'privacy'->>'guestList' IN ('hidden','count','names'),false) THEN RETURN false; END IF;
 x:=x-'privacy';
 RETURN coalesce((json_object_keys_ok(x,ARRAY['kind','theme'],ARRAY['kind','theme']) AND x->>'kind'='theme' AND x->>'theme' IN ('aqua','sky')) OR (json_object_keys_ok(x,ARRAY['kind','version','alt'],ARRAY['kind','version','alt']) AND x->>'kind'='asset' AND json_uuid_ok(x->'version') AND json_line_ok(x->'alt',1,200)),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION request_receipt_v1_ok(x jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE v jsonb; BEGIN
 IF NOT json_object_keys_ok(x,ARRAY['version','evaluatedAt','emailVerifiedAt','profileVersion','evidenceIds','consent'],ARRAY['version','evaluatedAt','emailVerifiedAt','profileVersion','evidenceIds','consent']) OR x->'version'<>'1'::jsonb OR NOT json_instant_ok(x->'evaluatedAt') OR NOT json_instant_ok(x->'emailVerifiedAt') OR NOT json_int_between(x->'profileVersion',1,2147483647) OR NOT consent_receipt_v1_ok(x->'consent') OR NOT json_object_keys_ok(x->'evidenceIds',ARRAY['face','phone','id_document','name_from_id','age'],ARRAY['face']) THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_each(x->'evidenceIds') LOOP IF NOT json_uuid_ok(v) THEN RETURN false; END IF; END LOOP; RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION evidence_value_v2_ok(kind text,source text,value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF kind='face' THEN RETURN source IN ('legacy','liveness') AND (value IS NULL OR value='null'); END IF;
 IF kind='identity' THEN RETURN coalesce(source='legacy' AND jsonb_typeof(value)='object',false); END IF;
 IF kind='age' THEN RETURN coalesce(source IN ('legacy','age_estimation') AND jsonb_typeof(value)='number' AND (value::text)::numeric>=0,false); END IF;
 IF kind='phone' THEN RETURN coalesce(source='phone' AND json_object_keys_ok(value,ARRAY['e164'],ARRAY['e164']) AND jsonb_typeof(value->'e164')='string' AND value->>'e164' ~ '^\+[1-9][0-9]{6,14}$',false); END IF;
 IF kind='document' THEN RETURN coalesce(source='document' AND json_object_keys_ok(value,ARRAY['legal_name','birth_date','expires_on'],ARRAY['legal_name','birth_date','expires_on']) AND json_line_ok(value->'legal_name',1,240) AND (value->'birth_date'='null' OR json_date_ok(value->'birth_date')) AND (value->'expires_on'='null' OR json_date_ok(value->'expires_on')),false); END IF;
 RETURN false; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;

--> statement-breakpoint
DROP INDEX evidence_one_active_face;
--> statement-breakpoint
DROP INDEX evidence_one_current_face;
--> statement-breakpoint
ALTER TABLE evidence DROP CONSTRAINT evidence_age_value;
--> statement-breakpoint
ALTER TABLE evidence ALTER COLUMN kind TYPE text USING kind::text;
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_one_active_face ON evidence(account_id) WHERE kind='face' AND activation='active';
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_one_current_face ON evidence(account_id) WHERE kind='face' AND state='active' AND invalidated_at IS NULL AND superseded_at IS NULL;
--> statement-breakpoint
ALTER TABLE evidence ADD CONSTRAINT evidence_age_value CHECK (kind<>'age' OR (value IS NOT NULL AND jsonb_typeof(value)='number'));

--> statement-breakpoint
CREATE TABLE "didit_workflows" (
	"key" text PRIMARY KEY NOT NULL,
	"feature_key" text NOT NULL,
	"config_hash" text NOT NULL,
	"desired_config" jsonb NOT NULL,
	"workflow_id" uuid,
	"provider_version_id" uuid,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"min_price_micros" bigint,
	"max_price_micros" bigint,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"last_error_code" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "didit_workflows_config" UNIQUE("feature_key","config_hash"),
	CONSTRAINT "didit_workflows_hash" CHECK ("didit_workflows"."config_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "didit_workflows_state" CHECK ("didit_workflows"."state" in ('provisioning','ready','failed','uncertain')),
	CONSTRAINT "didit_workflows_lease" CHECK (("didit_workflows"."lease_token" is null)=("didit_workflows"."lease_until" is null)),
	CONSTRAINT "didit_workflows_price" CHECK (("didit_workflows"."min_price_micros" is null and "didit_workflows"."max_price_micros" is null) or
    ("didit_workflows"."min_price_micros" is not null and "didit_workflows"."max_price_micros" is not null and
     "didit_workflows"."min_price_micros">=0 and "didit_workflows"."max_price_micros">0 and "didit_workflows"."min_price_micros"<="didit_workflows"."max_price_micros")),
	CONSTRAINT "didit_workflows_ready" CHECK ("didit_workflows"."state"<>'ready' or
    ("didit_workflows"."workflow_id" is not null and "didit_workflows"."provider_version_id" is not null and
     "didit_workflows"."min_price_micros" is not null and "didit_workflows"."max_price_micros" is not null and "didit_workflows"."verified_at" is not null)),
	CONSTRAINT "didit_workflows_config_object" CHECK (jsonb_typeof("didit_workflows"."desired_config")='object')
);
--> statement-breakpoint
CREATE TABLE "event_policies" (
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"form_version" integer NOT NULL,
	"checks" jsonb NOT NULL,
	"form" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_policies_event_id_version_pk" PRIMARY KEY("event_id","version"),
	CONSTRAINT "event_policies_form_binding" UNIQUE("event_id","version","form_version"),
	CONSTRAINT "event_policies_versions" CHECK ("event_policies"."version">0 and "event_policies"."form_version">0),
	CONSTRAINT "event_policies_checks" CHECK (event_checks_v1_ok("event_policies"."checks") is true),
	CONSTRAINT "event_policies_form" CHECK (event_form_v1_ok("event_policies"."form") is true)
);
--> statement-breakpoint
CREATE TABLE "registration_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"form_version" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"application" jsonb DEFAULT '{"fields":{},"answers":{}}'::jsonb NOT NULL,
	"consent" jsonb,
	"invite_id" uuid,
	"submitted_registration_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registration_drafts_account_event" UNIQUE("account_id","event_id"),
	CONSTRAINT "registration_drafts_account_id" UNIQUE("account_id","id"),
	CONSTRAINT "registration_drafts_version" CHECK ("registration_drafts"."version">0),
	CONSTRAINT "registration_drafts_expiry" CHECK ("registration_drafts"."expires_at">"registration_drafts"."created_at"),
	CONSTRAINT "registration_drafts_application" CHECK (application_v2_ok("registration_drafts"."application") is true),
	CONSTRAINT "registration_drafts_consent" CHECK ("registration_drafts"."consent" is null or consent_receipt_v1_ok("registration_drafts"."consent") is true)
);
--> statement-breakpoint
CREATE TABLE "registration_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"form_version" integer NOT NULL,
	"application" jsonb,
	"receipt" jsonb,
	"input_hash" text NOT NULL,
	"payload_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_submissions_payload" CHECK (("registration_submissions"."payload_purged_at" is null and
    application_v2_ok("registration_submissions"."application") is true and request_receipt_v1_ok("registration_submissions"."receipt") is true) or
    ("registration_submissions"."payload_purged_at" is not null and "registration_submissions"."application" is null and "registration_submissions"."receipt" is null)),
	CONSTRAINT "registration_submissions_hash" CHECK ("registration_submissions"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "full_name" text;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_proof_method" text;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_proof_ref" text;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "onboarded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_links_legacy" jsonb;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "checks" jsonb DEFAULT '{"version":1,"required":[],"max_age":{}}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "door" jsonb DEFAULT '{"kiosk":false}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "form" jsonb DEFAULT '{"version":1,"mode":"request","closes_at":null,"waitlist":true,"fields":{"phone_number":"off"},"questions":[],"consent_text":null}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "emails" jsonb DEFAULT '{"version":1,"templates":{}}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description_md" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "policy_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "form_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "binding" text DEFAULT 'legacy_chain' NOT NULL;
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "subject_face_id" uuid;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "policy_version" integer;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "form_version" integer;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "request_completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "profile_version_at_request" integer;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "request_receipt" jsonb;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "legacy_imported" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "application_v2" jsonb DEFAULT '{"fields":{},"answers":{}}'::jsonb;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "application_purged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "purpose" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "workflow_key" text;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "didit_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "vendor_data" text;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "email_at_creation" text;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "expected_checks" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "origin_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "origin_policy_version" integer;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "origin_draft_id" uuid;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "subject_face_id" uuid;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "consent" jsonb;
--> statement-breakpoint
UPDATE accounts SET full_name=nullif(btrim(concat_ws(' ',first_name,last_name)),''),profile_version=1;
--> statement-breakpoint
DO $$ DECLARE a record; l jsonb; links jsonb; host text; label text; href text; kind text; BEGIN
 FOR a IN SELECT id,profile_links FROM accounts LOOP
  links:='[]';
  IF jsonb_typeof(a.profile_links)='array' THEN
   FOR l IN SELECT value FROM jsonb_array_elements(a.profile_links) LOOP
    href:=l->>'href'; label:=btrim(l->>'label');
    IF NOT json_https_url_ok(to_jsonb(href)) OR NOT json_line_ok(to_jsonb(label),1,40) THEN CONTINUE; END IF;
    IF href ~ '^https://[^/?#]+$' THEN href:=href||'/'; END IF;
    host:=lower(split_part(split_part(substring(href from 9),'/',1),':',1));
    kind:=CASE WHEN host='linkedin.com' OR host LIKE '%.linkedin.com' THEN 'linkedin' WHEN lower(label) LIKE '%website%' OR lower(label) LIKE '%site%' THEN 'website' ELSE 'other' END;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(links) e WHERE e->>'href'=href) AND jsonb_array_length(links)<8 THEN links:=links||jsonb_build_array(jsonb_build_object('kind',kind,'label',label,'href',href)); END IF;
   END LOOP;
  END IF;
  UPDATE accounts SET profile_links_legacy=CASE WHEN profile_links<>links THEN jsonb_build_object('values',profile_links,'expiresAt',clock_timestamp()+interval '30 days') END,profile_links=links WHERE id=a.id;
 END LOOP;
END $$;
--> statement-breakpoint
WITH proofs AS (
 SELECT a.id,c.redeemed_at at,'otp:'||c.id::text ref FROM accounts a JOIN otp_challenges c ON c.email=a.email WHERE c.redeemed_at IS NOT NULL AND NOT c.synthetic
 UNION ALL SELECT a.id,i.created_at,'oidc:'||i.id::text FROM accounts a JOIN account_identities i ON i.account_id=a.id
 UNION ALL SELECT a.id,(e->>'verified_at')::timestamptz,'hosted:'||v.id::text FROM accounts a JOIN verifications v ON v.account_id=a.id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.decision->'email_verifications')='array' THEN v.decision->'email_verifications' ELSE '[]' END) e
 WHERE e->>'status'='Approved' AND lower(btrim(e->>'email'))=a.email AND json_instant_ok(e->'verified_at')
), chosen AS (SELECT DISTINCT ON(id) id,at,ref FROM proofs ORDER BY id,at,ref)
UPDATE accounts a SET email_verified_at=p.at,email_proof_method='legacy_verified',email_proof_ref=p.ref FROM chosen p WHERE p.id=a.id;
--> statement-breakpoint
UPDATE accounts SET profile_completed_at=clock_timestamp() WHERE profile_complete_v2_ok(full_name,headline,company,job_role,bio,profile_links);
--> statement-breakpoint
UPDATE accounts a SET onboarded_at=clock_timestamp() WHERE email_verified_at IS NOT NULL AND profile_completed_at IS NOT NULL AND deleting_at IS NULL AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM evidence e WHERE e.account_id=a.id AND e.kind='face' AND e.provider_status='approved' AND e.activation='active' AND e.invalidated_at IS NULL AND e.superseded_at IS NULL AND e.established_at<=clock_timestamp() AND e.valid_until>clock_timestamp() AND e.established_at+interval '180 days'>clock_timestamp());
--> statement-breakpoint
INSERT INTO audit(actor,action,target,data) SELECT 'migration:0021','event_model_v2.migration','events',jsonb_build_object('removedFreshnessRestrictions',count(*) FILTER(WHERE max_age ?| ARRAY['identity','face']),'unknownCoverThemes',count(*) FILTER(WHERE cover IS NOT NULL AND coalesce(cover->>'theme','') NOT IN ('aqua','sky'))) FROM events;
--> statement-breakpoint
UPDATE events SET checks=jsonb_build_object('version',1,'required','[]'::jsonb,'max_age',CASE WHEN max_age ? 'age' AND coalesce(age_min,(requirements->>'age_min')::int) IS NOT NULL THEN jsonb_build_object('age',max_age->'age') ELSE '{}' END) || CASE WHEN coalesce(age_min,(requirements->>'age_min')::int) IS NOT NULL THEN jsonb_build_object('age_min',coalesce(age_min,(requirements->>'age_min')::int)) ELSE '{}' END,
 door=jsonb_build_object('kiosk',true,'mode',door_mode,'match_threshold',match_threshold),description_md=left(description,20000),description=left(description,600),edit_version=1,policy_version=1,form_version=1,
 cover=CASE WHEN cover->>'kind'='asset' THEN cover ELSE jsonb_build_object('kind','theme','theme',CASE WHEN cover->>'theme' IN ('aqua','sky') THEN cover->>'theme' ELSE 'aqua' END) END || CASE WHEN cover->'privacy'->>'guestList' IN ('hidden','count','names') THEN jsonb_build_object('privacy',cover->'privacy') ELSE '{}'::jsonb END;
--> statement-breakpoint
CREATE FUNCTION legacy_question_uuid(event_id uuid, question_id text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid FROM (SELECT md5(event_id::text||':'||question_id) h) s $$;
--> statement-breakpoint
DO $$ DECLARE e record; q jsonb; questions jsonb; converted jsonb; templates jsonb; welcome jsonb; body text; code text; field text; BEGIN
 FOR e IN SELECT * FROM events LOOP
  questions:='[]';
  IF e.welcome_options ? 'questions' AND jsonb_typeof(e.welcome_options->'questions')<>'array' THEN RAISE EXCEPTION 'event_model_v2_legacy_questions_require_repair: %',e.id; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(coalesce(e.welcome_options->'questions','[]')) LOOP
   IF jsonb_typeof(q)<>'object' OR NOT json_line_ok(q->'id',1,200) OR NOT json_line_ok(q->'label',1,200) OR coalesce(q->>'kind',q->>'type','short') NOT IN ('short','long') OR jsonb_typeof(q->'required')<>'boolean' THEN RAISE EXCEPTION 'event_model_v2_legacy_question_requires_repair: %',e.id; END IF;
   questions:=questions||jsonb_build_array(jsonb_build_object('id',legacy_question_uuid(e.id,q->>'id'),'label',q->>'label','kind',coalesce(q->>'kind',q->>'type','short'),'required',q->'required'));
  END LOOP;
  converted:=jsonb_build_object('version',1,'mode',e.registration_mode,'closes_at',CASE WHEN e.registration_closes_at IS NULL THEN NULL ELSE to_char(e.registration_closes_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'waitlist',true,'fields',jsonb_build_object('phone_number','off'),'questions',questions,'consent_text',null);
  IF NOT event_form_v1_ok(converted) THEN RAISE EXCEPTION 'event_model_v2_legacy_form_requires_repair: %',e.id; END IF;
  welcome:=jsonb_build_object('enabled',coalesce(e.welcome_options->'welcomeEmail',e.welcome_options->'enabled','true'::jsonb));
  body:=coalesce(e.email_content->>'arrivalNote',e.welcome_options->'welcome'->>'block');
  IF body IS NOT NULL THEN welcome:=welcome||jsonb_build_object('body_md',body); END IF;
  IF e.welcome_options->'welcome' ? 'subject' THEN welcome:=welcome||jsonb_build_object('subject',e.welcome_options->'welcome'->>'subject'); END IF;
  templates:=jsonb_build_object('M-13',welcome);
  FOR code,field IN SELECT * FROM (VALUES ('M-11','teaser'),('M-12','directions'),('M-14','recap')) t(c,f) LOOP
   IF jsonb_typeof(e.email_content->field)='string' THEN templates:=templates||jsonb_build_object(code,jsonb_build_object('enabled',true,'body_md',e.email_content->>field)); END IF;
  END LOOP;
  IF NOT event_emails_v1_ok(jsonb_build_object('version',1,'templates',templates)) THEN RAISE EXCEPTION 'event_model_v2_legacy_email_requires_repair: %',e.id; END IF;
  UPDATE events SET form=converted,emails=jsonb_build_object('version',1,'templates',templates) WHERE id=e.id;
 END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO event_policies(event_id,version,form_version,checks,form) SELECT id,1,1,checks,form FROM events;
--> statement-breakpoint
UPDATE registrations SET policy_version=1,form_version=1,legacy_imported=true,blocked=(application->>'blocked'='true') IS TRUE;
--> statement-breakpoint
DO $$ DECLARE r record; q jsonb; answers jsonb; BEGIN
 FOR r IN SELECT reg.id,reg.event_id,reg.application,evt.welcome_options FROM registrations reg JOIN events evt ON evt.id=reg.event_id LOOP
  answers:='{}';
  FOR q IN SELECT value FROM jsonb_array_elements(coalesce(r.welcome_options->'questions','[]')) LOOP
   IF jsonb_typeof(r.application->(q->>'id'))='string' AND json_prose_ok(r.application->(q->>'id'),2000) THEN answers:=answers||jsonb_build_object(legacy_question_uuid(r.event_id,q->>'id')::text,r.application->(q->>'id')); END IF;
  END LOOP;
  UPDATE registrations SET application_v2=jsonb_build_object('fields','{}'::jsonb,'answers',answers) WHERE id=r.id;
 END LOOP;
END $$;
--> statement-breakpoint
UPDATE verification_ops op SET vendor_data=coalesce(v.vendor_data,'acct_'||op.account_id::text),email_at_creation=a.email,didit_session_id=v.didit_session_id FROM accounts a,verifications v WHERE a.id=op.account_id AND v.id=op.verification_id AND v.account_id=op.account_id;
--> statement-breakpoint
UPDATE verification_ops op SET vendor_data='acct_'||op.account_id::text,email_at_creation=a.email FROM accounts a WHERE a.id=op.account_id AND op.verification_id IS NULL;

--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "cover" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "policy_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "form_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" ALTER COLUMN "vendor_data" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" ALTER COLUMN "email_at_creation" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_ops" DROP CONSTRAINT "verification_ops_kind";
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "cover" SET DEFAULT '{"kind":"theme","theme":"aqua"}'::jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX "didit_workflows_provider_version" ON "didit_workflows" USING btree ("workflow_id","provider_version_id") WHERE "didit_workflows"."workflow_id" is not null;
--> statement-breakpoint
CREATE INDEX "didit_workflows_lease_idx" ON "didit_workflows" USING btree ("state","lease_until");
--> statement-breakpoint
CREATE INDEX "registration_drafts_expiry_idx" ON "registration_drafts" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "registration_submissions_registration_idx" ON "registration_submissions" USING btree ("registration_id","created_at");
--> statement-breakpoint
CREATE INDEX "accounts_onboarding_idx" ON "accounts" USING btree ("id") WHERE "accounts"."onboarded_at" is null and "accounts"."deleting_at" is null and "accounts"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "evidence_subject_face_idx" ON "evidence" USING btree ("account_id","subject_face_id") WHERE "evidence"."subject_face_id" is not null;
--> statement-breakpoint
CREATE INDEX "registrations_policy_idx" ON "registrations" USING btree ("event_id","policy_version","admission");
--> statement-breakpoint
CREATE UNIQUE INDEX "verification_ops_session_v2" ON "verification_ops" USING btree ("didit_session_id") WHERE "verification_ops"."didit_session_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "verification_ops_face_v2" ON "verification_ops" USING btree ("account_id") WHERE "verification_ops"."state" in ('creating','active') and "verification_ops"."purpose" in ('onboarding','face_renewal','re_enrolment');
--> statement-breakpoint
CREATE INDEX "verification_ops_origin_idx" ON "verification_ops" USING btree ("origin_event_id","origin_policy_version");
--> statement-breakpoint
CREATE INDEX "verification_ops_account_created_idx" ON "verification_ops" USING btree ("account_id","created_at");
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_account_id_id" UNIQUE("account_id","id");
--> statement-breakpoint
ALTER TABLE "event_policies" ADD CONSTRAINT "event_policies_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_submitted_registration_id_registrations_id_fk" FOREIGN KEY ("submitted_registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_policy_fk" FOREIGN KEY ("event_id","policy_version","form_version") REFERENCES "public"."event_policies"("event_id","version","form_version") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_policy_fk" FOREIGN KEY ("event_id","policy_version","form_version") REFERENCES "public"."event_policies"("event_id","version","form_version") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_policy_fk" FOREIGN KEY ("id","policy_version","form_version") REFERENCES "public"."event_policies"("event_id","version","form_version") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_subject_face_fk" FOREIGN KEY ("account_id","subject_face_id") REFERENCES "public"."evidence"("account_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_policy_fk" FOREIGN KEY ("event_id","policy_version","form_version") REFERENCES "public"."event_policies"("event_id","version","form_version") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_origin_event_id_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_origin_draft_id_registration_drafts_id_fk" FOREIGN KEY ("origin_draft_id") REFERENCES "public"."registration_drafts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_account_verification_v2" FOREIGN KEY ("account_id","verification_id") REFERENCES "public"."verifications"("account_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_workflow_v2" FOREIGN KEY ("workflow_key") REFERENCES "public"."didit_workflows"("key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_subject_v2" FOREIGN KEY ("account_id","subject_face_id") REFERENCES "public"."evidence"("account_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_origin_policy_v2" FOREIGN KEY ("origin_event_id","origin_policy_version") REFERENCES "public"."event_policies"("event_id","version") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_origin_draft_v2" FOREIGN KEY ("account_id","origin_draft_id") REFERENCES "public"."registration_drafts"("account_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_profile_version" CHECK ("accounts"."profile_version">0);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_email_proof" CHECK (("accounts"."email_verified_at" is null and "accounts"."email_proof_method" is null and "accounts"."email_proof_ref" is null) or ("accounts"."email_verified_at" is not null and "accounts"."email_proof_method" is not null and "accounts"."email_proof_method" in ('didit_otp','didit_google','legacy_verified') and "accounts"."email_proof_ref" is not null and char_length(btrim("accounts"."email_proof_ref")) between 1 and 500));
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_profile_links_v2" CHECK (profile_links_v2_ok("accounts"."profile_links") is true);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_profile_completed_v2" CHECK ("accounts"."profile_completed_at" is null or profile_complete_v2_ok("accounts"."full_name","accounts"."headline","accounts"."company","accounts"."job_role","accounts"."bio","accounts"."profile_links") is true);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_onboarded_v2" CHECK ("accounts"."onboarded_at" is null or ("accounts"."email_verified_at" is not null and "accounts"."profile_completed_at" is not null and "accounts"."email_verified_at"<="accounts"."onboarded_at" and "accounts"."profile_completed_at"<="accounts"."onboarded_at"));
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_checks_v2" CHECK (event_checks_v1_ok("events"."checks") is true);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_door_v2" CHECK (event_door_v1_ok("events"."door") is true);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_form_v2" CHECK (event_form_v1_ok("events"."form") is true);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_emails_v2" CHECK (event_emails_v1_ok("events"."emails") is true);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_v2" CHECK (event_cover_v1_ok("events"."cover") is true);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_description_v2" CHECK (char_length("events"."description")<=600 and char_length("events"."description_md")<=20000);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_versions_v2" CHECK ("events"."edit_version">0 and "events"."policy_version">0 and "events"."form_version">0);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_kind_v2" CHECK ("evidence"."kind" in ('identity','face','age','phone','document'));
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_v2" CHECK ("evidence"."source" in ('legacy','liveness','phone','document','age_estimation'));
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_binding_v2" CHECK (("evidence"."binding"='legacy_chain' and "evidence"."kind" in ('identity','face','age') and "evidence"."subject_face_id" is null) or ("evidence"."binding"='account' and "evidence"."kind"='phone' and "evidence"."subject_face_id" is null and "evidence"."continuity_of" is null) or ("evidence"."binding"='face_chain' and "evidence"."kind" in ('document','age') and "evidence"."subject_face_id" is not null));
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_value_v2" CHECK (evidence_value_v2_ok("evidence"."kind","evidence"."source","evidence"."value") is true);
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_payload_v2" CHECK (("registrations"."application_purged_at" is null and application_v2_ok("registrations"."application_v2") is true and (("registrations"."request_receipt" is null and "registrations"."legacy_imported" and "registrations"."request_completed_at" is null and "registrations"."profile_version_at_request" is null) or (request_receipt_v1_ok("registrations"."request_receipt") is true and "registrations"."request_completed_at" is not null and "registrations"."profile_version_at_request" is not null and "registrations"."profile_version_at_request">0 and ("registrations"."request_receipt"->>'profileVersion')::integer="registrations"."profile_version_at_request" and ("registrations"."request_receipt"->>'evaluatedAt')::timestamptz="registrations"."request_completed_at"))) or ("registrations"."application_purged_at" is not null and "registrations"."application_v2" is null and "registrations"."request_receipt" is null and "registrations"."staff_note" is null));
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_purpose_v2" CHECK ("verification_ops"."purpose" in ('legacy','onboarding','face_renewal','re_enrolment','event_checks'));
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_vendor_v2" CHECK (char_length("verification_ops"."vendor_data") between 1 and 254 and "verification_ops"."email_at_creation"=lower(btrim("verification_ops"."email_at_creation")) and char_length("verification_ops"."email_at_creation") between 3 and 254);
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_checks_v2" CHECK (proof_checks_v2_ok(to_jsonb("verification_ops"."expected_checks")) is true);
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_consent_v2" CHECK ("verification_ops"."purpose"='legacy' or ("verification_ops"."workflow_key" is not null and consent_receipt_v1_ok("verification_ops"."consent") is true));
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_face_plan_v2" CHECK ("verification_ops"."purpose" not in ('onboarding','face_renewal','re_enrolment') or ("verification_ops"."expected_checks"=array['face']::text[] and "verification_ops"."workflow_id"='00000000-0000-4000-8000-00000000face'::uuid and "verification_ops"."vendor_data"="verification_ops"."email_at_creation"));
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_extras_v2" CHECK ("verification_ops"."purpose"<>'event_checks' or not ('face'=any("verification_ops"."expected_checks")));
--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_kind" CHECK ("verification_ops"."kind" in ('full','renewal','age','extras'));
--> statement-breakpoint
CREATE FUNCTION event_edit_version_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['edit_version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['edit_version','updated_at']) THEN NEW.edit_version := OLD.edit_version+1; ELSE NEW.edit_version := OLD.edit_version; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_edit_version_v2 BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION event_edit_version_v2();
--> statement-breakpoint
CREATE FUNCTION event_cover_pointer_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.cover->>'kind'='asset' AND NOT EXISTS(SELECT 1 FROM event_assets WHERE event_id=NEW.id AND version::text=NEW.cover->>'version') THEN RAISE EXCEPTION 'event_cover_asset_ownership'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER event_cover_pointer_v2 AFTER INSERT OR UPDATE ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION event_cover_pointer_v2();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION event_edit_version_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.edit_version:=1; NEW.policy_version:=1; NEW.form_version:=1; RETURN NEW; END IF;
 NEW.policy_version:=OLD.policy_version; NEW.form_version:=OLD.form_version;
 IF NEW.form IS DISTINCT FROM OLD.form THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.form->'questions') o JOIN jsonb_array_elements(NEW.form->'questions') n ON o->>'id'=n->>'id' WHERE o->>'kind'<>n->>'kind') THEN RAISE EXCEPTION 'event_question_kind_immutable'; END IF;
  NEW.form_version:=OLD.form_version+1;
 END IF;
 IF NEW.checks IS DISTINCT FROM OLD.checks OR NEW.form IS DISTINCT FROM OLD.form THEN NEW.policy_version:=OLD.policy_version+1; END IF;
 IF (to_jsonb(NEW)-ARRAY['edit_version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['edit_version','updated_at']) THEN NEW.edit_version:=OLD.edit_version+1; ELSE NEW.edit_version:=OLD.edit_version; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
DROP TRIGGER event_edit_version_v2 ON events;
--> statement-breakpoint
CREATE TRIGGER event_edit_version_v2 BEFORE INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION event_edit_version_v2();
--> statement-breakpoint
CREATE FUNCTION event_policy_snapshot_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO event_policies(event_id,version,form_version,checks,form) VALUES(NEW.id,NEW.policy_version,NEW.form_version,NEW.checks,NEW.form) ON CONFLICT DO NOTHING; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_policy_snapshot_v2 AFTER INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION event_policy_snapshot_v2();
--> statement-breakpoint
CREATE FUNCTION event_policy_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e events; BEGIN
 SELECT * INTO e FROM events WHERE id=NEW.id; IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM event_policies p WHERE p.event_id=e.id AND p.version=e.policy_version AND p.form_version=e.form_version AND p.checks=e.checks AND p.form=e.form) OR (e.form->>'closes_at')::timestamptz>e.starts_at THEN RAISE EXCEPTION 'event_policy_snapshot_mismatch'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER event_policy_guard_v2 AFTER INSERT OR UPDATE ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION event_policy_guard_v2();
--> statement-breakpoint
CREATE FUNCTION event_policy_immutable_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM events WHERE id=OLD.event_id) THEN RAISE EXCEPTION 'event_policy_immutable'; END IF; RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_policy_immutable_v2 BEFORE UPDATE OR DELETE ON event_policies FOR EACH ROW EXECUTE FUNCTION event_policy_immutable_v2();
--> statement-breakpoint
CREATE FUNCTION onboarding_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.onboarded_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.onboarded_at IS NULL) AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.account_id=NEW.id AND e.kind='face' AND e.provider_status='approved' AND e.activation='active' AND e.invalidated_at IS NULL AND e.superseded_at IS NULL AND e.established_at<=NEW.onboarded_at AND e.valid_until>NEW.onboarded_at AND e.established_at+interval '180 days'>NEW.onboarded_at) THEN RAISE EXCEPTION 'onboarding_face_required'; END IF;
 IF TG_OP='UPDATE' AND (OLD.onboarded_at IS NOT NULL AND NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at OR OLD.profile_completed_at IS NOT NULL AND NEW.profile_completed_at IS DISTINCT FROM OLD.profile_completed_at) THEN RAISE EXCEPTION 'onboarding_milestone_immutable'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER onboarding_guard_v2 AFTER INSERT OR UPDATE ON accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION onboarding_guard_v2();
--> statement-breakpoint
CREATE FUNCTION evidence_binding_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.subject_face_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM evidence f WHERE f.id=NEW.subject_face_id AND f.account_id=NEW.account_id AND f.kind='face') THEN RAISE EXCEPTION 'evidence_subject_face_required'; END IF;
 IF TG_OP='UPDATE' AND OLD.activation<>'pending_continuity' AND (NEW.account_id,NEW.source,NEW.binding,NEW.subject_face_id) IS DISTINCT FROM (OLD.account_id,OLD.source,OLD.binding,OLD.subject_face_id) THEN RAISE EXCEPTION 'evidence_binding_immutable'; END IF;
 IF NEW.continuity_of IS NOT NULL AND EXISTS(WITH RECURSIVE chain AS (SELECT id,verification_id,continuity_of,ARRAY[verification_id] path FROM evidence WHERE verification_id=NEW.continuity_of AND kind='face' UNION ALL SELECT f.id,f.verification_id,f.continuity_of,c.path||f.verification_id FROM evidence f JOIN chain c ON f.verification_id=c.continuity_of WHERE f.kind='face' AND NOT f.verification_id=ANY(c.path)) SELECT 1 FROM chain WHERE verification_id=NEW.verification_id) THEN RAISE EXCEPTION 'evidence_continuity_cycle'; END IF;
 IF NEW.kind='document' AND NEW.value->>'expires_on' IS NOT NULL AND NEW.valid_until>((NEW.value->>'expires_on')::date+1)::timestamp AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'document_validity_exceeds_expiration'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_binding_guard_v2 BEFORE INSERT OR UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_binding_guard_v2();
--> statement-breakpoint
CREATE FUNCTION verification_op_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE w didit_workflows; BEGIN
 IF NEW.purpose<>'legacy' THEN
  SELECT * INTO w FROM didit_workflows WHERE key=NEW.workflow_key;
  IF NOT FOUND OR w.workflow_id IS DISTINCT FROM NEW.workflow_id THEN RAISE EXCEPTION 'verification_workflow_binding'; END IF;
  IF TG_OP='INSERT' OR (NEW.purpose,NEW.workflow_key,NEW.subject_face_id) IS DISTINCT FROM (OLD.purpose,OLD.workflow_key,OLD.subject_face_id) THEN
   IF NEW.purpose='event_checks' AND (NEW.origin_event_id IS NULL OR NEW.origin_policy_version IS NULL) THEN RAISE EXCEPTION 'verification_origin_required'; END IF;
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.account_id,NEW.workflow_id,NEW.workflow_key,NEW.vendor_data,NEW.email_at_creation,NEW.expected_checks,NEW.purpose,NEW.subject_face_id) IS DISTINCT FROM (OLD.account_id,OLD.workflow_id,OLD.workflow_key,OLD.vendor_data,OLD.email_at_creation,OLD.expected_checks,OLD.purpose,OLD.subject_face_id) THEN RAISE EXCEPTION 'verification_op_binding_immutable'; END IF;
 IF NEW.verification_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM verifications v WHERE v.id=NEW.verification_id AND v.account_id=NEW.account_id AND (NEW.didit_session_id IS NULL OR v.didit_session_id=NEW.didit_session_id) AND v.workflow_id=NEW.workflow_id AND v.vendor_data=NEW.vendor_data) THEN RAISE EXCEPTION 'verification_session_mapping_mismatch'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER verification_op_guard_v2 BEFORE INSERT OR UPDATE ON verification_ops FOR EACH ROW EXECUTE FUNCTION verification_op_guard_v2();
--> statement-breakpoint
CREATE FUNCTION workflow_immutable_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.key,NEW.feature_key,NEW.config_hash,NEW.desired_config) IS DISTINCT FROM (OLD.key,OLD.feature_key,OLD.config_hash,OLD.desired_config) OR (OLD.state='ready' AND (NEW.workflow_id,NEW.provider_version_id,NEW.min_price_micros,NEW.max_price_micros) IS DISTINCT FROM (OLD.workflow_id,OLD.provider_version_id,OLD.min_price_micros,OLD.max_price_micros)) THEN RAISE EXCEPTION 'workflow_config_immutable'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER workflow_immutable_v2 BEFORE UPDATE ON didit_workflows FOR EACH ROW EXECUTE FUNCTION workflow_immutable_v2();
--> statement-breakpoint
CREATE FUNCTION draft_ownership_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.invite_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invites WHERE id=NEW.invite_id AND event_id=NEW.event_id) OR NEW.submitted_registration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM registrations WHERE id=NEW.submitted_registration_id AND event_id=NEW.event_id AND account_id=NEW.account_id) THEN RAISE EXCEPTION 'draft_ownership_mismatch'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER draft_ownership_guard_v2 BEFORE INSERT OR UPDATE ON registration_drafts FOR EACH ROW EXECUTE FUNCTION draft_ownership_guard_v2();
--> statement-breakpoint
CREATE FUNCTION registration_submission_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p event_policies; a accounts; e evidence; k text; eid jsonb; consent jsonb; freshness numeric; local_day date; BEGIN
 IF TG_OP='UPDATE' AND (NEW.policy_version,NEW.form_version,NEW.application_v2,NEW.request_receipt,NEW.request_completed_at) IS NOT DISTINCT FROM (OLD.policy_version,OLD.form_version,OLD.application_v2,OLD.request_receipt,OLD.request_completed_at) THEN RETURN NEW; END IF;
 IF current_setting('events.payload_purge',true)='on' AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='purge_registration_payloads(uuid)'::regprocedure) AND NEW.application_purged_at IS NOT NULL AND EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND ends_at<clock_timestamp()-interval '90 days') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.request_receipt IS NOT NULL AND NOT (OLD.admission='cancelled_by_guest' AND NEW.admission='pending' AND NEW.reapplication_count=OLD.reapplication_count+1) THEN RAISE EXCEPTION 'registration_submission_immutable'; END IF;
 IF NEW.legacy_imported AND NEW.request_receipt IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM event_policies WHERE event_id=NEW.event_id AND version=NEW.policy_version AND form_version=NEW.form_version;
 SELECT * INTO a FROM accounts WHERE id=NEW.account_id;
 IF p.event_id IS NULL OR NOT application_form_v2_ok(p.form,NEW.application_v2) OR NOT request_receipt_v1_ok(NEW.request_receipt) OR a.email_verified_at IS NULL OR a.onboarded_at IS NULL OR a.profile_version<>NEW.profile_version_at_request OR NOT profile_complete_v2_ok(a.full_name,a.headline,a.company,a.job_role,a.bio,a.profile_links) OR a.deleting_at IS NOT NULL OR a.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'registration_submission_invalid'; END IF;
 IF date_trunc('milliseconds',a.email_verified_at) IS DISTINCT FROM (NEW.request_receipt->>'emailVerifiedAt')::timestamptz THEN RAISE EXCEPTION 'registration_email_receipt_mismatch'; END IF;
 IF NEW.request_completed_at>clock_timestamp() OR NEW.request_completed_at<transaction_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'registration_receipt_time_invalid'; END IF;
 consent:=NEW.request_receipt->'consent';
 IF p.form->'consent_text'<>'null' AND consent->'eventConsentAccepted'<>'true' OR NOT (consent->'acceptedChecks' ? 'face') THEN RAISE EXCEPTION 'registration_consent_required'; END IF;
 FOR k,eid IN SELECT key,value FROM jsonb_each(NEW.request_receipt->'evidenceIds') LOOP
  SELECT * INTO e FROM evidence WHERE id=(eid#>>'{}')::uuid AND account_id=NEW.account_id;
  IF e.id IS NULL OR e.provider_status<>'approved' OR e.activation<>'active' OR e.invalidated_at IS NOT NULL OR e.superseded_at IS NOT NULL OR e.established_at>NEW.request_completed_at OR e.valid_until<=NEW.request_completed_at OR e.established_at+(CASE WHEN e.kind='face' THEN interval '180 days' ELSE interval '365 days' END)<=NEW.request_completed_at OR (k='face' AND e.kind<>'face') OR (k='phone' AND e.kind<>'phone') OR (k IN ('id_document','name_from_id') AND e.kind<>'document') OR (k='age' AND e.kind NOT IN ('age','document')) THEN RAISE EXCEPTION 'registration_evidence_receipt_invalid'; END IF;
  freshness:=CASE k WHEN 'phone' THEN (p.checks->'max_age'->>'phone')::numeric WHEN 'id_document' THEN (p.checks->'max_age'->>'document')::numeric WHEN 'name_from_id' THEN least((p.checks->'max_age'->>'document')::numeric,(p.checks->'max_age'->>'name_from_id')::numeric) WHEN 'age' THEN least((p.checks->'max_age'->>'age')::numeric,CASE WHEN e.kind='document' THEN (p.checks->'max_age'->>'document')::numeric END) END;
  IF freshness IS NOT NULL AND e.established_at<NEW.request_completed_at-freshness*interval '1 second' THEN RAISE EXCEPTION 'registration_evidence_too_old'; END IF;
  IF k='phone' AND (e.binding<>'account' OR (NEW.application_v2->'fields' ? 'phone_number' AND NEW.application_v2->'fields'->>'phone_number'<>e.value->>'e164')) THEN RAISE EXCEPTION 'registration_phone_binding'; END IF;
  IF e.kind IN ('document','age') AND NOT EXISTS(
   WITH RECURSIVE chain AS (
    SELECT f.id,f.verification_id,f.continuity_of,ARRAY[f.id] path FROM evidence f WHERE f.id=(NEW.request_receipt->'evidenceIds'->>'face')::uuid AND f.account_id=NEW.account_id AND f.kind='face'
    UNION ALL SELECT f.id,f.verification_id,f.continuity_of,c.path||f.id FROM evidence f JOIN chain c ON f.verification_id=c.continuity_of WHERE f.account_id=NEW.account_id AND f.kind='face' AND f.provider_status='approved' AND f.activation='superseded' AND f.invalidated_at IS NULL AND NOT f.id=ANY(c.path)
   ) SELECT 1 FROM chain WHERE (e.binding='face_chain' AND id=e.subject_face_id) OR (e.binding='legacy_chain' AND e.kind='age' AND verification_id=e.verification_id)
  ) THEN RAISE EXCEPTION 'registration_subject_binding'; END IF;
  IF k='name_from_id' AND lower(regexp_replace(normalize(btrim(a.full_name),NFC),'[[:space:]]+',' ','g'))<>lower(regexp_replace(normalize(btrim(e.value->>'legal_name'),NFC),'[[:space:]]+',' ','g')) THEN RAISE EXCEPTION 'registration_name_mismatch'; END IF;
  IF k='age' THEN
   SELECT (NEW.request_completed_at AT TIME ZONE timezone)::date INTO local_day FROM events WHERE id=NEW.event_id;
   IF (e.kind='age' AND (e.value#>>'{}')::numeric<(p.checks->>'age_min')::integer) OR (e.kind='document' AND (e.value->>'birth_date' IS NULL OR extract(year FROM age(local_day,(e.value->>'birth_date')::date))<(p.checks->>'age_min')::integer)) THEN RAISE EXCEPTION 'registration_age_below_minimum'; END IF;
  END IF;
 END LOOP;
 FOR k IN SELECT value FROM jsonb_array_elements_text(p.checks->'required') LOOP
  IF NOT (NEW.request_receipt->'evidenceIds' ? k) OR NOT (consent->'acceptedChecks' ? k) THEN RAISE EXCEPTION 'registration_check_required'; END IF;
 END LOOP;
 IF p.checks ? 'age_min' AND (NOT (NEW.request_receipt->'evidenceIds' ? 'age') OR NOT (consent->'acceptedChecks' ? 'age')) THEN RAISE EXCEPTION 'registration_age_required'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER registration_submission_guard_v2 BEFORE INSERT OR UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION registration_submission_guard_v2();
--> statement-breakpoint
CREATE FUNCTION submission_identity_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF current_setting('events.payload_purge',true)='on' AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='purge_registration_payloads(uuid)'::regprocedure) AND NEW.payload_purged_at IS NOT NULL AND NEW.application IS NULL AND NEW.receipt IS NULL AND (to_jsonb(NEW)-ARRAY['application','receipt','payload_purged_at'])=(to_jsonb(OLD)-ARRAY['application','receipt','payload_purged_at']) AND EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND ends_at<clock_timestamp()-interval '90 days') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'registration_submission_immutable';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM registrations r JOIN event_policies p ON p.event_id=r.event_id AND p.version=NEW.policy_version AND p.form_version=NEW.form_version WHERE r.id=NEW.registration_id AND r.account_id=NEW.account_id AND r.event_id=NEW.event_id AND application_form_v2_ok(p.form,NEW.application)) THEN RAISE EXCEPTION 'submission_owner_or_form_mismatch'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER submission_identity_guard_v2 BEFORE INSERT OR UPDATE ON registration_submissions FOR EACH ROW EXECUTE FUNCTION submission_identity_guard_v2();
--> statement-breakpoint
CREATE FUNCTION submission_latest_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r registrations; s registration_submissions; n integer; rid uuid; BEGIN
 IF TG_TABLE_NAME='registrations' THEN rid:=NEW.id; ELSE rid:=NEW.registration_id; END IF;
 SELECT * INTO r FROM registrations WHERE id=rid; IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM registration_submissions WHERE registration_id=r.id;
 IF n>2 THEN RAISE EXCEPTION 'submission_reapplication_limit'; END IF;
 IF r.legacy_imported AND n=0 THEN RETURN NULL; END IF;
 SELECT * INTO s FROM registration_submissions WHERE registration_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF s.id IS NULL OR (r.application_v2,r.request_receipt,r.policy_version,r.form_version) IS DISTINCT FROM (s.application,s.receipt,s.policy_version,s.form_version) THEN RAISE EXCEPTION 'submission_latest_mismatch'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER registration_latest_guard_v2 AFTER INSERT OR UPDATE ON registrations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION submission_latest_guard_v2();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER submission_latest_guard_v2 AFTER INSERT OR UPDATE ON registration_submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION submission_latest_guard_v2();
--> statement-breakpoint
CREATE FUNCTION purge_registration_payloads(target uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n integer; BEGIN
 IF NOT EXISTS(SELECT 1 FROM events WHERE id=target AND ends_at<clock_timestamp()-interval '90 days') THEN RAISE EXCEPTION 'retention_not_due'; END IF;
 PERFORM set_config('events.payload_purge','on',true);
 UPDATE registration_submissions SET application=NULL,receipt=NULL,payload_purged_at=clock_timestamp() WHERE event_id=target AND payload_purged_at IS NULL;
 UPDATE registrations SET application_v2=NULL,request_receipt=NULL,staff_note=NULL,application='{}',application_purged_at=clock_timestamp() WHERE event_id=target AND application_purged_at IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT; DELETE FROM registration_drafts WHERE event_id=target;
 PERFORM set_config('events.payload_purge','off',true); RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_registration_payloads(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION verification_mapping_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM verification_ops op JOIN verifications v ON v.id=op.verification_id WHERE v.id=NEW.id AND (op.account_id<>v.account_id OR op.workflow_id<>v.workflow_id OR op.vendor_data<>v.vendor_data OR op.didit_session_id IS DISTINCT FROM v.didit_session_id)) THEN RAISE EXCEPTION 'verification_session_mapping_mismatch'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER verification_mapping_guard_v2 AFTER INSERT OR UPDATE ON verifications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verification_mapping_guard_v2();
