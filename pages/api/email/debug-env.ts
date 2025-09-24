// pages/api/email/debug-env.ts
import type { NextApiRequest, NextApiResponse } from "next";

type DebugEnv = { MYEMAILVERIFIER_API_KEY: "loaded" | "missing" };

export default function handler(req: NextApiRequest, res: NextApiResponse<DebugEnv>) {
  res.status(200).json({
    MYEMAILVERIFIER_API_KEY: process.env.MYEMAILVERIFIER_API_KEY ? "loaded" : "missing",
  });
}