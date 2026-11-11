// Fully refunds an order until the admin panel (F17) exists. Usage: refund-order.ts <order id> [--force]
// --force skips the 7-day window and the "nothing downloaded" rule. Needs MONGO_URL and the Razorpay keys.
import { MongoClient } from 'mongodb';
import { prepareOrders } from '../src/payments/orders';
import { razorpay } from '../src/payments/razorpay';
import { refundOrder } from '../src/payments/refunds';

const [orderId, flag] = process.argv.slice(2);
if (!orderId || (flag !== undefined && flag !== '--force')) {
  console.error('Usage: refund-order.ts <order id> [--force]');
  process.exit(1);
}
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
if (!keyId || !keySecret) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  process.exit(1);
}

const mongo = await new MongoClient(process.env.MONGO_URL!).connect();
try {
  const db = mongo.db();
  const result = await refundOrder(
    {
      ...(await prepareOrders(db)),
      apps: db.collection('apps'),
      users: db.collection('users'),
      keystores: db.collection('keystores'),
      builds: db.collection('builds'),
      providers: { razorpay: razorpay({ keyId, keySecret }) },
    },
    orderId,
    { force: flag === '--force' },
  );
  console.log(result.ok ? `Refunded order ${orderId} (${result.refundId}). The app is Free again.` : `Not refunded: ${result.reason}`);
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await mongo.close();
}
