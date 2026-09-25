# Build from the repository root:  docker build -f ml-service/Dockerfile .
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision
COPY ml-service/requirements.txt ml-service/requirements.txt
RUN pip install --no-cache-dir -r ml-service/requirements.txt
COPY ml-service ml-service
COPY knowledge_base knowledge_base
COPY audio_scripts audio_scripts
RUN useradd --create-home --uid 10001 app && mkdir -p models data && chown -R app /app
USER app
WORKDIR /app/ml-service
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
