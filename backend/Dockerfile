# Backend Dockerfile - Interview Atlas API
FROM node:20-alpine

WORKDIR /app/backend

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 4000

# Set environment
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
