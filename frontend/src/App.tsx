import { useEffect, useRef, useState } from 'react'
import './App.css'

type Stage = { id: string; label: string; status: 'completed' | 'active' | 'pending' | 'failed'; detail?: string }
type UploadResult = { uploadId: string; status: string; filename: string; format?: string; characterCount?: number; wordCount?: number; chunkCount?: number; ingestionStages?: Stage[]; error?: string }
type Tab = 'upload' | 'answer' | 'generate' | 'interview' | 'evaluate'
type RetrievalResult = { chunkId: string; documentId: string; filename: string; text: string; metadata: Record<string, unknown>; vectorScore?: number; bm25Score?: number; fusedScore: number }

const defaultStages: Stage[] = [
  { id: 'upload', label: 'Document upload', status: 'pending' },
  { id: 'parse', label: 'Document parsing', status: 'pending' },
  { id: 'clean', label: 'Text cleaning and normalization', status: 'pending' },
  { id: 'chunk', label: 'Chunking', status: 'pending' },
  { id: 'embed', label: 'Mistral embeddings', status: 'pending' },
  { id: 'store', label: 'MongoDB storage', status: 'pending' },
  { id: 'index', label: 'Vector and BM25 indexes', status: 'pending' },
]
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('upload')
  const [documents, setDocuments] = useState<UploadResult[]>([])
  
  // Upload state
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [stages, setStages] = useState<Stage[]>(defaultStages)

  // Answer state
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerLoading, setAnswerLoading] = useState(false)
  const [answerContext, setAnswerContext] = useState<RetrievalResult[]>([])
  const [selectedDoc, setSelectedDoc] = useState<string>('')

  // Generate questions state
  const [genTopic, setGenTopic] = useState('')
  const [genDifficulty, setGenDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [genQuestions, setGenQuestions] = useState<string[]>([])
  const [genLoading, setGenLoading] = useState(false)

  // Mock interview state
  const [interviewTopic, setInterviewTopic] = useState('')
  const [interviewDifficulty, setInterviewDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [interviewSessionId, setInterviewSessionId] = useState('')
  const [interviewQuestion, setInterviewQuestion] = useState('')
  const [interviewAnswer, setInterviewAnswer] = useState('')
  const [interviewHistory, setInterviewHistory] = useState<Array<{ q: string; a: string }>>([])
  const [interviewLoading, setInterviewLoading] = useState(false)
  const [interviewComplete, setInterviewComplete] = useState(false)

  // Evaluate state
  const [evalQuestion, setEvalQuestion] = useState('')
  const [evalAnswer, setEvalAnswer] = useState('')
  const [evalRubric, setEvalRubric] = useState('')
  const [evalResult, setEvalResult] = useState('')
  const [evalLoading, setEvalLoading] = useState(false)

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setStages((current) => {
      const firstPending = current.findIndex((stage) => stage.status === 'pending')
      if (firstPending < 0) return current
      return current.map((stage, index) => index === firstPending ? { ...stage, status: 'active' } : stage)
    }), 700)
    return () => window.clearInterval(timer)
  }, [busy])

  const chooseFile = (nextFile?: File) => {
    setError('')
    setResult(null)
    setStages(defaultStages)
    if (!nextFile) return
    const supported = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
    const extension = nextFile.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'txt'].includes(extension ?? '') || (!supported.includes(nextFile.type) && extension !== 'txt')) {
      setFile(null)
      setError('Choose a PDF, DOCX, or TXT file.')
      return
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setFile(null)
      setError('That file is larger than the 10 MB limit.')
      return
    }
    setFile(nextFile)
  }

  const uploadFile = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    setStages(defaultStages.map((stage, index) => index === 0 ? { ...stage, status: 'active' } : stage))
    const body = new FormData()
    body.append('document', file)
    try {
      const response = await fetch(`${apiUrl}/documents/upload`, { method: 'POST', body })
      const data = await response.json() as UploadResult
      if (!response.ok) throw new Error(data.error ?? 'Upload failed.')
      setResult(data)
      setStages(data.ingestionStages ?? defaultStages)
      setDocuments([...documents, data])
      setSelectedDoc(data.uploadId)
      setFile(null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not reach the API.')
      setStages((current) => current.map((stage) => stage.status === 'active' ? { ...stage, status: 'failed' } : stage))
    } finally {
      setBusy(false)
    }
  }

  const answerQuestion = async () => {
    if (!question.trim()) {
      setError('Please enter a question')
      return
    }
    setAnswerLoading(true)
    setAnswer('')
    setAnswerContext([])
    try {
      const response = await fetch(`${apiUrl}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, documentId: selectedDoc || undefined, topK: 5 }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Answer generation failed')
      setAnswer(data.answer)
      setAnswerContext(data.context ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating answer')
    } finally {
      setAnswerLoading(false)
    }
  }

  const generateQuestions = async () => {
    if (!genTopic.trim()) {
      setError('Please enter a topic')
      return
    }
    setGenLoading(true)
    setGenQuestions([])
    try {
      const response = await fetch(`${apiUrl}/generate-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: genTopic, difficulty: genDifficulty, count: 5 }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Question generation failed')
      setGenQuestions(data.questions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating questions')
    } finally {
      setGenLoading(false)
    }
  }

  const startInterview = async () => {
    if (!interviewTopic.trim()) {
      setError('Please enter an interview topic')
      return
    }
    setInterviewLoading(true)
    setInterviewComplete(false)
    try {
      const response = await fetch(`${apiUrl}/mock-interview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: interviewTopic, difficulty: interviewDifficulty, documentId: selectedDoc || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Interview start failed')
      setInterviewSessionId(data.sessionId)
      setInterviewQuestion(data.firstQuestion)
      setInterviewAnswer('')
      setInterviewHistory([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error starting interview')
    } finally {
      setInterviewLoading(false)
    }
  }

  const respondToInterview = async () => {
    if (!interviewAnswer.trim()) {
      setError('Please provide an answer')
      return
    }
    setInterviewLoading(true)
    try {
      const response = await fetch(`${apiUrl}/mock-interview/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: interviewSessionId, answer: interviewAnswer }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Interview response failed')
      setInterviewHistory([...interviewHistory, { q: interviewQuestion, a: interviewAnswer }])
      if (data.isComplete) {
        setInterviewComplete(true)
        setInterviewQuestion(data.conclusion)
      } else {
        setInterviewQuestion(data.nextQuestion)
      }
      setInterviewAnswer('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error responding to interview')
    } finally {
      setInterviewLoading(false)
    }
  }

  const evaluateAnswer = async () => {
    if (!evalQuestion.trim() || !evalAnswer.trim()) {
      setError('Please enter both question and answer')
      return
    }
    setEvalLoading(true)
    setEvalResult('')
    try {
      const response = await fetch(`${apiUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: evalQuestion, answer: evalAnswer, rubric: evalRubric }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Evaluation failed')
      setEvalResult(data.evaluation)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error evaluating answer')
    } finally {
      setEvalLoading(false)
    }
  }

  const completedStages = stages.filter((stage) => stage.status === 'completed').length
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">IA</span><span>Interview Atlas</span></div>
        <div className="tabs">
          <button className={`tab ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>Upload</button>
          <button className={`tab ${activeTab === 'answer' ? 'active' : ''}`} onClick={() => setActiveTab('answer')}>Q&A</button>
          <button className={`tab ${activeTab === 'generate' ? 'active' : ''}`} onClick={() => setActiveTab('generate')}>Questions</button>
          <button className={`tab ${activeTab === 'interview' ? 'active' : ''}`} onClick={() => setActiveTab('interview')}>Interview</button>
          <button className={`tab ${activeTab === 'evaluate' ? 'active' : ''}`} onClick={() => setActiveTab('evaluate')}>Evaluate</button>
        </div>
        <span className="status"><span className="status-dot" /> {documents.length} document{documents.length !== 1 ? 's' : ''} loaded</span>
      </header>

      {activeTab === 'upload' && (
        <section className="intro">
          <p className="eyebrow">Your private preparation desk</p>
          <h1>Bring your notes.<br /><em>Build your edge.</em></h1>
          <p className="lede">Upload the material you trust. We will turn it into a searchable foundation for sharper interview answers.</p>
        </section>
      )}

      <section className="workspace">
        {activeTab === 'upload' && (
          <>
            <div className="panel panel-primary">
              <div className="panel-heading"><div><span className="kicker">Study library</span><h2>Add a document</h2></div><span className="phase-number">02</span></div>
              <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}>
                <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" onChange={(event) => chooseFile(event.target.files?.[0])} />
                <span className="upload-icon">↑</span><strong>{file ? file.name : 'Drop your study material here'}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB selected` : 'or click to browse · PDF, DOCX, TXT'}</span>
              </div>
              {error && <p className="message error">{error}</p>}
              {file && !result && <button className="upload-button" type="button" onClick={uploadFile} disabled={busy}>{busy ? 'Reading document...' : 'Upload and parse'}</button>}
              {result && <div className="result"><span className="result-icon">✓</span><div><strong>{result.filename}</strong><p>Ingested successfully · {result.wordCount?.toLocaleString()} words · {result.chunkCount?.toLocaleString()} chunks</p></div></div>}
            </div>
            <div className="panel roadmap">
              <div className="panel-heading"><div><span className="kicker">Ingestion review</span><h2>From notes to insight</h2></div><span className="roadmap-count">{completedStages.toString().padStart(2, '0')} / {stages.length.toString().padStart(2, '0')}</span></div>
              <div className="progress"><span style={{ width: `${(completedStages / stages.length) * 100}%` }} /></div>
              <div className="roadmap-list">{stages.map((stage, index) => <div className={`roadmap-step roadmap-${stage.status}`} key={stage.id}><span><b>{String(index + 1).padStart(2, '0')}</b>&nbsp; {stage.label}</span><strong>{stage.status === 'completed' ? '✓' : stage.status === 'active' ? '●' : stage.status === 'failed' ? '!' : '·'}</strong>{stage.detail && <small>{stage.detail}</small>}</div>)}</div>
              <p className="pipeline-note">{busy ? 'Working through the ingestion pipeline. This panel updates as each stage completes.' : 'Review every ingestion stage before using this material for retrieval.'}</p>
            </div>
          </>
        )}

        {activeTab === 'answer' && (
          <div className="panel panel-primary">
            <div className="panel-heading"><span className="kicker">Retrieval & Generation</span><h2>Get grounded answers</h2></div>
            {documents.length > 0 && <div className="form-group">
              <label>Document (optional):</label>
              <select value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
                <option value="">All documents</option>
                {documents.map(doc => <option key={doc.uploadId} value={doc.uploadId}>{doc.filename}</option>)}
              </select>
            </div>}
            <div className="form-group">
              <label>Your question:</label>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask your question..." />
            </div>
            <button onClick={answerQuestion} disabled={answerLoading}>{answerLoading ? 'Generating...' : 'Get Answer'}</button>
            {error && <p className="message error">{error}</p>}
            {answer && <div className="result-section">
              <h3>Answer</h3>
              <p>{answer}</p>
              {answerContext.length > 0 && <details>
                <summary>Source context ({answerContext.length} chunks)</summary>
                <div className="context-list">
                  {answerContext.map((chunk, i) => <div key={i} className="context-chunk">
                    <small><strong>{chunk.filename}</strong> • Score: {chunk.fusedScore.toFixed(3)}</small>
                    <p>{chunk.text.slice(0, 200)}...</p>
                  </div>)}
                </div>
              </details>}
            </div>}
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="panel panel-primary">
            <div className="panel-heading"><span className="kicker">Practice Questions</span><h2>Generate interview questions</h2></div>
            <div className="form-group">
              <label>Topic:</label>
              <input type="text" value={genTopic} onChange={(e) => setGenTopic(e.target.value)} placeholder="e.g., React Hooks, Async Programming..." />
            </div>
            <div className="form-group">
              <label>Difficulty:</label>
              <select value={genDifficulty} onChange={(e) => setGenDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <button onClick={generateQuestions} disabled={genLoading}>{genLoading ? 'Generating...' : 'Generate Questions'}</button>
            {error && <p className="message error">{error}</p>}
            {genQuestions.length > 0 && <div className="result-section">
              <h3>Generated Questions</h3>
              <ol>
                {genQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ol>
            </div>}
          </div>
        )}

        {activeTab === 'interview' && (
          <div className="panel panel-primary">
            <div className="panel-heading"><span className="kicker">Mock Interview</span><h2>Practice with AI interviewer</h2></div>
            {!interviewSessionId && <>
              <div className="form-group">
                <label>Interview topic:</label>
                <input type="text" value={interviewTopic} onChange={(e) => setInterviewTopic(e.target.value)} placeholder="e.g., Full Stack Development..." />
              </div>
              <div className="form-group">
                <label>Difficulty:</label>
                <select value={interviewDifficulty} onChange={(e) => setInterviewDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <button onClick={startInterview} disabled={interviewLoading}>{interviewLoading ? 'Starting...' : 'Start Interview'}</button>
            </>}
            {interviewSessionId && <>
              <div className="interview-history">
                {interviewHistory.map((turn, i) => <div key={i} className="interview-turn">
                  <p><strong>Q:</strong> {turn.q}</p>
                  <p><strong>A:</strong> {turn.a}</p>
                </div>)}
              </div>
              {!interviewComplete && <>
                <div className="current-question">
                  <p><strong>Question:</strong> {interviewQuestion}</p>
                </div>
                <div className="form-group">
                  <label>Your answer:</label>
                  <textarea value={interviewAnswer} onChange={(e) => setInterviewAnswer(e.target.value)} placeholder="Type your answer here..." />
                </div>
                <button onClick={respondToInterview} disabled={interviewLoading}>{interviewLoading ? 'Processing...' : 'Submit Answer'}</button>
              </>}
              {interviewComplete && <div className="result-section">
                <h3>Interview Complete</h3>
                <p>{interviewQuestion}</p>
                <button onClick={() => { setInterviewSessionId(''); setInterviewTopic('') }}>Start New Interview</button>
              </div>}
            </>}
            {error && <p className="message error">{error}</p>}
          </div>
        )}

        {activeTab === 'evaluate' && (
          <div className="panel panel-primary">
            <div className="panel-heading"><span className="kicker">Answer Evaluation</span><h2>Get feedback on your answers</h2></div>
            <div className="form-group">
              <label>Interview question:</label>
              <input type="text" value={evalQuestion} onChange={(e) => setEvalQuestion(e.target.value)} placeholder="The interview question..." />
            </div>
            <div className="form-group">
              <label>Your answer:</label>
              <textarea value={evalAnswer} onChange={(e) => setEvalAnswer(e.target.value)} placeholder="Your answer to evaluate..." />
            </div>
            <div className="form-group">
              <label>Evaluation criteria (optional):</label>
              <textarea value={evalRubric} onChange={(e) => setEvalRubric(e.target.value)} placeholder="e.g., Technical depth, communication clarity..." />
            </div>
            <button onClick={evaluateAnswer} disabled={evalLoading}>{evalLoading ? 'Evaluating...' : 'Evaluate Answer'}</button>
            {error && <p className="message error">{error}</p>}
            {evalResult && <div className="result-section">
              <h3>Evaluation Feedback</h3>
              <p>{evalResult}</p>
            </div>}
          </div>
        )}
      </section>

      <footer><span>RAG-based preparation platform</span><span>Local development</span></footer>
    </main>
  )
}

export default App
