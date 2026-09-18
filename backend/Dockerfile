# Multi-stage, non-root (spec AC row 7). Build stage installs runtime deps into
# a self-contained venv; the runtime stage copies it and runs gunicorn
# supervising uvicorn ASGI workers as the unprivileged `ideaforge` user.
FROM python:3.11-slim AS deps
WORKDIR /app
COPY requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt gunicorn==23.0.0

FROM python:3.11-slim AS runtime
WORKDIR /app
RUN groupadd -r ideaforge && useradd -r -g ideaforge --home-dir /nonexistent ideaforge
COPY --from=deps /opt/venv /opt/venv
COPY app ./app
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
USER ideaforge
EXPOSE 8000
# gunicorn = process manager, uvicorn worker = ASGI server (spec §Deploy).
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "60", "--access-logfile", "-", "--error-logfile", "-"]
