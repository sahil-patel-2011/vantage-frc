-- Existing receipt images remain readable. New evidence is a document, not a photo upload.
ALTER TABLE reimbursement_requests DROP CONSTRAINT reimbursement_requests_receipt_media_type_check;
ALTER TABLE reimbursement_requests ADD CONSTRAINT reimbursement_requests_receipt_media_type_check
  CHECK(receipt_media_type IS NULL OR receipt_media_type IN ('application/pdf','image/jpeg','image/png','image/webp'));
CREATE OR REPLACE FUNCTION enforce_receipt_document() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.receipt_bytes IS NOT NULL AND NEW.receipt_media_type <> 'application/pdf'
    AND (TG_OP='INSERT' OR NEW.receipt_bytes IS DISTINCT FROM OLD.receipt_bytes
      OR NEW.receipt_media_type IS DISTINCT FROM OLD.receipt_media_type) THEN
    RAISE EXCEPTION 'New receipts must be PDF documents; photo uploads are not supported';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_receipt_document() FROM PUBLIC;
CREATE TRIGGER reimbursement_receipt_document BEFORE INSERT OR UPDATE ON reimbursement_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_receipt_document();
