-- Baybex Printers Manager — database schema (reference only; the server creates and upgrades all tables itself on start).
-- "public" = platform (tenants, plans, super admin). "tenant_schema" = one copy per business (named t_<id>).
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
CREATE SCHEMA tenant_schema;
CREATE TABLE public.platform_admins (
    id integer NOT NULL,
    username text NOT NULL,
    full_name text NOT NULL,
    password_hash text NOT NULL,
    active boolean DEFAULT true,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.platform_admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_admins_id_seq OWNED BY public.platform_admins.id;
CREATE TABLE public.platform_app_releases (
    id integer NOT NULL,
    version_code integer NOT NULL,
    version_name text NOT NULL,
    notes text,
    force_update boolean DEFAULT false,
    min_version_code integer DEFAULT 0,
    active boolean DEFAULT true,
    file_name text,
    size integer,
    sha256 text,
    apk bytea NOT NULL,
    downloads integer DEFAULT 0,
    uploaded_by text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.platform_app_releases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_app_releases_id_seq OWNED BY public.platform_app_releases.id;
CREATE TABLE public.platform_audit (
    id bigint NOT NULL,
    admin_id integer,
    admin_name text,
    action text NOT NULL,
    tenant_id integer,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.platform_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_audit_id_seq OWNED BY public.platform_audit.id;
CREATE TABLE public.platform_coupons (
    id integer NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    value numeric(12,2) NOT NULL,
    plan_ids jsonb DEFAULT '[]'::jsonb,
    max_uses integer DEFAULT 0,
    used integer DEFAULT 0,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    active boolean DEFAULT true,
    note text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT platform_coupons_type_check CHECK ((type = ANY (ARRAY['percent'::text, 'flat'::text])))
);
CREATE SEQUENCE public.platform_coupons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_coupons_id_seq OWNED BY public.platform_coupons.id;
CREATE TABLE public.platform_files (
    key text NOT NULL,
    file_name text,
    mime text,
    size integer,
    data bytea NOT NULL,
    downloads integer DEFAULT 0,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.platform_payments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    plan_id integer,
    plan_name text,
    months integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    method text,
    txn_id text,
    sender text,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    submitted_by text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    reject_reason text,
    period_from timestamp with time zone,
    period_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    original_amount numeric(12,2),
    plan_discount numeric(12,2) DEFAULT 0,
    coupon_code text,
    coupon_discount numeric(12,2) DEFAULT 0,
    CONSTRAINT platform_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);
CREATE SEQUENCE public.platform_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_payments_id_seq OWNED BY public.platform_payments.id;
CREATE TABLE public.platform_plans (
    id integer NOT NULL,
    name text NOT NULL,
    months integer NOT NULL,
    price numeric(12,2) NOT NULL,
    description text,
    badge text,
    sort integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    discount_type text DEFAULT 'none'::text,
    discount_value numeric(12,2) DEFAULT 0,
    discount_label text,
    discount_starts timestamp with time zone,
    discount_ends timestamp with time zone,
    features jsonb DEFAULT '[]'::jsonb,
    highlight boolean DEFAULT false,
    button_text text
);
CREATE SEQUENCE public.platform_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_plans_id_seq OWNED BY public.platform_plans.id;
CREATE TABLE public.platform_sessions (
    token text NOT NULL,
    kind text NOT NULL,
    tenant_id integer,
    user_id integer NOT NULL,
    impersonated_by integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT platform_sessions_kind_check CHECK ((kind = ANY (ARRAY['tenant'::text, 'super'::text])))
);
CREATE TABLE public.platform_settings (
    key text NOT NULL,
    value jsonb
);
CREATE TABLE public.platform_tenants (
    id integer NOT NULL,
    slug text NOT NULL,
    schema_name text,
    business_name text NOT NULL,
    owner_name text,
    phone text,
    email text,
    address text,
    district text,
    status text DEFAULT 'trial'::text NOT NULL,
    plan_id integer,
    trial_ends_at timestamp with time zone,
    expires_at timestamp with time zone,
    notes text,
    source text DEFAULT 'signup'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    CONSTRAINT platform_tenants_status_check CHECK ((status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text])))
);
CREATE SEQUENCE public.platform_tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.platform_tenants_id_seq OWNED BY public.platform_tenants.id;
CREATE TABLE tenant_schema.audit_logs (
    id bigint NOT NULL,
    user_id integer,
    user_name text,
    role_name text,
    action text NOT NULL,
    entity text,
    entity_id text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.audit_logs_id_seq OWNED BY tenant_schema.audit_logs.id;
CREATE TABLE tenant_schema.challan_items (
    id integer NOT NULL,
    challan_id integer NOT NULL,
    invoice_item_id integer,
    product_id integer,
    media_id integer,
    qty numeric(12,2) NOT NULL,
    length_ft numeric(12,2),
    sqft numeric(12,2),
    description text,
    cost numeric(14,2)
);
CREATE SEQUENCE tenant_schema.challan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.challan_items_id_seq OWNED BY tenant_schema.challan_items.id;
CREATE TABLE tenant_schema.challans (
    id integer NOT NULL,
    division text NOT NULL,
    dc_no text NOT NULL,
    date date NOT NULL,
    invoice_id integer,
    customer_id integer,
    receiver text,
    carried_by text,
    issuing_authority text,
    remarks text,
    standalone boolean DEFAULT false,
    status text DEFAULT 'active'::text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    prepared_by text,
    prepared_nick text,
    CONSTRAINT challans_division_check CHECK ((division = ANY (ARRAY['ctp'::text, 'pvc'::text])))
);
CREATE SEQUENCE tenant_schema.challans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.challans_id_seq OWNED BY tenant_schema.challans.id;
CREATE TABLE tenant_schema.ctp_invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    product_id integer NOT NULL,
    qty integer NOT NULL,
    rate numeric(12,2) NOT NULL,
    line_total numeric(14,2) NOT NULL,
    description text
);
CREATE SEQUENCE tenant_schema.ctp_invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.ctp_invoice_items_id_seq OWNED BY tenant_schema.ctp_invoice_items.id;
CREATE TABLE tenant_schema.ctp_invoices (
    id integer NOT NULL,
    inv_no text,
    date date NOT NULL,
    customer_id integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0,
    discount numeric(14,2) DEFAULT 0,
    grand_total numeric(14,2) DEFAULT 0,
    payment_method text,
    job_no text,
    delivery_date date,
    remarks text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    updated_by_name text,
    updated_at timestamp with time zone,
    confirmed_by integer,
    confirmed_by_name text,
    confirmed_at timestamp with time zone,
    cancelled_by integer,
    cancelled_by_name text,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    CONSTRAINT ctp_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text])))
);
CREATE SEQUENCE tenant_schema.ctp_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.ctp_invoices_id_seq OWNED BY tenant_schema.ctp_invoices.id;
CREATE TABLE tenant_schema.ctp_prices (
    id integer NOT NULL,
    product_id integer,
    rate numeric(12,2) NOT NULL,
    old_rate numeric(12,2),
    effective_from date NOT NULL,
    created_by integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.ctp_prices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.ctp_prices_id_seq OWNED BY tenant_schema.ctp_prices.id;
CREATE TABLE tenant_schema.ctp_products (
    id integer NOT NULL,
    name text NOT NULL,
    alias text,
    size_mm text,
    size_in text,
    unit text DEFAULT 'Pcs'::text,
    current_rate numeric(12,2) DEFAULT 0,
    low_stock integer DEFAULT 20,
    sort integer DEFAULT 0,
    active boolean DEFAULT true,
    deleted boolean DEFAULT false
);
CREATE SEQUENCE tenant_schema.ctp_products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.ctp_products_id_seq OWNED BY tenant_schema.ctp_products.id;
CREATE TABLE tenant_schema.ctp_stock_movements (
    id integer NOT NULL,
    date date NOT NULL,
    product_id integer NOT NULL,
    type text NOT NULL,
    qty integer NOT NULL,
    ref_type text,
    ref_id integer,
    ref_no text,
    party text,
    purpose text,
    job_ref text,
    remarks text,
    is_reversal boolean DEFAULT false,
    reversal_of integer,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    updated_by_name text,
    updated_at timestamp with time zone,
    CONSTRAINT ctp_stock_movements_type_check CHECK ((type = ANY (ARRAY['opening'::text, 'production'::text, 'stock_in'::text, 'adj_in'::text, 'sale'::text, 'own_use'::text, 'adj_out'::text, 'challan_out'::text])))
);
CREATE SEQUENCE tenant_schema.ctp_stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.ctp_stock_movements_id_seq OWNED BY tenant_schema.ctp_stock_movements.id;
CREATE TABLE tenant_schema.customers (
    id integer NOT NULL,
    name text NOT NULL,
    company text,
    contact_person text,
    phone text,
    address text,
    email text,
    opening_balance numeric(14,2) DEFAULT 0,
    remarks text,
    active boolean DEFAULT true,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    updated_by_name text,
    updated_at timestamp with time zone,
    customer_type text
);
CREATE SEQUENCE tenant_schema.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.customers_id_seq OWNED BY tenant_schema.customers.id;
CREATE TABLE tenant_schema.expenses (
    id integer NOT NULL,
    date date NOT NULL,
    category text NOT NULL,
    amount numeric(14,2) NOT NULL,
    method text,
    description text,
    division text DEFAULT 'common'::text,
    voided boolean DEFAULT false,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.expenses_id_seq OWNED BY tenant_schema.expenses.id;
CREATE TABLE tenant_schema.gen_invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    job_type text NOT NULL,
    description text,
    w numeric(10,2),
    l numeric(10,2),
    colours integer,
    qty numeric(14,2) NOT NULL,
    price_unit text NOT NULL,
    billed_qty numeric(14,2),
    rate numeric(12,4) NOT NULL,
    line_total numeric(14,2) NOT NULL,
    film_item_id integer,
    film_used numeric(14,3),
    paper_item_id integer,
    paper_qty numeric(14,3)
);
CREATE SEQUENCE tenant_schema.gen_invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.gen_invoice_items_id_seq OWNED BY tenant_schema.gen_invoice_items.id;
CREATE TABLE tenant_schema.gen_invoices (
    id integer NOT NULL,
    inv_no text,
    date date NOT NULL,
    customer_id integer NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0,
    discount numeric(14,2) DEFAULT 0,
    grand_total numeric(14,2) DEFAULT 0,
    payment_method text,
    job_no text,
    delivery_date date,
    remarks text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    cancelled_by integer,
    cancelled_by_name text,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    CONSTRAINT gen_invoices_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'cancelled'::text])))
);
CREATE SEQUENCE tenant_schema.gen_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.gen_invoices_id_seq OWNED BY tenant_schema.gen_invoices.id;
CREATE TABLE tenant_schema.gen_items (
    id integer NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    unit text DEFAULT 'Pcs'::text NOT NULL,
    size text,
    gsm text,
    paper_type text,
    color text,
    machine text,
    finish text,
    width_in numeric(8,2),
    roll_length numeric(10,2),
    low_stock numeric(14,3) DEFAULT 0,
    rate numeric(12,2) DEFAULT 0,
    remarks text,
    sort integer DEFAULT 0,
    active boolean DEFAULT true,
    deleted boolean DEFAULT false,
    created_by integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by_name text,
    updated_at timestamp with time zone,
    code text,
    category text,
    rack text,
    avg_cost numeric(14,4) DEFAULT 0
);
CREATE SEQUENCE tenant_schema.gen_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.gen_items_id_seq OWNED BY tenant_schema.gen_items.id;
CREATE TABLE tenant_schema.gen_moves (
    id integer NOT NULL,
    date date NOT NULL,
    item_id integer NOT NULL,
    type text NOT NULL,
    qty numeric(14,3) NOT NULL,
    purpose text,
    party text,
    ref_type text,
    ref_id integer,
    ref_no text,
    remarks text,
    is_reversal boolean DEFAULT false,
    reversal_of integer,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    unit_cost numeric(14,4),
    before_qty numeric(14,3),
    after_qty numeric(14,3),
    CONSTRAINT gen_moves_type_check CHECK ((type = ANY (ARRAY['opening'::text, 'stock_in'::text, 'purchase'::text, 'use'::text, 'job'::text, 'issue'::text, 'return'::text, 'wastage'::text, 'adj_in'::text, 'adj_out'::text])))
);
CREATE SEQUENCE tenant_schema.gen_moves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.gen_moves_id_seq OWNED BY tenant_schema.gen_moves.id;
CREATE TABLE tenant_schema.idem_keys (
    key text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE tenant_schema.invoice_sequences (
    key text NOT NULL,
    prefix text NOT NULL,
    last_no integer DEFAULT 0 NOT NULL,
    pad integer DEFAULT 5 NOT NULL
);
CREATE TABLE tenant_schema.machines (
    id integer NOT NULL,
    name text NOT NULL,
    type text,
    specs text,
    status text DEFAULT 'Active'::text,
    maintenance text,
    last_service date,
    next_service date,
    remarks text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.machines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.machines_id_seq OWNED BY tenant_schema.machines.id;
CREATE TABLE tenant_schema.payment_allocations (
    id integer NOT NULL,
    payment_id integer NOT NULL,
    division text NOT NULL,
    invoice_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    created_by integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.payment_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.payment_allocations_id_seq OWNED BY tenant_schema.payment_allocations.id;
CREATE TABLE tenant_schema.payments (
    id integer NOT NULL,
    receipt_no text,
    date date NOT NULL,
    customer_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    method text,
    reference text,
    division text DEFAULT 'common'::text,
    remarks text,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    order_id integer,
    "time" text
);
CREATE SEQUENCE tenant_schema.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.payments_id_seq OWNED BY tenant_schema.payments.id;
CREATE TABLE tenant_schema.press_activity (
    id integer NOT NULL,
    order_id integer,
    item_id integer,
    kind text,
    text text,
    by_name text,
    at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_activity_id_seq OWNED BY tenant_schema.press_activity.id;
CREATE TABLE tenant_schema.press_challan_items (
    id integer NOT NULL,
    challan_id integer NOT NULL,
    item_id integer NOT NULL,
    qty numeric(14,2) NOT NULL
);
CREATE SEQUENCE tenant_schema.press_challan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_challan_items_id_seq OWNED BY tenant_schema.press_challan_items.id;
CREATE TABLE tenant_schema.press_challans (
    id integer NOT NULL,
    dc_no text,
    date date NOT NULL,
    order_id integer NOT NULL,
    customer_id integer NOT NULL,
    receiver text,
    carried_by text,
    prepared_by text,
    prepared_nick text,
    remarks text,
    status text DEFAULT 'active'::text,
    cancel_reason text,
    cancelled_by_name text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_challans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_challans_id_seq OWNED BY tenant_schema.press_challans.id;
CREATE TABLE tenant_schema.press_costs (
    id integer NOT NULL,
    order_id integer NOT NULL,
    item_id integer,
    date date NOT NULL,
    category text NOT NULL,
    amount numeric(14,2) NOT NULL,
    note text,
    voided boolean DEFAULT false,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_costs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_costs_id_seq OWNED BY tenant_schema.press_costs.id;
CREATE TABLE tenant_schema.press_cust_materials (
    id integer NOT NULL,
    order_id integer,
    customer_id integer,
    received_date date NOT NULL,
    description text NOT NULL,
    received_qty numeric(14,2) NOT NULL,
    unit text,
    received_by text,
    remarks text,
    processed_qty numeric(14,2),
    good_qty numeric(14,2),
    returned_qty numeric(14,2),
    waste_qty numeric(14,2),
    return_date date,
    receiver_name text,
    receiver_signed boolean DEFAULT false,
    diff_reason text,
    status text DEFAULT 'received'::text,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_cust_materials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_cust_materials_id_seq OWNED BY tenant_schema.press_cust_materials.id;
CREATE TABLE tenant_schema.press_design_files (
    id integer NOT NULL,
    item_id integer NOT NULL,
    filename text,
    mime text,
    size integer,
    data bytea,
    uploaded_by_name text,
    uploaded_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_design_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_design_files_id_seq OWNED BY tenant_schema.press_design_files.id;
CREATE TABLE tenant_schema.press_invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    item_id integer,
    product text,
    description text,
    qty numeric(14,2),
    unit text,
    unit_price numeric(14,4),
    total numeric(14,2)
);
CREATE SEQUENCE tenant_schema.press_invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_invoice_items_id_seq OWNED BY tenant_schema.press_invoice_items.id;
CREATE TABLE tenant_schema.press_invoices (
    id integer NOT NULL,
    inv_no text,
    date date NOT NULL,
    order_id integer NOT NULL,
    customer_id integer NOT NULL,
    status text DEFAULT 'final'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0,
    discount numeric(14,2) DEFAULT 0,
    adjustment numeric(14,2) DEFAULT 0,
    adjustment_note text,
    grand_total numeric(14,2) DEFAULT 0,
    closed_early boolean DEFAULT false,
    close_reason text,
    remarks text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    void_requested_by integer,
    void_requested_name text,
    void_requested_at timestamp with time zone,
    void_req_reason text,
    void_req_category text,
    voided_at timestamp with time zone,
    voided_by integer,
    voided_by_name text,
    void_reason text,
    void_category text,
    void_approved_by_name text,
    snapshot jsonb,
    vat_pct numeric(6,2) DEFAULT 0,
    vat_amount numeric(14,2) DEFAULT 0,
    CONSTRAINT press_invoices_status_check CHECK ((status = ANY (ARRAY['final'::text, 'void'::text])))
);
CREATE SEQUENCE tenant_schema.press_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_invoices_id_seq OWNED BY tenant_schema.press_invoices.id;
CREATE TABLE tenant_schema.press_issue_lines (
    id integer NOT NULL,
    issue_id integer NOT NULL,
    stock_item_id integer NOT NULL,
    qty numeric(14,3) NOT NULL,
    unit text,
    unit_cost numeric(14,4) DEFAULT 0,
    move_id integer
);
CREATE SEQUENCE tenant_schema.press_issue_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_issue_lines_id_seq OWNED BY tenant_schema.press_issue_lines.id;
CREATE TABLE tenant_schema.press_issues (
    id integer NOT NULL,
    issue_no text,
    date date NOT NULL,
    order_id integer,
    item_id integer,
    issued_by text,
    received_by text,
    remarks text,
    total_cost numeric(14,2) DEFAULT 0,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_issues_id_seq OWNED BY tenant_schema.press_issues.id;
CREATE TABLE tenant_schema.press_items (
    id integer NOT NULL,
    order_id integer NOT NULL,
    sl integer,
    product text NOT NULL,
    template text,
    description text,
    qty numeric(14,2) NOT NULL,
    unit text DEFAULT 'pcs'::text,
    size text,
    paper text,
    gsm text,
    colour text,
    sides text,
    finishing text,
    unit_price numeric(14,4) DEFAULT 0,
    total numeric(14,2) DEFAULT 0,
    machine_id integer,
    plate_info text,
    ins_printing text,
    ins_lamination text,
    ins_cutting text,
    ins_binding text,
    ins_diecut text,
    ins_other text,
    notes text,
    design_required boolean DEFAULT true,
    design_source text DEFAULT 'inhouse'::text,
    design_status text DEFAULT 'Pending'::text,
    design_approved_at timestamp with time zone,
    design_approved_by text,
    design_revisions jsonb DEFAULT '[]'::jsonb,
    designer text,
    prod_status text DEFAULT 'Pending'::text,
    planned_start date,
    est_completion date,
    actual_start date,
    actual_completion date,
    assigned_staff text,
    prod_notes text,
    steps jsonb DEFAULT '[]'::jsonb,
    good_qty numeric(14,2),
    waste_qty numeric(14,2),
    est_cost jsonb DEFAULT '{}'::jsonb,
    cancelled boolean DEFAULT false
);
CREATE SEQUENCE tenant_schema.press_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_items_id_seq OWNED BY tenant_schema.press_items.id;
CREATE TABLE tenant_schema.press_orders (
    id integer NOT NULL,
    order_no text,
    date date NOT NULL,
    customer_id integer NOT NULL,
    order_type text,
    officer_id integer,
    officer_name text,
    deadline date,
    instructions text,
    remarks text,
    status text DEFAULT 'pending'::text NOT NULL,
    total numeric(14,2) DEFAULT 0,
    quick boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by_name text,
    cancel_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    updated_by_name text,
    quote_id integer
);
CREATE SEQUENCE tenant_schema.press_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_orders_id_seq OWNED BY tenant_schema.press_orders.id;
CREATE TABLE tenant_schema.press_outsourcing (
    id integer NOT NULL,
    order_id integer,
    item_id integer,
    supplier_id integer,
    work text NOT NULL,
    qty numeric(14,2),
    cost numeric(14,2) DEFAULT 0,
    sent_date date,
    delivery_date date,
    received boolean DEFAULT false,
    paid numeric(14,2) DEFAULT 0,
    remarks text,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_outsourcing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_outsourcing_id_seq OWNED BY tenant_schema.press_outsourcing.id;
CREATE TABLE tenant_schema.press_quotes (
    id integer NOT NULL,
    quote_no text,
    date date NOT NULL,
    valid_until date,
    customer_id integer NOT NULL,
    subject text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(14,2) DEFAULT 0,
    discount numeric(14,2) DEFAULT 0,
    total numeric(14,2) DEFAULT 0,
    notes text,
    terms text,
    status text DEFAULT 'Draft'::text NOT NULL,
    status_note text,
    status_at timestamp with time zone,
    status_by_name text,
    revision integer DEFAULT 0,
    order_id integer,
    officer_id integer,
    officer_name text,
    created_by integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    updated_by_name text
);
CREATE SEQUENCE tenant_schema.press_quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_quotes_id_seq OWNED BY tenant_schema.press_quotes.id;
CREATE TABLE tenant_schema.press_returns (
    id integer NOT NULL,
    return_no text,
    date date NOT NULL,
    issue_id integer NOT NULL,
    line_id integer NOT NULL,
    stock_item_id integer,
    qty numeric(14,3) NOT NULL,
    condition text NOT NULL,
    reason text,
    received_by text,
    remarks text,
    move_id integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.press_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.press_returns_id_seq OWNED BY tenant_schema.press_returns.id;
CREATE TABLE tenant_schema.pvc_ink_stock (
    id integer NOT NULL,
    date date NOT NULL,
    color text NOT NULL,
    pcs integer NOT NULL,
    liters numeric(12,3) NOT NULL,
    remarks text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    type text DEFAULT 'in'::text
);
CREATE SEQUENCE tenant_schema.pvc_ink_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_ink_stock_id_seq OWNED BY tenant_schema.pvc_ink_stock.id;
CREATE TABLE tenant_schema.pvc_invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    media_id integer,
    art_w numeric(10,2) NOT NULL,
    art_l numeric(10,2) NOT NULL,
    qty integer NOT NULL,
    orientation text DEFAULT 'Normal'::text,
    across integer DEFAULT 1,
    sqft numeric(12,2) NOT NULL,
    rate numeric(12,2) NOT NULL,
    line_total numeric(14,2) NOT NULL,
    used_length numeric(12,2) DEFAULT 0,
    wastage_length numeric(12,2) DEFAULT 0,
    wastage_reason text,
    fit_status text,
    override_reason text,
    print_entry_id integer,
    description text,
    kind text DEFAULT 'sqft'::text
);
CREATE SEQUENCE tenant_schema.pvc_invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_invoice_items_id_seq OWNED BY tenant_schema.pvc_invoice_items.id;
CREATE TABLE tenant_schema.pvc_invoices (
    id integer NOT NULL,
    inv_no text,
    date date NOT NULL,
    customer_id integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0,
    discount numeric(14,2) DEFAULT 0,
    grand_total numeric(14,2) DEFAULT 0,
    payment_method text,
    job_no text,
    delivery_date date,
    remarks text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    updated_by_name text,
    updated_at timestamp with time zone,
    confirmed_by integer,
    confirmed_by_name text,
    confirmed_at timestamp with time zone,
    cancelled_by integer,
    cancelled_by_name text,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    CONSTRAINT pvc_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text])))
);
CREATE SEQUENCE tenant_schema.pvc_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_invoices_id_seq OWNED BY tenant_schema.pvc_invoices.id;
CREATE TABLE tenant_schema.pvc_media (
    id integer NOT NULL,
    category text NOT NULL,
    width_ft numeric(6,2) NOT NULL,
    roll_length_ft numeric(10,2) DEFAULT 164,
    low_stock_ft numeric(10,2) DEFAULT 20,
    default_rate numeric(12,2) DEFAULT 0,
    active boolean DEFAULT true,
    sort integer DEFAULT 0,
    deleted boolean DEFAULT false
);
CREATE SEQUENCE tenant_schema.pvc_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_media_id_seq OWNED BY tenant_schema.pvc_media.id;
CREATE TABLE tenant_schema.pvc_print_entries (
    id integer NOT NULL,
    date date NOT NULL,
    customer_id integer,
    job_name text,
    media_id integer NOT NULL,
    roll_width numeric(6,2),
    art_w numeric(10,2) NOT NULL,
    art_l numeric(10,2) NOT NULL,
    qty integer NOT NULL,
    orientation text NOT NULL,
    across integer DEFAULT 1,
    printed_sqft numeric(12,2),
    used_length numeric(12,2),
    consumed_sqft numeric(12,2),
    wastage_length numeric(12,2) DEFAULT 0,
    wastage_sqft numeric(12,2) DEFAULT 0,
    wastage_reason text,
    fit_status text,
    override_reason text,
    remarks text,
    invoice_id integer,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_by integer,
    updated_by_name text,
    updated_at timestamp with time zone
);
CREATE SEQUENCE tenant_schema.pvc_print_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_print_entries_id_seq OWNED BY tenant_schema.pvc_print_entries.id;
CREATE TABLE tenant_schema.pvc_stock_movements (
    id integer NOT NULL,
    date date NOT NULL,
    media_id integer NOT NULL,
    type text NOT NULL,
    length_ft numeric(12,2) NOT NULL,
    roll_qty numeric(10,2),
    roll_length numeric(10,2),
    area_sqft numeric(12,2),
    reason text,
    ref_type text,
    ref_id integer,
    ref_no text,
    party text,
    supplier text,
    remarks text,
    is_reversal boolean DEFAULT false,
    reversal_of integer,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pvc_stock_movements_type_check CHECK ((type = ANY (ARRAY['opening'::text, 'stock_in'::text, 'adj_in'::text, 'print'::text, 'wastage'::text, 'adj_out'::text, 'challan_out'::text])))
);
CREATE SEQUENCE tenant_schema.pvc_stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.pvc_stock_movements_id_seq OWNED BY tenant_schema.pvc_stock_movements.id;
CREATE TABLE tenant_schema.refunds (
    id integer NOT NULL,
    refund_no text,
    date date NOT NULL,
    "time" text,
    customer_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    method text,
    reference text,
    reason text NOT NULL,
    order_id integer,
    related text,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.refunds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.refunds_id_seq OWNED BY tenant_schema.refunds.id;
CREATE TABLE tenant_schema.roles (
    id integer NOT NULL,
    name text NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    system boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.roles_id_seq OWNED BY tenant_schema.roles.id;
CREATE TABLE tenant_schema.settings (
    key text NOT NULL,
    value jsonb
);
CREATE TABLE tenant_schema.store_purchases (
    id integer NOT NULL,
    pur_no text,
    date date NOT NULL,
    supplier_id integer,
    supplier_name text,
    bill_ref text,
    remarks text,
    total numeric(14,2) DEFAULT 0,
    paid_expense_id integer,
    voided boolean DEFAULT false,
    void_reason text,
    created_by integer,
    created_by_name text,
    created_role text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.store_purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.store_purchases_id_seq OWNED BY tenant_schema.store_purchases.id;
CREATE TABLE tenant_schema.suppliers (
    id integer NOT NULL,
    name text NOT NULL,
    contact_person text,
    phone text,
    address text,
    supplies text,
    remarks text,
    active boolean DEFAULT true,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tenant_schema.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.suppliers_id_seq OWNED BY tenant_schema.suppliers.id;
CREATE TABLE tenant_schema.users (
    id integer NOT NULL,
    username text NOT NULL,
    full_name text NOT NULL,
    phone text,
    password_hash text NOT NULL,
    role_id integer,
    active boolean DEFAULT true,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by integer,
    updated_at timestamp with time zone,
    updated_by integer,
    nickname text
);
CREATE SEQUENCE tenant_schema.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tenant_schema.users_id_seq OWNED BY tenant_schema.users.id;
ALTER TABLE ONLY public.platform_admins ALTER COLUMN id SET DEFAULT nextval('public.platform_admins_id_seq'::regclass);
ALTER TABLE ONLY public.platform_app_releases ALTER COLUMN id SET DEFAULT nextval('public.platform_app_releases_id_seq'::regclass);
ALTER TABLE ONLY public.platform_audit ALTER COLUMN id SET DEFAULT nextval('public.platform_audit_id_seq'::regclass);
ALTER TABLE ONLY public.platform_coupons ALTER COLUMN id SET DEFAULT nextval('public.platform_coupons_id_seq'::regclass);
ALTER TABLE ONLY public.platform_payments ALTER COLUMN id SET DEFAULT nextval('public.platform_payments_id_seq'::regclass);
ALTER TABLE ONLY public.platform_plans ALTER COLUMN id SET DEFAULT nextval('public.platform_plans_id_seq'::regclass);
ALTER TABLE ONLY public.platform_tenants ALTER COLUMN id SET DEFAULT nextval('public.platform_tenants_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.audit_logs ALTER COLUMN id SET DEFAULT nextval('tenant_schema.audit_logs_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.challan_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.challan_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.challans ALTER COLUMN id SET DEFAULT nextval('tenant_schema.challans_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.ctp_invoice_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.ctp_invoice_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.ctp_invoices ALTER COLUMN id SET DEFAULT nextval('tenant_schema.ctp_invoices_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.ctp_prices ALTER COLUMN id SET DEFAULT nextval('tenant_schema.ctp_prices_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.ctp_products ALTER COLUMN id SET DEFAULT nextval('tenant_schema.ctp_products_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.ctp_stock_movements ALTER COLUMN id SET DEFAULT nextval('tenant_schema.ctp_stock_movements_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.customers ALTER COLUMN id SET DEFAULT nextval('tenant_schema.customers_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.expenses ALTER COLUMN id SET DEFAULT nextval('tenant_schema.expenses_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.gen_invoice_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.gen_invoice_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.gen_invoices ALTER COLUMN id SET DEFAULT nextval('tenant_schema.gen_invoices_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.gen_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.gen_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.gen_moves ALTER COLUMN id SET DEFAULT nextval('tenant_schema.gen_moves_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.machines ALTER COLUMN id SET DEFAULT nextval('tenant_schema.machines_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.payment_allocations ALTER COLUMN id SET DEFAULT nextval('tenant_schema.payment_allocations_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.payments ALTER COLUMN id SET DEFAULT nextval('tenant_schema.payments_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_activity ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_activity_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_challan_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_challan_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_challans ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_challans_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_costs ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_costs_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_cust_materials ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_cust_materials_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_design_files ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_design_files_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_invoice_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_invoice_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_invoices ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_invoices_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_issue_lines ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_issue_lines_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_issues ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_issues_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_orders ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_orders_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_outsourcing ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_outsourcing_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_quotes ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_quotes_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.press_returns ALTER COLUMN id SET DEFAULT nextval('tenant_schema.press_returns_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_ink_stock ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_ink_stock_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_invoice_items ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_invoice_items_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_invoices ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_invoices_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_media ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_media_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_print_entries ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_print_entries_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.pvc_stock_movements ALTER COLUMN id SET DEFAULT nextval('tenant_schema.pvc_stock_movements_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.refunds ALTER COLUMN id SET DEFAULT nextval('tenant_schema.refunds_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.roles ALTER COLUMN id SET DEFAULT nextval('tenant_schema.roles_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.store_purchases ALTER COLUMN id SET DEFAULT nextval('tenant_schema.store_purchases_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.suppliers ALTER COLUMN id SET DEFAULT nextval('tenant_schema.suppliers_id_seq'::regclass);
ALTER TABLE ONLY tenant_schema.users ALTER COLUMN id SET DEFAULT nextval('tenant_schema.users_id_seq'::regclass);
ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_username_key UNIQUE (username);
ALTER TABLE ONLY public.platform_app_releases
    ADD CONSTRAINT platform_app_releases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_app_releases
    ADD CONSTRAINT platform_app_releases_version_code_key UNIQUE (version_code);
ALTER TABLE ONLY public.platform_audit
    ADD CONSTRAINT platform_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_coupons
    ADD CONSTRAINT platform_coupons_code_key UNIQUE (code);
ALTER TABLE ONLY public.platform_coupons
    ADD CONSTRAINT platform_coupons_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_files
    ADD CONSTRAINT platform_files_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.platform_payments
    ADD CONSTRAINT platform_payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_plans
    ADD CONSTRAINT platform_plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_sessions
    ADD CONSTRAINT platform_sessions_pkey PRIMARY KEY (token);
ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.platform_tenants
    ADD CONSTRAINT platform_tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_tenants
    ADD CONSTRAINT platform_tenants_schema_name_key UNIQUE (schema_name);
ALTER TABLE ONLY public.platform_tenants
    ADD CONSTRAINT platform_tenants_slug_key UNIQUE (slug);
ALTER TABLE ONLY tenant_schema.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.challan_items
    ADD CONSTRAINT challan_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.challans
    ADD CONSTRAINT challans_dc_no_key UNIQUE (dc_no);
ALTER TABLE ONLY tenant_schema.challans
    ADD CONSTRAINT challans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.ctp_invoice_items
    ADD CONSTRAINT ctp_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.ctp_invoices
    ADD CONSTRAINT ctp_invoices_inv_no_key UNIQUE (inv_no);
ALTER TABLE ONLY tenant_schema.ctp_invoices
    ADD CONSTRAINT ctp_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.ctp_prices
    ADD CONSTRAINT ctp_prices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.ctp_products
    ADD CONSTRAINT ctp_products_name_key UNIQUE (name);
ALTER TABLE ONLY tenant_schema.ctp_products
    ADD CONSTRAINT ctp_products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.ctp_stock_movements
    ADD CONSTRAINT ctp_stock_movements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.gen_invoice_items
    ADD CONSTRAINT gen_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.gen_invoices
    ADD CONSTRAINT gen_invoices_inv_no_key UNIQUE (inv_no);
ALTER TABLE ONLY tenant_schema.gen_invoices
    ADD CONSTRAINT gen_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.gen_items
    ADD CONSTRAINT gen_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.gen_moves
    ADD CONSTRAINT gen_moves_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.idem_keys
    ADD CONSTRAINT idem_keys_pkey PRIMARY KEY (key);
ALTER TABLE ONLY tenant_schema.invoice_sequences
    ADD CONSTRAINT invoice_sequences_pkey PRIMARY KEY (key);
ALTER TABLE ONLY tenant_schema.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.payments
    ADD CONSTRAINT payments_receipt_no_key UNIQUE (receipt_no);
ALTER TABLE ONLY tenant_schema.press_activity
    ADD CONSTRAINT press_activity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_challan_items
    ADD CONSTRAINT press_challan_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_challans
    ADD CONSTRAINT press_challans_dc_no_key UNIQUE (dc_no);
ALTER TABLE ONLY tenant_schema.press_challans
    ADD CONSTRAINT press_challans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_costs
    ADD CONSTRAINT press_costs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_cust_materials
    ADD CONSTRAINT press_cust_materials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_design_files
    ADD CONSTRAINT press_design_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_invoice_items
    ADD CONSTRAINT press_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_invoices
    ADD CONSTRAINT press_invoices_inv_no_key UNIQUE (inv_no);
ALTER TABLE ONLY tenant_schema.press_invoices
    ADD CONSTRAINT press_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_issue_lines
    ADD CONSTRAINT press_issue_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_issues
    ADD CONSTRAINT press_issues_issue_no_key UNIQUE (issue_no);
ALTER TABLE ONLY tenant_schema.press_issues
    ADD CONSTRAINT press_issues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_items
    ADD CONSTRAINT press_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_orders
    ADD CONSTRAINT press_orders_order_no_key UNIQUE (order_no);
ALTER TABLE ONLY tenant_schema.press_orders
    ADD CONSTRAINT press_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_outsourcing
    ADD CONSTRAINT press_outsourcing_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_quotes
    ADD CONSTRAINT press_quotes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_quotes
    ADD CONSTRAINT press_quotes_quote_no_key UNIQUE (quote_no);
ALTER TABLE ONLY tenant_schema.press_returns
    ADD CONSTRAINT press_returns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.press_returns
    ADD CONSTRAINT press_returns_return_no_key UNIQUE (return_no);
ALTER TABLE ONLY tenant_schema.pvc_ink_stock
    ADD CONSTRAINT pvc_ink_stock_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.pvc_invoice_items
    ADD CONSTRAINT pvc_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.pvc_invoices
    ADD CONSTRAINT pvc_invoices_inv_no_key UNIQUE (inv_no);
ALTER TABLE ONLY tenant_schema.pvc_invoices
    ADD CONSTRAINT pvc_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.pvc_media
    ADD CONSTRAINT pvc_media_category_width_ft_key UNIQUE (category, width_ft);
ALTER TABLE ONLY tenant_schema.pvc_media
    ADD CONSTRAINT pvc_media_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.pvc_print_entries
    ADD CONSTRAINT pvc_print_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.pvc_stock_movements
    ADD CONSTRAINT pvc_stock_movements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.refunds
    ADD CONSTRAINT refunds_refund_no_key UNIQUE (refund_no);
ALTER TABLE ONLY tenant_schema.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);
ALTER TABLE ONLY tenant_schema.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY tenant_schema.store_purchases
    ADD CONSTRAINT store_purchases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.store_purchases
    ADD CONSTRAINT store_purchases_pur_no_key UNIQUE (pur_no);
ALTER TABLE ONLY tenant_schema.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY tenant_schema.users
    ADD CONSTRAINT users_username_key UNIQUE (username);
CREATE INDEX ix_psess_tenant ON public.platform_sessions USING btree (tenant_id, user_id);
CREATE INDEX ix_alloc ON tenant_schema.payment_allocations USING btree (division, invoice_id);
CREATE INDEX ix_audit_created ON tenant_schema.audit_logs USING btree (created_at);
CREATE INDEX ix_ctpinv ON tenant_schema.ctp_invoices USING btree (date, status);
CREATE INDEX ix_ctpmv ON tenant_schema.ctp_stock_movements USING btree (product_id, date);
CREATE INDEX ix_ctpmv_type ON tenant_schema.ctp_stock_movements USING btree (type, date);
CREATE INDEX ix_cust_name ON tenant_schema.customers USING btree (lower(name));
CREATE INDEX ix_cust_phone ON tenant_schema.customers USING btree (phone);
CREATE INDEX ix_geninv ON tenant_schema.gen_invoices USING btree (date, status);
CREATE INDEX ix_genitems ON tenant_schema.gen_items USING btree (kind);
CREATE INDEX ix_genmv ON tenant_schema.gen_moves USING btree (item_id, date);
CREATE INDEX ix_pact ON tenant_schema.press_activity USING btree (order_id);
CREATE INDEX ix_pay ON tenant_schema.payments USING btree (customer_id, date);
CREATE INDEX ix_pay_order ON tenant_schema.payments USING btree (order_id);
CREATE INDEX ix_pi_order ON tenant_schema.press_items USING btree (order_id);
CREATE INDEX ix_po_date ON tenant_schema.press_orders USING btree (date, status);
CREATE INDEX ix_pvcinv ON tenant_schema.pvc_invoices USING btree (date, status);
CREATE INDEX ix_pvcmv ON tenant_schema.pvc_stock_movements USING btree (media_id, date);
CREATE INDEX ix_pvcmv_type ON tenant_schema.pvc_stock_movements USING btree (type, date);
CREATE INDEX ix_pvcprint ON tenant_schema.pvc_print_entries USING btree (date);
CREATE INDEX ix_refund_c ON tenant_schema.refunds USING btree (customer_id);
CREATE UNIQUE INDEX ux_press_inv_order ON tenant_schema.press_invoices USING btree (order_id) WHERE (status = 'final'::text);
ALTER TABLE ONLY public.platform_payments
    ADD CONSTRAINT platform_payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.platform_tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.platform_tenants
    ADD CONSTRAINT platform_tenants_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.platform_plans(id);
ALTER TABLE ONLY tenant_schema.challan_items
    ADD CONSTRAINT challan_items_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES tenant_schema.challans(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.challans
    ADD CONSTRAINT challans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.ctp_invoice_items
    ADD CONSTRAINT ctp_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tenant_schema.ctp_invoices(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.ctp_invoice_items
    ADD CONSTRAINT ctp_invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES tenant_schema.ctp_products(id);
ALTER TABLE ONLY tenant_schema.ctp_invoices
    ADD CONSTRAINT ctp_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.ctp_prices
    ADD CONSTRAINT ctp_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES tenant_schema.ctp_products(id);
ALTER TABLE ONLY tenant_schema.ctp_stock_movements
    ADD CONSTRAINT ctp_stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES tenant_schema.ctp_products(id);
ALTER TABLE ONLY tenant_schema.gen_invoice_items
    ADD CONSTRAINT gen_invoice_items_film_item_id_fkey FOREIGN KEY (film_item_id) REFERENCES tenant_schema.gen_items(id);
ALTER TABLE ONLY tenant_schema.gen_invoice_items
    ADD CONSTRAINT gen_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tenant_schema.gen_invoices(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.gen_invoice_items
    ADD CONSTRAINT gen_invoice_items_paper_item_id_fkey FOREIGN KEY (paper_item_id) REFERENCES tenant_schema.gen_items(id);
ALTER TABLE ONLY tenant_schema.gen_invoices
    ADD CONSTRAINT gen_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.gen_moves
    ADD CONSTRAINT gen_moves_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.gen_items(id);
ALTER TABLE ONLY tenant_schema.payment_allocations
    ADD CONSTRAINT payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES tenant_schema.payments(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.payments
    ADD CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_challan_items
    ADD CONSTRAINT press_challan_items_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES tenant_schema.press_challans(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.press_challan_items
    ADD CONSTRAINT press_challan_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id);
ALTER TABLE ONLY tenant_schema.press_challans
    ADD CONSTRAINT press_challans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_challans
    ADD CONSTRAINT press_challans_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_costs
    ADD CONSTRAINT press_costs_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id);
ALTER TABLE ONLY tenant_schema.press_costs
    ADD CONSTRAINT press_costs_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_cust_materials
    ADD CONSTRAINT press_cust_materials_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_cust_materials
    ADD CONSTRAINT press_cust_materials_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_design_files
    ADD CONSTRAINT press_design_files_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.press_invoice_items
    ADD CONSTRAINT press_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tenant_schema.press_invoices(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.press_invoice_items
    ADD CONSTRAINT press_invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id);
ALTER TABLE ONLY tenant_schema.press_invoices
    ADD CONSTRAINT press_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_invoices
    ADD CONSTRAINT press_invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_issue_lines
    ADD CONSTRAINT press_issue_lines_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES tenant_schema.press_issues(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.press_issue_lines
    ADD CONSTRAINT press_issue_lines_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES tenant_schema.gen_items(id);
ALTER TABLE ONLY tenant_schema.press_issues
    ADD CONSTRAINT press_issues_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id);
ALTER TABLE ONLY tenant_schema.press_issues
    ADD CONSTRAINT press_issues_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_items
    ADD CONSTRAINT press_items_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES tenant_schema.machines(id);
ALTER TABLE ONLY tenant_schema.press_items
    ADD CONSTRAINT press_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.press_orders
    ADD CONSTRAINT press_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_outsourcing
    ADD CONSTRAINT press_outsourcing_item_id_fkey FOREIGN KEY (item_id) REFERENCES tenant_schema.press_items(id);
ALTER TABLE ONLY tenant_schema.press_outsourcing
    ADD CONSTRAINT press_outsourcing_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_outsourcing
    ADD CONSTRAINT press_outsourcing_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES tenant_schema.suppliers(id);
ALTER TABLE ONLY tenant_schema.press_quotes
    ADD CONSTRAINT press_quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.press_quotes
    ADD CONSTRAINT press_quotes_order_id_fkey FOREIGN KEY (order_id) REFERENCES tenant_schema.press_orders(id);
ALTER TABLE ONLY tenant_schema.press_returns
    ADD CONSTRAINT press_returns_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES tenant_schema.press_issues(id);
ALTER TABLE ONLY tenant_schema.press_returns
    ADD CONSTRAINT press_returns_line_id_fkey FOREIGN KEY (line_id) REFERENCES tenant_schema.press_issue_lines(id);
ALTER TABLE ONLY tenant_schema.pvc_invoice_items
    ADD CONSTRAINT pvc_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tenant_schema.pvc_invoices(id) ON DELETE CASCADE;
ALTER TABLE ONLY tenant_schema.pvc_invoice_items
    ADD CONSTRAINT pvc_invoice_items_media_id_fkey FOREIGN KEY (media_id) REFERENCES tenant_schema.pvc_media(id);
ALTER TABLE ONLY tenant_schema.pvc_invoice_items
    ADD CONSTRAINT pvc_invoice_items_print_entry_id_fkey FOREIGN KEY (print_entry_id) REFERENCES tenant_schema.pvc_print_entries(id);
ALTER TABLE ONLY tenant_schema.pvc_invoices
    ADD CONSTRAINT pvc_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.pvc_print_entries
    ADD CONSTRAINT pvc_print_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.pvc_print_entries
    ADD CONSTRAINT pvc_print_entries_media_id_fkey FOREIGN KEY (media_id) REFERENCES tenant_schema.pvc_media(id);
ALTER TABLE ONLY tenant_schema.pvc_stock_movements
    ADD CONSTRAINT pvc_stock_movements_media_id_fkey FOREIGN KEY (media_id) REFERENCES tenant_schema.pvc_media(id);
ALTER TABLE ONLY tenant_schema.refunds
    ADD CONSTRAINT refunds_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenant_schema.customers(id);
ALTER TABLE ONLY tenant_schema.store_purchases
    ADD CONSTRAINT store_purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES tenant_schema.suppliers(id);
ALTER TABLE ONLY tenant_schema.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES tenant_schema.roles(id);
