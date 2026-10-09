FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
WORKDIR /app/apps/api
RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir -e .

COPY apps/api /app/apps/api
RUN groupadd --gid 10001 dinner && useradd --uid 10001 --gid 10001 --no-create-home dinner \
    && mkdir -p /app/media && chown 10001:10001 /app/media \
    && chmod -R a+rX /app/apps/api
WORKDIR /app/apps/api
USER 10001:10001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-access-log"]

