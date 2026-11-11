import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planOf, setPlan } from '../src/apps/plan';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const planInDb = async (id: string) => (await h.apps.findOne({ _id: new ObjectId(id) }))?.plan;

describe('AC1: only server code sets the plan', () => {
  it('starts an app as Free', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Mine' })).json();
    expect(app.plan).toBe('free');
  });

  it('rejects a plan sent when creating an app', async () => {
    const user = await signedIn(h, email());
    const response = await user.post('/apps', { appName: 'Sneaky', plan: 'premium' });
    expect(response.status).toBe(400);
    expect(await h.apps.countDocuments({ 'draft.appName': 'Sneaky' })).toBe(0);
  });

  it('rejects a plan sent when saving an app, in the draft or beside it', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Mine' })).json();
    expect((await user.put(`/apps/${app.id}`, { appName: 'Mine', plan: 'premium' })).status).toBe(400);
    expect((await user.put(`/apps/${app.id}`, { appName: 'Mine', ui: { plan: 'premium' } })).status).toBe(400);
    expect((await (await user.get(`/apps/${app.id}`)).json()).plan).toBe('free');
    expect(await planInDb(app.id)).toBeUndefined();
  });
});

describe('AC1: a missing or unknown plan is Free', () => {
  it('reads anything but "premium" as free', () => {
    expect(planOf({})).toBe('free');
    expect(planOf({ plan: 'gold' })).toBe('free');
    expect(planOf({ plan: null })).toBe('free');
    expect(planOf({ plan: 'PREMIUM' })).toBe('free');
    expect(planOf({ plan: 'premium' })).toBe('premium');
  });

  it('shows Free for an app whose stored plan is unknown', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Odd' })).json();
    await h.apps.updateOne({ _id: new ObjectId(app.id) }, { $set: { plan: 'gold' } });
    expect((await (await user.get(`/apps/${app.id}`)).json()).plan).toBe('free');
  });
});

describe('setPlan: the one function that writes the plan', () => {
  it('moves an app to Premium and back', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Paid' })).json();
    expect(await setPlan(h.apps, new ObjectId(app.id), 'premium')).toBe(true);
    expect((await (await user.get(`/apps/${app.id}`)).json()).plan).toBe('premium');
    expect(await setPlan(h.apps, new ObjectId(app.id), 'free')).toBe(true);
    expect((await (await user.get(`/apps/${app.id}`)).json()).plan).toBe('free');
  });

  it('refuses a value that is not a plan and an app that does not exist', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Paid' })).json();
    await expect(setPlan(h.apps, new ObjectId(app.id), 'gold' as never)).rejects.toThrow();
    expect(await planInDb(app.id)).toBeUndefined();
    expect(await setPlan(h.apps, new ObjectId(), 'premium')).toBe(false);
  });
});
