import { NetworkProtocol, Constants } from '@graphwar/math';
import { GameData } from './packages/client/src/gameData.js';
class FS { constructor(e){} send(){} close(){} }
class FF { sockets=[]; connect(u,e){ const s=new FS(e); this.sockets.push(s); return s; } }
const factory = new FF();
const ui = new Proxy({}, { get: () => () => {} });
const gd = new GameData(ui, factory);
gd.connect(1);
gd.connection.receive('16&0&Alice&1&1&2&0');
gd.connection.receive('16&1&Bob&2&0&2&0');
const msg = [NetworkProtocol.START_GAME, String(2), '100','100','40','300','200','25', '50','300','720','100', '1'].join('&');
console.log('MSG:', msg);
try { gd.connection.receive(msg); console.log('state', gd.gameState, 'turn', gd.currentTurn, 'players', gd.players.length, 'obs', gd.obstacle !== null); }
catch(e){ console.log('THREW', e.message, e.stack.split('\n').slice(0,6).join('\n')); }
