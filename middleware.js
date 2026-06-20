import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function middleware(request) {
  // ── MDM portal — served on its OWN domain at the root (no /mdm in the URL) ──
  // The MDM pages physically live at /mdm/*. On the MDM domain we transparently
  // render them at the root, and redirect any explicit /mdm prefix back to the
  // clean path. On the main (GoldApp) domain we bounce /mdm/* to the MDM domain
  // so there's one canonical, clean URL. (DevOps points mdm-prod.up.railway.app
  // at this same Railway service; everything else is host-based routing here.)
  const host = (request.headers.get('host') || '').toLowerCase()
  const MDM_HOSTS = (process.env.MDM_HOSTS || 'mdm-prod.up.railway.app')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  {
    const { pathname, search } = request.nextUrl
    if (MDM_HOSTS.includes(host)) {
      if (pathname === '/mdm' || pathname.startsWith('/mdm/')) {
        const url = request.nextUrl.clone()
        url.pathname = pathname.replace(/^\/mdm/, '') || '/'
        return NextResponse.redirect(url)                        // strip /mdm → clean URL
      }
      const url = request.nextUrl.clone()
      url.pathname = '/mdm' + (pathname === '/' ? '' : pathname)  // render the MDM page
      return NextResponse.rewrite(url)
    }
    if (pathname === '/mdm' || pathname.startsWith('/mdm/')) {
      const clean = pathname.replace(/^\/mdm/, '') || '/'
      return NextResponse.redirect(`https://${MDM_HOSTS[0]}${clean}${search || ''}`)
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL     || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write updated cookies to both the request and the response so the
          // refreshed session token is forwarded to the browser.
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value, options)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the session with Supabase's server — more secure than getSession()
  // which only reads from the local cookie without server verification.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // ── Route guards ─────────────────────────────────────────────────────────────

  // No session → kick to login
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Has session → skip login page, go straight to dashboard
  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals, static assets, and API routes
    '/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\..*).*)',
  ],
}
