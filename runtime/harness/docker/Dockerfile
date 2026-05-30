# Dockerfile for the Project CEO Harness (meta-orchestration layer)
#
# This builds the always-on CEO Orchestrator + supporting services
# (chat logging, delegation engine, background workers, etc.).

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed (git, etc. for project analysis)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY docker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the harness source
COPY . .

# Create necessary directories
RUN mkdir -p /app/state /app/brain/conversations /app/mgmt /shared

# Environment
ENV PYTHONUNBUFFERED=1
ENV CEO_HARNESS_ROOT=/app

# Default command runs the orchestrator in daemon mode (24/7)
# Override this for one-off tasks (e.g. chat CLI, ad-hoc delegation)
COPY docker/entrypoint.py /app/entrypoint.py
CMD ["python", "/app/entrypoint.py"]
