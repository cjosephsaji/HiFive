FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev
COPY docker/start.sh /usr/local/bin/start-chatgpt-work
RUN chmod +x /usr/local/bin/start-chatgpt-work
ENV DISPLAY=:99 NODE_ENV=production
EXPOSE 3000 6080
CMD ["/usr/local/bin/start-chatgpt-work"]
