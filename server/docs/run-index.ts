// One indexing pass, run by the server in its own process:
//   node server/docs/run-index.ts '<places json>'
import { paths } from '../config.ts';
import { indexAll, openSearch } from './search.ts';

const places = JSON.parse(process.argv[2] ?? '{}') as { roots: string[]; exclude: string[] };
const db = openSearch(paths.search);
await indexAll(db, places, (msg) => console.log(msg));
db.close();
