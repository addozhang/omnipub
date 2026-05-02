FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --no-cache-dir "."

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
