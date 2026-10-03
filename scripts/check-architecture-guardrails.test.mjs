import assert from 'node:assert/strict';
import test from 'node:test';

test('guardrail patterns cover Prisma, provider, UI, and AI dependency names', () => {
  const forbidden = [
    '@prisma/client',
    '../../prisma',
    '../lichess/client',
    '../providers/lichess',
    '@angular/core',
    '../../../../web/src/app',
    'chessground',
    'openai',
    '../ai/explainer',
  ];
  const pattern = /@prisma\/client|(^|\/)prisma(?:\/|$)|lichess|provider|@angular|chessground|(^|\/)(?:apps\/web|web\/src)(?:\/|$)|openai|anthropic|gemini|ai-sdk|(^|\/)ai(?:\/|$)/i;
  for (const value of forbidden) assert.match(value, pattern);
});
