import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function embedQuery(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "embed failed");
  return j.data[0].embedding as number[];
}

export async function searchPlaybooks(embedding: number[]) {
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supa.rpc("match_playbooks", {
    query_embedding: embedding,
    match_count: 3
  });
  if (error) throw new Error(error.message);
  return data as Array<{
    id: number; slug: string; type: string; title: string;
    steps: string[]; citations: { label: string; url: string }[]; similarity: number
  }>;
}
