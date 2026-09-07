import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import { chunkText, type DocumentChunk } from './chunker.js';
import { parseDocument, type ParsedDocument } from './documentParser.js';
import { embedTexts } from './embedding.js';
import { fuseResults, normalizeQuery, type RetrievalResult } from './retrieval.js';
import { generateWithLLM, type LLMProvider } from './llm.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const mongoUri = process.env.MONGODB_URI;
const mongoDatabase = process.env.MONGODB_DATABASE ?? 'interview_atlas';
const mongoVectorCollection = process.env.MONGODB_VECTOR_COLLECTION ?? 'chunks';
const mongoBm25Collection = process.env.MONGODB_BM25_COLLECTION ?? 'chunks';
const mongoDocumentCollection = process.env.MONGODB_DOCUMENT_COLLECTION ?? 'documents';
const mongoDocumentBucket = process.env.MONGODB_DOCUMENT_BUCKET ?? 'documents';
const embeddingProvider = process.env.EMBEDDING_PROVIDER ?? 'mistral';
const embeddingApiKey = process.env.MISTRAL_API_KEY ?? process.env.EMBEDDING_API_KEY;
const chunkSize = Number(process.env.CHUNK_SIZE_CHARACTERS ?? 1200);
const chunkOverlap = Number(process.env.CHUNK_OVERLAP_CHARACTERS ?? 200);
const embeddingModel = process.env.MISTRAL_EMBEDDING_MODEL ?? 'mistral-embed';
const vectorIndexName = process.env.MONGODB_VECTOR_INDEX_NAME ?? 'vector_embedding';
const vectorDimensions = Number(process.env.MONGODB_VECTOR_DIMENSIONS ?? 1024);
const vectorWeight = Number(process.env.VECTOR_WEIGHT ?? 0.6);
const bm25Weight = Number(process.env.BM25_WEIGHT ?? 0.4);
const retrievalTopK = Number(process.env.RETRIEVAL_TOP_K ?? 5);
const maxUploadSize = Number(process.env.MAX_UPLOAD_SIZE_BYTES ?? 10 * 1024 * 1024);
const uploadDirectory = path.resolve(process.env.UPLOAD_TEMP_DIR ?? './tmp/uploads');
const llmProvider = (process.env.LLM_PROVIDER ?? 'mistral') as LLMProvider;
const llmApiKey = process.env.MISTRAL_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY;
const llmModel = process.env.MISTRAL_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'mistral-large-latest';
const retrievalContextLimit = Number(process.env.RETRIEVAL_CONTEXT_LIMIT ?? 2000);
let mongoClient: MongoClient | undefined;
let mongoConnection: Promise<MongoClient> | undefined;

fs.mkdirSync(uploadDirectory, { recursive: true });

type UploadRecord = {
  uploadId: string;
  filename: string;
  format: 'pdf' | 'docx' | 'txt';
  size: number;
  path: string;
  status: 'uploaded' | 'parsed' | 'failed';
  ingestionStages: IngestionStage[];
  parsed?: ParsedDocument;
  error?: string;
  uploadedAt: string;
};

type StoredDocument = {
  _id: string;
  filename: string;
  format: UploadRecord['format'];
  size: number;
  text?: string;
  characterCount?: number;
  wordCount?: number;
  chunks?: DocumentChunk[];
  fileId: string;
  uploadedAt: Date;
};

type StoredChunk = {
  _id: string;
  documentId: string;
  text: string;
  metadata: DocumentChunk['metadata'];
  embedding?: number[];
  filename: string;
  createdAt: Date;
};

type SearchChunk = StoredChunk & { score?: number; [key: string]: unknown };

type IngestionStage = {
  id: 'upload' | 'parse' | 'clean' | 'chunk' | 'embed' | 'store' | 'index';
  label: string;
  status: 'completed' | 'failed';
  detail?: string;
};

const uploads = new Map<string, UploadRecord>();

const getMongoDatabase = async () => {
  if (!mongoUri) {
    throw new Error('MongoDB is not configured');
  }

  mongoConnection ??= new MongoClient(mongoUri).connect();
  const client = await mongoConnection;
  mongoClient = client;
  return client.db(mongoDatabase);
};

const updateStage = (record: UploadRecord, id: IngestionStage['id'], status: IngestionStage['status'], detail?: string) => {
  const stage = record.ingestionStages.find((item) => item.id === id);
  if (stage) {
    stage.status = status;
    stage.detail = detail;
  }
};

const storeUpload = async (record: UploadRecord) => {
  const database = await getMongoDatabase();
  const bucket = new GridFSBucket(database, { bucketName: mongoDocumentBucket });
  const fileId = new ObjectId();

  await new Promise<void>((resolve, reject) => {
    const stream = bucket.openUploadStreamWithId(fileId, record.filename, {
      metadata: {
        format: record.format,
        contentType: acceptedTypes.get(`.${record.format}`)?.values().next().value,
      },
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve());
    fs.createReadStream(record.path).once('error', reject).pipe(stream);
  });

  await database.collection<StoredDocument>(mongoDocumentCollection).insertOne({
    _id: record.uploadId,
    filename: record.filename,
    format: record.format,
    size: record.size,
    text: record.parsed?.text,
    characterCount: record.parsed?.characterCount,
    wordCount: record.parsed?.wordCount,
    chunks: record.parsed?.chunks,
    fileId: fileId.toHexString(),
    uploadedAt: new Date(record.uploadedAt),
  });

  const chunks = record.parsed?.chunks ?? [];
  if (!embeddingApiKey) {
    throw new Error('MISTRAL_API_KEY is not configured');
  }
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text), embeddingApiKey, embeddingModel);
  updateStage(record, 'embed', 'completed', `${chunks.length} chunks embedded with ${embeddingProvider}`);
  const vectorCollection = database.collection<StoredChunk>(mongoVectorCollection);
  const bm25Collection = database.collection<StoredChunk>(mongoBm25Collection);
  if (chunks.length) {
    const documents = chunks.map((chunk, index) => ({
      _id: `${record.uploadId}:${index}`,
      documentId: record.uploadId,
      text: chunk.text,
      metadata: chunk.metadata,
      embedding: embeddings[index],
      filename: record.filename,
      createdAt: new Date(),
    }));
    await vectorCollection.insertMany(documents);
    await bm25Collection.insertMany(documents.map(({ embedding: _embedding, ...document }) => document));
  }
  updateStage(record, 'store', 'completed', `${chunks.length} embedded chunks stored`);
  await bm25Collection.createIndex({ text: 'text' }, { name: 'bm25_text' });
  try {
    await database.command({
      createSearchIndexes: mongoVectorCollection,
      indexes: [{
        name: vectorIndexName,
        type: 'vectorSearch',
        definition: {
          fields: [{ type: 'vector', path: 'embedding', numDimensions: vectorDimensions, similarity: 'cosine' }],
        },
      }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/already exists|duplicate/i.test(message)) {
      throw new Error(`Vector search index creation failed: ${message}`);
    }
  }
  updateStage(record, 'index', 'completed', `Vector index ${vectorIndexName} and BM25 text index ready`);
};

const acceptedTypes = new Map([
  ['.pdf', new Set(['application/pdf'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'])],
  ['.txt', new Set(['text/plain', 'application/octet-stream'])],
]);
const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, uploadDirectory),
  filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: maxUploadSize, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypes = acceptedTypes.get(extension);
    callback(null, Boolean(mimeTypes?.has(file.mimetype)));
  },
});

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.post('/documents/upload', (request, response) => {
  upload.single('document')(request, response, async (error) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${Math.round(maxUploadSize / 1024 / 1024)} MB limit` : error.message;
      response.status(400).json({ error: message });
      return;
    }
    if (error || !request.file) {
      response.status(400).json({ error: 'Upload one PDF, DOCX, or TXT file using the document field' });
      return;
    }

    const extension = path.extname(request.file.originalname).toLowerCase().slice(1) as UploadRecord['format'];
    const record: UploadRecord = {
      uploadId: randomUUID(),
      filename: request.file.originalname,
      format: extension,
      size: request.file.size,
      path: request.file.path,
      status: 'uploaded',
      uploadedAt: new Date().toISOString(),
      ingestionStages: [
        { id: 'upload', label: 'Document upload', status: 'completed' },
        { id: 'parse', label: 'Document parsing', status: 'failed' },
        { id: 'clean', label: 'Text cleaning and normalization', status: 'failed' },
        { id: 'chunk', label: 'Chunking', status: 'failed' },
        { id: 'embed', label: 'Mistral embeddings', status: 'failed' },
        { id: 'store', label: 'MongoDB storage', status: 'failed' },
        { id: 'index', label: 'Vector and BM25 indexes', status: 'failed' },
      ],
    };
    uploads.set(record.uploadId, record);
    try {
      record.parsed = await parseDocument(record.path, record.format);
      updateStage(record, 'parse', 'completed', `${record.parsed.wordCount.toLocaleString()} words extracted`);
      updateStage(record, 'clean', 'completed', 'Whitespace, encoding, and page artifacts normalized');
      record.parsed.chunks = chunkText(record.uploadId, record.parsed.text, {
        maxCharacters: chunkSize,
        overlapCharacters: chunkOverlap,
      });
      updateStage(record, 'chunk', 'completed', `${record.parsed.chunks.length} chunks created`);
    } catch (parseError) {
      record.status = 'failed';
      record.error = parseError instanceof Error ? parseError.message : 'Document parsing failed';
      updateStage(record, 'parse', 'failed', record.error);
      updateStage(record, 'clean', 'failed', 'Skipped');
      updateStage(record, 'chunk', 'failed', 'Skipped');
      response.status(422).json({ uploadId: record.uploadId, status: record.status, error: record.error });
      return;
    }

    try {
      await storeUpload(record);
      record.status = 'parsed';
      await fs.promises.unlink(record.path).catch(() => undefined);
      response.status(201).json({ uploadId: record.uploadId, status: record.status, filename: record.filename, format: record.format, size: record.size, characterCount: record.parsed.characterCount, wordCount: record.parsed.wordCount, chunkCount: record.parsed.chunks?.length ?? 0, ingestionStages: record.ingestionStages });
    } catch (storageError) {
      record.status = 'failed';
      record.error = storageError instanceof Error ? storageError.message : 'Document storage failed';
      const failedStage = record.ingestionStages.find((stage) => stage.status !== 'completed');
      if (failedStage) updateStage(record, failedStage.id, 'failed', record.error);
      response.status(record.error === 'MongoDB is not configured' ? 503 : 502).json({ uploadId: record.uploadId, status: record.status, error: record.error });
    }
  });
});

app.get('/documents/:uploadId', (request, response) => {
  const record = uploads.get(request.params.uploadId);
  if (!record) {
    response.status(404).json({ error: 'Upload not found' });
    return;
  }
  response.json({ uploadId: record.uploadId, status: record.status, filename: record.filename, format: record.format, size: record.size, uploadedAt: record.uploadedAt, characterCount: record.parsed?.characterCount, wordCount: record.parsed?.wordCount, chunkCount: record.parsed?.chunks?.length ?? 0, ingestionStages: record.ingestionStages, error: record.error });
});

app.post('/query', async (request, response) => {
  const question = typeof request.body?.question === 'string' ? normalizeQuery(request.body.question) : '';
  const requestedTopK = Number(request.body?.topK ?? retrievalTopK);
  const topK = Number.isInteger(requestedTopK) && requestedTopK > 0 ? Math.min(requestedTopK, 20) : retrievalTopK;
  const documentId = typeof request.body?.documentId === 'string' ? request.body.documentId : undefined;
  if (!question) {
    response.status(400).json({ error: 'question is required' });
    return;
  }
  if (!embeddingApiKey) {
    response.status(503).json({ error: 'MISTRAL_API_KEY is not configured' });
    return;
  }

  try {
    const database = await getMongoDatabase();
    const [queryEmbedding] = await embedTexts([question], embeddingApiKey, embeddingModel);
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    const vectorPipeline = [
      { $vectorSearch: { index: vectorIndexName, path: 'embedding', queryVector: queryEmbedding, numCandidates: Math.max(topK * 10, 50), limit: topK, ...(filter ? { filter } : {}) } },
      { $project: { _id: 1, documentId: 1, filename: 1, text: 1, metadata: 1, score: { $meta: 'vectorSearchScore' } } },
    ];
    const bm25Pipeline = [
      { $match: { $text: { $search: question }, ...(documentId ? { documentId } : {}) } },
      { $set: { score: { $meta: 'textScore' } } },
      { $sort: { score: -1 } },
      { $limit: topK },
    ];
    const [vectorResults, bm25Results] = await Promise.all([
      database.collection< SearchChunk>(mongoVectorCollection).aggregate<SearchChunk>(vectorPipeline).toArray(),
      database.collection<SearchChunk>(mongoBm25Collection).aggregate<SearchChunk>(bm25Pipeline).toArray(),
    ]);
    const toResult = (chunk: SearchChunk, source: 'vector' | 'bm25'): RetrievalResult => ({
      chunkId: String(chunk._id),
      documentId: chunk.documentId,
      filename: chunk.filename,
      text: chunk.text,
      metadata: chunk.metadata,
      ...(source === 'vector' ? { vectorScore: chunk.score } : { bm25Score: chunk.score }),
      fusedScore: 0,
    });
    const fused = fuseResults(vectorResults.map((chunk) => toResult(chunk, 'vector')), bm25Results.map((chunk) => toResult(chunk, 'bm25')), vectorWeight, bm25Weight, topK, question);
    response.json({ question, topK, weights: { vector: vectorWeight, bm25: bm25Weight }, vectorResults: vectorResults.map((chunk) => toResult(chunk, 'vector')), bm25Results: bm25Results.map((chunk) => toResult(chunk, 'bm25')), results: fused });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Retrieval failed' });
  }
});

// Phase 14: Answer Composer (Q&A with LLM grounding)
app.post('/answer', async (request, response) => {
  const question = typeof request.body?.question === 'string' ? normalizeQuery(request.body.question) : '';
  const documentId = typeof request.body?.documentId === 'string' ? request.body.documentId : undefined;
  const topK = typeof request.body?.topK === 'number' ? Math.min(request.body.topK, 20) : retrievalTopK;

  if (!question) {
    response.status(400).json({ error: 'question is required' });
    return;
  }

  if (!llmApiKey) {
    response.status(503).json({ error: 'LLM API key is not configured' });
    return;
  }

  try {
    const database = await getMongoDatabase();

    // Step 1: Retrieve relevant context
    const [queryEmbedding] = await embedTexts([question], embeddingApiKey ?? '', embeddingModel);
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    const vectorPipeline = [
      { $vectorSearch: { index: vectorIndexName, path: 'embedding', queryVector: queryEmbedding, numCandidates: Math.max(topK * 10, 50), limit: topK, ...(filter ? { filter } : {}) } },
      { $project: { _id: 1, documentId: 1, filename: 1, text: 1, metadata: 1, score: { $meta: 'vectorSearchScore' } } },
    ];
    const bm25Pipeline = [
      { $match: { $text: { $search: question }, ...(documentId ? { documentId } : {}) } },
      { $set: { score: { $meta: 'textScore' } } },
      { $sort: { score: -1 } },
      { $limit: topK },
    ];
    const [vectorResults, bm25Results] = await Promise.all([
      database.collection<SearchChunk>(mongoVectorCollection).aggregate<SearchChunk>(vectorPipeline).toArray(),
      database.collection<SearchChunk>(mongoBm25Collection).aggregate<SearchChunk>(bm25Pipeline).toArray(),
    ]);
    const toResult = (chunk: SearchChunk, source: 'vector' | 'bm25'): RetrievalResult => ({
      chunkId: String(chunk._id),
      documentId: chunk.documentId,
      filename: chunk.filename,
      text: chunk.text,
      metadata: chunk.metadata,
      ...(source === 'vector' ? { vectorScore: chunk.score } : { bm25Score: chunk.score }),
      fusedScore: 0,
    });
    const fused = fuseResults(vectorResults.map((chunk) => toResult(chunk, 'vector')), bm25Results.map((chunk) => toResult(chunk, 'bm25')), vectorWeight, bm25Weight, topK, question);

    // Step 2: Prepare context for LLM
    const contextChunks = fused.slice(0, Math.max(3, topK));
    const contextText = contextChunks.map((chunk) => chunk.text).join('\n\n').slice(0, retrievalContextLimit);

    // Step 3: Generate grounded answer with LLM
    const llmResponse = await generateWithLLM(
      {
        mode: 'qa',
        question,
        context: contextText,
      },
      llmProvider,
      llmApiKey,
      llmModel,
    );

    response.json({
      question,
      answer: llmResponse.content,
      grounded: llmResponse.grounded,
      context: contextChunks,
      model: llmResponse.model,
      tokensUsed: llmResponse.tokensUsed,
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Answer generation failed' });
  }
});

// Phase 15: Interview Question Generator
app.post('/generate-questions', async (request, response) => {
  const topic = typeof request.body?.topic === 'string' ? request.body.topic.trim() : '';
  const difficulty = request.body?.difficulty ?? 'medium';
  const count = Math.min(typeof request.body?.count === 'number' ? request.body.count : 5, 20);

  if (!topic) {
    response.status(400).json({ error: 'topic is required' });
    return;
  }

  if (!llmApiKey) {
    response.status(503).json({ error: 'LLM API key is not configured' });
    return;
  }

  try {
    const llmResponse = await generateWithLLM(
      {
        mode: 'question_generation',
        metadata: { topic, difficulty: difficulty as 'easy' | 'medium' | 'hard' },
      },
      llmProvider,
      llmApiKey,
      llmModel,
    );

    // Parse questions from response
    const questionLines = llmResponse.content
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s*/, '').trim())
      .filter((line) => line.length > 10 && !line.startsWith('#'));

    response.json({
      topic,
      difficulty,
      questions: questionLines.slice(0, count),
      model: llmResponse.model,
      tokensUsed: llmResponse.tokensUsed,
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Question generation failed' });
  }
});

// Phase 16: Mock Interview Engine - Start
type MockInterviewSession = {
  sessionId: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  createdAt: Date;
  turns: Array<{ question: string; answer: string; feedback?: string }>;
  documentId?: string;
};

const mockInterviewSessions = new Map<string, MockInterviewSession>();

app.post('/mock-interview/start', async (request, response) => {
  const topic = typeof request.body?.topic === 'string' ? request.body.topic.trim() : '';
  const difficulty = request.body?.difficulty ?? 'medium';
  const documentId = typeof request.body?.documentId === 'string' ? request.body.documentId : undefined;

  if (!topic) {
    response.status(400).json({ error: 'topic is required' });
    return;
  }

  if (!llmApiKey) {
    response.status(503).json({ error: 'LLM API key is not configured' });
    return;
  }

  try {
    const database = documentId ? await getMongoDatabase() : undefined;
    let contextText = '';

    if (documentId && database) {
      const doc = await database
        .collection<StoredDocument>(mongoDocumentCollection)
        .findOne({ _id: documentId } as unknown as Record<string, unknown>);
      contextText = doc?.text?.slice(0, retrievalContextLimit) ?? '';
    }

    const llmResponse = await generateWithLLM(
      {
        mode: 'mock_interview',
        metadata: { topic, difficulty: difficulty as 'easy' | 'medium' | 'hard' },
        context: contextText,
      },
      llmProvider,
      llmApiKey,
      llmModel,
    );

    const sessionId = randomUUID();
    const session: MockInterviewSession = {
      sessionId,
      topic,
      difficulty: difficulty as 'easy' | 'medium' | 'hard',
      createdAt: new Date(),
      turns: [{ question: llmResponse.content, answer: '' }],
      documentId,
    };
    mockInterviewSessions.set(sessionId, session);

    response.status(201).json({
      sessionId,
      topic,
      difficulty,
      firstQuestion: llmResponse.content,
      model: llmResponse.model,
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Mock interview start failed' });
  }
});

// Phase 16: Mock Interview Engine - Respond
app.post('/mock-interview/respond', async (request, response) => {
  const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
  const answer = typeof request.body?.answer === 'string' ? request.body.answer.trim() : '';

  if (!sessionId || !answer) {
    response.status(400).json({ error: 'sessionId and answer are required' });
    return;
  }

  const session = mockInterviewSessions.get(sessionId);
  if (!session) {
    response.status(404).json({ error: 'Mock interview session not found' });
    return;
  }

  if (!llmApiKey) {
    response.status(503).json({ error: 'LLM API key is not configured' });
    return;
  }

  try {
    const lastTurn = session.turns[session.turns.length - 1];
    lastTurn.answer = answer;

    // Generate follow-up question or conclude
    const isLastQuestion = session.turns.length >= 5;
    const prompt = isLastQuestion
      ? `Thank you for that answer. This concludes our mock interview on ${session.topic}. Here's your overall feedback:\n\n${answer}`
      : 'Ask a follow-up question based on the answer.';

    const database = session.documentId ? await getMongoDatabase() : undefined;
    let contextText = '';

    if (session.documentId && database) {
      const doc = await database
        .collection<StoredDocument>(mongoDocumentCollection)
        .findOne({ _id: session.documentId } as unknown as Record<string, unknown>);
      contextText = doc?.text?.slice(0, retrievalContextLimit) ?? '';
    }

    const llmResponse = await generateWithLLM(
      {
        mode: 'mock_interview',
        question: prompt,
        metadata: { topic: session.topic, difficulty: session.difficulty },
        context: contextText,
      },
      llmProvider,
      llmApiKey,
      llmModel,
    );

    if (!isLastQuestion) {
      session.turns.push({ question: llmResponse.content, answer: '' });
    }

    response.json({
      sessionId,
      turnNumber: session.turns.length,
      nextQuestion: isLastQuestion ? null : llmResponse.content,
      conclusion: isLastQuestion ? llmResponse.content : null,
      isComplete: isLastQuestion,
      model: llmResponse.model,
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Mock interview response failed' });
  }
});

// Phase 17: Evaluation Engine
app.post('/evaluate', async (request, response) => {
  const question = typeof request.body?.question === 'string' ? request.body.question.trim() : '';
  const answer = typeof request.body?.answer === 'string' ? request.body.answer.trim() : '';
  const rubric = typeof request.body?.rubric === 'string' ? request.body.rubric.trim() : '';

  if (!question || !answer) {
    response.status(400).json({ error: 'question and answer are required' });
    return;
  }

  if (!llmApiKey) {
    response.status(503).json({ error: 'LLM API key is not configured' });
    return;
  }

  try {
    const defaultRubric = rubric || `Evaluate on:
1. Accuracy and completeness (0-3 points)
2. Clarity and communication (0-3 points)
3. Confidence and structure (0-2 points)
4. Relevant examples and depth (0-2 points)`;

    const llmResponse = await generateWithLLM(
      {
        mode: 'evaluation',
        question,
        context: answer,
        metadata: { rubric: defaultRubric },
      },
      llmProvider,
      llmApiKey,
      llmModel,
    );

    response.json({
      question,
      evaluation: llmResponse.content,
      model: llmResponse.model,
      tokensUsed: llmResponse.tokensUsed,
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Evaluation failed' });
  }
});


app.get('/health', async (_request, response) => {
  let database: 'connected' | 'not_configured' | 'unavailable' = 'not_configured';

  if (mongoUri) {
    try {
      mongoClient ??= new MongoClient(mongoUri);
      await mongoClient.db(mongoDatabase).command({ ping: 1 });
      database = 'connected';
    } catch {
      database = 'unavailable';
    }
  }

  response.status(database === 'unavailable' ? 503 : 200).json({
    service: 'interview-atlas-api',
    status: 'ok',
    database,
    mongoDatabase,
    mongoVectorCollection,
    mongoBm25Collection,
    mongoDocumentCollection,
    mongoDocumentBucket,
    vectorIndexName,
    vectorDimensions,
    embeddingProvider,
    embeddingConfigured: Boolean(embeddingApiKey),
    llmProvider,
    llmConfigured: Boolean(llmApiKey),
    llmModel,
  });
});

app.listen(port, () => {
  console.log(`Interview Atlas API listening on http://localhost:${port}`);
});

const shutdown = async () => {
  await mongoClient?.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
