FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN rm -rf node_modules package-lock.json && npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
