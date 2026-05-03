// lib/consignmentTheme.js
// Single source of truth for the visual theme + useMobile hook used across
// the consignment AND purchase modules. Originally extracted from the
// consignment audit — the same THEMES/useMobile copy-paste exists across
// all purchase pages too. Kept this filename for compatibility with
// existing imports; an alias `APP_THEMES` is exported for callers that
// don't want the consignment-flavoured name.

import { useState, useEffect } from 'react'

export const CONSIGNMENT_THEMES = {
  dark: {
    bg:      '#0a0a0a',
    card:    '#111111',
    card2:   '#161616',
    card3:   '#1d1c19',
    text1:   '#f0e6c8',
    text2:   '#c8b89a',
    text3:   '#9a8a6a',
    text4:   '#6a5a3a',
    gold:    '#c9a84c',
    border:  '#1e1e1e',
    border2: '#252525',
    green:   '#3aaa6a',
    red:     '#e05555',
    blue:    '#3a8fbf',
    orange:  '#c9981f',
    purple:  '#8c5ac8',
  },
  light: {
    bg:      '#f5f0e8',
    card:    '#faf7f2',
    card2:   '#e0d9cc',
    card3:   '#ede5d8',
    text1:   '#1a1208',
    text2:   '#3a2a10',
    text3:   '#7a6a4a',
    text4:   '#9a8a6a',
    gold:    '#9a7228',
    border:  '#e0dace',
    border2: '#c5bca8',
    green:   '#2a8a5a',
    red:     '#c03030',
    blue:    '#2a6a9a',
    orange:  '#a07010',
    purple:  '#6a3a9a',
  },
}

export const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
  'Tamil Nadu':        '#c9981f',
  'Bangalore':         '#c9a84c',
}

// Returns true on viewports < 768px. Listens for resize. Used everywhere we
// need to toggle layout between desktop and mobile.
export function useMobile(breakpoint = 768) {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return m
}
