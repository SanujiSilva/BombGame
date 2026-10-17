import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
assert.doesNotMatch(html + readme, /WIN_SCORE|first.to.\d+|\d+\s+points.{0,20}wins/i, 'no fixed win score remains');
assert.match(html, /highest score wins when one bomb remains/, 'game screen explains the last-bomb win rule');
assert.match(readme, /highest score wins/, 'README explains the last-bomb win rule');
const bundledLibrary = readFileSync(new URL('./trystero.bundle.mjs', import.meta.url), 'utf8');
const meteredLibrary = readFileSync(new URL('./metered.bundle.mjs', import.meta.url), 'utf8');
assert.match(html, /from '\.\/trystero\.bundle\.mjs'/, 'game loads its peer library from the deployed folder');
assert.doesNotMatch(bundledLibrary, /(?:^|;)\s*import\s+[^;(]/m, 'peer library has no other runtime imports');
assert.match(html, /from '\.\/metered\.bundle\.mjs'/, 'managed room SDK loads from the deployed folder');
assert.doesNotMatch(meteredLibrary, /(?:^|;)\s*import\s+[^;(]/m, 'managed room SDK has no other runtime imports');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'Game script exists');
const script = source.replace(/^import .*from .*;\s*/gm, '');
const elements = new Map();
const scheduled = [];
const element = id => {
  if (!elements.has(id)) elements.set(id, {value: '', textContent: '', className: '', disabled: false, style: {}, classList: {contains: () => false, add() {}, remove() {}, toggle() {}}, replaceChildren() {}, append() {}, appendChild() {}, setAttribute() {}});
  return elements.get(id);
};
const context = vm.createContext({
  METERED_KEY: '',
  document: {getElementById: element, querySelector: () => element('oplabel'), createElement: () => ({style: {}, classList: {add() {}}, append() {}, setAttribute() {}}), addEventListener() {}},
  window: {}, crypto: globalThis.crypto, navigator: {}, location: {reload() {}},
  setTimeout: fn => {scheduled.push(fn); return scheduled.length}, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
});
vm.runInContext(script, context, {filename: 'index.html'});
vm.runInContext(`
  paint = () => {};
  ident = 'A'; name = 'Alice'; isCreator = false; peers = new Set(['B']);
  sendMsg = message => { globalThis.lastMessage = message; };
  onMembership();
`, context);
assert.equal(context.lastMessage.type, 'requestState', 'a joiner requests state even with the lowest peer ID');
vm.runInContext(`
  isCreator = true; roomCapacity = 3;
  peers = new Set(['B', 'C']);
  localNames = {A:'Alice', B:'Bob', C:'Cara', D:'Dee'};
  state = freshState(['A', 'B', 'C']);
  for (const id of state.order) { state.players[id].ready = true; state.players[id].bomb = {A:0,B:1,C:2}[id]; }
  tryStart();
`, context);
assert.equal(vm.runInContext('state.phase', context), 'play');
vm.runInContext("peers.add('D'); onMembership()", context);
assert.equal(vm.runInContext('state.phase', context), 'play', 'extra joiner must not reset a live round');
assert.equal(vm.runInContext('state.order.length', context), 3, 'extra joiner is a spectator');
vm.runInContext("advanceMove('A', 1)", context);
assert.equal(vm.runInContext('state.winner', context), 'B');
assert.equal(vm.runInContext('state.players.B.score', context), 2);
vm.runInContext('nextRound()', context);
assert.equal(vm.runInContext('state.players.B.score', context), 2, 'scores carry over');
assert.equal(vm.runInContext('state.order.includes("D")', context), false, 'extra joiner does not replace a player next round');
vm.runInContext(`
  for (const id of state.order) { state.players[id].ready = true; state.players[id].bomb = 0; }
  tryStart(); state.used = [4]; peers.delete('C'); onMembership();
`, context);
assert.equal(vm.runInContext('state.phase', context), 'setup', 'departure restarts setup');
assert.equal(vm.runInContext('state.used.length', context), 0, 'departure clears used tiles');
assert.equal(vm.runInContext('state.order.includes("D")', context), true, 'waiting player gets open place');
assert.equal(vm.runInContext('state.players.B.ready', context), false, 'bombs must be reselected');
vm.runInContext(`
  roomCapacity = 2; peers = new Set(['B']); state = freshState(['A', 'B']);
  state.phase = 'play'; state.players.A.score = 9;
  state.players.A.bomb = 0; state.players.B.bomb = 1;
  advanceMove('A', 2);
`, context);
assert.equal(vm.runInContext('state.players.A.score', context), 10);
assert.equal(vm.runInContext('state.phase', context), 'play', 'ten points does not end the match while both bombs remain');
vm.runInContext(`
  state = freshState(['A', 'B']); state.phase = 'play'; state.players.B.score = 9;
  state.players.A.bomb = 0; state.players.B.bomb = 1;
  advanceMove('A', 1);
`, context);
assert.equal(vm.runInContext('state.players.B.score', context), 11, 'bomb owner earns two points');
assert.equal(vm.runInContext('matchComplete()', context), true, 'one remaining bomb ends a two-player match');
assert.equal(vm.runInContext('matchWinners()[0].name', context), 'Bob', 'highest score wins');
vm.runInContext(`
  roomCapacity = 3; peers = new Set(['B', 'C']); state = freshState(['A', 'B', 'C']);
  state.phase = 'play'; state.players.A.score = 6; state.players.B.score = 3;
  state.players.A.bomb = 0; state.players.B.bomb = 1; state.players.C.bomb = 2;
  advanceMove('A', 3); advanceMove('B', 0);
`, context);
assert.equal(vm.runInContext('remainingBombs()', context), 2);
assert.equal(vm.runInContext('matchComplete()', context), false, 'first bomb hit does not end a three-player match');
vm.runInContext('continueMatch()', context);
assert.equal(vm.runInContext('state.phase', context), 'play', 'play resumes after a bomb hit');
assert.equal(vm.runInContext('state.used.includes(0)', context), true, 'revealed bomb remains used');
assert.equal(vm.runInContext('state.players.A.score', context), 9, 'scores carry over while bombs remain');
vm.runInContext("advanceMove('C', 1)", context);
assert.equal(vm.runInContext('remainingBombs()', context), 1);
assert.equal(vm.runInContext('matchComplete()', context), true, 'match ends at one remaining bomb');
assert.equal(vm.runInContext('matchWinners()[0].name', context), 'Alice', 'highest scorer wins even if another player owns the final bomb');
vm.runInContext('continueMatch()', context);
assert.equal(vm.runInContext('state.players.A.score', context), 0, 'new match resets points');
vm.runInContext(`
  state = freshState(['A', 'B', 'C']); state.phase = 'play';
  state.players.A.bomb = 0; state.players.B.bomb = 0; state.players.C.bomb = 1;
  advanceMove('A', 0);
`, context);
assert.equal(vm.runInContext('remainingBombs()', context), 1, 'overlapping bombs are both removed when their tile is picked');
assert.equal(vm.runInContext('state.players.A.score', context), 0, 'picking your own bomb gives no bonus');
assert.equal(vm.runInContext('state.players.B.score', context), 2, 'other owners on the same tile still earn the bomb bonus');
assert.equal(vm.runInContext('matchComplete()', context), true, 'overlapping bombs can end the match');

assert.match(html, /id="solo"[^>]*>Play Solo vs Computer/, 'lobby offers solo play');
vm.runInContext(`
  Math.random = () => 0.5;
  document.getElementById('name').value = 'Alice';
  startSolo();
`, context);
assert.equal(vm.runInContext('state.phase', context), 'setup');
assert.equal(vm.runInContext('state.order.length', context), 2, 'solo creates a human and computer');
assert.equal(vm.runInContext('state.players[BOT_ID].ready', context), true, 'computer locks its bomb');
assert.equal(vm.runInContext('net', context), null, 'solo needs no room connection');
vm.runInContext("selectedBomb=0;document.getElementById('action').onclick()", context);
assert.equal(vm.runInContext('state.phase', context), 'play', 'solo round starts after human confirms');
vm.runInContext("advanceMove(ident,1)", context);
assert.equal(scheduled.length, 1, 'computer turn is scheduled');
scheduled.shift()();
assert.equal(vm.runInContext('state.used.length', context), 2, 'computer takes a turn');
assert.equal(vm.runInContext('state.players[BOT_ID].score', context), 1, 'computer scores on a safe tile');
vm.runInContext('nextRound()', context);
assert.equal(vm.runInContext('state.players[BOT_ID].ready', context), true, 'computer is ready in the next round');

// Exercise the actual room message handlers in two isolated browser contexts.
const rooms = [];
const pending = [];
const managedPeers = [];
function client(id, managed = false) {
  const nodes = new Map();
  const makeNode = () => {
    const el = {value: '', textContent: '', className: '', disabled: false, style: {}, children: [], attributes: {}, replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); }, setAttribute(key, value) { this.attributes[key] = value; }, focus() {}};
    const classes = () => new Set(el.className.split(/\s+/).filter(Boolean));
    el.classList = {
      contains(key) { return classes().has(key); },
      add(key) { const names = classes(); names.add(key); el.className = [...names].join(' '); },
      remove(key) { const names = classes(); names.delete(key); el.className = [...names].join(' '); },
      toggle(key, force) { const names = classes(); const active = force === undefined ? !names.has(key) : !!force; active ? names.add(key) : names.delete(key); el.className = [...names].join(' '); return active; },
    };
    return el;
  };
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, makeNode());
    return nodes.get(key);
  };
  const browser = vm.createContext({
    METERED_KEY: managed ? 'pk_live_test' : '',
    MeteredPeer: class {
      constructor() { this.peerId = id; this.remotePeers = []; this.handlers = new Map(); }
      on(event, handler) { this.handlers.set(event, handler); }
      emit(event, payload) { this.handlers.get(event)?.(payload); }
      async join(channel) {
        this.channel = channel;
        const existing = managedPeers.filter(peer => peer.channel === channel);
        managedPeers.push(this);
        for (const other of existing) {
          this.remotePeers.push({id: other.peerId});
          other.remotePeers.push({id: this.peerId});
          other.emit('peer-joined', {peer: {id: this.peerId}});
          this.emit('peer-joined', {peer: {id: other.peerId}});
        }
      }
      send(data) {
        for (const other of managedPeers.filter(peer => peer !== this && peer.channel === this.channel)) {
          queueMicrotask(() => other.emit('data', {senderPeerId: this.peerId, data: structuredClone(data)}));
        }
        return Promise.resolve();
      }
      sendTo(peerId, data) {
        const other = managedPeers.find(peer => peer.peerId === peerId && peer.channel === this.channel);
        if (other) queueMicrotask(() => other.emit('data', {senderPeerId: this.peerId, data: structuredClone(data)}));
        return Promise.resolve();
      }
      async close() {
        const index = managedPeers.indexOf(this);
        if (index >= 0) managedPeers.splice(index, 1);
        for (const other of managedPeers.filter(peer => peer.channel === this.channel)) other.emit('peer-left', {peer: {id: this.peerId}});
      }
    },
    selfId: id,
    joinRoom(_config, code) {
      const room = {id, code, leave() {}, makeAction() {
        const action = {send(message) {
          for (const other of rooms) if (other !== room && other.code === code) pending.push(() => other.action.onMessage(structuredClone(message), {peerId: id}));
        }};
        room.action = action;
        return action;
      }};
      rooms.push(room);
      return room;
    },
    document: {getElementById: node, querySelector: node, createElement: makeNode, addEventListener() {}},
    window: {}, crypto: globalThis.crypto, navigator: {}, location: {reload() {}},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(script, browser);
  return {browser, node};
}
const alice = client('A'), bob = client('B');
vm.runInContext("name='Alice';roomCapacity=2;connect('2ABCDE',true)", alice.browser);
vm.runInContext("name='Bob';connect('2ABCDE',false)", bob.browser);
assert.equal(vm.runInContext('state', bob.browser), null, 'joining never creates a separate game');
assert.equal(bob.node('roster-count').textContent, '1 / 2 joined', 'joining screen shows the actual room capacity while synchronizing');
rooms[0].onPeerJoin('B');
rooms[1].onPeerJoin('A');
function drain() {
  let count = 0;
  while (pending.length) {
    assert.ok(++count < 100, 'message exchange settles');
    pending.shift()();
  }
}
drain();
assert.equal(vm.runInContext('state.order.length', alice.browser), 2);
assert.equal(vm.runInContext('state.order.length', bob.browser), 2);
assert.equal(alice.node('roster-count').textContent, '2 / 2 joined', 'creator sees both players');
assert.equal(bob.node('roster-count').textContent, '2 / 2 joined', 'joiner sees both players');
for (const player of [alice, bob]) {
  assert.equal(player.node('.player.me').classList.contains('needs-bomb'), true, 'local player is highlighted before choosing a secret bomb');
  assert.equal(player.node('turnpill').textContent, 'SELECT YOUR BOMB', 'setup asks the player to choose a bomb');
}
vm.runInContext('selectedBomb=0;paint()', alice.browser);
assert.equal(alice.node('hint').textContent, 'Tile 1 selected. Confirm your secret bomb.', 'selected bomb is identified before confirmation');
assert.equal(alice.node('board').children.at(-36).attributes['aria-label'], 'Tile 1 selected as your secret bomb', 'selected tile is labelled for the player');
vm.runInContext("selectedBomb=0;document.getElementById('action').onclick()", alice.browser);
drain();
assert.equal(alice.node('.player.me').classList.contains('locked-bomb'), true, 'ready player is marked as locked');
assert.equal(alice.node('.player.op').classList.contains('needs-bomb'), true, 'remaining player stays highlighted');
assert.equal(alice.node('hint').textContent, 'Your bomb is locked. Waiting for Bob to select a secret bomb.', 'waiting message names the player still choosing');
vm.runInContext("selectedBomb=1;document.getElementById('action').onclick()", bob.browser);
drain();
assert.equal(vm.runInContext('state.phase', alice.browser), 'play');
assert.equal(vm.runInContext('state.phase', bob.browser), 'play');
assert.equal(alice.node('turnpill').textContent, 'YOUR TURN', 'active player sees their turn');
assert.equal(alice.node('hint').textContent, 'Your turn, Alice! Tap a tile.', 'active player gets a clear prompt');
assert.equal(bob.node('turnpill').textContent, 'WAIT YOUR TURN', 'other player sees whose turn is next');
vm.runInContext("advanceMove('A',2)", alice.browser);
drain();
assert.equal(vm.runInContext('state.players.A.score', bob.browser), 1, 'score reaches other device');
for (const player of [alice, bob]) vm.runInContext('globalThis.effects=[];sfx=kind=>effects.push(kind)', player.browser);
vm.runInContext("broadcast('move',{i:0})", bob.browser);
drain();
assert.equal(vm.runInContext('state.winner', alice.browser), 'A');
assert.equal(vm.runInContext('state.winner', bob.browser), 'A', 'round result reaches other device');
for (const player of [alice, bob]) {
  assert.equal(vm.runInContext('state.bombPicker', player.browser), 'B', 'room records who selected the bomb');
  assert.equal(player.node('hint').textContent, "Bob selected Alice's bomb. Bob was blasted! Alice earned +2 points.", 'all players see who picked and owned the bomb');
  assert.match(player.node('modaltext').textContent, /Bob selected Alice's bomb\. Bob was blasted! Alice earned \+2 points\./, 'bomb notification names both players');
  assert.equal(player.node('blastedPlayer').textContent, 'Bob was blasted!', 'popup identifies the blasted picker');
  assert.equal(player.node('board').children.at(-36).textContent, '\u{1F4A5}', 'selected bomb tile displays an explosion');
  assert.equal(player.node('board').children.at(-36).attributes['aria-label'], 'Tile 1 exploded', 'explosion tile is announced');
  assert.equal(player.node('board').children.at(-36).classList.contains('boom'), true, 'explosion tile is animated');
  assert.equal(player.node(player === bob ? '.player.me' : '.player.op').classList.contains('blasted'), true, 'picker score card is marked as blasted');
  assert.equal(player.node('roster-list').children[1].classList.contains('blasted'), true, 'picker is marked in the player list');
  assert.equal(player.node('modal').classList.contains('blast'), true, 'blast popup fills the screen');
  assert.deepEqual(Array.from(player.browser.effects), ['bomb'], 'blast plays once on each device');
}
const host = client('H'), guest1 = client('I'), guest2 = client('J');
vm.runInContext("name='Host';roomCapacity=3;connect('3ABCDF',true)", host.browser);
vm.runInContext("name='Guest 1';connect('3ABCDF',false)", guest1.browser);
const [hostRoom, firstGuestRoom] = rooms.filter(room => room.code === '3ABCDF');
hostRoom.onPeerJoin('I'); firstGuestRoom.onPeerJoin('H'); drain();
vm.runInContext("name='Guest 2';connect('3ABCDF',false)", guest2.browser);
const secondGuestRoom = rooms.find(room => room.code === '3ABCDF' && room.id === 'J');
hostRoom.onPeerJoin('J'); firstGuestRoom.onPeerJoin('J');
secondGuestRoom.onPeerJoin('H'); secondGuestRoom.onPeerJoin('I'); drain();
for (const player of [host, guest1, guest2]) assert.equal(vm.runInContext('state.order.length', player.browser), 3, 'all three devices see the same room');
assert.equal(host.node('opname').textContent, 'Guest 1', 'second score card shows the second participant');
assert.equal(host.node('extraScores').children.length, 1, 'three-player room shows a third score card');
assert.equal(host.node('extraScores').children[0].children[1].textContent, 'Guest 2', 'third score card shows the third participant');
assert.equal(guest2.node('extraScores').children[0].children[1].textContent, 'Guest 1', 'each device shows the other participants');
vm.runInContext('state.players.J.score=5;paint()', host.browser);
assert.equal(host.node('opname').textContent, 'Guest 2', 'highest scoring opponent appears beside VS');
assert.equal(host.node('opscore').textContent, 5, 'leading opponent score is shown');
assert.equal(host.node('extraScores').children[0].children[1].textContent, 'Guest 1', 'other opponents remain visible below');
vm.runInContext('state.players.J.score=0;paint()', host.browser);
const four = client('F');
vm.runInContext("name='Four';roomCapacity=4;connect('4ABCDE',true)", four.browser);
assert.equal(four.node('extraScores').children.length, 2, 'four-player room reserves four score cards');
assert.equal(four.node('extraScores').children[1].children[1].textContent, 'Waiting for player', 'unfilled score card waits for the selected participant');
for (const [player, tile] of [[host, 0], [guest1, 1], [guest2, 2]]) {
  vm.runInContext(`selectedBomb=${tile};document.getElementById('action').onclick()`, player.browser);
  drain();
}
for (const player of [host, guest1, guest2]) assert.equal(vm.runInContext('state.phase', player.browser), 'play', 'three-player round begins on every device');
vm.runInContext("advanceMove('H',1)", host.browser);
drain();
for (const player of [host, guest1, guest2]) {
  assert.equal(vm.runInContext('remainingBombs()', player.browser), 2, 'all devices retain the two remaining bombs');
  assert.equal(player.node('modalprimary').textContent, 'Continue match', 'first bomb hit offers continued play');
}
vm.runInContext("document.getElementById('modalprimary').onclick()", host.browser);
drain();
for (const player of [host, guest1, guest2]) {
  assert.equal(vm.runInContext('state.phase', player.browser), 'play', 'all devices resume on the same board');
  assert.equal(vm.runInContext('state.used.includes(1)', player.browser), true, 'hit bomb stays used for everyone');
}
vm.runInContext("broadcast('move',{i:0})", guest1.browser);
drain();
for (const player of [host, guest1, guest2]) {
  assert.equal(vm.runInContext('matchComplete()', player.browser), true, 'final bomb hit ends the match on each device');
  assert.equal(player.node('modalprimary').textContent, 'New match', 'completed match offers a fresh game');
  assert.match(player.node('modaltext').textContent, /Host, Guest 1 tie for the win with 2 points/, 'tied highest scores share the win');
}
const managedA = client('M', true), managedB = client('N', true);
await vm.runInContext("name='Managed A';roomCapacity=2;connect('2WXYZA',true)", managedA.browser);
await vm.runInContext("name='Managed B';connect('2WXYZA',false)", managedB.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.order.length', managedA.browser), 2, 'managed service adds remote player');
assert.equal(vm.runInContext('state.order.length', managedB.browser), 2, 'managed service synchronizes room state');
assert.equal(managedA.node('opname').textContent, 'Managed B', 'creator sees the joined player name above the board');
assert.equal(managedB.node('opname').textContent, 'Managed A', 'joiner sees the creator name above the board');
assert.equal(managedA.node('roster-count').textContent, '2 / 2 joined', 'creator shows all requested players joined');
assert.equal(managedB.node('roster-count').textContent, '2 / 2 joined', 'joiner shows all requested players joined');
vm.runInContext("selectedBomb=0;document.getElementById('action').onclick()", managedA.browser);
await new Promise(ok => setTimeout(ok, 0));
vm.runInContext("selectedBomb=1;document.getElementById('action').onclick()", managedB.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.phase', managedB.browser), 'play', 'managed room starts on both devices');
vm.runInContext("advanceMove('M',2)", managedA.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.players.M.score', managedB.browser), 1, 'managed room sends scores between devices');
for (const player of [managedA, managedB]) vm.runInContext('globalThis.effects=[];sfx=kind=>effects.push(kind)', player.browser);
vm.runInContext("broadcast('move',{i:0})", managedB.browser);
await new Promise(ok => setTimeout(ok, 0));
for (const player of [managedA, managedB]) {
  assert.equal(player.node('hint').textContent, "Managed B selected Managed A's bomb. Managed B was blasted! Managed A earned +2 points.", 'managed room shows the bomb notice on both devices');
  assert.equal(player.node('blastedPlayer').textContent, 'Managed B was blasted!', 'managed room identifies who was blasted');
  assert.deepEqual(Array.from(player.browser.effects), ['bomb'], 'managed room plays one blast per device');
}
const early = client('E');
vm.runInContext("name='Early';connect('2ABCDF',false)", early.browser);
vm.runInContext("accept({type:'hello',from:'H',name:'Host'},'H')", early.browser);
assert.equal(early.node('opname').textContent, 'Host', 'name appears before the round state arrives');
assert.equal(early.node('roster-count').textContent, '2 / 2 joined', 'presence shows both joined before the round state arrives');
vm.runInContext("accept({type:'state',from:'H',state:{capacity:2,round:1,board:Array(36).fill('X'),order:['H'],players:{H:{name:'Host',score:0,bomb:null,ready:false}},used:[],turn:0,phase:'setup',winner:null,hit:null,rev:1}},'H')", early.browser);
assert.equal(vm.runInContext('state.order[0]', early.browser), 'H', 'joiner accepts a valid room state before presence notification arrives');
assert.match(html, /id="solo"[\s\S]*id="create"[\s\S]*id="joinMode"/, 'lobby lists Solo, Create Room, then Join Room');
const creatorFlow = client('X');
for (const id of ['solo', 'create', 'joinMode']) assert.equal(creatorFlow.node(id).disabled, true, 'play options are visible but disabled before a name');
vm.runInContext("document.getElementById('name').value='Flow';document.getElementById('name').oninput();document.getElementById('create').onclick()", creatorFlow.browser);
for (const id of ['solo', 'create', 'joinMode']) assert.equal(creatorFlow.node(id).disabled, false, 'entering a name enables the play options');
assert.equal(creatorFlow.node('create').classList.contains('gold'), true, 'selected Create Room option turns yellow');
assert.match(creatorFlow.node('code').value, /^2[A-Z2-9]{5}$/, 'Create Room reveals a two-player code');
assert.equal(vm.runInContext('state', creatorFlow.browser), null, 'creator enters the room only after clicking Join Created Room');
vm.runInContext("document.getElementById('capacity').value='4';document.getElementById('capacity').onchange()", creatorFlow.browser);
assert.match(creatorFlow.node('code').value, /^4[A-Z2-9]{5}$/, 'changing player count generates a matching new code');
vm.runInContext("document.getElementById('enterCreated').onclick()", creatorFlow.browser);
assert.equal(creatorFlow.node('gamecode').value, creatorFlow.node('code').value, 'creator joins with the displayed code');
const joinFlow = client('Y');
vm.runInContext("document.getElementById('name').value='Joiner';document.getElementById('name').oninput();document.getElementById('joinMode').onclick()", joinFlow.browser);
assert.equal(joinFlow.node('joinMode').classList.contains('gold'), true, 'selected Join Room option turns yellow');
assert.equal(joinFlow.node('create').classList.contains('gold'), false, 'other room option stays unselected');
joinFlow.node('joincode').value = creatorFlow.node('code').value;
vm.runInContext("document.getElementById('join').onclick()", joinFlow.browser);
assert.equal(vm.runInContext('roomCode', joinFlow.browser), creatorFlow.node('code').value, 'joiner uses the creator code');
console.log('Boom Blocks game checks passed');
