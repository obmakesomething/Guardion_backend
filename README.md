# Guardion Backend

**Emergency Unlock Ops Platform** - MVP Backend

A request-form-based dispatch system for emergency door unlocking / smart lock support.
Replaces phone-only workflows with structured requests, real-time tracking, OTP completion, and auditable logs.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

## Architecture Overview

```
src/
├── config/           # Configuration management
├── db/               # Database connection and migrations
├── lib/              # Shared utilities (errors, etc.)
├── middleware/       # Express middleware (auth, validation, error handling)
├── modules/          # Domain modules
│   ├── audit/        # Audit logging
│   ├── auth/         # Authentication (local, OAuth, phone OTP)
│   ├── billing/      # Accruals and invoicing
│   ├── case/         # Case management and state machine
│   ├── dispatch/     # Technician dispatch and GPS tracking
│   ├── evidence/     # Evidence upload and access control
│   ├── opinion/      # Technical opinion reports
│   ├── otp/          # Case completion OTP
│   └── realtime/     # SSE event streaming
├── routes/           # API route definitions
├── types/            # TypeScript types and enums
└── index.ts          # Application entry point
```

## Core Concepts

### Participants (Actors)

- **Customer (B2C)**: Resident/occupant who needs door unlocked
- **Callcenter/Office (Org)**: Triage, risk gating, dispatch, case acceptance
- **Technician (Tech)**: Travel + work execution, GPS sharing, evidence upload

### What We Do NOT Do (MVP)

- Online payments (only record accruals for later billing)
- Automated landlord billing
- Legal determinations (only technical opinion reports)

## Case State Machine

```
SUBMITTED
    ↓ (risk gate)
DISPATCHING ←→ NEED_APPROVAL
    ↓
ACCEPTED (accrual created: 3,000 KRW)
    ↓
ASSIGNED
    ↓
EN_ROUTE → ARRIVED → WORKING → OTP_PENDING
    ↓
COMPLETED (OTP verified)

Terminal states: CANCELLED, EXPIRED, REJECTED, FAILED
```

### Key Rules

1. **ACCEPTED creates an accrual** - When callcenter accepts, a 3,000 KRW receivable is recorded
2. **COMPLETED requires OTP** - Only OTP verification can complete a case
3. **Evidence access control** - Tech can only view customer photos after assignment

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Email/password login |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Revoke session |
| GET | `/auth/me` | Get current user profile |
| POST | `/auth/oauth/google/start` | Start Google OAuth (PKCE) |
| POST | `/auth/oauth/google/callback` | Complete Google OAuth |
| POST | `/auth/oauth/google/link` | Link Google to existing user |
| POST | `/auth/phone/send` | Send phone OTP |
| POST | `/auth/phone/verify` | Verify phone OTP |
| POST | `/auth/link-phone` | Link phone to user |

### Customer

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/cases` | Create new case |
| GET | `/cases` | List customer's cases |
| GET | `/cases/:id` | Get case detail |
| POST | `/cases/:id/cancel` | Cancel case |
| POST | `/cases/:id/evidence/presign` | Get upload URL |
| POST | `/cases/:id/evidence/complete` | Complete upload |
| POST | `/cases/:id/otp/verify` | Verify OTP (complete case) |
| GET | `/cases/:id/report` | Get report link |

### Callcenter

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/:orgId/cases` | List org queue |
| POST | `/cases/:id/risk` | Set risk decision |
| POST | `/cases/:id/dispatch/offers` | Create dispatch offers |
| POST | `/cases/:id/accept` | Accept case (creates accrual) |
| POST | `/cases/:id/assign` | Assign technician |
| GET | `/techs/available` | List available techs |
| GET | `/orgs/:orgId/accruals` | List accruals |
| POST | `/orgs/:orgId/invoices/generate` | Generate invoice |

### Technician

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tech/cases/assigned` | List assigned cases |
| POST | `/tech/cases/:id/status` | Update case status |
| POST | `/tech/location/ping` | Send GPS ping |
| POST | `/tech/cases/:id/otp/request` | Request OTP |
| POST | `/tech/cases/:id/opinion` | Submit opinion report |

### Realtime (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/realtime/cases/:caseId` | Case event stream |
| GET | `/realtime/orgs/:orgId/cases` | Org queue stream |
| GET | `/realtime/tech/me` | Tech assignment stream |

## RBAC Matrix

| Capability | Customer | Callcenter | Tech | Admin |
|------------|:--------:|:----------:|:----:|:-----:|
| Create own case | W | - | - | - |
| View own case | R | - | - | R |
| View org queue | - | R | - | R |
| Accept case (creates accrual) | - | **W** | - | R |
| Assign tech | - | **W** | - | R |
| View customer photos | R | R | **R after assignment** | R |
| Tech GPS ping | - | - | W | R |
| OTP request | - | R | W | R |
| OTP verify | W | R | R | R |
| Submit opinion | - | R | W | R |

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/guardion

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# AWS S3 (evidence storage)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=guardion-evidence

# OTP
OTP_LENGTH=6
OTP_EXPIRES_MINUTES=10
OTP_MAX_ATTEMPTS=5

# Accrual
DEFAULT_ACCRUAL_AMOUNT=3000
```

## Database Schema

Main tables:
- `users` - User accounts
- `orgs` - Organizations
- `org_memberships` - User-org relationships
- `cases` - Service cases
- `dispatch_offers` - Tech dispatch offers
- `tech_availability` - Tech online/busy status
- `tech_location_pings` - GPS tracking
- `evidence` - Photos/documents
- `evidence_access_logs` - View audit
- `otp_challenges` - Case completion OTP
- `tech_opinion_reports` - Technical opinions
- `accruals` - Receivables
- `invoices` / `invoice_lines` - Billing
- `audit_events` - Global audit log

Authentication tables:
- `auth_identities` - OAuth/phone identities
- `auth_sessions` - Refresh token sessions
- `phone_otps` - Phone verification OTPs
- `oauth_states` - OAuth PKCE state
- `case_access_tokens` - Guest access tokens

## Audit Events

All meaningful actions are logged:
- `CASE_CREATED`, `CASE_SUBMITTED`
- `RISK_SET`, `APPROVAL_REQUESTED/RESOLVED`
- `DISPATCH_OFFER_SENT/RESPONDED`
- `CASE_ACCEPTED`, `ACCRUAL_CREATED`
- `CASE_ASSIGNED`, `CASE_STATUS_CHANGED`
- `EVIDENCE_UPLOADED`, `EVIDENCE_VIEWED`
- `OTP_REQUESTED`, `OTP_VERIFIED_SUCCESS/FAIL`
- `OPINION_SUBMITTED`
- `INVOICE_GENERATED`
- `PERMISSION_DENIED`

## Non-Goals (MVP)

- Online payment (PG/Stripe)
- Customer upfront fees
- Automated landlord billing
- Government24 integration
- ID document storage/OCR

## Scripts

```bash
npm run dev          # Development server with hot reload
npm run build        # TypeScript compilation
npm run start        # Production server
npm run typecheck    # Type checking
npm run lint         # ESLint
npm run test         # Jest tests
npm run db:migrate   # Run database migrations
```

## License

Proprietary - All rights reserved
