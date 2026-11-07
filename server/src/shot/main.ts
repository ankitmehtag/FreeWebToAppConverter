import { createFetcher } from '../url/fetcher';
import { createRenderer } from './render';
import { createShotService } from './service';

// Pages pull in scripts, styles and images, so each answer may be larger than the URL check allows.
const fetchUrl = createFetcher({ maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000 });
const port = Number(process.env.PORT ?? 4000);

createShotService({ render: createRenderer({ fetchUrl }) }).listen(port, () => console.log(`Screenshot service on port ${port}`));

// A hostile page or a failing connection must not take the service down for everyone else.
process.on('uncaughtException', (error) => console.error('Uncaught', error.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled', String(reason)));
