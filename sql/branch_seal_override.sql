-- Per-branch "next tamper-proof seal" override.
--
-- Background: generateTmpPrfNo() issues max(non-cancelled tmp_prf) + 1 per branch.
-- That counter is monotonic — a seed row can push it FORWARD but never back. Ops
-- needs to point the next seal at ANY unused number (forward or backward), e.g. to
-- reuse 113 after a consignment that took 112 was cancelled.
--
-- This column holds an explicit one-shot "next" for the branch:
--   NULL              -> use the default (last used + 1)
--   <integer N>       -> the next consignment issues WG{N padded}, then the column
--                        is cleared back to NULL (consumed).
-- Setting it is validated server-side: N must not already be used by a live
-- (non-cancelled, non-seed) consignment of that branch.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS next_seal_override integer;

COMMENT ON COLUMN branches.next_seal_override IS
  'One-shot next tamper-proof seal number for this branch (NULL = default last+1). Consumed on the next consignment. Set via /api/branch-tamper.';
