FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production \
    PROPERTY_SEARCH_DB=/data/property-search.sqlite \
    PROPERTY_SEARCH_PROFILE=/data/browser-profile \
    PROPERTY_SEARCH_DEFINITIONS=/data/definitions \
    PROPERTY_SEARCH_BROWSER_CHANNEL=chrome

RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "bin/railway-start.js"]
