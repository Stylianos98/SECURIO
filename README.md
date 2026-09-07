# SECURIO Demo

Interactive, zero-backend concept demo for SECURIO.

## What is included

- Guard view with assigned duty/job
- Start / complete job workflow
- Incident reporting
- Demo SOS event
- SECURIO COMMAND supervisor view
- Client-safe status view
- Supervisor-controlled Client Visible incident flag
- Shared browser state using `localStorage`
- Premium black/red responsive UI

## Demo scope

This repository is intentionally a **frontend-only demo**. It does not contain production authentication, a backend, PostgreSQL, RosterDroid connectivity, real notifications, GPS verification, or emergency dispatch.

The same browser stores the demo state, so you can switch between Guard, Command and Client roles and see the workflow update.

## Run locally

Open `index.html` directly in a browser, or serve the folder with any static web server.

Example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

This project is compatible with GitHub Pages because it is plain HTML/CSS/JavaScript. If Pages is available for the repository/account, publish from the `main` branch root. If private-repository Pages is not included in the current GitHub plan, either make this demo repository public or use another free static host.

## Production direction

The demo should later evolve to:

- Guard PWA
- Streamlit or lightweight web SECURIO COMMAND
- Client web portal
- FastAPI
- PostgreSQL
- Private object storage
- RosterDroid adapter
- Proper authentication, MFA, RBAC, audit logging and tenant/site access controls

The demo contains no real operational or personal data.
