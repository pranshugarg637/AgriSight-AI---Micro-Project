# Build from the repository root:  docker build -f backend/Dockerfile .
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend/src backend/src
COPY audio_scripts audio_scripts
COPY audio_clips audio_clips
COPY knowledge_base/risk_rules knowledge_base/risk_rules
COPY data/help_centers data/help_centers
RUN mkdir -p backend/data && chown -R node /app/backend/data
USER node
WORKDIR /app/backend
EXPOSE 5000
CMD ["node", "src/server.js"]
