# SECURIO Demo

Interactive, zero-backend concept demo for SECURIO.

## Covered in the demo

- Guard current duty imported conceptually from RosterDroid
- Guard Start / Done job workflow
- Selected-job point-in-time location verification
- Incident reporting with photo/PDF attachment placeholder
- Incident lifecycle: OPEN → ACKNOWLEDGED → UNDER_REVIEW → RESOLVED → CLOSED
- SOS with press-and-hold confirmation concept, supervisor acknowledgement and resolution
- SECURIO COMMAND Attention view
- On Duty Now and Site View
- Search across sites, guards, incidents and jobs
- Supervisor-controlled Client Visible incidents
- Operational activity / audit trail concept
- Reports: in-app / PDF / scheduled email concepts
- SECURIO CLIENT property-security-status view
- Client privacy firewall: no guard identity, internal roster, shift details or raw GPS
- Client → Security call and chat concept
- Company Admin view for role controls, integration, retention and audit concepts
- Roles: Guard / Supervisor / Company Admin / Client
- RosterDroid shown as source of truth for roster/scheduling
- API-first / CSV-fallback integration concept
- Greek / English interface toggle concept
- No AI in V1
- Premium black/red responsive UI
- Shared browser state using localStorage

## Product rules represented

- The existing roster system organizes the schedule. SECURIO organizes the execution.
- Give each person only the information they need.
- The client monitors the security status of the property, not security staff.
- No CCTV or alarm functionality.
- No continuous GPS tracking.
- No automatic external emergency dispatch from SOS.

## Important demo limitations

This repository is intentionally a **frontend-only simulation hosted on GitHub Pages**. It is not a production security system.

It does not contain real authentication, MFA, server-side RBAC, PostgreSQL, private object storage, a live RosterDroid connector, real GPS verification, push/email/SMS/WhatsApp delivery, WebSockets, offline outbox sync, production audit immutability, data retention enforcement or emergency dispatch.

All state stays in the current browser using `localStorage`, and all names/data are simulated.

## Production architecture direction

- Guard: lightweight PWA
- COMMAND: Streamlit or lightweight web interface
- Client: Streamlit or lightweight web portal
- Backend: FastAPI
- Operational database: PostgreSQL
- Files: private EU-region object storage with signed URLs
- RosterDroid: connector/adapter with API discovery first and CSV fallback
- Authentication: secure sessions/tokens, MFA for supervisors/admins, server-side RBAC and site scopes
- Audit: immutable operational audit metadata and soft-delete/tombstone handling
- Hosting: EU region, HTTPS, secrets management, backups, monitoring and separate dev/staging/production environments
- BigQuery: optional later for historical reporting/analytics, not the critical operational database

The demo contains no real operational or personal data.