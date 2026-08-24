import { Game } from '@/Core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const game = new Game(canvas, ui);
game.start();

// útil para debug no console do navegador
(window as unknown as { game: Game }).game = game;
