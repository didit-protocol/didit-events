-- Flow v3: hosts need name, role, company and one link; the bio stays validated (prose, <=160) but may be empty.
CREATE OR REPLACE FUNCTION profile_complete_v2_ok(full_name text,headline text,company text,job_role text,bio text,links jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 RETURN coalesce(json_line_ok(to_jsonb(full_name),1,240) AND json_line_ok(to_jsonb(headline),1,80) AND json_line_ok(to_jsonb(company),1,120) AND json_line_ok(to_jsonb(coalesce(job_role,'')),0,120) AND json_prose_ok(to_jsonb(coalesce(bio,'')),160) AND profile_links_v2_ok(links) AND EXISTS(SELECT 1 FROM jsonb_array_elements(links) l WHERE l->>'kind' IN ('linkedin','website')),false);
 EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
UPDATE accounts SET profile_completed_at=clock_timestamp() WHERE profile_completed_at IS NULL AND deleting_at IS NULL AND deleted_at IS NULL AND profile_complete_v2_ok(full_name,headline,company,job_role,bio,profile_links);
--> statement-breakpoint
-- The AI Era hosts (2026-09-30): replaced only while the seeded default is untouched, so operator edits are kept.
UPDATE events SET speakers='[{"name":"Alberto Rosas","role":"Didit · CEO","email":"events.owner@didit.me"},{"name":"Uma Bramwell","role":"Didit"}]'::jsonb
 WHERE slug='ai-era' AND speakers='[{"name":"Alberto","role":"Didit · CEO"},{"name":"Alejandro","role":"Didit · Co-founder"},{"name":"Didit Events","role":"Calendar"}]'::jsonb;
