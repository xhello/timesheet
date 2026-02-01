# TimeSheet - Face Verification Time Tracking

A modern web application for businesses to track employee clock in/out with face verification. Built with Next.js, face-api.js for face recognition, and Supabase for the backend.

## Features

- **Face Verification**: Employees clock in/out using face recognition via webcam
- **Business Registration**: Auto-generated unique business codes
- **Employee Management**: Register employees with face enrollment
- **Real-time Recognition**: Instant face matching against registered employees
- **Email Notifications**: Business codes sent via email (Resend)

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Face Recognition**: face-api.js (TensorFlow.js based)
- **Backend**: Supabase (PostgreSQL, Authentication)
- **Email**: Resend API

## Requirements

- Node.js 18+
- Supabase account
- Resend account (for email)

## Setup

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL schema from `supabase/schema.sql` in the SQL Editor
3. Copy your project URL and anon key

### 2. Environment Variables

Create a `.env.local` file in the `web/` directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
RESEND_API_KEY=your_resend_api_key
```

### 3. Install Dependencies

```bash
cd web
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
timesheet/
├── supabase/
│   └── schema.sql          # Database schema
└── web/
    ├── public/
    │   └── models/         # Face detection ML models
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   └── send-email/  # Email API route
    │   │   ├── layout.tsx
    │   │   └── page.tsx
    │   ├── components/
    │   │   ├── BusinessLogin.tsx
    │   │   ├── BusinessSignUp.tsx
    │   │   ├── ClockInOut.tsx
    │   │   ├── EmployeeHome.tsx
    │   │   ├── ForgotBusinessID.tsx
    │   │   └── SignUpEmployee.tsx
    │   └── lib/
    │       ├── faceDetection.ts  # Face recognition logic
    │       └── supabase.ts       # Database client
    └── package.json
```

## How It Works

### Business Flow
1. Register a new business with email
2. Receive unique 6-character Business ID via email
3. Share Business ID with employees

### Employee Flow
1. Enter Business ID to access the portal
2. New employees register with face capture
3. Clock in/out by face verification

### Face Recognition
- Uses TinyFaceDetector for fast face detection
- 68-point facial landmarks for liveness detection
- 128-dimensional face descriptors for matching
- Threshold-based matching (0.6 Euclidean distance)

## Database Schema

See `supabase/schema.sql` for the complete database schema including:

- Businesses table with unique codes
- Employees table with face encodings
- Time entries with verification data
- Row Level Security policies

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## License

MIT License
