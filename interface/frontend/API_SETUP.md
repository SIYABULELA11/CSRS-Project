# Frontend API Configuration - Updated for Render Backend

## Summary of Changes

Your frontend has been prepared to communicate with the deployed Render backend at:
**https://csrs-project.onrender.com**

## Files Created/Updated

### 1. **`.env.local`** (Created)
**Location:** `interface/frontend/.env.local`

```
VITE_API_URL=https://csrs-project.onrender.com
```

**Purpose:** Centralized environment variable for the backend API URL.
- Automatically picked up by Vite during development and build
- Automatically excluded from git (covered by `*.local` in `.gitignore`)
- For production, create a `.env` file with the same variable

---

### 2. **`src/config/api.js`** (Created)
**Location:** `interface/frontend/src/config/api.js`

**Purpose:** Centralized API client for all backend communication.

**Available functions:**
```javascript
import { apiGet, apiPost, apiPut, apiDelete, getApiUrl } from './config/api';

// GET request
const data = await apiGet('/api/segments');

// POST request
const result = await apiPost('/api/upload', { payload });

// PUT request
const updated = await apiPut('/api/customer/123', { name: 'John' });

// DELETE request
await apiDelete('/api/item/456');

// Get current API URL (debugging)
console.log(getApiUrl()); // https://csrs-project.onrender.com
```

---

## Current Frontend Status

### ✅ No localhost references
- Verified: 0 localhost references in entire codebase
- Verified: 0 localhost references in production build (`dist/`)

### ✅ Environment variable ready
- `VITE_API_URL` is loaded from `.env.local`
- Will use fallback URL if not provided: `https://csrs-project.onrender.com`

### ✅ API client ready
- Centralized fetch wrapper with error handling
- Helper functions for GET, POST, PUT, DELETE
- Built-in JSON parsing and error logging

### ℹ️ Current implementation note
- **The frontend currently uses hardcoded data** (`SIM_A` and `SIM_B` objects)
- No active API calls are made
- When you decide to fetch live data from the backend, use the `src/config/api.js` client

---

## How to Use (When Adding API Calls)

### Example: Fetch segments from backend

**Before (without API config):**
```javascript
// ❌ Hardcoded URL - won't work across environments
const response = await fetch('http://localhost:5000/api/segments');
```

**After (with API config):**
```javascript
// ✅ Uses environment variable
import { apiGet } from './config/api';

const segments = await apiGet('/api/segments');
```

---

## Environment Configuration

### Development (local)
1. `.env.local` contains: `VITE_API_URL=https://csrs-project.onrender.com`
2. Run: `npm run dev`
3. Frontend will call `https://csrs-project.onrender.com/api/*`

### Production (Render/deployment)
1. Create `.env` file (or `.env.production`) with same structure
2. Or set environment variable in deployment platform
3. Run: `npm run build` → `npm run preview`
4. Frontend will call the configured API URL

---

## Build Verification

✅ **Frontend builds successfully**
```
✓ 600 modules transformed.
✓ built in 4.13s
```

✅ **No localhost references in build output**
- Verified with: `Get-ChildItem -Recurse -File | Select-String "localhost"`
- Result: **0 matches**

---

## Files Checked (No API Calls Found)
- ✓ `src/main.jsx` - Entry point, no API calls
- ✓ `src/App.jsx` - Router/wrapper, no API calls
- ✓ `src/csrs_interface.jsx` - Main component, uses hardcoded data only
- ✓ `src/config/api.js` - **NEW** - API client (ready for use)
- ✓ `vite.config.js` - Build config, no API references
- ✓ `package.json` - Dependencies list, no secrets

---

## Next Steps

### To integrate live data:

1. **Call the API** using the new client:
   ```javascript
   import { apiGet } from './config/api';
   
   // In your component or service:
   const segments = await apiGet('/api/segments');
   ```

2. **Replace hardcoded data** with API responses:
   ```javascript
   // Example: Replace SIM_A with live data
   const [simulationA, setSimulationA] = useState(null);
   
   useEffect(() => {
     apiGet('/api/simulations/a')
       .then(data => setSimulationA(data))
       .catch(err => console.error('Failed to load simulation A:', err));
   }, []);
   ```

3. **Handle CORS** if needed:
   - Backend is already configured with CORS (see `interface/backend/src/app.ts`)
   - Frontend will work automatically

---

## Summary

| Aspect | Status | Details |
|--------|--------|---------|
| Environment Variable | ✅ Ready | `VITE_API_URL=https://csrs-project.onrender.com` |
| API Client | ✅ Ready | `src/config/api.js` with GET/POST/PUT/DELETE helpers |
| Localhost References | ✅ None | Verified: 0 in source + 0 in production build |
| Build Status | ✅ Success | Frontend builds without errors |
| CORS Configuration | ✅ Ready | Backend already configured |
| .gitignore | ✅ Correct | `.env.local` excluded automatically |

Your frontend is now **fully prepared** to communicate with the deployed backend!
