FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-dev \
      python3-pip \
      build-essential \
      ca-certificates \
    && pip3 install --break-system-packages --no-cache-dir -q yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]