# Interview Atlas - Quick Reference Guide

## Start the System

### Development Mode (Local)

**Terminal 1 - Backend:**
```bash
cd backend
npm install  # First time only
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install  # First time only
npm run dev
```

Open browser to: `http://localhost:5173`

### Production Mode (Docker)

```bash
export MISTRAL_API_KEY=your_key_here
docker-compose up
```

Open browser to: `http://localhost`

---

## Features Overview

### 1. Upload Documents (Phase 2-7)
**Tab: Upload**
- Drag & drop or click to browse
- Supported: PDF, DOCX, TXT (max 10MB)
- Progress tracking through 7 ingestion stages
- Automatic parsing, chunking, embedding, indexing

### 2. Get Grounded Answers (Phase 14)
**Tab: Q&A**
- Select a document (or search all)
- Ask any question
- Get answer grounded only in your materials
- View source chunks with relevance scores

### 3. Generate Questions (Phase 15)
**Tab: Questions**
- Enter topic (e.g., "React Hooks")
- Choose difficulty: Easy / Medium / Hard
- Generate 5 practice questions
- Copy questions for use in mock interviews

### 4. Mock Interview (Phase 16)
**Tab: Interview**
- Enter interview topic
- Choose difficulty level
- AI conducts 5-turn interview
- Questions based on your documents (if provided)
- Full conversation history displayed

### 5. Evaluate Answers (Phase 17)
**Tab: Evaluate**
- Enter interview question
- Provide your answer
- Optional: Add evaluation rubric
- Get detailed feedback and scoring

---

## API Usage Examples

### Upload Document
```bash
curl -F "document=@notes.pdf" \
  http://localhost:4000/documents/upload
```

Response includes `uploadId` and ingestion progress.

### Search with Hybrid Retrieval
```bash
curl -X POST http://localhost:4000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Explain async/await",
    "topK": 5,
    "documentId": "optional-id"
  }'
```

### Get Grounded Answer
```bash
curl -X POST http://localhost:4000/answer \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is a closure?",
    "documentId": "optional-doc-id",
    "topK": 5
  }'
```

Response includes answer, source context, and model info.

### Generate Questions
```bash
curl -X POST http://localhost:4000/generate-questions \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Data Structures",
    "difficulty": "hard",
    "count": 5
  }'
```

### Start Mock Interview
```bash
curl -X POST http://localhost:4000/mock-interview/start \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "System Design",
    "difficulty": "hard"
  }'
```

Response includes `sessionId` and first question.

### Respond to Interview
```bash
curl -X POST http://localhost:4000/mock-interview/respond \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "from-previous-response",
    "answer": "Your answer here"
  }'
```

### Evaluate Answer
```bash
curl -X POST http://localhost:4000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Explain async/await",
    "answer": "Async/await is a way to...",
    "rubric": "Technical accuracy, clarity, examples"
  }'
```

---

## Configuration

### Environment Variables (Backend)

**Most Important:**
```bash
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017

# API Keys (choose one LLM)
MISTRAL_API_KEY=your_mistral_key
# OR
OPENAI_API_KEY=your_openai_key
# OR
ANTHROPIC_API_KEY=your_anthropic_key

# LLM Selection
LLM_PROVIDER=mistral  # or openai or anthropic
```

**Tuning:**
```bash
# Retrieval tuning
VECTOR_WEIGHT=0.6          # 0.0-1.0
BM25_WEIGHT=0.4            # 0.0-1.0
RETRIEVAL_TOP_K=5          # 1-20
RETRIEVAL_CONTEXT_LIMIT=2000  # chars

# Document processing
CHUNK_SIZE_CHARACTERS=1200
CHUNK_OVERLAP_CHARACTERS=200
```

See `backend/.env.example` for all options.

---

## Troubleshooting

### MongoDB not connecting
```bash
# Check MongoDB is running
docker ps | grep mongodb

# Or start standalone
mongod --dbpath ./data
```

### "LLM API key is not configured"
```bash
# Set your API key
export MISTRAL_API_KEY=your_key
# or edit .env file
```

### Slow retrieval
- Increase `RETRIEVAL_TOP_K` for more results
- Check MongoDB indexes: `db.chunks.getIndexes()`
- Consider using MongoDB Atlas for better performance

### Document parsing fails
- Check file isn't corrupted
- Ensure file is under 10MB
- For PDFs, try exporting as text first

### High memory usage
- Reduce `RETRIEVAL_CONTEXT_LIMIT`
- Lower `CHUNK_SIZE_CHARACTERS` (minimum 100)
- Restart services to clear session memory

---

## Architecture Snapshot

```
User Query → Frontend (React)
            ↓
         API (Express)
            ↓
    ┌───────┴────────┐
    ↓                ↓
MongoDB Vector    MongoDB BM25
Search (Phase 10) Search (Phase 10)
    ↓                ↓
    └────────┬───────┘
             ↓
        Result Fusion (Phase 11)
             ↓
          Re-ranking (Phase 12)
             ↓
        Grounding Check
             ↓
          LLM API (Phase 13)
             ↓
      Formatted Response (Phase 14)
             ↓
      Frontend Display
```

---

## Performance Tips

1. **Faster Retrieval**
   - Increase BM25_WEIGHT for keyword-heavy content
   - Reduce RETRIEVAL_CONTEXT_LIMIT
   - Use RETRIEVAL_TOP_K=3 for quick answers

2. **Better Answers**
   - Increase CHUNK_SIZE_CHARACTERS to 2000
   - Set VECTOR_WEIGHT=0.7 for semantic understanding
   - Use mistral-large-latest for complex questions

3. **Faster Ingestion**
   - Chunk smaller documents into 800 character chunks
   - Use TXT format instead of PDF when possible
   - Upload multiple files sequentially (not parallel)

---

## Docker Compose Commands

```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop services
docker-compose down

# Reset everything
docker-compose down -v

# Check status
docker-compose ps
```

---

## Health Check Endpoint

```bash
curl http://localhost:4000/health
```

Response shows:
- Service status
- MongoDB connection status
- Configured collections
- Embedding provider status
- LLM provider status

---

## Common Workflows

### Interview Preparation Workflow
1. **Upload** study materials (notes, textbooks, articles)
2. **Generate** practice questions by topic
3. **Answer** questions using Q&A feature
4. **Conduct** mock interviews on specific topics
5. **Evaluate** your responses for improvement
6. Repeat until ready

### Quick Question Answering
1. Upload relevant document
2. Use Q&A tab to get instant answers
3. Check source context for more details
4. Export answers for study notes

### Question Bank Building
1. Upload document
2. Generate 5 questions multiple times with different topics
3. Export generated questions
4. Use in mock interviews or standalone practice

---

## File Locations (Development)

- Backend: `backend/src/` (TypeScript)
- Frontend: `frontend/src/` (React + TypeScript)
- Uploads: `backend/tmp/uploads/`
- Environment: `backend/.env`
- Config: Various `*.example` files for reference

---

## Support Resources

- **Architecture**: `architecture (4).md` - 20-phase design
- **Deployment**: `DEPLOYMENT.md` - Production setup
- **Completion**: `COMPLETION_SUMMARY.md` - What's implemented
- **Code Comments**: Marked with phase numbers
- **Examples**: Postman collection in `postman/`

---

## Version Info

- **Node.js**: 18+ required
- **MongoDB**: 7.0+ recommended
- **React**: 18.2
- **TypeScript**: 7.0
- **Docker**: 20.10+

---

**Ready to ace your interviews!** 🚀
