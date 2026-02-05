import { initDb, closeDb } from './index.js';

console.log('Initializing Ralph Monitor database...');
initDb();
closeDb();
console.log('Done!');
