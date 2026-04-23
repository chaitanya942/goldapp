import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  try {
    if (action === 'roles') {
      const { data, error } = await supabase.from('roles').select('*').order('created_at')
      if (error) throw error
      return Response.json({ roles: data })
    }

    if (action === 'all') {
      const [{ data: roles, error: re }, { data: perms, error: pe }] = await Promise.all([
        supabase.from('roles').select('*').order('created_at'),
        supabase.from('role_permissions').select('role_name, permission_key, enabled'),
      ])
      if (re) throw re
      if (pe) throw pe
      return Response.json({ roles: roles || [], permissions: perms || [] })
    }

    if (action === 'my_permissions') {
      const role = searchParams.get('role')
      if (!role) return Response.json({ error: 'role required' }, { status: 400 })
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission_key, enabled')
        .eq('role_name', role)
      if (error) throw error
      return Response.json({ permissions: data || [] })
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'create_role') {
      const { name, label, color } = body
      if (!name || !label) return Response.json({ error: 'name and label required' }, { status: 400 })
      const safeName = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      if (!safeName) return Response.json({ error: 'Invalid name' }, { status: 400 })
      const { error } = await supabase.from('roles').insert({
        name: safeName, label: label.trim(), color: color || '#7a6a4a', is_system: false,
      })
      if (error) throw error
      return Response.json({ success: true, name: safeName })
    }

    if (action === 'update_role') {
      const { name, label, color } = body
      const { error } = await supabase.from('roles').update({ label, color }).eq('name', name)
      if (error) throw error
      return Response.json({ success: true })
    }

    if (action === 'delete_role') {
      const { name } = body
      const { data: role } = await supabase.from('roles').select('is_system').eq('name', name).single()
      if (role?.is_system) return Response.json({ error: 'Cannot delete system roles' }, { status: 400 })
      const { error } = await supabase.from('roles').delete().eq('name', name)
      if (error) throw error
      return Response.json({ success: true })
    }

    if (action === 'save_permissions') {
      const { role_name, permissions } = body  // permissions: [{ key, enabled }]
      if (!role_name || !Array.isArray(permissions)) {
        return Response.json({ error: 'role_name and permissions[] required' }, { status: 400 })
      }
      // DELETE all existing rows for this role, then INSERT fresh —
      // ensures stale keys from old schema versions never leak permissions
      const { error: delErr } = await supabase
        .from('role_permissions')
        .delete()
        .eq('role_name', role_name)
      if (delErr) throw delErr

      const rows = permissions.map(p => ({
        role_name,
        permission_key: p.key,
        enabled: !!p.enabled,
      }))
      if (rows.length > 0) {
        const { error } = await supabase.from('role_permissions').insert(rows)
        if (error) throw error
      }
      return Response.json({ success: true })
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
