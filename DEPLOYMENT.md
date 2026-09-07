# Interview Atlas - Deployment Guide

## Phase 20: Deployment & Containerization

This document covers deploying Interview Atlas using Docker and Docker Compose.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Mistral API key (or OpenAI/Anthropic)
- 2GB+ disk space for MongoDB and uploads

## Quick Start with Docker Compose

### 1. Clone and Configure

```bash
git clone <repository>
cd interview
```

### 2. Set Environment Variables

```bash
# Create .env file in root directory
MISTRAL_API_KEY=your_mistral_api_key_here
```

Or pass directly:

```bash
MISTRAL_API_KEY=your_key docker-compose up
```

### 3. Start All Services

```bash
docker-compose up -d
```

This starts:
- **MongoDB** (port 27017) - Vector store with BM25 index
- **Backend API** (port 4000) - Express server
- **Frontend UI** (port 80) - React app served by Nginx

### 4. Verify Services

```bash
# Check container status
docker-compose ps

# Test backend health
curl http://localhost:4000/health

# Open frontend
open http://localhost
```

### 5. Stop All Services

```bash
docker-compose down
```

Remove volumes (including MongoDB data):

```bash
docker-compose down -v
```

## Docker Compose Configuration

The `docker-compose.yml` defines:

### MongoDB Service
- Image: `mongo:7.0`
- Volume: `mongodb_data` for persistence
- Health check included
- Authentication: admin/password (change in production)

### Backend Service
- Builds from `backend/Dockerfile`
- Port: 4000
- Environment variables for:
  - MongoDB connection
  - Embedding provider (Mistral)
  - LLM provider (Mistral, OpenAI, Anthropic)
  - Retrieval weights and limits
- Depends on MongoDB health check
- Mounts `./backend/tmp` for file uploads

### Frontend Service
- Builds from `frontend/Dockerfile`
- Serves on port 80
- Environment variable for API URL
- Depends on backend service

## Manual Deployment

### Build Docker Images Separately

**Backend:**
```bash
docker build -f backend/Dockerfile -t interview-atlas-backend:latest .
```

**Frontend:**
```bash
docker build -f frontend/Dockerfile -t interview-atlas-frontend:latest .
```

### Run Containers Individually

**MongoDB:**
```bash
docker run -d \
  --name mongodb \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  -v mongodb_data:/data/db \
  -p 27017:27017 \
  mongo:7.0
```

**Backend:**
```bash
docker run -d \
  --name backend \
  -e MONGODB_URI=mongodb://admin:password@mongodb:27017/interview_atlas?authSource=admin \
  -e MISTRAL_API_KEY=your_key \
  -p 4000:4000 \
  --link mongodb \
  interview-atlas-backend:latest
```

**Frontend:**
```bash
docker run -d \
  --name frontend \
  -e VITE_API_URL=http://localhost:4000 \
  -p 80:80 \
  --link backend \
  interview-atlas-frontend:latest
```

## Production Deployment

### Environment Variables (Production)

Update `docker-compose.yml` or use `.env` file:

```env
# MongoDB (use Atlas for production)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/interview_atlas

# Security
MISTRAL_API_KEY=prod_key
FRONTEND_ORIGIN=https://yourdomain.com

# Performance
RETRIEVAL_TOP_K=10
RETRIEVAL_CONTEXT_LIMIT=3000
CHUNK_SIZE_CHARACTERS=1500

# Limits
MAX_UPLOAD_SIZE_BYTES=52428800  # 50MB
```

### MongoDB Atlas Integration

Replace the MongoDB service with Atlas:

```yaml
# Remove or comment out the mongodb service
# Update backend MONGODB_URI:
MONGODB_URI: mongodb+srv://user:pass@cluster.mongodb.net/interview_atlas
```

### SSL/TLS with Nginx Reverse Proxy

Add to `docker-compose.yml`:

```yaml
nginx:
  image: nginx:alpine
  ports:
    - "443:443"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf
    - ./certs:/etc/nginx/certs
  depends_on:
    - frontend
    - backend
```

Example `nginx.conf` for SSL:

```nginx
upstream frontend {
  server frontend:80;
}

upstream backend {
  server backend:4000;
}

server {
  listen 443 ssl;
  server_name yourdomain.com;

  ssl_certificate /etc/nginx/certs/cert.pem;
  ssl_certificate_key /etc/nginx/certs/key.pem;

  location / {
    proxy_pass http://frontend;
  }

  location /api/ {
    proxy_pass http://backend/;
  }
}

server {
  listen 80;
  server_name yourdomain.com;
  return 301 https://$server_name$request_uri;
}
```

### Kubernetes Deployment

For Kubernetes, create manifests:

**backend-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: interview-atlas-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: interview-atlas-backend:latest
        ports:
        - containerPort: 4000
        env:
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: interview-atlas-secrets
              key: mongodb-uri
        - name: MISTRAL_API_KEY
          valueFrom:
            secretKeyRef:
              name: interview-atlas-secrets
              key: mistral-api-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

Deploy:
```bash
kubectl create secret generic interview-atlas-secrets \
  --from-literal=mongodb-uri=... \
  --from-literal=mistral-api-key=...

kubectl apply -f backend-deployment.yaml
```

## Monitoring & Logs

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f mongodb
docker-compose logs -f frontend
```

### Performance Monitoring

Monitor resources:
```bash
docker stats
```

Check MongoDB indexes:
```bash
docker exec interview-atlas-mongodb mongosh \
  -u admin -p password \
  --eval "db.chunks.getIndexes()"
```

## Backup & Recovery

### Backup MongoDB

```bash
docker exec interview-atlas-mongodb mongodump \
  -u admin -p password \
  --out /data/db/backup
```

### Restore MongoDB

```bash
docker exec interview-atlas-mongodb mongorestore \
  -u admin -p password \
  /data/db/backup
```

### Backup Uploads

```bash
docker cp interview-atlas-backend:/app/backend/tmp ./backups/uploads
```

## Troubleshooting

### Services won't start

Check logs:
```bash
docker-compose logs
```

Common issues:
- **Port conflicts**: Change ports in docker-compose.yml
- **MongoDB auth**: Verify credentials
- **API keys missing**: Set MISTRAL_API_KEY

### MongoDB connection errors

```bash
# Test connection
docker exec interview-atlas-backend curl http://localhost:4000/health
```

### High memory usage

Increase limits in docker-compose.yml:
```yaml
services:
  mongodb:
    deploy:
      resources:
        limits:
          memory: 2G
```

### Slow retrieval

Optimize MongoDB:
```bash
docker exec interview-atlas-mongodb mongosh -u admin -p password
> db.chunks.createIndex({ embedding: "2dsphere" })
> db.chunks.createIndex({ text: "text" })
```

## Scaling

### Horizontal Scaling

Run multiple backend instances:
```bash
docker-compose up -d --scale backend=3
```

Add load balancer (Nginx):
```yaml
nginx:
  image: nginx:alpine
  ports:
    - "4000:4000"
  volumes:
    - ./load-balancer.conf:/etc/nginx/nginx.conf
  depends_on:
    - backend
```

### Vertical Scaling

Increase resource limits:
```yaml
backend:
  deploy:
    resources:
      limits:
        memory: 2G
        cpus: 2
```

## Security Best Practices

1. **Use environment variables** - Never hardcode secrets
2. **Restrict network access** - Use firewall rules
3. **Update regularly** - Keep images current
4. **Use secrets management** - Docker Secrets or Vault
5. **Enable MongoDB auth** - Change default credentials
6. **Use HTTPS** - Enable SSL/TLS in production
7. **Set resource limits** - Prevent DoS attacks
8. **Regular backups** - Automate backup procedures
9. **Audit logs** - Enable and monitor logs
10. **Keep dependencies updated** - npm audit, docker images

## Support

For issues or questions, refer to:
- Docker: https://docs.docker.com
- Docker Compose: https://docs.docker.com/compose
- MongoDB: https://docs.mongodb.com
- Mistral API: https://docs.mistral.ai
