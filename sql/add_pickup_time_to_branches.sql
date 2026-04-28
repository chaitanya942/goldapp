-- Phase A — Branch Stock polish
-- Add pickup_time column to branches table.
-- Free-form text, set per branch in Branch Management, shown in Branch Stock Overview.
-- Run this once in the Supabase SQL editor.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS pickup_time TEXT;
