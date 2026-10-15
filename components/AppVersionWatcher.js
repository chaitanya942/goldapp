'use client'

// Reloads the app when a newer build is live. The iPhone home-screen app (and
// any long-open tab) resumes from memory without reloading, so after a deploy
// it kept showing the old screens. Checked when the app comes back to the
// foreground — never mid-use, so nothing being typed is lost.

import { useEffect } from 'react'

const MY_BUILD = process.env.NEXT_PUBLIC_APP_BUILD

export default function AppVersionWatcher() {
  useEffect(() => {
    if (!MY_BUILD) return
    let checking = false
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking) return
      checking = true
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        const { build } = await res.json()
        if (build && build !== MY_BUILD) window.location.reload()
      } catch { /* offline — try again next time */ }
      checking = false
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
    }
  }, [])
  return null
}
