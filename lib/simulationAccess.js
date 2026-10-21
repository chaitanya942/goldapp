// Who can open the Simulation tab + /api/simulation. Plain module (no
// 'use client') so API routes can import it — see PAGE_EMAIL_ALLOWLIST in
// lib/context.js, which reuses this list for the client-side nav gate.

// RETIRED 2026-10-17 — the Simulation module is obsolete and switched off for
// everyone (empty list = nobody passes; /api/simulation returns 403). Its code
// is kept, unrendered: components/simulation/*, lib/simulationData.js,
// lib/branchGeocode.js, app/api/simulation. To bring it back, restore
// ['chaitanya@whitegold.money'] here and re-enable the commented-out sidebar
// entry (components/Sidebar.js) and page case (app/dashboard/page.js).
export const SIMULATION_EMAILS = []

export const canSeeSimulation = (email) => SIMULATION_EMAILS.includes(String(email || '').trim().toLowerCase())
