// Queues a test build, standing in for the API until F06. Usage: enqueue.ts <icon path> [app name]
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { MongoClient } from 'mongodb';
import { enqueueBuild, QUEUE_NAME } from '../src/builds';

const [iconPath, appName = 'Queued App'] = process.argv.slice(2);
const mongo = await new MongoClient(process.env.MONGO_URL!).connect();
const queue = new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL! } });

const id = await enqueueBuild(mongo.db().collection('builds'), queue, {
  _id: randomUUID(),
  config: {
    schemaVersion: 1,
    startUrl: 'https://sitetoapk-test.pages.dev/',
    packageName: 'com.sitetoapk.generated',
    appName,
    internalHosts: ['sitetoapk-test.pages.dev'],
    ui: { statusBarColor: '#0F172A', orientation: 'unspecified', zoom: false, progressBar: true, pullToRefresh: true, exitDialog: true },
  },
  iconPath: iconPath!,
  plan: 'free',
  versionCode: 3,
  versionName: '1.2.3',
});
console.log(id);
await queue.close();
await mongo.close();
