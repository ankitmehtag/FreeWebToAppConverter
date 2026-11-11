// Sets an app's plan until payments (F14) exist. Usage: set-plan.ts <app id> <free|premium>
import { MongoClient, ObjectId } from 'mongodb';
import { setPlan, type Plan } from '../src/apps/plan';

const [id, plan] = process.argv.slice(2);
if (!id || !/^[0-9a-f]{24}$/.test(id) || (plan !== 'free' && plan !== 'premium')) {
  console.error('Usage: set-plan.ts <app id> <free|premium>');
  process.exit(1);
}

const mongo = await new MongoClient(process.env.MONGO_URL!).connect();
try {
  const found = await setPlan(mongo.db().collection('apps'), new ObjectId(id), plan as Plan);
  console.log(found ? `App ${id} is now ${plan}` : `No app ${id}`);
  process.exitCode = found ? 0 : 1;
} finally {
  await mongo.close();
}
