// /pages/api/email/debug-env.ts
export default function handler(req, res) {
  res.status(200).json({
    MYEMAILVERIFIER_API_KEY: process.env.MYEMAILVERIFIER_API_KEY ? 'loaded' : 'missing',
  });
}