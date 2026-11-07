import { createFetcher } from '../url/fetcher';
import { createRenderer } from './render';
import { createShotService } from './service';

// Pages pull in scripts, styles and images, so each answer may be larger than the URL check allows.
const fetchUrl = createFetcher({ maxBytes: 5 * 1024 * 1024, timeoutMs: 8000 });
const port = Number(process.env.PORT ?? 4000);

createShotService({ render: createRenderer({ fetchUrl }) }).listen(port, () => console.log(`Screenshot service on port ${port}`));
