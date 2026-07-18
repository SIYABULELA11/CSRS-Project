# Frontend-Backend Compatibility Analysis & Testing Checklist

**Generated:** 2026-07-17  
**Frontend URL:** React + Vite at `interface/frontend/`  
**Backend URL:** Node.js/Express at `https://csrs-project.onrender.com` (deployed on Render)  
**Local Backend:** `http://localhost:4000` (development)

---

## 🔍 DISCOVERY SUMMARY

### Frontend API Calls
**Status:** ⚠️ **NO ACTIVE API CALLS FOUND**

**Finding:** The frontend currently makes **zero API requests** to the backend. All data is hardcoded:
- `SIM_A`: Cosmetic Retailer data (hardcoded in `csrs_interface.jsx`)
- `SIM_B`: UK Online Retail data (hardcoded in `csrs_interface.jsx`)

**Infrastructure in place:**
- ✅ `src/config/api.js` — API client configured and ready
- ✅ `.env.local` — Environment variable set to `https://csrs-project.onrender.com`
- ✅ No localhost references found (verified)

---

## 📡 BACKEND ENDPOINTS AVAILABLE

### Health Check
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/health` | Server health check | ✅ Available |

### Dashboard & Overview
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/overview` | Dashboard overview metrics | ✅ Available |
| GET | `/api/dashboard/overview` | Alternative dashboard endpoint | ✅ Available |
| GET | `/api/model/evaluation` | Model evaluation metrics | ✅ Available |
| GET | `/api/model/evaluation/detailed` | Detailed metrics (query: `includePoints`) | ✅ Available |

### Segments
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/segments` | All segments | ✅ Available |
| GET | `/api/segments/:segment` | Specific segment by name | ✅ Available |

### Customers
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/customers` | All customers (supports query filters) | ✅ Available |
| GET | `/api/customers/:id` | Specific customer by ID | ✅ Available |

### Data Analysis
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/migration` | Migration/segment migration data | ✅ Available |
| GET | `/api/cycles` | Cycle information | ✅ Available |
| GET | `/api/cycles/:cycleId/overview` | Overview for specific cycle | ✅ Available |
| GET | `/api/schema` | Database schema information | ✅ Available |
| GET | `/api/tables/:table` | Table rows (query: pagination, filters) | ✅ Available |
| GET | `/api/filters` | Available filter options | ✅ Available |
| GET | `/api/features/summary` | Feature summary (query: `cycleId`) | ✅ Available |
| GET | `/api/features/correlation` | Feature correlation (query: `cycleId`) | ✅ Available |

### Artifacts & Static Files
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/artifacts` | All artifacts (query: `category`) | ✅ Available |
| GET | `/api/charts` | Chart definitions | ✅ Available |
| GET | `/api/images` | Image metadata | ✅ Available |
| GET | `/api/images/:kind` | Images by kind/category | ✅ Available |
| GET | `/api/html/:kind` | HTML reports by kind | ✅ Available |
| GET | `/api/reports` | Available reports | ✅ Available |
| GET | `/api/files/:path(*)` | File download endpoint | ✅ Available |

### Search & Recommendations
| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/search` | Global search (query: `q` required) | ✅ Available |
| GET | `/api/recommendations/:segment` | Recommendations for segment | ✅ Available |

---

## ⚠️ CRITICAL ISSUE: CORS CONFIGURATION

### Problem
**Your backend's CORS is configured for localhost development only.**

**Current Configuration (Backend `.env`):**
```
CORS_ORIGIN=http://localhost:5173
```

**This blocks requests from:**
- ❌ Your Render deployment domain
- ❌ Any production frontend URL
- ✅ Only allows `http://localhost:5173` (Vite dev server)

### Solution
Update the backend `.env` file on Render to include your frontend URL.

**Action Required (on Render environment):**

1. Log into your Render dashboard
2. Go to your backend service
3. Navigate to **Environment** settings
4. Update `CORS_ORIGIN` to:
   ```
   https://your-frontend-domain.com
   ```

**Or** if the frontend is hosted on a different platform, use:
```
CORS_ORIGIN=http://localhost:5173,https://your-frontend-domain.com
```

**Or** for development + production:
```
CORS_ORIGIN=http://localhost:5173,http://localhost:3000,https://your-frontend-domain.com
```

**⚠️ Note:** The backend code already has the CORS logic configured:
- ✅ Accepts configured origins
- ✅ Accepts all localhost variants (localhost, 127.0.0.1, any port)
- ✅ Uses proper CORS headers

---

## 🔒 AUTHENTICATION & AUTHORIZATION

### Current Status
**No authentication/authorization required or implemented.**

- ✅ All endpoints are public
- ✅ No JWT tokens needed
- ✅ No session management required
- ✅ No API key validation
- ✅ No user login flow

### Frontend Implications
**No changes needed for headers:**
```javascript
// Current fetch works fine:
fetch('https://csrs-project.onrender.com/api/overview')

// No need for:
// - Authorization: Bearer token
// - X-API-Key headers
// - Cookie management
// - CSRF tokens
```

---

## 📋 END-TO-END TESTING CHECKLIST

### Setup (Prerequisites)
- [ ] Verify backend is deployed on Render: `curl https://csrs-project.onrender.com/health`
- [ ] Frontend is built: `npm run build` in `interface/frontend/`
- [ ] Environment variables are set correctly
- [ ] CORS configuration is updated (see above)

---

### Feature 1: Health Check
**What should happen:** Frontend can verify backend is alive

**API Endpoint:** `GET /health`

**Expected Response:**
```json
{
  "status": "ok"
}
```

**Test Steps:**
1. Open browser console
2. Run:
   ```javascript
   fetch('https://csrs-project.onrender.com/health')
     .then(r => r.json())
     .then(d => console.log(d))
   ```
3. Should see: `{ status: "ok" }`

**Status:** ✅ Ready to test

---

### Feature 2: Dashboard Overview
**What should happen:** Load main dashboard metrics (total customers, segments, avg spend, etc.)

**Frontend Component:** `HomePage` → `Overview`

**API Endpoint:** `GET /api/overview`

**Expected Response Format:**
```json
{
  "totalCustomers": 22702,
  "segments": 5,
  "avgSpend": "R170",
  "churnRisk": "18%",
  "silhouette": 0.62,
  "xbIndex": "0.14",
  "distribution": [
    { "name": "High Value Loyal", "pct": 18.1, "color": "#1a6fb5" },
    // ... more segments
  ],
  "monthly": [
    { "month": "Jul", "revenue": 659781 },
    // ... more months
  ],
  "avgSpendPerSeg": [
    { "name": "High Value Loyal", "spend": 187 },
    // ... more segments
  ],
  "customers": [
    { "id": "CU-4138", "age": 43, "segment": "High Value Loyal", "spend": "R12,400", "recency": "8 days", "freq": 17, "location": "Cape Town" },
    // ... more customers
  ]
}
```

**How to verify:**
1. From frontend, call:
   ```javascript
   import { apiGet } from './config/api';
   const data = await apiGet('/api/overview');
   console.log(data);
   ```
2. Compare structure with `SIM_A` hardcoded data
3. Should have same fields/format

**Current Status:**
- ❌ **NOT INTEGRATED** — Frontend uses hardcoded `SIM_A`
- ⚠️ Response structure may differ slightly

**Integration Steps:**
- [ ] Call `/api/overview` for Simulation A data
- [ ] Call `/api/dashboard/overview` as alternative
- [ ] Parse response and map to component props
- [ ] Add loading state while fetching
- [ ] Add error handling with retry logic

---

### Feature 3: Model Evaluation Metrics
**What should happen:** Display model performance metrics (Silhouette Score, Xie-Beni Index)

**Frontend Component:** `ModelPage` → Metrics display

**API Endpoints:** 
- `GET /api/model/evaluation` (basic)
- `GET /api/model/evaluation/detailed?includePoints=true` (with detail)

**Expected Response:**
```json
{
  "silhouette": 0.62,
  "xbIndex": "0.14"
  // ... evaluation metrics
}
```

**How to verify:**
1. Call endpoint
2. Compare values with `SIM_A.silhouette` and `SIM_A.xbIndex`
3. Verify data types match

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 4: Segments
**What should happen:** Fetch all customer segments with details

**Frontend Component:** `Segments` component

**API Endpoints:**
- `GET /api/segments` — All segments
- `GET /api/segments/:segment` — Specific segment (e.g., `/api/segments/High Value Loyal`)

**Expected Response Structure:**
```json
{
  "segments": [
    {
      "id": "A",
      "label": "High Value Loyal",
      "size": "18%",
      "recency": "Low (8 days)",
      "frequency": "High (2.3×)",
      "monetary": "High (R187)",
      "desc": "Frequent buyers..."
    }
    // ... more segments
  ]
}
```

**How to verify:**
```javascript
const allSegments = await apiGet('/api/segments');
const specificSegment = await apiGet('/api/segments/High Value Loyal');
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 5: Customers & Filtering
**What should happen:** Fetch customer list with optional filtering

**Frontend Component:** `Customers` component

**API Endpoint:** `GET /api/customers`

**Query Parameters (if supported):**
- `segment` — Filter by segment
- `limit` — Limit results
- `offset` — Pagination offset

**Expected Response:**
```json
{
  "customers": [
    {
      "id": "CU-4138",
      "age": 43,
      "segment": "High Value Loyal",
      "spend": "R12,400",
      "recency": "8 days",
      "freq": 17,
      "location": "Cape Town"
    }
    // ... more customers
  ],
  "total": 22702
}
```

**How to verify:**
```javascript
// All customers
const all = await apiGet('/api/customers');

// Filtered
const filtered = await apiGet('/api/customers?segment=High Value Loyal');

// With pagination
const paginated = await apiGet('/api/customers?limit=10&offset=0');
```

**Current Status:** ❌ **NOT INTEGRATED**

**Specific Customer:** `GET /api/customers/:id`

---

### Feature 6: Segment Migration
**What should happen:** Track how customers move between segments over time

**Frontend Component:** `ModelEvaluation` or custom migration view

**API Endpoint:** `GET /api/migration`

**Expected Response:**
```json
{
  "migrationMatrix": [
    [95, 3, 1, 0, 1],  // From segment A to other segments
    [2, 96, 0, 0, 2],  // From segment B...
    // ... matrix data
  ],
  "migrations": [
    { "from": "A", "to": "B", "count": 123 },
    // ... migration flows
  ]
}
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 7: Time Cycles
**What should happen:** Show available time periods for data analysis

**Frontend Component:** Model tabs/filters

**API Endpoints:**
- `GET /api/cycles` — All cycles
- `GET /api/cycles/:cycleId/overview` — Specific cycle overview

**Expected Response:**
```json
{
  "cycles": [
    { "id": "cycle_0", "label": "Time Cycle 0", "baseline": true },
    { "id": "cycle_1", "label": "Time Cycle 1" },
    // ... more cycles
  ]
}
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 8: Data Schema & Tables
**What should happen:** Display database structure and table contents

**Frontend Component:** Admin/debug view (if implemented)

**API Endpoints:**
- `GET /api/schema` — Database structure
- `GET /api/tables/:table` — Table rows

**Example:**
```javascript
const schema = await apiGet('/api/schema');
const tableData = await apiGet('/api/tables/segments');
const filtered = await apiGet('/api/tables/customers?segment=High Value Loyal');
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 9: Features & Correlation
**What should happen:** Show feature analysis and correlation matrix

**Frontend Component:** Feature analysis section (if implemented)

**API Endpoints:**
- `GET /api/features/summary` — Feature summary
- `GET /api/features/correlation` — Correlation data

**Expected Response:**
```json
{
  "features": ["Recency", "Frequency", "Monetary", "RF", "RM", "FM"],
  "summary": { "Recency": {...}, "Frequency": {...} },
  "correlation": {
    "Recency": { "Frequency": 0.45, "Monetary": 0.32 },
    // ... correlation matrix
  }
}
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 10: Artifacts & Static Files
**What should happen:** Access images, charts, HTML reports

**Frontend Component:** Image display, report links

**API Endpoints:**
- `GET /api/artifacts` — All artifacts
- `GET /api/images` — Image list
- `GET /api/images/:kind` — Images by type
- `GET /api/html/:kind` — HTML reports
- `GET /api/files/:path` — File download

**How to use:**
```javascript
const artifacts = await apiGet('/api/artifacts');
const images = await apiGet('/api/images');
const charts = await apiGet('/api/charts');

// Download file
window.location.href = 'https://csrs-project.onrender.com/api/files/model/report.pdf';
```

**Current Status:** ✅ **PARTIALLY WORKING** (static files already served)

---

### Feature 11: Search
**What should happen:** Global search across customers, segments, reports

**Frontend Component:** Search bar (if implemented)

**API Endpoint:** `GET /api/search?q=search_term`

**Expected Response:**
```json
{
  "results": [
    { "type": "customer", "id": "CU-4138", "label": "Customer CU-4138" },
    { "type": "segment", "id": "A", "label": "High Value Loyal" },
    // ... results
  ]
}
```

**How to verify:**
```javascript
const results = await apiGet('/api/search?q=John');
```

**Current Status:** ❌ **NOT INTEGRATED**

---

### Feature 12: Recommendations
**What should happen:** Get actionable recommendations for a segment

**Frontend Component:** Insights & Actions view

**API Endpoint:** `GET /api/recommendations/:segment`

**Expected Response:**
```json
{
  "segment": "High Value Loyal",
  "actions": [
    "Offer loyalty rewards programme",
    "Personalised product recommendations",
    "Early access to new ranges"
  ],
  "priority": "high"
}
```

**How to verify:**
```javascript
const recs = await apiGet('/api/recommendations/High Value Loyal');
```

**Current Status:** ❌ **NOT INTEGRATED**

---

## 🌐 CORS TESTING CHECKLIST

### Test 1: Simple GET Request
**What it tests:** Basic CORS headers for GET requests

**Test:**
```javascript
fetch('https://csrs-project.onrender.com/api/overview')
  .then(r => r.json())
  .then(d => console.log('✅ Success:', d))
  .catch(e => console.error('❌ Failed:', e))
```

**Expected:** 
- ✅ Response received
- ✅ No CORS error in console

**Possible Error:**
```
Access to fetch at 'https://csrs-project.onrender.com/api/overview' 
from origin 'https://your-frontend.com' has been blocked by CORS policy
```

**Fix:** Update backend `CORS_ORIGIN` environment variable (see CORS Configuration section above)

---

### Test 2: Preflight Request (OPTIONS)
**What it tests:** Browser auto-sends OPTIONS before actual request

**Test:**
```javascript
// This automatically triggers OPTIONS preflight
fetch('https://csrs-project.onrender.com/api/overview', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
})
```

**Expected:**
- Browser sends: `OPTIONS /api/overview`
- Backend responds with CORS headers
- Browser then sends: `GET /api/overview`

**Status:** ✅ Backend handles this correctly

---

### Test 3: Content-Type Header
**What it tests:** Custom header handling

**Test:**
```javascript
fetch('https://csrs-project.onrender.com/api/overview', {
  headers: {
    'Content-Type': 'application/json'
  }
})
```

**Expected:**
- ✅ Request succeeds with custom header

**Status:** ✅ Configured correctly

---

### Test 4: Credentials (if needed in future)
**What it tests:** Cookie/credential handling

**Current Status:** ⚠️ **Not implemented**

**When needed:** If you add authentication later

**Code:**
```javascript
fetch('https://csrs-project.onrender.com/api/overview', {
  credentials: 'include'  // Include cookies
})
```

---

## 🚀 PRODUCTION READINESS CHECKLIST

### Backend (Render)
- [ ] **CORS:** Update `CORS_ORIGIN` environment variable
- [ ] **Database:** Verify database path is correct
- [ ] **Artifacts:** Verify artifact root path is accessible
- [ ] **Logs:** Check Render logs for errors
- [ ] **Health:** Test `https://csrs-project.onrender.com/health` returns `{ status: "ok" }`

### Frontend (Deployment)
- [ ] **Build:** `npm run build` completes without errors
- [ ] **Environment:** `.env` file configured with correct API URL
- [ ] **No localhost:** Verify no hardcoded localhost in production build
- [ ] **HTTPS:** Ensure frontend is served over HTTPS
- [ ] **API calls:** Integrate actual API calls (currently hardcoded data)

---

## 📊 COMPATIBILITY MATRIX

| Feature | Backend Ready | Frontend Uses | Integration | Status |
|---------|--------------|---------------|-------------|--------|
| Health Check | ✅ | ❌ | Simple | ✅ Ready |
| Dashboard Overview | ✅ | ✅ Hardcoded | Needed | ⚠️ Partial |
| Segments | ✅ | ✅ Hardcoded | Needed | ⚠️ Partial |
| Customers | ✅ | ✅ Hardcoded | Needed | ⚠️ Partial |
| Model Evaluation | ✅ | ✅ Hardcoded | Needed | ⚠️ Partial |
| Migration | ✅ | ❌ | Needed | ❌ Missing |
| Time Cycles | ✅ | ❌ | Needed | ❌ Missing |
| Features & Correlation | ✅ | ❌ | Needed | ❌ Missing |
| Artifacts/Images | ✅ | ✅ | Partial | ⚠️ Partial |
| Search | ✅ | ❌ | Needed | ❌ Missing |
| Recommendations | ✅ | ✅ Hardcoded | Needed | ⚠️ Partial |

---

## 🔧 NEXT STEPS TO FULL INTEGRATION

### Step 1: Fix CORS (CRITICAL)
```bash
# On Render, update environment variable:
CORS_ORIGIN=http://localhost:5173,https://your-frontend-domain.com
```

### Step 2: Test Backend Connectivity
```javascript
// In browser console
import { apiGet } from './config/api';

// Should work immediately
apiGet('/api/overview')
  .then(d => console.log('✅ Backend connected:', d))
  .catch(e => console.error('❌ Error:', e))
```

### Step 3: Replace Hardcoded Data
Replace static `SIM_A` and `SIM_B` with:
```javascript
const [dataA, setDataA] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  apiGet('/api/overview')
    .then(setDataA)
    .catch(err => console.error('Failed to load:', err))
    .finally(() => setLoading(false));
}, []);
```

### Step 4: Add Error Handling
- Add loading spinners
- Add error messages
- Add retry buttons
- Add offline detection

### Step 5: Test Each Endpoint
Follow the END-TO-END TESTING CHECKLIST above

---

## 📝 SUMMARY

| Item | Status | Details |
|------|--------|---------|
| **Frontend API Calls** | ❌ None | Uses hardcoded data (SIM_A, SIM_B) |
| **API Client Ready** | ✅ Yes | `src/config/api.js` configured |
| **Environment Variable** | ✅ Set | `.env.local`: `VITE_API_URL=https://csrs-project.onrender.com` |
| **Localhost References** | ✅ None | Verified in source + build |
| **CORS Configuration** | ⚠️ Needs Fix | Backend allows localhost only, needs frontend domain |
| **Authentication** | ✅ None needed | All endpoints are public |
| **Backend Endpoints** | ✅ Available | 25+ endpoints ready to use |
| **Production Ready** | ⚠️ Partial | Backend ready, frontend needs API integration |

---

## ⚡ ACTION ITEMS

### Immediate (Required)
1. **Update CORS on Render:** Add frontend domain to `CORS_ORIGIN`
2. **Test Backend:** Verify health endpoint works
3. **Test CORS:** Verify requests from frontend don't get blocked

### Short-term (Recommended)
4. **Integrate API calls:** Replace hardcoded data with API calls
5. **Add error handling:** Handle network failures gracefully
6. **Add loading states:** Show loading spinners while fetching
7. **Test each endpoint:** Follow testing checklist above

### Future
8. **Add authentication:** If needed for future features
9. **Optimize caching:** Cache frequently-requested data
10. **Add offline support:** Service workers, local caching

---

*Last Updated: 2026-07-17*
*Backend: https://csrs-project.onrender.com*
*Frontend: React + Vite (interface/frontend/)*
