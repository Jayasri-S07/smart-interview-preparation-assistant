# Architecture Document: Smart Interview Preparation Assistant (RAG-Based)
## Phase-by-Phase Build Architecture

**Document Type:** Software Architecture Description (Phased Implementation View)
**Convention:** ISO/IEC/IEEE 42010:2011, adapted from Arc42
**Version:** 3.0
**Status:** Draft

---

## 0. System Summary

A RAG-based interview preparation platform. Users upload study materials (PDF/DOCX/TXT); the system parses, chunks, and embeds them into a MongoDB vector store. Candidate questions are answered using hybrid search (vector + BM25) with fusion and re-ranking, grounded through an LLM. The system also supports topic/difficulty-based interview question generation, turn-based mock interviews, and rubric-based answer evaluation.

**Tech stack:** React (frontend) · Node.js + Express (backend) · MongoDB (vector store + BM25 text index) · Embedding model (API) · LLM (API) · Docker (packaging)

---

## Build Roadmap Overview

| Phase | Name | Layer |
|---|---|---|
| 1 | Project Setup & Environment | Foundation |
| 2 | Document Upload | Ingestion |
| 3 | Document Parsing | Ingestion |
| 4 | Text Cleaning & Normalization | Ingestion |
| 5 | Chunking | Ingestion |
| 6 | Embedding Generation | Ingestion |
| 7 | Vector Store Setup (MongoDB) | Ingestion |
| 8 | BM25 / Keyword Index Setup | Retrieval |
| 9 | Query Processing & Query Embedding | Retrieval |
| 10 | Hybrid Search (Vector + BM25) | Retrieval |
| 11 | Result Fusion | Retrieval |
| 12 | Re-ranking | Retrieval |
| 13 | LLM Integration & Prompt Controller | Generation |
| 14 | Answer Composer (Q&A response format) | Generation |
| 15 | Interview Question Generator | Feature |
| 16 | Mock Interview Engine | Feature |
| 17 | Evaluation Engine | Feature |
| 18 | React Frontend | Presentation |
| 19 | API Layer / Integration | Integration |
| 20 | Deployment & Containerization | Deployment |

---

## Phase 1 — Project Setup & Environment

**Goal:** Establish the foundation both backend and frontend build on.

- Initialize backend: Node.js + Express (+ TypeScript recommended for consistency with related projects).
- Initialize frontend: React app scaffold.
- Set up MongoDB instance (local or Atlas) for later vector + text index use.
- Configure environment variables: DB connection string, embedding API key, LLM API key.
- Set up base repo structure: `/ingestion`, `/retrieval`, `/api`, `/prompts`, `/frontend`.

**Deliverable:** Runnable empty backend + frontend skeleton, DB connection verified.

---

## Phase 2 — Document Upload

**Goal:** Let a candidate upload their own study material.

- Build upload endpoint (`POST /documents/upload`) accepting PDF, DOCX, TXT.
- Validate file type and size.
- Store raw file temporarily (disk or object storage) before parsing.
- Return an upload ID/status to frontend.

**Deliverable:** Working file upload with validation and acknowledgment response.

---

## Phase 3 — Document Parsing

**Goal:** Extract raw text from each supported format.

- PDF: text extraction (with a plan for scanned/OCR PDFs as a known edge case, see Risks).
- DOCX: structured text extraction.
- TXT: direct read.
- Normalize all formats into a single internal `RawDocument` representation (text + basic metadata: filename, upload date, format).

**Deliverable:** Any uploaded file reliably converted to plain internal text.

---

## Phase 4 — Text Cleaning & Normalization

**Goal:** Remove noise before chunking so embeddings are high quality.

- Strip headers/footers, page numbers, excessive whitespace.
- Normalize encoding (UTF-8), fix broken line breaks from PDF extraction.
- Preserve section/heading structure where possible, for later metadata tagging.

**Deliverable:** Clean, normalized text ready for chunking, with structure markers retained.

---

## Phase 5 — Chunking

**Goal:** Split cleaned text into retrieval-sized passages.

- Choose chunking strategy (fixed-size with overlap, or section-aware chunking).
- Attach metadata to every chunk: source document, section/page, chunk index.
- Define chunk size/overlap parameters as configurable, not hardcoded.

**Deliverable:** List of `{text, metadata}` chunks per document, ready for embedding.

---

## Phase 6 — Embedding Generation

**Goal:** Convert each chunk into a vector representation.

- Integrate an embedding model API.
- Batch-embed chunks for efficiency.
- Handle rate limits/retries gracefully.

**Deliverable:** Each chunk has an associated embedding vector, ready for storage.

---

## Phase 7 — Vector Store Setup (MongoDB)

**Goal:** Persist chunks, embeddings, and metadata for retrieval.

- Design MongoDB schema: `{ chunkId, documentId, text, embedding, metadata, createdAt }`.
- Create a vector search index (e.g., MongoDB Atlas Vector Search).
- Insert embedded chunks from Phase 6.

**Deliverable:** Queryable vector store containing all ingested chunks.

---

## Phase 8 — BM25 / Keyword Index Setup

**Goal:** Enable lexical/keyword search alongside semantic search.

- Create a MongoDB text index on chunk text for BM25-style scoring.
- Verify keyword queries return relevant chunks independently of vector search.

**Deliverable:** Working keyword search path, parallel to the vector search path.

---

## Phase 9 — Query Processing & Query Embedding

**Goal:** Prepare an incoming candidate question for retrieval.

- Normalize/clean the incoming question text.
- Generate a query embedding using the same embedding model as ingestion (consistency is critical).
- (Optional) Query expansion/rewriting for better recall.

**Deliverable:** A processed query object ready to feed both search channels.

---

## Phase 10 — Hybrid Search (Vector + BM25)

**Goal:** Retrieve candidate chunks via both channels in parallel.

- Run vector similarity search (top-k) against the MongoDB vector index.
- Run BM25 keyword search (top-k) against the MongoDB text index.
- Return both ranked result sets independently.

**Deliverable:** Two parallel top-k result lists per query.

---

## Phase 11 — Result Fusion

**Goal:** Combine the two result sets into one ranked list.

- Implement weighted-score fusion (e.g., normalize each channel's scores, combine with tunable weights).
- Deduplicate chunks appearing in both lists (merge scores rather than duplicate entries).

**Deliverable:** Single fused, ranked list of candidate chunks.

---

## Phase 12 — Re-ranking

**Goal:** Refine the fused list to the most relevant final context.

- Apply a re-ranking step (cross-encoder, LLM-based re-rank, or scoring heuristic) to the fused top-N.
- Trim to final top-k chunks that will be passed to the LLM.

**Deliverable:** Final relevant context set, ready for generation.

---

## Phase 13 — LLM Integration & Prompt Controller

**Goal:** Wire retrieved context into grounded generation.

- Integrate LLM API.
- Implement the Prompt Controller: enforces grounding rule (answer only from context), the insufficient-context fallback, and mode dispatch (Q&A / Interview Question / Mock Interview / Evaluation).
- Pass `{context}` + `{question}` into the prompt template.

**Deliverable:** End-to-end question → retrieval → grounded LLM answer, with fallback behavior verified.

---

## Phase 14 — Answer Composer (Q&A Response Format)

**Goal:** Standardize concept-question answers for interview usefulness.

- Enforce output shape: Definition → Key Points → Real-time Example → Interview Example → Short Interview Answer.
- Handle code questions: clean beginner-friendly code + plain-language explanation.
- Handle comparison questions: clear side-by-side differences.

**Deliverable:** Consistent, interview-ready answer formatting across question types.

---

## Phase 15 — Interview Question Generator

**Goal:** Generate structured practice questions on demand.

- Support topic-based and difficulty-based question requests.
- Output format: Question, Expected Concept, Model Answer, Key Points interviewer expects.
- Ground question content in retrieved context where applicable.

**Deliverable:** On-demand, structured interview question generation.

---

## Phase 16 — Mock Interview Engine

**Goal:** Turn-based mock interview flow.

- Ask exactly one question, then wait for candidate response (no multi-question dumps).
- On answer, hand off to Evaluation Engine (Phase 17), then generate the next question.
- Track session state (question count, topic/difficulty progression) for the duration of the session.

**Deliverable:** Working ask → wait → evaluate → next loop.

---

## Phase 17 — Evaluation Engine

**Goal:** Score candidate answers consistently.

- Apply fixed rubric: technical correctness, relevance, completeness, clarity, communication, use of examples.
- Output fixed template: `Score: X/10`, Strengths, Areas to Improve, Expected Answer, Tips.

**Deliverable:** Repeatable, structured evaluation for any candidate answer.

---

## Phase 18 — React Frontend

**Goal:** User-facing interface for all backend capabilities.

- Document upload UI (progress state, success/failure feedback).
- Chat interface for Q&A.
- Mock interview UI (one question at a time, answer input, score/feedback display).
- Source/metadata display for traceability (which document an answer came from).

**Deliverable:** Full UI covering upload, Q&A, mock interview, and evaluation display.

---

## Phase 19 — API Layer / Integration

**Goal:** Connect frontend to all backend pipelines cleanly.

- REST endpoints: `/documents/upload`, `/query`, `/interview/question`, `/interview/mock/start`, `/interview/mock/answer`.
- Consistent request/response contracts (including source metadata in responses).
- Error handling surfaced to frontend (e.g., insufficient-context state, parsing failures).

**Deliverable:** Stable API contract connecting all phases end-to-end.

---

## Phase 20 — Deployment & Containerization

**Goal:** Ship a reproducible, deployable system.

- Dockerize backend (and frontend build) for consistent environments.
- Configure MongoDB Atlas (or equivalent) for production vector + text indexes.
- Environment-based config for embedding/LLM API keys across dev/prod.

**Deliverable:** Deployable containerized system with production-ready data store.

---

## Risks Carried Across Phases

- **Phase 3:** Scanned/non-text PDFs need an OCR fallback not yet designed.
- **Phase 11:** Fusion weights between vector and BM25 need empirical tuning per content type.
- **Phase 13:** Mode-detection (Q&A vs. Interview Question vs. Mock Interview) relies on LLM intent classification, not explicit commands — worth revisiting once usage patterns are observed.
- **Phase 16:** Mock interview session state persistence beyond conversation history is not yet defined (in-memory vs. DB-backed).

---

## Glossary

| Term | Definition |
|---|---|
| RAG | Retrieval-Augmented Generation — generating answers using retrieved external context rather than only model memory. |
| Hybrid Search | Combining semantic vector search with lexical BM25 keyword search. |
| BM25 | A classic keyword-based ranking function for lexical/text search. |
| Fusion | Combining ranked result lists into one, typically via weighted scoring. |
| Re-ranking | A refinement step applied after fusion to reorder top candidates by relevance. |
| Chunking | Splitting a source document into smaller retrieval-sized passages. |
| Groundedness | The property of an answer being fully supported by retrieved context. |
| Mock Interview Mode | Turn-based practice mode: one question at a time, evaluated before proceeding. |
