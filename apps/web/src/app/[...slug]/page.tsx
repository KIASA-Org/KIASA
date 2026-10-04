import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageView } from "@/components/site/blocks/page";
import { PlannedPageView } from "@/components/site/planned";
import { findDoc } from "@/content/docs";
import { findPage, plannedPages } from "@/content/pages";

// Every page the site links to, and nothing else: any other address is a 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return plannedPages.map(page => ({ slug: page.href.split("/").filter(Boolean) }));
}

const pathOf = async (params: Promise<{ slug: string[] }>) => `/${(await params).slug.join("/")}`;

export async function generateMetadata({ params }: PageProps<"/[...slug]">): Promise<Metadata> {
  const path = await pathOf(params);
  const doc = findDoc(path);
  if (doc) return { title: doc.practice ? { absolute: doc.title } : doc.title, description: doc.summary };
  const page = findPage(path);
  return page ? { title: page.title, description: page.summary || undefined } : {};
}

/** A designed page is drawn from its blocks; a page still to be written shows its placeholder. */
export default async function SitePage({ params }: PageProps<"/[...slug]">) {
  const path = await pathOf(params);
  const doc = findDoc(path);
  if (doc) return <PageView doc={doc} />;
  const page = findPage(path);
  if (!page) notFound();
  return <PlannedPageView page={page} />;
}
