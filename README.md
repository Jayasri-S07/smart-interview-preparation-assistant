# Interview Atlas

A comprehensive RAG-based interview preparation assistant. Upload study materials, get AI-powered answers, generate practice questions, conduct mock interviews, and evaluate responses — all grounded in your materials.

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Mistral API key (or OpenAI/Anthropic for LLM)

### Setup

**1. Backend Setup**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and API keys
npm run dev
```

Backend listens at `http://localhost:4000`

**2. Frontend Setup**
```bash
cd frontend
npm install
npm run dev
```

Frontend available at `http://localhost:5173`

## Architecture

The platform implements a phased build across 20 phases:

### Phases 1-4: Ingestion Foundation
- **Phase 1**: Project setup with Node.js + Express + React
- **Phase 2**: Document upload (PDF, DOCX, TXT)
- **Phase 3**: Format-specific parsing
- **Phase 4**: Text cleaning & normalization

### Phases 5-8: Chunking & Indexing
- **Phase 5**: Configurable text chunking with overlap
- **Phase 6**: Embedding generation (Mistral)
- **Phase 7**: MongoDB vector store
- **Phase 8**: BM25 text index

### Phases 9-12: Hybrid Retrieval
- **Phase 9**: Query processing & normalization
- **Phase 10**: Parallel vector + BM25 search
- **Phase 11**: Weighted score fusion
- **Phase 12**: LLM-assisted re-ranking

### Phases 13-17: Generation & Features
- **Phase 13**: LLM integration with prompt controller
- **Phase 14**: Q&A composer (grounded generation)
- **Phase 15**: Interview question generator
- **Phase 16**: Mock interview engine (multi-turn)
- **Phase 17**: Answer evaluation with rubrics

### Phases 18-20: Frontend & Deployment
- **Phase 18**: React UI for all features
- **Phase 19**: API integration documentation
- **Phase 20**: Docker containerization

## API Endpoints

### Document Management
- `POST /documents/upload` - Upload study material
- `GET /documents/:uploadId` - Get upload status

### Retrieval
- `POST /query` - Hybrid search (vector + BM25)

### Generation
- `POST /answer` - Get grounded Q&A answer
- `POST /generate-questions` - Generate practice questions
- `POST /mock-interview/start` - Start mock interview
- `POST /mock-interview/respond` - Continue interview
- `POST /evaluate` - Evaluate an answer

### Health
- `GET /health` - Service and database status

## Environment Variables

**MongoDB**
```
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=interview_atlas
```

**Embedding** (Mistral by default)
```
EMBEDDING_PROVIDER=mistral
MISTRAL_API_KEY=your_key
MISTRAL_EMBEDDING_MODEL=mistral-embed
```

**LLM** (Mistral, OpenAI, or Anthropic)
```
LLM_PROVIDER=mistral
MISTRAL_LLM_MODEL=mistral-large-latest
MISTRAL_API_KEY=your_key
```

**Retrieval**
```
VECTOR_WEIGHT=0.6          # Vector search weight
BM25_WEIGHT=0.4            # Keyword search weight
RETRIEVAL_TOP_K=5          # Results per search
RETRIEVAL_CONTEXT_LIMIT=2000  # Max context chars for LLM
```

See `.env.example` for complete configuration.

## Usage Examples

### Upload Document
```bash
curl -F "document=@notes.pdf" http://localhost:4000/documents/upload
```

### Get Grounded Answer
```bash
curl -X POST http://localhost:4000/answer \
  -H "Content-Type: application/json" \
  -d '{"question":"What is RAG?","topK":5}'
```

### Generate Questions
```bash
curl -X POST http://localhost:4000/generate-questions \
  -H "Content-Type: application/json" \
  -d '{"topic":"Machine Learning","difficulty":"medium"}'
```

### Start Mock Interview
```bash
curl -X POST http://localhost:4000/mock-interview/start \
  -H "Content-Type: application/json" \
  -d '{"topic":"System Design","difficulty":"hard"}'
```

### Evaluate Answer
```bash
curl -X POST http://localhost:4000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "question":"Explain OAuth 2.0",
    "answer":"OAuth is a protocol...",
    "rubric":"Technical accuracy, clarity, examples"
  }'
```

## Postman Collection

Import these for API testing:
- `postman/Interview Atlas API.postman_collection.json`
- `postman/Interview Atlas Local.postman_environment.json`

## Key Features

✓ **Smart Ingestion** - Automatic PDF/DOCX/TXT parsing, chunking, and normalization
✓ **Hybrid Search** - Vector + keyword search with fusion & re-ranking
✓ **Grounded Answers** - LLM responses always backed by your materials
✓ **Practice Questions** - AI generates realistic interview questions
✓ **Mock Interviews** - Multi-turn conversational interviews
✓ **Answer Evaluation** - Rubric-based feedback on responses
✓ **Multi-Provider** - Support for Mistral, OpenAI, Anthropic LLMs

## Development

Run backend in watch mode:
```bash
cd backend
npm run dev
```

Build backend:
```bash
cd backend
npm run build
npm start
```

## Docker (Phase 20)

Build and run with Docker:
```bash
docker-compose up
```

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: MongoDB + Vector Search + BM25 Index
- **LLM**: Mistral, OpenAI, or Anthropic API
- **Embeddings**: Mistral Embeddings API
- **Container**: Docker + Docker Compose
