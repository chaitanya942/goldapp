'use client'

// components/admin/HeatmapInsights.js
//
// Heatmap & session-replay analytics powered by Microsoft Clarity.
// This module is the single place to:
//   - See which Clarity projects are wired up (one per app: GoldApp, Treasury, Telesales, etc.)
//   - Copy the paste-ready tracking snippet for each tool
//   - Jump to the Clarity dashboard (heatmaps live there — Microsoft hosts the rendering)
//   - Manage / add new projects
//
// Why not host heatmaps inside goldapp? Clarity dashboard is far more capable than
// anything we'd build in 3-4 weeks (heatmaps + session replay + rage-clicks + funnels).
// We keep the project registry here so non-admins know what's tracked, and so
// switching tools doesn't lose institutional knowledge of where to look.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import HeatmapViewer from './HeatmapViewer'

const PROJECT_TABLE = 'heatmap_projects'

const SAMPLE_PROJECTS = [
  // Default seed — overridden by DB rows once table is populated
  {
    id:           'goldapp',
    name:         'GoldApp',
    description:  'Main goldapp portal (Branch Stock, Consignments, Reports, Approvals)',
    project_id:   process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || '',
    is_internal:  true,  // wired into this app already
  },
]

function buildSnippet(clarityProjectId, opts = {}) {
  const { appName = 'YourApp', identifyUser = true } = opts
  return `<!-- Heatmap & session-replay tracking — Microsoft Clarity, configured by WhiteGold/GoldApp.
     Paste this into the <head> of every page on ${appName}. Sensitive data
     (form inputs, customer names, amounts, GSTINs) is auto-masked before transmission. -->
<script>
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "${clarityProjectId}");

  // PII masking — these selectors are blurred in session replay before transmission.
  ;(function applyMasks(){
    var c = window.clarity;
    if (!c) return setTimeout(applyMasks, 200);
    var maskSel = [
      'input[type="text"]','input[type="email"]','input[type="tel"]','input[type="password"]',
      'textarea',
      '.pii','.sensitive',
      '[data-customer-name]','[data-phone]','[data-pan]','[data-gstin]','[data-amount]'
    ];
    var unmaskSel = ['button','[role="button"]','h1','h2','h3','h4','.unmask'];
    maskSel.forEach(function(s){ try{ c('mask', s) }catch(e){} });
    unmaskSel.forEach(function(s){ try{ c('unmask', s) }catch(e){} });
  })();
${identifyUser ? `
  // OPTIONAL: identify the signed-in user. Set window.__APP_USER = { id, name, role }
  // before this script (or call clarity('identify', userId) after auth resolves).
  ;(function identify(){
    var c = window.clarity;
    if (!c) return setTimeout(identify, 500);
    var u = window.__APP_USER;
    if (u && u.id) {
      try { c('identify', u.id, undefined, undefined, u.name || u.email || u.id) } catch(e){}
      if (u.role)   try { c('set', 'role', String(u.role)) } catch(e){}
      if (u.region) try { c('set', 'region', String(u.region)) } catch(e){}
    }
  })();
` : ''}</script>`
}

export default function HeatmapInsights() {
  const { theme, role } = useApp()
  const t = THEMES[theme]
  const isAdmin = role === 'super_admin' || role === 'founders_office' || role === 'admin'

  const [projects,  setProjects]  = useState(SAMPLE_PROJECTS)
  const [loading,   setLoading]   = useState(false)
  const [editing,   setEditing]   = useState(null)   // project being edited or { new: true }
  const [copiedFor, setCopiedFor] = useState(null)
  const [includeIdentify, setIncludeIdentify] = useState(true)
  const [tab,       setTab]       = useState('viewer')  // 'viewer' | 'projects'

  const goldAppProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from(PROJECT_TABLE).select('*').order('name')
      if (error) {
        // Table may not exist yet — fall back to seed list. Admin can run the SQL when ready.
        console.warn('[HeatmapInsights] heatmap_projects table not found — using seed list. Apply sql/heatmap_projects.sql.', error.message)
        setProjects(SAMPLE_PROJECTS)
      } else {
        // Always include the goldapp entry (synthetic, from env var) at top, then DB rows.
        const live = (data || []).filter(p => p.id !== 'goldapp')
        setProjects([{ ...SAMPLE_PROJECTS[0], project_id: goldAppProjectId || '' }, ...live])
      }
    } catch (e) {
      console.warn('[HeatmapInsights] load failed', e.message)
    }
    setLoading(false)
  }

  async function saveProject(p) {
    if (!p.id || !p.name) return
    const payload = {
      id:          p.id,
      name:        p.name,
      description: p.description || null,
      project_id:  p.project_id  || null,
      is_internal: !!p.is_internal,
    }
    const { error } = await supabase.from(PROJECT_TABLE).upsert(payload).eq('id', p.id)
    if (error) {
      alert('Save failed: ' + error.message + '\n\nApply sql/heatmap_projects.sql first.')
      return
    }
    setEditing(null)
    load()
  }

  async function deleteProject(id) {
    if (id === 'goldapp') { alert('GoldApp is wired into the app code — cannot delete from here.'); return }
    if (!window.confirm(`Remove project "${id}" from registry?`)) return
    const { error } = await supabase.from(PROJECT_TABLE).delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  function copyToClipboard(text, key) {
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedFor(key)
        setTimeout(() => setCopiedFor(null), 2000)
      })
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
      setCopiedFor(key)
      setTimeout(() => setCopiedFor(null), 2000)
    }
  }

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 22px' }
  const inp  = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 12px', color: t.text1, fontSize: '.78rem', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const btn  = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '8px 18px', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer' }
  const btnGhost = { background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 14px', fontSize: '.7rem', cursor: 'pointer' }

  return (
    <div style={{ padding: '32px', maxWidth: '1100px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '5px' }}>Analytics</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em' }}>Heatmap Insights</div>
          <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '6px', maxWidth: '720px', lineHeight: 1.5 }}>
            In-app heatmaps from our own tracker, plus session replay via Microsoft Clarity for the full picture.
            Each tool gets its own project; paste the snippet to add tracking.
          </div>
        </div>
        {isAdmin && tab === 'projects' && (
          <button onClick={() => setEditing({ new: true, id: '', name: '', description: '', project_id: '', is_internal: false })} style={btn}>
            + Add tool
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '4px', padding: '5px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px', alignSelf: 'flex-start', marginBottom: '16px', width: 'fit-content' }}>
        {[
          { key: 'viewer',   label: 'Heatmap Viewer',  hint: 'In-app click heatmaps' },
          { key: 'projects', label: 'Projects & Snippets', hint: 'Manage tools + Clarity setup' },
        ].map(m => {
          const active = tab === m.key
          return (
            <button key={m.key} onClick={() => setTab(m.key)} title={m.hint}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: active ? t.gold : 'transparent', color: active ? '#0a0a0a' : t.text3, fontSize: '12px', fontWeight: active ? 600 : 400, letterSpacing: '.04em' }}>
              {m.label}
            </button>
          )
        })}
      </div>

      {/* In-app viewer (default) */}
      {tab === 'viewer' && <HeatmapViewer defaultProject="goldapp" />}

      {/* Projects + snippets section — only on the "projects" tab */}
      {tab === 'projects' && <>

      {/* Setup banner — only when goldapp's own Clarity isn't configured */}
      {!goldAppProjectId && (
        <div style={{ background: `${t.orange}15`, border: `1px solid ${t.orange}40`, borderRadius: '12px', padding: '16px 22px', marginBottom: '20px' }}>
          <div style={{ fontSize: '.85rem', color: t.orange, fontWeight: 600, marginBottom: '6px' }}>⚠ GoldApp tracking not configured</div>
          <div style={{ fontSize: '.72rem', color: t.text2, lineHeight: 1.6 }}>
            Set <code style={{ background: t.card2 || t.card, padding: '2px 6px', borderRadius: '4px' }}>NEXT_PUBLIC_CLARITY_PROJECT_ID</code> in Railway environment variables to your Clarity project ID.
            Get one at <a href="https://clarity.microsoft.com" target="_blank" rel="noopener noreferrer" style={{ color: t.gold }}>clarity.microsoft.com</a> → New Project → copy the ID from the install snippet.
          </div>
        </div>
      )}

      {/* Project list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {projects.map(p => {
          const snippet = buildSnippet(p.project_id, { appName: p.name, identifyUser: includeIdentify })
          const hasId = !!p.project_id
          const dashUrl = hasId ? `https://clarity.microsoft.com/projects/view/${p.project_id}/dashboard` : 'https://clarity.microsoft.com/'
          return (
            <div key={p.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '1rem', color: t.text1, fontWeight: 600 }}>{p.name}</span>
                    {p.is_internal && (
                      <span style={{ fontSize: '.55rem', color: t.gold, background: `${t.gold}15`, padding: '2px 8px', borderRadius: '4px', letterSpacing: '.06em' }}>WIRED IN</span>
                    )}
                    {!hasId && (
                      <span style={{ fontSize: '.55rem', color: t.red, background: `${t.red}15`, padding: '2px 8px', borderRadius: '4px', letterSpacing: '.06em' }}>NO PROJECT ID</span>
                    )}
                  </div>
                  {p.description && <div style={{ fontSize: '.7rem', color: t.text3 }}>{p.description}</div>}
                  <div style={{ fontSize: '.65rem', color: t.text4, marginTop: '4px', fontFamily: 'monospace' }}>
                    Project ID: <span style={{ color: hasId ? t.text2 : t.text4 }}>{p.project_id || '(not set)'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {hasId && (
                    <a href={dashUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>
                      Open in Clarity ↗
                    </a>
                  )}
                  {isAdmin && p.id !== 'goldapp' && (
                    <>
                      <button onClick={() => setEditing(p)} style={btnGhost}>Edit</button>
                      <button onClick={() => deleteProject(p.id)} style={{ ...btnGhost, color: t.red, borderColor: `${t.red}40` }}>Remove</button>
                    </>
                  )}
                </div>
              </div>

              {/* Snippet box */}
              {hasId ? (
                <div style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Paste-ready tracking snippet</div>
                    <button onClick={() => copyToClipboard(snippet, p.id)} style={{ ...btn, padding: '5px 12px', fontSize: '.62rem' }}>
                      {copiedFor === p.id ? '✓ Copied' : '📋 Copy snippet'}
                    </button>
                  </div>
                  <pre style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'monospace', margin: 0, padding: '10px 12px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', maxHeight: '260px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{snippet}</pre>
                </div>
              ) : (
                <div style={{ fontSize: '.7rem', color: t.text3, padding: '10px 0' }}>
                  Click <strong>Edit</strong> to enter a Clarity Project ID for this tool, then the snippet appears here.
                </div>
              )}
            </div>
          )
        })}
        {projects.length === 0 && !loading && (
          <div style={{ ...card, textAlign: 'center', padding: '40px', color: t.text4, fontSize: '.8rem' }}>
            No tools registered yet. Click "Add tool" to register your first one.
          </div>
        )}
      </div>

      {/* Snippet options */}
      <div style={{ ...card, marginTop: '20px', padding: '14px 18px' }}>
        <div style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Snippet options</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '.72rem', color: t.text2, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeIdentify} onChange={e => setIncludeIdentify(e.target.checked)} />
          Include user-identification block (calls <code style={{ fontSize: '.68rem' }}>clarity('identify', ...)</code> from <code style={{ fontSize: '.68rem' }}>window.__APP_USER</code> if set)
        </label>
      </div>

      {/* Help */}
      <div style={{ ...card, marginTop: '20px' }}>
        <div style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>Quick reference</div>
        <ol style={{ fontSize: '.72rem', color: t.text2, lineHeight: 1.8, marginLeft: '18px', padding: 0 }}>
          <li>Create a <a href="https://clarity.microsoft.com" target="_blank" rel="noopener noreferrer" style={{ color: t.gold }}>Clarity project</a> per tool you want to track</li>
          <li>Click <strong>Add tool</strong> above and paste the project ID</li>
          <li>Copy the generated snippet → paste in the <code>{'<head>'}</code> of that tool</li>
          <li>Wait 1-2 hours for first sessions to register, then click <strong>Open in Clarity</strong> to view heatmaps</li>
          <li>For user-level filtering: in your tool, set <code>{'window.__APP_USER = { id, name, role }'}</code> before the snippet, OR call <code>{`window.clarity('identify', userId)`}</code> after auth</li>
        </ol>
      </div>

      </>}

      {/* Edit / new modal */}
      {editing && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '20px 24px' }}>
            <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 600, marginBottom: '14px' }}>
              {editing.new ? 'Add tracking project' : `Edit "${editing.name}"`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Field t={t} label="Slug (unique key)" required disabled={!editing.new}
                value={editing.id} onChange={v => setEditing({ ...editing, id: v.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}
                placeholder="e.g. treasury-app" inp={inp} />
              <Field t={t} label="Display name" required
                value={editing.name} onChange={v => setEditing({ ...editing, name: v })}
                placeholder="e.g. Treasury App" inp={inp} />
              <Field t={t} label="Description"
                value={editing.description || ''} onChange={v => setEditing({ ...editing, description: v })}
                placeholder="Short description of what this tool does" inp={inp} />
              <Field t={t} label="Clarity Project ID" required
                value={editing.project_id || ''} onChange={v => setEditing({ ...editing, project_id: v.trim() })}
                placeholder="e.g. abc123xyz" inp={inp}
                hint="Get from clarity.microsoft.com → Project → Setup → Install Tracking Code (the string in clarity.ms/tag/XXXX)" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setEditing(null)} style={btnGhost}>Cancel</button>
              <button onClick={() => saveProject(editing)} disabled={!editing.id || !editing.name} style={{ ...btn, opacity: (!editing.id || !editing.name) ? .5 : 1 }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ t, label, value, onChange, placeholder, hint, required, disabled, inp }) {
  return (
    <div>
      <div style={{ fontSize: '.6rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        {label}{required && <span style={{ color: t.gold }}> *</span>}
      </div>
      <input style={{ ...inp, opacity: disabled ? 0.6 : 1 }} disabled={disabled}
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}
