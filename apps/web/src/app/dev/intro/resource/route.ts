export async function GET() {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  await new Promise(resolve => setTimeout(resolve, 5500));
  return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
}
