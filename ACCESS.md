# OPE Assessor Access

## Local Wi-Fi Access

Run the app from this folder:

```powershell
npm start
```

The server prints addresses like:

```text
OPE Assessor is running locally at http://localhost:8000
Open from another device on this Wi-Fi: http://192.168.1.20:8000
```

Use the `http://YOUR_IP:8000` address on phones, tablets, and laptops connected to the same Wi-Fi.

If another app already uses port `8000`, choose another port:

```powershell
$env:PORT=8080
npm start
```

## Online Access

For cross-device sync everywhere, deploy this project as a Node app so all devices talk to the same shared backend.

- No third-party API key is required.
- Run `npm start` on any Node-capable host such as Render, Railway, Fly.io, a VPS, or your own Windows/Linux server.
- Make sure the deployed service keeps `ope-shared-state.json` on persistent storage.
- Point every phone, tablet, and laptop to that same deployed URL.

Important: browser `localStorage` is still per device/browser for local drafts, but quizzes, teachers, students, and submissions will sync through the shared backend when all devices use the same deployed server.

If you split the frontend and backend onto different domains:

- Set `window.OPE_CONFIG.apiBaseUrl` in `config.js` to your backend URL.
- Set `ALLOWED_ORIGINS` on the backend to the frontend origin.
