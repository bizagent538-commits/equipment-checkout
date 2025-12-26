# Equipment Checkout System - Complete Deployment Guide

This guide walks you through deploying the Equipment Checkout system step-by-step. The app shares a Supabase project with Kitchen Inventory to stay within free tier limits.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Download and Extract Project](#2-download-and-extract-project)
3. [Supabase Database Setup](#3-supabase-database-setup)
4. [Local Development Setup](#4-local-development-setup)
5. [Create Test Users](#5-create-test-users)
6. [Deploy to Vercel](#6-deploy-to-vercel)
7. [Post-Deployment Configuration](#7-post-deployment-configuration)
8. [USB Scanner Setup](#8-usb-scanner-setup)
9. [Printing QR Code Labels](#9-printing-qr-code-labels)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

Before starting, ensure you have:

- [ ] **Node.js 18+** installed ([download here](https://nodejs.org/))
- [ ] **Git** installed ([download here](https://git-scm.com/))
- [ ] **Supabase account** (same project as Kitchen Inventory)
- [ ] **Vercel account** ([sign up free](https://vercel.com/))
- [ ] **Code editor** (VS Code recommended)

### Verify Node.js Installation

Open Command Prompt or PowerShell and run:

```bash
node --version
npm --version
```

You should see version numbers (e.g., `v18.17.0` and `9.6.7`).

---

## 2. Download and Extract Project

### Option A: From Claude Download

1. Download the `equipment-checkout.zip` file from Claude
2. Extract to your projects folder (e.g., `C:\Projects\equipment-checkout`)
3. Open the folder in VS Code

### Option B: From GitHub (if you've pushed it there)

```bash
git clone https://github.com/YOUR_USERNAME/equipment-checkout.git
cd equipment-checkout
```

---

## 3. Supabase Database Setup

### Step 3.1: Open Your Existing Supabase Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Click on your **existing Kitchen Inventory project**
3. You'll add the equipment tables to this same project

### Step 3.2: Open SQL Editor

1. In the left sidebar, click **SQL Editor**
2. Click **New query**

### Step 3.3: Create Equipment Tables

Copy and paste this entire SQL block, then click **Run**:

```sql
-- =====================================================
-- EQUIPMENT CHECKOUT SYSTEM TABLES
-- =====================================================

-- Equipment items table
CREATE TABLE public.eq_equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Grounds', 'Tools', 'Cleaning', 'Electrical', 
    'Events', 'Shop', 'Range', 'Other'
  )),
  location TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
    'available', 'checked-out', 'needs-repair', 'out-of-service'
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

-- Success message
SELECT 'Tables created successfully!' as status;
```

You should see: `Tables created successfully!`

### Step 3.4: Create Indexes

Run this in a new query:

```sql
-- Indexes for performance
CREATE INDEX idx_eq_equipment_status ON public.eq_equipment(status);
CREATE INDEX idx_eq_equipment_category ON public.eq_equipment(category);
CREATE INDEX idx_eq_equipment_code ON public.eq_equipment(equipment_code);
CREATE INDEX idx_eq_checkouts_equipment ON public.eq_checkouts(equipment_id);
CREATE INDEX idx_eq_checkouts_user ON public.eq_checkouts(user_id);
CREATE INDEX idx_eq_checkouts_active ON public.eq_checkouts(equipment_id) WHERE return_date IS NULL;
CREATE INDEX idx_eq_deficiencies_equipment ON public.eq_deficiencies(equipment_id);
CREATE INDEX idx_eq_deficiencies_status ON public.eq_deficiencies(status);

SELECT 'Indexes created successfully!' as status;
```

### Step 3.5: Enable Row Level Security (RLS)

Run this in a new query:

```sql
-- Enable RLS
ALTER TABLE public.eq_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eq_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eq_deficiencies ENABLE ROW LEVEL SECURITY;

-- Equipment policies
CREATE POLICY "Equipment viewable by authenticated"
  ON public.eq_equipment FOR SELECT TO authenticated USING (true);

CREATE POLICY "Equipment insertable by admin/chair"
  ON public.eq_equipment FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin', 'chair')));

CREATE POLICY "Equipment updatable by admin/chair"
  ON public.eq_equipment FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin', 'chair')));

CREATE POLICY "Equipment deletable by admin/chair"
  ON public.eq_equipment FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin', 'chair')));

-- Checkouts policies
CREATE POLICY "Checkouts viewable by authenticated"
  ON public.eq_checkouts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create checkouts"
  ON public.eq_checkouts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own checkouts or admin/chair"
  ON public.eq_checkouts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin', 'chair')));

-- Deficiencies policies
CREATE POLICY "Deficiencies viewable by authenticated"
  ON public.eq_deficiencies FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can report deficiencies"
  ON public.eq_deficiencies FOR INSERT TO authenticated WITH CHECK (auth.uid() = reported_by);

CREATE POLICY "Deficiencies updatable by admin/chair"
  ON public.eq_deficiencies FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin', 'chair')));

SELECT 'RLS policies created successfully!' as status;
```

### Step 3.6: Create Helper Functions

Run this in a new query:

```sql
-- Generate next equipment code
CREATE OR REPLACE FUNCTION generate_equipment_code()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(equipment_code FROM 3) AS INTEGER)), 0) + 1
  INTO next_num FROM public.eq_equipment WHERE equipment_code ~ '^EQ[0-9]+$';
  new_code := 'EQ' || LPAD(next_num::TEXT, 3, '0');
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment status on checkout
CREATE OR REPLACE FUNCTION update_equipment_status_on_checkout()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.eq_equipment SET status = 'checked-out', updated_at = NOW() WHERE id = NEW.equipment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment status on return
CREATE OR REPLACE FUNCTION update_equipment_status_on_return()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.return_date IS NOT NULL AND OLD.return_date IS NULL THEN
    UPDATE public.eq_equipment SET status = 'available', updated_at = NOW() WHERE id = NEW.equipment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update equipment on major deficiency
CREATE OR REPLACE FUNCTION update_equipment_on_deficiency()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.severity = 'major' THEN
    UPDATE public.eq_equipment SET status = 'needs-repair', updated_at = NOW() WHERE id = NEW.equipment_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'resolved' AND OLD.status = 'pending' THEN
    IF NOT EXISTS (SELECT 1 FROM public.eq_deficiencies WHERE equipment_id = NEW.equipment_id AND id != NEW.id AND severity = 'major' AND status = 'pending') THEN
      IF EXISTS (SELECT 1 FROM public.eq_checkouts WHERE equipment_id = NEW.equipment_id AND return_date IS NULL) THEN
        UPDATE public.eq_equipment SET status = 'checked-out', updated_at = NOW() WHERE id = NEW.equipment_id;
      ELSE
        UPDATE public.eq_equipment SET status = 'available', updated_at = NOW() WHERE id = NEW.equipment_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Functions created successfully!' as status;
```

### Step 3.7: Create Triggers

Run this in a new query:

```sql
-- Create triggers
CREATE TRIGGER on_equipment_checkout
  AFTER INSERT ON public.eq_checkouts
  FOR EACH ROW EXECUTE FUNCTION update_equipment_status_on_checkout();

CREATE TRIGGER on_equipment_return
  AFTER UPDATE ON public.eq_checkouts
  FOR EACH ROW EXECUTE FUNCTION update_equipment_status_on_return();

CREATE TRIGGER on_deficiency_change
  AFTER INSERT OR UPDATE ON public.eq_deficiencies
  FOR EACH ROW EXECUTE FUNCTION update_equipment_on_deficiency();

SELECT 'Triggers created successfully!' as status;
```

### Step 3.8: Add Sample Equipment (Optional)

Run this to add test equipment:

```sql
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

SELECT 'Sample equipment added!' as status;
```

### Step 3.9: Get Your Supabase Credentials

1. In Supabase dashboard, click **Settings** (gear icon) in the left sidebar
2. Click **API** under Configuration
3. Copy these values (you'll need them next):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public** key: `eyJhbGci...` (the long one)

---

## 4. Local Development Setup

### Step 4.1: Open Terminal in Project Folder

In VS Code, press `` Ctrl+` `` to open the terminal, or use Command Prompt:

```bash
cd C:\Projects\equipment-checkout
```

### Step 4.2: Install Dependencies

```bash
npm install
```

Wait for installation to complete (1-2 minutes).

### Step 4.3: Create Environment File

1. In the project folder, find `.env.example`
2. Copy it and rename to `.env.local`
3. Open `.env.local` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-full-key
```

**Important**: Use the SAME values as your Kitchen Inventory app!

### Step 4.4: Start Development Server

```bash
npm run dev
```

You should see:

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

### Step 4.5: Open in Browser

Go to `http://localhost:5173` in your browser.

You'll see the login screen. Don't have users yet? Continue to Step 5.

---

## 5. Create Test Users

If you already have users in your Kitchen Inventory system, they'll work here too. If not:

### Step 5.1: Create Auth User in Supabase

1. In Supabase dashboard, go to **Authentication** → **Users**
2. Click **Add user** → **Create new user**
3. Enter:
   - Email: `chair@gsc.test`
   - Password: `chair123`
   - Check "Auto Confirm User"
4. Click **Create user**
5. **Copy the User UID** (you'll need it)

### Step 5.2: Add to Users Table

In SQL Editor, run (replace `YOUR-USER-UID-HERE` with the actual UID):

```sql
INSERT INTO public.users (id, employee_number, first_name, last_name, email, role)
VALUES (
  'YOUR-USER-UID-HERE',
  1,
  'Committee',
  'Chair',
  'chair@gsc.test',
  'chair'
);
```

### Step 5.3: Create a Volunteer User (Optional)

Repeat steps 5.1-5.2 with:
- Email: `volunteer@gsc.test`
- Password: `vol123`
- Role: `volunteer`

### Step 5.4: Test Login

1. Go to `http://localhost:5173`
2. Login with `chair@gsc.test` / `chair123`
3. You should see the Equipment Checkout dashboard

---

## 6. Deploy to Vercel

### Step 6.1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 6.2: Login to Vercel

```bash
vercel login
```

Follow the prompts to authenticate with your email or GitHub.

### Step 6.3: Initialize Vercel Project

From your project folder:

```bash
vercel
```

Answer the prompts:

```
? Set up and deploy "equipment-checkout"? [Y/n] Y
? Which scope do you want to deploy to? [Your Account]
? Link to existing project? [N] N
? What's your project's name? equipment-checkout
? In which directory is your code located? ./
? Want to modify these settings? [N] N
```

Wait for deployment (1-2 minutes).

### Step 6.4: Set Environment Variables

```bash
vercel env add VITE_SUPABASE_URL
```

When prompted, paste your Supabase URL and select all environments (Production, Preview, Development).

```bash
vercel env add VITE_SUPABASE_ANON_KEY
```

Paste your anon key and select all environments.

### Step 6.5: Redeploy with Environment Variables

```bash
vercel --prod
```

### Step 6.6: Get Your Production URL

After deployment, you'll see:

```
✅ Production: https://equipment-checkout-xxxxx.vercel.app
```

**Bookmark this URL!** This is your live application.

---

## 7. Post-Deployment Configuration

### Step 7.1: Add Domain to Supabase (Important!)

1. Go to Supabase → **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, add:
   - `https://equipment-checkout-xxxxx.vercel.app/**`
   - `http://localhost:5173/**`
3. Click **Save**

### Step 7.2: Test Production Site

1. Go to your Vercel URL
2. Login with your test credentials
3. Test checkout/return workflow
4. Verify all tabs work

### Step 7.3: Custom Domain (Optional)

In Vercel dashboard:
1. Go to your project → **Settings** → **Domains**
2. Add your custom domain (e.g., `equipment.grotonsc.org`)
3. Follow DNS configuration instructions

---

## 8. USB Scanner Setup

### Recommended Scanners

Budget options ($20-40):
- **Tera Wireless Barcode Scanner** - Works great, wireless
- **Symcode USB Barcode Scanner** - Wired, reliable
- **Netum Wireless Scanner** - Good battery life

### Setup Steps

1. **Plug in the scanner** - USB, no drivers needed on Windows
2. **Scanner acts like keyboard** - It "types" the scanned code
3. **Focus the scan input** - Click in the "Scan QR Code or Search" field
4. **Scan a QR code** - Equipment auto-selects if code matches

### Scanner Configuration (if needed)

Most scanners work out of the box. If issues:
1. Check scanner manual for "Keyboard Mode" or "HID Mode"
2. Scan the "USB HID Keyboard" barcode in the manual
3. Some scanners need "Add Enter suffix" enabled

---

## 9. Printing QR Code Labels

### Generate QR Codes

1. Go to **Inventory** tab
2. Click **QR Code** button next to any equipment
3. Click **Print** in the modal

### Recommended Label Setup

**Label Sheets**: Avery 5160 or similar (1" x 2.625")

**Print Settings**:
- Paper size: Letter (8.5" x 11")
- Scale: 100% (no scaling)
- Margins: As defined by template

### Bulk QR Code Generation

For many items, you can:
1. Export equipment list to CSV
2. Use a service like [QR Code Generator](https://www.qr-code-generator.com/)
3. Bulk generate and print

### Weather-Resistant Labels

For outdoor equipment:
- Use laminating pouches
- Or weatherproof label stock (Avery 6572)
- Attach with clear packing tape for extra protection

---

## 10. Troubleshooting

### "User profile not found" Error

**Cause**: Auth user exists but no matching row in `users` table.

**Fix**: Add user to `users` table (Step 5.2).

### Login Fails with Valid Credentials

**Cause**: Email not confirmed or user not in `users` table.

**Fix**:
1. In Supabase → Authentication → Users
2. Find user, ensure "Email Confirmed" is checked
3. Verify user exists in `users` table

### Equipment Not Updating Status

**Cause**: Triggers not created.

**Fix**: Re-run Step 3.7 (Create Triggers).

### "Permission denied" Errors

**Cause**: RLS policies not set up correctly.

**Fix**: Re-run Step 3.5 (Enable RLS).

### Blank Page After Login

**Cause**: Missing environment variables.

**Fix**:
1. Check `.env.local` exists and has correct values
2. Restart dev server: `npm run dev`
3. For production: verify Vercel env vars are set

### QR Scanner Not Working

**Cause**: Scanner not in keyboard mode.

**Fix**:
1. Check scanner is in "HID Keyboard" mode
2. Ensure scan input field is focused
3. Try typing equipment code manually to test

### Vercel Deployment Fails

**Cause**: Build error or missing dependencies.

**Fix**:
1. Run `npm run build` locally to check for errors
2. Fix any TypeScript or import errors
3. Redeploy: `vercel --prod`

---

## Quick Reference

### URLs

| Environment | URL |
|-------------|-----|
| Local Dev | http://localhost:5173 |
| Production | https://equipment-checkout-xxxxx.vercel.app |
| Supabase | https://your-project.supabase.co |

### Commands

| Action | Command |
|--------|---------|
| Start dev server | `npm run dev` |
| Build for production | `npm run build` |
| Deploy to Vercel | `vercel --prod` |
| View Vercel logs | `vercel logs` |

### User Roles

| Role | Can Checkout | Can Add Equipment | Can Resolve Deficiencies | See Alerts |
|------|-------------|-------------------|-------------------------|------------|
| volunteer | ✅ | ❌ | ❌ | ❌ |
| chair | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ |

---

## Need Help?

1. Check the console for errors (F12 in browser → Console tab)
2. Check Supabase logs: Dashboard → Logs
3. Check Vercel logs: `vercel logs` or Dashboard → Deployments → Logs

---

**Congratulations!** Your Equipment Checkout system is deployed! 🎉
