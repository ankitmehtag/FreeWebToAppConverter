import { writeFileSync } from 'node:fs';
import { appConfigJsonSchema } from '../src/app-config';

const target = new URL('../app-config.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(appConfigJsonSchema, null, 2)}\n`);
