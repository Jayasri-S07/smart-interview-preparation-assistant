/**
 * Phase 13: LLM Integration & Prompt Controller
 * Handles grounded LLM generation with fallback for insufficient context.
 */

export type LLMProvider = 'mistral' | 'openai' | 'anthropic';

export type LLMGenerationMode = 'qa' | 'question_generation' | 'mock_interview' | 'evaluation';

export interface LLMRequest {
  mode: LLMGenerationMode;
  question?: string;
  context?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata?: {
    topic?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    interviewType?: string;
    rubric?: string;
  };
}

export interface LLMResponse {
  content: string;
  mode: LLMGenerationMode;
  tokensUsed?: {
    input: number;
    output: number;
  };
  grounded: boolean; // Whether the answer was grounded in provided context
  model: string;
}

const mistralChatUrl = 'https://api.mistral.ai/v1/chat/completions';

// Prompt templates for different modes
const prompts = {
  qa: (context: string, question: string, hasContext: boolean) => {
    if (!hasContext) {
      return {
        system: 'You are a helpful interview preparation assistant. Answer questions accurately and concisely.',
        user: `Question: ${question}

Note: I don\'t have relevant study material in the knowledge base for this question. Please provide your best answer, but acknowledge that this answer is not grounded in the provided materials.`,
      };
    }
    return {
      system: `You are an interview preparation assistant. Answer questions ONLY using the provided context material. 
If the context doesn't contain information to answer the question, say "I don't have information about this topic in the provided materials."
Keep answers concise and direct. Focus on practical, interview-relevant information.`,
      user: `Context from study materials:
${context}

Question: ${question}

Provide a focused answer based only on the context above.`,
    };
  },

  question_generation: (topic: string, difficulty: string, count: number = 5) => ({
    system: `You are an expert interviewer creating practice questions for interview preparation.
Generate ${count} ${difficulty} interview questions on the given topic.
Questions should be realistic, probing key concepts, and suitable for interview preparation.
Format each question on a new line, numbered 1-${count}.`,
    user: `Generate ${count} ${difficulty} interview questions about: ${topic}

Requirements:
- Questions should test understanding and communication
- Vary question types (conceptual, practical, behavioral)
- Make questions challenging but fair
- Format as numbered list`,
  }),

  mock_interview: (topic: string, difficulty: string, context?: string) => {
    const contextPart = context ? `\n\nRelevant study material:\n${context}` : '';
    return {
      system: `You are conducting a mock interview. Your role is to:
1. Ask one focused interview question at a time
2. Listen to the candidate's response
3. Provide constructive feedback if needed
4. Follow up with clarification if the answer is unclear
Keep responses brief and professional.${contextPart}`,
      user: `Start a mock interview on the topic: ${topic} at ${difficulty} level.
Ask the first question now.`,
    };
  },

  evaluation: (rubric: string, answer: string, question: string) => ({
    system: `You are an expert interview evaluator. Assess candidate responses using the provided rubric.
Provide constructive feedback and a score.
Be fair but rigorous - this is for practice improvement.`,
    user: `Evaluate this interview response:

Question: ${question}
Answer: ${answer}

Rubric: ${rubric}

Provide:
1. Score (0-10)
2. Strengths (2-3 points)
3. Areas for improvement (2-3 points)
4. Specific feedback on how to improve`,
  }),
};

async function callMistralChat(systemPrompt: string, userPrompt: string, apiKey: string, model: string = 'mistral-large-latest'): Promise<LLMResponse> {
  const response = await fetch(mistralChatUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral LLM request failed (${response.status}): ${error.slice(0, 240)}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };

  if (!payload.choices?.[0]?.message?.content) {
    throw new Error('Mistral returned an invalid response');
  }

  return {
    content: payload.choices[0].message.content,
    mode: 'qa',
    model: payload.model ?? model,
    tokensUsed: payload.usage ? { input: payload.usage.prompt_tokens ?? 0, output: payload.usage.completion_tokens ?? 0 } : undefined,
    grounded: true,
  };
}

async function callOpenAIChat(systemPrompt: string, userPrompt: string, apiKey: string, model: string = 'gpt-3.5-turbo'): Promise<LLMResponse> {
  const openaiUrl = 'https://api.openai.com/v1/chat/completions';
  const response = await fetch(openaiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI LLM request failed (${response.status}): ${error.slice(0, 240)}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };

  if (!payload.choices?.[0]?.message?.content) {
    throw new Error('OpenAI returned an invalid response');
  }

  return {
    content: payload.choices[0].message.content,
    mode: 'qa',
    model: payload.model ?? model,
    tokensUsed: payload.usage ? { input: payload.usage.prompt_tokens ?? 0, output: payload.usage.completion_tokens ?? 0 } : undefined,
    grounded: true,
  };
}

export async function generateWithLLM(request: LLMRequest, provider: LLMProvider, apiKey: string, model?: string): Promise<LLMResponse> {
  const hasContext = Boolean(request.context?.trim());

  let systemPrompt = '';
  let userPrompt = '';

  switch (request.mode) {
    case 'qa': {
      if (!request.question) throw new Error('Question is required for QA mode');
      const promptPair = prompts.qa(request.context ?? '', request.question, hasContext);
      systemPrompt = promptPair.system;
      userPrompt = promptPair.user;
      break;
    }
    case 'question_generation': {
      if (!request.metadata?.topic) throw new Error('Topic is required for question generation');
      const difficulty = request.metadata.difficulty ?? 'medium';
      const promptPair = prompts.question_generation(request.metadata.topic, difficulty);
      systemPrompt = promptPair.system;
      userPrompt = promptPair.user;
      break;
    }
    case 'mock_interview': {
      if (!request.metadata?.topic) throw new Error('Topic is required for mock interview');
      const difficulty = request.metadata.difficulty ?? 'medium';
      const promptPair = prompts.mock_interview(request.metadata.topic, difficulty, request.context);
      systemPrompt = promptPair.system;
      userPrompt = promptPair.user;
      break;
    }
    case 'evaluation': {
      if (!request.question || !request.metadata?.rubric) {
        throw new Error('Question and rubric are required for evaluation');
      }
      const promptPair = prompts.evaluation(request.metadata.rubric, request.context ?? '', request.question);
      systemPrompt = promptPair.system;
      userPrompt = promptPair.user;
      break;
    }
    default: {
      throw new Error(`Unknown generation mode: ${request.mode}`);
    }
  }

  let result: LLMResponse;

  if (provider === 'mistral') {
    result = await callMistralChat(systemPrompt, userPrompt, apiKey, model);
  } else if (provider === 'openai') {
    result = await callOpenAIChat(systemPrompt, userPrompt, apiKey, model);
  } else if (provider === 'anthropic') {
    throw new Error('Anthropic provider not yet implemented');
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  result.mode = request.mode;
  result.grounded = hasContext;
  return result;
}
