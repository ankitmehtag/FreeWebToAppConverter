import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceOf, premiumPrice, isCurrency } from '../src/payments/prices';
import { prepareOrders } from '../src/payments/orders';

let mongo: MongoClient;
let db: ReturnType<MongoClient['db']>;
beforeAll(async () => {
  mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
  db = mongo.db(`pay_test_${randomUUID().slice(0, 8)}`);
});
afterAll(async () => {
  await db.dropDatabase();
  await mongo.close();
});

const order = (appId: ObjectId, status: string, extra: object = {}) => ({
  appId, userId: new ObjectId(), plan: 'premium', provider: 'razorpay', currency: 'INR', amount: 9900, status, createdAt: new Date(), ...extra,
});

describe('R2: prices live in one module, in minor units', () => {
  it('prices Premium at 9900 paise or 100 cents and Free at 0', () => {
    expect(premiumPrice('INR')).toBe(9900);
    expect(premiumPrice('USD')).toBe(100);
    expect(priceOf('free', 'INR')).toBe(0);
    expect(priceOf('premium', 'USD')).toBe(100);
  });

  it('refuses a currency or plan it does not know', () => {
    expect(isCurrency('INR')).toBe(true);
    expect(isCurrency('EUR')).toBe(false);
    expect(priceOf('gold', 'INR')).toBeUndefined();
    expect(priceOf('premium', 'EUR')).toBeUndefined();
  });

  it('keeps every price a whole number', () => {
    for (const currency of ['INR', 'USD'] as const) expect(Number.isInteger(premiumPrice(currency))).toBe(true);
  });
});

describe('AC2: an app cannot hold two open or paid orders', () => {
  it('refuses a second order while one is created, pending or paid', async () => {
    const { orders } = await prepareOrders(db);
    for (const status of ['created', 'pending', 'paid']) {
      const appId = new ObjectId();
      await orders.insertOne(order(appId, status));
      await expect(orders.insertOne(order(appId, 'created'))).rejects.toMatchObject({ code: 11000 });
    }
  });

  it('allows a new order once earlier ones failed or were refunded', async () => {
    const { orders } = await prepareOrders(db);
    const appId = new ObjectId();
    await orders.insertOne(order(appId, 'failed'));
    await orders.insertOne(order(appId, 'refunded'));
    await orders.insertOne(order(appId, 'created'));
    expect(await orders.countDocuments({ appId })).toBe(3);
  });

  it('lets two different apps each have an order', async () => {
    const { orders } = await prepareOrders(db);
    await orders.insertOne(order(new ObjectId(), 'paid'));
    await orders.insertOne(order(new ObjectId(), 'paid'));
  });
});

describe('AC3: the provider order id and the event id are unique', () => {
  it('refuses the same provider order id twice', async () => {
    const { orders } = await prepareOrders(db);
    await orders.insertOne(order(new ObjectId(), 'created', { providerOrderId: 'order_1' }));
    await expect(orders.insertOne(order(new ObjectId(), 'created', { providerOrderId: 'order_1' }))).rejects.toMatchObject({ code: 11000 });
  });

  it('refuses the same provider event twice but accepts the same id from another provider', async () => {
    const { providerEvents } = await prepareOrders(db);
    await providerEvents.insertOne({ provider: 'razorpay', eventId: 'evt_1' });
    await expect(providerEvents.insertOne({ provider: 'razorpay', eventId: 'evt_1' })).rejects.toMatchObject({ code: 11000 });
    await providerEvents.insertOne({ provider: 'stripe', eventId: 'evt_1' });
  });

  it('is safe to prepare twice', async () => {
    await prepareOrders(db);
    await prepareOrders(db);
  });
});
