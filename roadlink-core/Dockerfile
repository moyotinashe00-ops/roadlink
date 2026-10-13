FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY db ./db
COPY src ./src
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
# The schema is idempotent, so applying it on every start is safe.
CMD ["sh", "-c", "node db/migrate.js && node src/server.js"]
