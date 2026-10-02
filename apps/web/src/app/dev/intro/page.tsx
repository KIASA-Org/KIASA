import { notFound } from "next/navigation";
import { IntroPreview } from "@/components/intro/preview";
import { PERIOD, SETTLED } from "@/components/intro/timing";

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const time = Number((await searchParams).t ?? 0);
  return <IntroPreview initialTime={Number.isFinite(time) ? Math.max(0, Math.min(SETTLED + PERIOD * 2, time)) : 0} />;
}
