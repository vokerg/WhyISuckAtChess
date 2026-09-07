import assert from 'node:assert/strict';
import test from 'node:test';

test('guardrail patterns cover Prisma, provider, and AI dependency names', () => {
  const forbidden = ['@prisma/client', '../../prisma', '../lichess/client', '../providers/lichess', 'openai', '../ai/explainer'];
  const pattern = /@prisma\/client|(^|\/)prisma(?:\/|$)|lichess|provider|openai|anthropic|gemini|ai-sdk|(^|\/)ai(?:\/|$)/i;
  for (const value of forbidden) assert.match(value, pattern);
});
