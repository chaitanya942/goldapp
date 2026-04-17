-- Run this in Supabase SQL editor (Settings → SQL Editor)
-- Replaces the 13-chunk client-side fetch with a single server-side aggregation call.
-- Output shapes are identical to what PurchaseReports.js currently computes in JS.

CREATE OR REPLACE FUNCTION get_purchase_aggregates(
  p_from_date       TEXT,
  p_to_date         TEXT,
  p_branch          TEXT    DEFAULT NULL,
  p_txn_type        TEXT    DEFAULT NULL,
  p_region_branches TEXT[]  DEFAULT NULL,
  p_single_day      BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(

    -- ── 1. KPIs ────────────────────────────────────────────────────────────────
    'kpis', (
      SELECT jsonb_build_object(
        'total_count',            COUNT(*),
        'total_gross',            ROUND(COALESCE(SUM(gross_weight),0)::NUMERIC, 3),
        'total_net',              ROUND(COALESCE(SUM(net_weight),0)::NUMERIC, 3),
        'avg_purity',             CASE WHEN SUM(net_weight)>0
                                    THEN ROUND((SUM(net_weight*purity)/SUM(net_weight))::NUMERIC,6)
                                    ELSE 0 END,
        'total_value',            ROUND(COALESCE(SUM(total_amount),0)::NUMERIC, 2),
        'avg_service_charge_pct', ROUND(COALESCE(AVG(service_charge_pct),0)::NUMERIC, 6),
        'business_days',          COUNT(DISTINCT purchase_date),
        'branch_count',           COUNT(DISTINCT branch_name),
        'avg_net_per_txn',        CASE WHEN COUNT(*)>0
                                    THEN ROUND((SUM(net_weight)/COUNT(*))::NUMERIC,6)
                                    ELSE 0 END,
        'avg_rate_per_gram',      CASE WHEN SUM(net_weight)>0
                                    THEN ROUND((SUM(total_amount)/SUM(net_weight))::NUMERIC,2)
                                    ELSE 0 END,
        'stone_wastage_pct',      CASE WHEN SUM(gross_weight)>0
                                    THEN ROUND((SUM(stone_weight+wastage)/SUM(gross_weight)*100)::NUMERIC,6)
                                    ELSE 0 END,
        'avg_stone_wastage_bill', CASE WHEN COUNT(*)>0
                                    THEN ROUND((SUM(stone_weight+wastage)/COUNT(*))::NUMERIC,6)
                                    ELSE 0 END,
        'physical_count',         COUNT(*) FILTER (WHERE transaction_type='PHYSICAL'),
        'takeover_count',         COUNT(*) FILTER (WHERE transaction_type='TAKEOVER'),
        'physical_net',           ROUND(COALESCE(SUM(net_weight)   FILTER (WHERE transaction_type='PHYSICAL'),0)::NUMERIC,3),
        'takeover_net',           ROUND(COALESCE(SUM(net_weight)   FILTER (WHERE transaction_type='TAKEOVER'),0)::NUMERIC,3),
        'physical_value',         ROUND(COALESCE(SUM(total_amount) FILTER (WHERE transaction_type='PHYSICAL'),0)::NUMERIC,2),
        'takeover_value',         ROUND(COALESCE(SUM(total_amount) FILTER (WHERE transaction_type='TAKEOVER'),0)::NUMERIC,2),
        'min_date',               MIN(purchase_date)::TEXT,
        'max_date',               MAX(purchase_date)::TEXT
      )
      FROM purchases
      WHERE crm_status='approved' AND is_deleted=false
        AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
        AND (p_branch IS NULL OR branch_name=p_branch)
        AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
        AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
    ),

    -- ── 2. Daily trend ─────────────────────────────────────────────────────────
    'trend', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'day',        purchase_date::TEXT,
          'txn_count',  cnt,
          'net_wt',     net_wt,
          'value',      val,
          'avg_purity', avg_purity
        ) ORDER BY purchase_date
      ), '[]')
      FROM (
        SELECT purchase_date,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)  AS net_wt,
          ROUND(SUM(total_amount)::NUMERIC,0) AS val,
          CASE WHEN SUM(net_weight)>0
            THEN ROUND((SUM(net_weight*purity)/SUM(net_weight))::NUMERIC,2) ELSE 0 END AS avg_purity
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY purchase_date
      ) t
    ),

    -- ── 3. Monthly ─────────────────────────────────────────────────────────────
    'monthly', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'month',          month,
          'txn_count',      cnt,
          'physical_count', phys,
          'takeover_count', tako,
          'total_gross',    gw,
          'total_net',      nw,
          'total_value',    val,
          'avg_purity',     avg_purity,
          'avg_per_txn',    avg_per_txn
        ) ORDER BY month DESC
      ), '[]')
      FROM (
        SELECT TO_CHAR(purchase_date,'YYYY-MM') AS month,
          COUNT(*) AS cnt,
          COUNT(*) FILTER (WHERE transaction_type='PHYSICAL') AS phys,
          COUNT(*) FILTER (WHERE transaction_type='TAKEOVER') AS tako,
          ROUND(SUM(gross_weight)::NUMERIC,3) AS gw,
          ROUND(SUM(net_weight)::NUMERIC,3)   AS nw,
          ROUND(SUM(total_amount)::NUMERIC,0)  AS val,
          CASE WHEN SUM(net_weight)>0
            THEN ROUND((SUM(net_weight*purity)/SUM(net_weight))::NUMERIC,2) ELSE 0 END AS avg_purity,
          CASE WHEN COUNT(*)>0
            THEN ROUND((SUM(net_weight)/COUNT(*))::NUMERIC,3) ELSE 0 END AS avg_per_txn
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY month
      ) t
    ),

    -- ── 4. Branch data (joined with branches table for region/state/cluster) ───
    'branches', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'branch_name',    branch_name,
          'region',         region,
          'state',          state,
          'cluster',        cluster,
          'txn_count',      cnt,
          'physical_count', phys,
          'takeover_count', tako,
          'total_gross',    gw,
          'total_net',      nw,
          'total_value',    val,
          'avg_purity',     avg_purity
        ) ORDER BY nw DESC
      ), '[]')
      FROM (
        SELECT p.branch_name,
          COALESCE(b.region,'Unknown')  AS region,
          COALESCE(b.state,'Unknown')   AS state,
          b.cluster,
          COUNT(*) AS cnt,
          COUNT(*) FILTER (WHERE p.transaction_type='PHYSICAL') AS phys,
          COUNT(*) FILTER (WHERE p.transaction_type='TAKEOVER') AS tako,
          ROUND(SUM(p.gross_weight)::NUMERIC,3) AS gw,
          ROUND(SUM(p.net_weight)::NUMERIC,3)   AS nw,
          ROUND(SUM(p.total_amount)::NUMERIC,0)  AS val,
          CASE WHEN SUM(p.net_weight)>0
            THEN ROUND((SUM(p.net_weight*p.purity)/SUM(p.net_weight))::NUMERIC,2) ELSE 0 END AS avg_purity
        FROM purchases p
        LEFT JOIN branches b ON b.name=p.branch_name
        WHERE p.crm_status='approved' AND p.is_deleted=false
          AND p.purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR p.branch_name=p_branch)
          AND (p_txn_type IS NULL OR p.transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR p.branch_name=ANY(p_region_branches))
        GROUP BY p.branch_name, b.region, b.state, b.cluster
      ) t
    ),

    -- ── 5. Day of week ──────────────────────────────────────────────────────────
    'dow', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('dow',dow,'txn_count',cnt,'net_wt',nw) ORDER BY dow
      ), '[]')
      FROM (
        SELECT EXTRACT(DOW FROM purchase_date)::INT AS dow,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3) AS nw
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY dow
      ) t
    ),

    -- ── 6. Purity distribution ──────────────────────────────────────────────────
    'purity_dist', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'bucket',bucket,'count',cnt,'net_wt',nw,'total_value',val,'avg_service_charge',avg_svc
        ) ORDER BY sort_order
      ), '[]')
      FROM (
        SELECT
          CASE
            WHEN purity<70  THEN '< 70%'
            WHEN purity<75  THEN '70–75%'
            WHEN purity<80  THEN '75–80%'
            WHEN purity<85  THEN '80–85%'
            WHEN purity<90  THEN '85–90%'
            WHEN purity<95  THEN '90–95%'
            ELSE '≥ 95%'
          END AS bucket,
          CASE WHEN purity<70 THEN 1 WHEN purity<75 THEN 2 WHEN purity<80 THEN 3
               WHEN purity<85 THEN 4 WHEN purity<90 THEN 5 WHEN purity<95 THEN 6 ELSE 7 END AS sort_order,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)       AS nw,
          ROUND(SUM(total_amount)::NUMERIC,0)      AS val,
          ROUND(AVG(service_charge_pct)::NUMERIC,2) AS avg_svc
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY bucket, sort_order
      ) t
    ),

    -- ── 7. Weight buckets ───────────────────────────────────────────────────────
    'weight_buckets', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'bucket',bucket,'count',cnt,'total_net',nw,'avg_purity',avg_purity,'avg_service_charge',avg_svc
        ) ORDER BY sort_order
      ), '[]')
      FROM (
        SELECT
          CASE
            WHEN net_weight<5   THEN '< 5g'
            WHEN net_weight<10  THEN '5–10g'
            WHEN net_weight<20  THEN '10–20g'
            WHEN net_weight<30  THEN '20–30g'
            WHEN net_weight<50  THEN '30–50g'
            WHEN net_weight<100 THEN '50–100g'
            ELSE '≥ 100g'
          END AS bucket,
          CASE WHEN net_weight<5 THEN 1 WHEN net_weight<10 THEN 2 WHEN net_weight<20 THEN 3
               WHEN net_weight<30 THEN 4 WHEN net_weight<50 THEN 5 WHEN net_weight<100 THEN 6 ELSE 7 END AS sort_order,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)  AS nw,
          CASE WHEN SUM(net_weight)>0
            THEN ROUND((SUM(net_weight*purity)/SUM(net_weight))::NUMERIC,2) ELSE 0 END AS avg_purity,
          ROUND(AVG(service_charge_pct)::NUMERIC,2) AS avg_svc
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY bucket, sort_order
      ) t
    ),

    -- ── 8. Region split ─────────────────────────────────────────────────────────
    'region_split', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'region',region,'total_txns',total_txns,
          'physical_count',phys,'takeover_count',tako,
          'total_net',nw,'avg_service_charge',avg_svc
        ) ORDER BY total_txns DESC
      ), '[]')
      FROM (
        SELECT COALESCE(b.region,'Unknown') AS region,
          COUNT(*) AS total_txns,
          COUNT(*) FILTER (WHERE p.transaction_type='PHYSICAL') AS phys,
          COUNT(*) FILTER (WHERE p.transaction_type='TAKEOVER') AS tako,
          ROUND(SUM(p.net_weight)::NUMERIC,3)       AS nw,
          ROUND(AVG(p.service_charge_pct)::NUMERIC,2) AS avg_svc
        FROM purchases p
        LEFT JOIN branches b ON b.name=p.branch_name
        WHERE p.crm_status='approved' AND p.is_deleted=false
          AND p.purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR p.branch_name=p_branch)
          AND (p_txn_type IS NULL OR p.transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR p.branch_name=ANY(p_region_branches))
        GROUP BY b.region
      ) t
    ),

    -- ── 9. Month half ───────────────────────────────────────────────────────────
    'month_half', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'half',half,'txn_count',cnt,'total_net',nw,'avg_service_charge',avg_svc
        ) ORDER BY sort_order
      ), '[]')
      FROM (
        SELECT
          CASE WHEN EXTRACT(DAY FROM purchase_date)<=15 THEN 'First Half' ELSE 'Second Half' END AS half,
          CASE WHEN EXTRACT(DAY FROM purchase_date)<=15 THEN 1 ELSE 2 END AS sort_order,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)       AS nw,
          ROUND(AVG(service_charge_pct)::NUMERIC,2) AS avg_svc
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY half, sort_order
      ) t
    ),

    -- ── 10. Time of day (morning/afternoon/evening/unknown slots) ───────────────
    'time_of_day', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'slot_key',slot_key,'cnt',cnt,'nw',nw,'val',val,'pw',pw,'svc',svc
        )
      ), '[]')
      FROM (
        SELECT
          CASE
            WHEN transaction_time IS NULL THEN 'unknown'
            WHEN EXTRACT(HOUR FROM transaction_time) BETWEEN 9  AND 11 THEN 'morning'
            WHEN EXTRACT(HOUR FROM transaction_time) BETWEEN 12 AND 16 THEN 'afternoon'
            WHEN EXTRACT(HOUR FROM transaction_time) BETWEEN 17 AND 23 THEN 'evening'
            ELSE 'unknown'
          END AS slot_key,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)        AS nw,
          ROUND(SUM(total_amount)::NUMERIC,0)       AS val,
          ROUND(SUM(net_weight*purity)::NUMERIC,4)  AS pw,
          ROUND(SUM(service_charge_pct)::NUMERIC,4) AS svc
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY slot_key
      ) t
    ),

    -- ── 11. Top 20 bills by net weight ──────────────────────────────────────────
    'top_bills', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'branch_name',branch_name,'customer_name',customer_name,'region',region,
          'net_weight',net_weight,'gross_weight',gross_weight,'purity',purity,
          'total_amount',total_amount,'transaction_type',transaction_type,
          'purchase_date',purchase_date::TEXT
        )
      ), '[]')
      FROM (
        SELECT p.branch_name, p.customer_name, COALESCE(b.region,null) AS region,
          p.net_weight, p.gross_weight, p.purity, p.total_amount,
          p.transaction_type, p.purchase_date
        FROM purchases p
        LEFT JOIN branches b ON b.name=p.branch_name
        WHERE p.crm_status='approved' AND p.is_deleted=false
          AND p.purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND (p_branch IS NULL OR p.branch_name=p_branch)
          AND (p_txn_type IS NULL OR p.transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR p.branch_name=ANY(p_region_branches))
        ORDER BY p.net_weight DESC
        LIMIT 20
      ) t
    ),

    -- ── 12. Hourly trend (only when single day) ──────────────────────────────────
    'hourly_trend', (
      SELECT CASE WHEN p_single_day THEN COALESCE(jsonb_agg(
        jsonb_build_object('hour',hour,'txn_count',cnt,'net_wt',nw,'value',val) ORDER BY hour
      ), '[]') ELSE '[]' END
      FROM (
        SELECT
          EXTRACT(HOUR FROM transaction_time)::INT AS hour,
          COUNT(*) AS cnt,
          ROUND(SUM(net_weight)::NUMERIC,3)  AS nw,
          ROUND(SUM(total_amount)::NUMERIC,0) AS val
        FROM purchases
        WHERE crm_status='approved' AND is_deleted=false
          AND p_single_day=TRUE
          AND purchase_date BETWEEN p_from_date::DATE AND p_to_date::DATE
          AND transaction_time IS NOT NULL
          AND (p_branch IS NULL OR branch_name=p_branch)
          AND (p_txn_type IS NULL OR transaction_type=p_txn_type)
          AND (p_region_branches IS NULL OR branch_name=ANY(p_region_branches))
        GROUP BY hour
      ) t
    )

  );
$$;
