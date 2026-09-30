import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeChatInput, notificationRecipients } from './logic.js';

test('normalizes mentions and rejects more than five', () => {
  const input = normalizeChatInput({ planId: 'p', operationId: 'o', text: ' hello ', mentionUserIds: ['a', 'a', 'b'] });
  assert.equal(input.text, 'hello');
  assert.deepEqual(input.mentionUserIds, ['a', 'b']);
  assert.throws(() => normalizeChatInput({ planId: 'p', operationId: 'o', text: 'x', mentionUserIds: ['1', '2', '3', '4', '5', '6'] }));
});

test('targets mentions or all members for an untagged request', () => {
  assert.deepEqual(notificationRecipients(['sender', 'a', 'b'], 'sender', ['b'], true), ['b']);
  assert.deepEqual(notificationRecipients(['sender', 'a', 'b'], 'sender', [], true), ['a', 'b']);
  assert.deepEqual(notificationRecipients(['sender', 'a'], 'sender', [], false), []);
});
