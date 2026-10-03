import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlannedPageView } from "@/components/site/planned";
import { findPage, plannedPages } from "@/content/pages";

// Every page the site links to, and nothing else: any other address is a 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return plannedPages.map(page => ({ slug: page.href.split("/").filter(Boolean) }));
}

const pageFor = async (params: Promise<{ slug: string[] }>) => findPage(`/${(await params).slug.join("/")}`);

export async function generateMetadata({ params }: PageProps<"/[...slug]">): Promise<Metadata> {
  const page = await pageFor(params);
  return page ? { title: page.title, description: page.summary || undefined } : {};
}

export default async function Planned({ params }: PageProps<"/[...slug]">) {
  const page = await pageFor(params);
  if (!page) notFound();
  return <PlannedPageView page={page} />;
}
