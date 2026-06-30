# Stage 1: build the Vite/React SPA
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies (including devDependencies — needed for tsc + vite build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: serve static files with nginx
FROM nginx:alpine AS serve

# Minimal nginx config: serve static files, SPA fallback for client-side routing
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # Cache hashed assets forever, never cache the entry point\n\
    location ~* \\.(js|css|woff2?|png|jpg|jpeg|gif|svg|ico|webp)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
    location = /index.html {\n\
        add_header Cache-Control "no-cache";\n\
    }\n\
\n\
    # SPA routing: unknown paths fall back to index.html\n\
    location / {\n\
        try_files $uri /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
