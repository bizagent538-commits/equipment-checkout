# Equipment Checkout Database Setup

## Overview
This schema runs in the **same Supabase project** as the Kitchen Inventory system to stay within free tier limits. All tables are prefixed with `eq_` to distinguish them from kitchen inventory tables.

## Shared Resources
- **Authentication**: Uses the same `auth.users` and `public.users` table as Kitchen Inventory
- **User roles**: 'admin', 'chair', 'volunteer' (same as kitchen inventory)

---

## SQL Schema - Run in Supabase SQL Editor

```sql
-- =====================================================
-- EQUIPMENT CHECKOUT SYSTEM TABLES
-- Run this AFTER kitchen inventory tables are created
-- =====================================================

-- Equipment items table
CREATE TABLE public.eq_equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Grounds',
    'Tools', 
    'Cleaning',
    'Electrical',
    'Events',
    'Shop',
    'Range',
    'Other'
  )),
  location TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
    'available',
    'checked-out',
    'needs-repair',
    'out-of-service'
  )),
  last_maintenance DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Equipment checkouts table
CREATE TABLE public.eq_checkouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL REFERENCES public.eq_equipment(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checkout_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expected_return DATE,
  return_date TIMESTAMP WITH TIME ZONE,
  use_type TEXT NOT NULL CHECK (use_type IN ('club', 'personal')),
  purpose TEXT,
  return_condition TEXT CHECK (return_condition IN ('good', 'deficiency')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Equipment deficiencies table
CREATE TABLE public.eq_deficiencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL REFERENCES public.eq_equipment(id) ON DELETE CASCADE,
  checkout_id UUID REFERENCES public.eq_checkouts(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor', 'major')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_date DATE,
  resolution_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_eq_equipment_status ON public.eq_equipment(status);
CREATE INDEX idx_eq_equipment_category ON public.eq_equipment(category);
CREATE INDEX idx_eq_equipment_code ON public.eq_equipment(equipment_code);

CREATE INDEX idx_eq_checkouts_equipment ON public.eq_checkouts(equipment_id);
CREATE INDEX idx_eq_checkouts_user ON public.eq_checkouts(user_id);
CREATE INDEX idx_eq_checkouts_active ON public.eq_checkouts(equipment_id) WHERE return_date IS NULL;

CREATE INDEX idx_eq_deficiencies_equipment ON public.eq_deficiencies(equipment_id);
CREATE INDEX idx_eq_deficiencies_status ON public.eq_deficiencies(status);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE public.eq_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eq_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eq_deficiencies ENABLE ROW LEVEL SECURITY;

-- Equipment: Everyone can view, admin/chair can edit
CREATE POLICY "Equipment viewable by authenticated"
  ON public.eq_equipment FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Equipment insertable by admin/chair"
  ON public.eq_equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'chair')
    )
  );

CREATE POLICY "Equipment updatable by admin/chair"
  ON public.eq_equipment FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'chair')
    )
  );

CREATE POLICY "Equipment deletable by admin/chair"
  ON public.eq_equipment FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'chair')
    )
  );

-- Checkouts: Everyone can view, users can create/update own
CREATE POLICY "Checkouts viewable by authenticated"
  ON public.eq_checkouts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create checkouts"
  ON public.eq_checkouts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own checkouts or admin/chair can update any"
  ON public.eq_checkouts FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id OR 
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'chair')
    )
  );

-- Deficiencies: Everyone can view, users can create, admin/chair can update
CREATE POLICY "Deficiencies viewable by authenticated"
  ON public.eq_deficiencies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can report deficiencies"
  ON public.eq_deficiencies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reported_by);

CREATE POLICY "Deficiencies updatable by admin/chair"
  ON public.eq_deficiencies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'chair')
    )
  );

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Generate next equipment code
CREATE OR REPLACE FUNCTION generate_equipment_code()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(equipment_code FROM 3) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.eq_equipment
  WHERE equipment_code ~ '^EQ[0-9]+$';
  
  new_code := 'EQ' || LPAD(next_num::TEXT, 3, '0');
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment status on checkout
CREATE OR REPLACE FUNCTION update_equipment_status_on_checkout()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.eq_equipment
  SET status = 'checked-out', updated_at = NOW()
  WHERE id = NEW.equipment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment status on return
CREATE OR REPLACE FUNCTION update_equipment_status_on_return()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.return_date IS NOT NULL AND OLD.return_date IS NULL THEN
    UPDATE public.eq_equipment
    SET status = 'available', updated_at = NOW()
    WHERE id = NEW.equipment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment on major deficiency
CREATE OR REPLACE FUNCTION update_equipment_on_deficiency()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.severity = 'major' THEN
    UPDATE public.eq_equipment
    SET status = 'needs-repair', updated_at = NOW()
    WHERE id = NEW.equipment_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'resolved' AND OLD.status = 'pending' THEN
    -- Check if no other pending major deficiencies
    IF NOT EXISTS (
      SELECT 1 FROM public.eq_deficiencies
      WHERE equipment_id = NEW.equipment_id
      AND id != NEW.id
      AND severity = 'major'
      AND status = 'pending'
    ) THEN
      -- Check if currently checked out
      IF EXISTS (
        SELECT 1 FROM public.eq_checkouts
        WHERE equipment_id = NEW.equipment_id
        AND return_date IS NULL
      ) THEN
        UPDATE public.eq_equipment
        SET status = 'checked-out', updated_at = NOW()
        WHERE id = NEW.equipment_id;
      ELSE
        UPDATE public.eq_equipment
        SET status = 'available', updated_at = NOW()
        WHERE id = NEW.equipment_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER on_equipment_checkout
  AFTER INSERT ON public.eq_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_status_on_checkout();

CREATE TRIGGER on_equipment_return
  AFTER UPDATE ON public.eq_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_status_on_return();

CREATE TRIGGER on_deficiency_change
  AFTER INSERT OR UPDATE ON public.eq_deficiencies
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_on_deficiency();
```

---

## Sample Data (Optional)

```sql
-- Add some sample equipment for testing
INSERT INTO public.eq_equipment (equipment_code, name, category, location, status, notes) VALUES
  ('EQ001', 'John Deere Riding Mower', 'Grounds', 'Shed A', 'available', 'New blade installed Nov 2024'),
  ('EQ002', 'Push Mower - Honda', 'Grounds', 'Shed A', 'available', NULL),
  ('EQ003', 'Chainsaw - Stihl 18"', 'Tools', 'Tool Room', 'available', 'Chain sharpened'),
  ('EQ004', 'Pressure Washer', 'Cleaning', 'Shed B', 'available', NULL),
  ('EQ005', 'Weed Whacker - Gas', 'Grounds', 'Shed A', 'available', NULL),
  ('EQ006', 'Ladder - 24ft Extension', 'Tools', 'Shed B', 'available', NULL),
  ('EQ007', 'Generator - 5000W', 'Electrical', 'Storage', 'needs-repair', 'Pull cord needs replacement'),
  ('EQ008', 'Folding Tables (Set of 10)', 'Events', 'Clubhouse', 'available', NULL),
  ('EQ009', 'Canopy Tent 10x10', 'Events', 'Storage', 'available', 'Stakes in attached bag'),
  ('EQ010', 'Drill Press', 'Shop', 'Workshop', 'available', NULL);
```

---

## Deployment Notes

### Same Supabase Project
- Kitchen Inventory URL: https://kitchen-inventory.vercel.app
- Equipment Checkout URL: https://equipment-checkout.vercel.app
- Both connect to: `https://your-project.supabase.co`

### Environment Variables
Copy the same values from Kitchen Inventory:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Table Naming
- Kitchen Inventory: `inventory_items`, `checkout_transactions`
- Equipment Checkout: `eq_equipment`, `eq_checkouts`, `eq_deficiencies`
- Shared: `users` (with employee_number, first_name, last_name, role)
