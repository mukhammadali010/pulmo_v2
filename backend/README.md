# PulmoAI Backend

FastAPI service for PulmoAI — AI-powered pulmonology diagnostics.

## Stack

- **Python 3.11+** with `pyproject.toml`
- **FastAPI** (async, auto OpenAPI docs at `/docs`)
- **SQLAlchemy 2.0** async + **asyncpg** driver
- **Alembic** for schema migrations
- **PostgreSQL** for storage
- **JWT** auth (access + refresh tokens) with **bcrypt** password hashing
- **Anthropic Claude** for AI diagnostics (later phases)

## First-time setup

### 1. Create the database and user

Open a `psql` shell as the postgres superuser. On macOS Homebrew install, that is your own macOS user:

```bash
psql postgres
```

Inside `psql`:

```sql
CREATE USER pulmoai WITH PASSWORD 'pulmoai';
CREATE DATABASE pulmoai_dev OWNER pulmoai;
GRANT ALL PRIVILEGES ON DATABASE pulmoai_dev TO pulmoai;
\q
```

> If you prefer different credentials, update `DATABASE_URL` in `.env` accordingly.

### 2. Create a virtualenv and install dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 3. Configure environment

```bash
cp .env.example .env
# edit .env — at minimum set JWT_SECRET to a long random string
# python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 4. Apply database migrations

```bash
alembic upgrade head
```

### 5. Run the dev server

```bash
uvicorn app.main:app --reload --port 8000
```

Open the auto-generated docs at <http://localhost:8000/docs>.

## Common tasks

### Create a new migration

After editing SQLAlchemy models:

```bash
alembic revision --autogenerate -m "add patients table"
alembic upgrade head
```

### Run tests

```bash
pytest
```

### Format / lint

```bash
ruff format .
ruff check . --fix
```

## Endpoints (current)

| Method | Path                       | Auth | Description           |
| ------ | -------------------------- | ---- | --------------------- |
| POST   | `/api/v1/auth/register`    | —    | Create new user       |
| POST   | `/api/v1/auth/login`       | —    | Sign in, returns JWTs |
| POST   | `/api/v1/auth/refresh`     | —    | Rotate access token   |
| GET    | `/api/v1/auth/me`          | ✓    | Current user profile  |
| GET    | `/health`                  | —    | Liveness check        |

Coming next: patients, examinations (with image upload), AI diagnostics.

## Project layout

```
backend/
├── pyproject.toml
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/         # generated migrations
└── app/
    ├── main.py           # FastAPI factory + CORS + routers
    ├── config.py         # Pydantic Settings (.env)
    ├── core/security.py  # password hashing + JWT
    ├── db/
    │   ├── base.py       # SQLAlchemy Base + mixins
    │   └── session.py    # async engine + get_session dep
    ├── models/           # SQLAlchemy ORM
    ├── schemas/          # Pydantic DTOs (camelCase aliases)
    ├── api/
    │   ├── deps.py       # SessionDep, CurrentUser
    │   └── v1/auth.py    # auth endpoints
    └── services/auth.py  # business logic (register, authenticate)
```
