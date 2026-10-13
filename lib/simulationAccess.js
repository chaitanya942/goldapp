// Who can open the Simulation tab + /api/simulation. Plain module (no
// 'use client') so API routes can import it — see PAGE_EMAIL_ALLOWLIST in
// lib/context.js, which reuses this list for the client-side nav gate.

export const SIMULATION_EMAILS = ['chaitanya@whitegold.money']

export const canSeeSimulation = (email) => SIMULATION_EMAILS.includes(String(email || '').trim().toLowerCase())
