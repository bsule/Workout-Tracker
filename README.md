# Workout Tracker

Full-stack workout tracker. Create routines, log weight/reps per session, see your estimated one-rep max climb over time, and use the standalone 1RM calculator.

- **Backend:** Django + Django REST Framework (token auth, SQLite)
- **Frontend:** Next.js 16 + React 19 + Tailwind

## Run it locally

You need two terminals: one for the API, one for the web app.

### 1. Backend (port 8007)

```bash
cd backend
pip install -r requirements.txt
cd workout_tracker
python manage.py migrate
python manage.py runserver 8007
```

### 2. Frontend (port 3215)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3215>.

## Configuration

The frontend talks to `http://localhost:8007/api` by default. Override with:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-api.example.com/api
```

CORS origins on the backend can be customized via the `DJANGO_CORS_ORIGINS` env var (comma-separated).
