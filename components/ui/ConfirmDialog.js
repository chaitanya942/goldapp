'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../../lib/context'

const T = {
  dark:  { bg: '#111', border: 'rgba(201,168,76,0.3)', text1: '#f0e6c8', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', red: '#e05555', green: '#3aaa6a', blue: '#3a8fbf', card2: '#1a1a1a', input: '#0d0d0d' },
  light: { bg: '#faf7f2', border: 'rgba(154,114,40,0.4)', text1: '#1a1208', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', red: '#c03030', green: '#2a8a5a', blue: '#2a6a9a', card2: '#ede5d8', input: '#fff' },
}

// Themed replacement for window.confirm() / window.prompt(). Returns a Promise
// that resolves to:
//   - boolean for confirm dialogs
//   - string  for prompt dialogs (empty string if user cancelled, even if input had text)
//
// Usage: const ok = await openConfirm({ title, message, danger: true })
//        const reason = await openPrompt({ title, message, placeholder, minLength: 5 })
//
// We use a singleton imperative API (mounted by <DialogHost />) so callers can
// just `await openConfirm(...)` without wiring state per-component.

let _resolve = null
let _setState = null

export function openConfirm(opts) {
  return new Promise((resolve) => {
    if (!_setState) { resolve(false); return }
    _resolve = resolve
    _setState({ kind: 'confirm', ...opts })
  })
}

export function openPrompt(opts) {
  return new Promise((resolve) => {
    if (!_setState) { resolve(''); return }
    _resolve = resolve
    _setState({ kind: 'prompt', ...opts })
  })
}

export default function DialogHost() {
  const { theme } = useApp()
  const t = T[theme || 'dark']
  const [state, setState] = useState(null)
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    _setState = (s) => { setState(s); setValue(s?.defaultValue || '') }
    return () => { _setState = null }
  }, [])

  const close = useCallback((result) => {
    if (_resolve) { _resolve(result); _resolve = null }
    setState(null)
    setValue('')
  }, [])

  // Esc cancels, Enter submits.
  useEffect(() => {
    if (!state) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(state.kind === 'prompt' ? '' : false)
      } else if (e.key === 'Enter' && state.kind === 'confirm') {
        e.preventDefault()
        close(true)
      } else if (e.key === 'Enter' && state.kind === 'prompt' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, value])

  // Auto-focus the input on open (prompt) or the cancel button (confirm).
  useEffect(() => {
    if (!state) return
    const id = setTimeout(() => {
      if (state.kind === 'prompt') inputRef.current?.focus()
      else cancelRef.current?.focus()
    }, 50)
    return () => clearTimeout(id)
  }, [state])

  function submit() {
    if (state.kind === 'prompt') {
      const v = value.trim()
      if (state.minLength && v.length < state.minLength) return
      close(v)
    } else {
      close(true)
    }
  }

  if (!state) return null

  const danger = state.danger
  const primaryLabel = state.confirmLabel || (state.kind === 'prompt' ? 'Submit' : 'Confirm')
  const cancelLabel  = state.cancelLabel  || 'Cancel'
  const primaryColor = danger ? t.red : (state.primaryColor === 'green' ? t.green : state.primaryColor === 'blue' ? t.blue : t.gold)

  const minOk = state.kind !== 'prompt' || !state.minLength || value.trim().length >= state.minLength
  const remaining = state.minLength ? Math.max(0, state.minLength - value.trim().length) : 0

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-title"
      onClick={() => close(state.kind === 'prompt' ? '' : false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, animation: 'cdFade .15s ease' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(480px, calc(100vw - 32px))', background: t.bg, border: `1px solid ${t.border}`, borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', padding: '20px 22px', animation: 'cdEnter .18s ease' }}>
        {state.title && (
          <div id="confirm-title" style={{ fontSize: '15px', fontWeight: 600, color: t.text1, marginBottom: '8px' }}>
            {state.title}
          </div>
        )}
        {state.message && (
          <div style={{ fontSize: '13px', color: t.text3, marginBottom: '16px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {state.message}
          </div>
        )}
        {state.kind === 'prompt' && (
          <>
            <textarea ref={inputRef} rows={state.rows || 3} value={value} onChange={e => setValue(e.target.value)}
              placeholder={state.placeholder || ''} maxLength={state.maxLength || 500}
              style={{ width: '100%', boxSizing: 'border-box', background: t.input, color: t.text1, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: t.text4, marginTop: '4px' }}>
              <span>{state.minLength ? (remaining > 0 ? `${remaining} more character${remaining === 1 ? '' : 's'} required` : '') : ''}</span>
              <span>{value.length}{state.maxLength ? `/${state.maxLength}` : ''}</span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button ref={cancelRef} onClick={() => close(state.kind === 'prompt' ? '' : false)}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 16px', fontSize: '12px', color: t.text3, cursor: 'pointer', fontWeight: 500 }}>
            {cancelLabel}
          </button>
          <button onClick={submit} disabled={!minOk}
            style={{ background: primaryColor, color: '#fff', border: 'none', borderRadius: '7px', padding: '8px 22px', fontSize: '12px', fontWeight: 700, cursor: minOk ? 'pointer' : 'not-allowed', opacity: minOk ? 1 : 0.4 }}>
            {primaryLabel}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes cdFade  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cdEnter { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}
