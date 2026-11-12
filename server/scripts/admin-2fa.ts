// Sets up (or resets) the admin's authenticator code. Usage: admin-2fa.ts <admin email>
// Needs MONGO_URL and JWT_SECRET. Prints a setup link once: scan it with an authenticator app, then delete it from the terminal.
import { MongoClient } from 'mongodb';
import { newSecret, otpauthUri, seal } from '../src/admin/totp';

const email = process.argv[2]?.trim().toLowerCase();
const jwtSecret = process.env.JWT_SECRET;
if (!email || !jwtSecret) {
  console.error('Usage: admin-2fa.ts <admin email>   (needs MONGO_URL and JWT_SECRET)');
  process.exit(1);
}

const mongo = await new MongoClient(process.env.MONGO_URL!).connect();
try {
  const db = mongo.db();
  const user = await db.collection('users').findOne({ email });
  if (!user) {
    console.error(`No account for ${email}. Sign up on the site first.`);
    process.exit(1);
  }
  const secret = newSecret();
  await db.collection('adminState').replaceOne({ _id: user._id }, { _id: user._id, sealed: seal(jwtSecret, secret), createdAt: new Date() }, { upsert: true });
  await db.collection('sessions').updateMany({ userId: user._id }, { $unset: { adminVerifiedAt: '' } });
  console.log(`Authenticator set for ${email}. Add this to your app (Google Authenticator, Authy, 1Password):\n`);
  console.log(`  Key:  ${secret}`);
  console.log(`  Link: ${otpauthUri(email, secret)}\n`);
  console.log('Enter the 6-digit code at /admin to sign in. Clear this terminal now.');
} finally {
  await mongo.close();
}
