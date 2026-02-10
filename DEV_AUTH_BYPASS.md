# Development Authentication Bypass

## Overview

When running in development mode, authentication can be bypassed to speed up testing and development workflow.

## How It Works

### Backend Changes

1. **Auth Middleware** (`src/middleware/auth.ts`)
   - Added `devAuthBypass` middleware for automatic authentication in dev mode
   - Added `requireAuth` middleware for routes that still need auth

2. **Auth Route** (`src/routes/auth.ts`)
   - Modified `/api/auth/verify` endpoint
   - In development mode (`NODE_ENV !== 'production'`), using `dev-token` bypasses LINE API verification
   - Returns mock user data with admin role

## Usage

### Frontend Login

In your frontend login component, when in development mode, use:

```typescript
// Use this token in development Instead of actual LINE access token
const accessToken = "dev-token";

const response = await fetch("http://localhost:3002/api/auth/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accessToken }),
});

const data = await response.json();
// Returns mock user data in dev mode
```

### Mock User Data

```json
{
  "success": true,
  "user": {
    "id": 1,
    "lineUserId": "dev-user-123",
    "displayName": "Dev User",
    "pictureUrl": "https://via.placeholder.com/150",
    "email": "dev@example.com",
    "role": "admin"
  }
}
```

### Testing

1. Start the backend in development mode:

   ```bash
   cd apps/maintenance_app/backend
   npm run dev
   ```

2. In your frontend, use `dev-token` as the access token

3. The backend will bypass LINE API verification and return mock user data

## Security Notes

⚠️ **IMPORTANT**: This bypass only works when:

- `NODE_ENV !== 'production'`
- Access token is exactly `'dev-token'`

In production, the standard LINE authentication flow is enforced.

## Environment Setup

Make sure your `.env` file does NOT have `NODE_ENV=production` for development:

```env
# Development
NODE_ENV=development
PORT=3002
```
