import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapMessage, makeSlides, shuffleEntries, createGuestbookScreen } from '../guestbook-screen.js';
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


test('shuffle includes every entry once without mutating the newest-first list', () => {
  const entries = ['a', 'b', 'c', 'd'].map(id => ({ id, message: id }));
  const shuffled = shuffleEntries(entries, null, () => 0);
  assert.deepEqual(entries.map(e => e.id), ['a', 'b', 'c', 'd']);
  assert.notDeepEqual(shuffled, entries);
  assert.deepEqual(shuffled.map(e => e.id).sort(), ['a', 'b', 'c', 'd']);
});

test('round boundaries avoid the previous entry and handle empty/single-entry lists', () => {
  const entries = ['a', 'b', 'c'].map(id => ({ id }));
  const shuffled = shuffleEntries(entries, 'a', () => 0.999);
  assert.notEqual(shuffled[0].id, 'a');
  assert.equal(new Set(shuffled.map(e => e.id)).size, 3);
  assert.deepEqual(shuffleEntries([]), []);
  assert.deepEqual(shuffleEntries([entries[0]], 'a'), [entries[0]]);
});

test('randomizing entries keeps long-message pages together and in order', () => {
  const entries = [{id:'long',message:'추억'.repeat(250)}, {id:'short',message:'안녕'}];
  const slides = makeSlides(shuffleEntries(entries, null, () => 0), measure, 35);
  assert.deepEqual(slides.map(s => [s.entry.id, s.page]), [['short',0], ['long',0], ['long',1], ['long',2]]);
});


test('screen completes shuffled rounds and preserves the current entry on live updates', t => {
  let displayedName = '';
  const ctx = { fillRect() {}, save() {}, restore() {},
    fillText(text, x, y) { if (y === 774 && x === 100) displayedName = text; },
    measureText: text => ({ width: text.length * 20 }) };
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { hidden: false, createElement: () => ({ getContext: () => ctx }) };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  });
  const screen = createGuestbookScreen();
  t.mock.method(Math, 'random', () => 0);
  const entries = ['A', 'B', 'C'].map(id => ({id, name:id, message:'Hello'}));
  const far = {floor:0, pos:{x:0, z:11, distanceToSquared:()=>30}};
  screen.setEntries(entries);
  const shown = [displayedName];
  for (let i=0; i<5; i++) {screen.update(26, far, true);shown.push(displayedName);}
  assert.equal(new Set(shown.slice(0,3)).size, 3);
  assert.equal(new Set(shown.slice(3,6)).size, 3);
  assert.notEqual(shown[2], shown[3]);
  const current = displayedName;
  screen.setEntries([...entries.map(e => e.id===current ? {...e,name:'Edited '+current} : e), {id:'D',name:'D',message:'New'}]);
  assert.equal(displayedName, 'Edited '+current);
  screen.update(30, {...far,pos:{x:4.5,z:12,distanceToSquared:()=>4}}, true);
  assert.equal(displayedName, 'Edited '+current);
});
