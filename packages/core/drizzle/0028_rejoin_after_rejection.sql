-- v5 re-join: a declined guest may send one more request (unless the hosts blocked it), like a guest who withdrew.
-- Same guard as 0021, with 'rejected' also allowed as the origin of a re-submission (reapplication_count+1).
CREATE OR REPLACE FUNCTION registration_submission_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p event_policies; a accounts; e evidence; k text; eid jsonb; consent jsonb; freshness numeric; local_day date; BEGIN
 IF TG_OP='UPDATE' AND (NEW.policy_version,NEW.form_version,NEW.application_v2,NEW.request_receipt,NEW.request_completed_at) IS NOT DISTINCT FROM (OLD.policy_version,OLD.form_version,OLD.application_v2,OLD.request_receipt,OLD.request_completed_at) THEN RETURN NEW; END IF;
 IF current_setting('events.payload_purge',true)='on' AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='purge_registration_payloads(uuid)'::regprocedure) AND NEW.application_purged_at IS NOT NULL AND EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND ends_at<clock_timestamp()-interval '90 days') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.request_receipt IS NOT NULL AND NOT (OLD.admission IN ('cancelled_by_guest','rejected') AND NEW.admission='pending' AND NEW.reapplication_count=OLD.reapplication_count+1) THEN RAISE EXCEPTION 'registration_submission_immutable'; END IF;
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
