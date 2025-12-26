# Equipment Checkout System

A club equipment checkout and tracking system for Groton Sportsmen's Club.

## Features

- **USB QR Scanner Support** - Scan equipment codes for instant lookup
- **Checkout/Return Workflow** - Track who has what equipment
- **Two Use Types** - Club work vs. personal use
- **Deficiency Reporting** - Report issues during equipment return
- **Automatic Status Updates** - Equipment marked unavailable when checked out
- **Role-Based Access** - Volunteers can checkout, Chairs can manage inventory

## Tech Stack

- React 18 with Vite
- Supabase (Auth, Database, RLS)
- QRCode.js for QR generation
- date-fns for date formatting

## Setup Instructions

### 1. Prerequisites

- Node.js 18+
- Existing Supabase project (same as Kitchen Inventory)
- npm or yarn

### 2. Clone and Install

```bash
cd equipment-checkout
npm install
```

### 3. Database Setup

Run the SQL from `DATABASE_SETUP.md` in your Supabase SQL Editor.

This adds tables prefixed with `eq_` to your existing database:
- `eq_equipment` - Equipment inventory
- `eq_checkouts` - Checkout records
- `eq_deficiencies` - Issue reports

### 4. Environment Variables

Create `.env.local` with your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Use the same values as your Kitchen Inventory app.

### 5. Run Development Server

```bash
npm run dev
```

### 6. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add environment variables in Vercel dashboard.

## User Roles

| Role | Permissions |
|------|-------------|
| Volunteer | Checkout/return equipment, report deficiencies |
| Chair | All volunteer permissions + add equipment, resolve deficiencies |
| Admin | Full access |

## USB Scanner Setup

1. Purchase a USB barcode/QR scanner ($20-50)
2. Plug into Windows computer
3. Scanner acts like keyboard - scans into any focused input field
4. Generate and print QR codes from the Inventory tab

## Project Structure

```
equipment-checkout/
├── src/
│   ├── App.jsx          # Main application
│   ├── main.jsx         # Entry point
│   ├── index.css        # Global styles
│   └── supabaseClient.js # Supabase config
├── DATABASE_SETUP.md    # SQL schema
├── .env.example         # Environment template
├── package.json
└── vite.config.js
```

## Integration with Kitchen Inventory

Both apps share:
- Same Supabase project
- Same `users` table
- Same authentication

This keeps you within Supabase free tier limits.
