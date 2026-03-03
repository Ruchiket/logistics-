# Railway Deployment Guide

This app has two services: **backend** (FastAPI/Python) and **frontend** (React).
Deploy them as two separate Railway services from the same repo.

---

## Step 1: Deploy the Backend

1. In Railway, click **New Project → Deploy from GitHub repo**
2. Select this repo
3. When asked for the **Root Directory**, leave it as `/` (root)
4. Railway will use `nixpacks.toml` and `railway.toml` at the root — this points to the backend

### Backend Environment Variables (required)
Set these in Railway → your backend service → **Variables**:

| Variable | Value |
|---|---|
| `MONGO_URL` | Your MongoDB Atlas connection string |
| `DB_NAME` | e.g. `logistic_invoice_db` |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `CORS_ORIGINS` | Your frontend Railway URL (set after frontend deploys) |

5. After deploy, copy your backend URL e.g. `https://logisticinvoiceanalyser-backend.up.railway.app`

---

## Step 2: Deploy the Frontend

1. In Railway, click **New Service → GitHub Repo** (same repo)
2. Set the **Root Directory** to `frontend`
3. Railway will use `frontend/railway.toml`

### Frontend Environment Variables (required)
Set in Railway → your frontend service → **Variables**:

| Variable | Value |
|---|---|
| `REACT_APP_BACKEND_URL` | Your backend Railway URL from Step 1 |

---

## Step 3: Update CORS

Once both are deployed, go back to the **backend service** and update:
```
CORS_ORIGINS=https://your-frontend.up.railway.app
```

---

## MongoDB Setup

Use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) free tier:
1. Create a cluster
2. Create a database user
3. Whitelist all IPs (`0.0.0.0/0`) for Railway
4. Copy the connection string into `MONGO_URL`
