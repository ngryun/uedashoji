import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapMessage, makeSlides } from '../guestbook-screen.js';
const measure = text => [...text].length;

test('Korean and Japanese text wraps without losing content', () => {
  const text = '함께한 시간이 소중했어요。一緒に過ごせて嬉しかったです。';
  const lines = wrapMessage(text, measure, 12);
  assert.equal(lines.join(''), text);
  assert.ok(lines.every(line => measure(line) <= 12));
});

test('line breaks and emoji clusters are preserved', () => {
  assert.deepEqual(wrapMessage('안녕\n\nありがとう', measure, 20), ['안녕', '', 'ありがとう']);
  assert.deepEqual(wrapMessage('👨‍👩‍👧‍👦👨‍👩‍👧‍👦', () => 10, 5), ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦']);
});

test('long messages are paginated completely with enough reading time', () => {
  const message = '추억'.repeat(250);
  const slides = makeSlides([{ id: 'a', message }], measure, 35);
  assert.equal(slides.flatMap(s => s.lines).join(''), message);
  assert.equal(slides.length, 3);
  assert.ok(slides.every(s => s.lines.length <= 7 && s.duration >= 10 && s.duration <= 25));
  assert.ok(slides[0].duration > 10);
  assert.equal(makeSlides([{message:'  '}], measure, 35).length, 0);
});
