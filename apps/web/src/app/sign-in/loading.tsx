import { PageLoading } from "@/components/site/page-loading";

/** Shown the moment the page is asked for, while the server makes it. */
export default function Loading() {
  return <PageLoading label="sign in" kind="site" />;
}
