// pages/api/healthcheck.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_ANON_KEY!;
    if (!url || !key) {
      return res.status(200).json({ ok: false, supabase: "missing env" });
    }

    const supabase = createClient(url, key);
    // Optional: light ping w/out needing a real table
    const { data, error } = await supabase.from("pg_tables").select("tablename").limit(1);
    return res.status(200).json({ ok: !error, error: error?.message ?? null });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: e.message || "error" });
  }
}