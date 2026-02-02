-- TimeSheet App Database Schema
-- Supabase PostgreSQL with multi-business support

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;

-- ============================================
-- BUSINESSES TABLE (business_code as identifier)
-- ============================================
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_code TEXT UNIQUE NOT NULL,  -- Generated unique code (e.g., "ABC123")
    name TEXT NOT NULL,
    email TEXT,
    address TEXT,
    timezone TEXT DEFAULT 'UTC',
    latitude DOUBLE PRECISION,           -- Business location for geo-fencing
    longitude DOUBLE PRECISION,          -- Business location for geo-fencing
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on business_code for fast lookups
CREATE INDEX idx_businesses_code ON businesses(business_code);
CREATE INDEX idx_businesses_email ON businesses(email);

-- ============================================
-- EMPLOYEES TABLE
-- ============================================
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email TEXT,
    phone TEXT,
    date_of_birth DATE,
    face_encoding JSONB,  -- Store face data for recognition
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_business ON employees(business_id);
CREATE INDEX idx_employees_email ON employees(email);

-- ============================================
-- TIME ENTRIES TABLE
-- ============================================
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Clock times
    clock_in_time TIMESTAMPTZ NOT NULL,
    clock_out_time TIMESTAMPTZ,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'edited', 'disputed', 'approved')),
    
    -- Location data
    clock_in_latitude DOUBLE PRECISION,
    clock_in_longitude DOUBLE PRECISION,
    clock_out_latitude DOUBLE PRECISION,
    clock_out_longitude DOUBLE PRECISION,
    
    -- Liveness verification
    clock_in_liveness_verified BOOLEAN DEFAULT false,
    clock_in_liveness_score DOUBLE PRECISION,
    clock_out_liveness_verified BOOLEAN DEFAULT false,
    clock_out_liveness_score DOUBLE PRECISION,
    
    -- Photos (stored as URLs)
    clock_in_photo_url TEXT,
    clock_out_photo_url TEXT,
    
    -- Notes and calculations
    notes TEXT,
    break_minutes INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_entries_employee ON time_entries(employee_id);
CREATE INDEX idx_time_entries_business ON time_entries(business_id);
CREATE INDEX idx_time_entries_clock_in ON time_entries(clock_in_time);
CREATE INDEX idx_time_entries_status ON time_entries(status);

-- ============================================
-- TIME CHANGE REQUESTS TABLE
-- ============================================
DROP TABLE IF EXISTS time_change_requests CASCADE;

CREATE TABLE time_change_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Original times
    original_clock_in TIMESTAMPTZ NOT NULL,
    original_clock_out TIMESTAMPTZ,
    
    -- Requested times
    requested_clock_in TIMESTAMPTZ NOT NULL,
    requested_clock_out TIMESTAMPTZ,
    
    -- Request details
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    reviewed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_change_requests_business ON time_change_requests(business_id);
CREATE INDEX idx_time_change_requests_employee ON time_change_requests(employee_id);
CREATE INDEX idx_time_change_requests_status ON time_change_requests(status);

-- ============================================
-- ROW LEVEL SECURITY - Allow anonymous access
-- ============================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_change_requests ENABLE ROW LEVEL SECURITY;

-- Businesses: Allow all operations
CREATE POLICY "businesses_all" ON businesses FOR ALL USING (true) WITH CHECK (true);

-- Employees: Allow all operations  
CREATE POLICY "employees_all" ON employees FOR ALL USING (true) WITH CHECK (true);

-- Time Entries: Allow all operations
CREATE POLICY "time_entries_all" ON time_entries FOR ALL USING (true) WITH CHECK (true);

-- Time Change Requests: Allow all operations
CREATE POLICY "time_change_requests_all" ON time_change_requests FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_businesses_updated_at ON businesses;
CREATE TRIGGER update_businesses_updated_at
    BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_employees_updated_at ON employees;
CREATE TRIGGER update_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_time_entries_updated_at ON time_entries;
CREATE TRIGGER update_time_entries_updated_at
    BEFORE UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- VIEWS for reporting
-- ============================================

-- View: Daily hours summary per employee
CREATE OR REPLACE VIEW daily_hours_summary AS
SELECT 
    b.name AS business_name,
    b.business_code,
    e.id AS employee_id,
    e.full_name,
    DATE(te.clock_in_time AT TIME ZONE 'UTC') AS work_date,
    COUNT(*) AS entries_count,
    SUM(
        CASE 
            WHEN te.clock_out_time IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (te.clock_out_time - te.clock_in_time)) / 3600.0
            ELSE 0 
        END
    ) AS total_hours,
    MIN(te.clock_in_time) AS first_clock_in,
    MAX(te.clock_out_time) AS last_clock_out
FROM businesses b
JOIN employees e ON e.business_id = b.id
LEFT JOIN time_entries te ON e.id = te.employee_id
WHERE te.clock_in_time IS NOT NULL
GROUP BY b.name, b.business_code, e.id, e.full_name, DATE(te.clock_in_time AT TIME ZONE 'UTC')
ORDER BY work_date DESC, b.name, e.full_name;

-- View: Active employees (currently clocked in)
CREATE OR REPLACE VIEW active_employees AS
SELECT 
    b.name AS business_name,
    b.business_code,
    e.id AS employee_id,
    e.full_name,
    e.email,
    te.id AS time_entry_id,
    te.clock_in_time,
    EXTRACT(EPOCH FROM (NOW() - te.clock_in_time)) / 3600.0 AS hours_worked
FROM businesses b
JOIN employees e ON e.business_id = b.id
JOIN time_entries te ON e.id = te.employee_id
WHERE te.status = 'active' AND te.clock_out_time IS NULL
ORDER BY b.name, te.clock_in_time;

-- View: Business summary
CREATE OR REPLACE VIEW business_summary AS
SELECT 
    b.id AS business_id,
    b.name AS business_name,
    b.business_code,
    b.email,
    COUNT(DISTINCT e.id) AS employee_count,
    COUNT(DISTINCT te.id) AS total_entries,
    COUNT(DISTINCT CASE WHEN te.status = 'active' THEN te.id END) AS active_entries
FROM businesses b
LEFT JOIN employees e ON e.business_id = b.id AND e.is_active = true
LEFT JOIN time_entries te ON te.business_id = b.id
GROUP BY b.id, b.name, b.business_code, b.email
ORDER BY b.name;
