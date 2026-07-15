# Security operations

Organization identity is global, but organization access is policy-gated. Owners/admins may allow password, Google, and/or email OTP; at least one remains enabled. Membership stays invite-only. Required MFA causes a new step-up when entering a stricter organization.

TOTP secrets use authenticated encryption. Recovery codes are one-time and stored only as keyed hashes. Remembered-device tokens are random, HttpOnly, hashed in Postgres, expiring, and revocable. No SMS factor exists.

Password reset uses Better Auth's hashed, short-lived, attempt-limited email OTP. Requests are generic for unknown addresses. Completion verifies the code, checks the password against Have I Been Pwned's k-anonymous range service, uses Better Auth password hashing, verifies the email, revokes all existing sessions, writes an audit event, and sends a security notice.

Platform-admin bootstrap: a not-yet-enrolled platform admin may perform the first privileged setup, which is auditable. Once that admin enrolls MFA, privileged mutations require a recent step-up. Recovery uses a stored one-time recovery code. If all factors are lost, another already-enrolled platform admin must revoke/reseed access through the documented database-admin process; never bypass MFA in application code.
