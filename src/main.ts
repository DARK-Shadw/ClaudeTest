import './ui/style.css';
import { Game } from './game';
import { deserialize, serialize } from './sim';
import { loadGame } from './storage';

interface HotData {
  save?: string;
}

interface HotApi {
  data?: HotData;
  ready?: (start: (data?: HotData) => void) => void;
  snapshot?: (take: () => HotData) => void;
}

const app = document.getElementById('app')!;
const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;

function start(data: HotData = {}): void {
  // A live update of the page hands over the running game; otherwise resume from this device.
  const handed = data.save ? deserialize(data.save) : null;
  const saved = handed ? { state: handed, savedAt: Date.now() } : loadGame();
  try {
    const game = new Game(app, saved);
    hot?.snapshot?.(() => ({ save: serialize(game.state) }));
    // Handy for playtesting: hearthwild.advance(4800) skips a day, hearthwild.issue({...}) gives orders.
    (window as unknown as { hearthwild: Game }).hearthwild = game;
  } catch (err) {
    console.error(err);
    app.innerHTML = '<p class="fatal">This device could not start 3D graphics, which Hearthwild needs. Try a recent version of Chrome or Safari.</p>';
  }
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
