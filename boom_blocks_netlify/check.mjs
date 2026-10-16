import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
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
assert.equal(vm.runInContext('state.phase', context), 'end', 'first player to 10 ends the match');

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
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {value: '', textContent: '', className: '', disabled: false, style: {}, classList: {contains: () => false, add() {}, remove() {}, toggle() {}}, replaceChildren() {}, append() {}, appendChild() {}, setAttribute() {}});
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
    document: {getElementById: node, querySelector: () => node('oplabel'), createElement: () => ({style: {}, classList: {add() {}}, append() {}, setAttribute() {}}), addEventListener() {}},
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
vm.runInContext("selectedBomb=0;document.getElementById('action').onclick()", alice.browser);
drain();
vm.runInContext("selectedBomb=1;document.getElementById('action').onclick()", bob.browser);
drain();
assert.equal(vm.runInContext('state.phase', alice.browser), 'play');
assert.equal(vm.runInContext('state.phase', bob.browser), 'play');
vm.runInContext("advanceMove('A',2)", alice.browser);
drain();
assert.equal(vm.runInContext('state.players.A.score', bob.browser), 1, 'score reaches other device');
vm.runInContext("broadcast('move',{i:0})", bob.browser);
drain();
assert.equal(vm.runInContext('state.winner', alice.browser), 'A');
assert.equal(vm.runInContext('state.winner', bob.browser), 'A', 'round result reaches other device');
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
for (const [player, tile] of [[host, 0], [guest1, 1], [guest2, 2]]) {
  vm.runInContext(`selectedBomb=${tile};document.getElementById('action').onclick()`, player.browser);
  drain();
}
for (const player of [host, guest1, guest2]) assert.equal(vm.runInContext('state.phase', player.browser), 'play', 'three-player round begins on every device');
const managedA = client('M', true), managedB = client('N', true);
await vm.runInContext("name='Managed A';roomCapacity=2;connect('2WXYZA',true)", managedA.browser);
await vm.runInContext("name='Managed B';connect('2WXYZA',false)", managedB.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.order.length', managedA.browser), 2, 'managed service adds remote player');
assert.equal(vm.runInContext('state.order.length', managedB.browser), 2, 'managed service synchronizes room state');
vm.runInContext("selectedBomb=0;document.getElementById('action').onclick()", managedA.browser);
await new Promise(ok => setTimeout(ok, 0));
vm.runInContext("selectedBomb=1;document.getElementById('action').onclick()", managedB.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.phase', managedB.browser), 'play', 'managed room starts on both devices');
vm.runInContext("advanceMove('M',2)", managedA.browser);
await new Promise(ok => setTimeout(ok, 0));
assert.equal(vm.runInContext('state.players.M.score', managedB.browser), 1, 'managed room sends scores between devices');
console.log('Boom Blocks game checks passed');
