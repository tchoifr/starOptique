import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const legacyRoot = path.resolve(projectRoot, '../staratlas');

export const config = {
  port: Number(process.env.PORT || 3001),
  galaxyApiBase: process.env.STARATLAS_GALAXY_API_BASE || 'https://galaxy.staratlas.com',
  catalogEndpoint: process.env.STARATLAS_CATALOG_ENDPOINT || '/nfts',
  showroomEndpoint: process.env.STARATLAS_SHOWROOM_ENDPOINT || '/showroom/freeShips',
  rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  marketplaceProgramId: process.env.STARATLAS_MARKETPLACE_PROGRAM_ID || 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg',
  cacheTtlMs: 45_000,
  orderbookTtlMs: 30_000,
  sampleDatasetPath: path.resolve(legacyRoot, 'data/staratlas_ships.sample.json'),
  projectRoot,
};
