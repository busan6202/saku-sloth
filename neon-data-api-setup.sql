CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.transactions (
    id SERIAL PRIMARY KEY,
    "desc" TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    type VARCHAR(20) NOT NULL,
    category VARCHAR(100) DEFAULT 'Umum',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.telegram_processed_updates (
    update_id BIGINT PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.monthly_budgets (
    id SERIAL PRIMARY KEY,
    month CHAR(7) NOT NULL,
    category VARCHAR(100) NOT NULL,
    limit_amount NUMERIC NOT NULL CHECK (limit_amount > 0),
    UNIQUE (month, category)
);

CREATE TABLE IF NOT EXISTS public.savings_goals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    target_amount NUMERIC NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.telegram_user_links (
    telegram_user_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.telegram_webhook_config (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    secret TEXT NOT NULL
);

INSERT INTO public.app_settings (key, value)
VALUES ('bootstrap_owner_email', 'busan6202@gmail.com')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.monthly_budgets ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.telegram_processed_updates ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.monthly_budgets DROP CONSTRAINT IF EXISTS monthly_budgets_month_category_key;

CREATE UNIQUE INDEX IF NOT EXISTS monthly_budgets_owner_month_category_idx
    ON public.monthly_budgets (user_id, month, category);
CREATE INDEX IF NOT EXISTS transactions_owner_date_idx
    ON public.transactions (user_id, date DESC);
CREATE INDEX IF NOT EXISTS savings_goals_owner_idx
    ON public.savings_goals (user_id, created_at, id);
CREATE INDEX IF NOT EXISTS telegram_user_links_owner_idx
    ON public.telegram_user_links (user_id);
CREATE INDEX IF NOT EXISTS telegram_link_codes_owner_idx
    ON public.telegram_link_codes (user_id, expires_at);

GRANT USAGE ON SCHEMA public TO authenticated, anonymous;
REVOKE ALL ON public.transactions, public.monthly_budgets, public.savings_goals,
    public.telegram_link_codes FROM PUBLIC, anonymous;
REVOKE ALL ON SEQUENCE
    public.transactions_id_seq,
    public.monthly_budgets_id_seq,
    public.savings_goals_id_seq
FROM PUBLIC, anonymous;
GRANT SELECT, INSERT, DELETE ON public.transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_budgets, public.savings_goals TO authenticated;
GRANT INSERT, DELETE ON public.telegram_link_codes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE
    public.transactions_id_seq,
    public.monthly_budgets_id_seq,
    public.savings_goals_id_seq
TO authenticated;
REVOKE ALL ON public.app_settings, public.telegram_processed_updates,
    public.telegram_user_links, public.telegram_webhook_config FROM PUBLIC, authenticated, anonymous;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_owner_policy ON public.transactions;
DO $$
DECLARE policy_row RECORD;
BEGIN
    FOR policy_row IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('transactions', 'monthly_budgets', 'savings_goals', 'telegram_link_codes')
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I',
            policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    END LOOP;
END;
$$;

CREATE POLICY transactions_owner_policy ON public.transactions
    FOR ALL TO authenticated
    USING (user_id = auth.user_id())
    WITH CHECK (user_id = auth.user_id());

DROP POLICY IF EXISTS monthly_budgets_owner_policy ON public.monthly_budgets;
CREATE POLICY monthly_budgets_owner_policy ON public.monthly_budgets
    FOR ALL TO authenticated
    USING (user_id = auth.user_id())
    WITH CHECK (user_id = auth.user_id());

DROP POLICY IF EXISTS savings_goals_owner_policy ON public.savings_goals;
CREATE POLICY savings_goals_owner_policy ON public.savings_goals
    FOR ALL TO authenticated
    USING (user_id = auth.user_id())
    WITH CHECK (user_id = auth.user_id());

DROP POLICY IF EXISTS telegram_link_codes_owner_policy ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_owner_policy ON public.telegram_link_codes
    FOR ALL TO authenticated
    USING (user_id = auth.user_id())
    WITH CHECK (user_id = auth.user_id());

CREATE OR REPLACE FUNCTION public.claim_legacy_saku_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    current_uid TEXT := auth.user_id();
    current_email TEXT := lower(COALESCE(auth.jwt() ->> 'email', ''));
    bootstrap_email TEXT;
    previous_owner TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('saku-sloth-legacy-owner'));
    SELECT lower(value) INTO bootstrap_email
    FROM public.app_settings WHERE key = 'bootstrap_owner_email';
    IF current_uid IS NULL OR current_email IS DISTINCT FROM bootstrap_email THEN
        RAISE EXCEPTION 'Only the configured bootstrap account can claim legacy data';
    END IF;
    IF COALESCE(auth.jwt() ->> 'email_verified', 'false') <> 'true' THEN
        RAISE EXCEPTION 'The bootstrap email must be verified';
    END IF;

    SELECT value INTO previous_owner
    FROM public.app_settings
    WHERE key = 'bootstrap_google_sub'
    FOR UPDATE;

    IF previous_owner IS NULL THEN
        previous_owner := current_uid;
        INSERT INTO public.app_settings (key, value)
        VALUES ('bootstrap_google_sub', current_uid);
    END IF;

    UPDATE public.transactions
    SET user_id = current_uid
    WHERE user_id IS NULL OR user_id = previous_owner;
    UPDATE public.monthly_budgets
    SET user_id = current_uid
    WHERE user_id IS NULL OR user_id = previous_owner;
    UPDATE public.savings_goals
    SET user_id = current_uid
    WHERE user_id IS NULL OR user_id = previous_owner;
    UPDATE public.telegram_user_links
    SET user_id = current_uid
    WHERE user_id IS NULL OR user_id = previous_owner;
    UPDATE public.telegram_link_codes
    SET user_id = current_uid
    WHERE user_id = previous_owner;
    UPDATE public.app_settings
    SET value = current_uid
    WHERE key = 'bootstrap_google_sub' AND value <> current_uid;

    RETURN jsonb_build_object('user_id', current_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_telegram_webhook_secret(p_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    bootstrap_email TEXT;
BEGIN
    SELECT lower(value) INTO bootstrap_email
    FROM public.app_settings WHERE key = 'bootstrap_owner_email';
    IF auth.user_id() IS NULL
       OR lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM bootstrap_email
       OR COALESCE(auth.jwt() ->> 'email_verified', 'false') <> 'true'
       OR p_secret IS NULL
       OR p_secret !~ '^[A-Za-z0-9_-]{32,256}$' THEN
        RAISE EXCEPTION 'Not authorized to configure Telegram';
    END IF;

    INSERT INTO public.telegram_webhook_config (id, secret)
    VALUES (TRUE, p_secret)
    ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_link_account(
    p_telegram_user_id TEXT,
    p_code_hash TEXT,
    p_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    linked_user_id TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;

    DELETE FROM public.telegram_link_codes
    WHERE code_hash = p_code_hash AND expires_at > NOW()
    RETURNING user_id INTO linked_user_id;

    IF linked_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.telegram_user_links (telegram_user_id, user_id, linked_at)
    VALUES (p_telegram_user_id, linked_user_id, CURRENT_TIMESTAMP)
    ON CONFLICT (telegram_user_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, linked_at = CURRENT_TIMESTAMP;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_get_user(
    p_telegram_user_id TEXT,
    p_secret TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;
    RETURN (
        SELECT user_id FROM public.telegram_user_links
        WHERE telegram_user_id = p_telegram_user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_unlink_user(
    p_telegram_user_id TEXT,
    p_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    affected INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;
    DELETE FROM public.telegram_user_links WHERE telegram_user_id = p_telegram_user_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_save_transaction(
    p_telegram_user_id TEXT,
    p_update_id BIGINT,
    p_desc TEXT,
    p_amount NUMERIC,
    p_type TEXT,
    p_category TEXT,
    p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    owner_id TEXT;
    claimed_id BIGINT;
    saved_row public.transactions%ROWTYPE;
    total_income NUMERIC;
    total_expense NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;

    SELECT user_id INTO owner_id FROM public.telegram_user_links
    WHERE telegram_user_id = p_telegram_user_id;
    IF owner_id IS NULL THEN
        RAISE EXCEPTION 'Telegram account is not linked';
    END IF;
    IF p_update_id IS NULL OR p_update_id < 0
       OR p_desc IS NULL OR length(trim(p_desc)) = 0 OR length(p_desc) > 500
       OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000
       OR p_type IS NULL OR p_type NOT IN ('income', 'expense')
       OR length(COALESCE(p_category, 'Umum')) > 100 THEN
        RAISE EXCEPTION 'Invalid Telegram transaction data';
    END IF;

    INSERT INTO public.telegram_processed_updates (update_id, user_id)
    VALUES (p_update_id, owner_id)
    ON CONFLICT (update_id) DO NOTHING
    RETURNING update_id INTO claimed_id;

    IF claimed_id IS NULL THEN
        RETURN jsonb_build_object('inserted', FALSE);
    END IF;

    INSERT INTO public.transactions ("desc", amount, type, category, user_id)
    VALUES (p_desc, p_amount, p_type, COALESCE(NULLIF(p_category, ''), 'Umum'), owner_id)
    RETURNING * INTO saved_row;

    SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)
    INTO total_income, total_expense
    FROM public.transactions
    WHERE user_id = owner_id;

    RETURN jsonb_build_object(
        'inserted', TRUE,
        'transaction', to_jsonb(saved_row),
        'income', total_income,
        'expense', total_expense
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_get_balance(
    p_telegram_user_id TEXT,
    p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    owner_id TEXT;
    total_income NUMERIC;
    total_expense NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;
    SELECT user_id INTO owner_id FROM public.telegram_user_links
    WHERE telegram_user_id = p_telegram_user_id;
    IF owner_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)
    INTO total_income, total_expense
    FROM public.transactions WHERE user_id = owner_id;
    RETURN jsonb_build_object('income', total_income, 'expense', total_expense);
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_get_history(
    p_telegram_user_id TEXT,
    p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    owner_id TEXT;
    history JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;
    SELECT user_id INTO owner_id FROM public.telegram_user_links
    WHERE telegram_user_id = p_telegram_user_id;
    IF owner_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date DESC), '[]'::jsonb)
    INTO history
    FROM (
        SELECT id, "desc", amount, type, category, date
        FROM public.transactions
        WHERE user_id = owner_id
        ORDER BY date DESC
        LIMIT 5
    ) AS t;
    RETURN history;
END;
$$;

CREATE OR REPLACE FUNCTION public.telegram_reset_transactions(
    p_telegram_user_id TEXT,
    p_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    owner_id TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.telegram_webhook_config
        WHERE id = TRUE AND secret = p_secret
    ) THEN
        RAISE EXCEPTION 'Telegram authorization failed';
    END IF;
    SELECT user_id INTO owner_id FROM public.telegram_user_links
    WHERE telegram_user_id = p_telegram_user_id;
    IF owner_id IS NULL THEN
        RETURN FALSE;
    END IF;
    DELETE FROM public.transactions WHERE user_id = owner_id;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_legacy_saku_data() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.set_telegram_webhook_secret(TEXT) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.claim_legacy_saku_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_telegram_webhook_secret(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.telegram_link_account(TEXT, TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_get_user(TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_unlink_user(TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_save_transaction(TEXT, BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_get_balance(TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_get_history(TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.telegram_reset_transactions(TEXT, TEXT) FROM PUBLIC, anonymous, authenticated;

NOTIFY pgrst, 'reload schema';
