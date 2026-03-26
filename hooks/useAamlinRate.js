'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAamlinRate() {
  const [rate, setRate]     = useState(null)
  const [status, setStatus] = useState('connecting')
  const lastSaved           = useRef(0)

  useEffect(() => {
    let active    = true
    let socketRef = null

    async function connect() {
      try {
        const { io } = await import('socket.io-client')

        const socket = io('https://starlinebulltech.in:10001', {
          path: '/socket.io/',
          transports: ['polling'],
          extraHeaders: {
            Origin: 'http://www.aamlinspot.in',
          },
        })

        socketRef = socket

        socket.on('connect', () => {
          if (!active) return
          console.log('[Aamlin] ✅ Browser connected')
          socket.emit('join', 'aamlinspot')
          setStatus('live')
        })

        socket.on('message', (data) => {
          if (!active) return
          try {
            const rateArr = data?.Rate || []
            const gold = rateArr.find((r) => r.Symbol === 'Gold 999 IND')
            if (!gold) return

            const parsed = Number(gold.Ask)
            if (!parsed || isNaN(parsed)) return

            setRate(parsed)

            // Save at most once per 60 seconds
            const now = Date.now()
            if (now - lastSaved.current >= 60_000) {
              lastSaved.current = now
              saveToSupabase(parsed)
            }
          } catch (e) {
            console.error('[Aamlin] parse error', e)
          }
        })

        socket.on('connect_error', (err) => {
          if (!active) return
          console.error('[Aamlin] ❌ connect_error:', err.message)
          setStatus('error')
          setTimeout(() => { if (active) connect() }, 5000)
        })

        socket.on('disconnect', () => {
          if (!active) return
          console.log('[Aamlin] disconnected — retrying in 5s')
          setStatus('connecting')
          setTimeout(() => { if (active) connect() }, 5000)
        })

      } catch (e) {
        console.error('[Aamlin] connect() threw:', e)
        setStatus('error')
        setTimeout(() => { if (active) connect() }, 5000)
      }
    }

    connect()

    return () => {
      active = false
      socketRef?.disconnect()
    }
  }, [])

  async function saveToSupabase(aamlinRate) {
    try {
      // Get the most recent row inserted by Railway
      const { data, error: fetchErr } = await supabase
        .from('gold_rates')
        .select('id')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single()

      if (fetchErr || !data) {
        // No row yet — insert one
        const { error } = await supabase.from('gold_rates').insert([{
          fetched_at:        new Date().toISOString(),
          aamlin_sell_rate:  aamlinRate,
          ambica_sell_rate:  null,
          kalinga_sell_rate: null,
        }])
        if (error) console.error('[Aamlin] insert error:', error.message)
        else console.log('[Aamlin] ✅ Inserted new row:', aamlinRate)
        return
      }

      // Update the latest row
      const { error } = await supabase
        .from('gold_rates')
        .update({ aamlin_sell_rate: aamlinRate })
        .eq('id', data.id)

      if (error) console.error('[Aamlin] update error:', error.message)
      else console.log('[Aamlin] ✅ Updated row', data.id, '→', aamlinRate)
    } catch (e) {
      console.error('[Aamlin] saveToSupabase failed:', e)
    }
  }

  return { rate, status }
}